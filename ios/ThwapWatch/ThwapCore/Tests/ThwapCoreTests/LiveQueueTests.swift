import XCTest
@testable import ThwapCore

/// Queue against the real client and a fake server: flush order, dedupe,
/// removal only on 2xx, undo, drop rules, and the ring snapshot write.
final class LiveQueueTests: XCTestCase {
    let today = "2026-10-28"

    func req(_ id: String, _ disc: String = "stick") -> MarkDoneRequest {
        MarkDoneRequest(player: "lewie", discipline: disc, drillId: id, drillName: nil)
    }

    func live(_ t: FakeTransport) -> LiveThwapAPI {
        LiveThwapAPI(transport: t, tokens: InMemoryTokenStore(TestCreds.lewie))
    }

    func testFlushSendsInOrderAndDedupes() async {
        let t = FakeTransport(fixture: "done-mark")
        let q = CheckOffQueue()
        await q.enqueue(req("stick:0"), date: today)
        await q.enqueue(req("shoot:1", "shoot"), date: today)
        await q.enqueue(req("stick:0"), date: today)          // dup, ignored
        await q.enqueue(req("dryland:2", "dryland"), date: today)
        let sent = await q.flush(using: live(t), today: today)
        XCTAssertEqual(sent, 3)
        XCTAssertEqual(t.requests.compactMap { $0.jsonBody?["drillId"] as? String }, ["stick:0", "shoot:1", "dryland:2"])
        let pending = await q.pending
        XCTAssertTrue(pending.isEmpty)
        // Re-tapping after delivery is a no-op and sends nothing.
        let again = await q.enqueue(req("stick:0"), date: today)
        XCTAssertFalse(again)
        await q.flush(using: live(t), today: today)
        XCTAssertEqual(t.requests.count, 3)
    }

    func testDuplicateReplyCountsAsDelivered() async {
        let t = FakeTransport(fixture: "done-mark-duplicate")
        let q = CheckOffQueue()
        await q.enqueue(req("stick:0"), date: today)
        let sent = await q.flush(using: live(t), today: today)
        XCTAssertEqual(sent, 1)
        let done = await q.isDone(drillId: "stick:0", date: today)
        XCTAssertTrue(done)
    }

    func testItemRemovedOnlyOn200() async {
        let t = FakeTransport { _ in (503, Data(#"{"error":"down"}"#.utf8)) }
        let q = CheckOffQueue()
        await q.enqueue(req("stick:0"), date: today)
        await q.enqueue(req("stick:1"), date: today)
        var sent = await q.flush(using: live(t), today: today)
        XCTAssertEqual(sent, 0)
        var pending = await q.pending
        XCTAssertEqual(pending.map(\.request.drillId), ["stick:0", "stick:1"])
        XCTAssertEqual(t.requests.count, 1, "stops at the first failure so order is kept")
        let last = await q.lastResult
        XCTAssertEqual(last, .stopped(.server(503)))

        // Offline, then 429: still kept.
        t.setHandler { _ in throw OfflineError() }
        await q.flush(using: live(t), today: today)
        t.setHandler { _ in Fixture.response("rate-limited-429") }
        await q.flush(using: live(t), today: today)
        pending = await q.pending
        XCTAssertEqual(pending.count, 2)

        // Back online: both go, in order.
        t.setHandler { _ in Fixture.response("done-mark") }
        sent = await q.flush(using: live(t), today: today)
        XCTAssertEqual(sent, 2)
        pending = await q.pending
        XCTAssertTrue(pending.isEmpty)
    }

    func test401KeepsQueueForAfterReapproval() async {
        let t = FakeTransport(fixture: "done-401")
        let api = live(t)
        let q = CheckOffQueue()
        await q.enqueue(req("stick:0"), date: today)
        await q.flush(using: api, today: today)
        let pending = await q.pending
        XCTAssertEqual(pending.count, 1)
        XCTAssertNil(api.tokens.load(), "401 signs the watch out")
    }

    func test402And400AreDroppedNotRetried() async {
        let t = FakeTransport { req in
            (req.jsonBody?["drillId"] as? String) == "stick:0" ? Fixture.response("done-402")
                : (400, Data(#"{"error":"bad date"}"#.utf8))
        }
        let q = CheckOffQueue()
        await q.enqueue(req("stick:0"), date: today)
        await q.enqueue(req("stick:1"), date: "2026-10-01")
        let sent = await q.flush(using: live(t), today: today)
        XCTAssertEqual(sent, 0)
        let pending = await q.pending
        XCTAssertTrue(pending.isEmpty)
        let dropped = await q.dropped
        XCTAssertEqual(dropped, [.seasonInactive, .badRequest("bad date")])
    }

    func testEarlierDayMarkCarriesDateTodayDoesNot() async {
        let t = FakeTransport(fixture: "done-mark")
        let q = CheckOffQueue()
        await q.enqueue(req("stick:0"), date: "2026-10-27")
        await q.enqueue(req("stick:1"), date: today)
        await q.flush(using: live(t), today: today)
        XCTAssertEqual(t.requests[0].jsonBody?["date"] as? String, "2026-10-27")
        XCTAssertNil(t.requests[1].jsonBody?["date"])
    }

    func testUndoOfUnsentMarkCancelsItLocally() async {
        let t = FakeTransport(fixture: "done-mark")
        let q = CheckOffQueue()
        await q.enqueue(req("stick:0"), date: today)
        let undone = await q.enqueueUndo(req("stick:0"), date: today)
        XCTAssertTrue(undone)
        let done = await q.isDone(drillId: "stick:0", date: today)
        XCTAssertFalse(done)
        await q.flush(using: live(t), today: today)
        XCTAssertTrue(t.requests.isEmpty, "nothing reached the server, nothing to undo there")
    }

    func testUndoOfDeliveredMarkPostsUndo() async {
        let t = FakeTransport { req in
            (req.jsonBody?["undo"] as? Bool) == true ? Fixture.response("done-undo") : Fixture.response("done-mark")
        }
        let q = CheckOffQueue()
        await q.enqueue(req("dryland:1", "dryland"), date: today)
        await q.flush(using: live(t), today: today)
        await q.enqueueUndo(req("dryland:1", "dryland"), date: today)
        var done = await q.isDone(drillId: "dryland:1", date: today)
        XCTAssertFalse(done)
        await q.flush(using: live(t), today: today)
        XCTAssertEqual(t.requests.count, 2)
        XCTAssertEqual(t.requests[1].jsonBody?["undo"] as? Bool, true)
        // Mark again after the undo: a fresh mark is allowed.
        let re = await q.enqueue(req("dryland:1", "dryland"), date: today)
        XCTAssertTrue(re)
        done = await q.isDone(drillId: "dryland:1", date: today)
        XCTAssertTrue(done)
    }

    func testStaleUndoIsDroppedQuietly() async {
        let t = FakeTransport(fixture: "done-undo")
        let q = CheckOffQueue()
        await q.replaceDelivered(with: ["stick:0"], date: "2026-10-27")
        await q.enqueueUndo(req("stick:0"), date: "2026-10-27")
        let sent = await q.flush(using: live(t), today: today)
        XCTAssertEqual(sent, 1)
        XCTAssertTrue(t.requests.isEmpty, "the server undo is today only, so yesterday's is never sent")
    }

    func testPersistedV1FileStillLoads() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("q-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: url) }
        let v1 = #"{"version":1,"entries":[{"date":"2026-10-28","request":{"player":"lewie","discipline":"stick","drillId":"stick:0"}}],"delivered":[]}"#
        try Data(v1.utf8).write(to: url)
        let q = CheckOffQueue(fileURL: url)
        let pending = await q.pending
        XCTAssertEqual(pending.first?.action, .mark)
        XCTAssertEqual(pending.first?.request.drillId, "stick:0")
    }

    func testPersistedUndoSurvivesRelaunch() async {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("q-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: url) }
        let q = CheckOffQueue(fileURL: url)
        await q.replaceDelivered(with: ["stick:0"], date: today)
        await q.enqueueUndo(req("stick:0"), date: today)
        let reopened = CheckOffQueue(fileURL: url)
        let pending = await reopened.pending
        XCTAssertEqual(pending.map(\.action), [.undo])
    }

    func testClearWipesEverything() async {
        let q = CheckOffQueue()
        await q.enqueue(req("stick:0"), date: today)
        await q.clear()
        let pending = await q.pending
        XCTAssertTrue(pending.isEmpty)
        let done = await q.isDone(drillId: "stick:0", date: today)
        XCTAssertFalse(done)
    }

    func testPendingMarksCount() async {
        let q = CheckOffQueue()
        await q.enqueue(req("stick:0"), date: today)
        await q.enqueue(req("stick:1"), date: today)
        let n = await q.pendingMarks
        XCTAssertEqual(n, 2)
    }
}

final class RingSnapshotStoreTests: XCTestCase {
    func suite() -> String { "thwap.tests.\(UUID().uuidString)" }

    func testWeeklySnapshotWriteAndReadAllWeek() throws {
        let name = suite()
        defer { UserDefaults().removePersistentDomain(forName: name) }
        let store = RingStore(suiteName: name)
        let r = try JSONDecoder().decode(RingsResponse.self, from: Fixture.raw("done-rings"))
        store.save(r.snapshot(today: "2026-10-28"))

        let wed = store.load(today: "2026-10-28")
        XCTAssertEqual(wed.rings.map(\.done), [1, 0, 1])
        XCTAssertEqual(wed.rings.map(\.total), [19, 19, 18])
        // Still this week on Sunday.
        XCTAssertEqual(store.load(today: "2026-11-01").rings.map(\.done), [1, 0, 1])
        // Next Monday: empty, never last week's.
        let mon = store.load(today: "2026-11-02")
        XCTAssertEqual(mon.rings.map(\.done), [0, 0, 0])
        XCTAssertEqual(mon.date, "2026-11-02")
    }

    func testDailySnapshotStillDayScoped() {
        let name = suite()
        defer { UserDefaults().removePersistentDomain(forName: name) }
        let store = RingStore(suiteName: name)
        store.save(RingSnapshot(date: "2026-10-28", rings: [RingProgress(discipline: .stick, done: 1, total: 3)]))
        XCTAssertEqual(store.load(today: "2026-10-28").rings.first?.done, 1)
        XCTAssertEqual(store.load(today: "2026-10-29").rings.first?.done, 0)
    }

    func testBumpedAddsOneToTheRightRing() throws {
        let r = try JSONDecoder().decode(RingsResponse.self, from: Fixture.raw("done-rings"))
        let snap = r.snapshot(today: "2026-10-28").bumped(.shoot)
        XCTAssertEqual(snap.rings.map(\.done), [1, 1, 1])
        let goalie = RingSnapshot(date: "d", rings: [RingProgress(discipline: .netplay, done: 0, total: 5)]).bumped(.netplay)
        XCTAssertEqual(goalie.rings.first?.done, 1)
    }

    func testMondayOf() {
        XCTAssertEqual(ThwapDay.mondayOf("2026-10-26"), "2026-10-26") // Monday
        XCTAssertEqual(ThwapDay.mondayOf("2026-10-28"), "2026-10-26") // Wednesday
        XCTAssertEqual(ThwapDay.mondayOf("2026-11-01"), "2026-10-26") // Sunday
        XCTAssertEqual(ThwapDay.mondayOf("2027-01-01"), "2026-12-28") // across a year
        XCTAssertNil(ThwapDay.mondayOf("nope"))
    }
}
