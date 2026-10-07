import Foundation
import Testing
@testable import BetterMDCore

@MainActor
struct AppModelTests {
    func makeModel(_ files: [String: String] = [:]) throws -> (URL, AppModel) {
        let root = try TempDir.make()
        for (path, text) in files { try root.write(text, to: path) }
        let model = AppModel(root: root)
        model.saveDelay = .seconds(60)
        model.load()
        return (root, model)
    }

    @Test func firstLaunchAddsWelcomeNoteOnce() throws {
        let (root, model) = try makeModel()
        #expect(model.notes.map(\.title) == ["欢迎使用 BetterMD"])
        #expect(root.exists("欢迎使用 BetterMD.md"))
        try FileManager.default.removeItem(at: root.appendingPathComponent("欢迎使用 BetterMD.md"))
        model.reload()
        #expect(model.notes.isEmpty)
    }

    @Test func editsAreSavedAndFileFollowsTitleWhenLeavingNote() throws {
        let (root, model) = try makeModel(["a.md": "# 甲", "b.md": "# 乙"])
        let a = try #require(model.notes.first { $0.path == "a.md" })
        model.select(a.id)
        model.updateText("# 甲改\n新内容", for: a.id)
        #expect(try root.read("a.md") == "# 甲")
        model.select(model.notes.first { $0.path == "b.md" }?.id)
        #expect(try root.read("甲改.md") == "# 甲改\n新内容")
        #expect(!root.exists("a.md"))
        #expect(root.exists("b.md"))
    }

    @Test func viewingANoteDoesNotRenameIt() throws {
        let (root, model) = try makeModel(["2023-日记.md": "# 日记", "b.md": "# 乙"])
        model.select(model.notes.first { $0.path == "2023-日记.md" }?.id)
        model.select(model.notes.first { $0.path == "b.md" }?.id)
        #expect(root.exists("2023-日记.md"))
    }

    @Test func flushWritesPendingEdits() throws {
        let (root, model) = try makeModel(["a.md": "# 甲"])
        let a = try #require(model.notes.first)
        model.updateText("# 甲\n补一句", for: a.id)
        model.flushPendingSave()
        #expect(try root.read("a.md") == "# 甲\n补一句")
    }

    @Test func newNoteGoesWhereTheScopeSays() throws {
        let (root, model) = try makeModel(["工作/a.md": "# 甲\n#想法"])
        model.scope = .folder("工作")
        model.newNote()
        #expect(model.selectedNote?.path == "工作/新笔记.md")
        model.scope = .tag("想法")
        model.newNote()
        let tagged = try #require(model.selectedNote)
        #expect(tagged.folder == "")
        #expect(tagged.parsed.tags == ["想法"])
        #expect(root.exists("新笔记.md"))
    }

    @Test func pinningIsSavedAndSortsFirst() throws {
        let (root, model) = try makeModel(["a.md": "# 甲", "b.md": "# 乙"])
        let b = try #require(model.notes.first { $0.path == "b.md" })
        model.togglePin(b.id)
        #expect(model.visibleNotes.first?.id == b.id)
        #expect(NoteStore(root: root).loadState().pinned == ["b.md"])
    }

    @Test func moveTrashAndRestore() throws {
        let (root, model) = try makeModel(["工作/a.md": "# 甲"])
        let a = try #require(model.notes.first)
        model.move(a.id, toFolder: "生活")
        #expect(root.exists("生活/a.md"))
        #expect(model.folders.contains("生活"))
        model.trash(a.id)
        #expect(model.notes.first?.isTrashed == true)
        #expect(NoteStore(root: root).loadState().trashOrigins == ["废纸篓/a.md": "生活"])
        model.restore(a.id)
        #expect(model.notes.first?.path == "生活/a.md")
        #expect(NoteStore(root: root).loadState().trashOrigins.isEmpty)
    }

    @Test func renamingAFolderUpdatesNotesAndScope() throws {
        let (root, model) = try makeModel(["工作/客户/a.md": "# 甲"])
        model.scope = .folder("工作/客户")
        model.renameFolder("工作", to: "公司")
        #expect(model.folders == ["公司", "公司/客户"])
        #expect(model.notes.first?.path == "公司/客户/a.md")
        #expect(model.scope == .folder("公司/客户"))
        #expect(root.exists("公司/客户/a.md"))
    }

    @Test func reloadSeesOutsideEditsAndKeepsIDs() throws {
        let (root, model) = try makeModel(["a.md": "# 甲"])
        let id = try #require(model.notes.first?.id)
        try root.write("# 甲\n别的程序写的", to: "a.md")
        try root.write("# 新来的", to: "b.md")
        model.reload()
        let a = try #require(model.notes.first { $0.path == "a.md" })
        #expect(a.id == id)
        #expect(a.text == "# 甲\n别的程序写的")
        #expect(model.notes.count == 2)
        #expect(model.selectedID == id)
    }
}

@MainActor
struct AppModelEditorTests {
    @Test func newNoteIsFreshUntilYouLeaveIt() throws {
        let root = try TempDir.make()
        try root.write("# 甲", to: "甲.md")
        let model = AppModel(root: root)
        model.load()
        model.newNote()
        let fresh = try #require(model.selectedID)
        #expect(model.freshNoteID == fresh)
        let other = try #require(model.notes.first { $0.id != fresh })
        model.select(other.id)
        #expect(model.freshNoteID == nil)
    }

    @Test func attachmentLinkStartsFromTheNotesFolder() throws {
        let root = try TempDir.make()
        try root.write("# 周会", to: "工作/客户/周会.md")
        let model = AppModel(root: root)
        model.load()
        let note = try #require(model.notes.first)
        let link = try #require(model.addAttachment(Data([1]), fileName: "x.png", for: note.id))
        #expect(link.hasPrefix("../../附件/"))
        #expect(link.hasSuffix(".png"))
        #expect(root.exists(String(link.dropFirst(6))))
    }
}
