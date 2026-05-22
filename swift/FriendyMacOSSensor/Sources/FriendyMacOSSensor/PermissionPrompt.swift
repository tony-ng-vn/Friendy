// Brings a headless CLI binary to the foreground so macOS can show Contacts/Calendar TCC prompts.

#if os(macOS) && canImport(AppKit)
import AppKit

/// CLI tools need a shared NSApplication before `CNContactStore.requestAccess` can present UI.
func prepareForSystemPermissionPrompt() {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    app.activate(ignoringOtherApps: true)
}
#else
func prepareForSystemPermissionPrompt() {}
#endif
