import AppKit
import BetterMDCore
import SwiftUI
import UniformTypeIdentifiers

/// 编辑区：所见即所得的 Markdown 编辑器。整个窗口只有一个编辑器实例，切换笔记时换内容。
/// 顶部左边是所在文件夹，右边两组按钮：「Aa 格式、图片」｜「专注、⋯ 更多」。
struct EditorView: View {
    @Environment(AppModel.self) private var model
    @Environment(WindowState.self) private var window
    @State private var handle = EditorHandle()
    @State private var showFormats = false
    /// 编辑区的字号（⌘+ / ⌘-）
    @AppStorage(EditorZoom.key) private var zoom = 1.0

    var body: some View {
        let note = model.selectedNote
        MarkdownEditor(model: model, note: note, selectTitle: note != nil && note?.id == model.freshNoteID, zoom: zoom, handle: handle)
            .background(Ink.paper.ignoresSafeArea())
            .overlay {
                if note == nil {
                    VStack(spacing: 8) {
                        Image(systemName: "text.page").font(.system(size: 30, weight: .light)).opacity(0.5)
                        Text("没有选中的笔记")
                        Text("在左边选一篇，或者按 ⌘N 新建").font(.system(size: 12))
                    }
                    .font(.system(size: 13))
                    .foregroundStyle(Ink.text3)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(PaperBackground(color: Ink.paper).ignoresSafeArea())
                }
            }
            .toolbar {
                // 编辑区这一段工具栏：左边所在文件夹，弹性空白，右边两组按钮
                ToolbarItem {
                    if let note { Crumb(note: note) }
                }
                .sharedBackgroundVisibility(.hidden)
                ToolbarSpacer(.flexible)
                ToolbarItem {
                    // 笔记库在 iCloud 里才显示云图标
                    if let note, LibraryLocation.isInICloud(model.store.root) { CloudBadge(note: note) }
                }
                .sharedBackgroundVisibility(.hidden)
                ToolbarItemGroup {
                    Button { showFormats.toggle() } label: {
                        // 系统图标会跟着 App 的语言换成中文写法，这里要的是效果图里的「Aa」
                        Image(systemName: "textformat").environment(\.locale, Locale(identifier: "en")).accessibilityLabel("格式")
                    }
                    .help("格式：标题、列表、表格、公式…")
                    .disabled(note == nil || note?.isTrashed == true)
                    .popover(isPresented: $showFormats, arrowEdge: .bottom) {
                        FormatPanel { kind in
                            showFormats = false
                            if kind == "image" { chooseFiles() } else { handle.format(kind) }
                        }
                    }
                    Button(action: chooseFiles) { Label("插入图片", systemImage: "photo") }
                        .help("插入图片或文件，存进「附件」")
                        .disabled(note == nil || note?.isTrashed == true)
                }
                ToolbarSpacer(.fixed)
                ToolbarItemGroup {
                    Button { window.focusMode.toggle() } label: {
                        Label("专注", systemImage: window.focusMode ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right")
                    }
                    .help(window.focusMode ? "退出专注模式（Esc）" : "专注模式（⇧⌘D）")
                    MoreMenu(note: note)
                }
            }
            .onChange(of: window.focusMode, initial: true) { _, on in
                handle.setFocusMode(on)
                // 列表收起来了，键盘焦点交给编辑器（Esc 退出专注模式也靠编辑器）
                if on { handle.focusEditor() }
            }
            .onChange(of: window.paneRequest) { _, request in
                if request.pane == .editor && note != nil { handle.focusEditor() }
            }
            .onReceive(NotificationCenter.default.publisher(for: .editorCommand)) { message in
                guard let command = message.object as? String, note != nil else { return }
                if command == "insertFile" { chooseFiles() } else { handle.format(command) }
            }
    }

    /// 从 Finder 选图片或文件，存进「附件/」，插在光标处。
    private func chooseFiles() {
        guard let note = model.selectedNote, !note.isTrashed else { return }
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.prompt = "插入"
        panel.message = "选要插入的图片或文件，会复制一份到「附件」里"
        guard panel.runModal() == .OK else { return }
        let items = panel.urls.compactMap { url -> EditorHandle.Attachment? in
            guard let data = try? Data(contentsOf: url),
                  let link = model.addAttachment(data, fileName: url.lastPathComponent, for: note.id) else { return nil }
            let image = UTType(filenameExtension: url.pathExtension)?.conforms(to: .image) ?? false
            return EditorHandle.Attachment(link: link, name: url.lastPathComponent, image: image)
        }
        handle.insert(items)
    }
}

/// 工具栏左边：这篇笔记在哪个文件夹；在废纸篓里时加一个标记。
private struct Crumb: View {
    let note: Note

    var body: some View {
        HStack(spacing: 6) {
            if note.folder.isEmpty { LooseSheetIcon(size: 14) } else { EnvelopeIcon(open: false, size: 14) }
            Text(note.folder.isEmpty ? "未分类" : note.folder.replacingOccurrences(of: "/", with: " / "))
                .lineLimit(1)
                .truncationMode(.head)
            if note.isTrashed {
                Text("在废纸篓里")
                    .font(.system(size: 11))
                    .foregroundStyle(Ink.text2)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 1)
                    .background(RoundedRectangle(cornerRadius: 6).fill(Ink.field))
            }
        }
        .font(.system(size: 12))
        .foregroundStyle(Ink.text3)
        .padding(.horizontal, 6)
    }
}

/// 工具栏右边的云图标：这篇笔记有没有传到 iCloud。上传是 iCloud 自己做的，这里每隔几秒读一次系统记下的状态。
private struct CloudBadge: View {
    @Environment(AppModel.self) private var model
    let note: Note
    /// 还没读到时是 nil
    @State private var status: CloudStatus?

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: 13))
            .foregroundStyle(isFailed ? Ink.accent : Ink.text3)
            .contentTransition(.symbolEffect(.replace))
            .padding(.horizontal, 4)
            .help(explanation)
            .accessibilityLabel(explanation)
            .task(id: model.store.url(for: note.path)) {
                let file = model.store.url(for: note.path)
                while !Task.isCancelled {
                    let now = await Task.detached(priority: .utility) { CloudStatus.of(file) }.value
                    guard !Task.isCancelled else { return }
                    status = now
                    // 传完了就读得慢一点；改了正文以后几秒内会看到它变成“正在上传”
                    try? await Task.sleep(for: now == .uploaded ? .seconds(4) : .seconds(1.5))
                }
            }
    }

    private var isFailed: Bool {
        if case .failed = status { return true }
        return false
    }

    private var symbol: String {
        switch status {
        case .uploaded: "checkmark.icloud"
        case .uploading, .local: "icloud.and.arrow.up"
        case .failed: "exclamationmark.icloud"
        case nil: "icloud"
        }
    }

    private var explanation: String {
        switch status {
        case .uploaded: "已存到 iCloud 云盘（修改于 \(NoteDate.label(for: note.modified))）"
        case .uploading, .local: "正在上传到 iCloud 云盘…"
        case .failed(let reason): "没能上传到 iCloud 云盘：\(reason)"
        case nil: "iCloud 云盘"
        }
    }
}

/// 格式面板（Aa）：常用格式一按就插入，底下提示也可以直接打 Markdown。
private struct FormatPanel: View {
    let pick: (String) -> Void

    private let items: [(kind: String, label: String, glyph: Glyph)] = [
        ("heading", "标题", .text("H", serif: true)), ("bold", "加粗", .text("B", serif: false)),
        ("italic", "斜体", .italic("I")), ("link", "链接", .symbol("link")),
        ("list", "列表", .symbol("list.bullet")), ("todo", "待办", .symbol("checkmark.square")),
        ("quote", "引用", .symbol("text.quote")), ("rule", "分割线", .text("· · ·", serif: false)),
        ("codeBlock", "代码块", .mono("{ }")), ("table", "表格", .symbol("tablecells")),
        ("math", "公式", .text("∑", serif: true)), ("image", "图片", .symbol("photo")),
    ]

    enum Glyph {
        case text(String, serif: Bool)
        case italic(String)
        case mono(String)
        case symbol(String)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            LazyVGrid(columns: Array(repeating: GridItem(.fixed(74), spacing: 2), count: 4), spacing: 2) {
                ForEach(items, id: \.kind) { item in
                    FormatButton(label: item.label, glyph: item.glyph) { pick(item.kind) }
                }
            }
            Divider()
            Text("也可以直接打 Markdown：# 标题　**粗体**　- 列表　$公式$")
                .font(.system(size: 11))
                .foregroundStyle(Ink.text3)
                .padding(.horizontal, 6)
                .padding(.bottom, 2)
        }
        .padding(8)
    }
}

private struct FormatButton: View {
    let label: String
    let glyph: FormatPanel.Glyph
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            VStack(spacing: 5) {
                glyphView.frame(height: 20)
                Text(label).font(.system(size: 11.5)).foregroundStyle(Ink.text2)
            }
            .frame(width: 74, height: 62)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(hovering ? Ink.hover : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle())
        .onHover { hovering = $0 }
    }

    @ViewBuilder private var glyphView: some View {
        switch glyph {
        case .text(let text, let serif):
            Text(text).font(serif ? Ink.serif(18, bold: true) : .system(size: 17, weight: .bold)).foregroundStyle(Ink.text)
        case .italic(let text):
            Text(text).font(Ink.serif(19)).italic().foregroundStyle(Ink.text)
        case .mono(let text):
            Text(text).font(.system(size: 14, weight: .semibold, design: .monospaced)).foregroundStyle(Ink.text)
        case .symbol(let name):
            Image(systemName: name).font(.system(size: 16)).foregroundStyle(Ink.text)
        }
    }
}

/// 更多（⋯）：置顶、移动到、专注模式、在 Finder 中显示、键盘快捷键、移到废纸篓。
private struct MoreMenu: View {
    @Environment(AppModel.self) private var model
    @Environment(WindowState.self) private var window
    let note: Note?

    var body: some View {
        Menu {
            if let note {
                Text("修改于 \(NoteDate.label(for: note.modified)) · 创建于 \(NoteDate.label(for: note.created))")
                Divider()
                if note.isTrashed {
                    Button("放回原处") { model.restore(note.id) }
                } else {
                    Button(note.isPinned ? "取消置顶" : "置顶") { model.togglePin(note.id) }
                    Menu("移动到") {
                        Button("未分类") { model.move(note.id, toFolder: "") }
                        ForEach(model.folders, id: \.self) { folder in
                            Button(folder.replacingOccurrences(of: "/", with: " / ")) { model.move(note.id, toFolder: folder) }
                        }
                    }
                }
                Button("在 Finder 中显示") {
                    NSWorkspace.shared.activateFileViewerSelecting([model.store.url(for: note.path)])
                }
                Divider()
            }
            Button(window.focusMode ? "退出专注模式" : "专注模式") { window.focusMode.toggle() }
            Button("键盘快捷键") { window.showShortcuts = true }
            if let note, !note.isTrashed {
                Divider()
                Button("移到废纸篓", role: .destructive) { model.trash(note.id) }
            }
        } label: {
            Label("更多", systemImage: "ellipsis")
        }
        .help("更多")
    }
}
