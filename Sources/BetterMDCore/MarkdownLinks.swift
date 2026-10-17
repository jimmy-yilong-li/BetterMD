import Foundation

/// 正文里指向「我的笔记」内部文件的相对链接（图片、附件、别的笔记）。
/// 链接按笔记所在的文件夹算，所以笔记换了文件夹，这些链接要跟着改，不然就断了。
public enum MarkdownLinks {
    /// 从文件夹 `folder` 指向 `path`（都相对「我的笔记」）的 Markdown 链接写法，
    /// 比如从“工作/客户”指向“附件/a.png”是“../../附件/a.png”。空格、括号这类字符会转义。
    public static func link(from folder: String, to path: String) -> String {
        relative(from: segments(folder), to: segments(path)).map(encode).joined(separator: "/")
    }

    /// 笔记从 `oldFolder` 挪到 `newFolder` 以后，把正文里的相对链接（包括 `[名字]: 地址` 这种定义）改成从新位置出发的写法。
    /// 网址、页内锚点、以 / 开头的路径、跳出「我的笔记」的路径、代码块里的内容都不动。
    public static func rebase(_ text: String, from oldFolder: String, to newFolder: String) -> String {
        guard oldFolder != newFolder, text.contains("](") || text.contains("]:") else { return text }
        var code = NoteText.CodeTracker()
        var lines: [String] = []
        for raw in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = String(raw)
            lines.append(code.isCode(line) ? line : rebaseLine(line, from: oldFolder, to: newFolder))
        }
        return lines.joined(separator: "\n")
    }

    /// 正文里的地址指向「我的笔记」里的哪个文件：返回相对「我的笔记」的路径（已解码 %20 这类转义）。
    /// `folder` 是笔记所在的文件夹。网址、页内锚点、跳出「我的笔记」的返回 nil；以 / 开头的按根目录算。
    public static func resolve(_ written: String, from folder: String) -> String? {
        var dest = written.trimmingCharacters(in: .whitespaces)
        if dest.hasPrefix("<") && dest.hasSuffix(">") { dest = String(dest.dropFirst().dropLast()) }
        guard !dest.isEmpty, !dest.hasPrefix("#"), dest.firstMatch(of: scheme) == nil else { return nil }
        let cut = dest.firstIndex(where: { $0 == "?" || $0 == "#" }) ?? dest.endIndex
        var parts = dest.hasPrefix("/") ? [] : segments(folder)
        for raw in dest[..<cut].split(separator: "/") {
            let part = raw.removingPercentEncoding ?? String(raw)
            if part == "." { continue }
            if part == ".." {
                if parts.isEmpty { return nil }
                parts.removeLast()
            } else {
                parts.append(part)
            }
        }
        return parts.isEmpty ? nil : parts.joined(separator: "/")
    }

    // MARK: - 内部

    /// `](地址)` 或 `](地址 "标题")`；地址可以写在尖括号里，也可以带一层成对的括号，比如 `图(1).png`。
    /// （Regex 不是 Sendable，不能存成静态常量，用到时现做。）
    private static var destination: Regex<(Substring, Substring, Substring)> {
        #/\]\((<[^>\n]*>|(?:[^()\s]|\([^()\s]*\))+)((?:\s+(?:"[^"]*"|'[^']*'))?\s*)\)/#
    }
    /// 引用式链接的定义：`[名字]: 地址 "标题"`，地址后面只能有标题。脚注（`[^1]: …`）不算。
    private static var definition: Regex<(Substring, Substring, Substring, Substring)> {
        #/^( {0,3}\[[^\]^][^\]]*\]:[ \t]*)(<[^>\n]*>|\S+)((?:[ \t]+(?:"[^"]*"|'[^']*'|\([^)]*\)))?[ \t]*)$/#
    }
    /// 行内代码（反引号成对）。里面像链接的文字不是链接。
    private static var codeSpan: Regex<(Substring, Substring)> { #/(`+).+?\1/# }
    private static var scheme: Regex<Substring> { #/^[A-Za-z][A-Za-z0-9+.\-]*:/# }

    static func rebaseLine(_ line: String, from oldFolder: String, to newFolder: String) -> String {
        if let def = line.wholeMatch(of: definition) {
            // 只改看起来像文件路径的（有 / 或扩展名），免得把“[注]: 这是说明”这种正文当成链接改掉
            let dest = String(def.output.2)
            guard dest.contains("/") || dest.contains("."),
                  let moved = rebasePath(dest, from: oldFolder, to: newFolder) else { return line }
            return String(def.output.1) + moved + String(def.output.3)
        }
        guard line.contains("](") else { return line }
        let code = line.matches(of: codeSpan).map(\.range)
        return line.replacing(destination) { match in
            guard !code.contains(where: { $0.overlaps(match.range) }), opensLink(line, closingAt: match.range.lowerBound),
                  let moved = rebasePath(String(match.output.1), from: oldFolder, to: newFolder) else {
                return String(match.output.0)
            }
            return "](" + moved + match.output.2 + ")"
        }
    }

    /// `close` 处的 `]` 真的是链接文字的结尾：它自己没被转义，往前能找到配对的、没被转义的 `[`。
    /// “\\[不是链接](a.png)”“[x\\](b.png)”不是链接。
    static func opensLink(_ line: String, closingAt close: String.Index) -> Bool {
        func escaped(_ i: String.Index) -> Bool {
            var count = 0
            var j = i
            while j > line.startIndex {
                j = line.index(before: j)
                guard line[j] == "\\" else { break }
                count += 1
            }
            return count % 2 == 1
        }
        guard !escaped(close) else { return false }
        var depth = 0
        var i = close
        while i > line.startIndex {
            i = line.index(before: i)
            guard !escaped(i) else { continue }
            if line[i] == "]" { depth += 1 }
            if line[i] == "[" {
                if depth == 0 { return true }
                depth -= 1
            }
        }
        return false
    }

    static func rebasePath(_ written: String, from oldFolder: String, to newFolder: String) -> String? {
        let angled = written.hasPrefix("<") && written.hasSuffix(">")
        let dest = angled ? String(written.dropFirst().dropLast()) : written
        guard !dest.isEmpty, !dest.hasPrefix("#"), !dest.hasPrefix("/"), dest.firstMatch(of: scheme) == nil else {
            return nil
        }
        let cut = dest.firstIndex(where: { $0 == "?" || $0 == "#" }) ?? dest.endIndex
        var parts = segments(oldFolder)
        for raw in dest[..<cut].split(separator: "/", omittingEmptySubsequences: true) {
            let part = raw.removingPercentEncoding ?? String(raw)
            if part == "." { continue }
            if part == ".." {
                if parts.isEmpty { return nil }
                parts.removeLast()
            } else {
                parts.append(part)
            }
        }
        guard !parts.isEmpty else { return nil }
        let steps = relative(from: segments(newFolder), to: parts)
        // 尖括号里空格、括号可以原样写，但 %、#、?、尖括号还得转义：%23 解出来的 # 原样写回去，就成了页内锚点
        let joined = steps.map { angled ? encodeAngled($0) : encode($0) }.joined(separator: "/")
        let rebased = joined + dest[cut...]
        return angled ? "<" + rebased + ">" : rebased
    }

    static func segments(_ path: String) -> [String] {
        path.split(separator: "/").map(String.init)
    }

    /// 从文件夹走到目标：先退回共同的上级（“..”），再往下走。
    static func relative(from folder: [String], to target: [String]) -> [String] {
        var common = 0
        while common < folder.count, common < target.count - 1, folder[common] == target[common] { common += 1 }
        return Array(repeating: "..", count: folder.count - common) + target[common...]
    }

    /// 链接里不能直接出现的字符转义掉（各种空白都算）；中文照原样写，好认。
    /// 写在尖括号里的一段路径：只转义 %、#、?、< 和 >。
    static func encodeAngled(_ segment: String) -> String {
        var out = ""
        for ch in segment {
            switch ch {
            case "%": out += "%25"
            case "#": out += "%23"
            case "?": out += "%3F"
            case "<": out += "%3C"
            case ">": out += "%3E"
            default: out.append(ch)
            }
        }
        return out
    }

    static func encode(_ segment: String) -> String {
        var out = ""
        for ch in segment {
            if ch.isWhitespace {
                out += ch.utf8.map { String(format: "%%%02X", $0) }.joined()
                continue
            }
            switch ch {
            case "(": out += "%28"
            case ")": out += "%29"
            case "<": out += "%3C"
            case ">": out += "%3E"
            case "%": out += "%25"
            case "#": out += "%23"
            case "?": out += "%3F"
            default: out.append(ch)
            }
        }
        return out
    }
}
