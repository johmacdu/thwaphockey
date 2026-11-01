import SwiftUI
import ThwapCore

/// A category's drills, pushed from its home page. Plain rows with hairlines,
/// no cards. The player picks: tap a drill to run that one, tap a done one to
/// undo it (with a confirm).
struct CategoryDrillList: View {
    @EnvironmentObject var model: AppModel
    let discipline: Discipline

    var body: some View {
        let summary = model.categories.first { $0.discipline == discipline }
            ?? CategorySummary(discipline: discipline, drills: [], doneIds: [])
        let accent = ThwapTheme.color(discipline)
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 8) {
                    CategoryIcon(discipline: discipline, size: 28)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(summary.title)
                            .font(ThwapTheme.display(20, relativeTo: .title3))
                            .foregroundStyle(ThwapTheme.ice)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                            .layoutPriority(1)
                        Text(summary.countLine)
                            .font(ThwapTheme.body(12, .extraBold, relativeTo: .caption))
                            .foregroundStyle(accent)
                    }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(summary.accessibilityLine)
                .accessibilityAddTraits(.isHeader)
                .padding(.bottom, 4)

                ForEach(Array(summary.drills.enumerated()), id: \.element.id) { i, drill in
                    if i > 0 { Rectangle().fill(ThwapTheme.line).frame(height: 1) }
                    CategoryDrillRow(drill: drill, done: summary.isDone(drill)) {
                        if summary.isDone(drill) { model.undoTarget = drill } else { model.running = drill }
                    }
                }
            }
            .padding(.horizontal, 4)
        }
        .background(ThwapTheme.bg)
        .alert(model.undoTarget.map { "Undo \($0.name)?" } ?? "",
               isPresented: Binding(get: { model.undoTarget != nil }, set: { if !$0 { model.undoTarget = nil } }),
               presenting: model.undoTarget) { drill in
            Button("Undo", role: .destructive) { model.undo(drill); model.undoTarget = nil }
            Button("Keep it", role: .cancel) { model.undoTarget = nil }
        } message: { _ in
            Text("It comes off your list for today.")
        }
    }
}

struct CategoryDrillRow: View {
    let drill: Drill
    let done: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                ZStack {
                    if done {
                        Circle().fill(ThwapTheme.lime)
                        Image(systemName: "checkmark")
                            .font(.system(size: 11, weight: .black))
                            .foregroundStyle(ThwapTheme.ink)
                    } else {
                        Circle().strokeBorder(ThwapTheme.muted, lineWidth: 2.5)
                    }
                }
                .frame(width: 22, height: 22)
                VStack(alignment: .leading, spacing: 1) {
                    Text(drill.name)
                        .font(ThwapTheme.body(15, .extraBold))
                        .foregroundStyle(done ? ThwapTheme.muted : ThwapTheme.ice)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(drill.doseLine)
                        .font(ThwapTheme.body(12, .bold, relativeTo: .caption))
                        .foregroundStyle(ThwapTheme.muted)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .layoutPriority(1)
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 10)
            .padding(.horizontal, 2)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(drill.name), \(drill.doseLine)")
        .accessibilityValue(done ? "Done" : "Not done yet")
        .accessibilityHint(done ? "Asks before undoing" : "Starts the drill timer")
        .accessibilityAddTraits(done ? [.isButton, .isSelected] : .isButton)
    }
}

// MARK: - Shared pieces

/// The website's category icon (login/icon-*.webp, as PNGs in the asset catalog).
struct CategoryIcon: View {
    let discipline: Discipline
    let size: CGFloat

    static func assetName(_ d: Discipline) -> String {
        switch d {
        case .stick: return "cat-stick"
        case .shoot, .netplay: return "cat-net"
        case .dryland: return "cat-bolt"
        case .pass: return "cat-pass"
        case .iq: return "cat-brain"
        }
    }

    var body: some View {
        Image(Self.assetName(discipline))
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// Small uppercase label in lime, tracked out.
struct Eyebrow: View {
    let text: String

    var body: some View {
        Text(text.uppercased())
            .font(ThwapTheme.body(11, .black, relativeTo: .caption2))
            .tracking(0.9)
            .foregroundStyle(ThwapTheme.lime)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .layoutPriority(1)
    }
}

/// Rounded progress bar on the soft track. An empty bar still shows a dot of
/// color so the category reads at a glance.
struct ProgressBar: View {
    let fraction: Double
    let color: Color

    var body: some View {
        GeometryReader { geo in
            let f = max(0, min(1, fraction))
            ZStack(alignment: .leading) {
                Capsule().fill(ThwapTheme.soft)
                Capsule().fill(color)
                    .frame(width: max(geo.size.height, f * geo.size.width))
            }
        }
        .accessibilityHidden(true)
    }
}

/// Full-width pill button, at least 44 points tall.
struct PillButton: View {
    let title: String
    let fill: Color
    let text: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(ThwapTheme.body(16, .black, relativeTo: .headline))
                .foregroundStyle(text)
                .lineLimit(1)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(Capsule().fill(fill))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}
