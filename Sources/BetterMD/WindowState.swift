import SwiftUI

extension Notification.Name {
    /// 菜单「专注模式」（⇧⌘D），或者在专注模式里按 Esc（object 为 false）。
    static let toggleFocusMode = Notification.Name("BetterMD.toggleFocusMode")
    /// 菜单「键盘快捷键」（⌘/）。
    static let showShortcuts = Notification.Name("BetterMD.showShortcuts")
    /// 把键盘焦点交给某一栏（object 是 Pane 的 rawValue）：编辑器里按 ⌘↩ 回到列表就是它。
    static let focusPane = Notification.Name("BetterMD.focusPane")
    /// 菜单栏的格式、查找命令，交给编辑器做（object 是命令名，见 editor/src/main.js 的 FORMATS）。
    static let editorCommand = Notification.Name("BetterMD.editorCommand")
}

/// 窗口里的三栏。
enum Pane: String {
    case sidebar, list, editor
}

/// 窗口自己的界面状态（不属于笔记数据）：专注模式、快捷键表、键盘焦点在哪一栏、侧栏展开了哪些。
@MainActor
@Observable
final class WindowState {
    /// 专注模式：侧栏和列表收起，只留编辑区；编辑区里光标所在的那一段以外都变淡。
    var focusMode = false
    var showShortcuts = false
    /// ⇧⌘F：每加一，列表上方的搜索框就拿一次焦点
    private(set) var searchFocusRequest = 0
    /// 上一次请搜索框拿焦点的时间。专注模式里搜索框不在，退出时才新建：新建的搜索框看到请求是刚发的，也要去拿焦点
    private(set) var searchFocusRequestedAt = Date.distantPast

    func requestSearchFocus() {
        searchFocusRequest += 1
        searchFocusRequestedAt = .now
    }
    /// 请某一栏拿键盘焦点（← → 在三栏之间切换）。serial 每次加一，同一栏连着请两次也算两次。
    private(set) var paneRequest = PaneRequest(pane: .list, serial: 0)
    /// 侧栏里展开着的文件夹和标签（"folder:路径"、"tag:路径"）
    var sidebarExpanded: Set<String> = []
    /// 侧栏的「标签」这一组是不是展开着
    var tagsOpen = true
    /// 侧栏现在看不看得见（收起来时 ← 不往那儿走）
    var sidebarShown = true
    /// 侧栏里正在就地新建或重命名的文件夹。这时方向键、回车都归输入框，侧栏不接。
    var folderEdit: FolderEdit?

    enum FolderEdit: Equatable {
        /// 在这个文件夹里新建（"" 是「我的笔记」下面）
        case create(parent: String)
        case rename(path: String)
    }

    struct PaneRequest: Equatable {
        var pane: Pane
        var serial: Int
    }

    func focus(_ pane: Pane) {
        paneRequest = PaneRequest(pane: pane, serial: paneRequest.serial + 1)
    }
}

extension EnvironmentValues {
    /// 这一栏（侧栏、列表）有没有键盘焦点：有的话，选中的那一项加一圈朱砂色细边，看得出按键会作用在哪里。
    @Entry var paneHasKeyFocus = false
}

/// 快捷键表：键帽样式。
struct ShortcutsView: View {
    @Environment(\.dismiss) private var dismiss

    private let groups: [(String, [(String, String)])] = [
        ("笔记", [
            ("新建笔记", "⌘N"), ("搜索笔记 / 搜索全部笔记", "⇧⌘F / ⌥⇧⌘F"), ("置顶", "⇧⌘P"),
            ("移到废纸篓 / 放回原处", "⌘⌫ / ⇧⌘R"), ("我的笔记、未分类、待办、废纸篓", "⌥⌘1 ⌥⌘2 ⌥⌘3 ⌥⌘0"),
            ("立即保存", "⌘S"),
        ]),
        ("在三栏之间走", [
            ("上一项 / 下一项", "↑ / ↓"), ("去右边一栏 / 左边一栏", "→ / ←"), ("从列表进正文", "↩"),
            ("从正文回到列表", "⌘↩"), ("在列表里搜索", "直接打字"),
        ]),
        ("文字", [
            ("粗体 / 斜体 / 删除线", "⌘B / ⌘I / ⇧⌘U"), ("行内代码 / 链接", "⌥⌘C / ⌘K"), ("公式", "⇧⌘E"),
            ("一到六级标题 / 变回正文", "⌘1…⌘6 / ⌘0"), ("列表 / 编号列表", "⌘L / ⇧⌘L"),
            ("待办 / 勾上待办", "⌘T / ⌘."), ("引用", "⇧⌘T"), ("代码块 / 表格", "⌃⌘C / ⌥⌘T"),
            ("插入图片或文件", "⇧⌘V"), ("日期时间 / 日期 / 短日期 / 时间", "⇧⌘7 ⇧⌘8 ⇧⌘9 ⇧⌘0"),
            ("上移一行 / 下移一行", "⌥⌘↑ / ⌥⌘↓"), ("缩进 / 减少缩进", "⇥ / ⇧⇥"), ("折叠或展开这一节", "⌘'"),
            ("撤销 / 重做", "⌘Z / ⇧⌘Z"),
        ]),
        ("查找", [
            ("在这篇笔记里查找 / 替换", "⌘F / ⌥⌘F"), ("下一个 / 上一个", "⌘G / ⇧⌘G"),
        ]),
        ("窗口", [
            ("专注模式", "⇧⌘D"), ("退出专注、关闭面板", "Esc"), ("显示或隐藏侧栏", "⌥⌘S"),
            ("放大 / 缩小", "⌘+ / ⌘-"), ("查看快捷键", "⌘/"),
        ]),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("键盘快捷键").font(Ink.serif(17, bold: true)).foregroundStyle(Ink.text)
                .padding(EdgeInsets(top: 18, leading: 22, bottom: 6, trailing: 22))
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(groups, id: \.0) { title, items in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(title).font(.system(size: 11, weight: .semibold)).foregroundStyle(Ink.text3)
                            ForEach(items, id: \.0) { label, keys in
                                HStack {
                                    Text(label).font(.system(size: 13)).foregroundStyle(Ink.text)
                                    Spacer(minLength: 24)
                                    KeyCaps(keys)
                                }
                            }
                        }
                    }
                }
                .padding(EdgeInsets(top: 8, leading: 22, bottom: 20, trailing: 22))
            }
        }
        .frame(width: 440, height: 520)
        .background(PaperBackground(color: Ink.paper))
        .onExitCommand { dismiss() }
    }
}

/// 一组键帽：“⌘⇧F”画成 ⌘ ⇧ F 三个小键，“/”“空格”隔开的分组之间留空。
private struct KeyCaps: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        HStack(spacing: 4) {
            ForEach(Array(text.split(separator: " ").enumerated()), id: \.offset) { _, word in
                if word == "/" {
                    Text("/").font(.system(size: 12)).foregroundStyle(Ink.text3)
                } else {
                    Text(word)
                        .font(.system(size: 12).monospacedDigit())
                        .foregroundStyle(Ink.text2)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2.5)
                        .background(
                            RoundedRectangle(cornerRadius: 6, style: .continuous)
                                .fill(LinearGradient(colors: [Ink.paper, Ink.listPaper], startPoint: .top, endPoint: .bottom))
                                .shadow(color: Ink.text3.opacity(0.45), radius: 0, y: 1.5)
                                .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(Ink.separator, lineWidth: 0.5))
                        )
                }
            }
        }
    }
}
