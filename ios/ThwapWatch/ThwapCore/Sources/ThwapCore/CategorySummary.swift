import Foundation

extension Discipline {
    /// The category name on the watch home, matching the website's category
    /// titles (Hands, Shooting, Net play, Dryland).
    public var categoryTitle: String {
        switch self {
        case .stick: return "Hands"
        case .shoot: return "Shooting"
        case .netplay: return "Net play"
        case .dryland: return "Dryland"
        case .iq: return "Hockey IQ"
        case .pass: return "Passing"
        }
    }
}

extension Drill {
    /// The dose line under a drill name in a category list. The server's own
    /// dose wins; otherwise it is read off the timer plan ("4 sets of 40 sec").
    public var doseLine: String {
        if let dose, !dose.isEmpty { return dose }
        let length = Self.duration(plan.workSeconds)
        return plan.sets > 1 ? "\(plan.sets) sets of \(length)" : length
    }

    /// "40 sec", "2 min", "1 min 48 sec".
    static func duration(_ seconds: Int) -> String {
        if seconds < 60 { return "\(seconds) sec" }
        let m = seconds / 60, s = seconds % 60
        return s == 0 ? "\(m) min" : "\(m) min \(s) sec"
    }
}

/// One category of today's list, for the watch home: one page per category,
/// a Start button that runs the next drill not done yet, and a drill list.
/// Built from `TodayPlan` and the done ids, so the views stay thin.
public struct CategorySummary: Identifiable, Equatable, Sendable {
    public var discipline: Discipline
    /// This category's drills, in the order the plan lists them.
    public var drills: [Drill]
    public var doneIds: Set<String>

    public init(discipline: Discipline, drills: [Drill], doneIds: Set<String>) {
        self.discipline = discipline
        self.drills = drills
        self.doneIds = doneIds.intersection(drills.map(\.id))
    }

    public var id: String { discipline.rawValue }
    public var title: String { discipline.categoryTitle }
    public var total: Int { drills.count }
    public var doneCount: Int { drills.filter { doneIds.contains($0.id) }.count }
    public var isComplete: Bool { total > 0 && doneCount == total }

    public func isDone(_ drill: Drill) -> Bool { doneIds.contains(drill.id) }

    /// The first drill in list order that is not done yet; nil when all are.
    public var nextDrill: Drill? { drills.first { !doneIds.contains($0.id) } }

    /// Progress bar fill, 0...1.
    public var fraction: Double { total > 0 ? Double(doneCount) / Double(total) : 0 }

    /// "0 of 3 done" on the category page, or "All done!" once finished.
    public var progressLine: String { isComplete ? Self.allDone : countLine }

    /// "2 of 3 done", the drill list header.
    public var countLine: String { "\(doneCount) of \(total) done" }

    /// "2/3", the small tile on the hello page.
    public var tileLine: String { "\(doneCount)/\(total)" }

    /// VoiceOver for the category page header: "Shooting, 0 of 3 done".
    public var accessibilityLine: String { "\(title), \(countLine)" }

    public static let allDone = "All done!"

    /// One summary per category in today's list, in the order each category
    /// first appears, so the web's Hands, Shooting, Dryland order is kept and
    /// a weekend list (bonus drills only) gives just its two categories.
    public static func build(drills: [Drill], doneIds: Set<String>) -> [CategorySummary] {
        var order: [Discipline] = []
        var byDisc: [Discipline: [Drill]] = [:]
        for d in drills {
            if byDisc[d.discipline] == nil { order.append(d.discipline) }
            byDisc[d.discipline, default: []].append(d)
        }
        return order.map { CategorySummary(discipline: $0, drills: byDisc[$0] ?? [], doneIds: doneIds) }
    }
}

extension TodayPlan {
    /// Today's categories with progress.
    public func categories(doneIds: Set<String>) -> [CategorySummary] {
        CategorySummary.build(drills: drills, doneIds: doneIds)
    }
}
