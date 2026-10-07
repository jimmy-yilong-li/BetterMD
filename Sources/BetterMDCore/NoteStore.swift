import Foundation
import UniformTypeIdentifiers

/// 读写「我的笔记」目录。App 里只有这里直接碰文件。
public struct NoteStore: Sendable {
    public let root: URL

    public init(root: URL) {
        self.root = root
    }

    /// 一次完整扫描的结果。
    public struct Snapshot: Sendable {
        public var notes: [Note]
        public var folders: [String]
        public var state: LibraryState
    }

    public func url(for path: String) -> URL {
        path.isEmpty ? root : root.appendingPathComponent(path)
    }

    /// 建好根目录和「附件」「废纸篓」「.bettermd」。
    public func prepare() throws {
        for dir in ["", LibraryLayout.attachments, LibraryLayout.trash, LibraryLayout.meta] {
            try FileManager.default.createDirectory(at: url(for: dir), withIntermediateDirectories: true)
        }
    }

    /// 扫描全部 .md 笔记（包括废纸篓里的）和全部文件夹（不含「附件」「废纸篓」和隐藏目录）。
    /// 读不出来的文件（既不是 UTF-8 也不是 GB18030）直接跳过，不会被改动。
    public func load() throws -> Snapshot {
        let state = loadState()
        let keys: [URLResourceKey] = [.isDirectoryKey, .creationDateKey, .contentModificationDateKey]
        guard let walker = FileManager.default.enumerator(
            at: root, includingPropertiesForKeys: keys,
            options: [.skipsHiddenFiles, .skipsPackageDescendants]
        ) else {
            return Snapshot(notes: [], folders: [], state: state)
        }
        var notes: [Note] = []
        var folders: [String] = []
        for case let url as URL in walker {
            guard let values = try? url.resourceValues(forKeys: Set(keys)) else { continue }
            let path = relativePath(of: url)
            let top = path.split(separator: "/").first.map(String.init) ?? path
            if values.isDirectory == true {
                if top == LibraryLayout.attachments {
                    walker.skipDescendants()
                } else if top == LibraryLayout.trash {
                    if path != top { walker.skipDescendants() }
                } else {
                    folders.append(path)
                }
                continue
            }
            guard url.pathExtension.lowercased() == "md", let text = readText(url) else { continue }
            notes.append(Note(
                path: path, text: text,
                created: values.creationDate ?? values.contentModificationDate ?? .now,
                modified: values.contentModificationDate ?? .now,
                isPinned: state.pinned.contains(path),
                originalFolder: state.trashOrigins[path]
            ))
        }
        folders.sort { $0.localizedStandardCompare($1) == .orderedAscending }
        return Snapshot(notes: notes, folders: folders, state: state)
    }

    /// 原子写入笔记全文，保留文件原来的创建时间；返回新的修改时间。
    @discardableResult
    public func write(_ note: Note) throws -> Date {
        let fm = FileManager.default
        let target = url(for: note.path)
        try fm.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        let data = Data(note.text.utf8)
        if fm.fileExists(atPath: target.path) {
            let scratch = try fm.url(for: .itemReplacementDirectory, in: .userDomainMask,
                                     appropriateFor: target, create: true)
            defer { try? fm.removeItem(at: scratch) }
            let temp = scratch.appendingPathComponent(target.lastPathComponent)
            try data.write(to: temp)
            _ = try fm.replaceItemAt(target, withItemAt: temp)
        } else {
            try data.write(to: target, options: .atomic)
        }
        return (try? target.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .now
    }

    /// 在 `folder` 里新建笔记，文件名取自正文标题；返回新笔记。
    public func createNote(text: String, inFolder folder: String) throws -> Note {
        let dir = url(for: folder)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let base = LibraryLayout.fileName(forTitle: NoteText.title(of: text))
        let target = LibraryLayout.uniqueURL(in: dir, base: base)
        try Data(text.utf8).write(to: target, options: .atomic)
        let now = Date()
        return Note(path: relativePath(of: target), text: text, created: now, modified: now)
    }

    public func loadState() -> LibraryState {
        guard let data = try? Data(contentsOf: url(for: LibraryLayout.stateFile)),
              let state = try? JSONDecoder().decode(LibraryState.self, from: data) else {
            return LibraryState()
        }
        return state
    }

    public func saveState(_ state: LibraryState) throws {
        let target = url(for: LibraryLayout.stateFile)
        try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(state).write(to: target, options: .atomic)
    }

    /// 文件名和标题对不上时，把文件改成标题的名字；返回更新后的笔记（不用改时原样返回）。
    public func renameToMatchTitle(_ note: Note) throws -> Note {
        guard !note.isTrashed else { return note }
        let wanted = LibraryLayout.fileName(forTitle: note.parsed.title)
        guard wanted != note.fileBaseName else { return note }
        let current = url(for: note.path)
        let target = LibraryLayout.uniqueURL(in: current.deletingLastPathComponent(), base: wanted, excluding: current)
        guard target.path != current.path else { return note }
        try moveItem(at: current, to: target)
        var renamed = note
        renamed.path = relativePath(of: target)
        return renamed
    }

    /// 把笔记移到 `folder`（“”是未分类），重名时加序号。从废纸篓移出来就是恢复。
    /// 正文里的相对链接（图片等）改成从新文件夹出发的写法；移进废纸篓时不改（链接仍按原来的文件夹算）。
    public func move(_ note: Note, toFolder folder: String) throws -> Note {
        guard Note.parentFolder(of: note.path) != folder else { return note }
        let dir = url(for: folder)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let target = LibraryLayout.uniqueURL(in: dir, base: note.fileBaseName)
        try moveItem(at: url(for: note.path), to: target)
        var moved = note
        moved.path = relativePath(of: target)
        moved.originalFolder = nil
        if folder != LibraryLayout.trash {
            let rebased = MarkdownLinks.rebase(note.text, from: note.folder, to: folder)
            if rebased != note.text {
                moved.text = rebased
                moved.modified = try write(moved)
            }
        }
        return moved
    }

    /// 移到废纸篓，记住原来的文件夹。
    public func trash(_ note: Note) throws -> Note {
        guard !note.isTrashed else { return note }
        let origin = note.folder
        var trashed = try move(note, toFolder: LibraryLayout.trash)
        trashed.originalFolder = origin
        return trashed
    }

    /// 从废纸篓放回原来的文件夹；文件夹不在了就重新建。
    public func restore(_ note: Note) throws -> Note {
        guard note.isTrashed else { return note }
        return try move(note, toFolder: note.originalFolder ?? "")
    }

    /// 在 `parent` 里新建文件夹，重名时加序号；返回新文件夹的路径。
    public func createFolder(named name: String, in parent: String) throws -> String {
        let target = LibraryLayout.uniqueURL(in: url(for: parent), base: folderName(name, in: parent), ext: nil)
        try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
        return relativePath(of: target)
    }

    /// 给文件夹改名；返回新路径。
    public func renameFolder(_ path: String, to name: String) throws -> String {
        let current = url(for: path)
        let parent = Note.parentFolder(of: path)
        let target = LibraryLayout.uniqueURL(in: url(for: parent), base: folderName(name, in: parent),
                                             ext: nil, excluding: current)
        guard target.path != current.path else { return path }
        try moveItem(at: current, to: target)
        return relativePath(of: target)
    }

    /// 把粘贴、拖进来或选来的文件存进「附件/」：图片按时间起名（20261007-153012.png），
    /// 别的文件保留原名；重名时加 -2、-3。返回相对「我的笔记」的路径，比如“附件/20261007-153012.png”。
    public func saveAttachment(_ data: Data, fileName: String, mimeType: String? = nil, now: Date = .now) throws -> String {
        let dir = url(for: LibraryLayout.attachments)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let original = fileName as NSString
        var ext = original.pathExtension.lowercased()
        if ext.isEmpty, let mimeType, let preferred = UTType(mimeType: mimeType)?.preferredFilenameExtension {
            ext = preferred
        }
        let isImage = ext.isEmpty ? (mimeType?.hasPrefix("image/") ?? false) : (UTType(filenameExtension: ext)?.conforms(to: .image) ?? false)
        let base = isImage || original.deletingPathExtension.isEmpty
            ? Self.timestamp(now)
            : LibraryLayout.fileName(forTitle: original.deletingPathExtension)
        var n = 1
        while true {
            let name = (n == 1 ? base : "\(base)-\(n)") + (ext.isEmpty ? "" : "." + ext)
            let target = dir.appendingPathComponent(name)
            if !FileManager.default.fileExists(atPath: target.path) {
                try data.write(to: target, options: [.atomic])
                return LibraryLayout.attachments + "/" + name
            }
            n += 1
        }
    }

    /// 正文里引用的文件（相对「我的笔记」的路径）在磁盘上的位置。路径不能跳出「我的笔记」。
    /// 文件不在原处时（比如笔记在 Finder 里被挪过），按文件名到「附件/」里找。都找不到返回 nil。
    public func resolveFile(_ path: String) -> URL? {
        let parts = path.split(separator: "/").map(String.init)
        guard let name = parts.last, !parts.contains(where: { $0 == ".." || $0 == "." }) else { return nil }
        let fm = FileManager.default
        var isDir: ObjCBool = false
        let direct = url(for: parts.joined(separator: "/"))
        if fm.fileExists(atPath: direct.path, isDirectory: &isDir), !isDir.boolValue { return direct }
        let fallback = url(for: LibraryLayout.attachments).appendingPathComponent(name)
        if fm.fileExists(atPath: fallback.path, isDirectory: &isDir), !isDir.boolValue { return fallback }
        return nil
    }

    static func timestamp(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        return formatter.string(from: date)
    }

    // MARK: - 内部

    /// 文件相对「我的笔记」的路径（先解开 /var → /private/var 这类符号链接再比较）。
    func relativePath(of url: URL) -> String {
        let base = root.resolvingSymlinksInPath().standardizedFileURL.path
        let full = url.resolvingSymlinksInPath().standardizedFileURL.path
        guard full.hasPrefix(base) else { return url.lastPathComponent }
        return String(full.dropFirst(base.count)).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    /// 先按 UTF-8 读，不行再按 GB18030；都不行返回 nil。
    /// Windows 的换行（\r\n）和老 Mac 的换行（\r）统一成 \n：编辑器里只有 \n，两边对比内容时才对得上。
    /// 文件本身不动，下次保存时才写成 \n。
    func readText(_ url: URL) -> String? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        let gb18030 = String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(
            CFStringEncoding(CFStringEncodings.GB_18030_2000.rawValue)))
        guard let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: gb18030) else { return nil }
        // （按字节查 \r：Swift 里 \r\n 是一个字符，按字符查找不到单独的 \r）
        return text.utf8.contains(13) ? Self.normalizeNewlines(text) : text
    }

    static func normalizeNewlines(_ text: String) -> String {
        text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
    }

    /// 根目录下不能叫「附件」「废纸篓」，遇到就加“ 文件夹”。
    func folderName(_ name: String, in parent: String) -> String {
        let clean = LibraryLayout.fileName(forTitle: name)
        return parent.isEmpty && LibraryLayout.reserved.contains(clean) ? clean + " 文件夹" : clean
    }

    /// 移动文件或文件夹；只改大小写时先挪到临时名字，再挪回来。
    func moveItem(at from: URL, to: URL) throws {
        let fm = FileManager.default
        if from.path.lowercased() == to.path.lowercased() {
            let temp = from.deletingLastPathComponent().appendingPathComponent(".bettermd-rename-\(UUID().uuidString)")
            try fm.moveItem(at: from, to: temp)
            try fm.moveItem(at: temp, to: to)
        } else {
            try fm.moveItem(at: from, to: to)
        }
    }
}
