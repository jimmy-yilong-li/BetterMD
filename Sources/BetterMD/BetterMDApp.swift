import AppKit
import BetterMDCore
import SwiftUI

@main
struct BetterMDApp: App {
    @State private var model = AppModel(root: LibraryLocation.current)

    init() {
        // 用 swift run 直接启动时也要像普通 App 一样出现在程序坞里。
        NSApplication.shared.setActivationPolicy(.regular)
    }

    var body: some Scene {
        WindowGroup("BetterMD") {
            ContentView()
                .environment(model)
                .frame(minWidth: 960, minHeight: 600)
                .task {
                    model.load()
                    NSApplication.shared.activate()
                    await DebugSnapshot.runIfRequested(model: model)
                }
        }
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("新建笔记") { model.newNote() }
                    .keyboardShortcut("n")
            }
            CommandGroup(after: .newItem) {
                Divider()
                Button("选择笔记库位置…") { chooseLibrary() }
            }
            CommandGroup(after: .pasteboard) {
                Divider()
                Button("搜索") { NotificationCenter.default.post(name: .focusSearch, object: false) }
                    .keyboardShortcut("f")
                Button("搜索全部笔记") { NotificationCenter.default.post(name: .focusSearch, object: true) }
                    .keyboardShortcut("f", modifiers: [.command, .shift])
            }
            CommandGroup(after: .sidebar) {
                Button("专注模式") { NotificationCenter.default.post(name: .toggleFocusMode, object: nil) }
                    .keyboardShortcut("d", modifiers: [.command, .shift])
            }
            CommandGroup(replacing: .help) {
                Button("键盘快捷键") { NotificationCenter.default.post(name: .showShortcuts, object: nil) }
                    .keyboardShortcut("/")
            }
            CommandGroup(replacing: .saveItem) {
                Button("立即保存") { model.flushPendingSave() }
                    .keyboardShortcut("s")
            }
        }
    }

    private func chooseLibrary() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.prompt = "用这个文件夹"
        panel.message = "选一个文件夹当「我的笔记」"
        panel.directoryURL = LibraryLocation.current
        guard panel.runModal() == .OK, let url = panel.url else { return }
        LibraryLocation.current = url
        model.switchLibrary(to: url)
    }
}
