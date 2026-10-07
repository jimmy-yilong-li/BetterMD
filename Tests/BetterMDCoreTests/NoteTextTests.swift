import Testing
@testable import BetterMDCore

struct NoteTextTests {
    @Test func titleStripsHeadingMarker() {
        #expect(NoteText.title(of: "# 傅里叶变换笔记\n\n正文") == "傅里叶变换笔记")
    }

    @Test func titleSkipsBlankLinesAndKeepsPlainFirstLine() {
        #expect(NoteText.title(of: "\n\n买菜清单\n- [ ] 鸡蛋") == "买菜清单")
    }

    @Test func titleOfEmptyNoteIsEmpty() {
        #expect(NoteText.title(of: "  \n") == "")
    }

    @Test func tagsFindChineseNestedAndEnglishTags() {
        #expect(NoteText.tags(in: "# 标题\n#数学 #会议/周会 and #todo.\n") == ["数学", "会议/周会", "todo"])
    }

    @Test func tagsIgnoreHeadingsCodeAndURLs() {
        let text = "## 小标题\n`#不是标签` https://a.com/#anchor\n```\n#也不是\n```\n真的#不算 #是"
        #expect(NoteText.tags(in: text) == ["是"])
    }

    @Test func tagsStopAtChinesePunctuation() {
        #expect(NoteText.tags(in: "看这里 #想法，然后") == ["想法"])
    }

    @Test func tagsAreDeduplicatedAndTrimmed() {
        #expect(NoteText.tags(in: "#a #b #a #c/") == ["a", "b", "c"])
    }

    @Test func openTodoDetection() {
        #expect(NoteText.hasOpenTodo("- [x] 完成\n- [ ] 没完成"))
        #expect(!NoteText.hasOpenTodo("- [x] 完成"))
        #expect(!NoteText.hasOpenTodo("```\n- [ ] 代码里的\n```"))
    }

    @Test func previewSkipsTitleAndTagLinesAndStripsMarkdown() {
        let text = "# 标题\n#数学 #想法\n**核心思想**：看 [链接](https://x.com)\n- [ ] 待办"
        #expect(NoteText.preview(of: text) == "核心思想：看 链接 ☐ 待办")
    }

    @Test func previewIsLimited() {
        let text = "# t\n" + String(repeating: "字", count: 300)
        #expect(NoteText.preview(of: text, limit: 10).count == 10)
    }
}
