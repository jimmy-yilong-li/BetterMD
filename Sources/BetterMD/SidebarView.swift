import BetterMDCore
import SwiftUI

/// 侧栏：我的笔记（红色笔记本）和它下面的文件夹（火漆信封，可以多层、可以折叠）、未分类（散页），
/// 待办，标签（可以整组收起），废纸篓固定在最下面。不显示数量角标。
struct SidebarView: View {
    var body: some View {
        VStack(spacing: 0) {
            ScrollView { SidebarTree() }
                .scrollIndicators(.never)
            SidebarFooter()
        }
    }
}

/// 侧栏最下面的废纸篓。
struct SidebarFooter: View {
    var body: some View {
        VStack(spacing: 0) {
            Rectangle().fill(Ink.separator).frame(height: 0.5)
            SideRow(label: "废纸篓", scope: .trash, depth: 0) { SymbolIcon(name: "trash") }
                .padding(EdgeInsets(top: 6, leading: 8, bottom: 8, trailing: 8))
        }
    }
}

/// 侧栏里会滚动的部分：我的笔记和文件夹树、未分类、待办、标签。
struct SidebarTree: View {
    @Environment(AppModel.self) private var model
    /// 展开着的文件夹和标签（"folder:路径"、"tag:路径"）
    @State private var expanded: Set<String>
    @State private var tagsOpen = true
    /// 正在就地新建（父文件夹路径）或重命名（文件夹路径）的文件夹
    @State private var editing: FolderEdit?

    enum FolderEdit: Equatable {
        case create(parent: String)
        case rename(path: String)
    }

    /// `expanded`：一开始就展开的文件夹和标签（开发时画样张用）
    init(expanded: Set<String> = []) {
        _expanded = State(initialValue: expanded)
    }

    var body: some View {
                VStack(alignment: .leading, spacing: 1) {
                    SideRow(label: "我的笔记", scope: .all, depth: 0, onAdd: { startCreate(in: "") }) {
                        NotebookIcon()
                    }
                    .contextMenu { Button("新建文件夹") { startCreate(in: "") } }
                    if editing == .create(parent: "") { folderField(depth: 1) }
                    ForEach(model.folderTree) { node in folderBranch(node, depth: 1) }
                    SideRow(label: "未分类", scope: .unfiled, depth: 1, chevron: .leaf) { LooseSheetIcon() }
                    Color.clear.frame(height: 8)
                    SideRow(label: "待办", scope: .todo, depth: 0) { SymbolIcon(name: "checkmark.circle") }
                    if !model.tagTree.isEmpty {
                        SectionHeader(title: "标签", open: tagsOpen) { withAnimation(Motion.expand) { tagsOpen.toggle() } }
                        if tagsOpen {
                            VStack(alignment: .leading, spacing: 1) {
                                ForEach(model.tagTree) { node in tagBranch(node, depth: 0) }
                            }
                            .transition(.opacity.combined(with: .offset(y: -3)))
                        }
                    }
                }
                .padding(EdgeInsets(top: 4, leading: 8, bottom: 10, trailing: 8))
        .onAppear { reveal(model.scope) }
        .onChange(of: model.scope) { _, scope in reveal(scope) }
    }

    // MARK: 文件夹

    private func folderBranch(_ node: FolderNode, depth: Int) -> AnyView {
        let key = "folder:" + node.path
        let open = expanded.contains(key)
        let selected = model.scope == .folder(node.path)
        return AnyView(VStack(alignment: .leading, spacing: 1) {
            if editing == .rename(path: node.path) {
                folderField(depth: depth, renaming: node)
            } else {
                SideRow(label: node.name, scope: .folder(node.path), depth: depth,
                        chevron: node.children == nil ? .leaf : (open ? .open : .closed),
                        onToggle: { toggle(key) }) {
                    EnvelopeIcon(open: selected)
                }
                .contextMenu {
                    Button("新建子文件夹") { startCreate(in: node.path) }
                    Button("重命名") { editing = .rename(path: node.path) }
                }
            }
            if editing == .create(parent: node.path) { folderField(depth: depth + 1) }
            if open, let children = node.children {
                VStack(alignment: .leading, spacing: 1) {
                    ForEach(children) { child in folderBranch(child, depth: depth + 1) }
                }
                .transition(.opacity.combined(with: .offset(y: -3)))
            }
        })
    }

    private func folderField(depth: Int, renaming node: FolderNode? = nil) -> some View {
        FolderNameField(initial: node?.name ?? "", depth: depth) { name in
            let edit = editing
            editing = nil
            guard let name, !name.isEmpty else { return }
            switch edit {
            case .create(let parent):
                if let path = model.newFolder(named: name, in: parent) { model.scope = .folder(path) }
            case .rename(let path):
                model.renameFolder(path, to: name)
            case nil:
                break
            }
        }
    }

    private func startCreate(in parent: String) {
        if !parent.isEmpty { withAnimation(Motion.expand) { _ = expanded.insert("folder:" + parent) } }
        editing = .create(parent: parent)
    }

    // MARK: 标签

    private func tagBranch(_ node: TagNode, depth: Int) -> AnyView {
        let key = "tag:" + node.path
        let open = expanded.contains(key)
        return AnyView(VStack(alignment: .leading, spacing: 1) {
            SideRow(label: node.name, scope: .tag(node.path), depth: depth,
                    chevron: node.children == nil ? .leaf : (open ? .open : .closed),
                    onToggle: { toggle(key) }) {
                SymbolIcon(name: "number")
            }
            if open, let children = node.children {
                VStack(alignment: .leading, spacing: 1) {
                    ForEach(children) { child in tagBranch(child, depth: depth + 1) }
                }
                .transition(.opacity.combined(with: .offset(y: -3)))
            }
        })
    }

    // MARK: 展开

    private func toggle(_ key: String) {
        withAnimation(Motion.expand) {
            if expanded.contains(key) { expanded.remove(key) } else { expanded.insert(key) }
        }
    }

    /// 选中深处的文件夹或标签时，把它的上级都展开，让它看得见。
    private func reveal(_ scope: Scope) {
        let (prefix, path): (String, String)
        switch scope {
        case .folder(let p): (prefix, path) = ("folder:", p)
        case .tag(let p): (prefix, path) = ("tag:", p)
        default: return
        }
        var parts = path.split(separator: "/").map(String.init)
        guard !parts.isEmpty else { return }
        parts.removeLast()
        var current: [String] = []
        for part in parts {
            current.append(part)
            expanded.insert(prefix + current.joined(separator: "/"))
        }
        if case .tag = scope { tagsOpen = true }
    }
}

/// 侧栏里的一行：（折叠箭头）图标 名字（悬停时右边的 +）。选中时底色是淡淡的朱砂。
private struct SideRow<Icon: View>: View {
    /// leaf：没有下级，箭头的位置留着但不显示，好让图标对齐
    enum Chevron { case leaf, open, closed }

    @Environment(AppModel.self) private var model
    let label: String
    let scope: Scope
    let depth: Int
    var chevron: Chevron? = nil
    var onToggle: () -> Void = {}
    var onAdd: (() -> Void)? = nil
    @ViewBuilder let icon: () -> Icon
    @State private var hovering = false

    var body: some View {
        let selected = model.scope == scope
        HStack(spacing: 7) {
            if let chevron {
                Image(systemName: "chevron.right")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(Ink.text3)
                    .rotationEffect(.degrees(chevron == .open ? 90 : 0))
                    .frame(width: 12, height: 12)
                    .contentShape(Rectangle())
                    .opacity(chevron == .leaf ? 0 : 1)
                    .onTapGesture { if chevron != .leaf { onToggle() } }
            }
            icon().frame(width: 18, height: 18)
            Text(label)
                .font(.system(size: 13))
                .foregroundStyle(Ink.text)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 0)
            if let onAdd {
                Button(action: onAdd) {
                    Image(systemName: "plus").font(.system(size: 11, weight: .semibold)).foregroundStyle(Ink.text3)
                        .frame(width: 20, height: 20)
                        .background(RoundedRectangle(cornerRadius: 5).fill(hovering ? Ink.hover : .clear))
                }
                .buttonStyle(PressableStyle())
                .opacity(hovering ? 1 : 0)
                .help("新建文件夹")
            }
        }
        .padding(.leading, 8 + CGFloat(depth) * 14)
        .padding(.trailing, 8)
        .frame(height: 28)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(selected ? Ink.sideSelection : hovering ? Ink.hover : .clear)
        )
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .onTapGesture { model.scope = scope }
        .animation(.easeOut(duration: 0.15), value: hovering)
        .animation(.easeOut(duration: 0.15), value: selected)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
    }
}

/// 分组的小标题（标签）：悬停时右边出现箭头，点一下整组收起或展开。
private struct SectionHeader: View {
    let title: String
    let open: Bool
    let toggle: () -> Void
    @State private var hovering = false

    var body: some View {
        HStack {
            Text(title).font(.system(size: 11, weight: .semibold)).foregroundStyle(Ink.text3)
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 8.5, weight: .semibold))
                .foregroundStyle(Ink.text3)
                .rotationEffect(.degrees(open ? 90 : 0))
                .opacity(hovering ? 1 : 0)
        }
        .padding(EdgeInsets(top: 16, leading: 8, bottom: 5, trailing: 8))
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .onTapGesture(perform: toggle)
        .animation(.easeOut(duration: 0.15), value: hovering)
    }
}

/// 线性图标（SF Symbols），朱砂色。
private struct SymbolIcon: View {
    let name: String
    var body: some View {
        Image(systemName: name).font(.system(size: 13.5, weight: .regular)).foregroundStyle(Ink.accent)
    }
}

/// 就地输入文件夹名字：回车确定，Esc 或点别处取消。
private struct FolderNameField: View {
    let initial: String
    let depth: Int
    let done: (String?) -> Void
    @State private var name = ""
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 7) {
            EnvelopeIcon(open: false)
            TextField("文件夹名称", text: $name)
                .textFieldStyle(.plain)
                .font(.system(size: 13))
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(RoundedRectangle(cornerRadius: 5).fill(Ink.paper))
                .overlay(RoundedRectangle(cornerRadius: 5).stroke(Ink.accent.opacity(0.55), lineWidth: 2))
                .focused($focused)
                .onSubmit { done(name.trimmingCharacters(in: .whitespaces)) }
                .onExitCommand { done(nil) }
                .onChange(of: focused) { _, isFocused in if !isFocused { done(nil) } }
        }
        .padding(.leading, 8 + CGFloat(depth) * 14 + 19)
        .padding(.trailing, 8)
        .frame(height: 28)
        .onAppear {
            name = initial
            focused = true
        }
    }
}
