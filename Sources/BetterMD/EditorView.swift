import BetterMDCore
import SwiftUI

/// 第一阶段的编辑器：纯文本。第二阶段换成所见即所得的 Markdown 编辑器。
struct EditorView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if let note = model.selectedNote {
            TextEditor(text: text(for: note.id))
                .font(.system(size: 15))
                .lineSpacing(4)
                .scrollContentBackground(.hidden)
                .padding(.horizontal, 28)
                .padding(.top, 12)
                .disabled(note.isTrashed)
                .id(note.id)
                .navigationTitle(note.title)
                .navigationSubtitle(note.folder.isEmpty ? "未分类" : note.folder.replacingOccurrences(of: "/", with: " / "))
        } else {
            ContentUnavailableView("没有选中的笔记", systemImage: "note.text",
                                   description: Text("在左边选一篇，或者按 ⌘N 新建"))
        }
    }

    private func text(for id: Note.ID) -> Binding<String> {
        Binding(
            get: { model.notes.first { $0.id == id }?.text ?? "" },
            set: { model.updateText($0, for: id) }
        )
    }
}
