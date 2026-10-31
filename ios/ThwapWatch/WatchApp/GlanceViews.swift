import SwiftUI
import ThwapCore

/// The two glance screens off Today: where the kid is on the season path, and
/// the team goal. Read-only, so plain text with hairlines, no cards. A failed
/// read shows one quiet line and never touches the drill list.
enum GlanceScreen: Hashable {
    case season, team
}

struct SeasonView: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 6) {
                if let g = model.season {
                    Text("YOU'RE IN")
                        .font(.caption2.weight(.heavy))
                        .foregroundStyle(ThwapTheme.muted)
                    Text(g.tier)
                        .font(.system(.title3, design: .rounded).weight(.heavy))
                        .foregroundStyle(ThwapTheme.lime)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(g.nextLine)
                        .font(.system(.body, design: .rounded).weight(.heavy))
                        .fixedSize(horizontal: false, vertical: true)
                    if let finish = g.finishLine {
                        Text(finish)
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(ThwapTheme.green2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Divider().overlay(ThwapTheme.line).padding(.vertical, 4)
                    Text(g.totalLine)
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(ThwapTheme.muted)
                } else {
                    GlanceWaiting(failed: model.seasonFailed)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 6)
            .accessibilityElement(children: .combine)
        }
        .background(ThwapTheme.bg)
        .navigationTitle("My Season")
        .task { await model.refreshGlance() }
    }
}

struct TeamView: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 6) {
                if let g = model.team {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(g.teamName.uppercased() + " THIS WEEK")
                            .font(.caption2.weight(.heavy))
                            .foregroundStyle(ThwapTheme.muted)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                        Text(g.countLine)
                            .font(.system(.title3, design: .rounded).weight(.heavy))
                            .foregroundStyle(ThwapTheme.lime)
                        GoalBar(fraction: g.fraction)
                            .frame(height: 8)
                        Text(g.toGoLine)
                            .font(.system(.body, design: .rounded).weight(.heavy))
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(g.goalLine)
                    Divider().overlay(ThwapTheme.line).padding(.vertical, 4)
                    Text(g.mineLine)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(ThwapTheme.green2)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    GlanceWaiting(failed: model.teamFailed)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 6)
        }
        .background(ThwapTheme.bg)
        .navigationTitle("Team")
        .task { await model.refreshGlance() }
    }
}

/// The team bar: a lime fill on the panel color.
struct GoalBar: View {
    let fraction: Double

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(ThwapTheme.panel)
                Capsule().fill(ThwapTheme.lime)
                    .frame(width: max(0, min(1, fraction)) * geo.size.width)
            }
        }
        .accessibilityHidden(true)
    }
}

private struct GlanceWaiting: View {
    let failed: Bool

    var body: some View {
        if failed {
            Text("No signal. Try again soon.")
                .font(.footnote)
                .foregroundStyle(ThwapTheme.muted)
        } else {
            ProgressView()
                .frame(maxWidth: .infinity)
        }
    }
}
