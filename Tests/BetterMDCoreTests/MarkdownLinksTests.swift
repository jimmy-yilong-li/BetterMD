import Foundation
import Testing
@testable import BetterMDCore

struct MarkdownLinksTests {
    @Test func linkFromAFolder() {
        #expect(MarkdownLinks.link(from: "", to: "附件/a.png") == "附件/a.png")
        #expect(MarkdownLinks.link(from: "工作", to: "附件/a.png") == "../附件/a.png")
        #expect(MarkdownLinks.link(from: "工作/客户", to: "附件/a.png") == "../../附件/a.png")
        #expect(MarkdownLinks.link(from: "工作", to: "工作/图/a.png") == "图/a.png")
        #expect(MarkdownLinks.link(from: "", to: "附件/报告 (终稿).pdf") == "附件/报告%20%28终稿%29.pdf")
    }

    @Test func rebaseWhenMovingIntoAFolder() {
        let text = "# 笔记\n![](附件/a.png)\n看 [报告](附件/r.pdf \"标题\") 和 ![图](<附件/a b.png>)"
        let moved = MarkdownLinks.rebase(text, from: "", to: "工作/客户")
        #expect(moved == "# 笔记\n![](../../附件/a.png)\n看 [报告](../../附件/r.pdf \"标题\") 和 ![图](<../../附件/a b.png>)")
        #expect(MarkdownLinks.rebase(moved, from: "工作/客户", to: "") == text)
    }

    @Test func rebaseBetweenSiblingFolders() {
        let text = "![](../附件/a.png) [同事](./名单.md) [上级](../读书/b.md#第二章)"
        #expect(MarkdownLinks.rebase(text, from: "工作", to: "生活/旅行")
            == "![](../../附件/a.png) [同事](../../工作/名单.md) [上级](../../读书/b.md#第二章)")
    }

    @Test func leavesOtherLinksAlone() {
        let text = """
        [网站](https://example.com/a b) [邮件](mailto:a@b.c) [锚点](#标题) [根](/x.png) [跳出](../../x.png)
        ```
        ![](附件/代码块里的.png)
        ```
        `![](附件/行内代码.png)` 也不是真的链接，但改了也无妨
        """
        let moved = MarkdownLinks.rebase(text, from: "工作", to: "")
        let lines = moved.split(separator: "\n", omittingEmptySubsequences: false)
        #expect(lines[0] == "[网站](https://example.com/a b) [邮件](mailto:a@b.c) [锚点](#标题) [根](/x.png) [跳出](../../x.png)")
        #expect(lines[2] == "![](附件/代码块里的.png)")
    }

    @Test func keepsPercentEncodingValid() {
        let text = "![](附件/my%20pic.png) ![](附件/100%.png)"
        #expect(MarkdownLinks.rebase(text, from: "", to: "工作") == "![](../附件/my%20pic.png) ![](../附件/100%25.png)")
    }
}

struct AttachmentTests {
    func makeStore() throws -> (URL, NoteStore) {
        let root = try TempDir.make()
        let store = NoteStore(root: root)
        try store.prepare()
        return (root, store)
    }

    let moment = Date(timeIntervalSince1970: 1_791_350_400) // 某一刻；只用来生成文件名

    @Test func imagesAreNamedByTime() throws {
        let (root, store) = try makeStore()
        let first = try store.saveAttachment(Data([1, 2, 3]), fileName: "截屏 2026-10-07.PNG", now: moment)
        let second = try store.saveAttachment(Data([4]), fileName: "image.png", now: moment)
        let stamp = NoteStore.timestamp(moment)
        #expect(first == "附件/\(stamp).png")
        #expect(second == "附件/\(stamp)-2.png")
        #expect(try Data(contentsOf: root.appendingPathComponent(first)) == Data([1, 2, 3]))
    }

    @Test func pastedImageWithoutExtensionUsesItsType() throws {
        let (_, store) = try makeStore()
        let path = try store.saveAttachment(Data([1]), fileName: "", mimeType: "image/jpeg", now: moment)
        #expect(path == "附件/\(NoteStore.timestamp(moment)).jpeg")
    }

    @Test func otherFilesKeepTheirNames() throws {
        let (_, store) = try makeStore()
        #expect(try store.saveAttachment(Data([1]), fileName: "报告.pdf") == "附件/报告.pdf")
        #expect(try store.saveAttachment(Data([2]), fileName: "报告.pdf") == "附件/报告-2.pdf")
        #expect(try store.saveAttachment(Data([3]), fileName: "a/b:c.zip") == "附件/a／b：c.zip")
    }

    @Test func resolveFileStaysInsideTheLibrary() throws {
        let (root, store) = try makeStore()
        try root.write("x", to: "附件/a.png")
        try root.write("y", to: "读书/图.png")
        #expect(store.resolveFile("附件/a.png")?.lastPathComponent == "a.png")
        #expect(store.resolveFile("读书/图.png")?.path.hasSuffix("读书/图.png") == true)
        // 笔记在 Finder 里被挪过，相对路径失效了：按文件名去「附件」里找
        #expect(store.resolveFile("工作/附件/a.png")?.path.hasSuffix("附件/a.png") == true)
        #expect(store.resolveFile("../a.png") == nil)
        #expect(store.resolveFile("附件") == nil)
        #expect(store.resolveFile("没有/这个.png") == nil)
    }

    @Test func movingANoteRewritesItsImageLinks() throws {
        let (root, store) = try makeStore()
        let note = try store.createNote(text: "# 图\n![](附件/a.png)", inFolder: "")
        let moved = try store.move(note, toFolder: "工作")
        #expect(moved.text == "# 图\n![](../附件/a.png)")
        #expect(try root.read("工作/图.md") == "# 图\n![](../附件/a.png)")
        // 进废纸篓不改正文，链接仍按原来的文件夹算；放回去也不用改
        let trashed = try store.trash(moved)
        #expect(trashed.text == moved.text)
        #expect(trashed.folder == "工作")
        let restored = try store.restore(trashed)
        #expect(restored.path == "工作/图.md")
        #expect(try root.read("工作/图.md") == "# 图\n![](../附件/a.png)")
    }
}
