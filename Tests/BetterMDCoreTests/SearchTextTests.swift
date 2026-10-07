import Testing
@testable import BetterMDCore

struct SearchTextTests {
    @Test func foldingIgnoresCaseWidthAndDiacritics() {
        #expect(SearchText.fold("ＳｅａｒＣＨ Café") == "search cafe")
    }

    @Test func chineseSubstringMatchesWithoutSegmentation() {
        let key = SearchText.fold("私有云同步方案")
        #expect(SearchText.matches(key, terms: SearchText.terms("同步")))
        #expect(SearchText.matches(key, terms: SearchText.terms("云同")))
    }

    @Test func allTermsMustMatch() {
        let key = SearchText.fold("BetterMD 界面设计 sync")
        #expect(SearchText.matches(key, terms: SearchText.terms("界面 SYNC")))
        #expect(!SearchText.matches(key, terms: SearchText.terms("界面 同步")))
    }

    @Test func emptyQueryHasNoTerms() {
        #expect(SearchText.terms("  \n ").isEmpty)
    }

    @Test func snippetShowsTextAroundFirstHit() {
        let text = String(repeating: "前", count: 30) + "同步方案" + String(repeating: "后", count: 30)
        let snippet = SearchText.snippet(of: text, terms: SearchText.terms("同步"), before: 5, length: 12)
        #expect(snippet == "…前前前前前同步方案后后后")
    }

    @Test func snippetIsNilWithoutHit() {
        #expect(SearchText.snippet(of: "abc", terms: ["zzz"]) == nil)
    }
}
