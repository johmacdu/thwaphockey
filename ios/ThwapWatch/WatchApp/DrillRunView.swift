import SwiftUI
import Combine
import ThwapCore

/// Screen 2: the drill running. Countdown ring, drill name, one big Done.
/// Elapsed time comes from a start Date, not from counting ticks, so the
/// countdown stays right if the screen sleeps; `DrillTimer.events` then fires
/// each crossed set boundary exactly once for the haptic.
struct DrillRunView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let drill: Drill
    var startOffset: Double = 0

    @State private var start = Date()
    @State private var lastElapsed = 0.0
    @State private var now = Date()
    private let tick = Timer.publish(every: 0.25, on: .main, in: .common).autoconnect()

    private var timer: DrillTimer { DrillTimer(plan: drill.plan) }
    private var elapsed: Double { now.timeIntervalSince(start) + startOffset }

    var body: some View {
        let state = timer.state(at: elapsed)
        let accent = ThwapTheme.color(drill.discipline)
        VStack(spacing: 4) {
            ZStack {
                Circle().stroke(accent.opacity(0.25), lineWidth: 8)
                Circle()
                    .trim(from: 0, to: 1 - state.phaseProgress)
                    .stroke(phaseColor(state.phase, accent), style: StrokeStyle(lineWidth: 8, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                Text(state.phase == .finished ? "✓" : "\(state.remaining)")
                    .font(.system(size: 38, weight: .black, design: .rounded))
                    .monospacedDigit()
                    .minimumScaleFactor(0.5)
                    .padding(9)
            }
            .frame(maxWidth: 92, maxHeight: 92)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(phaseLabel(state.phase))
            .accessibilityValue(state.phase == .finished ? "Finished" : "\(state.remaining) seconds left")

            Text(phaseLabel(state.phase))
                .font(.footnote.weight(.heavy))
                .foregroundStyle(ThwapTheme.green2)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .accessibilityHidden(true)

            Text(drill.name)
                .font(.system(.headline, design: .rounded).weight(.heavy))
                .lineLimit(2)
                .minimumScaleFactor(0.7)
                .multilineTextAlignment(.center)

            Button {
                model.checkOff(drill)
                dismiss()
            } label: {
                Text("Done")
                    .font(.system(.title3, design: .rounded).weight(.black))
                    .frame(maxWidth: .infinity, minHeight: 48)
            }
            .buttonStyle(.borderedProminent)
            .tint(ThwapTheme.lime)
            .foregroundStyle(ThwapTheme.ink)
            .accessibilityHint("Checks this drill off")
        }
        .padding(.horizontal, 6)
        .background(ThwapTheme.bg)
        .onAppear {
            start = Date()
            now = start
            lastElapsed = startOffset
            Haptics.timerStart()
        }
        .onReceive(tick) { date in
            now = date
            let e = elapsed
            if !timer.events(from: lastElapsed, to: e).isEmpty {
                Haptics.setEnd()
            }
            lastElapsed = e
        }
    }

    private func phaseColor(_ p: DrillTimer.Phase, _ accent: Color) -> Color {
        switch p {
        case .work: return accent
        case .rest: return ThwapTheme.muted
        case .finished: return ThwapTheme.lime
        }
    }

    private func phaseLabel(_ p: DrillTimer.Phase) -> String {
        switch p {
        case .work(let set): return "Set \(set) of \(drill.plan.sets)"
        case .rest: return "Rest"
        case .finished: return "Tap Done!"
        }
    }
}
