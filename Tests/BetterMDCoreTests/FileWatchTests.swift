import Foundation
import Testing
@testable import BetterMDCore

/// 文件监听报来变化时：别的程序改的就重新读，App 自己写的不管。
@MainActor
struct FileWatchTests {
    func makeModel(_ files: [String: String]) throws -> (URL, AppModel) {
        let root = try TempDir.make()
        for (path, text) in files { try root.write(text, to: path) }
        let model = AppModel(root: root)
        model.saveDelay = .seconds(60)
        model.load()
        return (root, model)
    }

    func full(_ root: URL, _ path: String) -> String { root.appendingPathComponent(path).path }

    @Test func editsFromOtherProgramsShowUp() throws {
        let (root, model) = try makeModel(["工作/甲.md": "# 甲\n旧"])
        try root.write("# 甲\nVS Code 里改的", to: "工作/甲.md")
        #expect(model.filesChanged([full(root, "工作/甲.md")]))
        #expect(model.notes.first?.text == "# 甲\nVS Code 里改的")
    }

    @Test func ownSavesAreIgnored() throws {
        let (root, model) = try makeModel(["甲.md": "# 甲"])
        let note = try #require(model.notes.first)
        model.select(note.id)
        model.updateText("# 甲\n自己打的", for: note.id)
        model.flushPendingSave()
        #expect(!model.filesChanged([full(root, "甲.md")]), "App 自己刚存的，不用重读")
        // 自己改名（离开时按标题改文件名）以后，旧路径的变化也不算
        model.updateText("# 乙", for: note.id)
        model.select(nil)
        #expect(root.exists("乙.md"))
        #expect(!model.filesChanged([full(root, "甲.md"), full(root, "乙.md")]))
    }

    @Test func newDeletedFilesAndFoldersCount() throws {
        let (root, model) = try makeModel(["甲.md": "# 甲"])
        try root.write("# 新的", to: "项目/新的.md")
        #expect(model.filesChanged([full(root, "项目/新的.md")]))
        #expect(model.notes.contains { $0.title == "新的" })
        #expect(model.folders.contains("项目"))

        try FileManager.default.removeItem(at: root.appendingPathComponent("甲.md"))
        #expect(model.filesChanged([full(root, "甲.md")]))
        #expect(!model.notes.contains { $0.title == "甲" })
    }

    @Test func hiddenFilesAttachmentsAndOutsidePathsAreIgnored() throws {
        let (root, model) = try makeModel(["甲.md": "# 甲"])
        try root.write("{}", to: ".bettermd/state.json")
        try root.write("png", to: "附件/a.png")
        #expect(!model.filesChanged([full(root, ".bettermd/state.json"), full(root, "附件/a.png"), full(root, ".DS_Store")]))
        #expect(!model.filesChanged(["/tmp/别处/x.md"]))
    }
}
