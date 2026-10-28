import Foundation

/// Offline check-off queue. A tap on the wrist must ALWAYS feel done, even
/// with no signal at the rink, so a check-off is recorded locally first and
/// flushed to `ThwapAPI.markDone` when the network allows.
///
/// Idempotent by `drillId` per day: enqueueing the same drill twice keeps one
/// entry, and a flush that the server reports as `duplicate` still counts as
/// delivered. That matches the server's own per-drill dedup guard, so a retry
/// can never double-count the leaderboard.
///
/// Persistence: when built with a `fileURL` the queue loads that file on init
/// and rewrites it (atomically) after every enqueue and every confirmed
/// delivery, so a check-off made offline survives the app being killed. An
/// entry leaves the file only after the API confirms it. `init()` with no URL
/// stays in memory (tests, previews).
public actor CheckOffQueue {
    public struct Entry: Codable, Equatable, Hashable, Sendable {
        public var date: String
        public var request: MarkDoneRequest
        public var key: String { "\(date)|\(request.drillId)" }
    }

    /// On-disk shape. Versioned so a later format change can migrate.
    struct Snapshot: Codable {
        var version = 1
        var entries: [Entry]
        var delivered: [String]
    }

    private var entries: [Entry] = []
    private var delivered: Set<String> = []
    private let fileURL: URL?

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

    /// True when this drill is recorded locally (queued or delivered) for `date`.
    public func isDone(drillId: String, date: String) -> Bool {
        let key = "\(date)|\(drillId)"
        return delivered.contains(key) || entries.contains { $0.key == key }
    }

    /// Record a check-off. Returns false when it was already recorded (no-op).
    @discardableResult
    public func enqueue(_ request: MarkDoneRequest, date: String) -> Bool {
        let entry = Entry(date: date, request: request)
        if delivered.contains(entry.key) || entries.contains(where: { $0.key == entry.key }) {
            return false
        }
        entries.append(entry)
        pruneDelivered(keepingFrom: date)
        save()
        return true
    }

    /// Try to deliver every pending entry. Stops at the first offline error and
    /// keeps the rest in order. Returns how many were confirmed.
    @discardableResult
    public func flush(using api: ThwapAPI) async -> Int {
        var confirmed = 0
        while let next = entries.first {
            do {
                _ = try await api.markDone(next.request)
                // Remove only after the server confirmed, then persist at once
                // so a kill right after delivery cannot resend a stale entry.
                entries.removeAll { $0.key == next.key }
                delivered.insert(next.key)
                save()
                confirmed += 1
            } catch {
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
