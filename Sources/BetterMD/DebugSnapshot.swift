import AppKit
import BetterMDCore
import SwiftUI
import WebKit

/// 开发用：启动参数 `-snapshotPath /某处/图.png` 会在窗口出现两秒后，把整个窗口画成图片存下来，
/// 并在旁边写一份 `.txt`：每个列表实际有几行、AppModel 里有哪些笔记、编辑器网页里渲染出了什么。
/// 编辑器（WKWebView）画不进窗口图，另存成 `图-editor.png`。然后退出。
/// 可选参数：`-snapshotNote 标题里的字` 先选中这篇笔记；`-snapshotAppearance dark` 用深色外观；
/// `-snapshotSelect "起|止"` 在编辑器里从“起”选到“止”（看选区的样子）；`-snapshotScope folder:工作` 侧栏范围；
/// `-snapshotTag 会议` 标签筛选；`-snapshotQuery 词` 搜索；`-snapshotFocus YES` 专注模式。
/// 没有屏幕录制权限时，用它检查界面。正常启动不受影响。
enum DebugSnapshot {
    @MainActor private static var probes: [String] = []

    @MainActor
    static func runIfRequested(model: AppModel) async {
        let defaults = UserDefaults.standard
        if let gallery = defaults.string(forKey: "snapshotGallery"), !gallery.isEmpty {
            if let wanted = defaults.string(forKey: "snapshotScope") { model.scope = scope(from: wanted) }
            renderGallery(to: URL(fileURLWithPath: (gallery as NSString).expandingTildeInPath), model: model)
            NSApplication.shared.terminate(nil)
            return
        }
        guard let path = defaults.string(forKey: "snapshotPath"), !path.isEmpty else { return }
        if defaults.string(forKey: "snapshotAppearance") == "dark" {
            NSApplication.shared.appearance = NSAppearance(named: .darkAqua)
        }
        if let wanted = defaults.string(forKey: "snapshotScope") { model.scope = scope(from: wanted) }
        if let wanted = defaults.string(forKey: "snapshotNote"),
           let note = model.notes.first(where: { $0.title.contains(wanted) }) {
            if !model.visibleNotes.contains(where: { $0.id == note.id }) { model.scope = .all }
            model.select(note.id)
        }
        if let filter = defaults.string(forKey: "snapshotTag") { model.tagFilter = filter }
        if let query = defaults.string(forKey: "snapshotQuery") { model.query = query }
        if defaults.bool(forKey: "snapshotFocus") {
            try? await Task.sleep(for: .seconds(1.5))
            NotificationCenter.default.post(name: .toggleFocusMode, object: true)
        }
        if defaults.bool(forKey: "snapshotFocusSearch") {
            try? await Task.sleep(for: .seconds(1.0))
            NotificationCenter.default.post(name: .focusSearch, object: false)
            for delay in [0.05, 0.3, 1.0] {
                try? await Task.sleep(for: .seconds(delay))
                let responder = NSApplication.shared.windows.first(where: \.isVisible)?.firstResponder
                let owner = (responder as? NSTextView)?.delegate.map { "\(type(of: $0))" } ?? ""
                probes.append("⌘F 后 \(delay)s：\(responder.map { "\(type(of: $0))" } ?? "nil") \(owner)")
            }
        }
        try? await Task.sleep(for: .seconds(2.5))
        defer { NSApplication.shared.terminate(nil) }
        if let range = defaults.string(forKey: "snapshotSelect"), let window = NSApplication.shared.windows.first(where: { $0.isVisible }),
           let web = window.contentView.flatMap(firstWebView) {
            let parts = range.components(separatedBy: "|")
            window.makeFirstResponder(web)
            _ = try? await web.callAsyncJavaScript("""
                const v = window.bettermd.view, text = v.state.doc.toString();
                const from = text.indexOf(start), end = text.indexOf(stop);
                v.focus();
                if (from >= 0 && end >= 0) v.dispatch({ selection: { anchor: from, head: end + stop.length } });
                """, arguments: ["start": parts.first ?? "", "stop": parts.last ?? ""], contentWorld: .page)
            try? await Task.sleep(for: .seconds(0.6))
        }
        let target = URL(fileURLWithPath: (path as NSString).expandingTildeInPath)
        guard let window = NSApplication.shared.windows.first(where: { $0.isVisible }),
              let view = window.contentView?.superview ?? window.contentView else { return }
        if let data = render(view, scale: window.backingScaleFactor) { try? data.write(to: target) }
        var text = report(view, model: model)
        if let web = firstWebView(in: view) {
            text += "\n" + (await editorReport(web))
            if let image = try? await web.takeSnapshot(configuration: nil),
               let tiff = image.tiffRepresentation,
               let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
                let editorPath = target.deletingPathExtension().path + "-editor.png"
                try? png.write(to: URL(fileURLWithPath: editorPath))
            }
        }
        try? text.write(to: target.appendingPathExtension("txt"), atomically: true, encoding: .utf8)
    }

    @MainActor
    private static func firstWebView(in view: NSView) -> WKWebView? {
        if let web = view as? WKWebView { return web }
        for child in view.subviews {
            if let web = firstWebView(in: child) { return web }
        }
        return nil
    }

    /// 编辑器网页里实际渲染出了什么：行数、公式、复选框、表格、图片、标签，以及正文用的字体。
    @MainActor
    private static func editorReport(_ web: WKWebView) async -> String {
        let script = """
        (() => {
          const q = s => document.querySelectorAll(s).length;
          const line = document.querySelector('.cm-line:not(.cm-h)');
          const h = document.querySelector('.cm-h1');
          return JSON.stringify({
            ready: !!window.bettermd, lines: q('.cm-line'), katex: q('.katex'), tasks: q('.cm-task-box'),
            tables: q('.cm-table'), images: q('.cm-image'), brokenImages: q('.cm-image.is-broken'), tags: q('.cm-tag'),
            codeLines: q('.cm-code'), hmarks: q('.cm-hmark'),
            bodyFont: line && getComputedStyle(line).fontFamily, h1Size: h && getComputedStyle(h).fontSize,
            songti: document.fonts.check('17px "Songti SC"'), iowan: document.fonts.check('17px "Iowan Old Style"'),
            katexFont: document.fonts.check('17px KaTeX_Main'),
          });
        })()
        """
        let result = try? await web.evaluateJavaScript(script)
        return "editor=" + ((result as? String) ?? "（取不到）")
    }

    /// 界面里每个表格（SwiftUI 的 List）有几行，再对照 AppModel 里的数据。
    @MainActor
    private static func report(_ root: NSView, model: AppModel) -> String {
        var lines: [String] = []
        func walk(_ view: NSView) {
            if let table = view as? NSTableView {
                lines.append("\(type(of: table)) rows=\(table.numberOfRows) frame=\(table.frame.integral)")
            }
            if let split = view as? NSSplitView {
                let widths = split.arrangedSubviews.map { "\(Int($0.frame.width))\($0.isHidden ? "(隐藏)" : "")" }
                lines.append("分栏宽度=\(widths.joined(separator: " | "))")
            }
            view.subviews.forEach(walk)
        }
        walk(root)
        lines.append("menuKeys=" + menuKeys(NSApplication.shared.mainMenu).joined(separator: " "))
        if let responder = root.window?.firstResponder {
            // 输入框拿到焦点时，第一响应者是它的字段编辑器（NSTextView），真正的输入框是它的代理
            let owner = (responder as? NSTextView)?.delegate.map { "\(type(of: $0))" } ?? ""
            lines.append("firstResponder=\(type(of: responder)) \(owner)")
        }
        lines.append("windows=\(NSApplication.shared.windows.filter(\.isVisible).count)")
        lines.append(contentsOf: probes)
        lines.append("scope=\(model.scope) selected=\(model.selectedNote?.title ?? "无")")
        lines.append("folders=\(model.folders)")
        lines.append("tags=\(model.tagTree.map(\.path))")
        lines.append("visible=\(model.visibleNotes.map(\.title))")
        return lines.joined(separator: "\n")
    }

    /// `-snapshotGallery 图.png`：把图标和界面小部件离屏画成一张样张（浅色、深色各一行），然后退出。
    /// 纯 SwiftUI 画的东西都能这样核对，不受窗口截图的限制。
    @MainActor
    private static func renderGallery(to target: URL, model: AppModel) {
        let window = WindowState()
        window.sidebarExpanded = Set(model.folders.map { "folder:" + $0 })
        let sheet = HStack(alignment: .top, spacing: 0) {
            ForEach([ColorScheme.light, .dark], id: \.self) { scheme in
                HStack(alignment: .top, spacing: 0) {
                    VStack(spacing: 0) {
                        SidebarTree()
                        Spacer(minLength: 0)
                        SidebarFooter()
                    }
                    .frame(width: 236, height: 560)
                    .background(scheme == .dark ? Color(white: 0.16) : Color(white: 0.95))
                    DebugGallery().frame(height: 560, alignment: .top).background(Ink.listPaper)
                }
                .environment(model)
                .environment(window)
                .environment(\.colorScheme, scheme)
            }
        }
        let renderer = ImageRenderer(content: sheet)
        renderer.scale = 2
        guard let image = renderer.nsImage, let tiff = image.tiffRepresentation,
              let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) else { return }
        try? png.write(to: target)
    }

    /// `-snapshotScope` 的写法：all、unfiled、todo、trash、folder:路径、tag:路径。
    private static func scope(from text: String) -> Scope {
        if text.hasPrefix("folder:") { return .folder(String(text.dropFirst(7))) }
        if text.hasPrefix("tag:") { return .tag(String(text.dropFirst(4))) }
        switch text {
        case "unfiled": return .unfiled
        case "todo": return .todo
        case "trash": return .trash
        default: return .all
        }
    }

    /// 菜单里所有快捷键（菜单的快捷键先于编辑器网页拿到按键，用来查冲突）。
    @MainActor
    private static func menuKeys(_ menu: NSMenu?) -> [String] {
        guard let menu else { return [] }
        return menu.items.flatMap { item -> [String] in
            var keys: [String] = []
            if !item.keyEquivalent.isEmpty {
                let m = item.keyEquivalentModifierMask
                let mods = (m.contains(.control) ? "⌃" : "") + (m.contains(.option) ? "⌥" : "")
                    + (m.contains(.shift) ? "⇧" : "") + (m.contains(.command) ? "⌘" : "")
                keys.append("\(mods)\(item.keyEquivalent)=\(item.title)")
            }
            return keys + menuKeys(item.submenu)
        }
    }

    /// 直接把图层树画进位图（SwiftUI 的内容在图层里，`cacheDisplay` 画不出来）。
    @MainActor
    private static func render(_ view: NSView, scale: CGFloat) -> Data? {
        view.layoutSubtreeIfNeeded()
        let size = view.bounds.size
        guard let layer = view.layer,
              let context = CGContext(
                data: nil, width: Int(size.width * scale), height: Int(size.height * scale),
                bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { return nil }
        context.scaleBy(x: scale, y: scale)
        layer.render(in: context)
        guard let image = context.makeImage() else { return nil }
        return NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
    }
}


/// 样张：图标放大看细节，也看实际大小；再加几行列表。
private struct DebugGallery: View {
    private func sample(_ title: String, _ body: String, pinned: Bool = false) -> Note {
        Note(path: title + ".md", text: "# \(title)\n\n\(body)", created: .now, modified: .now, isPinned: pinned)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 24) {
                EnvelopeIcon(open: false, size: 72)
                EnvelopeIcon(open: true, size: 72)
                LooseSheetIcon(size: 72)
                NotebookIcon(size: 64)
                RibbonView().scaleEffect(3, anchor: .topLeading).frame(width: 40, height: 60, alignment: .topLeading)
            }
            HStack(spacing: 14) {
                EnvelopeIcon(open: false)
                EnvelopeIcon(open: true)
                LooseSheetIcon()
                NotebookIcon()
                RibbonView()
                Text("宋体标题 Iowan Title").font(Ink.serif(15, bold: true)).foregroundStyle(Ink.text)
                Text("正文二级色").font(.system(size: 12.5)).foregroundStyle(Ink.text2)
            }
            VStack(spacing: 0) {
                NoteRow(note: sample("置顶的笔记", "置顶以后右上角挂一条书签丝带，排在最前。", pinned: true),
                        location: "工作 / BetterMD", terms: [], selected: false, separator: false)
                NoteRow(note: sample("选中的笔记", "选中的笔记像从一叠纸里抽出来的一张卡片。"),
                        location: nil, terms: [], selected: true, separator: false)
                NoteRow(note: sample("搜索周会", "命中的字加朱砂色底：周会在周一上午。"),
                        location: "未分类", terms: ["周会"], selected: false, separator: false)
            }
            .frame(width: 320)
        }
        .padding(24)
        .frame(width: 560, alignment: .leading)
    }
}
