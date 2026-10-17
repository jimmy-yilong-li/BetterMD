import Foundation
import Observation

/// 界面用的状态和操作。改文件的事都交给 NoteStore；这里管内存里的列表、选中、什么时候保存。
@MainActor
@Observable
public final class AppModel {
    public private(set) var store: NoteStore
    public private(set) var notes: [Note] = [] {
        didSet {
            notesVersion &+= 1
            refreshSelectionFlags()
        }
    }
    /// notes 每改一次加一。列表、标签树按它判断缓存还能不能用；它本身是被观察的，界面读缓存时也会跟着它刷新。
    private var notesVersion = 0
    public private(set) var folders: [String] = []
    /// 绑定：笔记路径 → 项目里的文件（同步由 VS Code 插件做，App 只显示、只在笔记挪动时改路径）
    public private(set) var links: [String: LibraryLinks.Link] = [:]
    public private(set) var state = LibraryState()
    public var scope: Scope = .all {
        didSet {
            guard scope != oldValue else { return }
            tagFilter = nil
            searchAll = false
            keepSelectionVisible()
        }
    }
    public var query = "" {
        didSet {
            guard query != oldValue else { return }
            if SearchText.terms(query).isEmpty { searchAll = false }
            keepSelectionVisible()
        }
    }
    /// 文件夹里那一排标签筛选选中的一级标签；换范围时清掉。只在文件夹视图里起作用。
    public var tagFilter: String? {
        didSet { if tagFilter != oldValue { keepSelectionVisible() } }
    }
    /// 有搜索词时搜全部笔记，而不是只搜侧栏选中的范围；搜索词清空时自动回到 false。
    public var searchAll = false {
        didSet { if searchAll != oldValue { keepSelectionVisible() } }
    }
    public private(set) var selectedID: Note.ID? {
        didSet { refreshSelectionFlags() }
    }
    /// 选中的笔记的几样状态，给菜单栏判断哪些命令能用。只在这几样真变了时才更新：
    /// 菜单读 selectedNote 的话，每打一个字（notes 变了）菜单栏都要重建一次。
    public private(set) var selectionFlags = SelectionFlags()

    public struct SelectionFlags: Equatable, Sendable {
        public var hasNote = false
        public var isTrashed = false
        public var isPinned = false
        /// 选中了笔记，而且能改（不在废纸篓里）
        public var editable: Bool { hasNote && !isTrashed }
    }
    /// 刚用 ⌘N 新建、还没离开过的笔记：编辑器打开它时直接选中标题，接着就能打字。
    public private(set) var freshNoteID: Note.ID?
    /// 要告诉用户的事（出错、另存了别处的版本……），按先后排。界面上不弹框，安静地列在窗口底下，一条条关掉：
    /// 只有一个位置的话，后来的会把前面的盖掉；弹框又会打断打字。
    public private(set) var notices: [String] = []
    /// 最新的一条。设成一句话就是加一条（和上一条一样的不重复加）；设成 nil 是全部清掉。
    public var lastError: String? {
        get { notices.last }
        set {
            guard let newValue else { notices.removeAll(); return }
            if notices.last != newValue { notices.append(newValue) }
        }
    }

    public func dismissNotice(at index: Int) {
        guard notices.indices.contains(index) else { return }
        notices.remove(at: index)
    }
    /// 停止输入多久以后自动保存。
    public var saveDelay: Duration = .milliseconds(600)

    @ObservationIgnored private var dirty: Set<Note.ID> = []
    /// 从什么时候起有没保存的改动。一直不停地打字时，最多隔 maxSaveDelay 也要存一次。
    @ObservationIgnored private var dirtySince: ContinuousClock.Instant?
    /// 连续打字时最长多久存一次。
    public var maxSaveDelay: Duration = .seconds(3)
    /// 离开过的笔记打开时的标题。输入法刚选完的字可能在离开之后才到，那时还要按标题补改文件名。
    @ObservationIgnored private var leftTitles: [Note.ID: String] = [:]
    @ObservationIgnored private var saveTask: Task<Void, Never>?
    /// 打开笔记时的标题；离开时标题变了才改文件名。
    @ObservationIgnored private var titleWhenOpened: [Note.ID: String] = [:]
    /// 编辑器手里那一版正文的来历：打开这篇时 App 给的，或者编辑器最后发来的。编辑器拒收 App 送去的另一版
    /// （它有更新的字没送到、输入法在拼字）时，拿这个判断被拒的那一版是不是编辑器根本没见过的（别处改的）。
    @ObservationIgnored private var editorBase: [Note.ID: String] = [:]
    /// state.json 读不出来时（iCloud 只留了空壳又没网、权限、文件坏了）为 false：这时内存里的状态是空的，不能拿它盖掉原文件
    @ObservationIgnored private var stateReadable = true
    /// 有笔记还在从 iCloud 下载时，过一会儿再读一遍；每等一次，下次多等一倍（最长一分钟），没网时不空转。
    @ObservationIgnored private var downloadCheck: Task<Void, Never>?
    @ObservationIgnored var downloadWait: Duration = .seconds(1)

    public convenience init(root: URL) {
        self.init(store: NoteStore(root: root))
    }

    init(store: NoteStore) {
        self.store = store
    }

    /// 列表里显示的笔记。一次界面刷新会读好几次，按输入缓存：笔记、范围、搜索词、筛选任何一样变了才重算。
    public var visibleNotes: [Note] {
        var tag: String?
        if case .folder = scope, let filter = tagFilter, chipTags.contains(filter) { tag = filter }
        let key = VisibleKey(notes: notesVersion, scope: scope, query: query, tag: tag, searchAll: searchAll)
        if let cached = visibleCache, cached.key == key { return cached.notes }
        let result = LibraryIndex.visible(notes, scope: scope, query: query, tag: tag, searchAll: searchAll)
        visibleCache = (key, result)
        return result
    }

    private struct VisibleKey: Equatable {
        var notes: Int
        var scope: Scope
        var query: String
        var tag: String?
        var searchAll: Bool
    }

    @ObservationIgnored private var visibleCache: (key: VisibleKey, notes: [Note])?
    @ObservationIgnored private var tagTreeCache: (structure: Int, tree: [TagNode])?
    /// 文件夹里那一排标签筛选；不在文件夹视图里时是空的。只在标签或路径变了时重算。
    public var chipTags: [String] {
        guard case .folder = scope else { return [] }
        let key = ChipKey(scope: scope, structure: structureSignature)
        if let cached = chipCache, cached.key == key { return cached.tags }
        let tags = LibraryIndex.chipTags(notes, in: scope)
        chipCache = (key, tags)
        return tags
    }

    private struct ChipKey: Equatable {
        var scope: Scope
        var structure: Int
    }

    @ObservationIgnored private var chipCache: (key: ChipKey, tags: [String])?
    @ObservationIgnored private var signatureCache: (version: Int, value: Int)?

    /// 所有笔记的路径和标签算出的指纹：只改正文、标签没变时不变，标签树和标签筛选就不用重算。
    private var structureSignature: Int {
        if let cached = signatureCache, cached.version == notesVersion { return cached.value }
        var hasher = Hasher()
        for note in notes {
            hasher.combine(note.path)
            hasher.combine(note.parsed.tags)
        }
        let value = hasher.finalize()
        signatureCache = (notesVersion, value)
        return value
    }
    public var folderTree: [FolderNode] { LibraryIndex.folderTree(folders) }
    public var tagTree: [TagNode] {
        let structure = structureSignature
        if let cached = tagTreeCache, cached.structure == structure { return cached.tree }
        let tree = LibraryIndex.tagTree(notes)
        tagTreeCache = (structure, tree)
        return tree
    }
    public var selectedNote: Note? { selectedID.flatMap { id in notes.first { $0.id == id } } }

    private func refreshSelectionFlags() {
        let note = selectedNote
        let flags = SelectionFlags(hasNote: note != nil, isTrashed: note?.isTrashed ?? false, isPinned: note?.isPinned ?? false)
        if flags != selectionFlags { selectionFlags = flags }
    }

    // MARK: - 读取

    /// 读入整个笔记库。第一次打开空库时放一篇欢迎笔记。重新读取时，同一路径的笔记沿用原来的 id。
    public func load() {
        do {
            try store.prepare()
            let previous = Dictionary(notes.map { ($0.path, $0) }, uniquingKeysWith: { first, _ in first })
            var snapshot = try store.load(reusing: previous)
            // 笔记还在从 iCloud 下载时，库不是空的，不能放欢迎笔记
            if snapshot.notes.isEmpty && snapshot.downloading == 0 && !snapshot.state.welcomed {
                snapshot.notes.append(try store.createNote(text: Self.welcomeText, inFolder: ""))
                snapshot.state.welcomed = true
                try store.saveState(snapshot.state)
            }
            // 还没存下的改动（比如保存失败了）不能被磁盘上的旧版本盖掉。这几篇记下的磁盘版本（disk）也不换：
            // 磁盘上的要是在别处改过，保存时才认得出来
            var loaded = snapshot.notes
            for note in notes where dirty.contains(note.id) {
                if let k = loaded.firstIndex(where: { $0.id == note.id }) {
                    loaded[k].text = note.text
                    loaded[k].modified = note.modified
                    loaded[k].disk = note.disk
                } else {
                    loaded.append(note) // 文件在外面被删了：留着，下次保存时重新建
                }
            }
            let firstLoad = notes.isEmpty
            if snapshot.stateReadable {
                state = snapshot.state
                stateReadable = true
            } else if firstLoad {
                // 一开始就读不出来：先用空状态，但不拿它去盖原文件（见 saveState）
                state = LibraryState()
                stateReadable = false
                lastError = "置顶等状态（.bettermd/state.json）暂时读不出来，先不改它；读得出来以后会接着用。"
            } else {
                // 之前读得出来、这次一时读不出来：接着用内存里的
                for k in loaded.indices {
                    loaded[k].isPinned = state.pinned.contains(loaded[k].path)
                    loaded[k].originalFolder = state.trashOrigins[loaded[k].path]
                }
            }
            notes = loaded
            folders = snapshot.folders
            links = LibraryLinks(root: store.root).byNote()
            pruneState(downloading: snapshot.downloading)
            // 重新读取只在选中的那篇没了时才换选中：别的文件变了不能把编辑器换到另一篇（接着打的字会进那一篇）
            if let id = selectedID, !notes.contains(where: { $0.id == id }) { keepSelectionVisible() }
            if selectedID == nil { keepSelectionVisible() }
            waitForDownloads(snapshot.downloading)
        } catch {
            lastError = "读取笔记失败：\(error.localizedDescription)"
        }
    }

    /// 有笔记还在从 iCloud 下载：过一会儿再读一遍，下好的就出现在列表里。
    private func waitForDownloads(_ count: Int) {
        guard count > 0 else {
            downloadCheck?.cancel()
            downloadCheck = nil
            downloadWait = .seconds(1)
            return
        }
        guard downloadCheck == nil else { return }
        let wait = downloadWait
        downloadWait = min(wait * 2, .seconds(60))
        downloadCheck = Task { [weak self] in
            try? await Task.sleep(for: wait)
            guard !Task.isCancelled, let self else { return }
            self.downloadCheck = nil
            self.load()
        }
    }

    /// 「我的笔记」里有文件变了（文件监听报来的绝对路径）。是别的程序改的（VS Code、Finder、git），就重新读一遍；
    /// 是 App 自己刚写的（文件的修改时间和大小和内存里一样）就不管，免得每存一次都重读。返回是否重新读了。
    /// `mustRescan`：系统来不及一个个报（丢了事件），只说“这个文件夹里有变化”，这时直接重新读。
    @discardableResult
    public func filesChanged(_ paths: [String], mustRescan: Bool = false) -> Bool {
        // 笔记库的路径本身可能是符号链接，系统报来的是解开以后的真实路径：两种写法都认
        let roots = Set([store.root.standardizedFileURL.path, store.root.resolvingSymlinksInPath().standardizedFileURL.path])
        guard mustRescan || paths.contains(where: { isExternalChange(at: $0, roots: roots) }) else { return false }
        reload()
        return true
    }

    private func isExternalChange(at full: String, roots: Set<String>) -> Bool {
        let path = URL(fileURLWithPath: full).standardizedFileURL.path
        guard let root = roots.first(where: { path.hasPrefix($0 + "/") }) else { return false }
        let relative = String(path.dropFirst(root.count + 1))
        let parts = relative.split(separator: "/")
        // 隐藏文件（.bettermd 里的状态、改名时的临时名字、.DS_Store）和「附件」不影响笔记
        if parts.contains(where: { $0.hasPrefix(".") }) || parts.first == Substring(LibraryLayout.attachments) { return false }
        let fm = FileManager.default
        var isDirectory: ObjCBool = false
        let exists = fm.fileExists(atPath: path, isDirectory: &isDirectory)
        if relative.lowercased().hasSuffix(".md") && !isDirectory.boolValue {
            guard let note = notes.first(where: { $0.path == relative }) else { return exists } // 外面新建的
            guard exists else { return true } // 外面删掉或挪走的
            // 和上次读、写时记下的时间、大小一样，就是 App 自己写的
            let values = try? URL(fileURLWithPath: path).resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
            guard let disk = note.disk else { return true }
            return values?.contentModificationDate != disk.modified || values?.fileSize != disk.size
        }
        // 文件夹：外面新建了、删掉了
        if relative == LibraryLayout.trash { return false }
        return exists && isDirectory.boolValue ? !folders.contains(relative) : folders.contains(relative)
    }

    /// 回到 App 时重新读一遍（别的程序可能改过文件）。先把没保存的写下去。
    public func reload() {
        flushPendingSave()
        load()
    }

    /// 换一个目录当「我的笔记」。
    @discardableResult
    public func switchLibrary(to root: URL) -> Bool {
        finishAll()
        // 有存不下去的改动就不换：换了以后内存清空，这些改动就找不回来了
        guard dirty.isEmpty else {
            lastError = "有 \(dirty.count) 篇笔记的改动没能存下（\(lastError ?? "保存失败")），先不换笔记库。改动还在 App 里，问题解决后再换。"
            return false
        }
        store = NoteStore(root: root)
        downloadCheck?.cancel()
        downloadCheck = nil
        downloadWait = .seconds(1)
        notes = []
        folders = []
        state = LibraryState()
        stateReadable = true
        // 范围、搜索、筛选回到起点：新库里不一定有原来的那个文件夹（⌘N 会把它建出来）
        scope = .all
        query = ""
        tagFilter = nil
        searchAll = false
        selectedID = nil
        freshNoteID = nil
        titleWhenOpened = [:]
        leftTitles = [:]
        editorBase = [:]
        load()
        return true
    }

    /// 退出 App、换笔记库之前：存下所有改动，正在看的这篇标题改过就改文件名。
    public func finishAll() {
        if let id = selectedID {
            finishEditing(id)
            if let note = notes.first(where: { $0.id == id }) { titleWhenOpened[id] = note.parsed.title }
        }
        flushPendingSave()
    }

    /// 退出时还有存不下去的笔记（比如文件夹没了写权限）：每篇另存一份到 `dir`，返回存下的文件。
    /// 退出拦不住，这是最后一道保险。
    @discardableResult
    public func rescueUnsaved(into dir: URL, now: Date = .now) -> [URL] {
        let unsaved = notes.filter { dirty.contains($0.id) }
        guard !unsaved.isEmpty, (try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)) != nil
        else { return [] }
        let stamp = NoteStore.timestamp(now)
        return unsaved.compactMap { note in
            let target = LibraryLayout.uniqueURL(in: dir, base: LibraryLayout.fileName(forTitle: note.title, suffix: "（\(stamp)）"))
            return (try? Data(note.text.utf8).write(to: target, options: .atomic)) != nil ? target : nil
        }
    }

    // MARK: - 编辑

    public func select(_ id: Note.ID?) {
        guard id != selectedID else { return }
        if let previous = selectedID { finishEditing(previous) }
        freshNoteID = nil
        selectedID = id
        if let id, let note = notes.first(where: { $0.id == id }) {
            titleWhenOpened[id] = note.parsed.title
            editorBase[id] = note.text
        }
    }

    /// 编辑器里的文字变了：先改内存，停顿一会儿再写盘。
    /// `overrodeApp`：编辑器拒收了 App 送去的另一版、重发了自己的（它有更新的字还没送到，或者输入法在拼字）。
    /// App 手里那一版要是编辑器没见过的（别处改的），先另存一份，再接受编辑器的——不然别处的改动就悄悄没了。
    public func updateText(_ text: String, for id: Note.ID, overrodeApp: Bool = false) {
        guard let i = index(of: id) else { return }
        let base = editorBase[id]
        editorBase[id] = text
        if overrodeApp, notes[i].text != text, let base, notes[i].text != base {
            keepCopy(of: notes[i].text, besides: notes[i])
        }
        guard notes[i].text != text else { return }
        notes[i].text = text
        notes[i].modified = .now
        dirty.insert(id)
        if dirtySince == nil { dirtySince = .now }
        if id != selectedID, let opened = leftTitles[id] {
            // 已经离开的笔记晚到的改动（比如输入法刚选完的字）：马上存，并按标题补改文件名
            titleWhenOpened[id] = opened
            finishEditing(id)
            return
        }
        scheduleSave()
    }

    /// 把所有没保存的修改马上写盘。
    public func flushPendingSave() {
        saveTask?.cancel()
        saveTask = nil
        let pending = dirty
        dirty.removeAll()
        for id in pending { save(id) }
        dirtySince = dirty.isEmpty ? nil : .now
    }

    // MARK: - 操作

    /// 按当前范围新建笔记并选中它（规则见 LibraryIndex.folderForNewNote / newNoteText）。
    public func newNote() {
        if scope == .trash { scope = .all }
        do {
            let note = try store.createNote(text: LibraryIndex.newNoteText(for: scope),
                                            inFolder: LibraryIndex.folderForNewNote(in: scope))
            notes.append(note)
            query = ""
            tagFilter = nil
            select(note.id)
            freshNoteID = note.id
        } catch {
            lastError = "新建笔记失败：\(error.localizedDescription)"
        }
    }

    /// 把粘贴、拖进来或选来的文件存进「附件/」；返回从这篇笔记所在文件夹指过去的链接（失败返回 nil）。
    public func addAttachment(_ data: Data, fileName: String, mimeType: String? = nil, for id: Note.ID) -> String? {
        guard let note = notes.first(where: { $0.id == id }) else { return nil }
        do {
            let path = try store.saveAttachment(data, fileName: fileName, mimeType: mimeType)
            return MarkdownLinks.link(from: note.folder, to: path)
        } catch {
            lastError = "保存附件失败：\(error.localizedDescription)"
            return nil
        }
    }

    public func togglePin(_ id: Note.ID) {
        guard let i = index(of: id) else { return }
        let before = notes[i]
        notes[i].isPinned.toggle()
        state.record(from: before, to: notes[i])
        saveState()
    }

    public func move(_ id: Note.ID, toFolder folder: String) {
        change(id, failure: "移动失败") { try self.store.move($0, toFolder: folder) }
    }

    public func trash(_ id: Note.ID) {
        // 正在编辑的这篇：先按新标题改好文件名再进废纸篓（进了废纸篓就不改名了，放回来还是旧名字）
        if titleWhenOpened[id] != nil {
            finishEditing(id)
            if let note = notes.first(where: { $0.id == id }) { titleWhenOpened[id] = note.parsed.title }
        }
        change(id, failure: "移到废纸篓失败") { try self.store.trash($0) }
    }

    public func restore(_ id: Note.ID) {
        change(id, failure: "放回原处失败") { try self.store.restore($0) }
    }

    @discardableResult
    public func newFolder(named name: String, in parent: String) -> String? {
        do {
            let path = try store.createFolder(named: name, in: parent)
            folders.append(path)
            folders.sort { $0.localizedStandardCompare($1) == .orderedAscending }
            return path
        } catch {
            lastError = "新建文件夹失败：\(error.localizedDescription)"
            return nil
        }
    }

    public func renameFolder(_ path: String, to name: String) {
        flushPendingSave()
        do {
            let newPath = try store.renameFolder(path, to: name)
            guard newPath != path else { return }
            let swap = { (p: String) -> String in
                if p == path { return newPath }
                if p.hasPrefix(path + "/") { return newPath + String(p.dropFirst(path.count)) }
                return p
            }
            folders = folders.map(swap).sorted { $0.localizedStandardCompare($1) == .orderedAscending }
            for i in notes.indices {
                notes[i].path = swap(notes[i].path)
                if let origin = notes[i].originalFolder { notes[i].originalFolder = swap(origin) }
            }
            state.folderRenamed(from: path, to: newPath)
            saveState()
            do {
                try LibraryLinks(root: store.root).folderRenamed(from: path, to: newPath)
            } catch {
                lastError = "文件夹里有绑定了项目文件的笔记，绑定没跟着改过来：\(error.localizedDescription)"
            }
            links = LibraryLinks(root: store.root).byNote()
            if case .folder(let current) = scope { scope = .folder(swap(current)) }
        } catch {
            lastError = "重命名文件夹失败：\(error.localizedDescription)"
        }
    }

    // MARK: - 内部

    /// 移动、进出废纸篓这类操作的共同步骤：先存盘，再改文件，再更新记录和选中。
    private func change(_ id: Note.ID, failure: String, _ operation: (Note) throws -> Note) {
        guard let i = index(of: id) else { return }
        if dirty.remove(id) != nil {
            save(id) // 存之前会对一下磁盘上的版本
        } else if let current = store.currentVersion(of: notes[i]), current.stamp.textHash != notes[i].disk?.textHash {
            // 别处刚改过、文件监听还没报上来：先读进来，不然移动时按内存里的旧正文改链接、写下去，就把它盖掉了
            notes[i].text = current.text
            notes[i].disk = current.stamp
        }
        do {
            let before = notes[i]
            let after = try operation(before)
            notes[i] = after
            notePathChanged(from: before.path, to: after.path)
            if !after.isTrashed && !after.folder.isEmpty { ensureFolderListed(after.folder) }
            state.record(from: before, to: after)
            saveState()
            keepSelectionVisible()
        } catch {
            lastError = "\(failure)：\(error.localizedDescription)"
        }
    }

    /// 笔记挪了地方（改名、移动、进出废纸篓）：绑定的登记跟着改，不然 VS Code 插件就找不到这一篇了。
    private func notePathChanged(from old: String, to new: String) {
        guard old != new, links[old] != nil else { return }
        do {
            try LibraryLinks(root: store.root).noteMoved(from: old, to: new)
        } catch {
            lastError = "「\(new)」绑定了项目里的文件，绑定没跟着改过来：\(error.localizedDescription)"
        }
        links = LibraryLinks(root: store.root).byNote()
    }

    /// 放回原处时文件夹可能是重新建的，侧栏里要马上出现它和它的上级。
    private func ensureFolderListed(_ folder: String) {
        var parts: [Substring] = []
        for part in folder.split(separator: "/") {
            parts.append(part)
            let path = parts.joined(separator: "/")
            if !folders.contains(path) { folders.append(path) }
        }
        folders.sort { $0.localizedStandardCompare($1) == .orderedAscending }
    }

    /// 离开一篇笔记：没保存的写下去；这次打开期间标题改了，就把文件名改成新标题。
    private func finishEditing(_ id: Note.ID) {
        if dirty.remove(id) != nil { save(id) }
        let openedTitle = titleWhenOpened.removeValue(forKey: id)
        if let openedTitle { leftTitles[id] = openedTitle }
        guard let i = index(of: id), let openedTitle, openedTitle != notes[i].parsed.title else { return }
        do {
            let before = notes[i]
            let renamed = try store.renameToMatchTitle(before)
            guard renamed.path != before.path else { return }
            notes[i] = renamed
            notePathChanged(from: before.path, to: renamed.path)
            state.record(from: before, to: renamed)
            saveState()
        } catch {
            lastError = "改文件名失败：\(error.localizedDescription)"
        }
    }

    /// 写盘。失败时这篇留在“没保存”里，改动不会被重新读取盖掉，之后还会再试。
    private func save(_ id: Note.ID) {
        guard let i = index(of: id) else { return }
        do {
            keepOutsideVersion(of: i)
            let stamp = try store.write(notes[i])
            notes[i].modified = stamp.modified
            notes[i].disk = stamp
        } catch {
            dirty.insert(id)
            lastError = "保存失败：\(error.localizedDescription)。改动还在 App 里，之后会再试。"
        }
    }

    /// 磁盘上的这篇在别处也改过：先把别处的版本另存一份，再存这里的。
    /// 按内容判断，不按修改时间：只碰了修改时间（touch、git、同步工具）不算；同一秒里改的、大小没变的也认得出。
    /// 另存以后把那一版记成“保住了”：这次写不进去（文件只读）时，下次重试不会再另存一份。
    private func keepOutsideVersion(of i: Int) {
        let note = notes[i]
        guard let known = note.disk, let current = store.currentVersion(of: note),
              current.stamp.textHash != known.textHash, current.text != note.text else { return }
        if keepCopy(of: current.text, besides: note) { notes[i].disk = current.stamp }
    }

    /// 把一版正文另存在这篇旁边，叫「标题（别处的版本）.md」，并告诉用户。返回是否存成了。
    @discardableResult
    private func keepCopy(of text: String, besides note: Note) -> Bool {
        do {
            let copy = try store.saveCopy(text, besides: note, suffix: "别处的版本")
            lastError = "「\(note.title)」在别处也改过（可能是 VS Code 或别的程序）。这里的改动照常保存；别处的版本另存成了「\(copy)」，在同一个文件夹里。"
            return true
        } catch {
            lastError = "「\(note.title)」在别处也改过，想另存别处的版本却没存成（\(error.localizedDescription)）。"
            return false
        }
    }

    /// 置顶、废纸篓来源里记着的笔记已经不在了（在 Finder 里改名、删掉了）：去掉，免得以后同名的新笔记自动置顶。
    /// 还有笔记在从 iCloud 下载、或者状态读不出来时不动。
    private func pruneState(downloading: Int) {
        guard downloading == 0, stateReadable else { return }
        let paths = Set(notes.map(\.path))
        var pruned = state
        pruned.pinned = state.pinned.filter(paths.contains)
        pruned.trashOrigins = state.trashOrigins.filter { paths.contains($0.key) }
        guard pruned != state else { return }
        state = pruned
        saveState()
    }

    private func saveState() {
        if !stateReadable {
            // 上次读不出来，内存里的是空状态：现在读得出来了，就合到原来的上面再写；还是读不出来，就先不写，免得把它盖掉
            let (disk, readable) = store.readState()
            guard readable else { return }
            state = disk.merging(state)
            stateReadable = true
            for i in notes.indices { notes[i].isPinned = state.pinned.contains(notes[i].path) }
        }
        do {
            try store.saveState(state)
        } catch {
            lastError = "保存置顶等状态失败：\(error.localizedDescription)"
        }
    }

    private func scheduleSave() {
        // 一直不停地打字：最多隔 maxSaveDelay 存一次，不能一直往后拖
        if let since = dirtySince, since.duration(to: .now) >= maxSaveDelay {
            flushPendingSave()
            return
        }
        saveTask?.cancel()
        let delay = saveDelay
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            self?.flushPendingSave()
        }
    }

    /// 选中的笔记不在当前列表里了，就改选列表第一篇。
    private func keepSelectionVisible() {
        let visible = visibleNotes
        if let id = selectedID, visible.contains(where: { $0.id == id }) { return }
        select(visible.first?.id)
    }

    private func index(of id: Note.ID) -> Int? {
        notes.firstIndex { $0.id == id }
    }

    static let welcomeText = """
    # 欢迎使用 BetterMD
    #BetterMD

    这是一篇普通的 Markdown 笔记，存在「我的笔记」文件夹里，用任何编辑器都能打开。

    - 左边的文件夹，就是磁盘上真实的文件夹
    - 在正文里写 #想法 这样的标签，左边的「标签」里就会出现它
    - [ ] 按 ⌘N 新建一篇笔记
    """
}
