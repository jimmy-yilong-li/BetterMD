import Foundation
import Testing
@testable import BetterMDCore

/// 代码审查找到的解析问题：移动笔记改坏非链接文字、摘要吞字、标签认错。
struct ParsingReviewTests {
    @Test func movingLeavesInlineCodeAndProseAlone() {
        let text = """
        # 题
        代码 `[文字](地址)` 和 `handlers[key](event)` 不是链接
        [备注]: 2026/10/07 开会
        [图1]: 见下 ![](附件/a.png)
        [r]: 附件/b.png "标题"
        """
        let moved = MarkdownLinks.rebase(text, from: "", to: "工作")
        let lines = moved.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        #expect(lines[1] == "代码 `[文字](地址)` 和 `handlers[key](event)` 不是链接")
        #expect(lines[2] == "[备注]: 2026/10/07 开会")
        #expect(lines[3] == "[图1]: 见下 ![](../附件/a.png)")
        #expect(lines[4] == "[r]: ../附件/b.png \"标题\"")
    }

    @Test func unicodeSpacesInFileNamesAreEscaped() {
        let link = MarkdownLinks.link(from: "", to: "附件/a\u{3000}b\u{202F}c.png")
        #expect(link == "附件/a%E3%80%80b%E2%80%AFc.png")
        // 转义后的链接能被再次改写
        #expect(MarkdownLinks.rebase("![](\(link))", from: "", to: "工作") == "![](../\(link))")
    }

    @Test func fencesMustMatchTheirOpener() {
        let text = "```\n~~~\n#代码里\n```\n#外面"
        #expect(NoteText.tags(in: text) == ["外面"])
        #expect(MarkdownLinks.rebase("```\n~~~\n![](a.png)\n```\n![](b.png)", from: "", to: "工作")
            == "```\n~~~\n![](a.png)\n```\n![](../b.png)")
    }

    @Test func previewKeepsRealText() {
        func preview(_ body: String) -> String { NoteText.preview(of: "# T\n\n" + body) }
        #expect(preview("中国的首都是____。") == "中国的首都是____。")
        #expect(preview("算一下 2**10") == "算一下 2**10")
        #expect(preview("构造函数 `__init__`") == "构造函数 __init__")
        #expect(preview("公式 $f^*(x)=g^*(x)$ 成立") == "公式 f^*(x)=g^*(x) 成立")
        #expect(preview("路径 `$HOME/bin:$PATH`") == "路径 $HOME/bin:$PATH")
        #expect(preview("\\[1\\] Smith 的论文") == "[1] Smith 的论文")
        #expect(preview("\\[TODO] 修一下\n后面") == "[TODO] 修一下 后面")
        #expect(preview("$$E=mc^2$$ 是质能方程") == "E=mc^2 是质能方程")
        #expect(preview("**粗体**、*斜体*、~~删除~~、__粗__") == "粗体、斜体、删除、粗")
    }

    @Test func tagsThatAreNotTags() {
        #expect(NoteText.tags(in: "PR #42 和颜色 #FF0000") == ["FF0000"])
        #expect(NoteText.tags(in: "#想法……然后") == ["想法"])
        #expect(NoteText.tags(in: "#重要**") == ["重要"])
        #expect(NoteText.tags(in: "段落\n\n    #include <stdio.h>\n\n- 列表 #真标签\n    - 子项 #子标签") == ["真标签", "子标签"])
    }
}
