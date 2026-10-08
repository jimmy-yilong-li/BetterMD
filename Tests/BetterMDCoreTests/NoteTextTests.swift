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

    @Test func previewDropsMarkdownAndMathSource() {
        #expect(NoteText.preview(of: "# T\n\n是*信号处理*的基础，**粗体**和 `code`") == "是信号处理的基础，粗体和 code")
        #expect(NoteText.preview(of: "# T\n\nNeuron $e^{i\\theta}$ 和 \\( y = x \\) 公式") == "Neuron e^{i\\theta} 和  y = x  公式")
        #expect(NoteText.preview(of: "# T\n\n$$\nx^2\n$$\n\\[\ny\n\\]\n后面") == "后面")
        #expect(NoteText.preview(of: "# T\n\n$$x^2$$\n后面") == "后面")
        #expect(NoteText.preview(of: "# T\n\n| a | b |\n|---|:-:|\n| 1 | 2 |") == "a b 1 2")
        #expect(NoteText.preview(of: "# T\n\nsnake_case_name 和 _强调_") == "snake_case_name 和 强调")
        #expect(NoteText.preview(of: "# T\n\n花了 $5 和 $6，转义的 \\$7") == "花了 $5 和 $6，转义的 $7")
        #expect(NoteText.preview(of: "# T\n\n---\n文字") == "文字")
    }

    @Test func searchSnippetLooksOnlyAtTheBody() {
        // 只有标题命中：交给普通摘要
        #expect(NoteText.searchSnippet(of: "# 周会\n\n别的内容", terms: ["周会"]) == nil)
        // 正文命中：去掉 Markdown 符号，前面有内容时加省略号
        let text = "# 题\n\n第一段\n\n这是 **周会** 的记录，$x$ 公式"
        #expect(NoteText.searchSnippet(of: text, terms: ["周会"]) == "…这是 周会 的记录，x 公式")
        // 多个词取最早命中的；不分大小写
        #expect(NoteText.searchSnippet(of: "# T\nAlpha beta\ngamma", terms: ["GAMMA", "beta"])?.contains("beta") == true)
    }

    @Test func searchSnippetIsFastOnLongNotes() {
        let long = "# 长笔记\n" + String(repeating: "很长的一行 **粗体** 和 $x^2$ 公式。\n", count: 20_000) + "结尾的关键词"
        let clock = ContinuousClock()
        var snippet: String?
        let time = clock.measure { snippet = NoteText.searchSnippet(of: long, terms: ["关键词"]) }
        #expect(snippet?.contains("关键词") == true)
        #expect(time < .milliseconds(150), "用了 \(time)")
    }
}
