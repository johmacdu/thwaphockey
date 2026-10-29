import Foundation
import XCTest
@testable import ThwapCore

/// Loads a JSON fixture captured from the server handlers. Error fixtures are
/// wrapped as `{ "status": <int>, "body": {...} }`; plain ones are a 200 body.
enum Fixture {
    static let dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Fixtures")

    static func raw(_ name: String) -> Data {
        let url = dir.appendingPathComponent("\(name).json")
        guard let data = try? Data(contentsOf: url) else {
            XCTFail("missing fixture \(name).json at \(url.path)")
            return Data()
        }
        return data
    }

    /// (status, body) ready for the fake transport.
    static func response(_ name: String) -> (Int, Data) {
        let data = raw(name)
        if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let status = obj["status"] as? Int, let body = obj["body"] {
            return (status, try! JSONSerialization.data(withJSONObject: body))
        }
        return (200, data)
    }
}

/// Records every request and answers from a handler. Thread safe.
final class FakeTransport: HTTPTransport, @unchecked Sendable {
    typealias Handler = (URLRequest) throws -> (Int, Data)
    private let lock = NSLock()
    private var _requests: [URLRequest] = []
    private var handler: Handler

    init(_ handler: @escaping Handler) { self.handler = handler }

    /// Always answers with one fixture.
    convenience init(fixture: String) {
        self.init { _ in Fixture.response(fixture) }
    }

    var requests: [URLRequest] { lock.lock(); defer { lock.unlock() }; return _requests }

    func setHandler(_ h: @escaping Handler) { lock.lock(); handler = h; lock.unlock() }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        lock.lock()
        _requests.append(request)
        let h = handler
        lock.unlock()
        let (status, data) = try h(request)
        let http = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil)!
        return (data, http)
    }
}

extension URLRequest {
    var query: [String: String] {
        var out: [String: String] = [:]
        for item in URLComponents(url: url!, resolvingAgainstBaseURL: false)?.queryItems ?? [] {
            out[item.name] = item.value
        }
        return out
    }

    var jsonBody: [String: Any]? {
        guard let httpBody else { return nil }
        return try? JSONSerialization.jsonObject(with: httpBody) as? [String: Any]
    }
}

enum TestCreds {
    static let token = "lewie.wf5e12e33cfa021d3e5cdba13c5e45553.1796065200000.4c8c0bcb92ce4f0acf3df5a0f6e4938d1780a594fa19f16028b0fa527013d7e3"
    static let lewie = WatchCredential(token: token, exp: 1796065200000,
                                       player: .init(id: "lewie", name: "Lewie", number: 72))
}

struct OfflineError: Error {}
