import XCTest
@testable import ThwapCore

/// Fake clock: sleeping just advances time, so a 15-minute wait runs instantly.
final class FakeClock: PollClock, @unchecked Sendable {
    private let lock = NSLock()
    private var t = Date(timeIntervalSince1970: 1_800_000_000)
    private var _sleeps: [Double] = []
    var sleeps: [Double] { lock.lock(); defer { lock.unlock() }; return _sleeps }
    func now() -> Date { lock.lock(); defer { lock.unlock() }; return t }
    func sleep(seconds: Double) async throws {
        try Task.checkCancellation()
        lock.lock(); _sleeps.append(seconds); t = t.addingTimeInterval(seconds); lock.unlock()
    }
}

final class ApprovalPollerTests: XCTestCase {
    /// Answers watch-status from a script of fixture names; the last repeats.
    func transport(_ script: [String]) -> FakeTransport {
        let lock = NSLock()
        var queue = script
        return FakeTransport { _ in
            lock.lock(); defer { lock.unlock() }
            let name = queue.count > 1 ? queue.removeFirst() : queue[0]
            if name == "offline" { throw OfflineError() }
            return Fixture.response(name)
        }
    }

    func poller(_ t: FakeTransport, _ store: InMemoryTokenStore, _ clock: FakeClock) -> ApprovalPoller {
        ApprovalPoller(api: LiveThwapAPI(transport: t, tokens: store), tokens: store, clock: clock)
    }

    func testPendingThenApprovedStoresTokenOnce() async throws {
        let t = transport(["watch-status-pending", "watch-status-pending", "watch-status-approved", "watch-status-expired"])
        let store = InMemoryTokenStore()
        let clock = FakeClock()
        let out = try await poller(t, store, clock).wait(requestId: "r1")
        XCTAssertEqual(out, .approved(TestCreds.lewie))
        XCTAssertEqual(store.saveCount, 1)
        XCTAssertEqual(store.load(), TestCreds.lewie)
        XCTAssertEqual(t.requests.count, 3, "stops polling the moment it is approved")
        XCTAssertEqual(clock.sleeps, [3, 3], "polls every 3 seconds at first")
        XCTAssertTrue(t.requests.allSatisfy { $0.query == ["action": "watch-status", "requestId": "r1"] })
    }

    func testDenied() async throws {
        let store = InMemoryTokenStore()
        let out = try await poller(transport(["watch-status-pending", "watch-status-denied"]), store, FakeClock()).wait(requestId: "r")
        XCTAssertEqual(out, .denied)
        XCTAssertNil(store.load())
        XCTAssertEqual(store.saveCount, 0)
    }

    func testExpired() async throws {
        let store = InMemoryTokenStore()
        let out = try await poller(transport(["watch-status-expired"]), store, FakeClock()).wait(requestId: "r")
        XCTAssertEqual(out, .expired)
        XCTAssertNil(store.load())
    }

    func testTimesOutAfterFifteenMinutesWithBackoff() async throws {
        let store = InMemoryTokenStore()
        let clock = FakeClock()
        let t = transport(["watch-status-pending"])
        let out = try await poller(t, store, clock).wait(requestId: "r")
        XCTAssertEqual(out, .timedOut)
        XCTAssertEqual(clock.sleeps.reduce(0, +), 15 * 60, accuracy: 0.001)
        XCTAssertEqual(clock.sleeps.max(), ApprovalPoller.maxInterval, "backs off, but never past 10 s")
        XCTAssertEqual(clock.sleeps.first, 3)
        // 20 fast polls in the first minute, then slower: far fewer than 300.
        XCTAssertLessThan(t.requests.count, 120)
        XCTAssertGreaterThan(t.requests.count, 80)
        XCTAssertEqual(store.saveCount, 0)
    }

    func testNetworkErrorsBackOffAndKeepWaiting() async throws {
        let store = InMemoryTokenStore()
        let clock = FakeClock()
        let t = transport(["offline", "offline", "watch-status-pending", "watch-status-approved"])
        let out = try await poller(t, store, clock).wait(requestId: "r")
        XCTAssertEqual(out, .approved(TestCreds.lewie))
        XCTAssertEqual(store.saveCount, 1)
        XCTAssertEqual(clock.sleeps, [4.5, 6.75, 3], "an error backs off; a good poll in the first minute goes back to 3 s")
    }

    func testApprovedWithoutTokenIsExpired() async throws {
        let t = FakeTransport { _ in (200, Data(#"{"status":"approved"}"#.utf8)) }
        let store = InMemoryTokenStore()
        let out = try await poller(t, store, FakeClock()).wait(requestId: "r")
        XCTAssertEqual(out, .expired)
        XCTAssertEqual(store.saveCount, 0)
    }

    func testCancelStopsPolling() async throws {
        let store = InMemoryTokenStore()
        let p = ApprovalPoller(api: StubThwapAPI(), tokens: store, clock: SystemPollClock())
        let task = Task { try await p.wait(requestId: "r") }
        try await Task.sleep(nanoseconds: 50_000_000)
        task.cancel()
        do { _ = try await task.value; XCTFail("expected cancellation") } catch {
            XCTAssertTrue(error is CancellationError)
        }
    }

    func testIntervalSchedule() {
        XCTAssertEqual(ApprovalPoller.interval(afterWaiting: 10, previous: 3, hadError: false), 3)
        XCTAssertEqual(ApprovalPoller.interval(afterWaiting: 61, previous: 3, hadError: false), 4.5)
        XCTAssertEqual(ApprovalPoller.interval(afterWaiting: 300, previous: 9, hadError: false), 10)
    }
}
