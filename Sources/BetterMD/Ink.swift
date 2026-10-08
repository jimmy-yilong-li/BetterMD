import AppKit
import SwiftUI

/// 纸墨的颜色和字体，和编辑器网页（editor.css）、效果图（ui-v4）里的一致。浅色、深色自动切换。
@MainActor
enum Ink {
    static let accent = color(0xB8452F, 0xD86A50)
    /// 编辑区的纸
    static let paper = color(0xFBF8F2, 0x1A1816)
    /// 笔记列表的纸（比编辑区深一点，编辑区像一张纸压在上面）
    static let listPaper = color(0xF3EFE7, 0x211E1B)
    static let text = color(0x2A2621, 0xECE5D8)
    static let text2 = color(0x766E63, 0xAAA194)
    static let text3 = color(0xA8A094, 0x70695F)
    static let separator = color(rgba: (70, 45, 20, 0.11), (255, 240, 220, 0.09))
    static let hover = color(rgba: (70, 45, 20, 0.05), (255, 240, 220, 0.05))
    /// 凹进去的输入框、小按钮的底色
    static let field = color(rgba: (70, 45, 20, 0.065), (255, 240, 220, 0.07))
    /// 列表里选中的笔记（深色模式下；浅色模式下是一张白卡片）
    static let selection = color(rgba: (184, 69, 47, 0.09), (216, 106, 80, 0.12))
    /// 侧栏里选中的一项
    static let sideSelection = color(rgba: (184, 69, 47, 0.13), (216, 106, 80, 0.18))
    /// 搜索命中的字的底色
    static let highlight = color(rgba: (184, 69, 47, 0.26), (216, 106, 80, 0.32))

    // 牛皮纸信封和散页
    static let envelopeTop = color(0xEDD8B4, 0xAE9471)
    static let envelopeBottom = color(0xDCBD8E, 0x937A58)
    static let flapTop = color(0xE5CAA0, 0xA38967)
    static let flapBottom = color(0xD2AF7C, 0x89714F)
    static let envelopeEdge = color(rgba: (140, 95, 45, 0.55), (25, 15, 5, 0.55))
    static let envelopeSeam = color(rgba: (140, 95, 45, 0.32), (25, 15, 5, 0.30))
    static let letterPaper = color(0xFFFCF6, 0xECE5D7)

    // MARK: 字体

    /// 正文、标题用的字：西文 Iowan Old Style，中文落到宋体。
    static func serif(_ size: CGFloat, bold: Bool = false) -> Font {
        Font(serifFont(size, bold: bold) as CTFont)
    }

    static func serifFont(_ size: CGFloat, bold: Bool = false) -> NSFont {
        var songti = NSFontDescriptor(fontAttributes: [.family: "Songti SC"])
        var iowan = NSFontDescriptor(fontAttributes: [.family: "Iowan Old Style"])
        if bold {
            songti = songti.withSymbolicTraits(.bold)
            iowan = iowan.withSymbolicTraits(.bold)
        }
        let descriptor = iowan.addingAttributes([.cascadeList: [songti]])
        return NSFont(descriptor: descriptor, size: size) ?? .systemFont(ofSize: size, weight: bold ? .semibold : .regular)
    }

    // MARK: 内部

    private static func color(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(nsColor: NSColor(name: nil) { @Sendable appearance in
            nsColor(isDark(appearance) ? dark : light)
        })
    }

    private static func color(rgba light: (Int, Int, Int, Double), _ dark: (Int, Int, Int, Double)) -> Color {
        Color(nsColor: NSColor(name: nil) { @Sendable appearance in
            let c = isDark(appearance) ? dark : light
            return NSColor(srgbRed: CGFloat(c.0) / 255, green: CGFloat(c.1) / 255, blue: CGFloat(c.2) / 255, alpha: c.3)
        })
    }

    private nonisolated static func nsColor(_ hex: UInt32) -> NSColor {
        NSColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
                blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }

    private nonisolated static func isDark(_ appearance: NSAppearance) -> Bool {
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
    }
}
