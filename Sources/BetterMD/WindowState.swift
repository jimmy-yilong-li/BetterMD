import SwiftUI

extension Notification.Name {
    /// 菜单「专注模式」（⌘⇧D），或者在专注模式里按 Esc（object 为 false）。
    static let toggleFocusMode = Notification.Name("BetterMD.toggleFocusMode")
    /// 菜单「键盘快捷键」（⌘/）。
    static let showShortcuts = Notification.Name("BetterMD.showShortcuts")
}

/// 窗口自己的界面状态（不属于笔记数据）：专注模式、快捷键表。
@MainActor
@Observable
final class WindowState {
    /// 专注模式：侧栏和列表收起，只留编辑区；编辑区里光标所在的那一段以外都变淡。
    var focusMode = false
    var showShortcuts = false
}

/// 快捷键表：键帽样式。
struct ShortcutsView: View {
    @Environment(\.dismiss) private var dismiss

    private let groups: [(String, [(String, String)])] = [
        ("笔记", [
            ("新建笔记", "⌘N"), ("搜索当前范围", "⌘F"), ("搜索全部笔记", "⌘⇧F"),
            ("切换笔记（在列表里）", "↑ ↓"), ("立即保存", "⌘S"),
        ]),
        ("编辑", [
            ("加粗 / 斜体 / 删除线", "⌘B / ⌘I / ⌘⇧X"), ("行内代码", "⌘E"), ("插入链接", "⌘K"),
            ("插入公式", "⌘⇧E"), ("变成待办、勾上待办", "⌘⇧T"), ("一二三级标题、变回正文", "⌘1 ⌘2 ⌘3 ⌘0"),
            ("撤销 / 重做", "⌘Z / ⌘⇧Z"),
        ]),
        ("窗口", [
            ("专注模式", "⌘⇧D"), ("退出专注、关闭面板", "Esc"), ("显示或隐藏侧栏", "⌥⌘S"), ("查看快捷键", "⌘/"),
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
