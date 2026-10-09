import Foundation
import Observation
import Synchronization
import Testing
@testable import BetterMDCore

/// 菜单栏只看 selectionFlags：置顶、删除、换笔记时要变，打字时不能变（不然每打一个字菜单栏重建一次）。
@MainActor
struct SelectionFlagsTests {
    @Test func flagsFollowTheSelectionButNotTyping() throws {
        let root = try TempDir.make()
        try root.write("# 甲\n正文", to: "甲.md")
        let model = AppModel(root: root)
        model.saveDelay = .seconds(60)
        model.load()
        let note = try #require(model.notes.first)
        model.select(note.id)
        #expect(model.selectionFlags == .init(hasNote: true, isTrashed: false, isPinned: false))

        let changed = Mutex(false)
        withObservationTracking { _ = model.selectionFlags } onChange: { changed.withLock { $0 = true } }
        model.updateText("# 甲\n正文多了几个字", for: note.id)
        #expect(!changed.withLock { $0 }, "打字不应该让菜单栏重建")

        model.togglePin(note.id)
        #expect(changed.withLock { $0 })
        #expect(model.selectionFlags.isPinned)

        model.trash(note.id)
        model.scope = .trash
        model.select(note.id)
        #expect(model.selectionFlags.isTrashed && !model.selectionFlags.editable)

        model.select(nil)
        #expect(model.selectionFlags == .init())
    }
}
