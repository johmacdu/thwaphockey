import Foundation

/// The seam between the screens and the network. Every screen, the check-off
/// queue and the approval poller talk to this protocol only. `LiveThwapAPI` is
/// the real client; `StubThwapAPI` backs previews, UI tests and screenshots.
///
/// Endpoint mapping (api/login.js, api/done.js, api/coach.js):
/// - `requestWatch(_:)`  -> POST /api/login?action=watch-request { teamCode, code, deviceLabel }
/// - `watchStatus(_:)`   -> GET  /api/login?action=watch-status&requestId=
/// - `logout()`          -> POST /api/login?action=logout
/// - `session()`         -> GET  /api/login?action=session
/// - `todayPlan()`       -> GET  /api/done?view=today (+ my-game-goals)
/// - `todayDone()`       -> GET  /api/done
/// - `rings()`           -> GET  /api/done?view=rings
/// - `season()`          -> GET  /api/done?view=season
/// - `team()`            -> GET  /api/done?view=team
/// - `gameGoals()`       -> GET  /api/coach?action=my-game-goals
/// - `markDone(_:)`      -> POST /api/done { player, discipline, drillId, drillName, date? }
/// - `undoDone(_:)`      -> POST /api/done { player, drillId, undo: true }
public protocol ThwapAPI: Sendable {
    func requestWatch(_ body: WatchRequestBody) async throws -> WatchRequestResponse
    func watchStatus(requestId: String) async throws -> WatchStatusResponse
    func logout() async throws
    func session() async throws -> SessionResponse
    func todayPlan() async throws -> TodayPlan
    func todayDone() async throws -> DoneResponse
    func rings() async throws -> RingsResponse
    func season() async throws -> SeasonResponse
    func team() async throws -> TeamResponse
    func gameGoals() async throws -> GameGoalsResponse
    func markDone(_ request: MarkDoneRequest) async throws -> MarkDoneResponse
    func undoDone(_ request: UndoDoneRequest) async throws -> UndoDoneResponse
}

public enum ThwapAPIError: Error, Equatable, Sendable {
    /// No connection, timeout, or an unreadable reply. Safe to retry.
    case offline
    /// 401 on a signed-in call: the token is gone or revoked. Signed out.
    case unauthorized
    /// 401 on watch-request: the team code or player code is wrong.
    case badCode
    /// 429: too many tries.
    case rateLimited
    /// 402: the team's season is not active.
    case seasonInactive
    /// 403: the token belongs to someone else.
    case forbidden
    /// 400 with the server's error string ('bad date', 'unknown player', ...).
    case badRequest(String)
    /// Any other status (5xx, 503 'login not configured').
    case server(Int)

    /// Short kid-facing copy. No em-dashes, no middots.
    public var userMessage: String {
        switch self {
        case .offline: return "No signal. Try again soon."
        case .unauthorized: return "Signed out. Ask a parent to approve this watch again."
        case .badCode: return "That code didn't work. Check your team code and your number."
        case .rateLimited: return "Too many tries. Wait a few minutes, then try again."
        case .seasonInactive: return "Your team's season is not active yet. Ask your coach."
        case .forbidden: return "This watch is signed in as someone else."
        case .badRequest: return "Something didn't match. Try again."
        case .server: return "Thwap is taking a break. Try again soon."
        }
    }

    /// True when a queued check-off should stay queued and be tried later.
    /// False means the server rejected it for good, so it is dropped.
    public var keepsQueued: Bool {
        switch self {
        case .offline, .rateLimited, .server, .unauthorized: return true
        case .badCode, .seasonInactive, .forbidden, .badRequest: return false
        }
    }
}

/// Fixture-backed API. Drill names, cues and timings are copied from the web
/// app (index.html DRILLS, SHOOT_DAYS day 1, WORKOUTS w1wed, THWAP_DRILL_SCRIPT);
/// game goals from hockey_game_goals.html; the game from lib/schedule_store.js.
/// The player is a placeholder, never a real roster kid. Kept for previews,
/// UI tests and screenshots (`-thwapStub` launch argument).
public actor StubThwapAPI: ThwapAPI {
    public var gameDay: Bool
    /// When true every call throws `.offline`, to exercise the queue.
    public var simulateOffline: Bool
    private var doneIds: [String]
    private let date: String
    /// Which My Season / Team answer to give, for screenshots of each state.
    public let seasonState: SeasonState
    public let teamState: TeamState

    public enum SeasonState: String, Sendable, CaseIterable {
        /// Practice Ice, step 2, 5 days to step 3.
        case step2
        /// Practice Ice, step 3, 5 days to Game Ready.
        case lastStep
        /// Game Ready, step 1, 1 day to step 2.
        case oneDay
        /// The whole path done.
        case legend
        /// The longest Next star line there is, for the fit check.
        case longStar
    }

    public enum TeamState: String, Sendable, CaseIterable {
        /// 112 of 150, 38 to go, you did 9.
        case normal
        /// 149 of 150, 1 to go, you did none yet.
        case one
        /// 152 of 150, goal reached.
        case reached
    }

    public init(date: String = "2026-10-31", gameDay: Bool = false, simulateOffline: Bool = false, doneIds: [String] = [],
                seasonState: SeasonState = .step2, teamState: TeamState = .normal) {
        self.date = date
        self.gameDay = gameDay
        self.simulateOffline = simulateOffline
        self.doneIds = doneIds
        self.seasonState = seasonState
        self.teamState = teamState
    }

    public func setOffline(_ offline: Bool) { simulateOffline = offline }
    public func setGameDay(_ on: Bool) { gameDay = on }

    /// Statuses `watchStatus` returns in turn; the last one repeats. Default
    /// waits forever, which is what the waiting-screen screenshot needs.
    private var approvalScript: [WatchStatusResponse.Status] = [.pending]
    public func setApprovalScript(_ script: [WatchStatusResponse.Status]) {
        approvalScript = script.isEmpty ? [.pending] : script
    }

    public func requestWatch(_ body: WatchRequestBody) async throws -> WatchRequestResponse {
        if simulateOffline { throw ThwapAPIError.offline }
        if body.code.isEmpty || body.teamCode.isEmpty { throw ThwapAPIError.badCode }
        return WatchRequestResponse(ok: true, requestId: "stub-request", sent: true)
    }

    public func watchStatus(requestId: String) async throws -> WatchStatusResponse {
        if simulateOffline { throw ThwapAPIError.offline }
        let next = approvalScript.count > 1 ? approvalScript.removeFirst() : approvalScript[0]
        if next == .approved {
            return WatchStatusResponse(status: .approved, token: "demo.stub.0.sig", exp: nil,
                                       player: .init(id: Self.playerId, name: "Demo", number: 0))
        }
        return WatchStatusResponse(status: next)
    }

    public func logout() async throws {}

    public func rings() async throws -> RingsResponse {
        if simulateOffline { throw ThwapAPIError.offline }
        let monday = ThwapDay.mondayOf(date) ?? date
        let r = Self.rollupCounts(doneIds)
        return RingsResponse(ok: true, week: .init(start: monday, end: date), goalie: false, rings: [
            "stick": .init(done: 4 + r["stick", default: 0], goal: 15),
            "shoot": .init(done: 2 + r["shoot", default: 0], goal: 15),
            "dryland": .init(done: 6 + r["dryland", default: 0], goal: 12),
        ])
    }

    /// One answer per `seasonState`, numbers as lib/journey.js would give them.
    public func season() async throws -> SeasonResponse {
        if simulateOffline { throw ThwapAPIError.offline }
        let season = SeasonResponse.Season(key: "fw-2026", label: "2026-27", start: "2026-09-01", end: "2027-03-31")
        func r(_ days: Int, tierIndex: Int, step: Int, stepsDone: Int, toStep: Int, toTier: Int,
               stars: Int, next: NextStar?, complete: Bool = false) -> SeasonResponse {
            let tiers = ["Locker Room", "Practice Ice", "Game Ready", "Legend"]
            let nextTier = tierIndex + 1 < tiers.count ? tiers[tierIndex + 1] : nil
            return SeasonResponse(ok: true, season: season, seasonOver: false, trainingDays: days, dots: days,
                                  totalDots: 91, tierIndex: tierIndex, tier: tiers[tierIndex], nextTier: nextTier,
                                  dotsToNextTier: toTier, dotsToFinish: 91 - days, complete: complete, step: step,
                                  stepsDone: stepsDone, daysToNextStep: toStep, nextScene: nextTier,
                                  badgeStars: stars, nextStar: next)
        }
        switch seasonState {
        case .step2:
            return r(30, tierIndex: 1, step: 2, stepsDone: 4, toStep: 5, toTier: 13, stars: 12,
                     next: NextStar(id: "dangler", name: "Dangler", remaining: 4, unit: "Hands drills"))
        case .lastStep:
            return r(38, tierIndex: 1, step: 3, stepsDone: 5, toStep: 5, toTier: 5, stars: 15,
                     next: NextStar(id: "hattrickweek", name: "Hat Trick Week", remaining: 1, unit: "week with 3 days"))
        case .oneDay:
            return r(50, tierIndex: 2, step: 1, stepsDone: 6, toStep: 1, toTier: 17, stars: 21,
                     next: NextStar(id: "tapetotape", name: "Tape to Tape", remaining: 1, unit: "Passing drill"))
        case .legend:
            return r(91, tierIndex: 3, step: 3, stepsDone: 12, toStep: 0, toTier: 0, stars: 58,
                     next: NextStar(id: "micdup", name: "Mic'd Up", remaining: 12, unit: "cheers for teammates"),
                     complete: true)
        case .longStar:
            return r(30, tierIndex: 1, step: 2, stepsDone: 4, toStep: 5, toTier: 13, stars: 12,
                     next: NextStar(id: "completeplayer", name: "Complete Player", remaining: 15, unit: "drills in every skill"))
        }
    }

    /// One answer per `teamState`. The normal one is the brief's 112 of 150.
    public func team() async throws -> TeamResponse {
        if simulateOffline { throw ThwapAPIError.offline }
        let monday = ThwapDay.mondayOf(date) ?? date
        let (total, mine): (Int, Int) = switch teamState {
        case .normal: (112, 9)
        case .one: (149, 0)
        case .reached: (152, 12)
        }
        return TeamResponse(ok: true, teamName: "Rangers", week: .init(start: monday, end: date),
                            goal: 150, total: total, toGo: max(0, 150 - total), mine: mine)
    }

    public func gameGoals() async throws -> GameGoalsResponse {
        if simulateOffline { throw ThwapAPIError.offline }
        var g = Self.game
        g.date = date
        return GameGoalsResponse(ok: true, playerId: Self.playerId, gameDay: gameDay, game: gameDay ? g : nil,
                                 goals: gameDay ? Self.goals : [], saved: gameDay, savedAt: nil, max: 4)
    }

    public func undoDone(_ request: UndoDoneRequest) async throws -> UndoDoneResponse {
        if simulateOffline { throw ThwapAPIError.offline }
        doneIds.removeAll { $0 == request.drillId }
        return UndoDoneResponse(ok: true, undo: true, drills: doneIds)
    }

    static func rollupCounts(_ ids: [String]) -> [String: Int] {
        var out: [String: Int] = [:]
        for id in ids { if let d = id.split(separator: ":").first { out[String(d), default: 0] += 1 } }
        return out
    }

    public func session() async throws -> SessionResponse {
        if simulateOffline { throw ThwapAPIError.offline }
        return SessionResponse(authed: true, player: .init(id: Self.playerId, name: "Demo Player", number: 0))
    }

    public func todayPlan() async throws -> TodayPlan {
        if simulateOffline { throw ThwapAPIError.offline }
        return TodayPlan(
            date: date,
            playerId: Self.playerId,
            firstName: "Demo",
            drills: Self.drills,
            // On a stub game day the fixture game is moved onto `date`, so the
            // Game Day Goals path is reachable whatever today is.
            game: gameDay ? { var g = Self.game; g.date = date; return g }() : nil,
            gameGoals: gameDay ? Self.goals : [],
            serverGameDay: gameDay
        )
    }

    public func todayDone() async throws -> DoneResponse {
        if simulateOffline { throw ThwapAPIError.offline }
        return DoneResponse(ok: true, player: Self.playerId, date: date, drills: doneIds, disciplines: Self.rollup(doneIds))
    }

    public func markDone(_ request: MarkDoneRequest) async throws -> MarkDoneResponse {
        if simulateOffline { throw ThwapAPIError.offline }
        // Mirror the server's per-drill idempotency guard.
        if doneIds.contains(request.drillId) {
            return MarkDoneResponse(ok: true, duplicate: true, drills: doneIds)
        }
        doneIds.append(request.drillId)
        return MarkDoneResponse(ok: true, duplicate: nil, drills: doneIds)
    }

    /// Same rollup as api/done.js doneDisciplines(): any 'disc:' id marks it.
    static func rollup(_ ids: [String]) -> [String: Bool] {
        var out: [String: Bool] = [:]
        for id in ids {
            if let disc = id.split(separator: ":").first, !disc.isEmpty { out[String(disc)] = true }
        }
        return out
    }

    // MARK: Fixtures

    public static let playerId = "demo"

    public static let drills: [Drill] = [
        Drill(id: "stick:0", discipline: .stick, name: "Stationary Side-to-Side",
              cue: "Move the puck side to side across your body. Quick and smooth.",
              plan: DrillPlan(sets: 4, workSeconds: 20, restSeconds: 15)),
        Drill(id: "stick:1", discipline: .stick, name: "Front-to-Back",
              cue: "Push the puck out in front, then pull it back to your toes.",
              plan: DrillPlan(sets: 4, workSeconds: 20, restSeconds: 15)),
        Drill(id: "stick:2", discipline: .stick, name: "The \"L\" Shape",
              cue: "Push forward, drag back, then push wide to one side.",
              plan: DrillPlan(sets: 4, workSeconds: 30, restSeconds: 15)),
        Drill(id: "shoot:0", discipline: .shoot, name: "Moving Warm-Up",
              cue: "Get comfortable shooting without stopping your feet.",
              plan: DrillPlan(sets: 1, workSeconds: 108, restSeconds: 0)),
        Drill(id: "shoot:1", discipline: .shoot, name: "Change the Angle",
              cue: "Move the puck around something and shoot right away from the new angle.",
              plan: DrillPlan(sets: 4, workSeconds: 80, restSeconds: 15)),
        Drill(id: "shoot:2", discipline: .shoot, name: "Random Target",
              cue: "Start moving before you know where you're shooting.",
              plan: DrillPlan(sets: 4, workSeconds: 40, restSeconds: 15)),
        Drill(id: "dryland:0", discipline: .dryland, name: "Will's Squares (4-sq Drill)",
              cue: "Quick, light hops through the square. Head up. 20 seconds each.", dose: "4 sets of 30",
              plan: DrillPlan(sets: 4, workSeconds: 30, restSeconds: 15)),
        Drill(id: "dryland:1", discipline: .dryland, name: "Skater Jumps",
              cue: "Jump sideways, stick the landing.", dose: "4 sets of 20",
              plan: DrillPlan(sets: 4, workSeconds: 30, restSeconds: 15)),
        Drill(id: "dryland:2", discipline: .dryland, name: "Broad Jumps",
              cue: "Jump forward as far as you can. Land soft.", dose: "4 sets of 8",
              plan: DrillPlan(sets: 4, workSeconds: 24, restSeconds: 15)),
    ]

    public static let game = GameEvent(id: "g-1031", kind: "game", date: "2026-10-31", time: "16:00", opponent: "Tacoma Rockets")

    public static let goals: [GameGoal] = [
        GameGoal(id: "g1", title: "Scan Twice", emoji: "👀", cue: "Have a picture before you get it."),
        GameGoal(id: "g8", title: "Make One Teammate Better", emoji: "🤝", cue: "Help someone have a great game."),
        GameGoal(id: "g14", title: "Win the Next Shift", emoji: "➡️", cue: "Next shift."),
        GameGoal(id: "g26", title: "Drive the Net", emoji: "🏒", cue: "Beat them to the net."),
    ]
}
