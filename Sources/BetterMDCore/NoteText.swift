import Foundation

/// 从笔记的 Markdown 原文里取出标题、标签、待办状态和列表摘要。
public enum NoteText {
    /// 第一行非空文字；是 Markdown 标题时去掉开头的 `#` 和空格。空笔记返回 ""。
    public static func title(of text: String) -> String {
        for raw in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty { continue }
            let hashes = line.prefix(while: { $0 == "#" })
            if !hashes.isEmpty && hashes.count <= 6 {
                let rest = line.dropFirst(hashes.count)
                if rest.isEmpty || rest.first == " " {
                    return rest.trimmingCharacters(in: .whitespaces)
                }
            }
            return line
        }
        return ""
    }

    /// 正文里的 `#标签`，按出现顺序去重。跳过 Markdown 标题、代码块和行内代码；
    /// `#` 前面必须是行首或空白，所以网址里的 `#` 不算。
    public static func tags(in text: String) -> [String] {
        var result: [String] = []
        var seen = Set<String>()
        var inFence = false
        for raw in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = String(raw)
            if isFence(line) { inFence.toggle(); continue }
            if inFence { continue }
            for tag in tagsInLine(removingInlineCode(line)) where seen.insert(tag).inserted {
                result.append(tag)
            }
        }
        return result
    }

    /// 有没有还没勾掉的待办（`- [ ]`、`* [ ]`、`+ [ ]`）；代码块里的不算。
    public static func hasOpenTodo(_ text: String) -> Bool {
        var inFence = false
        for raw in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = String(raw)
            if isFence(line) { inFence.toggle(); continue }
            if inFence { continue }
            let t = line.trimmingCharacters(in: .whitespaces)
            if t.hasPrefix("- [ ]") || t.hasPrefix("* [ ]") || t.hasPrefix("+ [ ]") { return true }
        }
        return false
    }

    /// 正文里第一张图片的地址（`![说明](地址)` 里的地址，原样返回）；代码块里的不算。没有图片返回 nil。
    public static func firstImage(in text: String) -> String? {
        guard text.contains("![") else { return nil }
        var inFence = false
        for raw in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = String(raw)
            if isFence(line) { inFence.toggle(); continue }
            if inFence || !line.contains("![") { continue }
            if let match = line.firstMatch(of: #/!\[[^\]]*\]\((<[^>\n]*>|[^)\s]+)/#) {
                return String(match.output.1)
            }
        }
        return nil
    }

    /// 列表里显示的摘要：跳过标题行和只有标签的行，去掉 Markdown 符号，最多 `limit` 个字符。
    public static func preview(of text: String, limit: Int = 120) -> String {
        var parts: [String] = []
        var length = 0
        var skippedTitle = false
        var mathEnd: String? // 正在跳过的公式块的结尾记号
        for raw in text.split(separator: "\n") {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty || isFence(line) { continue }
            if !skippedTitle { skippedTitle = true; continue }
            // 公式块的 LaTeX 源码不进摘要
            if let end = mathEnd {
                if line.contains(end) { mathEnd = nil }
                continue
            }
            if let (close, single) = mathBlockOpener(line) {
                if !single { mathEnd = close }
                continue
            }
            if isTagOnlyLine(line) || isRule(line) || isTableDelimiter(line) { continue }
            let plainLine = plain(line)
            if plainLine.isEmpty { continue }
            parts.append(plainLine)
            length += plainLine.count
            if length >= limit { break }
        }
        let joined = parts.joined(separator: " ")
        return joined.count > limit ? String(joined.prefix(limit)) : joined
    }

    // MARK: - 内部

    static func isFence(_ line: String) -> Bool {
        let t = line.trimmingCharacters(in: .whitespaces)
        return t.hasPrefix("```") || t.hasPrefix("~~~")
    }

    /// 标签遇到这些字符就结束。
    static let tagTerminators: Set<Character> = [
        "#", ",", ";", ":", "!", "?", "(", ")", "[", "]", "\"", "'",
        "，", "。", "、", "；", "：", "！", "？", "（", "）", "【", "】", "「", "」", "“", "”",
    ]

    static func tagsInLine(_ line: String) -> [String] {
        let chars = Array(line)
        var tags: [String] = []
        var i = 0
        while i < chars.count {
            guard chars[i] == "#", i == 0 || chars[i - 1].isWhitespace else {
                i += 1
                continue
            }
            var j = i + 1
            while j < chars.count, !chars[j].isWhitespace, !tagTerminators.contains(chars[j]) { j += 1 }
            var tag = String(chars[(i + 1)..<j])
            while let last = tag.last, last == "." || last == "/" { tag.removeLast() }
            while tag.first == "/" { tag.removeFirst() }
            if !tag.isEmpty { tags.append(tag) }
            i = max(j, i + 1)
        }
        return tags
    }

    static func removingInlineCode(_ line: String) -> String {
        var out = ""
        var inCode = false
        for ch in line {
            if ch == "`" {
                inCode.toggle()
                out.append(" ")
                continue
            }
            out.append(inCode ? " " : ch)
        }
        return out
    }

    static func isTagOnlyLine(_ line: String) -> Bool {
        let words = line.split(whereSeparator: \.isWhitespace)
        return !words.isEmpty && words.allSatisfy { $0.hasPrefix("#") } && !tagsInLine(line).isEmpty
    }

    /// 公式块的开头：$$、\[、\begin{…}。返回结尾记号，以及开头结尾是不是写在同一行。
    static func mathBlockOpener(_ line: String) -> (close: String, single: Bool)? {
        if line.hasPrefix("$$") { return ("$$", line.dropFirst(2).contains("$$")) }
        if line.hasPrefix("\\[") { return ("\\]", line.contains("\\]")) }
        if line.hasPrefix("\\begin{") { return ("\\end{", line.contains("\\end{")) }
        return nil
    }

    /// 分割线：---、***、___（中间可以有空格）。
    static func isRule(_ line: String) -> Bool {
        line.wholeMatch(of: #/(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,}/#) != nil
    }

    /// 表格的分隔行：|---|:--:|
    static func isTableDelimiter(_ line: String) -> Bool {
        line.contains("-") && line.wholeMatch(of: #/\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?/#) != nil
    }

    static func plain(_ line: String) -> String {
        var s = line
        if let r = s.range(of: #"^(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)"#, options: .regularExpression) {
            let marker = String(s[r])
            s.removeSubrange(r)
            if marker.contains("[ ]") {
                s = "☐ " + s
            } else if marker.lowercased().contains("[x]") {
                s = "☑ " + s
            }
        }
        s = s.replacingOccurrences(of: #"!\[([^\]]*)\]\([^)]*\)"#, with: "$1", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\[([^\]]+)\]\([^)]*\)"#, with: "$1", options: .regularExpression)
        // 公式只留 LaTeX 源码；“花了 $5 和 $6”这种钱数不动
        s = s.replacingOccurrences(of: #"(?<!\\)\$\$(.+?)\$\$"#, with: "$1", options: .regularExpression)
        s = s.replacingOccurrences(of: #"(?<!\\)\$(?![\s\d])([^$]+?)(?<![\s\\])\$(?!\d)"#, with: "$1", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\\\((.+?)\\\)"#, with: "$1", options: .regularExpression)
        for token in ["**", "__", "~~", "`"] {
            s = s.replacingOccurrences(of: token, with: "")
        }
        // 单个 * 的斜体可以在词中间（“是*信号处理*的”）；单个 _ 的不行（snake_case 不动）
        s = s.replacingOccurrences(of: #"\*(?![\s*])([^*]+?)(?<![\s*])\*"#, with: "$1", options: .regularExpression)
        s = s.replacingOccurrences(of: #"(?<![\p{L}\p{N}_])_(?![\s_])([^_]+?)(?<![\s_])_(?![\p{L}\p{N}_])"#, with: "$1", options: .regularExpression)
        // 表格的一行：去掉竖线
        if s.hasPrefix("|") {
            s = s.split(separator: "|").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.joined(separator: " ")
        }
        s = s.replacingOccurrences(of: "\\$", with: "$")
        return s.trimmingCharacters(in: .whitespaces)
    }
}
