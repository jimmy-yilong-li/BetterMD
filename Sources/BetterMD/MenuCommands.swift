import AppKit
import BetterMDCore
import SwiftUI
import WebKit

/// 菜单栏。快捷键照 Bear（见 docs/bear-reference.md）；⇧⌘E 公式、⇧⌘D 专注模式、⌘0 变回正文是 BetterMD 自己的。
/// 编辑器有焦点时，格式和查找的快捷键先由编辑器网页处理；编辑器没焦点（比如焦点在列表上）时才轮到这里，
/// 这时把命令交给编辑器做（Notification.Name.editorCommand）。
struct BetterMDCommands: Commands {
    let model: AppModel

    var body: some Commands {
        fileAndEdit
        menus
    }

    /// 「文件」「编辑」里的命令。（一个 body 里最多放 10 组，分成两半）
    @CommandsBuilder private var fileAndEdit: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("新建笔记") { model.newNote() }
                .keyboardShortcut("n")
        }
        CommandGroup(after: .newItem) {
            Divider()
            Button("选择笔记库位置…") { chooseLibrary() }
        }
        CommandGroup(replacing: .saveItem) {
            Button("关闭窗口") { NSApp.keyWindow?.performClose(nil) }
                .keyboardShortcut("w")
            Button("立即保存") { model.flushPendingSave() }
                .keyboardShortcut("s")
        }
        CommandGroup(replacing: .printItem) {}
        // 「隐藏工具栏」默认是 ⌥⌘T，这个键让给插入表格
        CommandGroup(replacing: .toolbar) {}

        CommandGroup(after: .pasteboard) {
            Divider()
            Group {
                Button("查找…") { editor("find") }
                    .keyboardShortcut("f")
                Button("查找并替换…") { editor("replace") }
                    .keyboardShortcut("f", modifiers: [.command, .option])
                Button("查找下一个") { editor("findNext") }
                    .keyboardShortcut("g")
                Button("查找上一个") { editor("findPrevious") }
                    .keyboardShortcut("g", modifiers: [.command, .shift])
            }
            .disabled(!flags.hasNote)
            Divider()
            Button("搜索笔记") { NotificationCenter.default.post(name: .focusSearch, object: false) }
                .keyboardShortcut("f", modifiers: [.command, .shift])
            Button("搜索全部笔记") { NotificationCenter.default.post(name: .focusSearch, object: true) }
                .keyboardShortcut("f", modifiers: [.command, .shift, .option])
        }

    }

    /// 「格式」「笔记」「显示」「帮助」。
    @CommandsBuilder private var menus: some Commands {
        CommandMenu("格式") {
            formatMenu.disabled(!flags.editable)
            Divider()
            // 折叠只是看的方式，废纸篓里的笔记也能折
            Button("折叠或展开这一节") { editor("fold") }.keyboardShortcut("'")
                .disabled(!flags.hasNote)
        }
        CommandMenu("笔记") { noteMenu }

        SidebarCommands() // 显示或隐藏侧栏：⌥⌘S
        CommandGroup(after: .sidebar) {
            Button("专注模式") { NotificationCenter.default.post(name: .toggleFocusMode, object: nil) }
                .keyboardShortcut("d", modifiers: [.command, .shift])
            Divider()
            Button("放大") { EditorZoom.step(1) }
                .keyboardShortcut("+")
            Button("缩小") { EditorZoom.step(-1) }
                .keyboardShortcut("-")
            Button("实际大小") { EditorZoom.reset() }
        }
        CommandGroup(replacing: .help) {
            Button("键盘快捷键") { NotificationCenter.default.post(name: .showShortcuts, object: nil) }
                .keyboardShortcut("/")
        }
    }

    /// 选中的笔记的状态。只读这几样，不读 selectedNote：那样每打一个字菜单栏都要重建。
    private var flags: AppModel.SelectionFlags { model.selectionFlags }

    @ViewBuilder private var formatMenu: some View {
        Button("粗体") { editor("bold") }.keyboardShortcut("b")
        Button("斜体") { editor("italic") }.keyboardShortcut("i")
        Button("删除线") { editor("strike") }.keyboardShortcut("u", modifiers: [.command, .shift])
        Button("行内代码") { editor("code") }.keyboardShortcut("c", modifiers: [.command, .option])
        Button("链接") { editor("link") }.keyboardShortcut("k")
        Button("公式") { editor("math") }.keyboardShortcut("e", modifiers: [.command, .shift])
        Divider()
        Menu("标题") {
            ForEach(1...6, id: \.self) { level in
                Button("\(["一", "二", "三", "四", "五", "六"][level - 1])级标题") { editor("h\(level)") }
                    .keyboardShortcut(KeyEquivalent(Character("\(level)")))
            }
            Button("正文") { editor("paragraph") }.keyboardShortcut("0")
        }
        Button("列表") { editor("list") }.keyboardShortcut("l")
        Button("编号列表") { editor("numbered") }.keyboardShortcut("l", modifiers: [.command, .shift])
        Button("待办") { editor("todo") }.keyboardShortcut("t")
        Button("勾上或取消待办") { editor("done") }.keyboardShortcut(".")
        Button("引用") { editor("quote") }.keyboardShortcut("t", modifiers: [.command, .shift])
        Divider()
        Button("代码块") { editor("codeBlock") }.keyboardShortcut("c", modifiers: [.command, .control])
        Button("表格") { editor("table") }.keyboardShortcut("t", modifiers: [.command, .option])
        Button("分割线") { editor("rule") }
        Button("插入图片或文件…") { editor("insertFile") }.keyboardShortcut("v", modifiers: [.command, .shift])
        Menu("插入日期") {
            Button("日期和时间") { editor("dateTime") }.keyboardShortcut("7", modifiers: [.command, .shift])
            Button("日期") { editor("date") }.keyboardShortcut("8", modifiers: [.command, .shift])
            Button("短日期") { editor("shortDate") }.keyboardShortcut("9", modifiers: [.command, .shift])
            Button("时间") { editor("time") }.keyboardShortcut("0", modifiers: [.command, .shift])
        }
        Divider()
        Button("上移一行") { editor("moveUp") }.keyboardShortcut(.upArrow, modifiers: [.command, .option])
        Button("下移一行") { editor("moveDown") }.keyboardShortcut(.downArrow, modifiers: [.command, .option])
    }

    @ViewBuilder private var noteMenu: some View {
        // 动作里现取选中的笔记，不用菜单建好时的旧值
        Button(flags.isPinned ? "取消置顶" : "置顶") {
            if !blockedBySheet, let note = model.selectedNote, !note.isTrashed { model.togglePin(note.id) }
        }
        .keyboardShortcut("p", modifiers: [.command, .shift])
        .disabled(!flags.editable)
        Button("移到废纸篓") { trashSelected() }
            .keyboardShortcut(.delete)
            .disabled(!flags.editable)
        Button("放回原处") {
            if !blockedBySheet, let note = model.selectedNote, note.isTrashed { model.restore(note.id) }
        }
        .keyboardShortcut("r", modifiers: [.command, .shift])
        .disabled(!flags.isTrashed)
        Button("在 Finder 中显示") {
            if let note = model.selectedNote { NSWorkspace.shared.activateFileViewerSelecting([model.store.url(for: note.path)]) }
        }
        .disabled(!flags.hasNote)
        Divider()
        Button("我的笔记") { model.scope = .all }.keyboardShortcut("1", modifiers: [.command, .option])
        Button("未分类") { model.scope = .unfiled }.keyboardShortcut("2", modifiers: [.command, .option])
        Button("待办") { model.scope = .todo }.keyboardShortcut("3", modifiers: [.command, .option])
        Button("废纸篓") { model.scope = .trash }.keyboardShortcut("0", modifiers: [.command, .option])
        Divider()
        Button("回到笔记列表") { NotificationCenter.default.post(name: .focusPane, object: Pane.list.rawValue) }
            .keyboardShortcut(.return)
    }

    private func editor(_ command: String) {
        guard !blockedBySheet else { return }
        NotificationCenter.default.post(name: .editorCommand, object: command)
    }

    /// 有面板（快捷键表、提示框）挡在前面时，菜单命令不去动后面的笔记。
    private var blockedBySheet: Bool {
        NSApp.keyWindow?.sheetParent != nil || NSApp.mainWindow?.attachedSheet != nil
    }

    /// ⌘⌫ 只在侧栏、列表里删笔记：在输入框里（搜索框、文件夹名字）是“删到行首”；
    /// 焦点在编辑器网页里（比如点了查找栏的按钮）时什么都不做。
    private func trashSelected() {
        guard !blockedBySheet else { return }
        let responder = NSApp.keyWindow?.firstResponder
        if let field = responder as? NSTextView, field.isFieldEditor {
            field.deleteToBeginningOfLine(nil)
            return
        }
        var view = responder as? NSView
        while let current = view {
            if current is WKWebView { return }
            view = current.superview
        }
        guard let note = model.selectedNote, !note.isTrashed else { return }
        model.trash(note.id)
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

/// 编辑区的字号（⌘+ / ⌘-），整个编辑器网页一起缩放；记在 UserDefaults 里，下次打开还是这个大小。
enum EditorZoom {
    static let key = "editorZoom"
    static let steps: [Double] = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6]

    static func step(_ direction: Int) {
        let current = UserDefaults.standard.object(forKey: key) as? Double ?? 1
        let index = steps.firstIndex { $0 >= current - 0.001 } ?? steps.count - 1
        UserDefaults.standard.set(steps[min(max(index + direction, 0), steps.count - 1)], forKey: key)
    }

    static func reset() {
        UserDefaults.standard.set(1.0, forKey: key)
    }
}
