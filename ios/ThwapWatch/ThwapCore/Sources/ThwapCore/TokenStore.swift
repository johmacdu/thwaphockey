import Foundation
import Security

/// What a parent approval hands the watch: the session token plus who it is
/// for. Stored as one Keychain item, so the token and the player it belongs to
/// can never drift apart.
public struct WatchCredential: Codable, Equatable, Sendable {
    public var token: String
    /// Expiry in milliseconds since 1970, as the server sends it.
    public var exp: Double?
    public var player: SessionResponse.Player

    public init(token: String, exp: Double?, player: SessionResponse.Player) {
        self.token = token
        self.exp = exp
        self.player = player
    }

    /// Kid-facing first name: the server name, else the id capitalised.
    public var firstName: String {
        let raw = (player.name?.isEmpty == false ? player.name! : player.id)
        let first = raw.split(separator: " ").first.map(String.init) ?? raw
        return first.prefix(1).uppercased() + first.dropFirst()
    }

    public func isExpired(now: Date = Date()) -> Bool {
        guard let exp else { return false }
        return now.timeIntervalSince1970 * 1000 >= exp
    }
}

/// Where the credential lives. Keychain on the watch, memory in tests.
public protocol TokenStore: Sendable {
    func load() -> WatchCredential?
    func save(_ credential: WatchCredential)
    func clear()
}

/// Keychain generic-password item, readable after first unlock, this device
/// only (never synced to iCloud, never restored onto another watch).
public struct KeychainTokenStore: TokenStore {
    public static let defaultService = "com.thwaphockey.app.watch.session"
    private let service: String
    private let account = "thwapSession"

    public init(service: String = KeychainTokenStore.defaultService) {
        self.service = service
    }

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }

    public func load() -> WatchCredential? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess,
              let data = out as? Data else { return nil }
        return try? JSONDecoder().decode(WatchCredential.self, from: data)
    }

    public func save(_ credential: WatchCredential) {
        guard let data = try? JSONEncoder().encode(credential) else { return }
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }

    public func clear() {
        SecItemDelete(query as CFDictionary)
    }
}

/// In-memory store for tests, previews and the stub launch mode. Counts saves
/// so a test can prove the token is stored exactly once.
public final class InMemoryTokenStore: TokenStore, @unchecked Sendable {
    private let lock = NSLock()
    private var value: WatchCredential?
    private var _saveCount = 0

    public init(_ initial: WatchCredential? = nil) { value = initial }

    public var saveCount: Int { lock.lock(); defer { lock.unlock() }; return _saveCount }

    public func load() -> WatchCredential? { lock.lock(); defer { lock.unlock() }; return value }

    public func save(_ credential: WatchCredential) {
        lock.lock(); defer { lock.unlock() }
        value = credential
        _saveCount += 1
    }

    public func clear() { lock.lock(); defer { lock.unlock() }; value = nil }
}
