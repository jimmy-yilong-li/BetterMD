import AppKit
import BetterMDCore
import SwiftUI

/// 三栏：侧栏 ｜ 笔记列表 ｜ 编辑区。
struct ContentView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationSplitView {
            SidebarView()
                .navigationSplitViewColumnWidth(min: 200, ideal: 230, max: 320)
        } content: {
            NoteListView()
                .navigationSplitViewColumnWidth(min: 260, ideal: 320, max: 440)
        } detail: {
            EditorView()
        }
        .alert("出了点问题", isPresented: errorShown) {
            Button("知道了") { model.lastError = nil }
        } message: {
            Text(model.lastError ?? "")
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            model.reload()
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.willResignActiveNotification)) { _ in
            model.flushPendingSave()
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.willTerminateNotification)) { _ in
            model.flushPendingSave()
        }
    }

    private var errorShown: Binding<Bool> {
        Binding(get: { model.lastError != nil }, set: { if !$0 { model.lastError = nil } })
    }
}
