import Foundation

/// The training disciplines, keyed exactly like the server (`lib/store.js`
/// DISCIPLINES). The watch v1 renders the radar triad only: stick, shoot (or
/// netplay for goalies), dryland. iq/pass are decoded so a real response never
/// fails to parse, but they are not shown on the watch yet.
public enum Discipline: String, Codable, CaseIterable, Sendable {
    case stick, shoot, dryland, netplay, iq, pass

    /// Kid-facing label (matches the web nav labels).
    public var label: String {
        switch self {
        case .stick: return "Stickhandling"
        case .shoot: return "Shooting"
        case .dryland: return "Dryland"
        case .netplay: return "Net play"
        case .iq: return "Hockey IQ"
        case .pass: return "Passing"
        }
    }
}

/// Timing for the guided drill runner. Derived from the web app's
/// `THWAP_DRILL_SCRIPT` (index.html): `workSeconds` = reps x perRep x sides for
/// 'reps' drills, shots x everySeconds for 'callout' drills.
public struct DrillPlan: Codable, Equatable, Sendable {
    public var sets: Int
    public var workSeconds: Int
    public var restSeconds: Int

    public init(sets: Int, workSeconds: Int, restSeconds: Int) {
        self.sets = max(1, sets)
        self.workSeconds = max(1, workSeconds)
        self.restSeconds = max(0, restSeconds)
    }
}

/// One drill on today's list. `id` is the positional id the web client posts
/// to `/api/done` ('<disc>:<index>', e.g. 'stick:0'), so a check-off from the
/// watch and one from the phone land on the same server key.
public struct Drill: Codable, Identifiable, Equatable, Sendable {
    public var id: String
    public var discipline: Discipline
    public var name: String
    public var cue: String
    public var dose: String?
    public var plan: DrillPlan

    public init(id: String, discipline: Discipline, name: String, cue: String, dose: String? = nil, plan: DrillPlan) {
        self.id = id
        self.discipline = discipline
        self.name = name
        self.cue = cue
        self.dose = dose
        self.plan = plan
    }
}

/// A Game Day Goal the kid picked on the web (hockey_game_goals.html). Read-only
/// on the watch. Mirrors `GET /api/coach?action=my-game-goals` goals[]:
/// `{ id, title, emoji, cue }`.
public struct GameGoal: Codable, Identifiable, Equatable, Sendable {
    public var id: String
    public var title: String
    public var emoji: String?
    public var cue: String?

    public init(id: String, title: String, emoji: String? = nil, cue: String? = nil) {
        self.id = id
        self.title = title
        self.emoji = emoji
        self.cue = cue
    }
}

/// A scheduled game, mirroring `lib/schedule_store.js` events.
public struct GameEvent: Codable, Equatable, Sendable {
    public var id: String
    public var kind: String          // 'game' | 'tournament'
    public var date: String          // 'YYYY-MM-DD' (Vancouver local)
    public var endDate: String?
    public var time: String?
    public var opponent: String?
    public var home: Bool?
    public var place: String?

    public init(id: String, kind: String, date: String, endDate: String? = nil, time: String? = nil,
                opponent: String? = nil, home: Bool? = nil, place: String? = nil) {
        self.id = id
        self.kind = kind
        self.date = date
        self.endDate = endDate
        self.time = time
        self.opponent = opponent
        self.home = home
        self.place = place
    }

    /// True when `day` ('YYYY-MM-DD') is this event's date or inside a
    /// tournament's date range. String compare is safe for ISO dates.
    public func covers(day: String) -> Bool {
        if day == date { return true }
        if let end = endDate { return day >= date && day <= end }
        return false
    }
}

// MARK: - Wire shapes (mirror the real JSON)

/// `GET /api/login?action=session` -> `{ authed, player? }`.
public struct SessionResponse: Codable, Equatable, Sendable {
    public struct Player: Codable, Equatable, Sendable {
        public var id: String
        public var name: String?
        public var number: Int?

        public init(id: String, name: String? = nil, number: Int? = nil) {
            self.id = id
            self.name = name
            self.number = number
        }
    }
    public var authed: Bool
    public var player: Player?
}

/// `GET /api/done` -> `{ ok, player, date, drills: [String], disciplines: {disc: true} }`.
public struct DoneResponse: Codable, Equatable, Sendable {
    public var ok: Bool
    public var player: String
    public var date: String?
    public var drills: [String]
    public var disciplines: [String: Bool]
}

/// `POST /api/done` body for a mark: `{ player, discipline, drillId, drillName?, date? }`.
/// `date` is only sent for a check-off made on an earlier day (offline at the
/// rink, synced the next morning); the server accepts up to 7 days back.
public struct MarkDoneRequest: Codable, Equatable, Hashable, Sendable {
    public var player: String
    public var discipline: String
    public var drillId: String
    public var drillName: String?
    public var date: String?

    public init(player: String, discipline: String, drillId: String, drillName: String?, date: String? = nil) {
        self.player = player
        self.discipline = discipline
        self.drillId = drillId
        self.drillName = drillName
        self.date = date
    }
}

/// `POST /api/done` body for an undo: `{ player, drillId, undo: true }`. The
/// server undo always acts on today and never lowers the earned count.
public struct UndoDoneRequest: Codable, Equatable, Sendable {
    public var player: String
    public var drillId: String
    public var undo: Bool = true

    public init(player: String, drillId: String) {
        self.player = player
        self.drillId = drillId
    }
}

/// `POST /api/done` undo response: `{ ok, undo: true, drills }`.
public struct UndoDoneResponse: Codable, Equatable, Sendable {
    public var ok: Bool
    public var undo: Bool?
    public var drills: [String]?
}

/// `POST /api/done` mark response: `{ player?, ok?, duplicate?, drills? }`.
/// The bump path returns `{ player: {...} }`; the drill path and the duplicate
/// guard return `{ ok, drills }`. Only `drills` matters to the watch.
public struct MarkDoneResponse: Codable, Equatable, Sendable {
    public var ok: Bool?
    public var duplicate: Bool?
    public var drills: [String]?
}

/// Everything the watch needs for one day.
public struct TodayPlan: Equatable, Sendable {
    public var date: String
    public var playerId: String
    public var firstName: String
    public var drills: [Drill]
    public var game: GameEvent?
    public var gameGoals: [GameGoal]
    public var restDay: Bool
    /// The server's own game-day verdict (`my-game-goals` gameDay). When nil
    /// (stub, or the goals read failed) the game's date decides.
    public var serverGameDay: Bool?

    public init(date: String, playerId: String, firstName: String, drills: [Drill], game: GameEvent?,
                gameGoals: [GameGoal], restDay: Bool = false, serverGameDay: Bool? = nil) {
        self.date = date
        self.playerId = playerId
        self.firstName = firstName
        self.drills = drills
        self.game = game
        self.gameGoals = gameGoals
        self.restDay = restDay
        self.serverGameDay = serverGameDay
    }

    /// Game Day Goals show only when a game or tournament covers today.
    public var isGameDay: Bool { serverGameDay ?? (game?.covers(day: date) ?? false) }
}
