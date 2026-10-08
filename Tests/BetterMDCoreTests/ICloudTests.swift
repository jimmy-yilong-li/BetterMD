import Foundation
import Synchronization
import Testing
@testable import BetterMDCore

/// 笔记库放进 iCloud 云盘：第一次启动时搬家、只在云上的笔记、同步状态。
@MainActor
struct ICloudTests {
    // MARK: - 搬家

    @Test func movesTheWholeLibraryIncludingHiddenState() throws {
        let home = try TempDir.make()
        let old = home.appendingPathComponent("我的笔记")
        try old.write("# 甲\n![图](../附件/a.png)", to: "工作/甲.md")
        try old.write("png", to: "附件/a.png")
        try old.write("{\"pinned\":[\"工作/甲.md\"]}", to: ".bettermd/state.json")
        let new = home.appendingPathComponent("Mobile Documents/com~apple~CloudDocs/我的笔记")

        #expect(LibraryMove.run(from: old, to: new) == .moved)
        #expect(!FileManager.default.fileExists(atPath: old.path))
        #expect(try new.read("工作/甲.md") == "# 甲\n![图](../附件/a.png)")
        #expect(new.exists("附件/a.png"))
        #expect(try new.read(".bettermd/state.json").contains("工作/甲.md"))
    }

    @Test func leavesBothAloneWhenTheTargetAlreadyExists() throws {
        let home = try TempDir.make()
        let old = home.appendingPathComponent("旧")
        let new = home.appendingPathComponent("新")
        try old.write("# 甲", to: "甲.md")
        try old.write("# 乙", to: "废纸篓/乙.md")
        try new.write("# 丙", to: "丙.md")

        #expect(LibraryMove.run(from: old, to: new) == .bothExist(leftoverNotes: 2))
        #expect(old.exists("甲.md"))
        #expect(new.exists("丙.md"))
        #expect(!new.exists("甲.md"))
    }

    @Test func nothingToMoveWithoutAnOldLibrary() throws {
        let home = try TempDir.make()
        #expect(LibraryMove.run(from: home.appendingPathComponent("没有"), to: home.appendingPathComponent("新")) == .nothingToMove)
        #expect(!home.exists("新"))
    }

    @Test func failedMoveKeepsTheOldLibrary() throws {
        let home = try TempDir.make()
        let old = home.appendingPathComponent("旧")
        try old.write("# 甲", to: "甲.md")
        let locked = home.appendingPathComponent("锁住的")
        try FileManager.default.createDirectory(at: locked, withIntermediateDirectories: true)
        try FileManager.default.setAttributes([.posixPermissions: 0o555], ofItemAtPath: locked.path)
        defer { try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: locked.path) }

        guard case .failed = LibraryMove.run(from: old, to: locked.appendingPathComponent("我的笔记")) else {
            Issue.record("搬进不能写的目录应该失败")
            return
        }
        #expect(try old.read("甲.md") == "# 甲")
    }

    // MARK: - 只在云上的笔记

    /// 假装哪些笔记只在 iCloud 上（真的“空壳文件”只有 iCloud 能造出来）。
    final class CloudOnly: Sendable {
        let names = Mutex<Set<String>>([])
        func set(_ names: Set<String>) { self.names.withLock { $0 = names } }
        func contains(_ url: URL) -> Bool { names.withLock { $0.contains(url.lastPathComponent) } }
    }

    func store(_ root: URL, cloudOnly: CloudOnly) -> NoteStore {
        var store = NoteStore(root: root)
        store.downloadIfCloudOnly = { cloudOnly.contains($0) }
        return store
    }

    @Test func cloudOnlyNotesAreSkippedAndCounted() throws {
        let root = try TempDir.make()
        try root.write("# 甲", to: "甲.md")
        try root.write("# 乙", to: "工作/乙.md")
        let cloud = CloudOnly()
        cloud.set(["乙.md"])

        let snapshot = try store(root, cloudOnly: cloud).load()
        #expect(snapshot.notes.map(\.title) == ["甲"])
        #expect(snapshot.downloading == 1)
        #expect(snapshot.folders == ["工作"])
    }

    @Test func libraryStillDownloadingGetsNoWelcomeNote() throws {
        let root = try TempDir.make()
        try root.write("# 甲", to: "甲.md")
        let cloud = CloudOnly()
        cloud.set(["甲.md"])
        let model = AppModel(store: store(root, cloudOnly: cloud))
        model.load()
        #expect(model.notes.isEmpty)
        #expect(!root.exists("欢迎使用 BetterMD.md"))
        #expect(model.state.welcomed == false)
    }

    @Test func downloadedNotesShowUpWithoutLeavingTheApp() async throws {
        let root = try TempDir.make()
        try root.write("# 甲", to: "甲.md")
        try root.write("# 乙", to: "乙.md")
        let cloud = CloudOnly()
        cloud.set(["乙.md"])
        let model = AppModel(store: store(root, cloudOnly: cloud))
        model.downloadWait = .milliseconds(20)
        model.load()
        #expect(model.notes.map(\.title) == ["甲"])

        cloud.set([]) // iCloud 下载好了
        for _ in 0..<100 where model.notes.count < 2 {
            try await Task.sleep(for: .milliseconds(20))
        }
        #expect(Set(model.notes.map(\.title)) == ["甲", "乙"])
        #expect(model.downloadWait == .seconds(1), "都下好以后等待时间回到起点")
    }

    @Test func ordinaryFilesAreReadDirectly() throws {
        let root = try TempDir.make()
        try root.write("# 甲", to: "甲.md")
        #expect(!NoteStore.isDataless(root.appendingPathComponent("甲.md")))
        #expect(!NoteStore.isDataless(root.appendingPathComponent("不存在.md")))
        #expect(!NoteStore.requestDownloadIfDataless(root.appendingPathComponent("甲.md")))
        let snapshot = try NoteStore(root: root).load()
        #expect(snapshot.notes.map(\.title) == ["甲"])
        #expect(snapshot.downloading == 0)
    }

    // MARK: - 同步状态

    @Test func filesOutsideICloudAreLocal() throws {
        let root = try TempDir.make()
        try root.write("# 甲", to: "甲.md")
        #expect(CloudStatus.of(root.appendingPathComponent("甲.md")) == .local)
        #expect(CloudStatus.of(root.appendingPathComponent("不存在.md")) == .local)
    }
}
