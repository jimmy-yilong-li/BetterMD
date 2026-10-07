import Foundation

/// 侧栏里选中的范围。
public enum Scope: Hashable, Sendable {
    case all
    case unfiled
    case todo
    case trash
    case folder(String)
    case tag(String)
}

/// 侧栏文件夹树的一个节点。
public struct FolderNode: Identifiable, Hashable, Sendable {
    public var id: String { path }
    public let path: String
    public let name: String
    public let children: [FolderNode]?

    public init(path: String, name: String, children: [FolderNode]?) {
        self.path = path
        self.name = name
        self.children = children
    }
}

/// 侧栏标签树的一个节点。
public struct TagNode: Identifiable, Hashable, Sendable {
    public var id: String { path }
    public let path: String
    public let name: String
    public let children: [TagNode]?

    public init(path: String, name: String, children: [TagNode]?) {
        self.path = path
        self.name = name
        self.children = children
    }
}

/// 列表、搜索、侧栏树的计算。全是纯函数，方便测试。
public enum LibraryIndex {
    /// 某个范围里的笔记（废纸篓里的只在 `.trash` 出现）。文件夹和标签都包含下级。
    public static func notes(_ notes: [Note], in scope: Scope) -> [Note] {
        notes.filter { note in
            if case .trash = scope { return note.isTrashed }
            if note.isTrashed { return false }
            switch scope {
            case .all, .trash: return true
            case .unfiled: return note.folder.isEmpty
            case .todo: return note.parsed.hasOpenTodo
            case .folder(let f): return note.folder == f || note.folder.hasPrefix(f + "/")
            case .tag(let t): return note.parsed.tags.contains { $0 == t || $0.hasPrefix(t + "/") }
            }
        }
    }

    /// 置顶在前，然后按修改时间从新到旧。
    public static func sorted(_ notes: [Note]) -> [Note] {
        notes.sorted { a, b in a.isPinned != b.isPinned ? a.isPinned : a.modified > b.modified }
    }

    /// 关键词搜索：全部关键词命中才算；标题命中的排前面，然后按修改时间。空查询只排序。
    public static func search(_ notes: [Note], query: String) -> [Note] {
        let terms = SearchText.terms(query)
        guard !terms.isEmpty else { return sorted(notes) }
        func titleHit(_ note: Note) -> Bool {
            let title = SearchText.fold(note.title)
            return terms.contains { title.contains($0) }
        }
        return notes
            .filter { SearchText.matches($0.parsed.searchKey, terms: terms) }
            .sorted { a, b in
                let (ha, hb) = (titleHit(a), titleHit(b))
                return ha != hb ? ha : a.modified > b.modified
            }
    }

    /// 列表里实际显示的笔记。
    public static func visible(_ all: [Note], scope: Scope, query: String) -> [Note] {
        search(notes(all, in: scope), query: query)
    }

    /// 把“工作”“工作/BetterMD”这样的路径列表变成树。
    public static func folderTree(_ folders: [String]) -> [FolderNode] {
        func build(_ parent: String) -> [FolderNode] {
            folders
                .filter { Note.parentFolder(of: $0) == parent }
                .sorted { $0.localizedStandardCompare($1) == .orderedAscending }
                .map { path in
                    let kids = build(path)
                    return FolderNode(path: path, name: lastComponent(path), children: kids.isEmpty ? nil : kids)
                }
        }
        return build("")
    }

    /// 所有没在废纸篓里的笔记用到的标签，连同它们的上级（“会议/周会”会带出“会议”）。
    public static func tagTree(_ notes: [Note]) -> [TagNode] {
        var all = Set<String>()
        for note in notes where !note.isTrashed {
            for tag in note.parsed.tags {
                var parts: [Substring] = []
                for part in tag.split(separator: "/") {
                    parts.append(part)
                    all.insert(parts.joined(separator: "/"))
                }
            }
        }
        func build(_ parent: String) -> [TagNode] {
            all
                .filter { Note.parentFolder(of: $0) == parent }
                .sorted { $0.localizedStandardCompare($1) == .orderedAscending }
                .map { path in
                    let kids = build(path)
                    return TagNode(path: path, name: lastComponent(path), children: kids.isEmpty ? nil : kids)
                }
        }
        return build("")
    }

    /// 新笔记放进哪个文件夹：文件夹视图放进当前文件夹，其他都放进未分类。
    public static func folderForNewNote(in scope: Scope) -> String {
        if case .folder(let folder) = scope { return folder }
        return ""
    }

    /// 新笔记的初始正文：标签视图里自动带上标签，待办视图里先放一条待办。
    public static func newNoteText(for scope: Scope) -> String {
        switch scope {
        case .tag(let tag): "# 新笔记\n#\(tag)\n\n"
        case .todo: "# 新笔记\n\n- [ ] "
        default: "# 新笔记\n\n"
        }
    }

    /// 列表里每篇笔记旁边显示的位置；就在当前文件夹里时不显示。
    public static func locationLabel(for note: Note, in scope: Scope) -> String? {
        let folder = note.folder
        switch scope {
        case .unfiled:
            return nil
        case .folder(let current):
            guard folder != current else { return nil }
            let rest = folder.hasPrefix(current + "/") ? String(folder.dropFirst(current.count + 1)) : folder
            return rest.replacingOccurrences(of: "/", with: " / ")
        default:
            return folder.isEmpty ? "未分类" : folder.replacingOccurrences(of: "/", with: " / ")
        }
    }

    static func lastComponent(_ path: String) -> String {
        path.split(separator: "/").last.map(String.init) ?? path
    }
}
