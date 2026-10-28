import SwiftUI
import ThwapCore

/// Screen 4: the Game Day Goals the kid picked on the web. Read-only, so plain
/// rows with hairlines, no cards. Only reachable on a game day.
struct GameGoalsView: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if let game = model.plan?.game, let opp = game.opponent {
                    Text("vs \(opp)")
                        .font(.footnote.weight(.bold))
                        .foregroundStyle(ThwapTheme.green2)
                        .padding(.bottom, 6)
                }
                let goals = model.plan?.gameGoals ?? []
                if goals.isEmpty {
                    Text("Pick your goals on your phone.")
                        .font(.footnote)
                        .foregroundStyle(ThwapTheme.muted)
                }
                ForEach(Array(goals.enumerated()), id: \.element.id) { i, goal in
                    if i > 0 { Divider().overlay(ThwapTheme.line) }
                    VStack(alignment: .leading, spacing: 1) {
                        Text(goal.title)
                            .font(.system(.body, design: .rounded).weight(.heavy))
                            .fixedSize(horizontal: false, vertical: true)
                        Text(goal.tag.uppercased())
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(ThwapTheme.muted)
                    }
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityElement(children: .combine)
                }
            }
            .padding(.horizontal, 6)
        }
        .background(ThwapTheme.bg)
        .navigationTitle("Game plan")
    }
}
