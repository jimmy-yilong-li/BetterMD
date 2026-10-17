import Foundation
import UniformTypeIdentifiers

/// 读写「我的笔记」目录。App 里只有这里直接碰文件。
public struct NoteStore: Sendable {
    public let root: URL
    /// 文件只在 iCloud 上、还没下载到这台 Mac 时：请 iCloud 下载，返回 true（这次先不读）。测试里换成假的。
    var downloadIfCloudOnly: @Sendable (URL) -> Bool = { NoteStore.requestDownloadIfDataless($0) }

    public init(root: URL) {
        self.root = root
    }

    /// 一次完整扫描的结果。
    public struct Snapshot: Sendable {
        public var notes: [Note]
        public var folders: [String]
        public var state: LibraryState
        /// 只在 iCloud 上、这次没读的笔记有几篇（已经请 iCloud 下载，下好了再读）
        public var downloading = 0
        /// state.json 读得出来（或者本来就没有）。读不出来时 state 是空的，不能拿它盖掉原文件
        public var stateReadable = true
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
    /// 只在 iCloud 上的笔记（iCloud 为了省空间只在本机留了个空壳）这次也跳过：现在读要等下载，会卡住界面。
    /// 先请 iCloud 下载，下好了再读；跳过了几篇记在 `downloading` 里。
    ///
    /// `previous`：上一次读到的笔记（按路径）。同一路径的笔记沿用原来的 id；文件修改时间也没变的，
    /// 连正文和解析结果一起沿用，不再读文件、不再解析——回到 App 时重新读取就几乎不花时间。
    /// 需要解析的笔记分到多个核上并行解析。
    public func load(reusing previous: [String: Note] = [:]) throws -> Snapshot {
        let (state, stateReadable) = readState()
        let keys: [URLResourceKey] = [.isDirectoryKey, .creationDateKey, .contentModificationDateKey, .fileSizeKey, .isSymbolicLinkKey]
        guard let walker = FileManager.default.enumerator(
            at: root, includingPropertiesForKeys: keys,
            options: [.skipsHiddenFiles, .skipsPackageDescendants]
        ) else {
            return Snapshot(notes: [], folders: [], state: state, stateReadable: stateReadable)
        }
        var notes: [Note] = []
        var folders: [String] = []
        var downloading = 0
        var fresh: [(path: String, text: String, created: Date, modified: Date, size: Int)] = []
        for case let url as URL in walker {
            guard let values = try? url.resourceValues(forKeys: Set(keys)) else { continue }
            // 符号链接的 .md 不当笔记：指到库外的会改到别处的文件，指到库里的会出现两遍
            if values.isSymbolicLink == true { continue }
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
            guard url.pathExtension.lowercased() == "md" else { continue }
            let modified = values.contentModificationDate ?? .now
            let created = values.creationDate ?? modified
            let size = values.fileSize ?? 0
            // 修改时间和文件大小都和上次读、写时一样才沿用（有的网络盘、exFAT 时间只精确到秒，光看时间会漏掉）。
            // 比的是记下的文件大小，不是正文的字节数：\r\n、GB18030、带 BOM 的文件两者不一样。
            // iCloud 把文件清成空壳时，时间和大小都不变，照样沿用，不会从列表里消失
            if let old = previous[path], let disk = old.disk, disk.modified == modified, disk.size == size {
                notes.append(Note(id: old.id, path: path, text: old.text, parsed: old.parsed, created: created,
                                  modified: old.modified, isPinned: state.pinned.contains(path),
                                  originalFolder: state.trashOrigins[path], disk: disk))
                continue
            }
            if downloadIfCloudOnly(url) {
                downloading += 1
                continue
            }
            guard let text = readText(url) else { continue }
            fresh.append((path, text, created, modified, size))
        }
        // 新读到的正文并行解析
        var parsed = [ParsedNote?](repeating: nil, count: fresh.count)
        parsed.withUnsafeMutableBufferPointer { buffer in
            nonisolated(unsafe) let out = buffer
            let texts = fresh.map(\.text)
            DispatchQueue.concurrentPerform(iterations: texts.count) { i in out[i] = ParsedNote(text: texts[i]) }
        }
        for (entry, result) in zip(fresh, parsed) {
            guard let result else { continue }
            notes.append(Note(id: previous[entry.path]?.id ?? UUID(), path: entry.path, text: entry.text, parsed: result,
                              created: entry.created, modified: entry.modified,
                              isPinned: state.pinned.contains(entry.path), originalFolder: state.trashOrigins[entry.path],
                              disk: DiskStamp(modified: entry.modified, size: entry.size, text: entry.text)))
        }
        folders.sort { $0.localizedStandardCompare($1) == .orderedAscending }
        return Snapshot(notes: notes, folders: folders, state: state, downloading: downloading, stateReadable: stateReadable)
    }

    /// 磁盘上这篇现在的样子和正文；文件不在、读不出来返回 nil。保存前、移动前拿它和记下的比，看别处有没有改过。
    public func currentVersion(of note: Note) -> (stamp: DiskStamp, text: String)? {
        let file = url(for: note.path)
        guard let values = try? file.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey]),
              let text = readText(file) else { return nil }
        return (DiskStamp(modified: values.contentModificationDate ?? .now, size: values.fileSize ?? 0, text: text), text)
    }

    /// 只在云上的文件请 iCloud 下载，返回 true。请不动的（比如不归 iCloud 管的网盘）返回 false，
    /// 当普通文件读：读的时候系统会去下载，只是要等。
    static func requestDownloadIfDataless(_ url: URL) -> Bool {
        guard isDataless(url) else { return false }
        return (try? FileManager.default.startDownloadingUbiquitousItem(at: url)) != nil
    }

    /// 文件内容是不是只在云上（iCloud 的“优化 Mac 储存空间”会把不常用的文件只留一个空壳，读的时候才下载）。
    /// 只看文件的标志位，不会触发下载。
    static func isDataless(_ url: URL) -> Bool {
        var info = stat()
        return lstat(url.path, &info) == 0 && info.st_flags & UInt32(SF_DATALESS) != 0
    }

    /// 原子写入笔记全文，保留文件原来的创建时间；返回写下去以后文件的样子（修改时间、大小、指纹）。
    @discardableResult
    public func write(_ note: Note) throws -> DiskStamp {
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
        let modified = (try? target.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .now
        return DiskStamp(modified: modified, size: data.count, text: note.text)
    }

    /// 在 `folder` 里新建笔记，文件名取自正文标题；返回新笔记。
    public func createNote(text: String, inFolder folder: String) throws -> Note {
        let dir = url(for: folder)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let base = LibraryLayout.fileName(forTitle: NoteText.title(of: text))
        let target = LibraryLayout.uniqueURL(in: dir, base: base)
        try Data(text.utf8).write(to: target, options: .atomic)
        let now = Date()
        // 修改时间用文件自己的：保存前要拿它和磁盘上的比，看别处有没有改过
        let modified = (try? target.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? now
        return Note(path: relativePath(of: target), text: text, created: now, modified: modified,
                    disk: DiskStamp(modified: modified, size: text.utf8.count, text: text))
    }

    /// 在这篇笔记旁边另存一份正文，文件名是“标题（suffix）”，重名加序号；返回文件名。
    public func saveCopy(_ text: String, besides note: Note, suffix: String) throws -> String {
        let dir = url(for: note.path).deletingLastPathComponent()
        let target = LibraryLayout.uniqueURL(in: dir, base: LibraryLayout.fileName(forTitle: note.title, suffix: "（\(suffix)）"))
        try Data(text.utf8).write(to: target, options: .atomic)
        return target.lastPathComponent
    }

    public func loadState() -> LibraryState {
        readState().state
    }

    /// 读 state.json。文件不在：空状态，算读得出来。文件在、却读不出来或解析不了（iCloud 只留了空壳又没网、
    /// 权限、文件坏了）：空状态，readable 为 false，这时不能拿空状态把它盖掉。
    public func readState() -> (state: LibraryState, readable: Bool) {
        let file = url(for: LibraryLayout.stateFile)
        guard FileManager.default.fileExists(atPath: file.path) else { return (LibraryState(), true) }
        guard let data = try? Data(contentsOf: file),
              let state = try? JSONDecoder().decode(LibraryState.self, from: data) else {
            return (LibraryState(), false)
        }
        return (state, true)
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
        var moved = note
        // 先挪文件，再在新位置写下改好链接的正文：挪不动时什么都没改；写不进去就挪回原处。
        // （反过来先写再挪的话，挪不动时原处的文件已经带着按新位置写的链接了）
        let source = url(for: note.path)
        let target = LibraryLayout.uniqueURL(in: dir, base: baseNameForMove(note))
        try moveItem(at: source, to: target)
        moved.path = relativePath(of: target)
        moved.originalFolder = nil
        if folder != LibraryLayout.trash {
            let rebased = MarkdownLinks.rebase(note.text, from: note.folder, to: folder)
            if rebased != note.text {
                moved.text = rebased
                do {
                    let stamp = try write(moved)
                    moved.modified = stamp.modified
                    moved.disk = stamp
                } catch {
                    if (try? moveItem(at: target, to: source)) != nil { throw error }
                    // 挪也挪不回去：文件留在新位置，正文没改（链接按原来的文件夹写，图片靠按文件名到「附件」里找）
                    moved.text = note.text
                }
            }
        }
        return moved
    }

    /// 挪出废纸篓时，去掉在废纸篓里为了不重名加上的“ 2”这类后缀（文件名本来就是按标题起的才去）。
    func baseNameForMove(_ note: Note) -> String {
        let base = note.fileBaseName
        guard note.isTrashed else { return base }
        let titled = LibraryLayout.fileName(forTitle: note.parsed.title)
        if base.hasPrefix(titled + " "), Int(base.dropFirst(titled.count + 1)) != nil { return titled }
        return base
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
        // 符号链接解开以后还得在「我的笔记」里面，不然编辑器网页就能读到库外面的文件
        let base = root.resolvingSymlinksInPath().standardizedFileURL.path + "/"
        let usable = { (candidate: URL) -> Bool in
            var isDir: ObjCBool = false
            return fm.fileExists(atPath: candidate.path, isDirectory: &isDir) && !isDir.boolValue
                && candidate.resolvingSymlinksInPath().standardizedFileURL.path.hasPrefix(base)
        }
        let direct = url(for: parts.joined(separator: "/"))
        if usable(direct) { return direct }
        let fallback = url(for: LibraryLayout.attachments).appendingPathComponent(name)
        if usable(fallback) { return fallback }
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
        guard let text = String(data: data, encoding: .utf8) ?? Self.mostlyUTF8(data) ?? String(data: data, encoding: gb18030)
        else { return nil }
        // （按字节查 \r：Swift 里 \r\n 是一个字符，按字符查找不到单独的 \r）
        return text.utf8.contains(13) ? Self.normalizeNewlines(text) : text
    }

    /// 大体是 UTF-8、只有个别坏字节（比如传输时损坏）的文件：按 UTF-8 读，坏字节换成 �。
    /// 按比例判断：GB18030 这类别的编码，几乎每个非 ASCII 字节在 UTF-8 里都是坏的；损坏的 UTF-8 只坏一小部分。
    /// 坏的超过非 ASCII 字节的一成，就不是 UTF-8，返回 nil。（只看个数不行：短的 GB18030 文件只有一两个“坏字节”）
    static func mostlyUTF8(_ data: Data) -> String? {
        let text = String(decoding: data, as: UTF8.self)
        let bad = text.unicodeScalars.reduce(0) { $0 + ($1 == "\u{FFFD}" ? 1 : 0) }
        let nonASCII = data.reduce(0) { $0 + ($1 >= 0x80 ? 1 : 0) }
        return bad * 10 <= nonASCII ? text : nil
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
            do {
                try fm.moveItem(at: temp, to: to)
            } catch {
                try? fm.moveItem(at: temp, to: from) // 第二步失败：改回原来的名字，不能留在隐藏的临时名字上
                throw error
            }
        } else {
            try fm.moveItem(at: from, to: to)
        }
    }
}
