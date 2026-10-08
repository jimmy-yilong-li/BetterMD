import Foundation
import Observation

/// 界面用的状态和操作。改文件的事都交给 NoteStore；这里管内存里的列表、选中、什么时候保存。
@MainActor
@Observable
public final class AppModel {
    public private(set) var store: NoteStore
    public private(set) var notes: [Note] = [] {
        didSet { notesVersion &+= 1 }
    }
    /// notes 每改一次加一。列表、标签树按它判断缓存还能不能用；它本身是被观察的，界面读缓存时也会跟着它刷新。
    private var notesVersion = 0
    public private(set) var folders: [String] = []
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
    public private(set) var selectedID: Note.ID?
    /// 刚用 ⌘N 新建、还没离开过的笔记：编辑器打开它时直接选中标题，接着就能打字。
    public private(set) var freshNoteID: Note.ID?
    public var lastError: String?
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

    public init(root: URL) {
        store = NoteStore(root: root)
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
    @ObservationIgnored private var tagTreeCache: (version: Int, tree: [TagNode])?
    /// 文件夹里那一排标签筛选；不在文件夹视图里时是空的。
    public var chipTags: [String] {
        if case .folder = scope { return LibraryIndex.chipTags(notes, in: scope) }
        return []
    }
    public var folderTree: [FolderNode] { LibraryIndex.folderTree(folders) }
    public var tagTree: [TagNode] {
        if let cached = tagTreeCache, cached.version == notesVersion { return cached.tree }
        let tree = LibraryIndex.tagTree(notes)
        tagTreeCache = (notesVersion, tree)
        return tree
    }
    public var selectedNote: Note? { selectedID.flatMap { id in notes.first { $0.id == id } } }

    // MARK: - 读取

    /// 读入整个笔记库。第一次打开空库时放一篇欢迎笔记。重新读取时，同一路径的笔记沿用原来的 id。
    public func load() {
        do {
            try store.prepare()
            let previous = Dictionary(notes.map { ($0.path, $0) }, uniquingKeysWith: { first, _ in first })
            var snapshot = try store.load(reusing: previous)
            if snapshot.notes.isEmpty && !snapshot.state.welcomed {
                snapshot.notes.append(try store.createNote(text: Self.welcomeText, inFolder: ""))
                snapshot.state.welcomed = true
                try store.saveState(snapshot.state)
            }
            // 还没存下的改动（比如保存失败了）不能被磁盘上的旧版本盖掉
            var loaded = snapshot.notes
            for note in notes where dirty.contains(note.id) {
                if let k = loaded.firstIndex(where: { $0.id == note.id }) {
                    loaded[k].text = note.text
                    loaded[k].modified = note.modified
                } else {
                    loaded.append(note) // 文件在外面被删了：留着，下次保存时重新建
                }
            }
            notes = loaded
            folders = snapshot.folders
            state = snapshot.state
            keepSelectionVisible()
        } catch {
            lastError = "读取笔记失败：\(error.localizedDescription)"
        }
    }

    /// 回到 App 时重新读一遍（别的程序可能改过文件）。先把没保存的写下去。
    public func reload() {
        flushPendingSave()
        load()
    }

    /// 换一个目录当「我的笔记」。
    public func switchLibrary(to root: URL) {
        finishAll()
        store = NoteStore(root: root)
        notes = []
        folders = []
        state = LibraryState()
        selectedID = nil
        freshNoteID = nil
        titleWhenOpened = [:]
        leftTitles = [:]
        load()
    }

    /// 退出 App、换笔记库之前：存下所有改动，正在看的这篇标题改过就改文件名。
    public func finishAll() {
        if let id = selectedID {
            finishEditing(id)
            if let note = notes.first(where: { $0.id == id }) { titleWhenOpened[id] = note.parsed.title }
        }
        flushPendingSave()
    }

    // MARK: - 编辑

    public func select(_ id: Note.ID?) {
        guard id != selectedID else { return }
        if let previous = selectedID { finishEditing(previous) }
        freshNoteID = nil
        selectedID = id
        if let id, let note = notes.first(where: { $0.id == id }) {
            titleWhenOpened[id] = note.parsed.title
        }
    }

    /// 编辑器里的文字变了：先改内存，停顿一会儿再写盘。
    public func updateText(_ text: String, for id: Note.ID) {
        guard let i = index(of: id), notes[i].text != text else { return }
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
            if case .folder(let current) = scope { scope = .folder(swap(current)) }
        } catch {
            lastError = "重命名文件夹失败：\(error.localizedDescription)"
        }
    }

    // MARK: - 内部

    /// 移动、进出废纸篓这类操作的共同步骤：先存盘，再改文件，再更新记录和选中。
    private func change(_ id: Note.ID, failure: String, _ operation: (Note) throws -> Note) {
        guard let i = index(of: id) else { return }
        if dirty.remove(id) != nil { save(id) }
        do {
            let before = notes[i]
            let after = try operation(before)
            notes[i] = after
            if !after.isTrashed && !after.folder.isEmpty { ensureFolderListed(after.folder) }
            state.record(from: before, to: after)
            saveState()
            keepSelectionVisible()
        } catch {
            lastError = "\(failure)：\(error.localizedDescription)"
        }
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
            notes[i].modified = try store.write(notes[i])
        } catch {
            dirty.insert(id)
            lastError = "保存失败：\(error.localizedDescription)。改动还在 App 里，之后会再试。"
        }
    }

    private func saveState() {
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
