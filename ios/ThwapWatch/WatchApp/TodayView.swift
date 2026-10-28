import SwiftUI
import ThwapCore

/// Screen 1: today's drills as a chunky checklist (the web's expandable-tile
/// checklist, not cards). Each row is a big discipline-colored tap target; a
/// done row turns lime with a check.
struct TodayView: View {
    @EnvironmentObject var model: AppModel
    @Binding var showGoals: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                header
                if model.plan?.isGameDay == true {
                    gameDayLink
                }
                if let plan = model.plan {
                    ForEach(plan.drills) { drill in
                        DrillRow(drill: drill, done: model.isDone(drill)) {
                            if !model.isDone(drill) { model.running = drill }
                        }
                    }
                } else if model.loadFailed {
                    Text("No signal. Try again at the rink.")
                        .font(.footnote)
                        .foregroundStyle(ThwapTheme.muted)
                } else {
                    ProgressView()
                }
            }
            .padding(.horizontal, 4)
        }
        .background(ThwapTheme.bg)
        .navigationTitle("Today")
    }

    private var header: some View {
        HStack(spacing: 8) {
            ConcentricRings(rings: model.rings, line: 4, gap: 1.5)
                .frame(width: 40, height: 40)
            VStack(alignment: .leading, spacing: 0) {
                Text("Hey \(model.plan?.firstName ?? "there") 👋")
                    .font(.headline)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Text(model.toGo == 0 ? "All done today!" : "\(model.toGo) to go")
                    .font(.footnote)
                    .foregroundStyle(ThwapTheme.green2)
            }
        }
        .accessibilityElement(children: .combine)
        .padding(.bottom, 2)
    }

    private var gameDayLink: some View {
        Button { showGoals = true } label: {
            HStack {
                Text("🎯")
                Text("Game day goals")
                    .font(.headline)
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.footnote)
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        }
        .accessibilityHint("Shows the goals you picked for today's game")
    }
}

struct DrillRow: View {
    let drill: Drill
    let done: Bool
    let action: () -> Void

    var body: some View {
        let accent = ThwapTheme.color(drill.discipline)
        Button(action: action) {
            HStack(spacing: 8) {
                ZStack {
                    Circle()
                        .strokeBorder(done ? ThwapTheme.ink : accent, lineWidth: 2.5)
                        .background(Circle().fill(done ? ThwapTheme.ink : .clear))
                    if done {
                        Image(systemName: "checkmark")
                            .font(.system(size: 13, weight: .black))
                            .foregroundStyle(ThwapTheme.lime)
                    }
                }
                .frame(width: 24, height: 24)
                VStack(alignment: .leading, spacing: 1) {
                    Text(drill.name)
                        .font(.system(.body, design: .rounded).weight(.heavy))
                        .foregroundStyle(done ? ThwapTheme.ink : .white)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(done ? "Done!" : drill.discipline.label)
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(done ? ThwapTheme.ink.opacity(0.75) : accent)
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 10)
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(done ? ThwapTheme.lime : accent.opacity(0.22))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(done ? ThwapTheme.lime : accent, lineWidth: 2)
            )
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(drill.name), \(drill.discipline.label)")
        .accessibilityValue(done ? "Done" : "Not done yet")
        .accessibilityHint(done ? "" : "Starts the drill timer")
        .accessibilityAddTraits(done ? [.isButton, .isSelected] : .isButton)
    }
}
