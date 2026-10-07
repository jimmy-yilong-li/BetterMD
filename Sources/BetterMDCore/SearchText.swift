import Foundation

/// 关键词搜索：统一大小写、全角半角和变音符号以后做子串匹配，不分词。
public enum SearchText {
    public static func fold(_ s: String) -> String {
        s.folding(options: [.caseInsensitive, .widthInsensitive, .diacriticInsensitive], locale: nil)
    }

    /// 按空白拆成关键词，并统一写法；空查询得到空数组。
    public static func terms(_ query: String) -> [String] {
        query.split(whereSeparator: \.isWhitespace).map { fold(String($0)) }.filter { !$0.isEmpty }
    }

    /// 每个关键词都出现在 `foldedText` 里才算命中。`foldedText` 必须已经用 `fold` 处理过。
    public static func matches(_ foldedText: String, terms: [String]) -> Bool {
        terms.allSatisfy { foldedText.contains($0) }
    }

    /// 第一个命中位置附近的一段原文：命中点前保留 `before` 个字符，总长 `length`。
    /// 前面截掉了内容时以“…”开头；没有命中返回 nil。
    public static func snippet(of text: String, terms: [String], before: Int = 12, length: Int = 80) -> String? {
        let chars = Array(text)
        var folded = ""
        var origin: [Int] = []
        for (i, ch) in chars.enumerated() {
            for f in fold(String(ch)) {
                folded.append(f)
                origin.append(i)
            }
        }
        var first: Int?
        for term in terms {
            guard let r = folded.range(of: term) else { continue }
            let k = folded.distance(from: folded.startIndex, to: r.lowerBound)
            if first.map({ k < $0 }) ?? true { first = k }
        }
        guard let hit = first, hit < origin.count else { return nil }
        let start = max(0, origin[hit] - before)
        let end = min(chars.count, start + length)
        let piece = String(chars[start..<end]).replacingOccurrences(of: "\n", with: " ")
        return start > 0 ? "…" + piece : piece
    }
}
