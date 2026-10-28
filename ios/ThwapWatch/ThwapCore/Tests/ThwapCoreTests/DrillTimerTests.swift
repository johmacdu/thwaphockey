import XCTest
@testable import ThwapCore

final class DrillTimerTests: XCTestCase {
    // Stationary Side-to-Side: 4 sets x 20s work, 15s rest.
    let timer = DrillTimer(plan: DrillPlan(sets: 4, workSeconds: 20, restSeconds: 15))

    func testTotalSecondsExcludesTrailingRest() {
        XCTAssertEqual(timer.totalSeconds, 4 * 20 + 3 * 15)
    }

    func testStartsInSetOneWithFullCountdown() {
        let s = timer.state(at: 0)
        XCTAssertEqual(s.phase, .work(set: 1))
        XCTAssertEqual(s.remaining, 20)
        XCTAssertEqual(s.phaseProgress, 0, accuracy: 0.0001)
    }

    func testRemainingRoundsUp() {
        XCTAssertEqual(timer.state(at: 0.2).remaining, 20)
        XCTAssertEqual(timer.state(at: 19.01).remaining, 1)
    }

    func testWalksWorkRestWork() {
        XCTAssertEqual(timer.state(at: 20).phase, .rest(afterSet: 1))
        XCTAssertEqual(timer.state(at: 34.9).phase, .rest(afterSet: 1))
        XCTAssertEqual(timer.state(at: 35).phase, .work(set: 2))
        XCTAssertEqual(timer.state(at: 124.9).phase, .work(set: 4))
    }

    func testFinishedAtAndAfterTotal() {
        XCTAssertEqual(timer.state(at: 125).phase, .finished)
        XCTAssertEqual(timer.state(at: 999).phase, .finished)
        XCTAssertEqual(timer.state(at: -5).phase, .work(set: 1))
    }

    func testEventsFireOncePerBoundary() {
        // Frame-by-frame ticks across the whole drill.
        var all: [DrillTimer.Event] = []
        var last = 0.0
        var t = 0.0
        while t <= 130 {
            all += timer.events(from: last, to: t)
            last = t
            t += 0.25
        }
        XCTAssertEqual(all, [.setEnded(1), .setEnded(2), .setEnded(3), .finished])
    }

    func testEventsEmptyForBackwardsOrSameWindow() {
        XCTAssertEqual(timer.events(from: 20, to: 20), [])
        XCTAssertEqual(timer.events(from: 30, to: 10), [])
    }

    func testBigJumpReportsEveryCrossedBoundary() {
        // App backgrounded mid-drill and resumed after the end.
        XCTAssertEqual(timer.events(from: 10, to: 500), [.setEnded(1), .setEnded(2), .setEnded(3), .finished])
    }

    func testSingleSetNoRest() {
        let one = DrillTimer(plan: DrillPlan(sets: 1, workSeconds: 108, restSeconds: 0))
        XCTAssertEqual(one.totalSeconds, 108)
        XCTAssertEqual(one.events(from: 0, to: 108), [.finished])
    }

    func testPlanClampsNonsense() {
        let p = DrillPlan(sets: 0, workSeconds: 0, restSeconds: -3)
        XCTAssertEqual(p, DrillPlan(sets: 1, workSeconds: 1, restSeconds: 0))
    }
}
