import Foundation

/// 侧栏的键盘操作：↑↓ 换一项；→ 展开，已经展开（或没有下级）就去笔记列表；← 收起，已经收起就回到上级。
/// `expanded` 里是展开着的文件夹和标签（"folder:路径"、"tag:路径"），和侧栏画出来的一致。
public struct SidebarNavigation: Sendable {
    public let folders: [FolderNode]
    public let tags: [TagNode]
    public let expanded: Set<String>
    /// 「标签」这一组是不是展开着
    public let tagsOpen: Bool

    public init(folders: [FolderNode], tags: [TagNode], expanded: Set<String>, tagsOpen: Bool) {
        self.folders = folders
        self.tags = tags
        self.expanded = expanded
        self.tagsOpen = tagsOpen
    }

    public enum Action: Equatable, Sendable {
        /// 展开或收起这个文件夹、标签（"folder:路径"、"tag:路径"）
        case expand(String)
        case collapse(String)
        /// 选中侧栏里的另一项
        case select(Scope)
        /// 离开侧栏，去笔记列表
        case toList
    }

    /// 看得见的各行，从上到下：我的笔记、文件夹树、未分类、待办、标签树、废纸篓。
    public var rows: [Scope] {
        var rows: [Scope] = [.all]
        func addFolders(_ nodes: [FolderNode]) {
            for node in nodes {
                rows.append(.folder(node.path))
                if let children = node.children, expanded.contains("folder:" + node.path) { addFolders(children) }
            }
        }
        func addTags(_ nodes: [TagNode]) {
            for node in nodes {
                rows.append(.tag(node.path))
                if let children = node.children, expanded.contains("tag:" + node.path) { addTags(children) }
            }
        }
        addFolders(folders)
        rows += [.unfiled, .todo]
        if tagsOpen { addTags(tags) }
        rows.append(.trash)
        return rows
    }

    /// ↑（-1）↓（+1）：上一项、下一项，到头了就停在头上。当前这一项看不见（比如标签组收起了）时从第一项开始。
    public func step(from scope: Scope, by offset: Int) -> Scope {
        let rows = rows
        guard let i = rows.firstIndex(of: scope) else { return rows[0] }
        return rows[min(max(i + offset, 0), rows.count - 1)]
    }

    /// →
    public func right(from scope: Scope) -> Action {
        if let key = key(of: scope), hasChildren(scope), !expanded.contains(key) { return .expand(key) }
        return .toList
    }

    /// ←；没什么可做时返回 nil。
    public func left(from scope: Scope) -> Action? {
        if let key = key(of: scope), hasChildren(scope), expanded.contains(key) { return .collapse(key) }
        switch scope {
        case .folder(let path):
            // 一级文件夹的上级是「我的笔记」
            return .select(path.contains("/") ? .folder(Note.parentFolder(of: path)) : .all)
        case .tag(let path):
            return path.contains("/") ? .select(.tag(Note.parentFolder(of: path))) : nil
        case .unfiled:
            return .select(.all)
        default:
            return nil
        }
    }

    private func key(of scope: Scope) -> String? {
        switch scope {
        case .folder(let path): "folder:" + path
        case .tag(let path): "tag:" + path
        default: nil
        }
    }

    private func hasChildren(_ scope: Scope) -> Bool {
        switch scope {
        case .folder(let path): Self.find(path, in: folders, path: \.path, children: \.children)?.children?.isEmpty == false
        case .tag(let path): Self.find(path, in: tags, path: \.path, children: \.children)?.children?.isEmpty == false
        default: false
        }
    }

    private static func find<Node>(_ target: String, in nodes: [Node], path: KeyPath<Node, String>,
                                   children: KeyPath<Node, [Node]?>) -> Node? {
        for node in nodes {
            if node[keyPath: path] == target { return node }
            if target.hasPrefix(node[keyPath: path] + "/"), let kids = node[keyPath: children] {
                return find(target, in: kids, path: path, children: children)
            }
        }
        return nil
    }
}
