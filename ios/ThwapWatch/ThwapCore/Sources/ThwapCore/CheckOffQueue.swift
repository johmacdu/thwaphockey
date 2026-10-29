import Foundation

/// Offline check-off queue. A tap on the wrist must ALWAYS feel done, even
/// with no signal at the rink, so a check-off is recorded locally first and
/// flushed to the API when the network allows.
///
/// Idempotent by `drillId` per day: enqueueing the same drill twice keeps one
/// entry, and a flush that the server reports as `duplicate` still counts as
/// delivered. That matches the server's own per-drill dedup guard, so a retry
/// can never double-count the leaderboard.
///
/// Undo: an undo of a mark that never left the watch just cancels the mark.
/// Otherwise it queues an undo, sent in order after earlier marks. The server
/// undo only acts on today, so an undo whose day has passed is dropped.
///
/// Failures (design doc section 9): offline, 5xx, 429 and 401 keep the entry
/// and stop the flush so order is kept; 400/402/403 drop it (the server will
/// never take it). An entry leaves the queue only on a 2xx or a drop.
///
/// Persistence: when built with a `fileURL` the queue loads that file on init
/// and rewrites it (atomically) after every change, so a check-off made
/// offline survives the app being killed. `init()` stays in memory.
public actor CheckOffQueue {
    public enum Action: String, Codable, Sendable { case mark, undo }

    public struct Entry: Codable, Equatable, Hashable, Sendable {
        public var date: String
        public var request: MarkDoneRequest
        public var action: Action
        public var key: String { "\(date)|\(request.drillId)" }

        public init(date: String, request: MarkDoneRequest, action: Action = .mark) {
            self.date = date
            self.request = request
            self.action = action
        }

        // Version 1 files have no `action`; every entry there was a mark.
        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            date = try c.decode(String.self, forKey: .date)
            request = try c.decode(MarkDoneRequest.self, forKey: .request)
            action = try c.decodeIfPresent(Action.self, forKey: .action) ?? .mark
        }
    }

    /// What the last flush ran into, for the "waiting to sync" line.
    public enum FlushResult: Equatable, Sendable {
        case empty
        case stopped(ThwapAPIError)
    }

    /// On-disk shape. Versioned so a later format change can migrate.
    struct Snapshot: Codable {
        var version = 2
        var entries: [Entry]
        var delivered: [String]
    }

    private var entries: [Entry] = []
    private var delivered: Set<String> = []
    private let fileURL: URL?
    public private(set) var lastResult: FlushResult = .empty
    /// Drops since launch, newest last, so the UI can explain a 402.
    public private(set) var dropped: [ThwapAPIError] = []

    /// In-memory queue.
    public init() { fileURL = nil }

    /// Persistent queue backed by `fileURL`. A missing or unreadable file
    /// starts empty (a corrupt file never blocks a check-off).
    public init(fileURL: URL) {
        self.fileURL = fileURL
        if let data = try? Data(contentsOf: fileURL),
           let snap = try? JSONDecoder().decode(Snapshot.self, from: data) {
            entries = snap.entries
            delivered = Set(snap.delivered)
        }
    }

    /// `checkoff-queue.json` in the App Group container shared with the
    /// complication, falling back to Application Support when the group
    /// container is unavailable (unsigned simulator builds, tests).
    public static func defaultFileURL(appGroup: String = RingStore.appGroup) -> URL {
        let fm = FileManager.default
        let dir = fm.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
            ?? fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return dir.appendingPathComponent("checkoff-queue.json")
    }

    /// Everything not yet confirmed by the server, oldest first.
    public var pending: [Entry] { entries }

    /// Marks waiting to sync (what the sign-out warning counts).
    public var pendingMarks: Int { entries.filter { $0.action == .mark }.count }

    /// True when this drill reads as done locally for `date`: delivered or
    /// queued as a mark, and not queued for undo.
    public func isDone(drillId: String, date: String) -> Bool {
        let key = "\(date)|\(drillId)"
        if entries.contains(where: { $0.key == key && $0.action == .undo }) { return false }
        return delivered.contains(key) || entries.contains { $0.key == key && $0.action == .mark }
    }

    /// Record a check-off. Returns false when it was already recorded (no-op).
    @discardableResult
    public func enqueue(_ request: MarkDoneRequest, date: String) -> Bool {
        let key = "\(date)|\(request.drillId)"
        if let i = entries.firstIndex(where: { $0.key == key && $0.action == .undo }) {
            // Undo never left the watch, so the server still has the mark.
            entries.remove(at: i)
            delivered.insert(key)
            save()
            return true
        }
        if delivered.contains(key) || entries.contains(where: { $0.key == key }) { return false }
        entries.append(Entry(date: date, request: request, action: .mark))
        pruneDelivered(keepingFrom: date)
        save()
        return true
    }

    /// Record an undo. Returns false when the drill was not done.
    @discardableResult
    public func enqueueUndo(_ request: MarkDoneRequest, date: String) -> Bool {
        let key = "\(date)|\(request.drillId)"
        if let i = entries.firstIndex(where: { $0.key == key && $0.action == .mark }) {
            // The mark never reached the server: cancelling it is the undo.
            entries.remove(at: i)
            save()
            return true
        }
        if entries.contains(where: { $0.key == key && $0.action == .undo }) { return false }
        delivered.remove(key)
        entries.append(Entry(date: date, request: request, action: .undo))
        save()
        return true
    }

    /// Forget a server-confirmed state (after a fresh `GET /api/done`, the
    /// server wins). Pending entries are untouched.
    public func replaceDelivered(with drillIds: [String], date: String) {
        delivered = delivered.filter { !$0.hasPrefix("\(date)|") }
        for id in drillIds { delivered.insert("\(date)|\(id)") }
        save()
    }

    /// Wipe everything (sign out).
    public func clear() {
        entries = []
        delivered = []
        dropped = []
        lastResult = .empty
        save()
    }

    /// Try to deliver every pending entry, oldest first. Stops at the first
    /// keep-queued error so order is kept. Returns how many were confirmed.
    @discardableResult
    public func flush(using api: ThwapAPI, today: String = ThwapDay.string()) async -> Int {
        var confirmed = 0
        lastResult = .empty
        while let next = entries.first {
            do {
                switch next.action {
                case .mark:
                    var req = next.request
                    // Only an earlier day needs a date; today's mark lets the
                    // server's own clock decide, so a skew near midnight can
                    // never turn into a 400 'bad date'.
                    req.date = next.date == today ? nil : next.date
                    _ = try await api.markDone(req)
                    delivered.insert(next.key)
                case .undo:
                    if next.date == today {
                        _ = try await api.undoDone(UndoDoneRequest(player: next.request.player,
                                                                   drillId: next.request.drillId))
                    }
                    // A stale undo is dropped quietly (server undo is today only).
                }
                // Remove only after the server confirmed, then persist at once
                // so a kill right after delivery cannot resend a stale entry.
                entries.removeFirst()
                save()
                confirmed += 1
            } catch let e as ThwapAPIError where !e.keepsQueued {
                entries.removeFirst()
                dropped.append(e)
                save()
            } catch let e as ThwapAPIError {
                lastResult = .stopped(e)
                break
            } catch {
                lastResult = .stopped(.offline)
                break
            }
        }
        return confirmed
    }

    /// Delivered keys only guard against re-sending; anything older than the
    /// newest day being written can never be re-enqueued by the UI, so drop it
    /// to keep the file small.
    private func pruneDelivered(keepingFrom date: String) {
        delivered = delivered.filter { (($0.split(separator: "|").first).map(String.init) ?? "") >= date }
    }

    private func save() {
        guard let fileURL else { return }
        let snap = Snapshot(entries: entries, delivered: delivered.sorted())
        guard let data = try? JSONEncoder().encode(snap) else { return }
        try? FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(),
                                                 withIntermediateDirectories: true)
        try? data.write(to: fileURL, options: .atomic)
    }
}
