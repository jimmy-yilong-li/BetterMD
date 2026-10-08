import AppKit
import BetterMDCore
import SwiftUI

/// 三栏：侧栏 ｜ 笔记列表 ｜ 编辑区。
/// 分栏只分两栏（侧栏 ｜ 右边），列表和编辑区并排放在右边：macOS 26 的三栏 NavigationSplitView
/// 收不起中间那一栏，专注模式要把侧栏和列表都收起来，列表的宽度只能自己管。
struct ContentView: View {
    @Environment(AppModel.self) private var model
    @State private var window = WindowState()
    @State private var columns: NavigationSplitViewVisibility = .all
    /// 进专注模式前侧栏、列表的样子，退出时恢复
    @State private var columnsBeforeFocus: NavigationSplitViewVisibility = .all

    var body: some View {
        NavigationSplitView(columnVisibility: $columns) {
            SidebarView()
                .navigationSplitViewColumnWidth(min: 200, ideal: 236, max: 320)
        } detail: {
            GeometryReader { proxy in
                // 窗口窄的时候列表也窄一点（和效果图一样）
                let listWidth: CGFloat = proxy.size.width < 900 ? 280 : 320
                HStack(spacing: 0) {
                    // 专注模式：列表的栏宽平滑收到 0，里面的内容保持原宽，被编辑区盖住
                    NoteListView()
                        .frame(width: listWidth)
                        .frame(width: window.focusMode ? 0 : listWidth, alignment: .leading)
                        .opacity(window.focusMode ? 0 : 1)
                        .allowsHitTesting(!window.focusMode)
                    EditorView()
                }
                .animation(Motion.columns, value: window.focusMode)
            }
        }
        .tint(Ink.accent)
        .toolbar(removing: .title)
        .environment(window)
        .onChange(of: window.focusMode) { _, on in
            withAnimation(Motion.columns ?? .linear(duration: 0)) {
                if on {
                    columnsBeforeFocus = columns
                    columns = .detailOnly
                } else {
                    columns = columnsBeforeFocus // 原来侧栏是收着的，退出后还收着
                }
            }
        }
        .onChange(of: columns) { _, visible in
            // 专注模式里自己把侧栏拉出来，就算退出了专注模式
            if window.focusMode && visible != .detailOnly { window.focusMode = false }
        }
        .onReceive(NotificationCenter.default.publisher(for: .toggleFocusMode)) { note in
            window.focusMode = (note.object as? Bool) ?? !window.focusMode
        }
        .onReceive(NotificationCenter.default.publisher(for: .showShortcuts)) { _ in window.showShortcuts = true }
        .onReceive(NotificationCenter.default.publisher(for: .focusSearch)) { note in
            // ⌘F / ⌘⇧F：专注模式里先退出（列表和搜索框才回来），再让搜索框拿到焦点
            if window.focusMode { window.focusMode = false }
            if note.object as? Bool == true { model.searchAll = true }
            window.searchFocusRequest += 1
        }
        .sheet(isPresented: Bindable(window).showShortcuts) { ShortcutsView() }
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
            model.finishAll()
        }
    }

    private var errorShown: Binding<Bool> {
        Binding(get: { model.lastError != nil }, set: { if !$0 { model.lastError = nil } })
    }
}
