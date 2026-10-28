import Foundation

/// Progress for one ring of the complication / Today header.
public struct RingProgress: Codable, Equatable, Sendable {
    public var discipline: Discipline
    public var done: Int
    public var total: Int

    public init(discipline: Discipline, done: Int, total: Int) {
        self.discipline = discipline
        self.done = done
        self.total = total
    }

    /// Fill fraction clamped to 0...1. A discipline with no drills today reads
    /// as empty, never NaN.
    public var fraction: Double {
        guard total > 0 else { return 0 }
        return min(1, max(0, Double(done) / Double(total)))
    }

    public var isClosed: Bool { total > 0 && done >= total }
}

/// The ring snapshot shared by app and complication.
public struct RingSnapshot: Codable, Equatable, Sendable {
    public var date: String
    public var rings: [RingProgress]

    public init(date: String, rings: [RingProgress]) {
        self.date = date
        self.rings = rings
    }

    public static let empty = RingSnapshot(date: "", rings: RingMath.order.map { RingProgress(discipline: $0, done: 0, total: 0) })
}

public enum RingMath {
    /// Outer to inner, matching the web palette order (stick lime, shoot blue,
    /// dryland orange).
    public static let order: [Discipline] = [.stick, .shoot, .dryland]

    /// Build ring progress from today's drills and the set of done ids.
    /// Ids not on today's list are ignored (e.g. the server's name-slug ids
    /// like 'stick#front-to-back' or another day's ids), so a ring can never
    /// overfill. A goalie's netplay drills fill the shoot ring.
    public static func rings(drills: [Drill], doneIds: Set<String>) -> [RingProgress] {
        order.map { disc in
            let mine = drills.filter { slot(for: $0.discipline) == disc }
            let done = mine.filter { doneIds.contains($0.id) }.count
            return RingProgress(discipline: disc, done: done, total: mine.count)
        }
    }

    static func slot(for d: Discipline) -> Discipline {
        d == .netplay ? .shoot : d
    }

    /// Sweep angle in degrees for a fraction (0...360).
    public static func sweepDegrees(_ fraction: Double) -> Double {
        min(1, max(0, fraction)) * 360
    }

    /// Concentric ring geometry: diameter of ring `index` (0 = outer) inside a
    /// square of `size`, given stroke `line` and `gap` between rings.
    public static func diameter(index: Int, size: Double, line: Double, gap: Double) -> Double {
        max(0, size - line - Double(index) * 2 * (line + gap))
    }
}
