import AppKit
import BetterMDCore
import SwiftUI

@main
struct BetterMDApp: App {
    @State private var model: AppModel
    /// 退出、关窗口时存下所有改动（见 AppDelegate）
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    init() {
        // 用 swift run 直接启动时也要像普通 App 一样出现在程序坞里。
        NSApplication.shared.setActivationPolicy(.regular)
        // 先搬家（如果需要），再决定读哪个目录
        let notice = LibraryLocation.moveLegacyLibraryToICloudIfNeeded()
        let model = AppModel(root: LibraryLocation.current)
        model.lastError = notice
        _model = State(initialValue: model)
    }

    var body: some Scene {
        // 只有一个窗口：菜单命令（专注、搜索、快捷键表）都是发给“这个窗口”的，开出第二个窗口会同时作用到两个
        Window("BetterMD", id: "main") {
            ContentView()
                .environment(model)
                .frame(minWidth: 960, minHeight: 600)
                .task {
                    delegate.model = model
                    model.load()
                    NSApplication.shared.activate()
                    await DebugSnapshot.runIfRequested(model: model)
                }
        }
        .commands { BetterMDCommands(model: model) }
    }
}
