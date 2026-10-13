import UIKit
import Capacitor

/// Custom bridge view controller so the local AppIconPlugin can be registered.
/// A Swift-only local Capacitor plugin (CAPBridgedPlugin, no Objective-C bridging
/// header) is not auto-discovered; it must be registered explicitly via
/// capacitorDidLoad(). Wired in Main.storyboard's Bridge View Controller scene.
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(AppIconPlugin())
    }
}
