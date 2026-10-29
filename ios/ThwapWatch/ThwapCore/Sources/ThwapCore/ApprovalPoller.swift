import Foundation

/// Sleeps between polls. Injected so tests run the 15-minute state machine in
/// microseconds with a fake clock.
public protocol PollClock: Sendable {
    func now() -> Date
    func sleep(seconds: Double) async throws
}

public struct SystemPollClock: PollClock {
    public init() {}
    public func now() -> Date { Date() }
    public func sleep(seconds: Double) async throws {
        try await Task.sleep(nanoseconds: UInt64(max(0, seconds) * 1_000_000_000))
    }
}

/// How a parent-approval wait ended.
public enum ApprovalOutcome: Equatable, Sendable {
    case approved(WatchCredential)
    case denied
    /// The server says the request is gone (link expired, or already collected).
    case expired
    /// The watch gave up waiting (15 minutes, the server's request lifetime).
    case timedOut
}

/// The "Ask a parent" wait: polls watch-status every 3 seconds, backing off to
/// at most every 10 seconds after the first minute, and gives up at 15
/// minutes (WATCH_REQUEST_TTL_MS in lib/watch_store.js). A network error
/// mid-wait is not an outcome; the poller just backs off and asks again.
/// On `approved` the credential is saved to the token store exactly once.
public struct ApprovalPoller: Sendable {
    public static let firstInterval: Double = 3
    public static let maxInterval: Double = 10
    public static let fastPhase: Double = 60
    public static let timeout: Double = 15 * 60

    let api: ThwapAPI
    let tokens: TokenStore
    let clock: PollClock

    public init(api: ThwapAPI, tokens: TokenStore, clock: PollClock = SystemPollClock()) {
        self.api = api
        self.tokens = tokens
        self.clock = clock
    }

    /// Seconds to wait before the next poll, given how long we have waited.
    public static func interval(afterWaiting waited: Double, previous: Double, hadError: Bool) -> Double {
        if waited < fastPhase && !hadError { return firstInterval }
        return min(maxInterval, max(firstInterval, previous * 1.5))
    }

    /// Runs until an outcome or until the calling Task is cancelled (throws
    /// CancellationError, so leaving the waiting screen stops the polling).
    public func wait(requestId: String) async throws -> ApprovalOutcome {
        let start = clock.now()
        var delay = Self.firstInterval
        while true {
            try Task.checkCancellation()
            var hadError = false
            do {
                let s = try await api.watchStatus(requestId: requestId)
                switch s.status {
                case .approved:
                    guard let token = s.token, !token.isEmpty else { return .expired }
                    let player = s.player ?? .init(id: String(token.split(separator: ".").first ?? ""), name: nil, number: nil)
                    let cred = WatchCredential(token: token, exp: s.exp, player: player)
                    tokens.save(cred)
                    return .approved(cred)
                case .denied: return .denied
                case .expired: return .expired
                case .pending: break
                }
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                hadError = true
            }
            let waited = clock.now().timeIntervalSince(start)
            if waited >= Self.timeout { return .timedOut }
            delay = Self.interval(afterWaiting: waited, previous: delay, hadError: hadError)
            try await clock.sleep(seconds: min(delay, Self.timeout - waited))
        }
    }
}
