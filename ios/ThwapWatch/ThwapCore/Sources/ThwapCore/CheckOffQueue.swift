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
/// In-memory for the scaffold. Persistence (file or App Group defaults) lands
/// with the real client; `pending` is Codable-ready for that.
public actor CheckOffQueue {
    public struct Entry: Codable, Equatable, Hashable, Sendable {
        public var date: String
        public var request: MarkDoneRequest
        public var key: String { "\(date)|\(request.drillId)" }
    }

    private var entries: [Entry] = []
    private var delivered: Set<String> = []

    public init() {}

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
                entries.removeFirst()
                delivered.insert(next.key)
                confirmed += 1
            } catch {
                break
            }
        }
        return confirmed
    }
}
