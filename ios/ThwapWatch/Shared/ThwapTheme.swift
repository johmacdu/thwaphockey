import SwiftUI
import ThwapCore

/// Design tokens copied from index.html (dark theme, since a watch face is dark).
enum ThwapTheme {
    static let lime = Color(hex: 0xB9F06B)      // --lime, the done state
    static let ink = Color(hex: 0x15221B)       // --ink, text on lime + stamp stroke
    static let green2 = Color(hex: 0xCDEFA0)    // dark --green2
    static let bg = Color(hex: 0x101A14)        // dark --bg
    static let panel = Color(hex: 0x182420)     // dark --panel
    static let line = Color(hex: 0x2A3831)      // dark --line
    static let muted = Color(hex: 0x9DACA2)     // dark --muted

    /// Discipline accents (#stick/#shoot/#dryland .exrow --exacc).
    static func color(_ d: Discipline) -> Color {
        switch d {
        case .stick: return Color(hex: 0x8FD65E)
        case .shoot, .netplay: return Color(hex: 0x75B8FF)
        case .dryland: return Color(hex: 0xFF9D4D)
        case .iq: return Color(hex: 0xA98BFF)
        case .pass: return Color(hex: 0x5CD6C8)
        }
    }

    /// The stamp face. The web uses Archivo Black; the watch uses the system
    /// heavy rounded face so we ship no font file in the scaffold.
    static func stampFont(_ size: CGFloat) -> Font {
        .system(size: size, weight: .black, design: .rounded)
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255)
    }
}
