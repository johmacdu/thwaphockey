import XCTest
@testable import ThwapCore

/// The watch home's categories: grouping, order, counts and the lines.
final class CategorySummaryTests: XCTestCase {
    let drills = StubThwapAPI.drills

    func testGroupsInPlanOrder() {
        let cats = CategorySummary.build(drills: drills, doneIds: [])
        XCTAssertEqual(cats.map(\.discipline), [.stick, .shoot, .dryland])
        XCTAssertEqual(cats.map(\.title), ["Hands", "Shooting", "Dryland"])
        XCTAssertEqual(cats.map(\.total), [3, 3, 3])
        XCTAssertEqual(cats[0].drills.map(\.id), ["stick:0", "stick:1", "stick:2"])
    }

    func testOrderFollowsFirstAppearance() {
        let mixed = [drills[6], drills[0], drills[7], drills[3]]
        let cats = CategorySummary.build(drills: mixed, doneIds: [])
        XCTAssertEqual(cats.map(\.discipline), [.dryland, .stick, .shoot])
        XCTAssertEqual(cats[0].total, 2)
    }

    func testWeekendGivesOnlyItsCategories() {
        let weekend = drills.filter { $0.discipline != .dryland }
        let cats = CategorySummary.build(drills: weekend, doneIds: [])
        XCTAssertEqual(cats.map(\.title), ["Hands", "Shooting"])
    }

    func testEmptyPlanHasNoCategories() {
        XCTAssertTrue(CategorySummary.build(drills: [], doneIds: ["stick:0"]).isEmpty)
    }

    func testNotStarted() {
        let shoot = CategorySummary.build(drills: drills, doneIds: [])[1]
        XCTAssertEqual(shoot.doneCount, 0)
        XCTAssertFalse(shoot.isComplete)
        XCTAssertEqual(shoot.buttonTitle, "Pick a drill")
        XCTAssertEqual(shoot.pageAccessibilityLine, "Shooting, 0 of 3 done. Pick a drill.")
        XCTAssertEqual(shoot.progressLine, "0 of 3 done")
        XCTAssertEqual(shoot.tileLine, "0/3")
        XCTAssertEqual(shoot.fraction, 0)
        XCTAssertEqual(shoot.accessibilityLine, "Shooting, 0 of 3 done")
    }

    func testPartlyDone() {
        let stick = CategorySummary.build(drills: drills, doneIds: ["stick:0", "stick:2"])[0]
        XCTAssertFalse(stick.isComplete)
        XCTAssertEqual(stick.buttonTitle, "Pick a drill")
        XCTAssertEqual(stick.countLine, "2 of 3 done")
        XCTAssertEqual(stick.tileLine, "2/3")
        XCTAssertEqual(stick.fraction, 2.0 / 3.0, accuracy: 0.0001)
        XCTAssertTrue(stick.isDone(drills[0]))
        XCTAssertFalse(stick.isDone(drills[1]))
    }

    func testAllDone() {
        let stick = CategorySummary.build(drills: drills, doneIds: ["stick:0", "stick:1", "stick:2"])[0]
        XCTAssertTrue(stick.isComplete)
        XCTAssertEqual(stick.buttonTitle, "See drills")
        XCTAssertEqual(stick.pageAccessibilityLine, "Hands, 3 of 3 done. See drills.")
        XCTAssertEqual(stick.progressLine, "All done!")
        XCTAssertEqual(stick.countLine, "3 of 3 done")
        XCTAssertEqual(stick.fraction, 1)
    }

    func testDoneIdsFromOtherCategoriesDoNotCount() {
        let cats = CategorySummary.build(drills: drills, doneIds: ["stick:0", "dryland:1", "iq:0"])
        XCTAssertEqual(cats.map(\.doneCount), [1, 0, 1])
        XCTAssertEqual(cats[0].doneIds, ["stick:0"])
    }

    func testCategoryTitlesMatchTheWebsite() {
        XCTAssertEqual(Discipline.stick.categoryTitle, "Hands")
        XCTAssertEqual(Discipline.shoot.categoryTitle, "Shooting")
        XCTAssertEqual(Discipline.netplay.categoryTitle, "Net play")
        XCTAssertEqual(Discipline.dryland.categoryTitle, "Dryland")
    }

    func testPlanHelper() {
        let plan = TodayPlan(date: "2026-10-31", playerId: "demo", firstName: "Demo", drills: drills,
                             game: nil, gameGoals: [])
        XCTAssertEqual(plan.categories(doneIds: ["shoot:1"]).map(\.doneCount), [0, 1, 0])
    }

    func testDoseLine() {
        XCTAssertEqual(drills[6].doseLine, "4 sets of 30")   // server dose wins
        XCTAssertEqual(drills[0].doseLine, "4 sets of 20 sec")
        XCTAssertEqual(drills[3].doseLine, "1 min 48 sec")   // one set
        let twoMin = Drill(id: "x:0", discipline: .stick, name: "X", cue: "",
                           plan: DrillPlan(sets: 2, workSeconds: 120, restSeconds: 0))
        XCTAssertEqual(twoMin.doseLine, "2 sets of 2 min")
        let blank = Drill(id: "x:1", discipline: .stick, name: "X", cue: "", dose: "",
                          plan: DrillPlan(sets: 1, workSeconds: 45, restSeconds: 0))
        XCTAssertEqual(blank.doseLine, "45 sec")
    }

    func testStubWeekendPlanIsBonusOnly() async throws {
        let stub = StubThwapAPI(weekend: true)
        let plan = try await stub.todayPlan()
        XCTAssertTrue(plan.bonusDay)
        XCTAssertTrue(plan.restDay)
        XCTAssertEqual(plan.dayHeading, TodayPlan.bonusHeading)
        XCTAssertEqual(plan.categories(doneIds: []).map(\.title), ["Hands", "Shooting"])
    }
}
