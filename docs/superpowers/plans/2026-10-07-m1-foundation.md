# BetterMD 第一阶段（基础）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做出一个真正能用的 BetterMD：读写「我的笔记」里的 .md 文件，有文件夹、标签、未分类、待办、废纸篓、中英文搜索和三栏界面；编辑器先用纯文本。

**Architecture:** Swift Package 分两层。`BetterMDCore` 是不依赖界面的库：解析正文（标题、标签、待办、摘要）、搜索、读写文件（NoteStore）、列表和侧栏的计算（LibraryIndex），以及界面状态和操作（AppModel，`@Observable`）。`BetterMD` 是 SwiftUI 可执行程序，只负责显示和把操作转给 AppModel。`scripts/bundle.sh` 把可执行文件装进 `build/BetterMD.app`。

**Tech Stack:** Swift 6.3（Swift 6 语言模式）、SwiftUI、Observation、Foundation、Swift Testing（`swift test`），macOS 26。

**Spec:** [design.md](../../../design.md)

**这一阶段在整个计划里的位置**（见 design.md 第 11 节）：1 基础（本计划）→ 2 编辑器（CodeMirror 6、KaTeX、图片）→ 3 纸墨外观和动效 → 4 整理体验 → 5 同步。本阶段的界面用系统默认样式，纸墨外观在第三阶段做。

## Global Constraints

- 产品名写作 **BetterMD**（B、M、D 大写），文档、界面和代码里都这样写。
- 一个人用，只在这一台 Mac 上用（macOS 26）；最低系统版本 macOS 26。
- 每篇笔记一个 `.md` 文件，文件是唯一数据源；索引只在本机，随时可以从文件重建。
- 「我的笔记」是一个目录。文件夹就是里面的真实子目录；直接放在根目录里的笔记显示为「未分类」；「附件/」「废纸篓/」在根目录下，App 的文件夹树里不显示；「.bettermd/」放置顶等小状态。
- 标题取正文第一行，去掉开头的 `# `。文件名跟着标题走：标题改了，离开这篇笔记时再改文件名；去掉文件名里不能用的字符（如 `/`、`:`），重名时加序号。
- 标签写在正文里：`#标签`，多级标签写成 `#会议/周会`。`#` 后面紧跟文字是标签，`#` 后面跟空格是 Markdown 标题。
- 搜索：子串匹配，不做分词；笔记和查询都先统一大小写和全角半角；多个关键词用空格分开，全部命中才算；标题命中排在正文命中前面，然后按修改时间倒序。
- 新建笔记：放进当前文件夹；在标签视图里新建，就放进「未分类」，并自动带上这个标签。
- 写文件要原子写入。
- 界面文字、代码注释和文档都用中文。

## Review Focus

1. **别的程序改了文件**：在 Finder 或别的编辑器里改了、加了笔记，切回 BetterMD 要看到最新内容，正在看的笔记不能跳走。→ Task 8 `reloadSeesOutsideEditsAndKeepsIDs`。
2. **没保存的字**：切换笔记、切到别的 App、退出时，刚打的字必须已经写进文件。→ Task 8 `editsAreSavedAndFileFollowsTitleWhenLeavingNote`、`flushWritesPendingEdits`；Task 9 在失去焦点和退出时调用 `flushPendingSave()`。
3. **读不出来的文件**：不是 UTF-8 的旧文件、损坏的文件不能让 App 崩溃，更不能被清空。→ Task 5 `unreadableFilesAreSkippedAndUntouched`、`gb18030FilesAreReadable`。
4. **改文件名**：标题里有 `/`、`:`、只有空格、和别的笔记重名、只改了大小写时，改名不能失败，也不能覆盖别的笔记；只是看了一眼、没改标题的笔记，不能被改名。→ Task 4、Task 6 的文件名测试；Task 8 `viewingANoteDoesNotRenameIt`。
5. **笔记多的时候**：几千篇笔记时，每次按键搜索不能卡。→ Task 7 `searchStaysFastWithThousandsOfNotes`。

---

## 文件结构

```
Package.swift
App/Info.plist                          App 包的 Info.plist（打包脚本用）
scripts/bundle.sh                       编译并装成 build/BetterMD.app
Sources/BetterMDCore/
  BetterMDInfo.swift                    版本号
  NoteText.swift                        从正文取标题、标签、待办、摘要
  SearchText.swift                      搜索用的折叠、匹配、摘录
  LibraryLayout.swift                   「我的笔记」里的固定位置、文件名规则
  Note.swift                            Note、ParsedNote
  NoteDate.swift                        列表里的时间文字
  LibraryState.swift                    .bettermd/state.json 的内容
  NoteStore.swift                       所有文件读写
  LibraryIndex.swift                    Scope、侧栏树、筛选、排序、搜索
  AppModel.swift                        界面状态和操作（@Observable）
Sources/BetterMD/
  BetterMDApp.swift                     @main、菜单命令
  LibraryLocation.swift                 「我的笔记」放在哪
  ContentView.swift                     三栏
  SidebarView.swift                     侧栏
  NoteListView.swift                    笔记列表
  NoteRow.swift                         列表里的一行
  NoteMenu.swift                        笔记右键菜单
  EditorView.swift                      纯文本编辑器
Tests/BetterMDCoreTests/
  SmokeTests.swift
  TestSupport.swift
  NoteTextTests.swift
  SearchTextTests.swift
  NoteTests.swift
  NoteStoreLoadTests.swift
  NoteStoreOperationTests.swift
  LibraryIndexTests.swift
  AppModelTests.swift
```

所有提交命令都在项目根目录里执行。

---

### Task 1: 项目骨架和打包脚本

**Files:**
- Create: `Package.swift`
- Create: `Sources/BetterMDCore/BetterMDInfo.swift`
- Create: `Sources/BetterMD/BetterMDApp.swift`
- Create: `Tests/BetterMDCoreTests/SmokeTests.swift`
- Create: `App/Info.plist`
- Create: `scripts/bundle.sh`
- Create: `.gitignore`
- Modify: `CLAUDE.md`（末尾加“开发命令”一节）

**Interfaces:**
- Consumes: 无
- Produces: 模块 `BetterMDCore`、可执行目标 `BetterMD`、测试目标 `BetterMDCoreTests`；`public enum BetterMDInfo { public static let version: String }`；`scripts/bundle.sh [debug|release]` 输出 `build/BetterMD.app`

- [ ] **Step 1: 建 git 仓库**

```bash
cd bettermd
git init -b main
```

- [ ] **Step 2: 写 `.gitignore`**

```gitignore
.build/
build/
.swiftpm/
.superpowers/
.DS_Store
```

- [ ] **Step 3: 写 `Package.swift`**

```swift
// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "BetterMD",
    platforms: [.macOS("26.0")],
    products: [
        .executable(name: "BetterMD", targets: ["BetterMD"]),
    ],
    targets: [
        .target(name: "BetterMDCore"),
        .executableTarget(name: "BetterMD", dependencies: ["BetterMDCore"]),
        .testTarget(name: "BetterMDCoreTests", dependencies: ["BetterMDCore"]),
    ]
)
```

- [ ] **Step 4: 写一个还没有版本号的 `BetterMDInfo`，和一个最小的 App**

`Sources/BetterMDCore/BetterMDInfo.swift`：

```swift
/// BetterMD 的基本信息。
public enum BetterMDInfo {}
```

`Sources/BetterMD/BetterMDApp.swift`：

```swift
import AppKit
import BetterMDCore
import SwiftUI

@main
struct BetterMDApp: App {
    init() {
        // 用 swift run 直接启动时也要像普通 App 一样出现在程序坞里。
        NSApplication.shared.setActivationPolicy(.regular)
    }

    var body: some Scene {
        WindowGroup("BetterMD") {
            Text("BetterMD")
                .frame(minWidth: 960, minHeight: 600)
        }
    }
}
```

- [ ] **Step 5: 写失败的测试**

`Tests/BetterMDCoreTests/SmokeTests.swift`：

```swift
import Testing
@testable import BetterMDCore

@Test func versionIsSet() {
    #expect(BetterMDInfo.version == "0.1.0")
}
```

- [ ] **Step 6: 运行，确认失败**

Run: `swift test`
Expected: 编译失败，提示 `type 'BetterMDInfo' has no member 'version'`

- [ ] **Step 7: 加上版本号**

`Sources/BetterMDCore/BetterMDInfo.swift`：

```swift
/// BetterMD 的基本信息。
public enum BetterMDInfo {
    public static let version = "0.1.0"
}
```

- [ ] **Step 8: 运行，确认通过**

Run: `swift test`
Expected: `Test run with 1 test passed`

- [ ] **Step 9: 写 `App/Info.plist`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>BetterMD</string>
    <key>CFBundleDisplayName</key>
    <string>BetterMD</string>
    <key>CFBundleIdentifier</key>
    <string>app.bettermd.BetterMD</string>
    <key>CFBundleExecutable</key>
    <string>BetterMD</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>0.1.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>CFBundleDevelopmentRegion</key>
    <string>zh_CN</string>
    <key>LSMinimumSystemVersion</key>
    <string>26.0</string>
    <key>LSApplicationCategoryType</key>
    <string>public.app-category.productivity</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
```

- [ ] **Step 10: 写打包脚本 `scripts/bundle.sh`**

```bash
#!/usr/bin/env bash
# 把 SwiftPM 编出来的可执行文件装进 build/BetterMD.app，并做本机签名（ad-hoc）。
# 用法：scripts/bundle.sh [debug|release]
set -euo pipefail
cd "$(dirname "$0")/.."
CONFIG="${1:-debug}"
swift build -c "$CONFIG" --product BetterMD
BIN_DIR="$(swift build -c "$CONFIG" --show-bin-path)"
APP="build/BetterMD.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN_DIR/BetterMD" "$APP/Contents/MacOS/BetterMD"
cp App/Info.plist "$APP/Contents/Info.plist"
codesign --force --sign - "$APP" >/dev/null 2>&1
echo "$APP"
```

Run: `chmod +x scripts/bundle.sh && scripts/bundle.sh`
Expected: 最后一行输出 `build/BetterMD.app`

- [ ] **Step 11: 确认 App 能启动**

Run: `open -n build/BetterMD.app`，然后 `pgrep -x BetterMD`
Expected: 输出一个进程号；屏幕上出现写着“BetterMD”的窗口。然后 `pkill -x BetterMD` 关掉它。

- [ ] **Step 12: 在 `CLAUDE.md` 末尾加“开发命令”**

```markdown

## 开发命令

- 跑测试：`swift test`
- 打包成 App：`scripts/bundle.sh`（产物在 `build/BetterMD.app`，`build/` 不进 git）
- 实现计划在 `docs/superpowers/plans/`
```

- [ ] **Step 13: 提交**

```bash
git add -A
git commit -m "chore: 搭好 BetterMD 的 Swift 包骨架和打包脚本" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 从正文取标题、标签、待办和摘要

**Files:**
- Create: `Sources/BetterMDCore/NoteText.swift`
- Test: `Tests/BetterMDCoreTests/NoteTextTests.swift`

**Interfaces:**
- Consumes: 无
- Produces:
  - `NoteText.title(of: String) -> String`
  - `NoteText.tags(in: String) -> [String]`
  - `NoteText.hasOpenTodo(_: String) -> Bool`
  - `NoteText.preview(of: String, limit: Int = 120) -> String`

- [ ] **Step 1: 写失败的测试**

`Tests/BetterMDCoreTests/NoteTextTests.swift`：

```swift
import Testing
@testable import BetterMDCore

struct NoteTextTests {
    @Test func titleStripsHeadingMarker() {
        #expect(NoteText.title(of: "# 傅里叶变换笔记\n\n正文") == "傅里叶变换笔记")
    }

    @Test func titleSkipsBlankLinesAndKeepsPlainFirstLine() {
        #expect(NoteText.title(of: "\n\n买菜清单\n- [ ] 鸡蛋") == "买菜清单")
    }

    @Test func titleOfEmptyNoteIsEmpty() {
        #expect(NoteText.title(of: "  \n") == "")
    }

    @Test func tagsFindChineseNestedAndEnglishTags() {
        #expect(NoteText.tags(in: "# 标题\n#数学 #会议/周会 and #todo.\n") == ["数学", "会议/周会", "todo"])
    }

    @Test func tagsIgnoreHeadingsCodeAndURLs() {
        let text = "## 小标题\n`#不是标签` https://a.com/#anchor\n```\n#也不是\n```\n真的#不算 #是"
        #expect(NoteText.tags(in: text) == ["是"])
    }

    @Test func tagsStopAtChinesePunctuation() {
        #expect(NoteText.tags(in: "看这里 #想法，然后") == ["想法"])
    }

    @Test func tagsAreDeduplicatedAndTrimmed() {
        #expect(NoteText.tags(in: "#a #b #a #c/") == ["a", "b", "c"])
    }

    @Test func openTodoDetection() {
        #expect(NoteText.hasOpenTodo("- [x] 完成\n- [ ] 没完成"))
        #expect(!NoteText.hasOpenTodo("- [x] 完成"))
        #expect(!NoteText.hasOpenTodo("```\n- [ ] 代码里的\n```"))
    }

    @Test func previewSkipsTitleAndTagLinesAndStripsMarkdown() {
        let text = "# 标题\n#数学 #想法\n**核心思想**：看 [链接](https://x.com)\n- [ ] 待办"
        #expect(NoteText.preview(of: text) == "核心思想：看 链接 ☐ 待办")
    }

    @Test func previewIsLimited() {
        let text = "# t\n" + String(repeating: "字", count: 300)
        #expect(NoteText.preview(of: text, limit: 10).count == 10)
    }
}
```

- [ ] **Step 2: 运行，确认失败**

Run: `swift test --filter NoteTextTests`
Expected: 编译失败，提示 `cannot find 'NoteText' in scope`

- [ ] **Step 3: 实现**

`Sources/BetterMDCore/NoteText.swift`：

```swift
import Foundation

/// 从笔记的 Markdown 原文里取出标题、标签、待办状态和列表摘要。
public enum NoteText {
    /// 第一行非空文字；是 Markdown 标题时去掉开头的 `#` 和空格。空笔记返回 ""。
    public static func title(of text: String) -> String {
        for raw in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty { continue }
            let hashes = line.prefix(while: { $0 == "#" })
            if !hashes.isEmpty && hashes.count <= 6 {
                let rest = line.dropFirst(hashes.count)
                if rest.isEmpty || rest.first == " " {
                    return rest.trimmingCharacters(in: .whitespaces)
                }
            }
            return line
        }
        return ""
    }

    /// 正文里的 `#标签`，按出现顺序去重。跳过 Markdown 标题、代码块和行内代码；
    /// `#` 前面必须是行首或空白，所以网址里的 `#` 不算。
    public static func tags(in text: String) -> [String] {
        var result: [String] = []
        var seen = Set<String>()
        var inFence = false
        for raw in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = String(raw)
            if isFence(line) { inFence.toggle(); continue }
            if inFence { continue }
            for tag in tagsInLine(removingInlineCode(line)) where seen.insert(tag).inserted {
                result.append(tag)
            }
        }
        return result
    }

    /// 有没有还没勾掉的待办（`- [ ]`、`* [ ]`、`+ [ ]`）；代码块里的不算。
    public static func hasOpenTodo(_ text: String) -> Bool {
        var inFence = false
        for raw in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = String(raw)
            if isFence(line) { inFence.toggle(); continue }
            if inFence { continue }
            let t = line.trimmingCharacters(in: .whitespaces)
            if t.hasPrefix("- [ ]") || t.hasPrefix("* [ ]") || t.hasPrefix("+ [ ]") { return true }
        }
        return false
    }

    /// 列表里显示的摘要：跳过标题行和只有标签的行，去掉 Markdown 符号，最多 `limit` 个字符。
    public static func preview(of text: String, limit: Int = 120) -> String {
        var parts: [String] = []
        var length = 0
        var skippedTitle = false
        for raw in text.split(separator: "\n") {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty || isFence(line) { continue }
            if !skippedTitle { skippedTitle = true; continue }
            if isTagOnlyLine(line) { continue }
            let plainLine = plain(line)
            if plainLine.isEmpty { continue }
            parts.append(plainLine)
            length += plainLine.count
            if length >= limit { break }
        }
        let joined = parts.joined(separator: " ")
        return joined.count > limit ? String(joined.prefix(limit)) : joined
    }

    // MARK: - 内部

    static func isFence(_ line: String) -> Bool {
        let t = line.trimmingCharacters(in: .whitespaces)
        return t.hasPrefix("```") || t.hasPrefix("~~~")
    }

    /// 标签遇到这些字符就结束。
    static let tagTerminators: Set<Character> = [
        "#", ",", ";", ":", "!", "?", "(", ")", "[", "]", "\"", "'",
        "，", "。", "、", "；", "：", "！", "？", "（", "）", "【", "】", "「", "」", "“", "”",
    ]

    static func tagsInLine(_ line: String) -> [String] {
        let chars = Array(line)
        var tags: [String] = []
        var i = 0
        while i < chars.count {
            guard chars[i] == "#", i == 0 || chars[i - 1].isWhitespace else {
                i += 1
                continue
            }
            var j = i + 1
            while j < chars.count, !chars[j].isWhitespace, !tagTerminators.contains(chars[j]) { j += 1 }
            var tag = String(chars[(i + 1)..<j])
            while let last = tag.last, last == "." || last == "/" { tag.removeLast() }
            while tag.first == "/" { tag.removeFirst() }
            if !tag.isEmpty { tags.append(tag) }
            i = max(j, i + 1)
        }
        return tags
    }

    static func removingInlineCode(_ line: String) -> String {
        var out = ""
        var inCode = false
        for ch in line {
            if ch == "`" {
                inCode.toggle()
                out.append(" ")
                continue
            }
            out.append(inCode ? " " : ch)
        }
        return out
    }

    static func isTagOnlyLine(_ line: String) -> Bool {
        let words = line.split(whereSeparator: \.isWhitespace)
        return !words.isEmpty && words.allSatisfy { $0.hasPrefix("#") } && !tagsInLine(line).isEmpty
    }

    static func plain(_ line: String) -> String {
        var s = line
        if let r = s.range(of: #"^(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)"#, options: .regularExpression) {
            let marker = String(s[r])
            s.removeSubrange(r)
            if marker.contains("[ ]") {
                s = "☐ " + s
            } else if marker.lowercased().contains("[x]") {
                s = "☑ " + s
            }
        }
        s = s.replacingOccurrences(of: #"!\[([^\]]*)\]\([^)]*\)"#, with: "$1", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\[([^\]]+)\]\([^)]*\)"#, with: "$1", options: .regularExpression)
        for token in ["**", "__", "~~", "`"] {
            s = s.replacingOccurrences(of: token, with: "")
        }
        return s.trimmingCharacters(in: .whitespaces)
    }
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `swift test --filter NoteTextTests`
Expected: 10 个测试全部通过

- [ ] **Step 5: 提交**

```bash
git add Sources/BetterMDCore/NoteText.swift Tests/BetterMDCoreTests/NoteTextTests.swift
git commit -m "feat: 从正文取标题、标签、待办和摘要" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 搜索的折叠、匹配和摘录

**Files:**
- Create: `Sources/BetterMDCore/SearchText.swift`
- Test: `Tests/BetterMDCoreTests/SearchTextTests.swift`

**Interfaces:**
- Consumes: 无
- Produces:
  - `SearchText.fold(_: String) -> String`
  - `SearchText.terms(_ query: String) -> [String]`（已经折叠过）
  - `SearchText.matches(_ foldedText: String, terms: [String]) -> Bool`
  - `SearchText.snippet(of: String, terms: [String], before: Int = 12, length: Int = 80) -> String?`

- [ ] **Step 1: 写失败的测试**

`Tests/BetterMDCoreTests/SearchTextTests.swift`：

```swift
import Testing
@testable import BetterMDCore

struct SearchTextTests {
    @Test func foldingIgnoresCaseWidthAndDiacritics() {
        #expect(SearchText.fold("ＳｅａｒＣＨ Café") == "search cafe")
    }

    @Test func chineseSubstringMatchesWithoutSegmentation() {
        let key = SearchText.fold("私有云同步方案")
        #expect(SearchText.matches(key, terms: SearchText.terms("同步")))
        #expect(SearchText.matches(key, terms: SearchText.terms("云同")))
    }

    @Test func allTermsMustMatch() {
        let key = SearchText.fold("BetterMD 界面设计 sync")
        #expect(SearchText.matches(key, terms: SearchText.terms("界面 SYNC")))
        #expect(!SearchText.matches(key, terms: SearchText.terms("界面 同步")))
    }

    @Test func emptyQueryHasNoTerms() {
        #expect(SearchText.terms("  \n ").isEmpty)
    }

    @Test func snippetShowsTextAroundFirstHit() {
        let text = String(repeating: "前", count: 30) + "同步方案" + String(repeating: "后", count: 30)
        let snippet = SearchText.snippet(of: text, terms: SearchText.terms("同步"), before: 5, length: 12)
        #expect(snippet == "…前前前前前同步方案后后后")
    }

    @Test func snippetIsNilWithoutHit() {
        #expect(SearchText.snippet(of: "abc", terms: ["zzz"]) == nil)
    }
}
```

- [ ] **Step 2: 运行，确认失败**

Run: `swift test --filter SearchTextTests`
Expected: 编译失败，提示 `cannot find 'SearchText' in scope`

- [ ] **Step 3: 实现**

`Sources/BetterMDCore/SearchText.swift`：

```swift
import Foundation

/// 关键词搜索：统一大小写、全角半角和变音符号以后做子串匹配，不分词。
public enum SearchText {
    public static func fold(_ s: String) -> String {
        s.folding(options: [.caseInsensitive, .widthInsensitive, .diacriticInsensitive], locale: nil)
    }

    /// 按空白拆成关键词，并统一写法；空查询得到空数组。
    public static func terms(_ query: String) -> [String] {
        query.split(whereSeparator: \.isWhitespace).map { fold(String($0)) }.filter { !$0.isEmpty }
    }

    /// 每个关键词都出现在 `foldedText` 里才算命中。`foldedText` 必须已经用 `fold` 处理过。
    public static func matches(_ foldedText: String, terms: [String]) -> Bool {
        terms.allSatisfy { foldedText.contains($0) }
    }

    /// 第一个命中位置附近的一段原文：命中点前保留 `before` 个字符，总长 `length`。
    /// 前面截掉了内容时以“…”开头；没有命中返回 nil。
    public static func snippet(of text: String, terms: [String], before: Int = 12, length: Int = 80) -> String? {
        let chars = Array(text)
        var folded = ""
        var origin: [Int] = []
        for (i, ch) in chars.enumerated() {
            for f in fold(String(ch)) {
                folded.append(f)
                origin.append(i)
            }
        }
        var first: Int?
        for term in terms {
            guard let r = folded.range(of: term) else { continue }
            let k = folded.distance(from: folded.startIndex, to: r.lowerBound)
            if first.map({ k < $0 }) ?? true { first = k }
        }
        guard let hit = first, hit < origin.count else { return nil }
        let start = max(0, origin[hit] - before)
        let end = min(chars.count, start + length)
        let piece = String(chars[start..<end]).replacingOccurrences(of: "\n", with: " ")
        return start > 0 ? "…" + piece : piece
    }
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `swift test --filter SearchTextTests`
Expected: 6 个测试全部通过

- [ ] **Step 5: 提交**

```bash
git add Sources/BetterMDCore/SearchText.swift Tests/BetterMDCoreTests/SearchTextTests.swift
git commit -m "feat: 中英文关键词搜索的折叠、匹配和摘录" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 笔记模型、文件名规则、列表时间

**Files:**
- Create: `Sources/BetterMDCore/LibraryLayout.swift`
- Create: `Sources/BetterMDCore/Note.swift`
- Create: `Sources/BetterMDCore/NoteDate.swift`
- Create: `Tests/BetterMDCoreTests/TestSupport.swift`
- Test: `Tests/BetterMDCoreTests/NoteTests.swift`

**Interfaces:**
- Consumes: `NoteText`（Task 2）、`SearchText.fold`（Task 3）
- Produces:
  - `LibraryLayout.attachments`（"附件"）、`.trash`（"废纸篓"）、`.meta`（".bettermd"）、`.stateFile`（".bettermd/state.json"）、`.reserved: Set<String>`
  - `LibraryLayout.fileName(forTitle: String) -> String`
  - `LibraryLayout.uniqueURL(in: URL, base: String, ext: String? = "md", excluding: URL? = nil) -> URL`
  - `struct Note: Identifiable, Hashable, Sendable`：`id: UUID`、`path: String`、`text: String`、`parsed: ParsedNote`（只读）、`created: Date`、`modified: Date`、`isPinned: Bool`、`originalFolder: String?`；计算属性 `isTrashed`、`folder`、`title`、`fileBaseName`；`withID(_:) -> Note`；`static parentFolder(of: String) -> String`
  - `init(id: UUID = UUID(), path:, text:, created:, modified:, isPinned: Bool = false, originalFolder: String? = nil)`
  - `struct ParsedNote`：`title`、`tags: [String]`、`hasOpenTodo`、`preview`、`searchKey`
  - `NoteDate.label(for: Date, now: Date = .now, calendar: Calendar = .current) -> String`
  - 测试工具：`TempDir.make() throws -> URL`；`URL.write(_:to:)`、`URL.read(_:)`、`URL.exists(_:)`

- [ ] **Step 1: 写测试工具**

`Tests/BetterMDCoreTests/TestSupport.swift`：

```swift
import Foundation

/// 每个测试一个独立的临时目录。
enum TempDir {
    static func make() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("bettermd-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }
}

extension URL {
    /// 在这个目录下写一个文件（中间目录自动建好）。
    func write(_ text: String, to relative: String) throws {
        let target = appendingPathComponent(relative)
        try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(text.utf8).write(to: target)
    }

    func read(_ relative: String) throws -> String {
        try String(contentsOf: appendingPathComponent(relative), encoding: .utf8)
    }

    func exists(_ relative: String) -> Bool {
        FileManager.default.fileExists(atPath: appendingPathComponent(relative).path)
    }
}
```

- [ ] **Step 2: 写失败的测试**

`Tests/BetterMDCoreTests/NoteTests.swift`：

```swift
import Foundation
import Testing
@testable import BetterMDCore

struct LibraryLayoutTests {
    @Test func fileNameReplacesUnsafeCharacters() {
        #expect(LibraryLayout.fileName(forTitle: "a/b: c") == "a／b： c")
    }

    @Test func fileNameFallsBackForEmptyTitle() {
        #expect(LibraryLayout.fileName(forTitle: "   ") == "无标题")
    }

    @Test func fileNameDropsLeadingDotsAndNewlines() {
        #expect(LibraryLayout.fileName(forTitle: "..隐藏\n第二行") == "隐藏 第二行")
    }

    @Test func fileNameIsCappedAt80Characters() {
        #expect(LibraryLayout.fileName(forTitle: String(repeating: "长", count: 100)).count == 80)
    }

    @Test func uniqueURLAddsNumberWhenTaken() throws {
        let dir = try TempDir.make()
        try dir.write("x", to: "计划.md")
        #expect(LibraryLayout.uniqueURL(in: dir, base: "计划").lastPathComponent == "计划 2.md")
        #expect(LibraryLayout.uniqueURL(in: dir, base: "新").lastPathComponent == "新.md")
    }

    @Test func uniqueURLTreatsTheFileItselfAsFree() throws {
        let dir = try TempDir.make()
        try dir.write("x", to: "readme.md")
        let current = dir.appendingPathComponent("readme.md")
        #expect(LibraryLayout.uniqueURL(in: dir, base: "README", excluding: current).lastPathComponent == "README.md")
    }
}

struct NoteTests {
    @Test func folderComesFromPath() {
        let note = Note(path: "工作/BetterMD/界面.md", text: "# 界面", created: .now, modified: .now)
        #expect(note.folder == "工作/BetterMD")
        #expect(!note.isTrashed)
        #expect(note.fileBaseName == "界面")
    }

    @Test func rootNoteIsUnfiled() {
        #expect(Note(path: "随手记.md", text: "", created: .now, modified: .now).folder == "")
    }

    @Test func trashedNoteRemembersOriginalFolder() {
        let note = Note(path: "废纸篓/旧.md", text: "# 旧", created: .now, modified: .now, originalFolder: "工作")
        #expect(note.isTrashed)
        #expect(note.folder == "工作")
    }

    @Test func parsedFieldsFollowTextChanges() {
        var note = Note(path: "a.md", text: "# 旧标题", created: .now, modified: .now)
        note.text = "# 新标题\n#标签"
        #expect(note.title == "新标题")
        #expect(note.parsed.tags == ["标签"])
    }

    @Test func emptyTitleShowsPlaceholder() {
        #expect(Note(path: "a.md", text: "", created: .now, modified: .now).title == "无标题")
    }

    @Test func withIDKeepsEverythingElse() {
        let note = Note(path: "a.md", text: "# 甲", created: .now, modified: .now, isPinned: true)
        let id = UUID()
        let copy = note.withID(id)
        #expect(copy.id == id)
        #expect(copy.path == note.path && copy.text == note.text && copy.isPinned)
    }
}

struct NoteDateTests {
    @Test func labels() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try #require(TimeZone(identifier: "Asia/Shanghai"))
        func date(_ y: Int, _ m: Int, _ d: Int, _ h: Int, _ min: Int = 0) throws -> Date {
            try #require(calendar.date(from: DateComponents(year: y, month: m, day: d, hour: h, minute: min)))
        }
        let now = try date(2026, 10, 7, 14)
        #expect(NoteDate.label(for: try date(2026, 10, 7, 10, 24), now: now, calendar: calendar) == "今天 10:24")
        #expect(NoteDate.label(for: try date(2026, 10, 6, 19, 5), now: now, calendar: calendar) == "昨天 19:05")
        #expect(NoteDate.label(for: try date(2026, 10, 3, 9), now: now, calendar: calendar) == "10月3日")
        #expect(NoteDate.label(for: try date(2025, 12, 30, 9), now: now, calendar: calendar) == "2025年12月30日")
    }
}
```

- [ ] **Step 3: 运行，确认失败**

Run: `swift test --filter "LibraryLayoutTests|NoteTests|NoteDateTests"`
Expected: 编译失败，提示找不到 `LibraryLayout`、`Note`、`NoteDate`

- [ ] **Step 4: 实现 `LibraryLayout`**

`Sources/BetterMDCore/LibraryLayout.swift`：

```swift
import Foundation

/// 「我的笔记」目录里的固定位置和命名规则。
public enum LibraryLayout {
    public static let attachments = "附件"
    public static let trash = "废纸篓"
    public static let meta = ".bettermd"
    public static let stateFile = ".bettermd/state.json"
    /// 根目录下这些名字不算用户的文件夹。
    public static let reserved: Set<String> = [attachments, trash, meta]

    /// 把标题变成文件名（不含扩展名）：`/` `:` 换成全角，换行变空格，去掉开头的点，
    /// 最长 80 个字符，空的叫“无标题”。
    public static func fileName(forTitle title: String) -> String {
        var name = title
            .replacingOccurrences(of: "/", with: "／")
            .replacingOccurrences(of: ":", with: "：")
            .components(separatedBy: .newlines)
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespaces)
        while name.hasPrefix(".") { name.removeFirst() }
        if name.count > 80 {
            name = String(name.prefix(80)).trimmingCharacters(in: .whitespaces)
        }
        return name.isEmpty ? "无标题" : name
    }

    /// `dir` 里第一个没被占用的名字：`base.ext`、`base 2.ext`、`base 3.ext`……
    /// `ext` 为 nil 时用于文件夹。`current` 是正在改名的那个文件自己，不算占用（大小写不同也算同一个）。
    public static func uniqueURL(in dir: URL, base: String, ext: String? = "md", excluding current: URL? = nil) -> URL {
        let fm = FileManager.default
        var n = 1
        while true {
            let name = n == 1 ? base : "\(base) \(n)"
            var url = dir.appendingPathComponent(name)
            if let ext { url.appendPathExtension(ext) }
            if let current, url.path.lowercased() == current.path.lowercased() { return url }
            if !fm.fileExists(atPath: url.path) { return url }
            n += 1
        }
    }
}
```

- [ ] **Step 5: 实现 `Note` 和 `ParsedNote`**

`Sources/BetterMDCore/Note.swift`：

```swift
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

    public init(text: String) {
        title = NoteText.title(of: text)
        tags = NoteText.tags(in: text)
        hasOpenTodo = NoteText.hasOpenTodo(text)
        preview = NoteText.preview(of: text)
        searchKey = SearchText.fold(text)
    }
}
```

- [ ] **Step 6: 实现 `NoteDate`**

`Sources/BetterMDCore/NoteDate.swift`：

```swift
import Foundation

/// 列表里的时间：今天“今天 10:24”，昨天“昨天 19:05”，今年“10月3日”，更早“2025年10月3日”。
public enum NoteDate {
    public static func label(for date: Date, now: Date = .now, calendar: Calendar = .current) -> String {
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.locale = Locale(identifier: "zh_CN")
        if calendar.isDate(date, inSameDayAs: now) {
            formatter.dateFormat = "HH:mm"
            return "今天 " + formatter.string(from: date)
        }
        if let yesterday = calendar.date(byAdding: .day, value: -1, to: now),
           calendar.isDate(date, inSameDayAs: yesterday) {
            formatter.dateFormat = "HH:mm"
            return "昨天 " + formatter.string(from: date)
        }
        formatter.dateFormat = calendar.isDate(date, equalTo: now, toGranularity: .year) ? "M月d日" : "yyyy年M月d日"
        return formatter.string(from: date)
    }
}
```

- [ ] **Step 7: 运行，确认通过**

Run: `swift test --filter "LibraryLayoutTests|NoteTests|NoteDateTests"`
Expected: 13 个测试全部通过

- [ ] **Step 8: 提交**

```bash
git add Sources/BetterMDCore/LibraryLayout.swift Sources/BetterMDCore/Note.swift Sources/BetterMDCore/NoteDate.swift Tests/BetterMDCoreTests/TestSupport.swift Tests/BetterMDCoreTests/NoteTests.swift
git commit -m "feat: 笔记模型、文件名规则和列表时间" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 读写「我的笔记」：扫描、写入、新建、小状态

**Files:**
- Create: `Sources/BetterMDCore/LibraryState.swift`
- Create: `Sources/BetterMDCore/NoteStore.swift`
- Test: `Tests/BetterMDCoreTests/NoteStoreLoadTests.swift`

**Interfaces:**
- Consumes: `Note`、`LibraryLayout`、`NoteText.title`（Task 2、4）
- Produces:
  - `struct LibraryState: Codable, Hashable, Sendable`：`pinned: Set<String>`、`trashOrigins: [String: String]`、`welcomed: Bool`；`init()`
  - `struct NoteStore: Sendable`：`root: URL`；`init(root:)`；`url(for: String) -> URL`；`prepare() throws`；`load() throws -> Snapshot`；`write(_: Note) throws -> Date`（`@discardableResult`）；`createNote(text: String, inFolder: String) throws -> Note`；`loadState() -> LibraryState`；`saveState(_: LibraryState) throws`
  - `NoteStore.Snapshot`：`notes: [Note]`、`folders: [String]`、`state: LibraryState`
  - 内部：`relativePath(of: URL) -> String`、`readText(_: URL) -> String?`

- [ ] **Step 1: 写失败的测试**

`Tests/BetterMDCoreTests/NoteStoreLoadTests.swift`：

```swift
import Foundation
import Testing
@testable import BetterMDCore

struct NoteStoreLoadTests {
    @Test func prepareCreatesTheLayout() throws {
        let root = try TempDir.make()
        try NoteStore(root: root).prepare()
        #expect(root.exists("附件"))
        #expect(root.exists("废纸篓"))
        #expect(root.exists(".bettermd"))
    }

    @Test func loadFindsNotesFoldersAndTrash() throws {
        let root = try TempDir.make()
        let store = NoteStore(root: root)
        try store.prepare()
        try root.write("# 随手记", to: "随手记.md")
        try root.write("# 计划", to: "工作/BetterMD/计划.md")
        try FileManager.default.createDirectory(at: root.appendingPathComponent("空文件夹"), withIntermediateDirectories: true)
        try root.write("# 旧", to: "废纸篓/旧.md")
        try root.write("不是笔记", to: "工作/说明.txt")
        try root.write("# 图里的", to: "附件/不算.md")
        var state = LibraryState()
        state.pinned = ["随手记.md"]
        state.trashOrigins = ["废纸篓/旧.md": "工作"]
        try store.saveState(state)

        let snapshot = try store.load()

        #expect(Set(snapshot.notes.map(\.path)) == ["随手记.md", "工作/BetterMD/计划.md", "废纸篓/旧.md"])
        #expect(snapshot.folders == ["工作", "工作/BetterMD", "空文件夹"])
        #expect(snapshot.notes.first { $0.path == "随手记.md" }?.isPinned == true)
        #expect(snapshot.notes.first { $0.path == "废纸篓/旧.md" }?.folder == "工作")
    }

    @Test func unreadableFilesAreSkippedAndUntouched() throws {
        let root = try TempDir.make()
        let bad = Data([0xFF, 0xFF, 0xFF])
        try bad.write(to: root.appendingPathComponent("坏.md"))
        let snapshot = try NoteStore(root: root).load()
        #expect(snapshot.notes.isEmpty)
        #expect(try Data(contentsOf: root.appendingPathComponent("坏.md")) == bad)
    }

    @Test func gb18030FilesAreReadable() throws {
        let root = try TempDir.make()
        let gb18030 = String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(
            CFStringEncoding(CFStringEncodings.GB_18030_2000.rawValue)))
        let data = try #require("# 旧文件\n中文内容".data(using: gb18030))
        try data.write(to: root.appendingPathComponent("旧.md"))
        let snapshot = try NoteStore(root: root).load()
        #expect(snapshot.notes.first?.title == "旧文件")
    }

    @Test func writeKeepsCreationDate() throws {
        let root = try TempDir.make()
        let store = NoteStore(root: root)
        var note = try store.createNote(text: "# 草稿", inFolder: "")
        let past = Date(timeIntervalSince1970: 1_000_000_000)
        try FileManager.default.setAttributes([.creationDate: past], ofItemAtPath: store.url(for: note.path).path)
        note.text = "# 草稿\n改过了"
        try store.write(note)
        let values = try store.url(for: note.path).resourceValues(forKeys: [.creationDateKey])
        #expect(values.creationDate == past)
        #expect(try root.read(note.path) == "# 草稿\n改过了")
    }

    @Test func createNoteNamesFileAfterTitleAndAvoidsCollisions() throws {
        let store = NoteStore(root: try TempDir.make())
        let first = try store.createNote(text: "# 周会", inFolder: "工作")
        let second = try store.createNote(text: "# 周会", inFolder: "工作")
        #expect(first.path == "工作/周会.md")
        #expect(second.path == "工作/周会 2.md")
    }

    @Test func stateRoundTripsAndToleratesMissingKeys() throws {
        let root = try TempDir.make()
        let store = NoteStore(root: root)
        try root.write("{\"pinned\": [\"a.md\"]}", to: ".bettermd/state.json")
        var state = store.loadState()
        #expect(state.pinned == ["a.md"])
        #expect(state.welcomed == false)
        state.welcomed = true
        try store.saveState(state)
        #expect(store.loadState() == state)
    }
}
```

- [ ] **Step 2: 运行，确认失败**

Run: `swift test --filter NoteStoreLoadTests`
Expected: 编译失败，提示找不到 `NoteStore`、`LibraryState`

- [ ] **Step 3: 实现 `LibraryState`**

`Sources/BetterMDCore/LibraryState.swift`：

```swift
import Foundation

/// 存在「我的笔记/.bettermd/state.json」里的小状态。
public struct LibraryState: Codable, Hashable, Sendable {
    /// 置顶笔记的路径。
    public var pinned: Set<String> = []
    /// 废纸篓里笔记的路径 → 原来所在的文件夹（“”是未分类）。
    public var trashOrigins: [String: String] = [:]
    /// 是否已经放过欢迎笔记。
    public var welcomed = false

    public init() {}

    /// 旧版本的文件里缺了哪个字段，就用默认值。
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        pinned = try c.decodeIfPresent(Set<String>.self, forKey: .pinned) ?? []
        trashOrigins = try c.decodeIfPresent([String: String].self, forKey: .trashOrigins) ?? [:]
        welcomed = try c.decodeIfPresent(Bool.self, forKey: .welcomed) ?? false
    }
}
```

- [ ] **Step 4: 实现 `NoteStore`（扫描、写入、新建、小状态）**

`Sources/BetterMDCore/NoteStore.swift`：

```swift
import Foundation

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

    // MARK: - 内部

    /// 文件相对「我的笔记」的路径（先解开 /var → /private/var 这类符号链接再比较）。
    func relativePath(of url: URL) -> String {
        let base = root.resolvingSymlinksInPath().standardizedFileURL.path
        let full = url.resolvingSymlinksInPath().standardizedFileURL.path
        guard full.hasPrefix(base) else { return url.lastPathComponent }
        return String(full.dropFirst(base.count)).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    /// 先按 UTF-8 读，不行再按 GB18030；都不行返回 nil。
    func readText(_ url: URL) -> String? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        if let text = String(data: data, encoding: .utf8) { return text }
        let gb18030 = String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(
            CFStringEncoding(CFStringEncodings.GB_18030_2000.rawValue)))
        return String(data: data, encoding: gb18030)
    }
}
```

- [ ] **Step 5: 运行，确认通过**

Run: `swift test --filter NoteStoreLoadTests`
Expected: 7 个测试全部通过

- [ ] **Step 6: 提交**

```bash
git add Sources/BetterMDCore/LibraryState.swift Sources/BetterMDCore/NoteStore.swift Tests/BetterMDCoreTests/NoteStoreLoadTests.swift
git commit -m "feat: 扫描和读写「我的笔记」，保留创建时间，跳过读不出的文件" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 改名、移动、废纸篓、文件夹

**Files:**
- Modify: `Sources/BetterMDCore/NoteStore.swift`（加操作方法）
- Modify: `Sources/BetterMDCore/LibraryState.swift`（加 `record`、`folderRenamed`）
- Test: `Tests/BetterMDCoreTests/NoteStoreOperationTests.swift`

**Interfaces:**
- Consumes: Task 5 的 `NoteStore`、`LibraryState`；Task 4 的 `Note`、`LibraryLayout`
- Produces:
  - `NoteStore.renameToMatchTitle(_: Note) throws -> Note`
  - `NoteStore.move(_: Note, toFolder: String) throws -> Note`
  - `NoteStore.trash(_: Note) throws -> Note`、`NoteStore.restore(_: Note) throws -> Note`
  - `NoteStore.createFolder(named: String, in parent: String) throws -> String`
  - `NoteStore.renameFolder(_ path: String, to name: String) throws -> String`
  - `LibraryState.record(from old: Note, to new: Note)`（mutating）
  - `LibraryState.folderRenamed(from: String, to: String)`（mutating）

- [ ] **Step 1: 写失败的测试**

`Tests/BetterMDCoreTests/NoteStoreOperationTests.swift`：

```swift
import Foundation
import Testing
@testable import BetterMDCore

struct NoteStoreOperationTests {
    func makeStore() throws -> (URL, NoteStore) {
        let root = try TempDir.make()
        let store = NoteStore(root: root)
        try store.prepare()
        return (root, store)
    }

    @Test func renameFollowsTitle() throws {
        let (root, store) = try makeStore()
        var note = try store.createNote(text: "# 旧名字", inFolder: "工作")
        note.text = "# 新名字\n正文"
        try store.write(note)
        let renamed = try store.renameToMatchTitle(note)
        #expect(renamed.path == "工作/新名字.md")
        #expect(root.exists("工作/新名字.md"))
        #expect(!root.exists("工作/旧名字.md"))
        #expect(try store.renameToMatchTitle(renamed) == renamed)
    }

    @Test func renameAvoidsTakenNamesAndStaysStable() throws {
        let (_, store) = try makeStore()
        _ = try store.createNote(text: "# 周会", inFolder: "")
        var other = try store.createNote(text: "# 草稿", inFolder: "")
        other.text = "# 周会"
        try store.write(other)
        let renamed = try store.renameToMatchTitle(other)
        #expect(renamed.path == "周会 2.md")
        #expect(try store.renameToMatchTitle(renamed).path == "周会 2.md")
    }

    @Test func renameHandlesCaseOnlyChanges() throws {
        let (root, store) = try makeStore()
        var note = try store.createNote(text: "# readme", inFolder: "")
        note.text = "# README"
        try store.write(note)
        let renamed = try store.renameToMatchTitle(note)
        #expect(renamed.path == "README.md")
        let names = try FileManager.default.contentsOfDirectory(atPath: root.path)
        #expect(names.contains("README.md"))
        #expect(!names.contains("readme.md"))
    }

    @Test func moveBetweenFolders() throws {
        let (root, store) = try makeStore()
        let note = try store.createNote(text: "# 计划", inFolder: "工作")
        let moved = try store.move(note, toFolder: "生活")
        #expect(moved.path == "生活/计划.md")
        #expect(root.exists("生活/计划.md"))
        #expect(!root.exists("工作/计划.md"))
        let back = try store.move(moved, toFolder: "")
        #expect(back.path == "计划.md")
        #expect(back.folder == "")
    }

    @Test func moveAvoidsOverwritingAnotherNote() throws {
        let (root, store) = try makeStore()
        _ = try store.createNote(text: "# 计划", inFolder: "生活")
        let note = try store.createNote(text: "# 计划", inFolder: "工作")
        let moved = try store.move(note, toFolder: "生活")
        #expect(moved.path == "生活/计划 2.md")
        #expect(root.exists("生活/计划.md"))
    }

    @Test func trashAndRestoreRoundTrip() throws {
        let (root, store) = try makeStore()
        let note = try store.createNote(text: "# 计划", inFolder: "工作/BetterMD")
        let trashed = try store.trash(note)
        #expect(trashed.path == "废纸篓/计划.md")
        #expect(trashed.isTrashed)
        #expect(trashed.folder == "工作/BetterMD")
        let restored = try store.restore(trashed)
        #expect(restored.path == "工作/BetterMD/计划.md")
        #expect(root.exists("工作/BetterMD/计划.md"))
    }

    @Test func restoreRecreatesMissingFolder() throws {
        let (root, store) = try makeStore()
        let trashed = try store.trash(try store.createNote(text: "# 孤儿", inFolder: "旧文件夹"))
        try FileManager.default.removeItem(at: root.appendingPathComponent("旧文件夹"))
        #expect(try store.restore(trashed).path == "旧文件夹/孤儿.md")
    }

    @Test func foldersAreCreatedAndRenamed() throws {
        let (root, store) = try makeStore()
        #expect(try store.createFolder(named: "读书", in: "") == "读书")
        #expect(try store.createFolder(named: "读书", in: "") == "读书 2")
        #expect(try store.createFolder(named: "废纸篓", in: "") == "废纸篓 文件夹")
        #expect(try store.createFolder(named: "客户", in: "工作") == "工作/客户")
        _ = try store.createNote(text: "# 需求", inFolder: "工作/客户")
        #expect(try store.renameFolder("工作", to: "公司") == "公司")
        #expect(root.exists("公司/客户/需求.md"))
    }

    @Test func stateFollowsPathChanges() {
        var state = LibraryState()
        let note = Note(path: "工作/a.md", text: "# a", created: .now, modified: .now, isPinned: true)
        state.record(from: note, to: note)
        #expect(state.pinned == ["工作/a.md"])

        var trashed = note
        trashed.path = "废纸篓/a.md"
        trashed.originalFolder = "工作"
        state.record(from: note, to: trashed)
        #expect(state.pinned == ["废纸篓/a.md"])
        #expect(state.trashOrigins == ["废纸篓/a.md": "工作"])

        var restored = trashed
        restored.path = "工作/a.md"
        restored.originalFolder = nil
        state.record(from: trashed, to: restored)
        #expect(state.trashOrigins.isEmpty)

        state.folderRenamed(from: "工作", to: "公司")
        #expect(state.pinned == ["公司/a.md"])
    }
}
```

- [ ] **Step 2: 运行，确认失败**

Run: `swift test --filter NoteStoreOperationTests`
Expected: 编译失败，提示 `NoteStore` 没有 `renameToMatchTitle` 等成员

- [ ] **Step 3: 在 `LibraryState` 里加记录方法**

在 `Sources/BetterMDCore/LibraryState.swift` 的 `LibraryState` 里，`init(from:)` 后面加：

```swift
    /// 一篇笔记从 `old` 变成 `new`（移动、改名、进出废纸篓、置顶）后，更新记录。
    public mutating func record(from old: Note, to new: Note) {
        if old.path != new.path {
            pinned.remove(old.path)
            trashOrigins.removeValue(forKey: old.path)
        }
        if new.isPinned {
            pinned.insert(new.path)
        } else {
            pinned.remove(new.path)
        }
        if new.isTrashed {
            trashOrigins[new.path] = new.originalFolder ?? ""
        } else {
            trashOrigins.removeValue(forKey: new.path)
        }
    }

    /// 文件夹 `old` 改名成 `new` 以后，里面所有路径一起改。
    public mutating func folderRenamed(from old: String, to new: String) {
        let swap = { (path: String) -> String in
            if path == old { return new }
            if path.hasPrefix(old + "/") { return new + String(path.dropFirst(old.count)) }
            return path
        }
        pinned = Set(pinned.map(swap))
        trashOrigins = trashOrigins.mapValues(swap)
    }
```

- [ ] **Step 4: 在 `NoteStore` 里加操作方法**

在 `Sources/BetterMDCore/NoteStore.swift` 的 `saveState(_:)` 后面、`// MARK: - 内部` 前面加：

```swift
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
    public func move(_ note: Note, toFolder folder: String) throws -> Note {
        guard Note.parentFolder(of: note.path) != folder else { return note }
        let dir = url(for: folder)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let target = LibraryLayout.uniqueURL(in: dir, base: note.fileBaseName)
        try moveItem(at: url(for: note.path), to: target)
        var moved = note
        moved.path = relativePath(of: target)
        moved.originalFolder = nil
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
```

并在 `// MARK: - 内部` 下面加两个工具方法：

```swift
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
```

- [ ] **Step 5: 运行，确认通过**

Run: `swift test --filter NoteStoreOperationTests`
Expected: 9 个测试全部通过

- [ ] **Step 6: 跑全部测试**

Run: `swift test`
Expected: 全部通过

- [ ] **Step 7: 提交**

```bash
git add Sources/BetterMDCore/NoteStore.swift Sources/BetterMDCore/LibraryState.swift Tests/BetterMDCoreTests/NoteStoreOperationTests.swift
git commit -m "feat: 笔记改名、移动、废纸篓，文件夹新建和改名" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 侧栏范围、列表、搜索排序、侧栏树

**Files:**
- Create: `Sources/BetterMDCore/LibraryIndex.swift`
- Test: `Tests/BetterMDCoreTests/LibraryIndexTests.swift`

**Interfaces:**
- Consumes: `Note`（Task 4）、`SearchText`（Task 3）
- Produces:
  - `enum Scope: Hashable, Sendable { case all, unfiled, todo, trash, folder(String), tag(String) }`
  - `struct FolderNode` / `struct TagNode`：`id`（= path）、`path`、`name`、`children: [Self]?`；`init(path:name:children:)`
  - `LibraryIndex.notes(_:in:) -> [Note]`、`sorted(_:) -> [Note]`、`search(_:query:) -> [Note]`、`visible(_:scope:query:) -> [Note]`
  - `LibraryIndex.folderTree(_ folders: [String]) -> [FolderNode]`、`tagTree(_ notes: [Note]) -> [TagNode]`
  - `LibraryIndex.folderForNewNote(in: Scope) -> String`、`newNoteText(for: Scope) -> String`
  - `LibraryIndex.locationLabel(for: Note, in: Scope) -> String?`

- [ ] **Step 1: 写失败的测试**

`Tests/BetterMDCoreTests/LibraryIndexTests.swift`：

```swift
import Foundation
import Testing
@testable import BetterMDCore

struct LibraryIndexTests {
    let now = Date(timeIntervalSince1970: 1_800_000_000)

    func note(_ path: String, _ text: String, minutesAgo: Double = 0, pinned: Bool = false, origin: String? = nil) -> Note {
        Note(path: path, text: text, created: now, modified: now.addingTimeInterval(-minutesAgo * 60),
             isPinned: pinned, originalFolder: origin)
    }

    var sample: [Note] {
        [
            note("随手记.md", "# 随手记\n同步的想法", minutesAgo: 1),
            note("工作/周会.md", "# 周会\n#会议/周会\n- [ ] 排期", minutesAgo: 2),
            note("工作/BetterMD/界面.md", "# 界面设计\n#想法 同步方案", minutesAgo: 3, pinned: true),
            note("读书/傅里叶.md", "# 傅里叶变换\n#数学", minutesAgo: 4),
            note("废纸篓/旧.md", "# 旧方案\n#想法", minutesAgo: 5, origin: "工作"),
        ]
    }

    @Test func scopesFilterNotes() {
        func paths(_ scope: Scope) -> [String] { LibraryIndex.notes(sample, in: scope).map(\.path) }
        #expect(paths(.all).count == 4)
        #expect(paths(.unfiled) == ["随手记.md"])
        #expect(paths(.folder("工作")) == ["工作/周会.md", "工作/BetterMD/界面.md"])
        #expect(paths(.todo) == ["工作/周会.md"])
        #expect(paths(.tag("会议")) == ["工作/周会.md"])
        #expect(paths(.tag("想法")) == ["工作/BetterMD/界面.md"])
        #expect(paths(.trash) == ["废纸篓/旧.md"])
    }

    @Test func pinnedFirstThenNewest() {
        let titles = LibraryIndex.sorted(LibraryIndex.notes(sample, in: .all)).map(\.title)
        #expect(titles == ["界面设计", "随手记", "周会", "傅里叶变换"])
    }

    @Test func searchRanksTitleHitsFirst() {
        let notes = [note("a.md", "# 会议纪要\n内容", minutesAgo: 9), note("b.md", "# 其他\n提到会议", minutesAgo: 1)]
        #expect(LibraryIndex.search(notes, query: "会议").map(\.path) == ["a.md", "b.md"])
    }

    @Test func searchNeedsAllTerms() {
        let hits = LibraryIndex.visible(sample, scope: .all, query: "同步 想法").map(\.path)
        #expect(Set(hits) == ["工作/BetterMD/界面.md", "随手记.md"])
    }

    @Test func emptyQueryJustSorts() {
        #expect(LibraryIndex.search(sample, query: "  ").count == 5)
    }

    @Test func folderTreeNestsPaths() {
        let tree = LibraryIndex.folderTree(["读书", "工作", "工作/客户", "工作/BetterMD"])
        #expect(tree.map(\.name) == ["工作", "读书"])
        #expect(tree[0].children?.map(\.path) == ["工作/BetterMD", "工作/客户"])
        #expect(tree[1].children == nil)
    }

    @Test func tagTreeIncludesParentsAndSkipsTrash() {
        let tree = LibraryIndex.tagTree(sample)
        #expect(Set(tree.map(\.name)) == ["会议", "数学", "想法"])
        #expect(tree.first { $0.name == "会议" }?.children?.map(\.path) == ["会议/周会"])
    }

    @Test func newNotePlacement() {
        #expect(LibraryIndex.folderForNewNote(in: .folder("工作")) == "工作")
        #expect(LibraryIndex.folderForNewNote(in: .tag("想法")) == "")
        #expect(NoteText.tags(in: LibraryIndex.newNoteText(for: .tag("想法"))) == ["想法"])
        #expect(NoteText.hasOpenTodo(LibraryIndex.newNoteText(for: .todo)))
        #expect(NoteText.title(of: LibraryIndex.newNoteText(for: .all)) == "新笔记")
    }

    @Test func locationLabels() {
        let deep = note("工作/BetterMD/界面.md", "# 界面")
        #expect(LibraryIndex.locationLabel(for: deep, in: .all) == "工作 / BetterMD")
        #expect(LibraryIndex.locationLabel(for: deep, in: .folder("工作")) == "BetterMD")
        #expect(LibraryIndex.locationLabel(for: deep, in: .folder("工作/BetterMD")) == nil)
        #expect(LibraryIndex.locationLabel(for: note("a.md", ""), in: .all) == "未分类")
        #expect(LibraryIndex.locationLabel(for: note("a.md", ""), in: .unfiled) == nil)
    }

    @Test func searchStaysFastWithThousandsOfNotes() {
        let filler = String(repeating: "正文内容 lorem ipsum ", count: 40)
        let many = (0..<5000).map { i in
            note("n\(i).md", "# 笔记 \(i)\n" + filler + (i % 97 == 0 ? "关键词" : ""))
        }
        let elapsed = ContinuousClock().measure {
            _ = LibraryIndex.search(many, query: "关键词")
        }
        #expect(elapsed < .milliseconds(300))
    }
}
```

- [ ] **Step 2: 运行，确认失败**

Run: `swift test --filter LibraryIndexTests`
Expected: 编译失败，提示找不到 `Scope`、`LibraryIndex`

- [ ] **Step 3: 实现**

`Sources/BetterMDCore/LibraryIndex.swift`：

```swift
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
```

- [ ] **Step 4: 运行，确认通过**

Run: `swift test --filter LibraryIndexTests`
Expected: 10 个测试全部通过

- [ ] **Step 5: 提交**

```bash
git add Sources/BetterMDCore/LibraryIndex.swift Tests/BetterMDCoreTests/LibraryIndexTests.swift
git commit -m "feat: 侧栏范围、排序、搜索和文件夹、标签树" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 界面状态和操作（AppModel）

**Files:**
- Create: `Sources/BetterMDCore/AppModel.swift`
- Test: `Tests/BetterMDCoreTests/AppModelTests.swift`

**Interfaces:**
- Consumes: `NoteStore`（Task 5、6）、`LibraryState`、`LibraryIndex`、`Scope`、`Note`
- Produces（`@MainActor @Observable public final class AppModel`）：
  - 只读：`store: NoteStore`、`notes: [Note]`、`folders: [String]`、`state: LibraryState`、`selectedID: Note.ID?`
  - 可写：`scope: Scope`、`query: String`、`lastError: String?`、`saveDelay: Duration`
  - 计算：`visibleNotes: [Note]`、`folderTree: [FolderNode]`、`tagTree: [TagNode]`、`selectedNote: Note?`
  - 方法：`init(root: URL)`、`load()`、`reload()`、`switchLibrary(to: URL)`、`select(_: Note.ID?)`、`updateText(_: String, for: Note.ID)`、`flushPendingSave()`、`newNote()`、`togglePin(_:)`、`move(_:toFolder:)`、`trash(_:)`、`restore(_:)`、`newFolder(named:in:) -> String?`（`@discardableResult`）、`renameFolder(_:to:)`

- [ ] **Step 1: 写失败的测试**

`Tests/BetterMDCoreTests/AppModelTests.swift`：

```swift
import Foundation
import Testing
@testable import BetterMDCore

@MainActor
struct AppModelTests {
    func makeModel(_ files: [String: String] = [:]) throws -> (URL, AppModel) {
        let root = try TempDir.make()
        for (path, text) in files { try root.write(text, to: path) }
        let model = AppModel(root: root)
        model.saveDelay = .seconds(60)
        model.load()
        return (root, model)
    }

    @Test func firstLaunchAddsWelcomeNoteOnce() throws {
        let (root, model) = try makeModel()
        #expect(model.notes.map(\.title) == ["欢迎使用 BetterMD"])
        #expect(root.exists("欢迎使用 BetterMD.md"))
        try FileManager.default.removeItem(at: root.appendingPathComponent("欢迎使用 BetterMD.md"))
        model.reload()
        #expect(model.notes.isEmpty)
    }

    @Test func editsAreSavedAndFileFollowsTitleWhenLeavingNote() throws {
        let (root, model) = try makeModel(["a.md": "# 甲", "b.md": "# 乙"])
        let a = try #require(model.notes.first { $0.path == "a.md" })
        model.select(a.id)
        model.updateText("# 甲改\n新内容", for: a.id)
        #expect(try root.read("a.md") == "# 甲")
        model.select(model.notes.first { $0.path == "b.md" }?.id)
        #expect(try root.read("甲改.md") == "# 甲改\n新内容")
        #expect(!root.exists("a.md"))
        #expect(root.exists("b.md"))
    }

    @Test func viewingANoteDoesNotRenameIt() throws {
        let (root, model) = try makeModel(["2023-日记.md": "# 日记", "b.md": "# 乙"])
        model.select(model.notes.first { $0.path == "2023-日记.md" }?.id)
        model.select(model.notes.first { $0.path == "b.md" }?.id)
        #expect(root.exists("2023-日记.md"))
    }

    @Test func flushWritesPendingEdits() throws {
        let (root, model) = try makeModel(["a.md": "# 甲"])
        let a = try #require(model.notes.first)
        model.updateText("# 甲\n补一句", for: a.id)
        model.flushPendingSave()
        #expect(try root.read("a.md") == "# 甲\n补一句")
    }

    @Test func newNoteGoesWhereTheScopeSays() throws {
        let (root, model) = try makeModel(["工作/a.md": "# 甲\n#想法"])
        model.scope = .folder("工作")
        model.newNote()
        #expect(model.selectedNote?.path == "工作/新笔记.md")
        model.scope = .tag("想法")
        model.newNote()
        let tagged = try #require(model.selectedNote)
        #expect(tagged.folder == "")
        #expect(tagged.parsed.tags == ["想法"])
        #expect(root.exists("新笔记.md"))
    }

    @Test func pinningIsSavedAndSortsFirst() throws {
        let (root, model) = try makeModel(["a.md": "# 甲", "b.md": "# 乙"])
        let b = try #require(model.notes.first { $0.path == "b.md" })
        model.togglePin(b.id)
        #expect(model.visibleNotes.first?.id == b.id)
        #expect(NoteStore(root: root).loadState().pinned == ["b.md"])
    }

    @Test func moveTrashAndRestore() throws {
        let (root, model) = try makeModel(["工作/a.md": "# 甲"])
        let a = try #require(model.notes.first)
        model.move(a.id, toFolder: "生活")
        #expect(root.exists("生活/a.md"))
        #expect(model.folders.contains("生活"))
        model.trash(a.id)
        #expect(model.notes.first?.isTrashed == true)
        #expect(NoteStore(root: root).loadState().trashOrigins == ["废纸篓/a.md": "生活"])
        model.restore(a.id)
        #expect(model.notes.first?.path == "生活/a.md")
        #expect(NoteStore(root: root).loadState().trashOrigins.isEmpty)
    }

    @Test func renamingAFolderUpdatesNotesAndScope() throws {
        let (root, model) = try makeModel(["工作/客户/a.md": "# 甲"])
        model.scope = .folder("工作/客户")
        model.renameFolder("工作", to: "公司")
        #expect(model.folders == ["公司", "公司/客户"])
        #expect(model.notes.first?.path == "公司/客户/a.md")
        #expect(model.scope == .folder("公司/客户"))
        #expect(root.exists("公司/客户/a.md"))
    }

    @Test func reloadSeesOutsideEditsAndKeepsIDs() throws {
        let (root, model) = try makeModel(["a.md": "# 甲"])
        let id = try #require(model.notes.first?.id)
        try root.write("# 甲\n别的程序写的", to: "a.md")
        try root.write("# 新来的", to: "b.md")
        model.reload()
        let a = try #require(model.notes.first { $0.path == "a.md" })
        #expect(a.id == id)
        #expect(a.text == "# 甲\n别的程序写的")
        #expect(model.notes.count == 2)
        #expect(model.selectedID == id)
    }
}
```

- [ ] **Step 2: 运行，确认失败**

Run: `swift test --filter AppModelTests`
Expected: 编译失败，提示 `cannot find 'AppModel' in scope`

- [ ] **Step 3: 实现**

`Sources/BetterMDCore/AppModel.swift`：

```swift
import Foundation
import Observation

/// 界面用的状态和操作。改文件的事都交给 NoteStore；这里管内存里的列表、选中、什么时候保存。
@MainActor
@Observable
public final class AppModel {
    public private(set) var store: NoteStore
    public private(set) var notes: [Note] = []
    public private(set) var folders: [String] = []
    public private(set) var state = LibraryState()
    public var scope: Scope = .all {
        didSet { if scope != oldValue { keepSelectionVisible() } }
    }
    public var query = "" {
        didSet { if query != oldValue { keepSelectionVisible() } }
    }
    public private(set) var selectedID: Note.ID?
    public var lastError: String?
    /// 停止输入多久以后自动保存。
    public var saveDelay: Duration = .milliseconds(600)

    @ObservationIgnored private var dirty: Set<Note.ID> = []
    @ObservationIgnored private var saveTask: Task<Void, Never>?
    /// 打开笔记时的标题；离开时标题变了才改文件名。
    @ObservationIgnored private var titleWhenOpened: [Note.ID: String] = [:]

    public init(root: URL) {
        store = NoteStore(root: root)
    }

    public var visibleNotes: [Note] { LibraryIndex.visible(notes, scope: scope, query: query) }
    public var folderTree: [FolderNode] { LibraryIndex.folderTree(folders) }
    public var tagTree: [TagNode] { LibraryIndex.tagTree(notes) }
    public var selectedNote: Note? { selectedID.flatMap { id in notes.first { $0.id == id } } }

    // MARK: - 读取

    /// 读入整个笔记库。第一次打开空库时放一篇欢迎笔记。重新读取时，同一路径的笔记沿用原来的 id。
    public func load() {
        do {
            try store.prepare()
            var snapshot = try store.load()
            if snapshot.notes.isEmpty && !snapshot.state.welcomed {
                snapshot.notes.append(try store.createNote(text: Self.welcomeText, inFolder: ""))
                snapshot.state.welcomed = true
                try store.saveState(snapshot.state)
            }
            let oldIDs = Dictionary(notes.map { ($0.path, $0.id) }, uniquingKeysWith: { first, _ in first })
            notes = snapshot.notes.map { note in oldIDs[note.path].map { note.withID($0) } ?? note }
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
        flushPendingSave()
        store = NoteStore(root: root)
        notes = []
        folders = []
        state = LibraryState()
        selectedID = nil
        titleWhenOpened = [:]
        load()
    }

    // MARK: - 编辑

    public func select(_ id: Note.ID?) {
        guard id != selectedID else { return }
        if let previous = selectedID { finishEditing(previous) }
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
        scheduleSave()
    }

    /// 把所有没保存的修改马上写盘。
    public func flushPendingSave() {
        saveTask?.cancel()
        saveTask = nil
        let pending = dirty
        dirty.removeAll()
        for id in pending { save(id) }
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
            select(note.id)
        } catch {
            lastError = "新建笔记失败：\(error.localizedDescription)"
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

    private func save(_ id: Note.ID) {
        guard let i = index(of: id) else { return }
        do {
            notes[i].modified = try store.write(notes[i])
        } catch {
            lastError = "保存失败：\(error.localizedDescription)"
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
```

- [ ] **Step 4: 运行，确认通过**

Run: `swift test --filter AppModelTests`
Expected: 9 个测试全部通过

- [ ] **Step 5: 跑全部测试**

Run: `swift test`
Expected: 全部通过

- [ ] **Step 6: 提交**

```bash
git add Sources/BetterMDCore/AppModel.swift Tests/BetterMDCoreTests/AppModelTests.swift
git commit -m "feat: AppModel 管理选中、自动保存、改名和整理操作" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: 三栏界面

**Files:**
- Modify: `Sources/BetterMD/BetterMDApp.swift`（整个替换）
- Create: `Sources/BetterMD/LibraryLocation.swift`
- Create: `Sources/BetterMD/ContentView.swift`
- Create: `Sources/BetterMD/SidebarView.swift`
- Create: `Sources/BetterMD/NoteListView.swift`
- Create: `Sources/BetterMD/NoteRow.swift`
- Create: `Sources/BetterMD/NoteMenu.swift`
- Create: `Sources/BetterMD/EditorView.swift`
- Modify: `CLAUDE.md`（“开发命令”里加一条）

**Interfaces:**
- Consumes: `AppModel`、`Scope`、`Note`、`LibraryIndex.locationLabel`、`NoteDate.label`、`SearchText`（Task 3–8）
- Produces: 可运行的 BetterMD.app；启动参数 `-libraryPath <目录>` 可以临时指定笔记库

界面这一步没有单元测试：AppModel 的行为在 Task 8 测过了。这里的验证是编译、启动、看文件有没有按预期出现，再加一份人工检查清单。

- [ ] **Step 1: 写 `LibraryLocation.swift`**

```swift
import Foundation

/// 「我的笔记」放在哪。默认在用户目录下（不放进「文稿」，免得开了 iCloud 文稿同步时被传到 iCloud）。
/// 开发时可以用启动参数临时指定：`open -n build/BetterMD.app --args -libraryPath /某个/目录`。
enum LibraryLocation {
    private static let key = "libraryPath"

    static var defaultURL: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("我的笔记", isDirectory: true)
    }

    static var current: URL {
        get {
            guard let path = UserDefaults.standard.string(forKey: key), !path.isEmpty else { return defaultURL }
            return URL(fileURLWithPath: (path as NSString).expandingTildeInPath, isDirectory: true)
        }
        set {
            UserDefaults.standard.set(newValue.path, forKey: key)
        }
    }
}
```

- [ ] **Step 2: 替换 `BetterMDApp.swift`**

```swift
import AppKit
import BetterMDCore
import SwiftUI

@main
struct BetterMDApp: App {
    @State private var model = AppModel(root: LibraryLocation.current)

    init() {
        // 用 swift run 直接启动时也要像普通 App 一样出现在程序坞里。
        NSApplication.shared.setActivationPolicy(.regular)
    }

    var body: some Scene {
        WindowGroup("BetterMD") {
            ContentView()
                .environment(model)
                .frame(minWidth: 960, minHeight: 600)
                .task {
                    model.load()
                    NSApplication.shared.activate()
                }
        }
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("新建笔记") { model.newNote() }
                    .keyboardShortcut("n")
            }
            CommandGroup(after: .newItem) {
                Divider()
                Button("选择笔记库位置…") { chooseLibrary() }
            }
            CommandGroup(replacing: .saveItem) {
                Button("立即保存") { model.flushPendingSave() }
                    .keyboardShortcut("s")
            }
        }
    }

    private func chooseLibrary() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.prompt = "用这个文件夹"
        panel.message = "选一个文件夹当「我的笔记」"
        panel.directoryURL = LibraryLocation.current
        guard panel.runModal() == .OK, let url = panel.url else { return }
        LibraryLocation.current = url
        model.switchLibrary(to: url)
    }
}
```

- [ ] **Step 3: 写 `ContentView.swift`**

```swift
import AppKit
import BetterMDCore
import SwiftUI

/// 三栏：侧栏 ｜ 笔记列表 ｜ 编辑区。
struct ContentView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationSplitView {
            SidebarView()
                .navigationSplitViewColumnWidth(min: 200, ideal: 230, max: 320)
        } content: {
            NoteListView()
                .navigationSplitViewColumnWidth(min: 260, ideal: 320, max: 440)
        } detail: {
            EditorView()
        }
        .alert("出了点问题", isPresented: errorShown) {
            Button("知道了") { model.lastError = nil }
        } message: {
            Text(model.lastError ?? "")
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            model.reload()
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.willResignActiveNotification)) { _ in
            model.flushPendingSave()
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.willTerminateNotification)) { _ in
            model.flushPendingSave()
        }
    }

    private var errorShown: Binding<Bool> {
        Binding(get: { model.lastError != nil }, set: { if !$0 { model.lastError = nil } })
    }
}
```

- [ ] **Step 4: 写 `SidebarView.swift`**

```swift
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
```

- [ ] **Step 5: 写 `NoteListView.swift`、`NoteRow.swift`、`NoteMenu.swift`**

`Sources/BetterMD/NoteListView.swift`：

```swift
import BetterMDCore
import SwiftUI

/// 中间的笔记列表，带搜索框和新建按钮。
struct NoteListView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        let notes = model.visibleNotes
        List(selection: selection) {
            ForEach(notes) { note in
                NoteRow(note: note,
                        location: LibraryIndex.locationLabel(for: note, in: model.scope),
                        query: model.query)
                    .tag(note.id)
                    .contextMenu { NoteMenu(note: note) }
            }
        }
        .overlay {
            if notes.isEmpty {
                if model.query.trimmingCharacters(in: .whitespaces).isEmpty {
                    ContentUnavailableView("这里还没有笔记", systemImage: "square.and.pencil",
                                           description: Text("按 ⌘N 新建一篇"))
                } else {
                    ContentUnavailableView.search(text: model.query)
                }
            }
        }
        .navigationTitle(title)
        .searchable(text: $model.query, placement: .toolbar, prompt: "搜索")
        .toolbar {
            ToolbarItem {
                Button { model.newNote() } label: {
                    Label("新建笔记", systemImage: "square.and.pencil")
                }
                .help("新建笔记（⌘N）")
            }
        }
    }

    private var selection: Binding<Note.ID?> {
        Binding(get: { model.selectedID }, set: { model.select($0) })
    }

    private var title: String {
        switch model.scope {
        case .all: "我的笔记"
        case .unfiled: "未分类"
        case .todo: "待办"
        case .trash: "废纸篓"
        case .folder(let path): path.split(separator: "/").last.map(String.init) ?? path
        case .tag(let tag): "#" + tag
        }
    }
}
```

`Sources/BetterMD/NoteRow.swift`：

```swift
import BetterMDCore
import SwiftUI

/// 列表里的一行：标题、两行摘要、时间和位置。搜索时摘要显示命中的那一段。
struct NoteRow: View {
    let note: Note
    let location: String?
    let query: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 4) {
                if note.isPinned {
                    Image(systemName: "pin.fill").font(.caption2).foregroundStyle(.tint)
                }
                Text(note.title).font(.headline).lineLimit(1)
            }
            Text(summary)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(2)
            HStack(spacing: 8) {
                Text(NoteDate.label(for: note.modified))
                if let location {
                    Label(location, systemImage: "folder").labelStyle(.titleAndIcon)
                }
            }
            .font(.caption)
            .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 4)
    }

    private var summary: String {
        let terms = SearchText.terms(query)
        if !terms.isEmpty, let snippet = SearchText.snippet(of: note.text, terms: terms) { return snippet }
        return note.parsed.preview.isEmpty ? "空白笔记" : note.parsed.preview
    }
}
```

`Sources/BetterMD/NoteMenu.swift`：

```swift
import BetterMDCore
import SwiftUI

/// 笔记的右键菜单。
struct NoteMenu: View {
    @Environment(AppModel.self) private var model
    let note: Note

    var body: some View {
        if note.isTrashed {
            Button("放回原处") { model.restore(note.id) }
        } else {
            Button(note.isPinned ? "取消置顶" : "置顶") { model.togglePin(note.id) }
            Menu("移动到") {
                Button("未分类") { model.move(note.id, toFolder: "") }
                ForEach(model.folders, id: \.self) { folder in
                    Button(folder.replacingOccurrences(of: "/", with: " / ")) {
                        model.move(note.id, toFolder: folder)
                    }
                }
            }
            Divider()
            Button("移到废纸篓", role: .destructive) { model.trash(note.id) }
        }
    }
}
```

- [ ] **Step 6: 写 `EditorView.swift`**

```swift
import BetterMDCore
import SwiftUI

/// 第一阶段的编辑器：纯文本。第二阶段换成所见即所得的 Markdown 编辑器。
struct EditorView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if let note = model.selectedNote {
            TextEditor(text: text(for: note.id))
                .font(.system(size: 15))
                .lineSpacing(4)
                .scrollContentBackground(.hidden)
                .padding(.horizontal, 28)
                .padding(.top, 12)
                .disabled(note.isTrashed)
                .id(note.id)
                .navigationTitle(note.title)
                .navigationSubtitle(note.folder.isEmpty ? "未分类" : note.folder.replacingOccurrences(of: "/", with: " / "))
        } else {
            ContentUnavailableView("没有选中的笔记", systemImage: "note.text",
                                   description: Text("在左边选一篇，或者按 ⌘N 新建"))
        }
    }

    private func text(for id: Note.ID) -> Binding<String> {
        Binding(
            get: { model.notes.first { $0.id == id }?.text ?? "" },
            set: { model.updateText($0, for: id) }
        )
    }
}
```

- [ ] **Step 7: 编译并打包**

Run: `swift build && scripts/bundle.sh`
Expected: 没有错误，最后输出 `build/BetterMD.app`

- [ ] **Step 8: 用测试笔记库启动，确认它真的在读写文件**

```bash
rm -rf .build/dev-library
open -n build/BetterMD.app --args -libraryPath "$PWD/.build/dev-library"
```

然后（等窗口出现后）运行 `ls -a .build/dev-library`
Expected: 能看到 `欢迎使用 BetterMD.md`、`附件`、`废纸篓`、`.bettermd`。然后 `pkill -x BetterMD`。

- [ ] **Step 9: 人工检查清单（请人在 App 里点一遍）**

用上一步的命令启动，逐条确认：

1. 侧栏有「我的笔记」「未分类」「待办」「标签」（下面有 BetterMD、想法）「废纸篓」。
2. 按 ⌘N 新建笔记，把第一行改成 `# 测试`，点别的笔记，Finder 里 `.build/dev-library/测试.md` 出现，`新笔记.md` 不见了。
3. 右键「我的笔记」→ 新建文件夹「工作」；右键笔记 → 移动到 → 工作；点「工作」能看到它。
4. 在正文里加一行 `#会议/周会`，侧栏「标签」里出现「会议 › 周会」，点它能筛出这篇。
5. 搜索框输入中文的一部分（比如“测”）和英文的大小写变体，结果正确，摘要显示命中的那段。
6. 右键 → 移到废纸篓；在「废纸篓」里右键 → 放回原处，回到「工作」。
7. 打几个字马上按 ⌘Q 退出，再启动，字还在。

- [ ] **Step 10: 在 `CLAUDE.md` 的“开发命令”里加一条**

```markdown
- 用测试笔记库启动（不碰真正的「我的笔记」）：`open -n build/BetterMD.app --args -libraryPath "$PWD/.build/dev-library"`
```

- [ ] **Step 11: 提交**

```bash
git add Sources/BetterMD CLAUDE.md
git commit -m "feat: 三栏界面：侧栏、笔记列表、纯文本编辑器" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: 收尾：完整检查和项目记录

**Files:**
- Modify: `progress.md`（最上面加一条）
- Modify: `design.md`（更新“最后更新”和阶段）

**Interfaces:**
- Consumes: 前面所有任务
- Produces: 第一阶段完成的记录

- [ ] **Step 1: 跑全部测试**

Run: `swift test`
Expected: 全部通过（约 60 个测试），没有警告变成错误

- [ ] **Step 2: 打 release 包并启动一次**

Run: `scripts/bundle.sh release && open -n build/BetterMD.app --args -libraryPath "$PWD/.build/dev-library"`
Expected: App 正常打开，显示测试笔记库的内容；确认后 `pkill -x BetterMD`

- [ ] **Step 3: 更新 `design.md` 头部**

把“最后更新”改成当前时间（用 `date '+%Y-%m-%d %H:%M'` 取），阶段改成“第一阶段（基础）完成，下一步：第二阶段编辑器”。

- [ ] **Step 4: 在 `progress.md` 最上面加一条**

按 CLAUDE.md 里的格式写：做了什么（第一阶段的十个任务、测试数量）、改动了什么、删掉了什么和原因（没有就写“无”）、下一步（写第二阶段编辑器的计划）。时间用 `date '+%Y-%m-%d %H:%M'` 取。

- [ ] **Step 5: 提交**

```bash
git add design.md progress.md
git commit -m "docs: 记录第一阶段完成" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
