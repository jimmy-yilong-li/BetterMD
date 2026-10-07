import BetterMDCore
import SwiftUI

/// 侧栏：我的笔记（含文件夹树和未分类）、待办、标签、废纸篓。
struct SidebarView: View {
    @Environment(AppModel.self) private var model
    @State private var prompt: FolderPrompt?
    @State private var folderName = ""

    /// 正在新建或改名的文件夹。
    enum FolderPrompt {
        case create(parent: String)
        case rename(path: String)
    }

    var body: some View {
        List(selection: selection) {
            Section {
                Label("我的笔记", systemImage: "book.closed")
                    .tag(Scope.all)
                    .contextMenu { Button("新建文件夹…") { ask(.create(parent: "")) } }
                OutlineGroup(model.folderTree, children: \.children) { node in
                    Label(node.name, systemImage: "folder")
                        .tag(Scope.folder(node.path))
                        .contextMenu {
                            Button("新建子文件夹…") { ask(.create(parent: node.path)) }
                            Button("重命名…") { ask(.rename(path: node.path)) }
                        }
                }
                Label("未分类", systemImage: "doc.text").tag(Scope.unfiled)
                Label("待办", systemImage: "checkmark.circle").tag(Scope.todo)
            }
            Section("标签") {
                OutlineGroup(model.tagTree, children: \.children) { node in
                    Label(node.name, systemImage: "number").tag(Scope.tag(node.path))
                }
            }
            Section {
                Label("废纸篓", systemImage: "trash").tag(Scope.trash)
            }
        }
        .listStyle(.sidebar)
        .alert(promptTitle, isPresented: promptShown) {
            TextField("名称", text: $folderName)
            Button("好") { commit() }
            Button("取消", role: .cancel) { prompt = nil }
        }
    }

    private var selection: Binding<Scope?> {
        Binding(get: { model.scope }, set: { if let scope = $0 { model.scope = scope } })
    }

    private var promptShown: Binding<Bool> {
        Binding(get: { prompt != nil }, set: { if !$0 { prompt = nil } })
    }

    private var promptTitle: String {
        if case .rename? = prompt { return "重命名文件夹" }
        return "新建文件夹"
    }

    private func ask(_ newPrompt: FolderPrompt) {
        if case .rename(let path) = newPrompt {
            folderName = path.split(separator: "/").last.map(String.init) ?? path
        } else {
            folderName = ""
        }
        prompt = newPrompt
    }

    private func commit() {
        let name = folderName.trimmingCharacters(in: .whitespaces)
        defer { prompt = nil }
        guard !name.isEmpty, let current = prompt else { return }
        switch current {
        case .create(let parent):
            if let path = model.newFolder(named: name, in: parent) { model.scope = .folder(path) }
        case .rename(let path):
            model.renameFolder(path, to: name)
        }
    }
}
