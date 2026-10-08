import Foundation
import Testing
@testable import BetterMDCore

/// 不丢字、不写坏文件：保存失败、晚到的改动、退出、移动失败、外部修改这些情况。
@MainActor
struct DataSafetyTests {
    func makeModel(_ files: [String: String]) throws -> (URL, AppModel) {
        let root = try TempDir.make()
        for (path, text) in files { try root.write(text, to: path) }
        let model = AppModel(root: root)
        model.saveDelay = .seconds(60)
        model.load()
        return (root, model)
    }

    func setWritable(_ url: URL, _ writable: Bool) throws {
        try FileManager.default.setAttributes([.posixPermissions: writable ? 0o755 : 0o555], ofItemAtPath: url.path)
    }

    @Test func failedSaveKeepsTheTextThroughReload() throws {
        let (root, model) = try makeModel(["工作/甲.md": "# 甲\n旧内容"])
        let note = try #require(model.notes.first)
        model.select(note.id)
        let folder = root.appendingPathComponent("工作")
        try setWritable(folder, false)
        defer { try? setWritable(folder, true) }
        model.updateText("# 甲\n新内容", for: note.id)
        model.flushPendingSave()
        #expect(model.lastError?.contains("保存失败") == true)
        // 权限恢复以后回到 App：内存里的新内容不能被磁盘上的旧内容盖掉，而且这次能存下去
        try setWritable(folder, true)
        model.reload()
        #expect(model.notes.first?.text == "# 甲\n新内容")
        #expect(try root.read("工作/甲.md") == "# 甲\n新内容")
    }

    @Test func lateTextAfterLeavingStillRenamesTheFile() throws {
        let (root, model) = try makeModel(["甲.md": "# 甲", "乙.md": "# 乙"])
        let a = try #require(model.notes.first { $0.title == "甲" })
        let b = try #require(model.notes.first { $0.title == "乙" })
        model.select(a.id)
        model.updateText("# 甲改", for: a.id)
        model.select(b.id)
        #expect(root.exists("甲改.md"))
        // 输入法选完的字在离开以后才到
        model.updateText("# 甲改好了", for: a.id)
        #expect(root.exists("甲改好了.md"))
        #expect(!root.exists("甲改.md"))
        #expect(try root.read("甲改好了.md") == "# 甲改好了")
    }

    @Test func quittingRenamesTheOpenNote() throws {
        let (root, model) = try makeModel([:])
        model.newNote()
        let id = try #require(model.selectedID)
        model.updateText("# 购物清单\n- 牛奶", for: id)
        model.finishAll()
        #expect(root.exists("购物清单.md"))
        #expect(!root.exists("新笔记.md"))
    }

    @Test func autosaveTimerWritesTheFile() async throws {
        let (root, model) = try makeModel(["甲.md": "# 甲"])
        model.saveDelay = .milliseconds(50)
        let note = try #require(model.notes.first)
        model.select(note.id)
        model.updateText("# 甲\n自动保存", for: note.id)
        // 停下 50 毫秒后就该存；测试一起跑时主线程忙，最多等 3 秒
        var saved = false
        for _ in 0..<60 where !saved {
            try await Task.sleep(for: .milliseconds(50))
            saved = (try? root.read("甲.md")) == "# 甲\n自动保存"
        }
        #expect(saved)
    }

    @Test func nonstopTypingStillSavesEveryFewSeconds() async throws {
        let (root, model) = try makeModel(["甲.md": "# 甲"])
        model.saveDelay = .seconds(10)
        model.maxSaveDelay = .milliseconds(200)
        let note = try #require(model.notes.first)
        model.select(note.id)
        for i in 0..<10 {
            model.updateText("# 甲\n第 \(i) 次", for: note.id)
            try await Task.sleep(for: .milliseconds(50))
        }
        #expect(try root.read("甲.md") != "# 甲", "一直在打字，也应该已经存过")
    }

    @Test func failedMoveLeavesTheNoteWhereItWas() throws {
        let (root, model) = try makeModel(["甲.md": "# 甲\n![](附件/a.png)"])
        let note = try #require(model.notes.first)
        try setWritable(root, false)
        defer { try? setWritable(root, true) }
        model.move(note.id, toFolder: "工作")
        try setWritable(root, true)
        #expect(model.lastError != nil)
        #expect(model.notes.first?.path == "甲.md")
        #expect(try root.read("甲.md") == "# 甲\n![](附件/a.png)")
    }

    @Test func restoringDropsTheTrashCollisionSuffix() throws {
        let (root, model) = try makeModel(["工作/周会.md": "# 周会\n工作", "生活/周会.md": "# 周会\n生活"])
        for note in model.notes { model.trash(note.id) }
        for note in model.notes { model.restore(note.id) }
        #expect(root.exists("工作/周会.md"))
        #expect(root.exists("生活/周会.md"))
        #expect(!root.exists("生活/周会 2.md") && !root.exists("工作/周会 2.md"))
    }

    @Test func staleTagFilterNewNoteAndSearchAll() throws {
        let (_, model) = try makeModel(["工作/a.md": "# 甲\n#会议", "工作/b.md": "# 乙"])
        model.scope = .folder("工作")
        model.tagFilter = "会议"
        // 唯一带 #会议 的笔记挪走了：筛选行没了，筛选也不能再起作用
        let a = try #require(model.notes.first { $0.title == "甲" })
        model.move(a.id, toFolder: "生活")
        #expect(model.visibleNotes.map(\.title) == ["乙"])
        // 有筛选时新建的笔记要能在列表里看到
        model.tagFilter = "会议"
        model.newNote()
        #expect(model.visibleNotes.contains { $0.id == model.selectedID })
        // 搜全部以后换一个范围，回到只搜这个范围
        model.query = "乙"
        model.searchAll = true
        model.scope = .all
        #expect(model.searchAll == false)
    }

    @Test func mostlyUTF8FileIsNotTurnedIntoGibberish() throws {
        let root = try TempDir.make()
        var data = Data("# 标题\n正常的中文内容，只有一个坏字节：".utf8)
        data.append(0xFF)
        data.append(contentsOf: Data("后面也是正常的中文。".utf8))
        try data.write(to: root.appendingPathComponent("坏.md"))
        let note = try #require(try NoteStore(root: root).load().notes.first)
        #expect(note.title == "标题")
        #expect(note.text.contains("后面也是正常的中文。"))
    }

    @Test func outsideEditWithTheSameTimestampIsStillNoticed() throws {
        let (root, model) = try makeModel(["甲.md": "# 甲\n短"])
        let file = root.appendingPathComponent("甲.md")
        let stamp = try #require(try FileManager.default.attributesOfItem(atPath: file.path)[.modificationDate] as? Date)
        try root.write("# 甲\n外面改得更长了", to: "甲.md")
        try FileManager.default.setAttributes([.modificationDate: stamp], ofItemAtPath: file.path)
        model.reload()
        #expect(model.notes.first?.text == "# 甲\n外面改得更长了")
    }
}
