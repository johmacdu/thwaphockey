import Foundation

// Wire shapes for the endpoints the watch calls, copied field for field from
// the server handlers. Unknown fields are ignored by Codable, so a server that
// adds a field never breaks the watch.

// MARK: - Sign-in (api/login.js)

/// `POST /api/login?action=watch-request` body: `{ teamCode, code, deviceLabel }`.
/// `code` is the player code (jersey number + season year, e.g. 722027). The
/// team code is not case sensitive; the server upper-cases it.
public struct WatchRequestBody: Codable, Equatable, Sendable {
    public var teamCode: String
    public var code: String
    public var deviceLabel: String

    public init(teamCode: String, code: String, deviceLabel: String) {
        self.teamCode = teamCode
        self.code = code
        self.deviceLabel = deviceLabel
    }
}

/// `200 { ok, requestId, sent }`. `sent` is true when at least one parent
/// email went out. `401 { error: 'bad code' }` for a wrong team or player code.
public struct WatchRequestResponse: Codable, Equatable, Sendable {
    public var ok: Bool
    public var requestId: String
    public var sent: Bool
}

/// `GET /api/login?action=watch-status&requestId=` ->
/// `{ status: 'pending'|'approved'|'denied'|'expired', token?, exp?, player? }`.
/// The token comes back exactly once; the next poll reads 'expired'.
public struct WatchStatusResponse: Codable, Equatable, Sendable {
    public enum Status: String, Codable, Sendable {
        case pending, approved, denied, expired
    }

    public var status: Status
    public var token: String?
    public var exp: Double?
    public var player: SessionResponse.Player?

    public init(status: Status, token: String? = nil, exp: Double? = nil, player: SessionResponse.Player? = nil) {
        self.status = status
        self.token = token
        self.exp = exp
        self.player = player
    }

    /// An unknown status string (a newer server) reads as pending, so the
    /// watch keeps waiting instead of failing to decode.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let raw = try c.decode(String.self, forKey: .status)
        status = Status(rawValue: raw) ?? .pending
        token = try c.decodeIfPresent(String.self, forKey: .token)
        exp = try c.decodeIfPresent(Double.self, forKey: .exp)
        player = try c.decodeIfPresent(SessionResponse.Player.self, forKey: .player)
    }
}

/// `POST /api/login?action=logout` -> `{ ok }`.
public struct OKResponse: Codable, Equatable, Sendable {
    public var ok: Bool
}

/// Any `{ error }` body (400/401/402/403/429).
public struct ErrorBody: Codable, Equatable, Sendable {
    public var error: String
    public var reason: String?
    public var gated: Bool?
}

// MARK: - Today (api/done.js ?view=today)

/// `{ ok, date, restDay, bonusDay?, goalie, drills:[ServerDrill] }`. On a
/// weekend `restDay` is true (dryland rests) and `bonusDay` is true when the
/// web's optional Hands / third-discipline drills are in the list. An older
/// server omits `bonusDay`.
public struct TodayViewResponse: Codable, Equatable, Sendable {
    public var ok: Bool
    public var date: String
    public var restDay: Bool
    public var bonusDay: Bool?
    public var goalie: Bool
    public var drills: [ServerDrill]
}

/// One drill from lib/drills.js todayList. `timer` is null for a drill with no
/// guided script.
public struct ServerDrill: Codable, Equatable, Sendable {
    public struct Timer: Codable, Equatable, Sendable {
        public var type: String
        public var sets: Int
        public var workSeconds: Int
        public var restSeconds: Int
        public var totalSeconds: Int?
    }

    public var id: String
    public var discipline: String
    public var name: String
    public var dose: String?
    public var cue: String?
    public var steps: [String]?
    public var timer: Timer?
    /// True on a weekend bonus drill (optional, like the web's weekend reps).
    public var bonus: Bool?
    public var done: Bool

    /// Fallback length for a drill the server sends without a timer: one
    /// minute, one set, so the run screen still has something to count.
    public static let untimedPlan = DrillPlan(sets: 1, workSeconds: 60, restSeconds: 0)

    /// The watch model. Returns nil for a discipline this build does not know,
    /// so a new server discipline is skipped rather than crashing the list.
    public var drill: Drill? {
        guard let disc = Discipline(rawValue: discipline) else { return nil }
        let plan = timer.map { DrillPlan(sets: $0.sets, workSeconds: $0.workSeconds, restSeconds: $0.restSeconds) }
            ?? Self.untimedPlan
        return Drill(id: id, discipline: disc, name: name, cue: cue ?? "", dose: dose, plan: plan)
    }
}

// MARK: - Rings (api/done.js ?view=rings)

/// `{ ok, week:{start,end}, goalie, rings:{ stick:{done,goal}, shoot|netplay:{done,goal}, dryland:{done,goal} } }`.
public struct RingsResponse: Codable, Equatable, Sendable {
    public struct Week: Codable, Equatable, Sendable {
        public var start: String
        public var end: String
    }

    public struct Ring: Codable, Equatable, Sendable {
        public var done: Int
        public var goal: Int
    }

    public var ok: Bool
    public var week: Week
    public var goalie: Bool
    public var rings: [String: Ring]

    /// Outer to inner: stick, shoot (netplay for a goalie), dryland. `done`
    /// can pass the goal on the server; the ring clamps the fill, the number
    /// stays true.
    public func snapshot(today: String) -> RingSnapshot {
        let third: Discipline = goalie ? .netplay : .shoot
        let order: [Discipline] = [.stick, third, .dryland]
        let list = order.map { d -> RingProgress in
            let r = rings[d.rawValue] ?? (d == .netplay ? rings["shoot"] : nil)
            return RingProgress(discipline: d, done: r?.done ?? 0, total: r?.goal ?? 0)
        }
        return RingSnapshot(date: today, rings: list, weekStart: week.start)
    }
}

// MARK: - Game Day Goals (api/coach.js ?action=my-game-goals)

/// `{ ok, playerId, gameDay, game, goals:[{id,title,emoji,cue}], saved, savedAt, teamGoal, max }`.
public struct GameGoalsResponse: Codable, Equatable, Sendable {
    public var ok: Bool
    public var playerId: String
    public var gameDay: Bool
    public var game: GameEvent?
    public var goals: [GameGoal]
    public var saved: Bool?
    public var savedAt: String?
    public var max: Int?
}

// MARK: - My Season (api/done.js ?view=season)

/// `{ ok, season:{key,label,start,end}, seasonOver, trainingDays, dots, totalDots,
/// tierIndex, tier, nextTier, dotsToNextTier, dotsToFinish, complete, step,
/// stepsDone, daysToNextStep, nextScene, badgeStars, nextStar }`, from
/// lib/season_book.js, the same book and badges journey.html shows. The step
/// and badge fields are optional so an older deploy still decodes.
public struct SeasonResponse: Codable, Equatable, Sendable {
    public struct Season: Codable, Equatable, Sendable {
        public var key: String
        public var label: String
        public var start: String
        public var end: String
    }

    public var ok: Bool
    public var season: Season
    public var seasonOver: Bool
    public var trainingDays: Int
    public var dots: Int
    public var totalDots: Int
    public var tierIndex: Int
    public var tier: String
    /// nil in Legend, the top scene.
    public var nextTier: String?
    public var dotsToNextTier: Int
    public var dotsToFinish: Int
    public var complete: Bool
    /// 1...3 inside the scene.
    public var step: Int?
    /// 0...12 across the path.
    public var stepsDone: Int?
    public var daysToNextStep: Int?
    public var nextScene: String?
    public var badgeStars: Int?
    public var nextStar: NextStar?

    public init(ok: Bool, season: Season, seasonOver: Bool, trainingDays: Int, dots: Int, totalDots: Int,
                tierIndex: Int, tier: String, nextTier: String?, dotsToNextTier: Int, dotsToFinish: Int,
                complete: Bool, step: Int? = nil, stepsDone: Int? = nil, daysToNextStep: Int? = nil,
                nextScene: String? = nil, badgeStars: Int? = nil, nextStar: NextStar? = nil) {
        self.ok = ok
        self.season = season
        self.seasonOver = seasonOver
        self.trainingDays = trainingDays
        self.dots = dots
        self.totalDots = totalDots
        self.tierIndex = tierIndex
        self.tier = tier
        self.nextTier = nextTier
        self.dotsToNextTier = dotsToNextTier
        self.dotsToFinish = dotsToFinish
        self.complete = complete
        self.step = step
        self.stepsDone = stepsDone
        self.daysToNextStep = daysToNextStep
        self.nextScene = nextScene
        self.badgeStars = badgeStars
        self.nextStar = nextStar
    }

    public var glance: SeasonGlance {
        SeasonGlance(tier: tier, step: step ?? 1, stepsDone: stepsDone ?? tierIndex * SeasonGlance.stepsPerScene,
                     daysToNextStep: daysToNextStep ?? dotsToNextTier, nextScene: nextScene ?? nextTier,
                     complete: complete, seasonOver: seasonOver, badgeStars: badgeStars, nextStar: nextStar)
    }
}

// MARK: - Team (api/done.js ?view=team)

/// `{ ok, teamName, week:{start,end}, goal, total, toGo, mine }`: this week's
/// team goal, the same numbers the Standings bar shows. No player list.
public struct TeamResponse: Codable, Equatable, Sendable {
    public struct Week: Codable, Equatable, Sendable {
        public var start: String
        public var end: String
    }

    public var ok: Bool
    public var teamName: String
    public var week: Week
    public var goal: Int
    public var total: Int
    public var toGo: Int
    public var mine: Int

    public var glance: TeamGlance {
        TeamGlance(teamName: teamName, goal: goal, total: total, toGo: toGo, mine: mine)
    }
}
