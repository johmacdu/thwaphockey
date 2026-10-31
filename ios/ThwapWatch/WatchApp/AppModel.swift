import SwiftUI
import WatchKit
import WidgetKit
import ThwapCore

/// Where the watch is in sign-in.
enum AuthState: Equatable {
    case signedOut
    /// Waiting for a parent to tap Approve. `sent` is false when no parent
    /// email is on file (the server still answers ok, so the roster can't be
    /// probed).
    case waiting(requestId: String, sent: Bool)
    case signedIn
}

/// How a wait ended without a sign-in, for the waiting screen.
enum WaitEnd: Equatable {
    case denied, expired, timedOut
}

/// App state. Talks to `ThwapAPI`, `TokenStore` and `CheckOffQueue` only, so
/// the stub and the real client are interchangeable (see `ThwapWatchApp`).
@MainActor
final class AppModel: ObservableObject {
    @Published private(set) var auth: AuthState
    @Published private(set) var plan: TodayPlan?
    @Published private(set) var doneIds: Set<String> = []
    @Published var running: Drill?
    @Published var stampFor: Drill?
    /// The done row the kid tapped; Today asks before undoing it.
    @Published var undoTarget: Drill?
    @Published private(set) var loadFailed = false
    @Published private(set) var waitEnd: WaitEnd?
    @Published private(set) var signInError: String?
    @Published private(set) var signingIn = false
    /// Check-offs on the watch the server has not confirmed yet.
    @Published private(set) var waitingToSync = 0
    /// One quiet line under the list (season not active, renew soon).
    @Published private(set) var notice: String?
    /// My Season and Team glances. nil until read; a failed read only sets
    /// the matching flag, never `loadFailed`, so the drill list is untouched.
    @Published private(set) var season: SeasonGlance?
    @Published private(set) var team: TeamGlance?
    @Published private(set) var seasonFailed = false
    @Published private(set) var teamFailed = false

    let api: ThwapAPI
    let tokens: TokenStore
    /// Persisted in the App Group container, so offline check-offs survive a
    /// kill and are retried on the next launch.
    let queue: CheckOffQueue
    private let ringStore: RingStore
    private var weekRings: RingSnapshot?
    private var pollTask: Task<Void, Never>?
    private var checkedSession = false
    private let clock: PollClock

    init(api: ThwapAPI, tokens: TokenStore, queue: CheckOffQueue = CheckOffQueue(fileURL: CheckOffQueue.defaultFileURL()),
         ringStore: RingStore = RingStore(), clock: PollClock = SystemPollClock()) {
        self.api = api
        self.tokens = tokens
        self.queue = queue
        self.ringStore = ringStore
        self.clock = clock
        auth = tokens.load() == nil ? .signedOut : .signedIn
        if let live = api as? LiveThwapAPI {
            live.onSignedOut { [weak self] in
                Task { @MainActor in self?.handleSignedOut() }
            }
        }
    }

    /// Today's progress for the header rings (today's drills, not the week).
    var rings: [RingProgress] {
        RingMath.rings(drills: plan?.drills ?? [], doneIds: doneIds)
    }

    /// Today's categories with progress, one home page each.
    var categories: [CategorySummary] {
        plan?.categories(doneIds: doneIds) ?? []
    }

    var toGo: Int {
        guard let plan else { return 0 }
        return plan.drills.filter { !doneIds.contains($0.id) }.count
    }

    var firstName: String { plan?.firstName ?? tokens.load()?.firstName ?? "there" }

    // MARK: Sign-in

    func requestApproval(teamCode: String, code: String) async {
        signInError = nil
        waitEnd = nil
        signingIn = true
        defer { signingIn = false }
        do {
            let out = try await api.requestWatch(WatchRequestBody(teamCode: teamCode, code: code,
                                                                  deviceLabel: Self.deviceLabel))
            auth = .waiting(requestId: out.requestId, sent: out.sent)
            startPolling(out.requestId)
        } catch let e as ThwapAPIError {
            signInError = e.userMessage
        } catch {
            signInError = ThwapAPIError.offline.userMessage
        }
    }

    func startPolling(_ requestId: String) {
        pollTask?.cancel()
        let poller = ApprovalPoller(api: api, tokens: tokens, clock: clock)
        pollTask = Task { [weak self] in
            guard let outcome = try? await poller.wait(requestId: requestId) else { return }
            await self?.finishWaiting(outcome)
        }
    }

    private func finishWaiting(_ outcome: ApprovalOutcome) async {
        switch outcome {
        case .approved:
            Haptics.approved()
            waitEnd = nil
            auth = .signedIn
            await load()
        case .denied: waitEnd = .denied
        case .expired: waitEnd = .expired
        case .timedOut: waitEnd = .timedOut
        }
    }

    /// Back to the sign-in form (Cancel, or Try again after a denial).
    func cancelWaiting() {
        pollTask?.cancel()
        pollTask = nil
        waitEnd = nil
        auth = .signedOut
    }

    func signOut() async {
        pollTask?.cancel()
        try? await api.logout()
        tokens.clear()
        await queue.clear()
        ringStore.clear()
        WidgetCenter.shared.reloadAllTimelines()
        plan = nil
        doneIds = []
        weekRings = nil
        waitingToSync = 0
        notice = nil
        season = nil
        team = nil
        auth = .signedOut
    }

    /// A 401 anywhere: the token is already cleared by the client. The queue
    /// is kept so it can all go after a parent approves again.
    private func handleSignedOut() {
        guard auth == .signedIn else { return }
        auth = .signedOut
        signInError = "Ask a parent to approve this watch again."
    }

    var pendingCount: Int { waitingToSync }

    static var deviceLabel: String {
        let name = WKInterfaceDevice.current().name
        return name.isEmpty ? "Apple Watch" : String(name.prefix(40))
    }

    // MARK: Today

    /// Launch, foreground, and after sign-in. Flushes first so the server read
    /// already includes anything queued offline.
    func load() async {
        guard auth == .signedIn else { return }
        if !checkedSession {
            checkedSession = true
            // authed:false clears the token and signs out via the handler.
            if let s = try? await api.session(), !s.authed { return }
            if auth != .signedIn { return }
        }
        await flush()
        do {
            let p = try await api.todayPlan()
            plan = p
            await applyServerDone(date: p.date)
            loadFailed = false
        } catch ThwapAPIError.unauthorized {
            return
        } catch {
            loadFailed = plan == nil
        }
        await refreshRings()
        updateNotice()
        await refreshGlance()
    }

    /// My Season and Team, read side by side after the drill list. Each one
    /// fails on its own and keeps the last good answer.
    func refreshGlance() async {
        guard auth == .signedIn else { return }
        async let s = try? api.season()
        async let t = try? api.team()
        let (sr, tr) = await (s, t)
        if let sr { season = sr.glance }
        if let tr { team = tr.glance }
        seasonFailed = season == nil
        teamFailed = team == nil
    }

    /// The server wins, with this watch's unsent taps laid on top so an
    /// offline tap never un-checks.
    private func applyServerDone(date: String) async {
        guard let server = try? await api.todayDone() else {
            // Offline: keep whatever we showed, plus local pending.
            for e in await queue.pending where e.date == date {
                if e.action == .mark { doneIds.insert(e.request.drillId) } else { doneIds.remove(e.request.drillId) }
            }
            return
        }
        await queue.replaceDelivered(with: server.drills, date: date)
        var ids = Set(server.drills)
        for e in await queue.pending where e.date == date {
            if e.action == .mark { ids.insert(e.request.drillId) } else { ids.remove(e.request.drillId) }
        }
        doneIds = ids
    }

    func isDone(_ drill: Drill) -> Bool { doneIds.contains(drill.id) }

    /// Check a drill off: local first (always succeeds), then queue + flush.
    func checkOff(_ drill: Drill) {
        guard let plan, !doneIds.contains(drill.id) else { return }
        doneIds.insert(drill.id)
        stampFor = drill
        Haptics.stamp()
        if let w = weekRings { publish(w.bumped(drill.discipline)) }
        let req = MarkDoneRequest(player: plan.playerId, discipline: drill.discipline.rawValue,
                                  drillId: drill.id, drillName: drill.name)
        Task {
            await queue.enqueue(req, date: plan.date)
            await flush()
            await refreshRings()
        }
    }

    /// Undo a check-off, after Today's confirm step. The server never lowers
    /// the earned count on an undo, so the week rings do not go back.
    func undo(_ drill: Drill) {
        guard let plan, doneIds.contains(drill.id) else { return }
        doneIds.remove(drill.id)
        let req = MarkDoneRequest(player: plan.playerId, discipline: drill.discipline.rawValue,
                                  drillId: drill.id, drillName: drill.name)
        Task {
            await queue.enqueueUndo(req, date: plan.date)
            await flush()
        }
    }

    private func flush() async {
        await queue.flush(using: api)
        waitingToSync = await queue.pending.count
        updateNotice()
    }

    /// Weekly rings from the server into the App Group, for the complication.
    private func refreshRings() async {
        guard let r = try? await api.rings() else { return }
        publish(r.snapshot(today: ThwapDay.string()))
    }

    private func publish(_ snapshot: RingSnapshot) {
        weekRings = snapshot
        ringStore.save(snapshot)
        WidgetCenter.shared.reloadAllTimelines()
    }

    private func updateNotice() {
        Task {
            if await queue.dropped.contains(.seasonInactive) {
                notice = ThwapAPIError.seasonInactive.userMessage
            } else if let exp = tokens.load()?.exp,
                      exp - Date().timeIntervalSince1970 * 1000 < 7 * 24 * 3600 * 1000 {
                notice = "Ask a parent to renew this watch soon."
            } else {
                notice = nil
            }
        }
    }

    // MARK: Screenshot seeding (launch arguments only, never in normal use)

    func seedDone(_ ids: [String]) { doneIds.formUnion(ids) }

    func seedWaiting(sent: Bool = true) {
        auth = .waiting(requestId: "stub-request", sent: sent)
        startPolling("stub-request")
    }

    func seedWaitEnd(_ end: WaitEnd) {
        auth = .waiting(requestId: "stub-request", sent: true)
        waitEnd = end
    }

    func seedSignInError(_ message: String) { signInError = message }
}
