import XCTest
@testable import ThwapCore

/// My Season and Team: request shape, decoding against JSON captured from
/// api/done.js (?view=season, ?view=team), and the kid-facing lines.
final class GlanceTests: XCTestCase {
    let base = URL(string: "https://thwaphockey.com")!

    func api(_ t: FakeTransport) -> LiveThwapAPI {
        LiveThwapAPI(baseURL: base, transport: t, tokens: InMemoryTokenStore(TestCreds.lewie))
    }

    // MARK: requests

    func testSeasonRequestCarriesCookieAndDecodes() async throws {
        let t = FakeTransport(fixture: "done-season")
        let r = try await api(t).season()
        let req = try XCTUnwrap(t.requests.first)
        XCTAssertEqual(req.httpMethod, "GET")
        XCTAssertEqual(req.url?.path, "/api/done")
        XCTAssertEqual(req.query, ["view": "season"])
        XCTAssertEqual(req.value(forHTTPHeaderField: "Cookie"), "thwapSession=\(TestCreds.token)")
        XCTAssertEqual(r.tier, "Practice Ice")
        XCTAssertEqual(r.nextTier, "Game Ready")
        XCTAssertEqual(r.dotsToNextTier, 8)
        XCTAssertEqual(r.trainingDays, 35)
        XCTAssertEqual(r.season.label, "2026-27")
    }

    func testTeamRequestCarriesCookieAndDecodes() async throws {
        let t = FakeTransport(fixture: "done-team")
        let r = try await api(t).team()
        let req = try XCTUnwrap(t.requests.first)
        XCTAssertEqual(req.query, ["view": "team"])
        XCTAssertEqual(req.value(forHTTPHeaderField: "Cookie"), "thwapSession=\(TestCreds.token)")
        XCTAssertEqual(r, TeamResponse(ok: true, teamName: "Rangers", week: .init(start: "2026-11-02", end: "2026-11-04"),
                                       goal: 85, total: 62, toGo: 23, mine: 9))
    }

    func testGlance401SignsOut() async {
        let store = InMemoryTokenStore(TestCreds.lewie)
        let live = LiveThwapAPI(baseURL: base, transport: FakeTransport(fixture: "done-401"), tokens: store)
        do { _ = try await live.season(); XCTFail() } catch {
            XCTAssertEqual(error as? ThwapAPIError, .unauthorized)
        }
        XCTAssertNil(store.load())
    }

    func testGlanceOfflineIsOffline() async {
        let live = api(FakeTransport { _ in throw OfflineError() })
        do { _ = try await live.team(); XCTFail() } catch {
            XCTAssertEqual(error as? ThwapAPIError, .offline)
        }
    }

    // MARK: My Season copy

    func testSeasonDecodesStepsAndBadges() throws {
        let r = try JSONDecoder().decode(SeasonResponse.self, from: Fixture.raw("done-season"))
        XCTAssertEqual(r.step, 3)
        XCTAssertEqual(r.stepsDone, 5)
        XCTAssertEqual(r.daysToNextStep, 8)
        XCTAssertEqual(r.nextScene, "Game Ready")
        XCTAssertEqual(r.badgeStars, 17)
        XCTAssertEqual(r.nextStar, NextStar(id: "onaheater", name: "On a Heater", remaining: 1, unit: "day in a row"))
        let g = r.glance
        XCTAssertEqual(g.tier, "Practice Ice")
        XCTAssertEqual(g.stepLine, "Step 3 of 3")
        XCTAssertEqual(g.dots, [.done, .done, .current])
        XCTAssertEqual(g.countdownLine, "8 more days to Game Ready")
        XCTAssertEqual(g.starsLine, "🏅 17 badge stars")
        XCTAssertEqual(g.nextStarLine, "Next star: On a Heater, 1 more day in a row")
        XCTAssertEqual(g.rowValue, "Practice Ice, step 3")
    }

    /// An older deploy without the step and badge fields still decodes.
    func testSeasonOldShapeStillDecodes() throws {
        let old = #"{"ok":true,"season":{"key":"fw-2026","label":"2026-27","start":"2026-09-01","end":"2027-03-31"},"seasonOver":false,"trainingDays":35,"dots":35,"totalDots":91,"tierIndex":1,"tier":"Practice Ice","nextTier":"Game Ready","dotsToNextTier":8,"dotsToFinish":56,"complete":false}"#
        let g = try JSONDecoder().decode(SeasonResponse.self, from: Data(old.utf8)).glance
        XCTAssertNil(g.starsLine)
        XCTAssertNil(g.nextStarLine)
        XCTAssertEqual(g.tier, "Practice Ice")
    }

    func testSeasonStep2() {
        let g = SeasonGlance(tier: "Practice Ice", step: 2, stepsDone: 4, daysToNextStep: 5, nextScene: "Game Ready",
                             complete: false, seasonOver: false, badgeStars: 12,
                             nextStar: NextStar(id: "dangler", name: "Dangler", remaining: 4, unit: "Hands drills"))
        XCTAssertEqual(g.stepLine, "Step 2 of 3")
        XCTAssertEqual(g.dots, [.done, .current, .open])
        XCTAssertEqual(g.countdownLine, "5 more days to step 3")
        XCTAssertEqual(g.starsLine, "🏅 12 badge stars")
        XCTAssertEqual(g.nextStarLine, "Next star: Dangler, 4 more Hands drills")
        XCTAssertEqual(g.rowValue, "Practice Ice, step 2")
    }

    func testSeasonOneDayAndOneStarAreSingular() {
        let g = SeasonGlance(tier: "Game Ready", step: 1, stepsDone: 6, daysToNextStep: 1, nextScene: "Legend",
                             complete: false, seasonOver: false, badgeStars: 1,
                             nextStar: NextStar(id: "tapetotape", name: "Tape to Tape", remaining: 1, unit: "Passing drill"))
        XCTAssertEqual(g.dots, [.current, .open, .open])
        XCTAssertEqual(g.countdownLine, "1 more day to step 2")
        XCTAssertEqual(g.starsLine, "🏅 1 badge star")
        XCTAssertEqual(g.nextStarLine, "Next star: Tape to Tape, 1 more Passing drill")
    }

    func testSeasonLegendLastStepFinishesThePath() throws {
        let g = try JSONDecoder().decode(SeasonResponse.self, from: Fixture.raw("done-season-legend")).glance
        XCTAssertEqual(g.tier, "Legend")
        XCTAssertEqual(g.stepLine, "Step 1 of 3")
        XCTAssertEqual(g.countdownLine, "5 more days to step 2")
        let last = SeasonGlance(tier: "Legend", step: 3, stepsDone: 11, daysToNextStep: 3, nextScene: nil,
                                complete: false, seasonOver: false)
        XCTAssertEqual(last.countdownLine, "3 more days to finish the path")
    }

    func testSeasonComplete() throws {
        let g = try JSONDecoder().decode(SeasonResponse.self, from: Fixture.raw("done-season-complete")).glance
        XCTAssertTrue(g.complete)
        XCTAssertEqual(g.stepLine, "Step 3 of 3")
        XCTAssertEqual(g.dots, [.done, .done, .done])
        XCTAssertEqual(g.countdownLine, "You finished the whole path. Legend!")
        XCTAssertEqual(g.starsLine, "🏅 45 badge stars")
        XCTAssertEqual(g.rowValue, "Legend, path done")
    }

    func testNoNextStarLineWhenNothingIsLeft() {
        let g = SeasonGlance(tier: "Legend", step: 3, stepsDone: 12, daysToNextStep: 0, nextScene: nil,
                             complete: true, seasonOver: false, badgeStars: 96, nextStar: nil)
        XCTAssertNil(g.nextStarLine)
    }

    func testOffSeasonKeepsOneLine() {
        let g = SeasonGlance(tier: "Game Ready", step: 2, stepsDone: 7, daysToNextStep: 4, nextScene: "Legend",
                             complete: false, seasonOver: true, badgeStars: 20,
                             nextStar: NextStar(id: "x", name: "X", remaining: 2, unit: "drills"))
        XCTAssertTrue(g.offSeason)
        XCTAssertEqual(g.countdownLine, "The season is over. A new path starts in September.")
        XCTAssertNil(g.starsLine)
        XCTAssertNil(g.nextStarLine)
        XCTAssertEqual(g.rowValue, "Game Ready")
    }

    // MARK: Team copy

    func testTeamGoalFirst() {
        let g = TeamGlance(teamName: "Rangers", goal: 150, total: 112, toGo: 38, mine: 9)
        XCTAssertEqual(TeamGlance.eyebrow, "TEAM GOAL")
        XCTAssertEqual(g.goalLine, "Team goal: 112 of 150 drills, 38 to go")
        XCTAssertEqual(g.countLine, "112 of 150")
        XCTAssertEqual(g.toGoLine, "38 more drills to go!")
        XCTAssertEqual(g.mineLine, "You did 9 this week 💪")
        XCTAssertEqual(g.fraction, 112.0 / 150.0, accuracy: 0.0001)
        XCTAssertEqual(g.rowValue, "38 to go")
    }

    func testTeamOneToGoIsSingular() {
        let g = TeamGlance(teamName: "Rangers", goal: 150, total: 149, toGo: 1, mine: 0)
        XCTAssertEqual(g.toGoLine, "1 more drill to go!")
        XCTAssertEqual(g.goalLine, "Team goal: 149 of 150 drills, 1 to go")
        XCTAssertEqual(g.mineLine, "Every drill you do adds to this.")
    }

    func testTeamGoalReachedAndNothingYet() {
        let hit = TeamGlance(teamName: "Flyers 9U", goal: 75, total: 80, toGo: 0, mine: 0)
        XCTAssertEqual(hit.goalLine, "Team goal: 80 of 75 drills, goal reached")
        XCTAssertEqual(hit.toGoLine, "Goal reached!")
        XCTAssertEqual(hit.fraction, 1)
        XCTAssertEqual(hit.mineLine, "Every drill you do adds to this.")
        XCTAssertEqual(hit.rowValue, "Goal reached")
        XCTAssertEqual(TeamGlance(teamName: "X", goal: 0, total: 0, toGo: 0, mine: 0).fraction, 0)
    }

    /// Kid copy rules: no em-dash or en-dash, at most one "!" per screen.
    func testCopyRules() async throws {
        for state in StubThwapAPI.SeasonState.allCases {
            let s = try await StubThwapAPI(seasonState: state).season().glance
            let screen = [s.tier, s.stepLine, s.countdownLine, s.starsLine ?? "", s.nextStarLine ?? ""].joined(separator: " ")
            XCTAssertLessThanOrEqual(screen.filter { $0 == "!" }.count, 1, screen)
            XCTAssertFalse(screen.contains("\u{2014}") || screen.contains("\u{2013}"), screen)
        }
        for state in StubThwapAPI.TeamState.allCases {
            let t = try await StubThwapAPI(teamState: state).team().glance
            let screen = [TeamGlance.eyebrow, t.countLine, t.toGoLine, t.mineLine].joined(separator: " ")
            XCTAssertLessThanOrEqual(screen.filter { $0 == "!" }.count, 1, screen)
            XCTAssertFalse(screen.contains("\u{2014}") || screen.contains("\u{2013}"), screen)
        }
    }

    func testStubAnswersBoth() async throws {
        let stub = StubThwapAPI(date: "2026-11-04")
        let season = try await stub.season()
        let team = try await stub.team()
        XCTAssertEqual(season.glance.countdownLine, "5 more days to step 3")
        XCTAssertEqual(season.glance.nextStarLine, "Next star: Dangler, 4 more Hands drills")
        XCTAssertEqual(team.glance.goalLine, "Team goal: 112 of 150 drills, 38 to go")
        await stub.setOffline(true)
        do { _ = try await stub.team(); XCTFail() } catch {
            XCTAssertEqual(error as? ThwapAPIError, .offline)
        }
    }
}
