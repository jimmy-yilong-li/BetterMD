import BetterMDCore
import SwiftUI

extension Notification.Name {
    /// 菜单「搜索」（⌘F）/「搜索全部」（⌘⇧F）：让列表顶部的搜索框获得焦点。
    static let focusSearch = Notification.Name("BetterMD.focusSearch")
}

/// 中间的笔记列表：顶部是搜索框和新建按钮，下面是范围的名字和篇数、文件夹里的标签筛选，然后是一篇篇笔记。
struct NoteListView: View {
    @Environment(AppModel.self) private var model
    @Environment(WindowState.self) private var window
    @FocusState private var searchFocused: Bool
    @FocusState private var listFocused: Bool

    var body: some View {
        let notes = model.visibleNotes
        let terms = SearchText.terms(model.query)
        VStack(spacing: 0) {
            ScopeHeader(count: notes.count, terms: terms)
            if !model.chipTags.isEmpty && !(model.searchAll && !terms.isEmpty) {
                TagChips(tags: model.chipTags)
            }
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(notes.enumerated()), id: \.element.id) { index, note in
                            let selected = note.id == model.selectedID
                            let previousSelected = index > 0 && notes[index - 1].id == model.selectedID
                            NoteRow(note: note, location: location(of: note, searching: !terms.isEmpty), terms: terms,
                                    selected: selected, separator: index > 0 && !selected && !previousSelected)
                                .id(note.id)
                                .onTapGesture {
                                    listFocused = true
                                    model.select(note.id)
                                }
                                .contextMenu { NoteMenu(note: note) }
                                .transition(.asymmetric(insertion: .move(edge: .top).combined(with: .opacity), removal: .opacity))
                        }
                    }
                    .padding(EdgeInsets(top: 2, leading: 8, bottom: 14, trailing: 8))
                    .animation(Motion.list, value: notes.map(\.id))
                }
                .scrollContentBackground(.hidden)
                .focusable()
                .focusEffectDisabled()
                .focused($listFocused)
                .onKeyPress(.upArrow) { step(-1, in: notes) }
                .onKeyPress(.downArrow) { step(1, in: notes) }
                .onChange(of: model.selectedID) { _, id in
                    guard let id else { return }
                    withAnimation(Motion.quick) { proxy.scrollTo(id) }
                }
            }
            .overlay {
                if notes.isEmpty { EmptyList(terms: terms) }
            }
        }
        .background(PaperBackground(color: Ink.listPaper).ignoresSafeArea())
        .overlay(alignment: .trailing) { EditorShadow() }
        .toolbar {
            // 专注模式里列表收起来了，它的搜索框和新建按钮也一起藏起来
            if !window.focusMode {
                ToolbarItem {
                    SearchField(text: Bindable(model).query, focused: $searchFocused)
                        .frame(width: 236)
                }
                .sharedBackgroundVisibility(.hidden) // 用自己凹进纸面的样子，不要工具栏的玻璃底
                ToolbarItem {
                    Button { model.newNote() } label: { Label("新建笔记", systemImage: "square.and.pencil") }
                        .help("新建笔记（⌘N）")
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .focusSearch)) { note in
            if note.object as? Bool == true { model.searchAll = true }
            searchFocused = true
        }
    }

    /// ↑ ↓ 换一篇。
    private func step(_ offset: Int, in notes: [Note]) -> KeyPress.Result {
        guard !notes.isEmpty else { return .ignored }
        let current = notes.firstIndex { $0.id == model.selectedID } ?? (offset > 0 ? -1 : notes.count)
        let next = min(max(current + offset, 0), notes.count - 1)
        model.select(notes[next].id)
        return .handled
    }

    /// 每篇笔记旁边显示的位置：搜全部时总是显示；否则就在当前文件夹里时不显示。
    private func location(of note: Note, searching: Bool) -> String? {
        if searching && model.searchAll {
            return note.folder.isEmpty ? "未分类" : note.folder.replacingOccurrences(of: "/", with: " / ")
        }
        return LibraryIndex.locationLabel(for: note, in: model.scope)
    }
}

/// 范围的名字（宋体）和一行说明：多少篇；搜索时说明在哪里搜、搜到几篇，并能一键切换“只搜这里 / 搜全部”。
private struct ScopeHeader: View {
    @Environment(AppModel.self) private var model
    let count: Int
    let terms: [String]

    var body: some View {
        let title = LibraryIndex.scopeTitle(model.scope)
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(Ink.serif(20, bold: true))
                .foregroundStyle(Ink.text)
                .lineLimit(1)
            HStack(spacing: 4) {
                if terms.isEmpty {
                    Text([LibraryIndex.scopeDescription(model.scope), "\(count) 篇"].compactMap { $0 }.joined(separator: " · "))
                } else {
                    let query = model.query.trimmingCharacters(in: .whitespaces)
                    if model.searchAll || model.scope == .all {
                        Text("搜索「\(query)」· 全部笔记里有 \(count) 篇")
                        if model.searchAll && model.scope != .all {
                            Text("·")
                            LinkButton("只搜「\(title)」") { model.searchAll = false }
                        }
                    } else {
                        Text("搜索「\(query)」·「\(title)」里有 \(count) 篇 ·")
                        LinkButton("搜全部") { model.searchAll = true }
                    }
                }
            }
            .font(.system(size: 12))
            .foregroundStyle(Ink.text3)
            .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(EdgeInsets(top: 6, leading: 18, bottom: 10, trailing: 18))
    }
}

/// 文件夹里的一排标签筛选：只列一级标签，点了包含它的下级标签。
private struct TagChips: View {
    @Environment(AppModel.self) private var model
    let tags: [String]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                chip("全部", on: model.tagFilter == nil) { model.tagFilter = nil }
                ForEach(tags, id: \.self) { tag in
                    chip("#" + tag, on: model.tagFilter == tag) { model.tagFilter = model.tagFilter == tag ? nil : tag }
                }
            }
            .padding(.horizontal, 16)
        }
        .mask(LinearGradient(stops: [.init(color: .black, location: 0.9), .init(color: .clear, location: 1)],
                             startPoint: .leading, endPoint: .trailing))
        .padding(.bottom, 10)
    }

    private func chip(_ label: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: { withAnimation(Motion.quick) { action() } }) {
            Text(label)
                .font(.system(size: 12))
                .foregroundStyle(on ? Color.white : Ink.text2)
                .padding(.horizontal, 10)
                .frame(height: 24)
                .background(Capsule().fill(on ? Ink.accent : Ink.field))
                .overlay(Capsule().strokeBorder(Color.white.opacity(on ? 0.22 : 0), lineWidth: 0.5))
        }
        .buttonStyle(PressableStyle())
    }
}

/// 列表空的时候：说明为什么空，给出下一步。
private struct EmptyList: View {
    @Environment(AppModel.self) private var model
    let terms: [String]

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 28, weight: .light)).opacity(0.55)
            Text(message)
            if let action { LinkButton(action.label, action: action.run) }
        }
        .font(.system(size: 13))
        .foregroundStyle(Ink.text3)
        .multilineTextAlignment(.center)
        .padding(.horizontal, 20)
        .frame(maxHeight: .infinity, alignment: .top)
        .padding(.top, 72)
    }

    private var icon: String {
        if !terms.isEmpty { return "magnifyingglass" }
        switch model.scope {
        case .todo: return "checkmark.circle"
        case .trash: return "trash"
        default: return "square.and.pencil"
        }
    }

    private var message: String {
        if !terms.isEmpty { return "没有找到「\(model.query.trimmingCharacters(in: .whitespaces))」" }
        switch model.scope {
        case .todo: return "待办都勾完了"
        case .trash: return "废纸篓是空的"
        default: return "这里还没有笔记"
        }
    }

    private var action: (label: String, run: () -> Void)? {
        if !terms.isEmpty {
            return model.searchAll || model.scope == .all ? nil : ("搜全部笔记", { model.searchAll = true })
        }
        switch model.scope {
        case .todo, .trash: return nil
        default: return ("新建一篇", { model.newNote() })
        }
    }
}

/// 凹进纸面的搜索框，带清除按钮；Esc 清空并退出。
struct SearchField: View {
    @Binding var text: String
    var focused: FocusState<Bool>.Binding

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass").font(.system(size: 12, weight: .medium)).foregroundStyle(Ink.text3)
            TextField("搜索", text: $text)
                .textFieldStyle(.plain)
                .font(.system(size: 13, weight: .regular))
                .foregroundStyle(Ink.text)
                .focused(focused)
                .onExitCommand {
                    text = ""
                    focused.wrappedValue = false
                }
            if !text.isEmpty {
                Button { text = "" } label: {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 13)).foregroundStyle(Ink.text3)
                }
                .buttonStyle(.plain)
                .help("清除")
            }
        }
        .padding(.horizontal, 10)
        .frame(height: 28)
        .background(
            Capsule().fill(Ink.field)
                .overlay(Capsule().stroke(Color.black.opacity(0.07), lineWidth: 1).blur(radius: 0.6).offset(y: 0.6).mask(Capsule()))
        )
    }
}

/// 朱砂色的文字链接。
struct LinkButton: View {
    let label: String
    let action: () -> Void

    init(_ label: String, action: @escaping () -> Void) {
        self.label = label
        self.action = action
    }

    var body: some View {
        Button(action: action) { Text(label).foregroundStyle(Ink.accent) }
            .buttonStyle(.plain)
            .pointerStyle(.link)
    }
}

/// 编辑区像一张纸压在列表上：列表右边缘一道软投影。
private struct EditorShadow: View {
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        LinearGradient(colors: [.clear, Color(red: 70 / 255, green: 45 / 255, blue: 20 / 255).opacity(scheme == .dark ? 0.35 : 0.12)],
                       startPoint: .leading, endPoint: .trailing)
            .frame(width: 10)
            .allowsHitTesting(false)
    }
}
