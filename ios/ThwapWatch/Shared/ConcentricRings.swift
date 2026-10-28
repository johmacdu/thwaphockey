import SwiftUI
import ThwapCore

/// Three concentric rings, outer stick, middle shoot, inner dryland. Shared by
/// the Today header and the circular complication.
struct ConcentricRings: View {
    var rings: [RingProgress]
    var line: CGFloat = 6
    var gap: CGFloat = 2

    var body: some View {
        GeometryReader { geo in
            let size = Double(min(geo.size.width, geo.size.height))
            ZStack {
                ForEach(Array(rings.enumerated()), id: \.offset) { index, ring in
                    let d = RingMath.diameter(index: index, size: size, line: Double(line), gap: Double(gap))
                    let c = ThwapTheme.color(ring.discipline)
                    ZStack {
                        Circle().stroke(c.opacity(0.25), lineWidth: line)
                        Circle()
                            .trim(from: 0, to: ring.fraction)
                            .stroke(c, style: StrokeStyle(lineWidth: line, lineCap: .round))
                            .rotationEffect(.degrees(-90))
                    }
                    .frame(width: d, height: d)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Self.label(rings))
    }

    static func label(_ rings: [RingProgress]) -> String {
        rings.map { "\($0.discipline.label) \($0.done) of \($0.total)" }.joined(separator: ", ")
    }
}
