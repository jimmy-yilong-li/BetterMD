import Foundation
import Testing
@testable import BetterMDCore

/// 数据层审查（2026-10-17）的复现。每个测试在当前代码上都应当失败。
@MainActor
struct ReviewDataTests {
    func makeModel(_ files: [String: String]) throws -> (URL, AppModel) {
        let root = try TempDir.make()
        for (path, text) in files { try root.write(text, to: path) }
        let model = AppModel(root: root)
        model.saveDelay = .seconds(60)
        model.load()
        return (root, model)
    }

    /// 只改修改时间（往后挪几秒），模拟别的程序写过这个文件。
    func bump(_ root: URL, _ path: String, by seconds: TimeInterval = 5) throws {
        try FileManager.default.setAttributes([.modificationDate: Date().addingTimeInterval(seconds)],
                                              ofItemAtPath: root.appendingPathComponent(path).path)
    }

    /// 库里所有 .md 的内容（含子文件夹）。
    func allTexts(_ root: URL) throws -> [String] {
        let files = FileManager.default.enumerator(atPath: root.path)?.allObjects as? [String] ?? []
        return try files.filter { $0.hasSuffix(".md") && !$0.hasPrefix(".") }.map { try root.read($0) }
    }

    // MARK: - 冲突检测

    // A. 外面改了正在看的笔记 → 监听到、重读；编辑器里还有没发出的字（输入法在拼字、或改动还在路上），
    //    按设计编辑器保留自己的正文并重发。重发的正文是基于旧内容的，存下去就把外面的版本盖掉了，也没有另存。
    @Test func editorResendAfterOutsideReloadLosesOutsideVersion() throws {
        let (root, model) = try makeModel(["甲.md": "# 甲\n原来"])
        let note = try #require(model.notes.first)
        model.select(note.id)
        try root.write("# 甲\n外面改的", to: "甲.md")
        try bump(root, "甲.md")
        #expect(model.filesChanged([root.appendingPathComponent("甲.md").path]))
        #expect(model.notes.first?.text == "# 甲\n外面改的")
        // 编辑器拼完字，以编辑器为准重发（main.js updateDocument 的 stale 分支）
        // 编辑器按“过时”的分支重发：消息里带着 overrode（见 editor/src/main.js updateDocument）
        model.updateText("# 甲\n原来，加上刚拼的字", for: note.id, overrodeApp: true)
        model.flushPendingSave()
        let texts = try allTexts(root)
        #expect(texts.contains("# 甲\n原来，加上刚拼的字"))
        #expect(texts.contains("# 甲\n外面改的"), "外面的版本被悄悄盖掉了，没有另存")
    }

    // B. 外面刚改完（监听还没报上来，0.3 秒延迟内）就移动这篇：move 用内存里的旧正文改链接、写到新位置，外面的改动没了。
    @Test func moveRightAfterOutsideEditOverwritesIt() throws {
        let (root, model) = try makeModel(["工作/甲.md": "# 甲\n![](../附件/a.png)"])
        let note = try #require(model.notes.first)
        try root.write("# 甲\n![](../附件/a.png)\n外面加的一段", to: "工作/甲.md")
        try bump(root, "工作/甲.md")
        model.move(note.id, toFolder: "生活/日记")
        let texts = try allTexts(root)
        #expect(texts.contains { $0.contains("外面加的一段") }, "外面加的一段丢了")
    }

    // C. 别处只碰了修改时间、内容没变（touch、同步工具重写同样的内容）：这时 App 正好有没存的字，
    //    保存时把磁盘上的内容和“App 里的新正文”比，当然不一样，于是另存了一份“别处的版本”——其实别处什么也没改。
    @Test func touchedButUnchangedFileIsAFalseConflict() throws {
        let (root, model) = try makeModel(["甲.md": "# 甲\n原来"])
        let note = try #require(model.notes.first)
        model.select(note.id)
        model.updateText("# 甲\n原来，App 里加的", for: note.id)
        try bump(root, "甲.md")
        model.flushPendingSave()
        #expect(try allTexts(root).count == 1, "不该有“别处的版本”")
        #expect(model.lastError == nil)
    }

    // D. 同一秒里的外部修改（exFAT、网络盘的时间只精确到秒；或工具保留了修改时间）：
    //    load 用“时间 + 大小”认得出来，保存前的比对只看时间，认不出来，外面的版本被盖掉。
    @Test func outsideEditWithSameTimestampIsOverwrittenOnSave() throws {
        // 秒级精度的文件系统：修改时间都是整秒
        let root = try TempDir.make()
        try root.write("# 甲\n短", to: "甲.md")
        let file = root.appendingPathComponent("甲.md")
        let stamp = Date(timeIntervalSince1970: floor(Date().timeIntervalSince1970) - 100)
        try FileManager.default.setAttributes([.modificationDate: stamp], ofItemAtPath: file.path)
        let model = AppModel(root: root)
        model.saveDelay = .seconds(60)
        model.load()
        let note = try #require(model.notes.first)
        model.select(note.id)
        model.updateText("# 甲\nApp 里改的", for: note.id)
        try root.write("# 甲\n外面改得更长了", to: "甲.md")
        try FileManager.default.setAttributes([.modificationDate: stamp], ofItemAtPath: file.path)
        model.flushPendingSave()
        #expect(try allTexts(root).contains("# 甲\n外面改得更长了"), "外面的版本被盖掉了")
    }

    // E. 另存“别处的版本”成功、但正文写不进去（文件被别的程序设成只读，比如 Perforce）：
    //    diskModified 没更新，之后每次重试都再另存一份，越存越多。
    @Test func failedWriteAfterConflictCopyKeepsMakingCopies() throws {
        let (root, model) = try makeModel(["甲.md": "# 甲\n原来"])
        let note = try #require(model.notes.first)
        model.select(note.id)
        model.updateText("# 甲\nApp 里改的", for: note.id)
        let file = root.appendingPathComponent("甲.md")
        try root.write("# 甲\n外面改的", to: "甲.md")
        try bump(root, "甲.md")
        try FileManager.default.setAttributes([.posixPermissions: 0o444], ofItemAtPath: file.path)
        defer { try? FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: file.path) }
        model.flushPendingSave()
        model.flushPendingSave()
        model.flushPendingSave()
        let copies = try FileManager.default.contentsOfDirectory(atPath: root.path).filter { $0.contains("别处的版本") }
        #expect(copies.count == 1, "同一个外部版本另存了 \(copies.count) 份：\(copies)")
    }

    // O. 保存失败（文件是只读的）时移进废纸篓：change() 把 diskModified 设成 after.modified，
    //    而这时 modified 还是打字时的 .now，不是磁盘上的时间。之后能存了，保存前比对就把自己的旧版本当成“别处的版本”另存。
    @Test func failedSaveThenTrashMakesAFalseConflictCopy() throws {
        let (root, model) = try makeModel(["甲.md": "# 甲\n原来", "乙.md": "# 乙"])
        let note = try #require(model.notes.first { $0.title == "甲" })
        let file = root.appendingPathComponent("甲.md")
        try FileManager.default.setAttributes([.posixPermissions: 0o444], ofItemAtPath: file.path)
        model.select(note.id)
        model.updateText("# 甲\nApp 里改的", for: note.id)
        model.flushPendingSave()
        #expect(model.lastError?.contains("保存失败") == true)
        model.trash(note.id) // 挪文件不需要文件本身可写
        let trashed = root.appendingPathComponent("废纸篓/甲.md")
        try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: trashed.path)
        model.lastError = nil
        model.flushPendingSave()
        #expect(try root.read("废纸篓/甲.md") == "# 甲\nApp 里改的")
        let copies = try FileManager.default.contentsOfDirectory(atPath: root.appendingPathComponent("废纸篓").path)
            .filter { $0.contains("别处的版本") }
        #expect(copies.isEmpty, "别处什么也没改，却另存了 \(copies)")
    }

    // P. 换笔记库以后范围还停在旧库的文件夹上：列表是空的，⌘N 会在新库里建出旧库的文件夹。
    @Test func switchingLibraryKeepsAStaleFolderScope() throws {
        let (_, model) = try makeModel(["工作/甲.md": "# 甲"])
        model.scope = .folder("工作")
        let other = try TempDir.make()
        try other.write("# 乙", to: "乙.md")
        #expect(model.switchLibrary(to: other))
        model.newNote()
        #expect(!other.exists("工作"), "新库里多出一个旧库的文件夹")
    }

    // MARK: - 状态文件

    // F. state.json 暂时读不出来（iCloud 还在下载、权限问题）：loadState 悄悄当成空的，
    //    下一次置顶、移动就把空状态写回去，废纸篓的来源、置顶全丢了。
    @Test func unreadableStateGetsOverwritten() throws {
        let (root, model) = try makeModel([:])
        _ = model
        try root.write("# 甲", to: "甲.md")
        try root.write("# 乙", to: "废纸篓/乙.md")
        try root.write(#"{"pinned":[],"trashOrigins":{"废纸篓/乙.md":"工作/客户"},"welcomed":true}"#, to: ".bettermd/state.json")
        let stateFile = root.appendingPathComponent(".bettermd/state.json")
        try FileManager.default.setAttributes([.posixPermissions: 0o000], ofItemAtPath: stateFile.path)
        let fresh = AppModel(root: root)
        fresh.load()
        try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: stateFile.path)
        let a = try #require(fresh.notes.first { $0.title == "甲" })
        fresh.togglePin(a.id)
        #expect(NoteStore(root: root).loadState().trashOrigins["废纸篓/乙.md"] == "工作/客户", "废纸篓的来源被空状态盖掉了")
    }

    // MARK: - 读取

    // G. 子文件夹里的笔记是符号链接：relativePath 把链接本身也解开了，路径变成库外的文件名，
    //    笔记显示在「未分类」里，改了以后写进根目录一个新文件，链接指的那篇一直没改。
    // 定下的规则：符号链接的 .md 不当笔记（指到库外的会改到别处的文件，指到库里的会出现两遍）
    @Test func symlinkedNoteGetsWrongPath() throws {
        let root = try TempDir.make()
        let outside = try TempDir.make()
        try outside.write("# 外面", to: "x.md")
        try root.write("# 甲", to: "工作/甲.md")
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("工作/链接.md"),
                                                   withDestinationURL: outside.appendingPathComponent("x.md"))
        let snapshot = try NoteStore(root: root).load()
        #expect(!snapshot.notes.contains { $0.title == "外面" })
        #expect(snapshot.notes.map(\.path) == ["工作/甲.md"])
    }

    @Test func symlinkInsideLibraryDuplicatesPath() throws {
        let root = try TempDir.make()
        try root.write("# 真", to: "生活/真.md")
        try FileManager.default.createDirectory(at: root.appendingPathComponent("工作"), withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("工作/别名.md"),
                                                   withDestinationURL: root.appendingPathComponent("生活/真.md"))
        let paths = try NoteStore(root: root).load().notes.map(\.path)
        #expect(Set(paths).count == paths.count, "重复的路径：\(paths)")
    }

    // H. 沿用旧笔记的条件是“文件大小 == 正文 UTF-8 字节数”。CRLF、GB18030、带 BOM 的文件永远对不上，
    //    每次回到 App 都重读；被 iCloud 清成空壳以后（时间、大小都没变）就当成“正在下载”跳过，从列表里消失。
    @Test func evictedCRLFNoteVanishesFromTheList() throws {
        let root = try TempDir.make()
        try root.write("# 甲\r\n正文\r\n", to: "甲.md")
        let cloud = ICloudTests.CloudOnly()
        var store = NoteStore(root: root)
        store.downloadIfCloudOnly = { cloud.contains($0) }
        let model = AppModel(store: store)
        model.load()
        let note = try #require(model.notes.first)
        model.select(note.id)
        cloud.set(["甲.md"]) // iCloud 把它清成了空壳
        model.reload()
        #expect(model.notes.count == 1, "没变过的笔记从列表里消失了")
        #expect(model.selectedID == note.id)
    }

    // I. FSEvents 报的是真实路径。用户选的笔记库路径里有符号链接（比如 ~/Notes → 外接盘上的目录）时，
    //    所有变化都被当成“库外面的”忽略。（/private/var 这种 standardizedFileURL 会自己去掉，不受影响）
    @Test func watcherIgnoresRealPathsWhenRootIsASymlink() throws {
        let real = try TempDir.make()
        try real.write("# 甲\n旧", to: "甲.md")
        let link = try TempDir.make().appendingPathComponent("笔记库")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: real)
        let model = AppModel(root: link)
        model.load()
        try real.write("# 甲\nVS Code 里改的", to: "甲.md")
        try bump(real, "甲.md")
        let reported = try #require(realpath(real.appendingPathComponent("甲.md").path, nil).map { String(cString: $0) })
        #expect(model.filesChanged([reported]), "外部修改没被认出来")
    }

    // MARK: - 解析

    // J. 标签：列表项、段落的缩进续行不是代码（编辑器按 CommonMark 照样画成标签，⌘ 点进去是空列表），
    //    NoteText.tags 用的是不看上下文的 isIndentedCode，把它们当成代码跳过了。
    @Test func tagsInIndentedContinuationLinesAreMissed() {
        #expect(NoteText.tags(in: "# 甲\n1. 步骤\n    说明 #重要") == ["重要"])
        #expect(NoteText.tags(in: "# 甲\n第一行\n    第二行 #续行") == ["续行"])
        #expect(NoteText.tags(in: "# 甲\n- 项目\n\n    续段 #列表里") == ["列表里"])
        // 真正的缩进代码还是不算
        #expect(NoteText.tags(in: "# 甲\n\n    #include <stdio.h>").isEmpty)
    }

    // K. 待办：编辑器把有序列表、引用里的 [ ] 都画成复选框，「待办」里却没有这篇。
    @Test func orderedAndQuotedTodosAreMissed() {
        #expect(NoteText.hasOpenTodo("# 甲\n1. [ ] 打电话"))
        #expect(NoteText.hasOpenTodo("# 甲\n> - [ ] 引用里的待办"))
    }

    // L. 改了标题马上移进废纸篓：离开时 renameToMatchTitle 看到在废纸篓就不改名，放回原处后文件名还是旧标题。
    @Test func retitledThenTrashedKeepsOldFileName() throws {
        let (root, model) = try makeModel(["甲.md": "# 甲", "乙.md": "# 乙"])
        let a = try #require(model.notes.first { $0.title == "甲" })
        model.select(a.id)
        model.updateText("# 甲改了", for: a.id)
        model.trash(a.id)
        model.restore(a.id)
        #expect(root.exists("甲改了.md"), "文件名没跟着标题走")
    }

    // M. 围栏代码块一结束紧跟缩进 4 格的代码（CommonMark 里是代码），移动时里面的链接被改了。
    @Test func rebaseTouchesIndentedCodeRightAfterAFence() {
        let text = "# 甲\n```\nx\n```\n    ![](a.png)"
        #expect(MarkdownLinks.rebase(text, from: "", to: "工作") == text)
        let afterHeading = "# 甲\n    ![](a.png)"
        #expect(MarkdownLinks.rebase(afterHeading, from: "", to: "工作") == afterHeading)
    }

    // N. 列表缩略图：图片地址里带一层括号（MarkdownLinks 认得出），firstImage 的正则在第一个 ) 截断。
    @Test func firstImageWithParentheses() {
        #expect(NoteText.firstImage(in: "# 甲\n![](附件/图(1).png)") == "附件/图(1).png")
    }
}

/// 自己补的：很长的标题（全是 emoji）建得出文件；另存别处的版本时后缀不会被截掉。
@MainActor
struct LongTitleTests {
    @Test func longEmojiTitlesStillMakeFiles() throws {
        let root = try TempDir.make()
        let store = NoteStore(root: root)
        let title = String(repeating: "😀", count: 80)
        let note = try store.createNote(text: "# \(title)\n", inFolder: "")
        #expect(FileManager.default.fileExists(atPath: store.url(for: note.path).path))
        let copy = try store.saveCopy("别处的", besides: note, suffix: "别处的版本")
        #expect(copy.hasSuffix("（别处的版本）.md"))
    }
}
