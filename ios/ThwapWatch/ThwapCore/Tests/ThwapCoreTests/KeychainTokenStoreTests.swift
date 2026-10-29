import XCTest
@testable import ThwapCore

/// Real Keychain round trip. Runs in the watch simulator test host, where the
/// Keychain is available without signing; skipped under `swift test` on the
/// Mac, where an unsigned test runner may not reach the login Keychain.
final class KeychainTokenStoreTests: XCTestCase {
    func testSaveLoadClear() throws {
        #if os(watchOS) || os(iOS)
        let store = KeychainTokenStore(service: "com.thwaphockey.tests.\(UUID().uuidString)")
        XCTAssertNil(store.load())
        let status = store.store(TestCreds.lewie)
        if status == errSecMissingEntitlement {
            throw XCTSkip("unsigned build has no Keychain entitlement; run the signed test command in README")
        }
        XCTAssertEqual(status, errSecSuccess)
        XCTAssertEqual(store.load(), TestCreds.lewie)
        // Saving again replaces, never duplicates.
        var next = TestCreds.lewie
        next.token = "lewie.x.1.y"
        store.save(next)
        XCTAssertEqual(store.load()?.token, "lewie.x.1.y")
        store.clear()
        XCTAssertNil(store.load())
        #else
        throw XCTSkip("Keychain round trip runs on the watch simulator")
        #endif
    }
}
