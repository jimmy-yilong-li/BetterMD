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
        var fences = FenceTracker()
        for raw in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = String(raw)
            if fences.isCode(line) || isIndentedCode(line) { continue }
            for tag in tagsInLine(removingInlineCode(line)) where seen.insert(tag).inserted {
                result.append(tag)
            }
        }
        return result
    }

    /// 有没有还没勾掉的待办（`- [ ]`、`* [ ]`、`+ [ ]`）；代码块里的不算。
    public static func hasOpenTodo(_ text: String) -> Bool {
        var fences = FenceTracker()
        for raw in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = String(raw)
            if fences.isCode(line) { continue }
            let t = line.trimmingCharacters(in: .whitespaces)
            if t.hasPrefix("- [ ]") || t.hasPrefix("* [ ]") || t.hasPrefix("+ [ ]") { return true }
        }
        return false
    }

    /// 正文里第一张图片的地址（`![说明](地址)` 里的地址，原样返回）；代码块里的不算。没有图片返回 nil。
    public static func firstImage(in text: String) -> String? {
        guard text.contains("![") else { return nil }
        var fences = FenceTracker()
        for raw in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = String(raw)
            if fences.isCode(line) || !line.contains("![") { continue }
            if let match = line.firstMatch(of: #/!\[[^\]]*\]\((<[^>\n]*>|[^)\s]+)/#) {
                return String(match.output.1)
            }
        }
        return nil
    }

    /// 搜索结果里的摘要：正文（不含标题行）里第一个命中处附近的一段，去掉 Markdown 符号；只有标题命中时返回 nil。
    /// 只清理命中的那几行，长笔记也很快。
    public static func searchSnippet(of text: String, terms: [String], before: Int = 12, length: Int = 80) -> String? {
        guard !terms.isEmpty else { return nil }
        let options: String.CompareOptions = [.caseInsensitive, .widthInsensitive, .diacriticInsensitive]
        let bodyStart = text.firstIndex(of: "\n").map { text.index(after: $0) } ?? text.endIndex
        let body = text[bodyStart...]
        // 搜索词已经统一过大小写、全角半角，多数情况（尤其是中文）逐字就能找到，比不分大小写的查找快得多；
        // 逐字找不到的词，再用不分大小写的查找
        let hit = terms.compactMap { term in body.firstRange(of: term) ?? body.range(of: term, options: options) }
            .min { $0.lowerBound < $1.lowerBound }
        guard let hit else { return nil }
        // 命中所在的那一行和后面两行
        let lineStart = body[..<hit.lowerBound].lastIndex(of: "\n").map { body.index(after: $0) } ?? body.startIndex
        var lines: [String] = []
        var cursor = lineStart
        while cursor < body.endIndex && lines.count < 3 {
            let end = body[cursor...].firstIndex(of: "\n") ?? body.endIndex
            let line = plain(body[cursor..<end].trimmingCharacters(in: .whitespaces))
            if !line.isEmpty { lines.append(line) }
            cursor = end < body.endIndex ? body.index(after: end) : end
        }
        let cleaned = lines.joined(separator: " ")
        let again = terms.compactMap { cleaned.range(of: $0, options: options) }.min { $0.lowerBound < $1.lowerBound }
        let start = again.flatMap { cleaned.index($0.lowerBound, offsetBy: -before, limitedBy: cleaned.startIndex) } ?? cleaned.startIndex
        let end = cleaned.index(start, offsetBy: length, limitedBy: cleaned.endIndex) ?? cleaned.endIndex
        let piece = String(cleaned[start..<end])
        return (start > cleaned.startIndex || lineStart > body.startIndex ? "…" : "") + piece
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

    /// 逐行判断在不在代码块里：``` 和 ~~~ 都算，结尾的围栏要和开头是同一种符号、而且不比开头短
    /// （``` 代码块里出现的 ~~~ 不会被当成结尾）。
    struct FenceTracker {
        private var open: (mark: Character, length: Int)?

        /// 这一行是代码（包括围栏那一行）就返回 true。
        mutating func isCode(_ line: String) -> Bool {
            let t = line.trimmingCharacters(in: .whitespaces)
            if let current = open {
                let run = t.prefix { $0 == current.mark }.count
                if run >= current.length && t.dropFirst(run).trimmingCharacters(in: .whitespaces).isEmpty { open = nil }
                return true
            }
            if let first = t.first, first == "`" || first == "~" {
                let run = t.prefix { $0 == first }.count
                if run >= 3 {
                    open = (first, run)
                    return true
                }
            }
            return false
        }
    }

    /// 逐行判断是不是代码：围栏代码块，以及按 CommonMark 规则认的缩进代码块——
    /// 缩进 4 格（或一个 Tab），前面是空行或者也是缩进代码，而且不在列表里（列表项缩进的续行是正文）。
    struct CodeTracker {
        private var fences = FenceTracker()
        private var previousBlank = true
        private var inIndentedCode = false
        private var inList = false

        mutating func isCode(_ line: String) -> Bool {
            if fences.isCode(line) {
                previousBlank = false
                inIndentedCode = false
                return true
            }
            let blank = line.trimmingCharacters(in: .whitespaces).isEmpty
            defer { previousBlank = blank }
            if blank { return inIndentedCode }
            let indented = line.hasPrefix("    ") || line.hasPrefix("\t")
            if indented && (inIndentedCode || (previousBlank && !inList)) {
                inIndentedCode = true
                return true
            }
            inIndentedCode = false
            if !indented {
                inList = line.trimmingCharacters(in: .whitespaces).firstMatch(of: #/^(?:[-*+]|\d+[.)])(?:\s|$)/#) != nil
                    || (inList && !previousBlank) // 列表项的懒续行
            }
            return false
        }
    }

    /// 缩进 4 格（或一个 Tab）的代码行；列表项缩进的不算。
    static func isIndentedCode(_ line: String) -> Bool {
        guard line.hasPrefix("    ") || line.hasPrefix("\t") else { return false }
        let t = line.trimmingCharacters(in: .whitespaces)
        return !t.isEmpty && t.firstMatch(of: #/^(?:[-*+]|\d+[.)])\s/#) == nil
    }

    static func isFence(_ line: String) -> Bool {
        let t = line.trimmingCharacters(in: .whitespaces)
        return t.hasPrefix("```") || t.hasPrefix("~~~")
    }

    /// 标签遇到这些字符就结束。
    static let tagTerminators: Set<Character> = [
        "#", ",", ";", ":", "!", "?", "(", ")", "[", "]", "\"", "'", "*", "~", "|", "<", ">", "`",
        "，", "。", "、", "；", "：", "！", "？", "（", "）", "【", "】", "「", "」", "“", "”", "…",
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
            // 纯数字不算标签（“PR #42”“第 #3 条”）
            if !tag.isEmpty && !tag.allSatisfy(\.isNumber) { tags.append(tag) }
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
        if line.hasPrefix("$$") {
            let rest = line.dropFirst(2)
            guard let close = rest.range(of: "$$") else { return ("$$", false) }
            // $$…$$ 后面还有别的字：是段落里的公式，不是公式块
            return rest[close.upperBound...].trimmingCharacters(in: .whitespaces).isEmpty ? ("$$", true) : nil
        }
        if line == "\\[" { return ("\\]", false) }
        if line.hasPrefix("\\[") && line.hasSuffix("\\]") && line.count > 4 { return ("\\]", true) }
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

    /// 行内代码和公式原样保留（只去掉两头的记号），其余部分去掉 Markdown 符号。
    static func cleanInline(_ line: String) -> String {
        let ns = line as NSString
        var out = ""
        var position = 0
        while position < ns.length {
            let rest = NSRange(location: position, length: ns.length - position)
            let hits = protectedSpans.compactMap { $0.firstMatch(in: line, range: rest) }
            guard let hit = hits.min(by: { $0.range.location < $1.range.location }) else { break }
            out += cleanText(ns.substring(with: NSRange(location: position, length: hit.range.location - position)))
            out += ns.substring(with: hit.range(at: hit.numberOfRanges - 1))
            position = hit.range.location + hit.range.length
        }
        if position < ns.length { out += cleanText(ns.substring(from: position)) }
        return out
    }

    /// 原样保留的部分：行内代码（反引号成对）、$$…$$、$…$（“花了 $5 和 $6”这种钱数不算）、\(…\)。
    /// 最后一个捕获组是要留下的内容。
    static let protectedSpans: [NSRegularExpression] = [
        #"(`+)(.+?)\1"#,
        #"(?<!\\)\$\$(.+?)\$\$"#,
        #"(?<!\\)\$(?![\s\d])([^$]+?)(?<![\s\\])\$(?!\d)"#,
        #"\\\((.+?)\\\)"#,
    ].map { try! NSRegularExpression(pattern: $0) }

    /// 普通文字里的 Markdown 符号：图片、链接、成对的粗体斜体删除线（单个的 * _ 不动，“2**10”“____”照原样）、转义。
    static func cleanText(_ text: String) -> String {
        var s = text
        let rules: [(String, String)] = [
            (#"!\[([^\]]*)\]\([^)]*\)"#, "$1"),
            (#"\[([^\]]+)\]\([^)]*\)"#, "$1"),
            (#"\*\*(?=\S)(.+?)(?<=\S)\*\*"#, "$1"),
            (#"(?<![\p{L}\p{N}_])__(?=\S)(.+?)(?<=\S)__(?![\p{L}\p{N}_])"#, "$1"),
            (#"~~(?=\S)(.+?)(?<=\S)~~"#, "$1"),
            (#"(?<!\*)\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?!\*)"#, "$1"),
            (#"(?<![\p{L}\p{N}_])_(?=[^\s_])(.+?)(?<=[^\s_])_(?![\p{L}\p{N}_])"#, "$1"),
            (#"\\([\\`*_{}\[\]()#+\-.!$~|>])"#, "$1"),
        ]
        for (pattern, template) in rules {
            s = s.replacingOccurrences(of: pattern, with: template, options: .regularExpression)
        }
        return s
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
        s = cleanInline(s)
        // 表格的一行：去掉竖线
        if s.hasPrefix("|") {
            s = s.split(separator: "|").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.joined(separator: " ")
        }
        return s.trimmingCharacters(in: .whitespaces)
    }
}
