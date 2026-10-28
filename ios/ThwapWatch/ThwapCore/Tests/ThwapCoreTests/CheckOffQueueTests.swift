import XCTest
@testable import ThwapCore

final class CheckOffQueueTests: XCTestCase {
    let day = "2026-10-31"

    func req(_ id: String, _ disc: String = "stick") -> MarkDoneRequest {
        MarkDoneRequest(player: "demo", discipline: disc, drillId: id, drillName: nil)
    }

    func testEnqueueIsIdempotentPerDrill() async {
        let q = CheckOffQueue()
        let first = await q.enqueue(req("stick:0"), date: day)
        let second = await q.enqueue(req("stick:0"), date: day)
        XCTAssertTrue(first)
        XCTAssertFalse(second)
        let pending = await q.pending
        XCTAssertEqual(pending.count, 1)
    }

    func testSameDrillDifferentDayIsSeparate() async {
        let q = CheckOffQueue()
        await q.enqueue(req("stick:0"), date: day)
        let other = await q.enqueue(req("stick:0"), date: "2026-11-01")
        XCTAssertTrue(other)
    }

    func testOfflineKeepsEntriesAndMarksDoneLocally() async {
        let api = StubThwapAPI(simulateOffline: true)
        let q = CheckOffQueue()
        await q.enqueue(req("stick:0"), date: day)
        let sent = await q.flush(using: api)
        XCTAssertEqual(sent, 0)
        let pending = await q.pending
        XCTAssertEqual(pending.count, 1)
        let done = await q.isDone(drillId: "stick:0", date: day)
        XCTAssertTrue(done)
    }

    func testFlushDeliversInOrderAndReenqueueAfterDeliveryIsNoop() async throws {
        let api = StubThwapAPI()
        let q = CheckOffQueue()
        await q.enqueue(req("stick:0"), date: day)
        await q.enqueue(req("shoot:1", "shoot"), date: day)
        let sent = await q.flush(using: api)
        XCTAssertEqual(sent, 2)
        let pending = await q.pending
        XCTAssertTrue(pending.isEmpty)
        let again = await q.enqueue(req("stick:0"), date: day)
        XCTAssertFalse(again)
        let server = try await api.todayDone()
        XCTAssertEqual(server.drills, ["stick:0", "shoot:1"])
    }

    func testRetryAfterReconnectNeverDoubleCounts() async throws {
        let api = StubThwapAPI(simulateOffline: true)
        let q = CheckOffQueue()
        await q.enqueue(req("dryland:2", "dryland"), date: day)
        await q.flush(using: api)
        await q.flush(using: api)
        await api.setOffline(false)
        await q.flush(using: api)
        await q.flush(using: api)
        let server = try await api.todayDone()
        XCTAssertEqual(server.drills, ["dryland:2"])
        XCTAssertEqual(server.disciplines, ["dryland": true])
    }

    func testServerDuplicateCountsAsDelivered() async {
        // Phone already logged it; the watch's mark comes back duplicate:true.
        let api = StubThwapAPI(doneIds: ["stick:1"])
        let q = CheckOffQueue()
        await q.enqueue(req("stick:1"), date: day)
        let sent = await q.flush(using: api)
        XCTAssertEqual(sent, 1)
        let pending = await q.pending
        XCTAssertTrue(pending.isEmpty)
    }

    // MARK: Persistence

    func tempURL() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("thwap-queue-\(UUID().uuidString)")
            .appendingPathComponent("checkoff-queue.json")
    }

    func testPendingSurvivesReload() async {
        let url = tempURL()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let api = StubThwapAPI(simulateOffline: true)
        let q1 = CheckOffQueue(fileURL: url)
        await q1.enqueue(req("stick:0"), date: day)
        await q1.enqueue(req("shoot:1", "shoot"), date: day)
        await q1.flush(using: api) // offline: nothing confirmed, nothing removed

        // A new instance stands in for the app being killed and relaunched.
        let q2 = CheckOffQueue(fileURL: url)
        let pending = await q2.pending
        XCTAssertEqual(pending.map(\.request.drillId), ["stick:0", "shoot:1"])
        let done = await q2.isDone(drillId: "shoot:1", date: day)
        XCTAssertTrue(done)
    }

    func testReloadedQueueDedupesQueuedAndDelivered() async throws {
        let url = tempURL()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let api = StubThwapAPI()
        let q1 = CheckOffQueue(fileURL: url)
        await q1.enqueue(req("stick:0"), date: day)
        await q1.flush(using: api)                    // stick:0 delivered
        await q1.enqueue(req("stick:1"), date: day)   // stick:1 still pending

        let q2 = CheckOffQueue(fileURL: url)
        let againDelivered = await q2.enqueue(req("stick:0"), date: day)
        let againPending = await q2.enqueue(req("stick:1"), date: day)
        XCTAssertFalse(againDelivered)
        XCTAssertFalse(againPending)
        let pending = await q2.pending
        XCTAssertEqual(pending.map(\.request.drillId), ["stick:1"])
        await q2.flush(using: api)
        let server = try await api.todayDone()
        XCTAssertEqual(server.drills, ["stick:0", "stick:1"])
    }

    func testEntryRemovedFromDiskOnlyAfterConfirm() async {
        let url = tempURL()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let api = StubThwapAPI(simulateOffline: true)
        let q1 = CheckOffQueue(fileURL: url)
        await q1.enqueue(req("dryland:2", "dryland"), date: day)
        await q1.flush(using: api)
        let stillThere = await CheckOffQueue(fileURL: url).pending
        XCTAssertEqual(stillThere.count, 1)

        await api.setOffline(false)
        await q1.flush(using: api)
        let afterConfirm = await CheckOffQueue(fileURL: url).pending
        XCTAssertTrue(afterConfirm.isEmpty)
    }

    func testCorruptFileStartsEmpty() async throws {
        let url = tempURL()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("not json".utf8).write(to: url)
        let q = CheckOffQueue(fileURL: url)
        let ok = await q.enqueue(req("stick:0"), date: day)
        XCTAssertTrue(ok)
        let reloaded = await CheckOffQueue(fileURL: url).pending
        XCTAssertEqual(reloaded.count, 1)
    }
}
