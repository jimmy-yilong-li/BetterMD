import Foundation
import Testing
@testable import BetterMDCore

/// 绑定的登记跟着笔记走：改名、移动、进出废纸篓、文件夹改名（同步本身在 VS Code 插件里，见 vscode/test）。
@MainActor
struct LibraryLinksTests {
    func makeModel() throws -> (URL, AppModel) {
        let root = try TempDir.make()
        try root.write("# 规范\n正文", to: "工作/规范.md")
        try root.write("# 别的\n", to: "别的.md")
        // 和 VS Code 插件写的格式一样
        try root.write(#"{"links":[{"id":"L1","note":"工作/规范.md","file":"/Users/me/项目/CLAUDE.md"}]}"#, to: ".bettermd/links.json")
        let model = AppModel(root: root)
        model.saveDelay = .seconds(60)
        model.load()
        return (root, model)
    }

    func boundNote(_ root: URL) -> String? { LibraryLinks(root: root).all().first?.note }

    @Test func appKnowsWhichNoteIsBound() throws {
        let (_, model) = try makeModel()
        #expect(model.links["工作/规范.md"]?.file == "/Users/me/项目/CLAUDE.md")
        #expect(model.links["别的.md"] == nil)
    }

    @Test func movingRenamingAndTrashingCarryTheLink() throws {
        let (root, model) = try makeModel()
        let note = try #require(model.notes.first { $0.title == "规范" })
        model.move(note.id, toFolder: "生活")
        #expect(boundNote(root) == "生活/规范.md")
        #expect(model.links["生活/规范.md"] != nil)

        model.select(note.id)
        model.updateText("# 新规范\n正文", for: note.id)
        model.select(nil) // 离开时按标题改文件名
        #expect(boundNote(root) == "生活/新规范.md")

        model.trash(note.id)
        #expect(boundNote(root) == "废纸篓/新规范.md", "进了废纸篓：插件看到这个路径就暂停同步")
        model.restore(note.id)
        #expect(boundNote(root) == "生活/新规范.md")
    }

    @Test func renamingTheFolderCarriesTheLink() throws {
        let (root, model) = try makeModel()
        model.renameFolder("工作", to: "公司")
        #expect(boundNote(root) == "公司/规范.md")
        // 插件读得懂：路径里的 / 不转义
        #expect(try root.read(".bettermd/links.json").contains(#""note" : "公司/规范.md""#))
    }

    @Test func notesWithoutLinksDontTouchTheRegistry() throws {
        let (root, model) = try makeModel()
        let before = try root.read(".bettermd/links.json")
        let other = try #require(model.notes.first { $0.title == "别的" })
        model.move(other.id, toFolder: "工作")
        #expect(try root.read(".bettermd/links.json") == before)
    }
}
