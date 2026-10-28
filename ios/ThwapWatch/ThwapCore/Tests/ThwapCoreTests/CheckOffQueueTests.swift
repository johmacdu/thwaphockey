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
}
