import SwiftUI
import WidgetKit
import ThwapCore

/// App state. Talks to `ThwapAPI` + `CheckOffQueue` only, so swapping the stub
/// for the real client is a one-line change in `ThwapWatchApp`.
@MainActor
final class AppModel: ObservableObject {
    @Published private(set) var plan: TodayPlan?
    @Published private(set) var doneIds: Set<String> = []
    @Published var running: Drill?
    @Published var stampFor: Drill?
    @Published var loadFailed = false

    let api: ThwapAPI
    let queue = CheckOffQueue()
    private let ringStore = RingStore()

    init(api: ThwapAPI) { self.api = api }

    var rings: [RingProgress] {
        RingMath.rings(drills: plan?.drills ?? [], doneIds: doneIds)
    }

    var toGo: Int {
        guard let plan else { return 0 }
        return plan.drills.filter { !doneIds.contains($0.id) }.count
    }

    func load() async {
        do {
            let p = try await api.todayPlan()
            plan = p
            if let server = try? await api.todayDone() {
                // Server is authoritative on a good read; keep local pending
                // check-offs on top so an offline tap never un-checks.
                var ids = Set(server.drills)
                for e in await queue.pending where e.date == p.date { ids.insert(e.request.drillId) }
                doneIds = ids
            }
            loadFailed = false
            publishRings()
        } catch {
            loadFailed = plan == nil
        }
    }

    func isDone(_ drill: Drill) -> Bool { doneIds.contains(drill.id) }

    /// Check a drill off: local first (always succeeds), then queue + flush.
    func checkOff(_ drill: Drill) {
        guard let plan, !doneIds.contains(drill.id) else { return }
        doneIds.insert(drill.id)
        publishRings()
        stampFor = drill
        Haptics.stamp()
        let req = MarkDoneRequest(player: plan.playerId, discipline: drill.discipline.rawValue,
                                  drillId: drill.id, drillName: drill.name)
        Task {
            await queue.enqueue(req, date: plan.date)
            await queue.flush(using: api)
        }
    }

    private func publishRings() {
        guard let plan else { return }
        ringStore.save(RingSnapshot(date: plan.date, rings: rings))
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// Screenshot / preview seeding (launch arguments only, never in normal use).
    func seedDone(_ ids: [String]) { doneIds.formUnion(ids); publishRings() }
}
