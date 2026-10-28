import SwiftUI
import ThwapCore

/// Launch arguments used only to put each screen on glass for screenshots:
///   -thwapScreen today|run|stamp|goals   -thwapGameDay   -thwapElapsed <sec>
struct LaunchOptions {
    var screen: String?
    var gameDay = false
    var elapsed: Double = 0

    static let current: LaunchOptions = {
        let args = ProcessInfo.processInfo.arguments
        var o = LaunchOptions()
        func value(_ flag: String) -> String? {
            guard let i = args.firstIndex(of: flag), i + 1 < args.count else { return nil }
            return args[i + 1]
        }
        o.screen = value("-thwapScreen")
        o.gameDay = args.contains("-thwapGameDay") || o.screen == "goals"
        o.elapsed = Double(value("-thwapElapsed") ?? "") ?? 0
        return o
    }()
}

@main
struct ThwapWatchApp: App {
    // Swap StubThwapAPI for the real client here once the design doc lands.
    @StateObject private var model = AppModel(api: StubThwapAPI(
        date: ThwapDay.string(),
        gameDay: LaunchOptions.current.gameDay
    ))

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
        }
    }
}

struct RootView: View {
    @EnvironmentObject var model: AppModel
    @State private var showGoals = false
    private let launch = LaunchOptions.current

    var body: some View {
        NavigationStack {
            TodayView(showGoals: $showGoals)
                .navigationDestination(isPresented: $showGoals) { GameGoalsView() }
        }
        .fullScreenCover(item: $model.running) { drill in
            DrillRunView(drill: drill, startOffset: launch.elapsed)
        }
        .overlay {
            if let drill = model.stampFor {
                StampView(drill: drill) { model.stampFor = nil }
            }
        }
        .task {
            await model.load()
            applyLaunchScreen()
        }
    }

    private func applyLaunchScreen() {
        guard let plan = model.plan else { return }
        switch launch.screen {
        case "today":
            model.seedDone(["stick:1", "dryland:0"])
        case "run":
            model.running = plan.drills.first { $0.id == "stick:2" }
        case "stamp":
            model.seedDone(["stick:0", "stick:1"])
            if let d = plan.drills.first(where: { $0.id == "stick:2" }) { model.checkOff(d) }
        case "goals":
            showGoals = true
        default:
            break
        }
    }
}
