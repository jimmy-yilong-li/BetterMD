import AppKit
import BetterMDCore

/// 开发用：启动参数 `-snapshotPath /某处/图.png` 会在窗口出现两秒后，把整个窗口画成图片存下来，
/// 并在旁边写一份 `.txt`：每个列表实际有几行、AppModel 里有哪些笔记。然后退出。
/// 没有屏幕录制权限时，用它检查界面。正常启动不受影响。
enum DebugSnapshot {
    @MainActor
    static func runIfRequested(model: AppModel) async {
        guard let path = UserDefaults.standard.string(forKey: "snapshotPath"), !path.isEmpty else { return }
        try? await Task.sleep(for: .seconds(2))
        defer { NSApplication.shared.terminate(nil) }
        let target = URL(fileURLWithPath: (path as NSString).expandingTildeInPath)
        guard let window = NSApplication.shared.windows.first(where: { $0.isVisible }),
              let view = window.contentView?.superview ?? window.contentView else { return }
        if let data = render(view, scale: window.backingScaleFactor) { try? data.write(to: target) }
        try? report(view, model: model).write(to: target.appendingPathExtension("txt"), atomically: true, encoding: .utf8)
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
        lines.append("scope=\(model.scope) selected=\(model.selectedNote?.title ?? "无")")
        lines.append("folders=\(model.folders)")
        lines.append("tags=\(model.tagTree.map(\.path))")
        lines.append("visible=\(model.visibleNotes.map(\.title))")
        return lines.joined(separator: "\n")
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
