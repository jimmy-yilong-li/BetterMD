import Foundation
import Testing
@testable import BetterMDCore

struct LibraryIndexTests {
    let now = Date(timeIntervalSince1970: 1_800_000_000)

    func note(_ path: String, _ text: String, minutesAgo: Double = 0, pinned: Bool = false, origin: String? = nil) -> Note {
        Note(path: path, text: text, created: now, modified: now.addingTimeInterval(-minutesAgo * 60),
             isPinned: pinned, originalFolder: origin)
    }

    var sample: [Note] {
        [
            note("随手记.md", "# 随手记\n同步的想法", minutesAgo: 1),
            note("工作/周会.md", "# 周会\n#会议/周会\n- [ ] 排期", minutesAgo: 2),
            note("工作/BetterMD/界面.md", "# 界面设计\n#想法 同步方案", minutesAgo: 3, pinned: true),
            note("读书/傅里叶.md", "# 傅里叶变换\n#数学", minutesAgo: 4),
            note("废纸篓/旧.md", "# 旧方案\n#想法", minutesAgo: 5, origin: "工作"),
        ]
    }

    @Test func scopesFilterNotes() {
        func paths(_ scope: Scope) -> [String] { LibraryIndex.notes(sample, in: scope).map(\.path) }
        #expect(paths(.all).count == 4)
        #expect(paths(.unfiled) == ["随手记.md"])
        #expect(paths(.folder("工作")) == ["工作/周会.md", "工作/BetterMD/界面.md"])
        #expect(paths(.todo) == ["工作/周会.md"])
        #expect(paths(.tag("会议")) == ["工作/周会.md"])
        #expect(paths(.tag("想法")) == ["工作/BetterMD/界面.md"])
        #expect(paths(.trash) == ["废纸篓/旧.md"])
    }

    @Test func pinnedFirstThenNewest() {
        let titles = LibraryIndex.sorted(LibraryIndex.notes(sample, in: .all)).map(\.title)
        #expect(titles == ["界面设计", "随手记", "周会", "傅里叶变换"])
    }

    @Test func searchRanksTitleHitsFirst() {
        let notes = [note("a.md", "# 会议纪要\n内容", minutesAgo: 9), note("b.md", "# 其他\n提到会议", minutesAgo: 1)]
        #expect(LibraryIndex.search(notes, query: "会议").map(\.path) == ["a.md", "b.md"])
    }

    @Test func searchNeedsAllTerms() {
        let hits = LibraryIndex.visible(sample, scope: .all, query: "同步 想法").map(\.path)
        #expect(Set(hits) == ["工作/BetterMD/界面.md", "随手记.md"])
    }

    @Test func emptyQueryJustSorts() {
        #expect(LibraryIndex.search(sample, query: "  ").count == 5)
    }

    @Test func folderTreeNestsPaths() {
        let tree = LibraryIndex.folderTree(["读书", "工作", "工作/客户", "工作/BetterMD"])
        #expect(tree.map(\.name) == ["工作", "读书"])
        #expect(tree[0].children?.map(\.path) == ["工作/BetterMD", "工作/客户"])
        #expect(tree[1].children == nil)
    }

    @Test func tagTreeIncludesParentsAndSkipsTrash() {
        let tree = LibraryIndex.tagTree(sample)
        #expect(Set(tree.map(\.name)) == ["会议", "数学", "想法"])
        #expect(tree.first { $0.name == "会议" }?.children?.map(\.path) == ["会议/周会"])
    }

    @Test func newNotePlacement() {
        #expect(LibraryIndex.folderForNewNote(in: .folder("工作")) == "工作")
        #expect(LibraryIndex.folderForNewNote(in: .tag("想法")) == "")
        #expect(NoteText.tags(in: LibraryIndex.newNoteText(for: .tag("想法"))) == ["想法"])
        #expect(NoteText.hasOpenTodo(LibraryIndex.newNoteText(for: .todo)))
        #expect(NoteText.title(of: LibraryIndex.newNoteText(for: .all)) == "新笔记")
    }

    @Test func locationLabels() {
        let deep = note("工作/BetterMD/界面.md", "# 界面")
        #expect(LibraryIndex.locationLabel(for: deep, in: .all) == "工作 / BetterMD")
        #expect(LibraryIndex.locationLabel(for: deep, in: .folder("工作")) == "BetterMD")
        #expect(LibraryIndex.locationLabel(for: deep, in: .folder("工作/BetterMD")) == nil)
        #expect(LibraryIndex.locationLabel(for: note("a.md", ""), in: .all) == "未分类")
        #expect(LibraryIndex.locationLabel(for: note("a.md", ""), in: .unfiled) == nil)
    }

    @Test func searchStaysFastWithThousandsOfNotes() {
        let filler = String(repeating: "正文内容 lorem ipsum ", count: 40)
        let many = (0..<5000).map { i in
            note("n\(i).md", "# 笔记 \(i)\n" + filler + (i % 97 == 0 ? "关键词" : ""))
        }
        let elapsed = ContinuousClock().measure {
            _ = LibraryIndex.search(many, query: "关键词")
        }
        #expect(elapsed < .milliseconds(300))
    }
}
