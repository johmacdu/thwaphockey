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

    func testSeasonLinesMidTier() throws {
        let g = try JSONDecoder().decode(SeasonResponse.self, from: Fixture.raw("done-season")).glance
        XCTAssertEqual(g.tier, "Practice Ice")
        XCTAssertEqual(g.nextLine, "8 more training days to Game Ready")
        XCTAssertNil(g.finishLine)
        XCTAssertEqual(g.totalLine, "35 training days this season")
        XCTAssertEqual(g.rowValue, "Practice Ice")
    }

    func testSeasonOneDayIsSingular() {
        let g = SeasonGlance(tier: "Locker Room", nextTier: "Practice Ice", trainingDays: 1,
                             dotsToNextTier: 1, dotsToFinish: 90, complete: false, seasonOver: false)
        XCTAssertEqual(g.nextLine, "1 more training day to Practice Ice")
        XCTAssertEqual(g.totalLine, "1 training day this season")
    }

    func testSeasonLegendSaysTopScene() throws {
        let g = try JSONDecoder().decode(SeasonResponse.self, from: Fixture.raw("done-season-legend")).glance
        XCTAssertEqual(g.tier, "Legend")
        XCTAssertEqual(g.nextLine, "You made it to the top scene!")
        XCTAssertEqual(g.finishLine, "21 more training days to finish the path")
    }

    func testSeasonComplete() throws {
        let g = try JSONDecoder().decode(SeasonResponse.self, from: Fixture.raw("done-season-complete")).glance
        XCTAssertTrue(g.complete)
        XCTAssertEqual(g.nextLine, "You finished the whole path. Legend!")
        XCTAssertNil(g.finishLine)
    }

    func testSeasonOver() {
        let g = SeasonGlance(tier: "Game Ready", nextTier: "Legend", trainingDays: 50,
                             dotsToNextTier: 17, dotsToFinish: 41, complete: false, seasonOver: true)
        XCTAssertEqual(g.nextLine, "The season is over. A new path starts in September.")
        XCTAssertNil(g.finishLine)
    }

    // MARK: Team copy

    func testTeamGoalFirst() {
        let g = TeamGlance(teamName: "Rangers", goal: 150, total: 112, toGo: 38, mine: 9)
        XCTAssertEqual(g.goalLine, "Rangers: 112 of 150, 38 to go")
        XCTAssertEqual(g.countLine, "112 of 150")
        XCTAssertEqual(g.toGoLine, "38 to go")
        XCTAssertEqual(g.mineLine, "You added 9 this week.")
        XCTAssertEqual(g.fraction, 112.0 / 150.0, accuracy: 0.0001)
        XCTAssertEqual(g.rowValue, "38 to go")
    }

    func testTeamGoalReachedAndNothingYet() {
        let hit = TeamGlance(teamName: "Flyers 9U", goal: 75, total: 80, toGo: 0, mine: 0)
        XCTAssertEqual(hit.goalLine, "Flyers 9U: 80 of 75, goal reached!")
        XCTAssertEqual(hit.toGoLine, "Goal reached!")
        XCTAssertEqual(hit.fraction, 1)
        XCTAssertEqual(hit.mineLine, "Every drill you do adds to this.")
        XCTAssertEqual(TeamGlance(teamName: "X", goal: 0, total: 0, toGo: 0, mine: 0).fraction, 0)
    }

    /// Kid copy rules: no em-dash or en-dash, at most one "!" per screen.
    func testCopyRules() {
        let seasons = [
            SeasonGlance(tier: "Legend", nextTier: nil, trainingDays: 70, dotsToNextTier: 0, dotsToFinish: 21, complete: false, seasonOver: false),
            SeasonGlance(tier: "Legend", nextTier: nil, trainingDays: 91, dotsToNextTier: 0, dotsToFinish: 0, complete: true, seasonOver: false),
            SeasonGlance(tier: "Locker Room", nextTier: "Practice Ice", trainingDays: 0, dotsToNextTier: 19, dotsToFinish: 91, complete: false, seasonOver: false),
            SeasonGlance(tier: "Game Ready", nextTier: "Legend", trainingDays: 50, dotsToNextTier: 17, dotsToFinish: 41, complete: false, seasonOver: true),
        ]
        for s in seasons {
            let screen = [s.tier, s.nextLine, s.finishLine ?? "", s.totalLine].joined(separator: " ")
            XCTAssertLessThanOrEqual(screen.filter { $0 == "!" }.count, 1, screen)
            XCTAssertFalse(screen.contains("\u{2014}") || screen.contains("\u{2013}"), screen)
        }
        for t in [TeamGlance(teamName: "Rangers", goal: 75, total: 80, toGo: 0, mine: 3),
                  TeamGlance(teamName: "Rangers", goal: 75, total: 10, toGo: 65, mine: 0)] {
            let screen = [t.teamName, t.countLine, t.toGoLine, t.mineLine].joined(separator: " ")
            XCTAssertLessThanOrEqual(screen.filter { $0 == "!" }.count, 1, screen)
            XCTAssertFalse(screen.contains("\u{2014}") || screen.contains("\u{2013}"), screen)
        }
    }

    func testStubAnswersBoth() async throws {
        let stub = StubThwapAPI(date: "2026-11-04")
        let season = try await stub.season()
        let team = try await stub.team()
        XCTAssertEqual(season.glance.nextLine, "8 more training days to Game Ready")
        XCTAssertEqual(team.glance.goalLine, "Rangers: 112 of 150, 38 to go")
        await stub.setOffline(true)
        do { _ = try await stub.team(); XCTFail() } catch {
            XCTAssertEqual(error as? ThwapAPIError, .offline)
        }
    }
}
