import BetterMDCore
import SwiftUI

/// 效果图里的拟物图标：红色笔记本（我的笔记）、火漆信封（文件夹）、散页（未分类）、书签丝带（置顶）。
/// 路径直接取自效果图的 SVG，坐标按 SVG 的 viewBox 写。

/// 一段 SVG 路径画成的形状。`box` 是 SVG 的 viewBox 边长，画的时候按实际大小缩放。
struct SVGShape: Shape {
    private let shape: Path
    private let box: CGFloat

    init(_ d: String, box: CGFloat) {
        shape = Path(SVGPath.cgPath(d))
        self.box = box
    }

    func path(in rect: CGRect) -> Path {
        let scale = min(rect.width, rect.height) / box
        return shape.applying(CGAffineTransform(scaleX: scale, y: scale).translatedBy(x: rect.minX / scale, y: rect.minY / scale))
    }
}

/// SVG 坐标里的圆角矩形。
private func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, r: CGFloat) -> String {
    "M\(x + r) \(y)H\(x + w - r)C\(x + w - r * 0.45) \(y) \(x + w) \(y + r * 0.45) \(x + w) \(y + r)"
        + "V\(y + h - r)C\(x + w) \(y + h - r * 0.45) \(x + w - r * 0.45) \(y + h) \(x + w - r) \(y + h)"
        + "H\(x + r)C\(x + r * 0.45) \(y + h) \(x) \(y + h - r * 0.45) \(x) \(y + h - r)"
        + "V\(y + r)C\(x) \(y + r * 0.45) \(x + r * 0.45) \(y) \(x + r) \(y)Z"
}

/// SVG 坐标里的圆。
private func circle(_ cx: CGFloat, _ cy: CGFloat, _ r: CGFloat) -> String {
    let k = r * 0.5523
    return "M\(cx) \(cy - r)C\(cx + k) \(cy - r) \(cx + r) \(cy - k) \(cx + r) \(cy)"
        + "C\(cx + r) \(cy + k) \(cx + k) \(cy + r) \(cx) \(cy + r)"
        + "C\(cx - k) \(cy + r) \(cx - r) \(cy + k) \(cx - r) \(cy)"
        + "C\(cx - r) \(cy - k) \(cx - k) \(cy - r) \(cx) \(cy - r)Z"
}

extension Shape {
    /// 先填色再描边，和 SVG 的 fill + stroke 一样。
    func paint<F: ShapeStyle, S: ShapeStyle>(_ fill: F, stroke: S, width: CGFloat) -> some View {
        self.fill(fill).overlay(self.stroke(stroke, lineWidth: width))
    }
}

// MARK: - 火漆信封

/// 牛皮纸信封，封口压一枚朱砂火漆印。`open` 时封盖翻起、火漆印消失、一张信纸探出来；
/// 合上时信纸先落回、封盖再合上（共约 0.5 秒）。
struct EnvelopeIcon: View {
    var open: Bool
    var size: CGFloat

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var flap: CGFloat      // 合着的封盖：1 盖着，0 翻走
    @State private var backFlap: CGFloat  // 翻起来的封盖：0 没有，1 立起来
    @State private var sink: CGFloat      // 信纸往下沉多少（SVG 坐标）
    @State private var seal: Double       // 火漆印

    init(open: Bool, size: CGFloat = 18) {
        self.open = open
        self.size = size
        _flap = State(initialValue: open ? 0 : 1)
        _backFlap = State(initialValue: open ? 1 : 0)
        _sink = State(initialValue: open ? 0 : 4.2)
        _seal = State(initialValue: open ? 0 : 1)
    }

    private static let flapBack = SVGShape("M1.6 6.9h14.8L9.9 2.2c-.54-.4-1.26-.4-1.8 0z", box: 18)
    private static let sheet = SVGShape(rect(3.4, 3.4, 11.2, 8.6, r: 0.7), box: 18)
    private static let sheetLines = SVGShape("M5.2 5.3h7.6M5.2 7h5.4", box: 18)
    private static let body = SVGShape(rect(1.4, 6.6, 15.2, 9.8, r: 1.5), box: 18)
    private static let seam = SVGShape("M1.9 15.9 9 11.2l7.1 4.7", box: 18)
    private static let flapShape = SVGShape("M1.6 6.9h14.8l-6.5 4.8c-.54.4-1.26.4-1.8 0z", box: 18)
    private static let sealShape = SVGShape(circle(9, 11.3, 2.05), box: 18)
    private static let sealRing = SVGShape(circle(9, 11.3, 1.25), box: 18)
    private static let sealShine = SVGShape(circle(8.35, 10.65, 0.55), box: 18)
    /// 封盖翻动时的轴：封口那条线（y = 6.9）
    private static let hinge = UnitPoint(x: 0.5, y: 6.9 / 18)

    var body: some View {
        let k = size / 18
        let paperGradient = LinearGradient(colors: [Ink.envelopeTop, Ink.envelopeBottom], startPoint: .top, endPoint: .bottom)
        let flapGradient = LinearGradient(colors: [Ink.flapTop, Ink.flapBottom], startPoint: .top, endPoint: .bottom)
        ZStack {
            Self.flapBack.paint(flapGradient, stroke: Ink.envelopeEdge, width: 0.55 * k)
                .scaleEffect(x: 1, y: backFlap, anchor: Self.hinge)
            Group {
                Self.sheet.paint(Ink.letterPaper, stroke: Ink.envelopeEdge, width: 0.4 * k)
                Self.sheetLines.stroke(Ink.envelopeSeam, style: StrokeStyle(lineWidth: 0.6 * k, lineCap: .round))
            }
            .offset(y: sink * k)
            Self.body.paint(paperGradient, stroke: Ink.envelopeEdge, width: 0.55 * k)
            Self.seam.stroke(Ink.envelopeSeam, style: StrokeStyle(lineWidth: 0.55 * k, lineCap: .round, lineJoin: .round))
            Self.flapShape.paint(flapGradient, stroke: Ink.envelopeEdge, width: 0.55 * k)
                .scaleEffect(x: 1, y: flap, anchor: Self.hinge)
            Group {
                Self.sealShape.fill(Ink.accent)
                Self.sealRing.stroke(Color.black.opacity(0.22), lineWidth: 0.45 * k)
                Self.sealShine.fill(Color.white.opacity(0.5))
            }
            .opacity(seal)
        }
        .frame(width: size, height: size)
        .onChange(of: open) { _, isOpen in animate(isOpen) }
        .accessibilityHidden(true)
    }

    private func settle(_ isOpen: Bool) {
        flap = isOpen ? 0 : 1
        backFlap = isOpen ? 1 : 0
        sink = isOpen ? 0 : 4.2
        seal = isOpen ? 0 : 1
    }

    private func animate(_ isOpen: Bool) {
        guard !reduceMotion else { return settle(isOpen) }
        if isOpen {
            // 封盖翻起、火漆印消失 → 封盖立起来 → 信纸探出来
            withAnimation(.easeIn(duration: 0.15)) { flap = 0 }
            withAnimation(.easeOut(duration: 0.1)) { seal = 0 }
            withAnimation(.easeOut(duration: 0.17).delay(0.14)) { backFlap = 1 }
            withAnimation(.timingCurve(0.2, 0.7, 0.2, 1, duration: 0.26).delay(0.24)) { sink = 0 }
        } else {
            // 信纸先落回 → 立着的封盖收起 → 封盖合上、火漆印回来
            withAnimation(.timingCurve(0.4, 0, 0.6, 1, duration: 0.2)) { sink = 4.2 }
            withAnimation(.easeIn(duration: 0.14).delay(0.04)) { backFlap = 0 }
            withAnimation(.easeOut(duration: 0.16).delay(0.2)) { flap = 1 }
            withAnimation(.easeOut(duration: 0.15).delay(0.2)) { seal = 1 }
        }
    }
}

// MARK: - 散页、笔记本、书签丝带

/// 「未分类」：一张微微倾斜、折了角的散页。
struct LooseSheetIcon: View {
    var size: CGFloat = 18

    private static let paper = SVGShape("M4.8 2.4h6.4l3.2 3.2v9.6c0 .55-.45 1-1 1H4.8c-.55 0-1-.45-1-1V3.4c0-.55.45-1 1-1z", box: 18)
    private static let fold = SVGShape("M11.2 2.4v2.6c0 .33.27.6.6.6h2.6z", box: 18)
    private static let lines = SVGShape("M6 8.4h6.2M6 10.4h6.2M6 12.4h4", box: 18)

    var body: some View {
        let k = size / 18
        ZStack {
            Self.paper.paint(Ink.letterPaper, stroke: Ink.envelopeEdge, width: 0.6 * k)
            Self.fold.paint(Ink.flapTop, stroke: Ink.envelopeEdge, width: 0.5 * k)
            Self.lines.stroke(Ink.envelopeSeam, style: StrokeStyle(lineWidth: 0.7 * k, lineCap: .round))
        }
        .frame(width: size, height: size)
        .rotationEffect(.degrees(-7))
        .accessibilityHidden(true)
    }
}

/// 「我的笔记」：朱砂封面的笔记本。
struct NotebookIcon: View {
    var size: CGFloat = 16

    private static let cover = SVGShape(rect(2.6, 1.6, 11, 12.8, r: 1.7), box: 16)
    private static let spine = SVGShape("M4.3 1.6v12.8", box: 16)
    private static let band = SVGShape("M11.2 1.6v12.8", box: 16)
    private static let label = SVGShape(rect(6.1, 4.3, 3.9, 2.3, r: 0.5), box: 16)

    var body: some View {
        let k = size / 16
        ZStack {
            Self.cover.fill(Ink.accent)
            Self.spine.stroke(Color.black.opacity(0.22), lineWidth: 1.2 * k)
            Self.band.stroke(Color.black.opacity(0.3), lineWidth: 0.9 * k)
            Self.label.fill(Color.white.opacity(0.78))
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// 置顶的笔记右上角挂的一条书签丝带。
struct RibbonView: View {
    private static let ribbon = SVGShape("M0 0h10v17.2l-5-3.9-5 3.9z", box: 18)
    private static let shine = SVGShape("M1.3 0v14.6", box: 18)

    var body: some View {
        ZStack(alignment: .topLeading) {
            Self.ribbon.fill(Ink.accent)
            Self.shine.stroke(Color.white.opacity(0.28), lineWidth: 1)
        }
        .frame(width: 18, height: 18, alignment: .topLeading)
        .frame(width: 10, height: 18, alignment: .topLeading)
        .clipped()
        .shadow(color: .black.opacity(0.22), radius: 0.5, y: 1)
        .accessibilityLabel("置顶")
    }
}
