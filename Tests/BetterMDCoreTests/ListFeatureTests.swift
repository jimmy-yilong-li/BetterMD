import CoreGraphics
import Foundation
import Testing
@testable import BetterMDCore

struct ListFeatureTests {
    func note(_ path: String, _ text: String) -> Note {
        Note(path: path, text: text, created: .now, modified: .now)
    }

    @Test func tagFilterInsideAFolder() {
        let notes = [
            note("工作/a.md", "# 甲\n#会议/周会"),
            note("工作/b.md", "# 乙\n#想法"),
            note("工作/客户/c.md", "# 丙\n#会议"),
            note("读书/d.md", "# 丁\n#会议"),
        ]
        #expect(LibraryIndex.chipTags(notes, in: .folder("工作")) == ["会议", "想法"])
        let meetings = LibraryIndex.visible(notes, scope: .folder("工作"), query: "", tag: "会议").map(\.title)
        #expect(Set(meetings) == ["甲", "丙"])
    }

    @Test func searchAllIgnoresScopeAndFilter() {
        let notes = [note("工作/a.md", "# 周会记录"), note("读书/b.md", "# 读书周会"), note("废纸篓/c.md", "# 周会旧稿")]
        #expect(LibraryIndex.visible(notes, scope: .folder("工作"), query: "周会").count == 1)
        #expect(LibraryIndex.visible(notes, scope: .folder("工作"), query: "周会", tag: "x", searchAll: true).count == 2)
        // 没有搜索词时，搜全部不起作用
        #expect(LibraryIndex.visible(notes, scope: .folder("工作"), query: " ", searchAll: true).count == 1)
    }

    @Test func scopeTitles() {
        #expect(LibraryIndex.scopeTitle(.folder("工作/BetterMD")) == "BetterMD")
        #expect(LibraryIndex.scopeDescription(.folder("工作/BetterMD")) == "工作 / BetterMD")
        #expect(LibraryIndex.scopeDescription(.folder("工作")) == nil)
        #expect(LibraryIndex.scopeTitle(.tag("会议")) == "#会议")
        #expect(LibraryIndex.scopeDescription(.todo) == "还有没勾掉的任务")
    }

    @Test func firstImageSkipsCode() {
        #expect(NoteText.firstImage(in: "# 题\n```\n![](代码里.png)\n```\n文字 ![图](附件/a.png) 和 ![](b.png)") == "附件/a.png")
        #expect(NoteText.firstImage(in: "![](<附件/a b.png>)") == "<附件/a b.png>")
        #expect(NoteText.firstImage(in: "没有图") == nil)
        #expect(note("a.md", "![](x.png)").parsed.firstImage == "x.png")
    }

    @Test func resolveLinks() {
        #expect(MarkdownLinks.resolve("../附件/a%20b.png", from: "工作") == "附件/a b.png")
        #expect(MarkdownLinks.resolve("<附件/a b.png>", from: "") == "附件/a b.png")
        #expect(MarkdownLinks.resolve("/附件/a.png", from: "工作/客户") == "附件/a.png")
        #expect(MarkdownLinks.resolve("https://x.com/a.png", from: "") == nil)
        #expect(MarkdownLinks.resolve("../a.png", from: "") == nil)
    }

    @Test func svgPathsMatchTheIcons() {
        let ribbon = SVGPath.cgPath("M0 0h10v17.2l-5-3.9-5 3.9z").boundingBoxOfPath
        #expect(abs(ribbon.minX) < 0.001 && abs(ribbon.maxX - 10) < 0.001 && abs(ribbon.maxY - 17.2) < 0.001)
        // 数字之间不写分隔符、相对坐标的曲线（信封封盖）
        let flap = SVGPath.cgPath("M1.6 6.9h14.8l-6.5 4.8c-.54.4-1.26.4-1.8 0z").boundingBoxOfPath
        #expect(abs(flap.minX - 1.6) < 0.001 && abs(flap.maxX - 16.4) < 0.001)
        #expect(abs(flap.minY - 6.9) < 0.001 && flap.maxY > 11.6 && flap.maxY < 12.1)
        // 两段折线
        let lines = SVGPath.cgPath("M5.2 5.3h7.6M5.2 7h5.4").boundingBoxOfPath
        #expect(abs(lines.maxX - 12.8) < 0.001 && abs(lines.maxY - 7) < 0.001)
    }
}

@MainActor
struct ListFilterModelTests {
    @Test func filterResetsWithScopeAndSearchAllResetsWithQuery() throws {
        let root = try TempDir.make()
        try root.write("# 甲\n#会议", to: "工作/a.md")
        try root.write("# 乙\n#想法", to: "工作/b.md")
        let model = AppModel(root: root)
        model.load()
        model.scope = .folder("工作")
        #expect(model.chipTags == ["会议", "想法"])
        model.tagFilter = "会议"
        #expect(model.visibleNotes.map(\.title) == ["甲"])
        model.scope = .all
        #expect(model.tagFilter == nil)
        model.query = "乙"
        model.searchAll = true
        model.query = ""
        #expect(model.searchAll == false)
    }
}
