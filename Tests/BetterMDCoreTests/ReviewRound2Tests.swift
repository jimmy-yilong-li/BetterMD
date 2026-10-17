import Foundation
import Testing
@testable import BetterMDCore

/// 合作者审查（2026-10-17）找到的问题，每条一个复现。
@MainActor
struct ReviewRound2Tests {
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

    // 1. 保存失败后切换笔记库，没存下的内容不能丢
    @Test func switchingLibraryWaitsUntilEverythingIsSaved() throws {
        let (root, model) = try makeModel(["工作/甲.md": "# 甲\n旧"])
        let note = try #require(model.notes.first)
        model.select(note.id)
        let folder = root.appendingPathComponent("工作")
        try setWritable(folder, false)
        defer { try? setWritable(folder, true) }
        model.updateText("# 甲\n新内容", for: note.id)
        let other = try TempDir.make()
        #expect(model.switchLibrary(to: other) == false)
        #expect(model.store.root == root, "存不下去就不换库")
        #expect(model.notes.first?.text == "# 甲\n新内容")
        #expect(model.lastError != nil)
        // 权限恢复以后能存下去，也能换库了
        try setWritable(folder, true)
        #expect(model.switchLibrary(to: other))
        #expect(try root.read("工作/甲.md") == "# 甲\n新内容")
    }

    // 退出时存不下去的笔记另存一份，不跟着 App 一起消失
    @Test func unsavedNotesAreRescuedOnQuit() throws {
        let (root, model) = try makeModel(["工作/甲.md": "# 甲\n旧"])
        let note = try #require(model.notes.first)
        model.select(note.id)
        let folder = root.appendingPathComponent("工作")
        try setWritable(folder, false)
        defer { try? setWritable(folder, true) }
        model.updateText("# 甲\n退出前打的", for: note.id)
        model.finishAll()
        let rescue = try TempDir.make().appendingPathComponent("没存下的笔记")
        let saved = model.rescueUnsaved(into: rescue)
        #expect(saved.count == 1)
        #expect(try saved.first.map { try String(contentsOf: $0, encoding: .utf8) } == "# 甲\n退出前打的")
        // 都存下了就什么都不留
        try setWritable(folder, true)
        model.flushPendingSave()
        #expect(model.rescueUnsaved(into: rescue).isEmpty)
    }

    // 3. 移动失败时，原文件不能被改成按新位置写的链接
    @Test func failedMoveLeavesTheFileUntouched() throws {
        // 从“工作/客户”挪到“生活”，链接要从 ../../附件 改成 ../附件
        let original = "# 甲\n![图](../../附件/a.png)"
        let (root, model) = try makeModel(["工作/客户/甲.md": original, "生活/乙.md": "# 乙"])
        let note = try #require(model.notes.first { $0.title == "甲" })
        let target = root.appendingPathComponent("生活")
        try setWritable(target, false)
        defer { try? setWritable(target, true) }
        model.move(note.id, toFolder: "生活")
        #expect(model.lastError?.contains("移动失败") == true)
        #expect(try root.read("工作/客户/甲.md") == original, "磁盘上的正文要回到原样")
        #expect(model.notes.first { $0.id == note.id }?.text == original)
        #expect(model.notes.first { $0.id == note.id }?.path == "工作/客户/甲.md")
    }

    // 4. 有没存的改动时，外面的程序改了同一个文件：两边的内容都不能悄悄丢掉
    @Test func outsideEditIsKeptWhenAppAlsoHasUnsavedChanges() throws {
        let (root, model) = try makeModel(["甲.md": "# 甲\n原来"])
        let note = try #require(model.notes.first)
        model.select(note.id)
        model.updateText("# 甲\nApp 里改的", for: note.id)
        // 时间要和上次读到的不一样
        try root.write("# 甲\n外面改的", to: "甲.md")
        try FileManager.default.setAttributes([.modificationDate: Date().addingTimeInterval(5)],
                                              ofItemAtPath: root.appendingPathComponent("甲.md").path)
        model.reload()
        let texts = try FileManager.default.contentsOfDirectory(atPath: root.path)
            .filter { $0.hasSuffix(".md") }
            .map { try root.read($0) }
        #expect(texts.contains("# 甲\nApp 里改的"))
        #expect(texts.contains("# 甲\n外面改的"), "外面的版本要留着（另存一份）")
        #expect(model.lastError?.contains("别处") == true, "要告诉用户")
    }

    // 5. 移动笔记改写链接：缩进的代码、转义的方括号不动；尖括号里的 %23 不能变成 #
    @Test func rebaseLeavesCodeAndEscapesAlone() {
        let indented = "说明：\n\n    ![](a.png)\n    [x](b.md)\n\n正文 ![](c.png)"
        #expect(MarkdownLinks.rebase(indented, from: "", to: "工作")
                == "说明：\n\n    ![](a.png)\n    [x](b.md)\n\n正文 ![](../c.png)")
        // 列表项里缩进的续行不是代码，照常改
        #expect(MarkdownLinks.rebase("- 一项\n\n    ![](a.png)", from: "", to: "工作") == "- 一项\n\n    ![](../a.png)")
        #expect(MarkdownLinks.rebase("\\[不是链接](a.png) 和 [x\\](b.png)", from: "", to: "工作") == "\\[不是链接](a.png) 和 [x\\](b.png)")
        #expect(MarkdownLinks.rebase("![](<附件/a%23b 1.png>)", from: "", to: "工作") == "![](<../附件/a%23b 1.png>)")
    }

    // 其他：短的 GB18030 文件不能被当成 UTF-8 读成乱码
    @Test func shortGB18030FilesAreDecoded() throws {
        let root = try TempDir.make()
        let gb = String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(CFStringEncoding(CFStringEncodings.GB_18030_2000.rawValue)))
        for text in ["中文", "# 笔记", "# 标题\n内容"] {
            let file = root.appendingPathComponent("gb.md")
            try #require(text.data(using: gb)).write(to: file)
            #expect(NoteStore(root: root).readText(file) == text)
        }
        // 只坏了一个字节的 UTF-8 长文件还是按 UTF-8 读
        var data = Data(String(repeating: "中文内容", count: 50).utf8)
        data[10] = 0xFF
        try data.write(to: root.appendingPathComponent("bad.md"))
        #expect(NoteStore(root: root).readText(root.appendingPathComponent("bad.md"))?.hasPrefix("中文内") == true)
    }

    // 其他：笔记库里的符号链接不能把编辑器带到库外面去
    @Test func symlinksCannotLeaveTheLibrary() throws {
        let root = try TempDir.make()
        let outside = try TempDir.make()
        try outside.write("secret", to: "secret.txt")
        try root.write("png", to: "附件/ok.png")
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("附件/link.png"),
                                                   withDestinationURL: outside.appendingPathComponent("secret.txt"))
        let store = NoteStore(root: root)
        #expect(store.resolveFile("附件/ok.png") != nil)
        #expect(store.resolveFile("附件/link.png") == nil)
        #expect(store.resolveFile("别处/link.png") == nil, "按文件名到「附件」里找回的那条路也不行")
    }
}
