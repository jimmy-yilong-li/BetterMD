import CoreGraphics
import Foundation

/// 把 SVG 的路径数据（`d` 属性）变成 CGPath，让 App 里的图标和效果图里的一模一样。
/// 只支持图标用到的命令：M L H V C Z（大写是绝对坐标，小写是相对坐标）。
public enum SVGPath {
    public static func cgPath(_ d: String) -> CGPath {
        let path = CGMutablePath()
        var tokens = Tokens(d)
        var point = CGPoint.zero
        var start = CGPoint.zero
        var command: Character = "M"
        while !tokens.atEnd {
            if let letter = tokens.command() {
                command = letter
                if letter == "Z" || letter == "z" {
                    path.closeSubpath()
                    point = start
                    continue
                }
            }
            let relative = command.isLowercase
            let base = relative ? point : .zero
            switch command.uppercased() {
            case "M":
                guard let x = tokens.number(), let y = tokens.number() else { return path }
                point = CGPoint(x: base.x + x, y: base.y + y)
                path.move(to: point)
                start = point
                command = relative ? "l" : "L" // M 后面跟着的坐标当成 L
            case "L":
                guard let x = tokens.number(), let y = tokens.number() else { return path }
                point = CGPoint(x: base.x + x, y: base.y + y)
                path.addLine(to: point)
            case "H":
                guard let x = tokens.number() else { return path }
                point = CGPoint(x: relative ? point.x + x : x, y: point.y)
                path.addLine(to: point)
            case "V":
                guard let y = tokens.number() else { return path }
                point = CGPoint(x: point.x, y: relative ? point.y + y : y)
                path.addLine(to: point)
            case "C":
                guard let x1 = tokens.number(), let y1 = tokens.number(),
                      let x2 = tokens.number(), let y2 = tokens.number(),
                      let x = tokens.number(), let y = tokens.number() else { return path }
                let end = CGPoint(x: base.x + x, y: base.y + y)
                path.addCurve(to: end, control1: CGPoint(x: base.x + x1, y: base.y + y1),
                              control2: CGPoint(x: base.x + x2, y: base.y + y2))
                point = end
            default:
                return path // 不认识的命令：到此为止
            }
        }
        return path
    }

    /// 逐个读出命令字母和数字。数字之间可以没有分隔（"1.26-.4"、".54.4"）。
    struct Tokens {
        private let chars: [Character]
        private var index = 0

        init(_ text: String) { chars = Array(text) }

        var atEnd: Bool {
            mutating get {
                skipSeparators()
                return index >= chars.count
            }
        }

        mutating func command() -> Character? {
            skipSeparators()
            guard index < chars.count, chars[index].isLetter, chars[index] != "e", chars[index] != "E" else { return nil }
            defer { index += 1 }
            return chars[index]
        }

        mutating func number() -> CGFloat? {
            skipSeparators()
            var text = ""
            if index < chars.count, chars[index] == "-" || chars[index] == "+" {
                text.append(chars[index])
                index += 1
            }
            var sawDot = false
            var sawDigit = false
            while index < chars.count {
                let ch = chars[index]
                if ch.isNumber {
                    sawDigit = true
                } else if ch == "." && !sawDot {
                    sawDot = true
                } else if (ch == "e" || ch == "E") && sawDigit {
                    text.append(ch)
                    index += 1
                    if index < chars.count, chars[index] == "-" || chars[index] == "+" {
                        text.append(chars[index])
                        index += 1
                    }
                    continue
                } else {
                    break
                }
                text.append(ch)
                index += 1
            }
            return sawDigit ? Double(text).map { CGFloat($0) } : nil
        }

        private mutating func skipSeparators() {
            while index < chars.count, chars[index] == " " || chars[index] == "," || chars[index].isNewline || chars[index] == "\t" {
                index += 1
            }
        }
    }
}
