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
        var inFence = false
        var lines: [String] = []
        for raw in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = String(raw)
            if NoteText.isFence(line) {
                inFence.toggle()
                lines.append(line)
            } else {
                lines.append(inFence ? line : rebaseLine(line, from: oldFolder, to: newFolder))
            }
        }
        return lines.joined(separator: "\n")
    }

    // MARK: - 内部

    /// `](地址)` 或 `](地址 "标题")`；地址可以写在尖括号里，也可以带一层成对的括号，比如 `图(1).png`。
    /// （Regex 不是 Sendable，不能存成静态常量，用到时现做。）
    private static var destination: Regex<(Substring, Substring, Substring)> {
        #/\]\((<[^>\n]*>|(?:[^()\s]|\([^()\s]*\))+)((?:\s+(?:"[^"]*"|'[^']*'))?\s*)\)/#
    }
    /// 引用式链接的定义：`[名字]: 地址 "标题"`。脚注（`[^1]: …`）不算。
    private static var definition: Regex<(Substring, Substring, Substring, Substring)> {
        #/^( {0,3}\[[^\]^][^\]]*\]:[ \t]*)(<[^>\n]*>|\S+)(.*)$/#
    }
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
        return line.replacing(destination) { match in
            guard let moved = rebasePath(String(match.output.1), from: oldFolder, to: newFolder) else {
                return String(match.output.0)
            }
            return "](" + moved + match.output.2 + ")"
        }
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
        let joined = (angled ? steps : steps.map(encode)).joined(separator: "/")
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

    /// 链接里不能直接出现的字符转义掉；中文照原样写，好认。
    static func encode(_ segment: String) -> String {
        var out = ""
        for ch in segment {
            switch ch {
            case " ": out += "%20"
            case "(": out += "%28"
            case ")": out += "%29"
            case "<": out += "%3C"
            case ">": out += "%3E"
            case "%": out += "%25"
            case "#": out += "%23"
            case "?": out += "%3F"
            case "\t": out += "%09"
            default: out.append(ch)
            }
        }
        return out
    }
}
