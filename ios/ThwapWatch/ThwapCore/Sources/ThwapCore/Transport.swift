import Foundation

/// The one network seam under `LiveThwapAPI`. Production uses URLSession;
/// tests inject a fake that records requests and replays fixture bodies.
public protocol HTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

/// URLSession transport. Cookies are NOT handled by URLSession: the watch
/// sends `Cookie: thwapSession=<token>` itself from the Keychain, so the
/// shared cookie jar is switched off to keep exactly one source of truth.
public struct URLSessionTransport: HTTPTransport {
    private let session: URLSession

    public init(timeout: TimeInterval = 20) {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.timeoutIntervalForRequest = timeout
        config.waitsForConnectivity = false
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        session = URLSession(configuration: config)
    }

    public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw ThwapAPIError.offline }
        return (data, http)
    }
}

/// Where the real client points. Overridable with the `-thwapBaseURL <url>`
/// launch argument (a staging deploy) or an Info.plist `ThwapBaseURL` key.
public enum ThwapConfig {
    public static let defaultBaseURL = URL(string: "https://thwaphockey.com")!

    public static func baseURL(arguments: [String] = ProcessInfo.processInfo.arguments,
                               bundle: Bundle = .main) -> URL {
        if let i = arguments.firstIndex(of: "-thwapBaseURL"), i + 1 < arguments.count,
           let url = URL(string: arguments[i + 1]), url.scheme == "https" || url.host == "127.0.0.1" || url.host == "localhost" {
            return url
        }
        if let s = bundle.object(forInfoDictionaryKey: "ThwapBaseURL") as? String,
           let url = URL(string: s), url.scheme == "https" {
            return url
        }
        return defaultBaseURL
    }
}
