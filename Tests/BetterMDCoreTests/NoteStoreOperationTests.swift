import Foundation
import Testing
@testable import BetterMDCore

struct NoteStoreOperationTests {
    func makeStore() throws -> (URL, NoteStore) {
        let root = try TempDir.make()
        let store = NoteStore(root: root)
        try store.prepare()
        return (root, store)
    }

    @Test func renameFollowsTitle() throws {
        let (root, store) = try makeStore()
        var note = try store.createNote(text: "# 旧名字", inFolder: "工作")
        note.text = "# 新名字\n正文"
        try store.write(note)
        let renamed = try store.renameToMatchTitle(note)
        #expect(renamed.path == "工作/新名字.md")
        #expect(root.exists("工作/新名字.md"))
        #expect(!root.exists("工作/旧名字.md"))
        #expect(try store.renameToMatchTitle(renamed) == renamed)
    }

    @Test func renameAvoidsTakenNamesAndStaysStable() throws {
        let (_, store) = try makeStore()
        _ = try store.createNote(text: "# 周会", inFolder: "")
        var other = try store.createNote(text: "# 草稿", inFolder: "")
        other.text = "# 周会"
        try store.write(other)
        let renamed = try store.renameToMatchTitle(other)
        #expect(renamed.path == "周会 2.md")
        #expect(try store.renameToMatchTitle(renamed).path == "周会 2.md")
    }

    @Test func renameHandlesCaseOnlyChanges() throws {
        let (root, store) = try makeStore()
        var note = try store.createNote(text: "# readme", inFolder: "")
        note.text = "# README"
        try store.write(note)
        let renamed = try store.renameToMatchTitle(note)
        #expect(renamed.path == "README.md")
        let names = try FileManager.default.contentsOfDirectory(atPath: root.path)
        #expect(names.contains("README.md"))
        #expect(!names.contains("readme.md"))
    }

    @Test func moveBetweenFolders() throws {
        let (root, store) = try makeStore()
        let note = try store.createNote(text: "# 计划", inFolder: "工作")
        let moved = try store.move(note, toFolder: "生活")
        #expect(moved.path == "生活/计划.md")
        #expect(root.exists("生活/计划.md"))
        #expect(!root.exists("工作/计划.md"))
        let back = try store.move(moved, toFolder: "")
        #expect(back.path == "计划.md")
        #expect(back.folder == "")
    }

    @Test func moveAvoidsOverwritingAnotherNote() throws {
        let (root, store) = try makeStore()
        _ = try store.createNote(text: "# 计划", inFolder: "生活")
        let note = try store.createNote(text: "# 计划", inFolder: "工作")
        let moved = try store.move(note, toFolder: "生活")
        #expect(moved.path == "生活/计划 2.md")
        #expect(root.exists("生活/计划.md"))
    }

    @Test func trashAndRestoreRoundTrip() throws {
        let (root, store) = try makeStore()
        let note = try store.createNote(text: "# 计划", inFolder: "工作/BetterMD")
        let trashed = try store.trash(note)
        #expect(trashed.path == "废纸篓/计划.md")
        #expect(trashed.isTrashed)
        #expect(trashed.folder == "工作/BetterMD")
        let restored = try store.restore(trashed)
        #expect(restored.path == "工作/BetterMD/计划.md")
        #expect(root.exists("工作/BetterMD/计划.md"))
    }

    @Test func restoreRecreatesMissingFolder() throws {
        let (root, store) = try makeStore()
        let trashed = try store.trash(try store.createNote(text: "# 孤儿", inFolder: "旧文件夹"))
        try FileManager.default.removeItem(at: root.appendingPathComponent("旧文件夹"))
        #expect(try store.restore(trashed).path == "旧文件夹/孤儿.md")
    }

    @Test func foldersAreCreatedAndRenamed() throws {
        let (root, store) = try makeStore()
        #expect(try store.createFolder(named: "读书", in: "") == "读书")
        #expect(try store.createFolder(named: "读书", in: "") == "读书 2")
        #expect(try store.createFolder(named: "废纸篓", in: "") == "废纸篓 文件夹")
        #expect(try store.createFolder(named: "客户", in: "工作") == "工作/客户")
        _ = try store.createNote(text: "# 需求", inFolder: "工作/客户")
        #expect(try store.renameFolder("工作", to: "公司") == "公司")
        #expect(root.exists("公司/客户/需求.md"))
    }

    @Test func stateFollowsPathChanges() {
        var state = LibraryState()
        let note = Note(path: "工作/a.md", text: "# a", created: .now, modified: .now, isPinned: true)
        state.record(from: note, to: note)
        #expect(state.pinned == ["工作/a.md"])

        var trashed = note
        trashed.path = "废纸篓/a.md"
        trashed.originalFolder = "工作"
        state.record(from: note, to: trashed)
        #expect(state.pinned == ["废纸篓/a.md"])
        #expect(state.trashOrigins == ["废纸篓/a.md": "工作"])

        var restored = trashed
        restored.path = "工作/a.md"
        restored.originalFolder = nil
        state.record(from: trashed, to: restored)
        #expect(state.trashOrigins.isEmpty)

        state.folderRenamed(from: "工作", to: "公司")
        #expect(state.pinned == ["公司/a.md"])
    }
}
