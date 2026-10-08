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


}
