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

    /// The stored snapshot, or empty rings when nothing was saved or the saved
    /// day is not `today` (a stale yesterday must never show as filled).
    public func load(today: String) -> RingSnapshot {
        guard let data = defaults.data(forKey: Self.key),
              let snap = try? JSONDecoder().decode(RingSnapshot.self, from: data),
              snap.date == today else {
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
}
