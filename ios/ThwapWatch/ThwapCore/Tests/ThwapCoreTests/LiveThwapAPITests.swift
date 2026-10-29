import XCTest
@testable import ThwapCore

/// Request encoding + response decoding for every endpoint the watch uses,
/// against JSON captured from api/login.js, api/done.js and api/coach.js.
final class LiveThwapAPITests: XCTestCase {
    let base = URL(string: "https://thwaphockey.com")!

    func api(_ t: FakeTransport, signedIn: Bool = true) -> (LiveThwapAPI, InMemoryTokenStore) {
        let store = InMemoryTokenStore(signedIn ? TestCreds.lewie : nil)
        return (LiveThwapAPI(baseURL: base, transport: t, tokens: store), store)
    }

    // MARK: watch-request

    func testWatchRequestEncodingAndDecoding() async throws {
        let t = FakeTransport(fixture: "watch-request")
        let (api, _) = api(t, signedIn: false)
        let out = try await api.requestWatch(WatchRequestBody(teamCode: " vjr10u ", code: "722027", deviceLabel: "Apple Watch"))
        XCTAssertEqual(out, WatchRequestResponse(ok: true, requestId: "Vu56Au6IEPCnGLQQYkZwRcZe0la_xqJeOJGAA1YCfng", sent: true))

        let req = try XCTUnwrap(t.requests.first)
        XCTAssertEqual(req.httpMethod, "POST")
        XCTAssertEqual(req.url?.path, "/api/login")
        XCTAssertEqual(req.query, ["action": "watch-request"])
        XCTAssertEqual(req.value(forHTTPHeaderField: "Content-Type"), "application/json")
        // New contract: team code + player code, no playerId, no name list.
        let body = try XCTUnwrap(req.jsonBody)
        XCTAssertEqual(body["teamCode"] as? String, "VJR10U")
        XCTAssertEqual(body["code"] as? String, "722027")
        XCTAssertEqual(body["deviceLabel"] as? String, "Apple Watch")
        XCTAssertNil(body["playerId"])
        XCTAssertEqual(Set(body.keys), ["teamCode", "code", "deviceLabel"])
        // Not signed in yet: no cookie.
        XCTAssertNil(req.value(forHTTPHeaderField: "Cookie"))
    }

    func testWatchRequestBadCodeIsNotASignOut() async {
        let t = FakeTransport(fixture: "watch-request-401")
        let (api, store) = api(t)
        do {
            _ = try await api.requestWatch(WatchRequestBody(teamCode: "X", code: "1", deviceLabel: "w"))
            XCTFail("expected badCode")
        } catch {
            XCTAssertEqual(error as? ThwapAPIError, .badCode)
        }
        XCTAssertNotNil(store.load(), "a wrong code must never clear an existing token")
    }

    func testWatchRequestRateLimitedMessage() async {
        let t = FakeTransport(fixture: "rate-limited-429")
        let (api, _) = api(t, signedIn: false)
        do {
            _ = try await api.requestWatch(WatchRequestBody(teamCode: "X", code: "1", deviceLabel: "w"))
            XCTFail("expected rateLimited")
        } catch let e as ThwapAPIError {
            XCTAssertEqual(e, .rateLimited)
            XCTAssertEqual(e.userMessage, "Too many tries. Wait a few minutes, then try again.")
            XCTAssertFalse(e.userMessage.contains("\u{2014}"))
            XCTAssertFalse(e.userMessage.contains("\u{00B7}"))
        } catch { XCTFail("\(error)") }
    }

    // MARK: watch-status

    func testWatchStatusEncodingAndAllStatuses() async throws {
        let t = FakeTransport(fixture: "watch-status-pending")
        let (api, _) = api(t, signedIn: false)
        var s = try await api.watchStatus(requestId: "abc_123")
        XCTAssertEqual(s.status, .pending)
        let req = try XCTUnwrap(t.requests.first)
        XCTAssertEqual(req.httpMethod, "GET")
        XCTAssertEqual(req.query, ["action": "watch-status", "requestId": "abc_123"])
        XCTAssertNil(req.httpBody)

        t.setHandler { _ in Fixture.response("watch-status-denied") }
        s = try await api.watchStatus(requestId: "x")
        XCTAssertEqual(s.status, .denied)

        t.setHandler { _ in Fixture.response("watch-status-expired") }
        s = try await api.watchStatus(requestId: "x")
        XCTAssertEqual(s.status, .expired)

        t.setHandler { _ in Fixture.response("watch-status-approved") }
        s = try await api.watchStatus(requestId: "x")
        XCTAssertEqual(s.status, .approved)
        XCTAssertEqual(s.token, TestCreds.token)
        XCTAssertEqual(s.exp, 1796065200000)
        XCTAssertEqual(s.player, .init(id: "lewie", name: "Lewie", number: 72))
    }

    func testUnknownStatusReadsAsPending() throws {
        let s = try JSONDecoder().decode(WatchStatusResponse.self, from: Data(#"{"status":"sending"}"#.utf8))
        XCTAssertEqual(s.status, .pending)
    }

    // MARK: cookie

    func testEverySignedInCallCarriesTheSessionCookie() async throws {
        let t = FakeTransport { req in
            switch (req.url!.path, req.query["view"] ?? req.query["action"] ?? "") {
            case ("/api/done", "today"): return Fixture.response("done-today")
            case ("/api/done", "rings"): return Fixture.response("done-rings")
            case ("/api/coach", "my-game-goals"): return Fixture.response("game-goals-gameday")
            case ("/api/login", "session"): return (200, Data(#"{"authed":true,"player":{"id":"lewie","name":"Lewie","number":72}}"#.utf8))
            case ("/api/done", ""): return req.httpMethod == "POST" ? Fixture.response("done-mark") : Fixture.response("done-get")
            default: return (404, Data("{}".utf8))
            }
        }
        let (api, _) = api(t)
        _ = try await api.session()
        _ = try await api.todayView()
        _ = try await api.todayDone()
        _ = try await api.rings()
        _ = try await api.gameGoals()
        _ = try await api.markDone(MarkDoneRequest(player: "lewie", discipline: "stick", drillId: "stick:0", drillName: "The Triangle Drill"))
        XCTAssertEqual(t.requests.count, 6)
        for r in t.requests {
            XCTAssertEqual(r.value(forHTTPHeaderField: "Cookie"), "thwapSession=\(TestCreds.token)", r.url!.absoluteString)
            XCTAssertEqual(r.url?.host, "thwaphockey.com")
            XCTAssertEqual(r.url?.scheme, "https")
        }
    }

    func testSignedInCallWithNoTokenNeverHitsTheNetwork() async {
        let t = FakeTransport(fixture: "done-get")
        let (api, _) = api(t, signedIn: false)
        do { _ = try await api.todayDone(); XCTFail() } catch {
            XCTAssertEqual(error as? ThwapAPIError, .unauthorized)
        }
        XCTAssertTrue(t.requests.isEmpty)
    }

    // MARK: 401 / 402 / 429 / offline

    func test401ClearsTokenAndSignalsSignOut() async {
        let t = FakeTransport(fixture: "done-401")
        let (api, store) = api(t)
        let flag = Flag()
        api.onSignedOut { flag.set() }
        do { _ = try await api.todayDone(); XCTFail() } catch {
            XCTAssertEqual(error as? ThwapAPIError, .unauthorized)
        }
        XCTAssertNil(store.load())
        XCTAssertTrue(flag.value)
    }

    func testSessionAuthedFalseClearsToken() async throws {
        let t = FakeTransport(fixture: "session-after-logout")
        let (api, store) = api(t)
        let s = try await api.session()
        XCTAssertFalse(s.authed)
        XCTAssertNil(store.load())
    }

    func test429OnSignedInCallKeepsToken() async {
        let t = FakeTransport(fixture: "rate-limited-429")
        let (api, store) = api(t)
        do { _ = try await api.todayDone(); XCTFail() } catch {
            XCTAssertEqual(error as? ThwapAPIError, .rateLimited)
        }
        XCTAssertNotNil(store.load())
    }

    func test402IsSeasonInactive() async {
        let t = FakeTransport(fixture: "done-402")
        let (api, _) = api(t)
        do {
            _ = try await api.markDone(MarkDoneRequest(player: "lewie", discipline: "stick", drillId: "stick:0", drillName: nil))
            XCTFail()
        } catch {
            XCTAssertEqual(error as? ThwapAPIError, .seasonInactive)
            XCTAssertEqual((error as? ThwapAPIError)?.userMessage, "Your team's season is not active yet. Ask your coach.")
        }
    }

    func testTransportErrorIsOfflineAndKeepsToken() async {
        let t = FakeTransport { _ in throw OfflineError() }
        let (api, store) = api(t)
        do { _ = try await api.rings(); XCTFail() } catch {
            XCTAssertEqual(error as? ThwapAPIError, .offline)
        }
        XCTAssertNotNil(store.load())
    }

    func test5xxIsServerAndKeepsQueued() async {
        let t = FakeTransport { _ in (500, Data("{}".utf8)) }
        let (api, _) = api(t)
        do { _ = try await api.rings(); XCTFail() } catch {
            XCTAssertEqual(error as? ThwapAPIError, .server(500))
            XCTAssertTrue((error as! ThwapAPIError).keepsQueued)
        }
    }

    // MARK: logout

    func testLogoutPostsWithCookieThenClearsToken() async throws {
        let t = FakeTransport(fixture: "logout")
        let (api, store) = api(t)
        try await api.logout()
        let req = try XCTUnwrap(t.requests.first)
        XCTAssertEqual(req.httpMethod, "POST")
        XCTAssertEqual(req.query, ["action": "logout"])
        XCTAssertEqual(req.value(forHTTPHeaderField: "Cookie"), "thwapSession=\(TestCreds.token)")
        XCTAssertNil(store.load())
    }

    func testLogoutOfflineStillClearsToken() async {
        let t = FakeTransport { _ in throw OfflineError() }
        let (api, store) = api(t)
        try? await api.logout()
        XCTAssertNil(store.load())
    }

    // MARK: view=today

    func testTodayViewDecodesAndMapsTimers() async throws {
        let t = FakeTransport(fixture: "done-today")
        let (api, _) = api(t)
        let v = try await api.todayView()
        XCTAssertEqual(t.requests.first?.query, ["view": "today"])
        XCTAssertEqual(t.requests.first?.httpMethod, "GET")
        XCTAssertEqual(v.date, "2026-10-28")
        XCTAssertFalse(v.restDay)
        XCTAssertEqual(v.drills.count, 10)
        XCTAssertEqual(v.drills.filter(\.done).map(\.id), ["stick:0", "dryland:1"])
        let drills = v.drills.compactMap(\.drill)
        XCTAssertEqual(drills.count, 10)
        XCTAssertEqual(drills[0].id, "stick:0")
        XCTAssertEqual(drills[0].plan, DrillPlan(sets: 4, workSeconds: 40, restSeconds: 15))
        XCTAssertEqual(drills[3].plan, DrillPlan(sets: 1, workSeconds: 150, restSeconds: 0))
        XCTAssertEqual(drills[6].dose, "4 sets of 30")
    }

    func testRestDayAndUntimedAndUnknownDiscipline() throws {
        let rest = try JSONDecoder().decode(TodayViewResponse.self, from: Fixture.raw("done-today-restday"))
        XCTAssertTrue(rest.restDay)
        XCTAssertTrue(rest.drills.isEmpty)

        let json = #"{"id":"iq:0","discipline":"iq","name":"Watch a shift","timer":null,"done":false}"#
        let d = try JSONDecoder().decode(ServerDrill.self, from: Data(json.utf8))
        XCTAssertEqual(d.drill?.plan, ServerDrill.untimedPlan)
        let odd = try JSONDecoder().decode(ServerDrill.self, from: Data(#"{"id":"x:0","discipline":"skating","name":"X","done":false}"#.utf8))
        XCTAssertNil(odd.drill)
    }

    func testTodayPlanCombinesTodayAndGameGoals() async throws {
        let t = FakeTransport { req in
            req.url!.path == "/api/coach" ? Fixture.response("game-goals-gameday") : Fixture.response("done-today")
        }
        let (api, _) = api(t)
        let plan = try await api.todayPlan()
        XCTAssertEqual(plan.playerId, "lewie")
        XCTAssertEqual(plan.firstName, "Lewie")
        XCTAssertTrue(plan.isGameDay)
        XCTAssertEqual(plan.game?.opponent, "Tacoma Rockets")
        XCTAssertEqual(plan.gameGoals.map(\.id), ["g1", "g7"])
        XCTAssertEqual(plan.gameGoals.first?.emoji, "👀")
        XCTAssertEqual(plan.gameGoals.first?.cue, "Have a picture before you get it.")
    }

    func testGameGoalsHiddenWhenNotGameDay() async throws {
        let t = FakeTransport { req in
            req.url!.path == "/api/coach" ? Fixture.response("game-goals-not-gameday") : Fixture.response("done-today")
        }
        let (api, _) = api(t)
        let plan = try await api.todayPlan()
        XCTAssertFalse(plan.isGameDay)
        XCTAssertTrue(plan.gameGoals.isEmpty)
        XCTAssertNil(plan.game)
    }

    func testGoalsFailureNeverBlocksTheDrillList() async throws {
        let t = FakeTransport { req in
            req.url!.path == "/api/coach" ? (500, Data("{}".utf8)) : Fixture.response("done-today")
        }
        let (api, _) = api(t)
        let plan = try await api.todayPlan()
        XCTAssertEqual(plan.drills.count, 10)
        XCTAssertFalse(plan.isGameDay)
    }

    // MARK: my-game-goals

    func testGameGoalsRequestAndDecode() async throws {
        let t = FakeTransport(fixture: "game-goals-gameday")
        let (api, _) = api(t)
        let g = try await api.gameGoals()
        XCTAssertEqual(t.requests.first?.url?.path, "/api/coach")
        XCTAssertEqual(t.requests.first?.query, ["action": "my-game-goals"])
        XCTAssertTrue(g.gameDay)
        XCTAssertEqual(g.game?.id, "g-1031")
        XCTAssertNil(g.game?.endDate)
        XCTAssertEqual(g.game?.home, true)
        XCTAssertEqual(g.max, 3)
    }

    // MARK: plain GET /api/done

    func testTodayDoneDecode() async throws {
        let t = FakeTransport(fixture: "done-get")
        let (api, _) = api(t)
        let d = try await api.todayDone()
        XCTAssertTrue(t.requests.first?.query.isEmpty ?? false)
        XCTAssertEqual(d.drills, ["stick:0", "stick#the-triangle-drill", "dryland:1"])
        XCTAssertEqual(d.disciplines, ["stick": true, "dryland": true])
    }

    // MARK: mark / undo

    func testMarkEncodingAndDecoding() async throws {
        let t = FakeTransport(fixture: "done-mark")
        let (api, _) = api(t)
        let out = try await api.markDone(MarkDoneRequest(player: "lewie", discipline: "stick", drillId: "stick:0", drillName: "The Triangle Drill"))
        XCTAssertEqual(out.ok, true)
        XCTAssertNil(out.duplicate)
        XCTAssertEqual(out.drills, ["stick:0", "stick#the-triangle-drill"])
        let req = try XCTUnwrap(t.requests.first)
        XCTAssertEqual(req.httpMethod, "POST")
        XCTAssertEqual(req.url?.path, "/api/done")
        XCTAssertTrue(req.query.isEmpty)
        let body = try XCTUnwrap(req.jsonBody)
        XCTAssertEqual(Set(body.keys), ["player", "discipline", "drillId", "drillName"], "no date key for today's mark")
        XCTAssertEqual(body["player"] as? String, "lewie")
        XCTAssertEqual(body["discipline"] as? String, "stick")
        XCTAssertEqual(body["drillId"] as? String, "stick:0")
    }

    func testMarkWithBackdateSendsDate() async throws {
        let t = FakeTransport(fixture: "done-mark")
        let (api, _) = api(t)
        _ = try await api.markDone(MarkDoneRequest(player: "lewie", discipline: "stick", drillId: "stick:0", drillName: nil, date: "2026-10-27"))
        XCTAssertEqual(t.requests.first?.jsonBody?["date"] as? String, "2026-10-27")
    }

    func testMarkDuplicateDecodes() async throws {
        let t = FakeTransport(fixture: "done-mark-duplicate")
        let (api, _) = api(t)
        let out = try await api.markDone(MarkDoneRequest(player: "lewie", discipline: "stick", drillId: "stick:0", drillName: nil))
        XCTAssertEqual(out.duplicate, true)
    }

    func testMarkWithNullDrillsDecodes() throws {
        let out = try JSONDecoder().decode(MarkDoneResponse.self, from: Data(#"{"player":{"id":"lewie"},"ok":true,"drills":null}"#.utf8))
        XCTAssertNil(out.drills)
    }

    func testUndoEncodingAndDecoding() async throws {
        let t = FakeTransport(fixture: "done-undo")
        let (api, _) = api(t)
        let out = try await api.undoDone(UndoDoneRequest(player: "lewie", drillId: "dryland:1"))
        XCTAssertEqual(out.undo, true)
        let body = try XCTUnwrap(t.requests.first?.jsonBody)
        XCTAssertEqual(Set(body.keys), ["player", "drillId", "undo"])
        XCTAssertEqual(body["undo"] as? Bool, true)
        XCTAssertEqual(body["drillId"] as? String, "dryland:1")
        XCTAssertNil(body["discipline"], "an undo must not carry a discipline bump")
    }

    // MARK: view=rings

    func testRingsRequestDecodeAndSnapshot() async throws {
        let t = FakeTransport(fixture: "done-rings")
        let (api, _) = api(t)
        let r = try await api.rings()
        XCTAssertEqual(t.requests.first?.query, ["view": "rings"])
        XCTAssertEqual(r.week.start, "2026-10-26")
        let snap = r.snapshot(today: "2026-10-28")
        XCTAssertEqual(snap.weekStart, "2026-10-26")
        XCTAssertEqual(snap.rings, [
            RingProgress(discipline: .stick, done: 1, total: 19),
            RingProgress(discipline: .shoot, done: 0, total: 19),
            RingProgress(discipline: .dryland, done: 1, total: 18),
        ])
    }

    func testGoalieRingsUseNetplay() throws {
        let json = #"{"ok":true,"week":{"start":"2026-10-26","end":"2026-10-28"},"goalie":true,"rings":{"stick":{"done":2,"goal":10},"netplay":{"done":3,"goal":12},"dryland":{"done":0,"goal":9}}}"#
        let r = try JSONDecoder().decode(RingsResponse.self, from: Data(json.utf8))
        let snap = r.snapshot(today: "2026-10-28")
        XCTAssertEqual(snap.rings[1], RingProgress(discipline: .netplay, done: 3, total: 12))
    }

    // MARK: config

    func testBaseURLOverride() {
        XCTAssertEqual(ThwapConfig.baseURL(arguments: []), URL(string: "https://thwaphockey.com"))
        XCTAssertEqual(ThwapConfig.baseURL(arguments: ["-thwapBaseURL", "https://preview.thwaphockey.com"]),
                       URL(string: "https://preview.thwaphockey.com"))
        // Plain http to a remote host is refused.
        XCTAssertEqual(ThwapConfig.baseURL(arguments: ["-thwapBaseURL", "http://evil.example"]),
                       URL(string: "https://thwaphockey.com"))
    }

    func testCredentialFirstNameAndExpiry() {
        XCTAssertEqual(TestCreds.lewie.firstName, "Lewie")
        let noName = WatchCredential(token: "t", exp: 1000, player: .init(id: "alder", name: nil, number: nil))
        XCTAssertEqual(noName.firstName, "Alder")
        XCTAssertTrue(noName.isExpired(now: Date(timeIntervalSince1970: 2)))
        XCTAssertFalse(TestCreds.lewie.isExpired(now: Date(timeIntervalSince1970: 1_700_000_000)))
    }
}

final class Flag: @unchecked Sendable {
    private let lock = NSLock()
    private var v = false
    func set() { lock.lock(); v = true; lock.unlock() }
    var value: Bool { lock.lock(); defer { lock.unlock() }; return v }
}
