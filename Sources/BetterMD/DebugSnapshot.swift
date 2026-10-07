import AppKit
import BetterMDCore
import WebKit

/// 开发用：启动参数 `-snapshotPath /某处/图.png` 会在窗口出现两秒后，把整个窗口画成图片存下来，
/// 并在旁边写一份 `.txt`：每个列表实际有几行、AppModel 里有哪些笔记、编辑器网页里渲染出了什么。
/// 编辑器（WKWebView）画不进窗口图，另存成 `图-editor.png`。然后退出。
/// 另外两个可选参数：`-snapshotNote 标题里的字` 先选中这篇笔记；`-snapshotAppearance dark` 用深色外观。
/// 没有屏幕录制权限时，用它检查界面。正常启动不受影响。
enum DebugSnapshot {
    @MainActor
    static func runIfRequested(model: AppModel) async {
        let defaults = UserDefaults.standard
        guard let path = defaults.string(forKey: "snapshotPath"), !path.isEmpty else { return }
        if defaults.string(forKey: "snapshotAppearance") == "dark" {
            NSApplication.shared.appearance = NSAppearance(named: .darkAqua)
        }
        if let wanted = defaults.string(forKey: "snapshotNote"),
           let note = model.notes.first(where: { $0.title.contains(wanted) }) {
            model.scope = .all
            model.select(note.id)
        }
        try? await Task.sleep(for: .seconds(2.5))
        defer { NSApplication.shared.terminate(nil) }
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
            view.subviews.forEach(walk)
        }
        walk(root)
        lines.append("menuKeys=" + menuKeys(NSApplication.shared.mainMenu).joined(separator: " "))
        lines.append("scope=\(model.scope) selected=\(model.selectedNote?.title ?? "无")")
        lines.append("folders=\(model.folders)")
        lines.append("tags=\(model.tagTree.map(\.path))")
        lines.append("visible=\(model.visibleNotes.map(\.title))")
        return lines.joined(separator: "\n")
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
