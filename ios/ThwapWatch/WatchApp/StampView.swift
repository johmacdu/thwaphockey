import SwiftUI
import ThwapCore

/// Screen 3: the THWAP stamp. Lime word with an ink outline, tilted -8 degrees
/// like the web `.exthwap`, popping in over 300ms. Reduce Motion shows it
/// without the pop. Never blocks a tap: any tap dismisses, and it auto-clears.
struct StampView: View {
    let drill: Drill
    let onFinish: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false

    var body: some View {
        ZStack {
            // Fully solid so the Today list never shows through the stamp.
            ThwapTheme.bg.ignoresSafeArea()
            VStack(spacing: 6) {
                outlined("THWAP!")
                    .rotationEffect(.degrees(-8))
                    .scaleEffect(shown || reduceMotion ? 1 : 0.2)
                    .opacity(shown || reduceMotion ? 1 : 0)
                Text("You showed up!")
                    .font(.system(.headline, design: .rounded).weight(.heavy))
                    .foregroundStyle(ThwapTheme.green2)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { onFinish() }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("THWAP! \(drill.name) done. You showed up!")
        .accessibilityAddTraits(.isStaticText)
        .onAppear {
            withAnimation(.spring(response: 0.3, dampingFraction: 0.55)) { shown = true }
            // Held on screen only for the screenshot launch argument.
            guard LaunchOptions.current.screen != "stamp" else { return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) { onFinish() }
        }
    }

    /// SwiftUI has no text stroke, so fake the web's 3px ink stroke with eight
    /// offset copies under the lime fill.
    private func outlined(_ s: String) -> some View {
        let font = ThwapTheme.stampFont(38)
        let o: CGFloat = 2.5
        return ZStack {
            ForEach(0..<8, id: \.self) { i in
                let a = Double(i) * .pi / 4
                Text(s).font(font).foregroundStyle(ThwapTheme.ink)
                    .offset(x: o * cos(a), y: o * sin(a))
            }
            Text(s).font(font).foregroundStyle(ThwapTheme.lime)
        }
        .lineLimit(1)
        .minimumScaleFactor(0.6)
    }
}
