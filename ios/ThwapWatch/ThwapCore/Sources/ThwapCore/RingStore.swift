import Foundation

/// Ring snapshot shared between the watch app and the complication through an
/// App Group `UserDefaults` suite. The app writes after every check-off and
/// asks WidgetKit to reload; the complication's timeline provider reads.
public struct RingStore: Sendable {
    public static let appGroup = "group.com.thwaphockey.app"
    static let key = "thwap.rings.v1"

    private let suiteName: String?

    /// `suiteName: nil` uses standard defaults (tests, previews).
    public init(suiteName: String? = RingStore.appGroup) {
        self.suiteName = suiteName
    }

    private var defaults: UserDefaults {
        suiteName.flatMap { UserDefaults(suiteName: $0) } ?? .standard
    }

    public func save(_ snapshot: RingSnapshot) {
        if let data = try? JSONEncoder().encode(snapshot) {
            defaults.set(data, forKey: Self.key)
        }
    }

    /// The stored snapshot, or empty rings when nothing was saved or it no
    /// longer covers `today` (a stale last week must never show as filled).
    public func load(today: String) -> RingSnapshot {
        guard let data = defaults.data(forKey: Self.key),
              let snap = try? JSONDecoder().decode(RingSnapshot.self, from: data),
              snap.isCurrent(today: today) else {
            var empty = RingSnapshot.empty
            empty.date = today
            return empty
        }
        return snap
    }

    public func clear() { defaults.removeObject(forKey: Self.key) }
}

public enum ThwapDay {
    /// Vancouver-local 'YYYY-MM-DD', the same day boundary the server uses
    /// (lib/store localDateStr).
    public static func string(for date: Date = Date()) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "America/Vancouver")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }

    /// The Monday ('YYYY-MM-DD') of the week holding `day`, the server's
    /// Monday-based week (lib/store weekDates). Pure date math on the string,
    /// no time zone involved. Nil for a malformed day.
    public static func mondayOf(_ day: String) -> String? {
        let parts = day.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        guard let d = cal.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])) else { return nil }
        let weekday = cal.component(.weekday, from: d) // 1 = Sunday
        let back = (weekday + 5) % 7                    // days since Monday
        guard let monday = cal.date(byAdding: .day, value: -back, to: d) else { return nil }
        let c = cal.dateComponents([.year, .month, .day], from: monday)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }
}
