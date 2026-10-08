import Foundation

/// 一篇笔记，对应「我的笔记」里的一个 .md 文件。
public struct Note: Identifiable, Hashable, Sendable {
    public let id: UUID
    /// 相对「我的笔记」的路径，用“/”分隔，比如“工作/计划.md”；废纸篓里的是“废纸篓/计划.md”。
    public var path: String
    public var text: String {
        didSet { parsed = ParsedNote(text: text) }
    }
    public private(set) var parsed: ParsedNote
    public var created: Date
    public var modified: Date
    public var isPinned: Bool
    /// 在废纸篓里时，原来所在的文件夹（“”是未分类）。
    public var originalFolder: String?

    public init(
        id: UUID = UUID(), path: String, text: String, created: Date, modified: Date,
        isPinned: Bool = false, originalFolder: String? = nil
    ) {
        self.id = id
        self.path = path
        self.text = text
        self.parsed = ParsedNote(text: text)
        self.created = created
        self.modified = modified
        self.isPinned = isPinned
        self.originalFolder = originalFolder
    }

    public var isTrashed: Bool { path.hasPrefix(LibraryLayout.trash + "/") }

    /// 所在文件夹（“”是未分类）；在废纸篓里时是原来的文件夹。
    public var folder: String { isTrashed ? (originalFolder ?? "") : Note.parentFolder(of: path) }

    /// 显示用的标题；空笔记叫“无标题”。
    public var title: String { parsed.title.isEmpty ? "无标题" : parsed.title }

    /// 文件名去掉 .md。
    public var fileBaseName: String {
        ((path as NSString).lastPathComponent as NSString).deletingPathExtension
    }

    /// 同一篇笔记换一个 id（重新扫描目录时沿用旧 id）。
    public func withID(_ id: UUID) -> Note {
        Note(id: id, path: path, text: text, created: created, modified: modified,
             isPinned: isPinned, originalFolder: originalFolder)
    }

    /// “工作/BetterMD/a.md” → “工作/BetterMD”；“a.md” → “”。
    public static func parentFolder(of path: String) -> String {
        guard let slash = path.lastIndex(of: "/") else { return "" }
        return String(path[..<slash])
    }
}

/// 从正文算出来、列表和搜索要用的字段。正文一变就重算。
public struct ParsedNote: Hashable, Sendable {
    public let title: String
    public let tags: [String]
    public let hasOpenTodo: Bool
    public let preview: String
    /// 用 `SearchText.fold` 处理过的全文，搜索时直接比对。
    public let searchKey: String
    /// 第一张图片的地址（原样），列表里显示缩略图用。
    public let firstImage: String?

    public init(text: String) {
        title = NoteText.title(of: text)
        tags = NoteText.tags(in: text)
        hasOpenTodo = NoteText.hasOpenTodo(text)
        preview = NoteText.preview(of: text)
        searchKey = SearchText.fold(text)
        firstImage = NoteText.firstImage(in: text)
    }
}
