import SwiftUI
import ThwapCore

/// Launch arguments for previews, UI tests and screenshots only:
///   -thwapStub                     use StubThwapAPI + an in-memory token (no network)
///   -thwapScreen signin|waiting|denied|expired|today|category|categoryDone|list|run|stamp|goals|season|team|more
///                                  (implies -thwapStub)
///   -thwapGameDay   -thwapWeekend   -thwapElapsed <sec>
///   -thwapSeasonState step2|lastStep|oneDay|legend|longStar   -thwapTeamState normal|one|reached
///   -thwapBaseURL <https url>      point the real client at another deploy
struct LaunchOptions {
    var stub = false
    var screen: String?
    var gameDay = false
    var weekend = false
    var elapsed: Double = 0
    var seasonState: StubThwapAPI.SeasonState = .step2
    var teamState: StubThwapAPI.TeamState = .normal

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
        o.weekend = args.contains("-thwapWeekend")
        o.elapsed = Double(value("-thwapElapsed") ?? "") ?? 0
        o.seasonState = value("-thwapSeasonState").flatMap(StubThwapAPI.SeasonState.init(rawValue:)) ?? .step2
        o.teamState = value("-thwapTeamState").flatMap(StubThwapAPI.TeamState.init(rawValue:)) ?? .normal
        return o
    }()

    /// Screens that start signed out.
    var startsSignedOut: Bool { ["signin", "waiting", "denied", "expired"].contains(screen ?? "") }
}

@MainActor
func makeModel(_ launch: LaunchOptions = .current) -> AppModel {
    if launch.stub {
        let stub = StubThwapAPI(date: ThwapDay.string(), gameDay: launch.gameDay,
                                seasonState: launch.seasonState, teamState: launch.teamState,
                                weekend: launch.weekend)
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
    @State private var page: HomePage = .hello
    @State private var openCategory: Discipline?
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
            HomePager(page: $page, showGoals: $showGoals, openCategory: $openCategory)
                .navigationDestination(isPresented: $showGoals) { GameGoalsView() }
                .navigationDestination(item: $openCategory) { disc in
                    CategoryDrillList(discipline: disc)
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
            model.seedDone(["stick:0", "stick:1"])
        case "category":
            model.seedDone(["stick:0", "stick:1"])
            page = .category(.shoot)
        case "categoryDone":
            model.seedDone(["stick:0", "stick:1", "stick:2"])
            page = .category(.stick)
        case "list":
            model.seedDone(["stick:0", "stick:1"])
            page = .category(.stick)
            openCategory = .stick
        case "run":
            model.running = plan.drills.first { $0.id == "stick:2" }
        case "stamp":
            model.seedDone(["stick:0", "stick:1"])
            if let d = plan.drills.first(where: { $0.id == "stick:2" }) { model.checkOff(d) }
        case "goals":
            showGoals = true
        case "season":
            page = .season
        case "team":
            page = .team
        case "more":
            page = .more
        default:
            break
        }
        // The pager can settle on its first page after the first layout pass,
        // so a scripted screenshot page is set again once it is on screen.
        let target = page
        if target != .hello {
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(600))
                page = target
            }
        }
    }
}
