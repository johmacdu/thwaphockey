// swift-tools-version:5.9
// ThwapCore: the pure-logic layer of the Thwap watch app (models, API seam,
// offline check-off queue, ring math, drill timer, App Group ring store).
// No UI, no WatchKit, so it is unit-testable on macOS with `swift test` and is
// linked into the watch app, the complication and the watch test bundle.
import PackageDescription

let package = Package(
    name: "ThwapCore",
    platforms: [.watchOS(.v10), .macOS(.v14), .iOS(.v17)],
    products: [.library(name: "ThwapCore", targets: ["ThwapCore"])],
    targets: [
        .target(name: "ThwapCore"),
        // Fixtures are read from the source tree via #filePath (works for both
        // `swift test` and the watch simulator test bundle), not bundled.
        .testTarget(name: "ThwapCoreTests", dependencies: ["ThwapCore"], exclude: ["Fixtures"]),
    ]
)
