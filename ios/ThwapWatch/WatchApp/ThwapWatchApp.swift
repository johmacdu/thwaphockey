import SwiftUI
import ThwapCore

/// Launch arguments for previews, UI tests and screenshots only:
///   -thwapStub                     use StubThwapAPI + an in-memory token (no network)
///   -thwapScreen signin|waiting|denied|expired|today|run|stamp|goals|season|team
///                                  (implies -thwapStub)
///   -thwapGameDay   -thwapElapsed <sec>
///   -thwapBaseURL <https url>      point the real client at another deploy
struct LaunchOptions {
    var stub = false
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
        o.stub = args.contains("-thwapStub") || o.screen != nil
        o.gameDay = args.contains("-thwapGameDay") || o.screen == "goals"
        o.elapsed = Double(value("-thwapElapsed") ?? "") ?? 0
        return o
    }()

    /// Screens that start signed out.
    var startsSignedOut: Bool { ["signin", "waiting", "denied", "expired"].contains(screen ?? "") }
}

@MainActor
func makeModel(_ launch: LaunchOptions = .current) -> AppModel {
    if launch.stub {
        let stub = StubThwapAPI(date: ThwapDay.string(), gameDay: launch.gameDay)
        let demo = WatchCredential(token: "demo.stub.0.sig", exp: nil,
                                   player: .init(id: StubThwapAPI.playerId, name: "Demo", number: 0))
        return AppModel(api: stub,
                        tokens: InMemoryTokenStore(launch.startsSignedOut ? nil : demo),
                        queue: CheckOffQueue(),
                        ringStore: RingStore())
    }
    let tokens = KeychainTokenStore()
    let live = LiveThwapAPI(baseURL: ThwapConfig.baseURL(), tokens: tokens)
    return AppModel(api: live, tokens: tokens)
}

@main
struct ThwapWatchApp: App {
    @StateObject private var model = makeModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
        }
    }
}

struct RootView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var showGoals = false
    @State private var glance: GlanceScreen?
    @State private var appliedLaunch = false
    private let launch = LaunchOptions.current

    var body: some View {
        Group {
            switch model.auth {
            case .signedOut:
                SignInView()
            case .waiting(_, let sent):
                WaitingView(sent: sent)
            case .signedIn:
                signedIn
            }
        }
        .task {
            applySignedOutLaunchScreen()
            await model.load()
            applyLaunchScreen()
        }
        .onChange(of: scenePhase) { _, phase in
            // Foreground: flush anything queued and re-read the server.
            // Scripted screenshot screens skip it so their seeded state holds.
            if phase == .active, model.auth == .signedIn, launch.screen == nil { Task { await model.load() } }
        }
    }

    private var signedIn: some View {
        NavigationStack {
            TodayView(showGoals: $showGoals, glance: $glance)
                .navigationDestination(isPresented: $showGoals) { GameGoalsView() }
                .navigationDestination(item: $glance) { screen in
                    switch screen {
                    case .season: SeasonView()
                    case .team: TeamView()
                    }
                }
        }
        .fullScreenCover(item: $model.running) { drill in
            DrillRunView(drill: drill, startOffset: launch.elapsed)
        }
        .overlay {
            if let drill = model.stampFor {
                StampView(drill: drill) { model.stampFor = nil }
            }
        }
    }

    private func applySignedOutLaunchScreen() {
        switch launch.screen {
        case "waiting": model.seedWaiting()
        case "denied": model.seedWaitEnd(.denied)
        case "expired": model.seedWaitEnd(.expired)
        default: break
        }
    }

    private func applyLaunchScreen() {
        guard !appliedLaunch, let plan = model.plan else { return }
        appliedLaunch = true
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
        case "season":
            glance = .season
        case "team":
            glance = .team
        default:
            break
        }
    }
}
