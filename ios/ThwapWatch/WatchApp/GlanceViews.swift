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
                    Text(g.tier)
                        .font(.system(.title3, design: .rounded).weight(.heavy))
                        .foregroundStyle(ThwapTheme.lime)
                        .fixedSize(horizontal: false, vertical: true)
                    if g.offSeason {
                        Text(g.countdownLine)
                            .font(.system(.body, design: .rounded).weight(.heavy))
                            .fixedSize(horizontal: false, vertical: true)
                    } else {
                        HStack(spacing: 8) {
                            Text(g.stepLine)
                                .font(.footnote.weight(.bold))
                                .foregroundStyle(ThwapTheme.green2)
                            StepDots(dots: g.dots)
                        }
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(g.stepLine)
                        Text(g.countdownLine)
                            .font(.system(.body, design: .rounded).weight(.heavy))
                            .fixedSize(horizontal: false, vertical: true)
                        if g.starsLine != nil || g.nextStarLine != nil {
                            Divider().overlay(ThwapTheme.line).padding(.vertical, 4)
                        }
                        if let stars = g.starsLine {
                            Text(stars)
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(ThwapTheme.green2)
                        }
                        if let next = g.nextStarLine {
                            Text(next)
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(ThwapTheme.muted)
                                .lineLimit(2)
                                .minimumScaleFactor(0.75)
                        }
                    }
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

/// The three steps inside a scene: filled = done, ringed = the one being
/// worked on, open = not yet.
struct StepDots: View {
    let dots: [SeasonGlance.Dot]

    var body: some View {
        HStack(spacing: 5) {
            ForEach(Array(dots.enumerated()), id: \.offset) { _, dot in
                switch dot {
                case .done:
                    Circle().fill(ThwapTheme.lime).frame(width: 9, height: 9)
                case .current:
                    Circle().fill(ThwapTheme.lime.opacity(0.3))
                        .overlay(Circle().stroke(ThwapTheme.lime, lineWidth: 2))
                        .frame(width: 12, height: 12)
                case .open:
                    Circle().stroke(ThwapTheme.muted, lineWidth: 1.5).frame(width: 9, height: 9)
                }
            }
        }
        .accessibilityHidden(true)
    }
}

struct TeamView: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 6) {
                if let g = model.team {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(TeamGlance.eyebrow)
                            .font(.caption2.weight(.heavy))
                            .foregroundStyle(ThwapTheme.muted)
                        Text(g.countLine)
                            .font(.system(.title3, design: .rounded).weight(.heavy))
                            .foregroundStyle(ThwapTheme.lime)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                        GoalBar(fraction: g.fraction)
                            .frame(height: 8)
                        Text(g.toGoLine)
                            .font(.system(.body, design: .rounded).weight(.heavy))
                            .fixedSize(horizontal: false, vertical: true)
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
