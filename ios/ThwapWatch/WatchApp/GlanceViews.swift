import SwiftUI
import ThwapCore

/// The My Season and Team pages of the home pager: where the kid is on the
/// season path, and the team goal. Read-only, so plain text with a hairline,
/// no cards. A failed read shows one quiet line and never touches the drills.
struct SeasonPage: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        PageFrame {
            Eyebrow(text: "My Season")
                .padding(.top, 16)
            if let g = model.season {
                Text(g.tier)
                    .font(ThwapTheme.display(26, relativeTo: .title2))
                    .foregroundStyle(ThwapTheme.ice)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .layoutPriority(1)
                    .padding(.top, 4)
                if g.offSeason {
                    Text(g.countdownLine)
                        .font(ThwapTheme.body(15))
                        .foregroundStyle(ThwapTheme.ice)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 8)
                } else {
                    HStack(spacing: 6) {
                        StepDots(dots: g.dots)
                        Text(g.stepLine)
                            .font(ThwapTheme.body(14, .black))
                            .foregroundStyle(ThwapTheme.text2)
                            .padding(.leading, 4)
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(g.stepLine)
                    .padding(.top, 10)
                    Text(g.countdownLine)
                        .font(ThwapTheme.body(15))
                        .foregroundStyle(ThwapTheme.ice)
                        .lineLimit(2)
                        .minimumScaleFactor(0.85)
                        .layoutPriority(1)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 8)
                    if g.starsLine != nil || g.nextStarLine != nil {
                        Rectangle().fill(ThwapTheme.line).frame(height: 1)
                            .padding(.vertical, 12)
                    }
                    if let stars = g.starsLine {
                        Text(stars)
                            .font(ThwapTheme.body(14, .black))
                            .foregroundStyle(ThwapTheme.green2)
                            .lineLimit(1)
                    }
                    if let next = g.nextStarLine {
                        Text(next)
                            .font(ThwapTheme.body(12, .bold, relativeTo: .caption))
                            .foregroundStyle(ThwapTheme.muted)
                            .lineLimit(2)
                            .minimumScaleFactor(0.85)
                            .layoutPriority(1)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, 4)
                    }
                }
            } else {
                GlanceWaiting(failed: model.seasonFailed)
                    .padding(.top, 8)
            }
            Spacer(minLength: 0).layoutPriority(-1)
        }
        .accessibilityElement(children: .combine)
    }
}

/// The three steps inside a scene: filled lime = done, lime ring = the one
/// being worked on, muted ring = not yet.
struct StepDots: View {
    let dots: [SeasonGlance.Dot]

    var body: some View {
        HStack(spacing: 6) {
            ForEach(Array(dots.enumerated()), id: \.offset) { _, dot in
                switch dot {
                case .done:
                    Circle().fill(ThwapTheme.lime)
                case .current:
                    Circle().strokeBorder(ThwapTheme.lime, lineWidth: 3)
                case .open:
                    Circle().strokeBorder(ThwapTheme.muted, lineWidth: 2.5)
                }
            }
            .frame(width: 14, height: 14)
        }
        .accessibilityHidden(true)
    }
}

struct TeamPage: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        PageFrame {
            Eyebrow(text: TeamGlance.eyebrow)
                .padding(.top, 16)
            if let g = model.team {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text("\(g.total)")
                            .font(ThwapTheme.display(30, relativeTo: .title))
                            .foregroundStyle(ThwapTheme.ice)
                        Text("of \(g.goal)")
                            .font(ThwapTheme.display(18, relativeTo: .headline))
                            .foregroundStyle(ThwapTheme.muted)
                    }
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .layoutPriority(1)
                    .padding(.top, 4)
                    ProgressBar(fraction: g.fraction, color: ThwapTheme.lime)
                        .frame(height: 10)
                        .padding(.top, 12)
                        .animation(reduceMotion ? nil : .easeOut(duration: 0.3), value: g.fraction)
                    Text(g.toGoLine)
                        .font(ThwapTheme.body(15))
                        .foregroundStyle(ThwapTheme.ice)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                        .layoutPriority(1)
                        .padding(.top, 10)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(g.goalLine)
                Rectangle().fill(ThwapTheme.line).frame(height: 1)
                    .padding(.vertical, 12)
                Text(g.mineLine)
                    .font(ThwapTheme.body(14))
                    .foregroundStyle(ThwapTheme.green2)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                GlanceWaiting(failed: model.teamFailed)
                    .padding(.top, 8)
            }
            Spacer(minLength: 0).layoutPriority(-1)
        }
    }
}

private struct GlanceWaiting: View {
    let failed: Bool

    var body: some View {
        if failed {
            Text("No signal. Try again soon.")
                .font(ThwapTheme.body(14, .bold))
                .foregroundStyle(ThwapTheme.muted)
        } else {
            ProgressView()
                .frame(maxWidth: .infinity)
        }
    }
}
