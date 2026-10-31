import Foundation

/// The real client for thwaphockey.com.
///
/// Auth: the watch session token lives in a `TokenStore` (Keychain on the
/// watch) and rides on every signed-in call as `Cookie: thwapSession=<token>`,
/// the exact header `readSessionCookie` in lib/session_store.js reads. The
/// cookie jar is off (see `URLSessionTransport`), so the Keychain is the only
/// source of the token.
///
/// Status mapping: 401 on a signed-in call clears the token and calls
/// `onSignedOut`; 429 is `.rateLimited`; a transport error or an unreadable
/// body is `.offline`, which the check-off queue keeps and retries.
public final class LiveThwapAPI: ThwapAPI, @unchecked Sendable {
    public let baseURL: URL
    private let transport: HTTPTransport
    public let tokens: TokenStore
    private let lock = NSLock()
    private var signedOutHandler: (@Sendable () -> Void)?

    public init(baseURL: URL = ThwapConfig.defaultBaseURL,
                transport: HTTPTransport = URLSessionTransport(),
                tokens: TokenStore = KeychainTokenStore()) {
        self.baseURL = baseURL
        self.transport = transport
        self.tokens = tokens
    }

    /// Called (on any thread) when a signed-in call comes back 401.
    public func onSignedOut(_ handler: @escaping @Sendable () -> Void) {
        lock.lock(); signedOutHandler = handler; lock.unlock()
    }

    public var credential: WatchCredential? { tokens.load() }

    // MARK: Sign-in

    public func requestWatch(_ body: WatchRequestBody) async throws -> WatchRequestResponse {
        let clean = WatchRequestBody(teamCode: body.teamCode.trimmingCharacters(in: .whitespaces).uppercased(),
                                     code: body.code.trimmingCharacters(in: .whitespaces),
                                     deviceLabel: body.deviceLabel)
        // A 401 here is a wrong code, not a lost session: never clear a token.
        return try await call(.post, path: "/api/login", query: ["action": "watch-request"],
                              body: clean, auth: false, unauthorized: .badCode)
    }

    public func watchStatus(requestId: String) async throws -> WatchStatusResponse {
        try await call(.get, path: "/api/login",
                       query: ["action": "watch-status", "requestId": requestId], auth: false)
    }

    /// Tells the server to drop this watch from the parent's list, then
    /// forgets the token locally whatever the network says.
    public func logout() async throws {
        defer { tokens.clear() }
        let _: OKResponse = try await call(.post, path: "/api/login", query: ["action": "logout"],
                                           body: [String: String](), auth: true, clearOn401: false)
    }

    public func session() async throws -> SessionResponse {
        let s: SessionResponse = try await call(.get, path: "/api/login", query: ["action": "session"], auth: true)
        if !s.authed { signOutLocally() }
        return s
    }

    // MARK: Today

    public func todayDone() async throws -> DoneResponse {
        try await call(.get, path: "/api/done", auth: true)
    }

    public func todayView() async throws -> TodayViewResponse {
        try await call(.get, path: "/api/done", query: ["view": "today"], auth: true)
    }

    public func rings() async throws -> RingsResponse {
        try await call(.get, path: "/api/done", query: ["view": "rings"], auth: true)
    }

    public func gameGoals() async throws -> GameGoalsResponse {
        try await call(.get, path: "/api/coach", query: ["action": "my-game-goals"], auth: true)
    }

    /// view=today, plus my-game-goals. A goals failure (offline, or a server
    /// that does not take the watch token yet) never blocks the drill list; it
    /// just hides Game Day Goals.
    public func todayPlan() async throws -> TodayPlan {
        guard let cred = tokens.load() else { throw ThwapAPIError.unauthorized }
        let view = try await todayView()
        let goals = try? await gameGoals()
        return TodayPlan(
            date: view.date,
            playerId: cred.player.id,
            firstName: cred.firstName,
            drills: view.drills.compactMap(\.drill),
            game: goals?.gameDay == true ? goals?.game : nil,
            gameGoals: goals?.gameDay == true ? (goals?.goals ?? []) : [],
            restDay: view.restDay,
            bonusDay: view.bonusDay ?? false,
            serverGameDay: goals?.gameDay ?? false
        )
    }

    public func markDone(_ request: MarkDoneRequest) async throws -> MarkDoneResponse {
        try await call(.post, path: "/api/done", body: request, auth: true)
    }

    public func undoDone(_ request: UndoDoneRequest) async throws -> UndoDoneResponse {
        try await call(.post, path: "/api/done", body: request, auth: true)
    }

    // MARK: Plumbing

    enum Method: String { case get = "GET", post = "POST" }

    /// Builds the request. Internal so tests can assert the exact encoding.
    func makeRequest(_ method: Method, path: String, query: [String: String] = [:],
                     body: Data? = nil, auth: Bool) -> URLRequest {
        var comps = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty {
            comps.queryItems = query.keys.sorted().map { URLQueryItem(name: $0, value: query[$0]) }
        }
        var req = URLRequest(url: comps.url!)
        req.httpMethod = method.rawValue
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.cachePolicy = .reloadIgnoringLocalCacheData
        if let body {
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if auth, let token = tokens.load()?.token {
            req.setValue("thwapSession=\(token)", forHTTPHeaderField: "Cookie")
        }
        return req
    }

    private func call<T: Decodable>(_ method: Method, path: String, query: [String: String] = [:],
                                    auth: Bool, unauthorized: ThwapAPIError = .unauthorized,
                                    clearOn401: Bool = true) async throws -> T {
        try await perform(makeRequest(method, path: path, query: query, auth: auth),
                          auth: auth, unauthorized: unauthorized, clearOn401: clearOn401)
    }

    private func call<T: Decodable, B: Encodable>(_ method: Method, path: String, query: [String: String] = [:],
                                                  body: B, auth: Bool, unauthorized: ThwapAPIError = .unauthorized,
                                                  clearOn401: Bool = true) async throws -> T {
        let data = try JSONEncoder.thwap.encode(body)
        return try await perform(makeRequest(method, path: path, query: query, body: data, auth: auth),
                                 auth: auth, unauthorized: unauthorized, clearOn401: clearOn401)
    }

    private func perform<T: Decodable>(_ req: URLRequest, auth: Bool, unauthorized: ThwapAPIError,
                                       clearOn401: Bool) async throws -> T {
        if auth && tokens.load() == nil { throw ThwapAPIError.unauthorized }
        let data: Data
        let http: HTTPURLResponse
        do {
            (data, http) = try await transport.send(req)
        } catch let e as ThwapAPIError {
            throw e
        } catch {
            throw ThwapAPIError.offline
        }
        switch http.statusCode {
        case 200..<300:
            do { return try JSONDecoder().decode(T.self, from: data) } catch { throw ThwapAPIError.offline }
        case 401:
            if auth && clearOn401 { signOutLocally() }
            throw auth ? ThwapAPIError.unauthorized : unauthorized
        case 402: throw ThwapAPIError.seasonInactive
        case 403: throw ThwapAPIError.forbidden
        case 429: throw ThwapAPIError.rateLimited
        case 400..<500:
            let msg = (try? JSONDecoder().decode(ErrorBody.self, from: data))?.error ?? "bad request"
            throw ThwapAPIError.badRequest(msg)
        default:
            throw ThwapAPIError.server(http.statusCode)
        }
    }

    private func signOutLocally() {
        tokens.clear()
        lock.lock(); let h = signedOutHandler; lock.unlock()
        h?()
    }
}

extension JSONEncoder {
    /// Sorted keys so request bodies are byte-stable in tests.
    static var thwap: JSONEncoder {
        let e = JSONEncoder()
        e.outputFormatting = [.sortedKeys]
        return e
    }
}
