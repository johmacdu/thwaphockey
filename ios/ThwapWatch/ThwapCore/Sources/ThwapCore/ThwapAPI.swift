import Foundation

/// The seam the real network client drops into later. Every screen and the
/// check-off queue talk to this protocol only, never to URLSession.
///
/// Endpoint mapping for the real client (from api/login.js and api/done.js):
/// - `session()`        -> GET  /api/login?action=session
/// - `todayDone()`      -> GET  /api/done
/// - `markDone(_:)`     -> POST /api/done { player, discipline, drillId, drillName }
/// - `todayPlan()`      -> no single endpoint yet; the web builds the day's list
///                         client-side from DRILLS / SHOOT_DAYS / WORKOUTS. The
///                         design doc decides whether that moves server-side.
public protocol ThwapAPI: Sendable {
    func session() async throws -> SessionResponse
    func todayPlan() async throws -> TodayPlan
    func todayDone() async throws -> DoneResponse
    func markDone(_ request: MarkDoneRequest) async throws -> MarkDoneResponse
}

public enum ThwapAPIError: Error, Equatable {
    case offline
    case unauthorized
    case server(Int)
}

/// Fixture-backed API. Drill names, cues and timings are copied from the web
/// app (index.html DRILLS, SHOOT_DAYS day 1, WORKOUTS w1wed, THWAP_DRILL_SCRIPT);
/// game goals from hockey_game_goals.html; the game from lib/schedule_store.js.
/// The player is a placeholder, never a real roster kid.
public actor StubThwapAPI: ThwapAPI {
    public var gameDay: Bool
    /// When true every call throws `.offline`, to exercise the queue.
    public var simulateOffline: Bool
    private var doneIds: [String]
    private let date: String

    public init(date: String = "2026-10-31", gameDay: Bool = false, simulateOffline: Bool = false, doneIds: [String] = []) {
        self.date = date
        self.gameDay = gameDay
        self.simulateOffline = simulateOffline
        self.doneIds = doneIds
    }

    public func setOffline(_ offline: Bool) { simulateOffline = offline }
    public func setGameDay(_ on: Bool) { gameDay = on }

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
            gameGoals: gameDay ? Self.goals : []
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
        GameGoal(id: "g1", title: "Scan Twice", tag: "Brain"),
        GameGoal(id: "g8", title: "Make One Teammate Better", tag: "Team"),
        GameGoal(id: "g14", title: "Win the Next Shift", tag: "Lead"),
        GameGoal(id: "g26", title: "Drive the Net", tag: "Attack"),
    ]
}
