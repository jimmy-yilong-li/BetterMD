import AppKit
import BetterMDCore
import SwiftUI
import UniformTypeIdentifiers

/// 编辑区：所见即所得的 Markdown 编辑器。整个窗口只有一个编辑器实例，切换笔记时换内容。
struct EditorView: View {
    @Environment(AppModel.self) private var model
    @State private var handle = EditorHandle()

    var body: some View {
        let note = model.selectedNote
        MarkdownEditor(model: model, note: note, selectTitle: note != nil && note?.id == model.freshNoteID, handle: handle)
            .background(Paper.color)
            .overlay {
                if note == nil {
                    ContentUnavailableView("没有选中的笔记", systemImage: "note.text",
                                           description: Text("在左边选一篇，或者按 ⌘N 新建"))
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Paper.color)
                }
            }
            .navigationTitle(note?.title ?? "BetterMD")
            .navigationSubtitle(note.map(location) ?? "")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button(action: chooseFiles) {
                        Label("插入图片", systemImage: "photo")
                    }
                    .help("插入图片或文件，存进「附件」")
                    .disabled(note == nil || note?.isTrashed == true)
                }
            }
    }

    private func location(_ note: Note) -> String {
        let folder = note.folder.isEmpty ? "未分类" : note.folder.replacingOccurrences(of: "/", with: " / ")
        return note.isTrashed ? "废纸篓（原来在 \(folder)）" : folder
    }

    /// 从 Finder 选图片或文件，存进「附件/」，插在光标处。
    private func chooseFiles() {
        guard let note = model.selectedNote, !note.isTrashed else { return }
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.prompt = "插入"
        panel.message = "选要插入的图片或文件，会复制一份到「附件」里"
        guard panel.runModal() == .OK else { return }
        let items = panel.urls.compactMap { url -> EditorHandle.Attachment? in
            guard let data = try? Data(contentsOf: url),
                  let link = model.addAttachment(data, fileName: url.lastPathComponent, for: note.id) else { return nil }
            let image = UTType(filenameExtension: url.pathExtension)?.conforms(to: .image) ?? false
            return EditorHandle.Attachment(link: link, name: url.lastPathComponent, image: image)
        }
        handle.insert(items)
    }
}
