import SwiftUI
import WidgetKit
import ThwapCore

/// Complication: today's three rings (stick, shoot, dryland) read from the App
/// Group snapshot the watch app writes after every check-off.
struct RingEntry: TimelineEntry {
    let date: Date
    let snapshot: RingSnapshot
}

struct RingProvider: TimelineProvider {
    private let store = RingStore()

    func placeholder(in context: Context) -> RingEntry {
        RingEntry(date: Date(), snapshot: Self.sample)
    }

    func getSnapshot(in context: Context, completion: @escaping (RingEntry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : current())
    }

    /// One entry now, plus an empty-rings entry at the next Vancouver midnight
    /// so yesterday's full rings never linger on the face. The app also
    /// reloads timelines on every check-off.
    func getTimeline(in context: Context, completion: @escaping (Timeline<RingEntry>) -> Void) {
        let now = current()
        var entries = [now]
        if let midnight = Self.nextVancouverMidnight(after: now.date) {
            let day = ThwapDay.string(for: midnight)
            entries.append(RingEntry(date: midnight, snapshot: store.load(today: day)))
        }
        completion(Timeline(entries: entries, policy: .atEnd))
    }

    private func current() -> RingEntry {
        RingEntry(date: Date(), snapshot: store.load(today: ThwapDay.string()))
    }

    static func nextVancouverMidnight(after date: Date) -> Date? {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "America/Vancouver") ?? .current
        return cal.nextDate(after: date, matching: DateComponents(hour: 0, minute: 0, second: 5), matchingPolicy: .nextTime)
    }

    static let sample = RingSnapshot(date: "", rings: [
        RingProgress(discipline: .stick, done: 2, total: 3),
        RingProgress(discipline: .shoot, done: 1, total: 3),
        RingProgress(discipline: .dryland, done: 3, total: 3),
    ])
}

struct RingComplicationView: View {
    @Environment(\.widgetFamily) private var family
    let entry: RingEntry

    var body: some View {
        switch family {
        case .accessoryRectangular:
            rectangular
        default:
            ConcentricRings(rings: entry.snapshot.rings, line: 4.5, gap: 1.5)
                .padding(2)
                .widgetAccentable()
        }
    }

    private var rectangular: some View {
        HStack(spacing: 6) {
            ConcentricRings(rings: entry.snapshot.rings, line: 3.5, gap: 1)
                .frame(width: 40, height: 40)
                .widgetAccentable()
            VStack(alignment: .leading, spacing: 0) {
                Text("THWAP")
                    .font(.system(.headline, design: .rounded).weight(.black))
                    .widgetAccentable()
                ForEach(entry.snapshot.rings, id: \.discipline) { r in
                    Text("\(r.discipline.label) \(r.done)/\(r.total)")
                        .font(.caption2)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Thwap today. " + ConcentricRings.label(entry.snapshot.rings))
    }
}

@main
struct ThwapComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ThwapRings", provider: RingProvider()) { entry in
            RingComplicationView(entry: entry)
                .containerBackground(ThwapTheme.bg, for: .widget)
        }
        .configurationDisplayName("Thwap rings")
        .description("Today's stickhandling, shooting and dryland.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular])
    }
}
