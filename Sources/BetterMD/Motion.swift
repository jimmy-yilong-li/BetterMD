import AppKit
import SwiftUI

/// 动效的时长和曲线（design.md 6.8）。系统打开“减弱动态效果”时都是 nil，也就是直接变过去，不做动画。
enum Motion {
    /// 和效果图一样的缓出曲线：起步快、收尾稳。
    static func ease(_ duration: Double) -> Animation? {
        reduced ? nil : .timingCurve(0.2, 0.7, 0.2, 1, duration: duration)
    }
    /// 文件夹、标签、分组展开收起
    static var expand: Animation? { ease(0.28) }
    /// 列表里笔记的进出和换位置
    static var list: Animation? { ease(0.26) }
    /// 侧栏、专注模式的栏宽变化
    static var columns: Animation? { ease(0.32) }
    /// 弹出面板、小的状态变化
    static var quick: Animation? { reduced ? nil : .easeOut(duration: 0.16) }

    private static var reduced: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }
}

/// 按下去时轻微缩小，有手感。
struct PressableStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.93 : 1)
            .animation(.easeOut(duration: 0.08), value: configuration.isPressed)
    }
}

/// 纸面：纸色上平铺一层细微的噪点纹理。
struct PaperBackground: View {
    var color: Color
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        color.overlay {
            Image(nsImage: scheme == .dark ? Grain.dark : Grain.light)
                .resizable(resizingMode: .tile)
                .allowsHitTesting(false)
        }
    }
}

/// 纸的纹理：一小块随机噪点，平铺使用。浅色是暖褐色的点，深色是暖白色的点。
@MainActor
enum Grain {
    static let light = make(red: 0.42, green: 0.31, blue: 0.18, strength: 0.06)
    static let dark = make(red: 1, green: 0.95, blue: 0.86, strength: 0.035)

    private static func make(red: CGFloat, green: CGFloat, blue: CGFloat, strength: CGFloat) -> NSImage {
        let side = 192
        var pixels = [UInt8](repeating: 0, count: side * side * 4)
        var seed: UInt64 = 0x9E37_79B9_7F4A_7C15
        for i in 0..<(side * side) {
            // 固定种子的随机数，每次启动纹理都一样
            seed = seed &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
            let noise = CGFloat((seed >> 33) & 0xFFFF) / 65535
            let alpha = noise * noise * strength
            pixels[i * 4] = UInt8(red * alpha * 255)
            pixels[i * 4 + 1] = UInt8(green * alpha * 255)
            pixels[i * 4 + 2] = UInt8(blue * alpha * 255)
            pixels[i * 4 + 3] = UInt8(alpha * 255)
        }
        let image = pixels.withUnsafeMutableBytes { buffer -> CGImage? in
            CGContext(data: buffer.baseAddress, width: side, height: side, bitsPerComponent: 8, bytesPerRow: side * 4,
                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)?.makeImage()
        }
        guard let image else { return NSImage() }
        return NSImage(cgImage: image, size: NSSize(width: side / 2, height: side / 2))
    }
}
