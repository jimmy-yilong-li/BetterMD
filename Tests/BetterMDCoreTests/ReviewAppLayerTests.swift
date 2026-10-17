import Foundation
import Testing
@testable import BetterMDCore

/// Repros for the app-layer review (not part of the real repo).
@MainActor
struct ReviewAppLayerTests {
    func makeModel(_ files: [String: String]) throws -> (URL, AppModel) {
        let root = try TempDir.make()
        for (path, text) in files { try root.write(text, to: path) }
        let model = AppModel(root: root)
        model.saveDelay = .seconds(60)
        model.load()
        return (root, model)
    }

    func full(_ root: URL, _ path: String) -> String { root.appendingPathComponent(path).path }

    func externalWrite(_ root: URL, _ text: String, to path: String) throws {
        try root.write(text, to: path)
        // make sure the mtime differs from what the App recorded
        try FileManager.default.setAttributes([.modificationDate: Date().addingTimeInterval(5)],
                                              ofItemAtPath: full(root, path))
    }

    /// While typing in a note that no longer matches the current scope (todo checked off),
    /// an unrelated external file change reloads and yanks the selection to another note.
    @Test func unrelatedExternalChangeKeepsSelection() throws {
        let (root, model) = try makeModel(["甲.md": "# 甲\n- [ ] 买菜", "乙.md": "# 乙\n- [ ] 洗衣"])
        model.scope = .todo
        let a = try #require(model.notes.first { $0.title == "甲" })
        model.select(a.id)
        model.updateText("# 甲\n- [x] 买菜", for: a.id) // user ticks the last todo in the editor
        #expect(model.selectedID == a.id)
        try externalWrite(root, "# 丙", to: "丙.md")     // e.g. an agent / VS Code writes another note
        #expect(model.filesChanged([full(root, "丙.md")]))
        #expect(model.selectedID == a.id, "selection jumped to \(model.selectedNote?.title ?? "nil") while typing")
    }

    /// Same with a search: the user edits away the search word, then any external change happens.
    @Test func unrelatedExternalChangeKeepsSelectionWhileSearching() throws {
        let (root, model) = try makeModel(["甲.md": "# 甲\n周会纪要", "乙.md": "# 乙\n周会安排"])
        model.query = "周会"
        let a = try #require(model.notes.first { $0.title == "甲" })
        model.select(a.id)
        model.updateText("# 甲\n纪要", for: a.id)
        try externalWrite(root, "# 丙", to: "丙.md")
        model.filesChanged([full(root, "丙.md")])
        #expect(model.selectedID == a.id, "selection jumped to \(model.selectedNote?.title ?? "nil") while typing")
    }

    /// Control: App has unsaved text when the outside edit lands -> outside version is kept as a copy.
    @Test func controlDirtyAppKeepsOutsideCopy() throws {
        let (root, model) = try makeModel(["甲.md": "# 甲\n原文"])
        let a = try #require(model.notes.first)
        model.select(a.id)
        model.updateText("# 甲\n原文加字", for: a.id)
        try externalWrite(root, "# 甲\n外面改的", to: "甲.md")
        model.filesChanged([full(root, "甲.md")])
        let files = try FileManager.default.contentsOfDirectory(atPath: root.path)
        #expect(files.contains { $0.contains("别处的版本") })
    }

    /// Editor is ahead of the App (IME composing, or a change message in flight) when the outside edit lands:
    /// App reloads (diskModified := outside mtime), editor rejects setDocument as stale and resends its text.
    /// The resend is saved over the outside version and no copy is made.
    @Test func staleEditorResendSilentlyDropsOutsideEdit() throws {
        let (root, model) = try makeModel(["甲.md": "# 甲\n原文"])
        let a = try #require(model.notes.first)
        model.select(a.id)
        try externalWrite(root, "# 甲\n外面改的", to: "甲.md")
        #expect(model.filesChanged([full(root, "甲.md")]))
        #expect(model.selectedNote?.text == "# 甲\n外面改的")
        // editor was composing on the old text; after composition it resends its own text
        // 编辑器拒收了 App 送去的外面那一版、重发自己的：消息里带着 overrode（见 editor/src/main.js updateDocument）
        model.updateText("# 甲\n原文我", for: a.id, overrodeApp: true)
        model.flushPendingSave()
        let files = try FileManager.default.contentsOfDirectory(atPath: root.path)
        let disk = try root.read("甲.md")
        let kept = files.contains { $0.contains("别处的版本") } || disk.contains("外面改的")
        #expect(kept, "outside edit lost: disk=\(disk) files=\(files)")
    }
}
