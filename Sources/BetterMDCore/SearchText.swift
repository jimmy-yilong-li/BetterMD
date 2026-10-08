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

}
