import BetterMDCore
import SwiftUI

/// 笔记的右键菜单。
struct NoteMenu: View {
    @Environment(AppModel.self) private var model
    let note: Note

    var body: some View {
        if note.isTrashed {
            Button("放回原处") { model.restore(note.id) }
        } else {
            Button(note.isPinned ? "取消置顶" : "置顶") { model.togglePin(note.id) }
            Menu("移动到") {
                Button("未分类") { model.move(note.id, toFolder: "") }
                ForEach(model.folders, id: \.self) { folder in
                    Button(folder.replacingOccurrences(of: "/", with: " / ")) {
                        model.move(note.id, toFolder: folder)
                    }
                }
            }
            Divider()
            Button("移到废纸篓", role: .destructive) { model.trash(note.id) }
        }
    }
}
