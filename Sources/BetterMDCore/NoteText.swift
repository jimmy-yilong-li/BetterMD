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

    /// 列表里显示的摘要：跳过标题行和只有标签的行，去掉 Markdown 符号，最多 `limit` 个字符。
    public static func preview(of text: String, limit: Int = 120) -> String {
        var parts: [String] = []
        var length = 0
        var skippedTitle = false
        for raw in text.split(separator: "\n") {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty || isFence(line) { continue }
            if !skippedTitle { skippedTitle = true; continue }
            if isTagOnlyLine(line) { continue }
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
        for token in ["**", "__", "~~", "`"] {
            s = s.replacingOccurrences(of: token, with: "")
        }
        return s.trimmingCharacters(in: .whitespaces)
    }
}
