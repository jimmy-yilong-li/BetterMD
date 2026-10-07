import AppKit
import BetterMDCore
import SwiftUI

@main
struct BetterMDApp: App {
    init() {
        // 用 swift run 直接启动时也要像普通 App 一样出现在程序坞里。
        NSApplication.shared.setActivationPolicy(.regular)
    }

    var body: some Scene {
        WindowGroup("BetterMD") {
            Text("BetterMD \(BetterMDInfo.version)")
                .frame(minWidth: 960, minHeight: 600)
        }
    }
}
