import UIKit
import WebKit
import Capacitor

/// Custom bridge view controller so the local AppIconPlugin can be registered.
/// A Swift-only local Capacitor plugin (CAPBridgedPlugin, no Objective-C bridging
/// header) is not auto-discovered; it must be registered explicitly via
/// capacitorDidLoad(). Wired in Main.storyboard's Bridge View Controller scene.
class MainViewController: CAPBridgeViewController {
    private var loadingObservation: NSKeyValueObservation?

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(AppIconPlugin())

        // Rubber-band scrolling past the top or bottom showed the dark launch
        // colour (capacitor.config backgroundColor, #0b0f14) as black edges, even
        // in light mode. That colour is only there to avoid a white flash while
        // the first page loads. Once it has loaded, make the web view opaque so
        // the overscroll area uses WebKit's under-page colour, which follows the
        // page's own background and so matches light and dark mode.
        guard let webView = webView else { return }
        loadingObservation = webView.observe(\.isLoading, options: [.new]) { [weak self] view, _ in
            guard !view.isLoading else { return }
            view.isOpaque = true
            view.backgroundColor = nil
            view.scrollView.backgroundColor = nil
            view.underPageBackgroundColor = nil   // nil = follow the page background
            self?.loadingObservation = nil
        }
    }
}
