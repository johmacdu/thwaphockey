import XCTest
@testable import ThwapCore

final class RingMathTests: XCTestCase {
    let drills = StubThwapAPI.drills   // 3 stick, 3 shoot, 3 dryland

    func testEmptyDayIsZeroNotNaN() {
        let r = RingProgress(discipline: .stick, done: 0, total: 0)
        XCTAssertEqual(r.fraction, 0)
        XCTAssertFalse(r.isClosed)
    }

    func testRingsCountTodaysDrillsInOrder() {
        let rings = RingMath.rings(drills: drills, doneIds: ["stick:0", "stick:1", "dryland:0"])
        XCTAssertEqual(rings.map(\.discipline), [.stick, .shoot, .dryland])
        XCTAssertEqual(rings.map(\.done), [2, 0, 1])
        XCTAssertEqual(rings.map(\.total), [3, 3, 3])
        XCTAssertEqual(rings[0].fraction, 2.0 / 3.0, accuracy: 0.0001)
    }

    func testForeignAndSlugIdsNeverOverfill() {
        let ids: Set<String> = ["stick:0", "stick:1", "stick:2", "stick:9", "stick#front-to-back", "iq:offense:0:q0"]
        let stick = RingMath.rings(drills: drills, doneIds: ids)[0]
        XCTAssertEqual(stick.done, 3)
        XCTAssertEqual(stick.fraction, 1)
        XCTAssertTrue(stick.isClosed)
    }

    func testFractionClamps() {
        XCTAssertEqual(RingProgress(discipline: .shoot, done: 7, total: 3).fraction, 1)
        XCTAssertEqual(RingProgress(discipline: .shoot, done: -1, total: 3).fraction, 0)
    }

    func testGoalieNetplayFillsShootRing() {
        let goalie = [Drill(id: "shoot:0", discipline: .netplay, name: "x", cue: "", plan: DrillPlan(sets: 1, workSeconds: 1, restSeconds: 0))]
        let rings = RingMath.rings(drills: goalie, doneIds: ["shoot:0"])
        XCTAssertEqual(rings[1].done, 1)
        XCTAssertEqual(rings[1].total, 1)
    }

    func testSweepAndConcentricGeometry() {
        XCTAssertEqual(RingMath.sweepDegrees(0.5), 180)
        XCTAssertEqual(RingMath.sweepDegrees(2), 360)
        XCTAssertEqual(RingMath.diameter(index: 0, size: 100, line: 8, gap: 2), 92)
        XCTAssertEqual(RingMath.diameter(index: 1, size: 100, line: 8, gap: 2), 72)
        XCTAssertEqual(RingMath.diameter(index: 2, size: 100, line: 8, gap: 2), 52)
    }

    func testRingStoreRoundTripAndStaleDay() {
        let store = RingStore(suiteName: "thwap.tests.\(UUID().uuidString)")
        let snap = RingSnapshot(date: "2026-10-31", rings: RingMath.rings(drills: drills, doneIds: ["shoot:2"]))
        store.save(snap)
        XCTAssertEqual(store.load(today: "2026-10-31"), snap)
        let stale = store.load(today: "2026-11-01")
        XCTAssertEqual(stale.date, "2026-11-01")
        XCTAssertEqual(stale.rings.map(\.done), [0, 0, 0])
        store.clear()
    }

    func testGameDayCoversTournamentRange() {
        let t = GameEvent(id: "t-1113", kind: "tournament", date: "2026-11-13", endDate: "2026-11-15")
        XCTAssertTrue(t.covers(day: "2026-11-14"))
        XCTAssertFalse(t.covers(day: "2026-11-16"))
    }

    func testDecodesRealDoneShape() throws {
        let json = #"{"ok":true,"player":"demo","date":"2026-10-31","drills":["stick:0","stick#stationary-side-to-side"],"disciplines":{"stick":true}}"#
        let r = try JSONDecoder().decode(DoneResponse.self, from: Data(json.utf8))
        XCTAssertEqual(r.drills.count, 2)
        XCTAssertEqual(r.disciplines["stick"], true)
    }

    func testDecodesSessionShapes() throws {
        let out = try JSONDecoder().decode(SessionResponse.self, from: Data(#"{"authed":false}"#.utf8))
        XCTAssertFalse(out.authed)
        let inn = try JSONDecoder().decode(SessionResponse.self, from: Data(#"{"authed":true,"player":{"id":"demo"}}"#.utf8))
        XCTAssertEqual(inn.player?.id, "demo")
    }
}
