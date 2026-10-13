import Foundation
import UIKit
import Capacitor

/// Local Capacitor plugin for the selectable app-icon feature (see app-icons/README.md).
/// Registered under the jsName "DynamicAppIcon" so index.html's applyNative() picks it
/// up via its first lookup path: window.Capacitor.Plugins.DynamicAppIcon.change({ name }).
///
/// On iOS, `name` is the manifest's `iosKey` (e.g. "AltIcon-HandsGreen"), which must match
/// a CFBundleAlternateIcons entry in Info.plist. Passing an empty/nil name resets to the
/// primary icon.
@objc(AppIconPlugin)
public class AppIconPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppIconPlugin"
    public let jsName = "DynamicAppIcon"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "change", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setIcon", returnType: CAPPluginReturnPromise)
    ]

    @objc func change(_ call: CAPPluginCall) {
        setIcon(call)
    }

    @objc func setIcon(_ call: CAPPluginCall) {
        guard UIApplication.shared.supportsAlternateIcons else {
            call.reject("Alternate icons are not supported on this device")
            return
        }

        let name = call.getString("name")
        let targetName: String? = (name?.isEmpty ?? true) ? nil : name

        DispatchQueue.main.async {
            UIApplication.shared.setAlternateIconName(targetName) { error in
                if let error = error {
                    call.reject("Failed to set alternate icon: \(error.localizedDescription)", nil, error)
                } else {
                    call.resolve(["name": targetName ?? ""])
                }
            }
        }
    }
}
