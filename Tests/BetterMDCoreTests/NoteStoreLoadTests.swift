import Foundation
import Testing
@testable import BetterMDCore

struct NoteStoreLoadTests {
    @Test func prepareCreatesTheLayout() throws {
        let root = try TempDir.make()
        try NoteStore(root: root).prepare()
        #expect(root.exists("附件"))
        #expect(root.exists("废纸篓"))
        #expect(root.exists(".bettermd"))
    }

    @Test func loadFindsNotesFoldersAndTrash() throws {
        let root = try TempDir.make()
        let store = NoteStore(root: root)
        try store.prepare()
        try root.write("# 随手记", to: "随手记.md")
        try root.write("# 计划", to: "工作/BetterMD/计划.md")
        try FileManager.default.createDirectory(at: root.appendingPathComponent("空文件夹"), withIntermediateDirectories: true)
        try root.write("# 旧", to: "废纸篓/旧.md")
        try root.write("不是笔记", to: "工作/说明.txt")
        try root.write("# 图里的", to: "附件/不算.md")
        var state = LibraryState()
        state.pinned = ["随手记.md"]
        state.trashOrigins = ["废纸篓/旧.md": "工作"]
        try store.saveState(state)

        let snapshot = try store.load()

        #expect(Set(snapshot.notes.map(\.path)) == ["随手记.md", "工作/BetterMD/计划.md", "废纸篓/旧.md"])
        #expect(snapshot.folders == ["工作", "工作/BetterMD", "空文件夹"])
        #expect(snapshot.notes.first { $0.path == "随手记.md" }?.isPinned == true)
        #expect(snapshot.notes.first { $0.path == "废纸篓/旧.md" }?.folder == "工作")
    }

    @Test func unreadableFilesAreSkippedAndUntouched() throws {
        let root = try TempDir.make()
        let bad = Data([0xFF, 0xFF, 0xFF])
        try bad.write(to: root.appendingPathComponent("坏.md"))
        let snapshot = try NoteStore(root: root).load()
        #expect(snapshot.notes.isEmpty)
        #expect(try Data(contentsOf: root.appendingPathComponent("坏.md")) == bad)
    }

    @Test func gb18030FilesAreReadable() throws {
        let root = try TempDir.make()
        let gb18030 = String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(
            CFStringEncoding(CFStringEncodings.GB_18030_2000.rawValue)))
        let data = try #require("# 旧文件\n中文内容".data(using: gb18030))
        try data.write(to: root.appendingPathComponent("旧.md"))
        let snapshot = try NoteStore(root: root).load()
        #expect(snapshot.notes.first?.title == "旧文件")
    }

    @Test func writeKeepsCreationDate() throws {
        let root = try TempDir.make()
        let store = NoteStore(root: root)
        var note = try store.createNote(text: "# 草稿", inFolder: "")
        let past = Date(timeIntervalSince1970: 1_000_000_000)
        try FileManager.default.setAttributes([.creationDate: past], ofItemAtPath: store.url(for: note.path).path)
        note.text = "# 草稿\n改过了"
        try store.write(note)
        let values = try store.url(for: note.path).resourceValues(forKeys: [.creationDateKey])
        #expect(values.creationDate == past)
        #expect(try root.read(note.path) == "# 草稿\n改过了")
    }

    @Test func createNoteNamesFileAfterTitleAndAvoidsCollisions() throws {
        let store = NoteStore(root: try TempDir.make())
        let first = try store.createNote(text: "# 周会", inFolder: "工作")
        let second = try store.createNote(text: "# 周会", inFolder: "工作")
        #expect(first.path == "工作/周会.md")
        #expect(second.path == "工作/周会 2.md")
    }

    @Test func stateRoundTripsAndToleratesMissingKeys() throws {
        let root = try TempDir.make()
        let store = NoteStore(root: root)
        try root.write("{\"pinned\": [\"a.md\"]}", to: ".bettermd/state.json")
        var state = store.loadState()
        #expect(state.pinned == ["a.md"])
        #expect(state.welcomed == false)
        state.welcomed = true
        try store.saveState(state)
        #expect(store.loadState() == state)
    }
}
