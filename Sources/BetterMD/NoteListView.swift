import BetterMDCore
import SwiftUI

/// 中间的笔记列表，带搜索框和新建按钮。
struct NoteListView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        let notes = model.visibleNotes
        List(selection: selection) {
            ForEach(notes) { note in
                NoteRow(note: note,
                        location: LibraryIndex.locationLabel(for: note, in: model.scope),
                        query: model.query)
                    .tag(note.id)
                    .contextMenu { NoteMenu(note: note) }
            }
        }
        .overlay {
            if notes.isEmpty {
                if model.query.trimmingCharacters(in: .whitespaces).isEmpty {
                    ContentUnavailableView("这里还没有笔记", systemImage: "square.and.pencil",
                                           description: Text("按 ⌘N 新建一篇"))
                } else {
                    ContentUnavailableView.search(text: model.query)
                }
            }
        }
        .navigationTitle(title)
        .searchable(text: $model.query, placement: .toolbar, prompt: "搜索")
        .toolbar {
            ToolbarItem {
                Button { model.newNote() } label: {
                    Label("新建笔记", systemImage: "square.and.pencil")
                }
                .help("新建笔记（⌘N）")
            }
        }
    }

    private var selection: Binding<Note.ID?> {
        Binding(get: { model.selectedID }, set: { model.select($0) })
    }

    private var title: String {
        switch model.scope {
        case .all: "我的笔记"
        case .unfiled: "未分类"
        case .todo: "待办"
        case .trash: "废纸篓"
        case .folder(let path): path.split(separator: "/").last.map(String.init) ?? path
        case .tag(let tag): "#" + tag
        }
    }
}
