import Foundation
import Testing
@testable import BetterMDCore

struct LibraryLayoutTests {
    @Test func fileNameReplacesUnsafeCharacters() {
        #expect(LibraryLayout.fileName(forTitle: "a/b: c") == "a／b： c")
    }

    @Test func fileNameFallsBackForEmptyTitle() {
        #expect(LibraryLayout.fileName(forTitle: "   ") == "无标题")
    }

    @Test func fileNameDropsLeadingDotsAndNewlines() {
        #expect(LibraryLayout.fileName(forTitle: "..隐藏\n第二行") == "隐藏 第二行")
    }

    @Test func fileNameIsCappedAt80Characters() {
        #expect(LibraryLayout.fileName(forTitle: String(repeating: "长", count: 100)).count == 80)
    }

    @Test func uniqueURLAddsNumberWhenTaken() throws {
        let dir = try TempDir.make()
        try dir.write("x", to: "计划.md")
        #expect(LibraryLayout.uniqueURL(in: dir, base: "计划").lastPathComponent == "计划 2.md")
        #expect(LibraryLayout.uniqueURL(in: dir, base: "新").lastPathComponent == "新.md")
    }

    @Test func uniqueURLTreatsTheFileItselfAsFree() throws {
        let dir = try TempDir.make()
        try dir.write("x", to: "readme.md")
        let current = dir.appendingPathComponent("readme.md")
        #expect(LibraryLayout.uniqueURL(in: dir, base: "README", excluding: current).lastPathComponent == "README.md")
    }
}

struct NoteTests {
    @Test func folderComesFromPath() {
        let note = Note(path: "工作/BetterMD/界面.md", text: "# 界面", created: .now, modified: .now)
        #expect(note.folder == "工作/BetterMD")
        #expect(!note.isTrashed)
        #expect(note.fileBaseName == "界面")
    }

    @Test func rootNoteIsUnfiled() {
        #expect(Note(path: "随手记.md", text: "", created: .now, modified: .now).folder == "")
    }

    @Test func trashedNoteRemembersOriginalFolder() {
        let note = Note(path: "废纸篓/旧.md", text: "# 旧", created: .now, modified: .now, originalFolder: "工作")
        #expect(note.isTrashed)
        #expect(note.folder == "工作")
    }

    @Test func parsedFieldsFollowTextChanges() {
        var note = Note(path: "a.md", text: "# 旧标题", created: .now, modified: .now)
        note.text = "# 新标题\n#标签"
        #expect(note.title == "新标题")
        #expect(note.parsed.tags == ["标签"])
    }

    @Test func emptyTitleShowsPlaceholder() {
        #expect(Note(path: "a.md", text: "", created: .now, modified: .now).title == "无标题")
    }

    @Test func withIDKeepsEverythingElse() {
        let note = Note(path: "a.md", text: "# 甲", created: .now, modified: .now, isPinned: true)
        let id = UUID()
        let copy = note.withID(id)
        #expect(copy.id == id)
        #expect(copy.path == note.path && copy.text == note.text && copy.isPinned)
    }
}

struct NoteDateTests {
    @Test func labels() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try #require(TimeZone(identifier: "Asia/Shanghai"))
        func date(_ y: Int, _ m: Int, _ d: Int, _ h: Int, _ min: Int = 0) throws -> Date {
            try #require(calendar.date(from: DateComponents(year: y, month: m, day: d, hour: h, minute: min)))
        }
        let now = try date(2026, 10, 7, 14)
        #expect(NoteDate.label(for: try date(2026, 10, 7, 10, 24), now: now, calendar: calendar) == "今天 10:24")
        #expect(NoteDate.label(for: try date(2026, 10, 6, 19, 5), now: now, calendar: calendar) == "昨天 19:05")
        #expect(NoteDate.label(for: try date(2026, 10, 3, 9), now: now, calendar: calendar) == "10月3日")
        #expect(NoteDate.label(for: try date(2025, 12, 30, 9), now: now, calendar: calendar) == "2025年12月30日")
    }
}
