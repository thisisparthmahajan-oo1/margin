import Capacitor
import UIKit

/// Lets the app offer to save a link you copied elsewhere, since a share-sheet extension needs
/// the paid Apple Developer Program. `check` looks for a web link *without* reading the clipboard,
/// so iOS shows no paste prompt; `readLink` reads it (iOS asks "Allow Paste") only after the user taps Save.
@objc(ClipboardLinkPlugin)
public class ClipboardLinkPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ClipboardLinkPlugin"
    public let jsName = "ClipboardLink"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "check", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readLink", returnType: CAPPluginReturnPromise),
    ]

    @objc func check(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let pasteboard = UIPasteboard.general
            // changeCount identifies this particular copy, so the app asks once per copied link.
            let changeCount = pasteboard.changeCount
            guard pasteboard.hasStrings || pasteboard.hasURLs else {
                call.resolve(["hasLink": false, "changeCount": changeCount])
                return
            }
            pasteboard.detectPatterns(for: [\UIPasteboard.DetectedValues.probableWebURL]) { result in
                let hasLink = (try? result.get())?.contains(\UIPasteboard.DetectedValues.probableWebURL) ?? false
                call.resolve(["hasLink": hasLink, "changeCount": changeCount])
            }
        }
    }

    @objc func readLink(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let pasteboard = UIPasteboard.general
            call.resolve(["text": pasteboard.url?.absoluteString ?? pasteboard.string ?? ""])
        }
    }
}
