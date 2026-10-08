# Bear 功能和快捷键参考

> 调研时间：2026-10-07。对象：Bear for Mac 3.0.1（2026-09-28 发布）。
> 用途：BetterMD 补功能、定快捷键时对照 Bear 的做法。这里只记 Bear 是怎么做的；BetterMD 做不做、怎么做，以 [design.md](../design.md) 为准。
> 每条后面是出处。标「未确认」的，是没有找到可靠出处的说法。

**版本背景**：3.0 只修了 bug。版本号一旦超过 .9，macOS 27 的界面会出错，所以从 2.10 直接跳到了 3.0。2.10（2026-09-14）加了 "SiriAI Support"。所以 "Bear 2.x" 的功能就是现在这个版本的功能。

主要里程碑：
- 2.0（2023-07）：Bear 2 发布。
- 2.1：加了 Quick Open。
- 2.2：改进了折叠，加了复制代码按钮。
- 2.3：多色高亮；2.3.11：只读模式。
- 2.4：可以加密带附件的笔记，可以按标签置顶，待办自动排序；2.4.5：Callout。
- 2.5：MathJax 公式。
- 2.6：Liquid Glass 界面；2.6.3：Web Clipper 2.0。
- 2.7：重画了 TagCon。
- 2.8：bearcli、MCP、Claude Connector。
- 2.9：Workspace；2.9.2：Mermaid。

来源：[Mac App Store 版本历史](https://apps.apple.com/us/app/bear-markdown-notes/id1091189122?mt=12)、[blog.bear.app 更新分类](https://blog.bear.app/category/updates/)。Bear 的中文名是"熊掌记"，中文文档在 bear.app/zh/faq/。

---

## 1. macOS 快捷键

### 1a. 官方 Mac 快捷键页全表

来源：[EN 页](https://bear.app/faq/mac-keyboard-shortcuts/)、[中文页](https://bear.app/zh/faq/mac-keyboard-shortcuts/)

| 类别 | 快捷键 → 功能 |
|---|---|
| 文本样式 | ⌘1…⌘6 标题 H1–H6；⌘B 粗体；⌘I 斜体；⌘U 下划线；⇧⌘U 删除线；⇧⌘M 高亮；⌥⌘C 行内代码；⌃⌘C 代码块；⇧⌘T 引用；⌘L 无序列表；⇧⌘L 有序列表；⌥⌘S 分隔线；⌘K 链接；⌘D Wiki 链接；⇧⌘E 脚注；⇧⌘V 插入文件（图片和附件都用它，没有单独插图片的快捷键） |
| 表格 | ⌥⌘T 建表；⌃⌘↓ 加行；⌃⌘→ 加列；⌃⌘⌫ 删行；⌃⇧⌘⌫ 删列 |
| 待办 | ⌘T 插入待办；⌘. 切换完成状态 |
| 结构 | ⌥⌘→ / ⌥⌘← 行右移、左移（缩进）；⌥⌘↑ / ⌥⌘↓ 行上移、下移 |
| 列表 | ⇥ / ⇧⇥ 列表项缩进、反缩进；⇧⏎ 结束列表（只有中文页列出） |
| 日期 | ⇧⌘7 长日期加时间；⇧⌘8 长日期；⇧⌘9 短日期；⇧⌘0 时刻 |
| 控制 | ⌘A 全选；⌘↩ 结束编辑；⌘P 打印；⇧⌘K 打开链接；⌘' 折叠、展开；⌥⇧⌘L 复制笔记链接；⌥⇧⌘I 复制笔记 ID |
| 缩放 | ⌘+ / ⌘- / ⌘0 |
| 面板与搜索 | ⇧⌘I 统计（Info）面板；⇧⌘A 目录面板；⇧⌘B 反链面板；⌘F 笔记内查找；⌥⌘F 笔记内查找替换；⇧⌘F 搜索笔记列表 |
| 导航 | ⌘N 新笔记；⌥⌘N 在新窗口新建笔记；↑↓ 在笔记列表、标签列表里移动；←→ 在侧栏、列表、编辑器之间切换焦点，也用来展开、收起嵌套标签；↩ 编辑选中的笔记；⌘⌫ 删除（进废纸篓）；⌘O Quick Open；⇧⌘R 恢复；⇧⌘P 置顶、取消置顶；⌘A 全选列表；⇧⌘⌫ 清空废纸篓；⌘[ / ⌘] 浏览历史后退、前进（随键盘布局可能变） |
| 侧栏分区 | ⌥⌘1 Notes；⌥⌘2 Untagged；⌥⌘3 Todo；⌥⌘4 Today；⌥⌘5 Locked；⌥⌘6 Pinned；⌥⌘9 Archive；⌥⌘0 Trash |
| 导入导出 | ⇧⌘S 导出选中笔记；⇧⌘O 导入 |
| 窗口 | ⌃1 只显示编辑器；⌃2 列表加编辑器；⌃3 侧栏、列表加编辑器；⌘, 设置；⌃⌘F 全屏；⌘\ 打开主窗口 |

### 1b. 官方页没列、但别处有出处的快捷键和操作

- ⌘G / ⇧⌘G：笔记内下一个、上一个匹配（[查找 FAQ](https://bear.app/faq/how-to-search-text-inside-notes-in-bear/)）。
- Quick Open 里按 ⌘↩，在新窗口打开结果（[2.1 博客](https://blog.bear.app/2023/12/bear-2-1-is-out-with-quick-open-to-search-notes-tags-and-sections/)）。
- 按住 ⌘ 点链接，在新窗口打开（[分窗 FAQ](https://bear.app/faq/open-bear-notes-in-separate-windows/)）。
- 选中附件后按空格，用 Quick Look 预览（[附件 FAQ](https://bear.app/faq/insert-attachments/)）。
- 在列表里连按两次 ↩，反缩进或退出列表（[列表 FAQ](https://bear.app/faq/lists-and-todos-in-bear/)）。
- 光标在代码块里时，⌘A 只选这个代码块，再按一次才选全文（[2.2.0 发布说明](https://community.bear.app/t/13006)）。
- ⌃⌥⌘S：Hide Subtag Notes（[Mac 菜单截图](https://community.bear.app/t/17288)）。
- 表格 ⋮ 菜单里还有下面这些，来自 Bear 2.3.3 的 Mac 截图（[13890](https://community.bear.app/t/13890)、[13941](https://community.bear.app/t/13941)）：
  - ⌃⌘↑ 在上面加行；⌃⌘← 在左边加列。
  - ⌥⌘↑/↓ 行上移、下移；⌥⌘←/→ 列左移、右移。
  - Copy Table As（Markdown / HTML / CSV）；Align Column（Left / Center / Right）。
- ⌘K 打开编辑链接的面板；剪贴板里有网址时自动填进去（[链接博客](https://blog.bear.app/2025/12/things-you-might-not-know-about-links-in-bear/)）。
- 笔记列表有焦点时直接打字，就开始搜索（[隐藏功能博客](https://blog.bear.app/2024/08/5-hidden-macos-features-you-might-not-know/)）。
- 在搜索框里按 ↓，焦点跳到第一条结果（[2.1.5](https://community.bear.app/t/12264)）。
- 触控板左右滑动，隐藏或显示侧栏和列表（[FAQ](https://bear.app/faq/hide-the-sidebar-and-note-list-on-mac-and-ipad/)）。

### 1c. 没有默认快捷键的操作

任何菜单项都可以在 macOS 的「App 快捷键」里自己设快捷键（[FAQ](https://bear.app/faq/customise-mac-shortcuts/)）。

| 操作 | 在哪里 | 出处 |
|---|---|---|
| 归档 | 右键 → Archive | [FAQ](https://bear.app/faq/hide-notes-with-the-archive/) |
| 复制笔记 | Note → Duplicate，工作人员确认没有默认快捷键 | [18126](https://community.bear.app/t/18126) |
| 加密 | 右键 → Privacy → Add Password | [FAQ](https://bear.app/faq/how-to-encrypt-lock-notes-with-bear/) |
| 只读 | ⋯ → More → Make Read-Only | [FAQ](https://bear.app/faq/how-to-use-read-only-mode/) |
| Callout | Format → Callout | [FAQ](https://bear.app/faq/callouts/) |
| 数学公式 | Format → Code → Math / Math block | [FAQ](https://bear.app/faq/how-to-write-math-formulas-in-bear/) |
| 新窗口打开 | Note → Open In New Window | — |
| 窗口置顶 | Window → Float on Top | — |

### 1d. 文档之间的冲突

- **表格加行、加列**：Mac 官方页和 2.3.3 的菜单截图都是 ⌃⌘↓ / ⌃⌘→。[2024-05 博客](https://blog.bear.app/2024/05/5-tips-for-using-tables-in-bear/)和 [iPad 快捷键页](https://bear.app/faq/ios-keyboard-shortcuts/)写的却是 ⌃⌘↩ / ⇧⌘↩。2.1.5 的说明里写了 "Changed table's shortcuts"。按截图看，Mac 以方向键版为准。
- **退出 Workspace**：[Workspace FAQ](https://bear.app/faq/how-to-set-tag-as-workspace/) 写的是 ⇧⌘0，和"插入时刻"冲突。2.9.2 的说明里写了 "Updated the keyboard shortcut for dismissing a workspace"，现在是哪个键未确认。
- **⌃1 / ⌃2 / ⌃3**：可能被 macOS 的"切换到桌面 N"抢走（[17968](https://community.bear.app/t/17968)）。
- **ISO 日期快捷键**：一位用户提到 ⌥⇧⌘9，官方页没有，未确认（[19601](https://community.bear.app/t/19601)）。

---

## 2. 编辑功能

| 功能 | Bear 的做法 | 来源 |
|---|---|---|
| 语法基础 | CommonMark。`**粗**`、`_斜_`、`~下划线~`（一个波浪线）、`~~删除线~~`、`==高亮==`、`` `代码` ``。样式可以叠加，标题里也能用。`\` 转义 | [Markdown FAQ](https://bear.app/faq/how-to-use-markdown-in-bear/) |
| 多色高亮 | `==` 后面跟一个彩色圆点字符，再写文字。官方举例：绿 U+1F7E2（默认）、红 U+1F534、蓝 U+1F535。也能选黄和紫，但没找到它们用哪个字符（未确认）。点高亮前面的图标换颜色。颜色不随主题变 | [FAQ](https://bear.app/faq/the-multi-color-highlighter-tool/)、[13587](https://community.bear.app/t/13587) |
| `::mark::`、`++u++` | Bear 2 的文档都没提，未确认。Bear 1 用 `::`，现在官方写法是 `==` | 同上 |
| 隐藏 Markdown | Settings > General 里的开关。光标进入或选中带样式的文字时，才显示标记 | [Markdown FAQ](https://bear.app/faq/how-to-use-markdown-in-bear/)、[Bear 2 博客](https://blog.bear.app/2023/07/bear-2-is-here/) |
| 标题 | H1–H6。左边空白处有一个带级别数字的标题图标；点它弹出菜单：Toggle Fold、全部折叠、Copy Link to Here | [折叠 FAQ](https://bear.app/faq/how-to-fold-sections-in-bear/)、[10709](https://community.bear.app/t/10709) |
| 列表与待办 | 无序列表用 `*`、`-`、`+`。有序列表用 `1.`，可以从任意数字开始，回车自动加一。待办用 `- [ ]`，2.1 起也认 `* [ ]`。层级不限。⇧↩ 换行但不加符号；↩↩ 反缩进或结束列表。列表后面不必空一行（2.0.11）。"12. March" 不会被当成列表（2.1.5）。Settings > General 可以让已完成的待办自动沉底（2.4）；⋯ 里有 Sort ToDos（2.3） | [列表 FAQ](https://bear.app/faq/lists-and-todos-in-bear/)、[11706](https://community.bear.app/t/11706)、[12264](https://community.bear.app/t/12264)、[2.4 博客](https://blog.bear.app/2025/05/bear-2-4-update-better-encryption-smarter-todo-and-more/)、[2.3 博客](https://blog.bear.app/2024/09/bear-2-3-new-ios18-tinted-icons-multiple-color-highlighter-and-more/) |
| 表格 | 建表：⌥⌘T、格式栏或 Format 菜单。鼠标移到格子上会出现 ⋮ 菜单（内容见 1b）。第一行固定加粗。认 GFM 的 `:---:` 列对齐。从 Numbers、Sheets、Excel 粘贴，直接变成 Markdown 表格。不能调列宽，不能给格子上色，格子里不能放列表或图片。用户说行有交替底色。表格里 Tab 怎么走：未确认 | [表格 FAQ](https://bear.app/faq/how-to-use-tables-in-bear/)、[16723](https://community.bear.app/t/16723)、[17238](https://community.bear.app/t/17238)、[Apple 应用博客](https://blog.bear.app/2025/03/how-to-use-bear-with-apples-built-in-apps/) |
| 代码 | 代码块在 ``` 后面写语言名，支持 250 多种语言（官方有列表和别名）。右键菜单有 Paste From → Code。左边有复制代码按钮（2.2）。代码块里的 ⌘A 见 1b | [代码 FAQ](https://bear.app/faq/show-syntax-highlighting-for-your-code-snippets-in-notes/)、[13006](https://community.bear.app/t/13006) |
| 数学 | MathJax（2.7.2 起是 MathJax 4）。行内写 `$…$`；成块写 `$$…$$`，各占一行。编辑时实时预览：行内的出现在右边，成块的出现在下面。光标离开后只显示排版结果，点公式再编辑。写错时显示 MathJax 的报错。入口：Format → Code → Math / Math block | [数学 FAQ](https://bear.app/faq/how-to-write-math-formulas-in-bear/)、[App Store](https://apps.apple.com/us/app/bear-markdown-notes/id1091189122?mt=12) |
| Mermaid | 写 ```mermaid 代码块，下面实时出图；光标离开后隐藏代码，点图再编辑。免费功能（2.9.2） | [FAQ](https://bear.app/faq/how-to-add-mermaid-diagrams-in-bear/) |
| Callout | 写成 `> [!NOTE]`，类型还有 TIP、IMPORTANT、WARNING、CAUTION。类型后面可以接自定义标题，也可以只有标题。里面能放带格式的内容。点类型图标可以换类型。可以嵌套（2.6.7） | [FAQ](https://bear.app/faq/callouts/) |
| 脚注 | 正文写 `文字[^1]`，文末写 `[^1]: 内容`。⇧⌘E 一次生成引用和文末脚注，并把光标移过去。点编号来回跳。插入新脚注时自动重新编号（2.0.11） | [FAQ](https://bear.app/faq/how-to-use-footnotes-in-bear/) |
| Wiki 链接 | 打 `[[` 弹出补全，列出最近的笔记。选好笔记后打 `/`，列出那篇笔记的小标题；`[[/` 列出这篇笔记自己的小标题。写法 `[[笔记/标题]]`，起别名写 `[[标题\|别名]]`，快捷键 ⌘D。2.6.4 起中文的【【也能触发。笔记改名时，链接跟着改；小标题改了，指向它的链接不跟着改（工作人员 2024 年确认） | [FAQ](https://bear.app/faq/how-to-link-notes-together/)、[13110](https://community.bear.app/t/13110)、[16089](https://community.bear.app/t/16089) |
| 反链 | 在信息面板的 Backlinks 页：Linked mentions（链接了这篇的笔记），以及 Unlinked mentions（正文里出现了这篇的完整标题、但没加链接的笔记） | [FAQ](https://bear.app/faq/how-to-use-the-info-panel-table-of-contents-and-backlinks-in-bear/) |
| 标签补全 | 打 `#` 弹出补全，方向键加回车选。多个词的标签写成 `#多 词#`，多级写成 `#a/b`。标签可以写在标题里。2.7 起正文里的标签旁边也显示 TagCon | [FAQ](https://bear.app/faq/how-to-use-tag-autocomplete-and-note-autocomplete/)、[2.7 博客](https://blog.bear.app/2026/03/bear-2-7-a-fresh-look-for-tagcons/) |
| 自动配对 | 有选中文字时，打 `( " ' [ {` 或 Markdown 标记会把选中的文字包起来。出处是 2021 年测试版（Panda）的说明（[1734](https://community.bear.app/t/1734)）。没选中文字时会不会自动补右括号：未确认 | — |
| 打字机 / 专注模式 | 没有打字机模式。工作人员 2026-09-29 说会加到 Mac 版，没给日期（[17397](https://community.bear.app/t/17397)）。官方说的 "Focus mode" 就是 View → Editor Only（⌃1）再加全屏（[博客](https://blog.bear.app/2018/03/check-out-some-big-little-features-in-bear/)） | — |
| 笔记内查找替换 | ⌘F；⌘G / ⇧⌘G 在匹配之间跳；⌥⌘F 打开替换，可以一个个换，也可以全部换。Pro 用户的匹配落在图片或 PDF 里时，会高亮那个附件。替换只改文字 | [FAQ](https://bear.app/faq/how-to-search-text-inside-notes-in-bear/) |
| 信息面板与统计 | 显示字数、字符数、段落数、阅读时间、最后编辑时间。面板可以拖出来浮着，跟着当前笔记变。Bear 2 的 "Live in-note stats" 可以挑一项一直显示（Bear 网页版的说明写的是：点一下就显示在编辑区底部） | [信息面板 FAQ](https://bear.app/faq/how-to-use-the-info-panel-table-of-contents-and-backlinks-in-bear/)、[What's new](https://bear.app/faq/whats-new-in-bear-2/)、[19261](https://community.bear.app/t/19261) |
| 目录 | 按 H1–H6 实时生成，点一下跳过去；折叠起来的小标题也列出来（2.0.15）。不能在目录里拖动调整顺序（有人提过需求） | 同上、[11791](https://community.bear.app/t/11791)、[12989](https://community.bear.app/t/12989) |
| 折叠 | 小标题和多级列表（包括待办）都能折叠。鼠标移到左边空白处出现折叠箭头（2.2），也可以按 ⌘'。标题图标的菜单里可以一次折叠全部。折叠起来的一节可以整个拖走 | [FAQ](https://bear.app/faq/how-to-fold-sections-in-bear/)、[博客](https://blog.bear.app/2024/06/how-to-use-folding-to-stay-organized/) |
| 调整顺序 | ⌥⌘↑/↓ 移动当前行、选中的文字或折叠起来的一节。Mac 上可以拖列表符号或待办方框来调整顺序，也能拖选中的文字。没有段落拖动手柄 | [列表 FAQ](https://bear.app/faq/lists-and-todos-in-bear/)、[12762](https://community.bear.app/t/12762)、[12989](https://community.bear.app/t/12989) |
| Emoji | 打 `:名字` 弹出补全，插入的是表情字符本身；可以用系统里加了的各种语言搜 | [FAQ](https://bear.app/faq/quickly-add-emoji-to-notes/) |
| 日期 | 插入日期的快捷键是 ⇧⌘7/8/9/0。Settings > General 的 "Create new notes with" 决定新笔记的开头：H1–H4、Date、Date (ISO 8601)、Date and Time、Date and Time (ISO 8601)、Empty | [截图 19601](https://community.bear.app/t/19601) |
| 文本变换（大小写、排序行） | 未确认，没找到可读的来源 | — |
| 拼写与语法 | Edit → Spelling and Grammar；Edit → Substitutions 里可以关掉智能引号；macOS 15.1 起有 Apple 智能的写作工具 | [FAQ](https://bear.app/faq/disable-spell-check-and-corrections/)、[智能引号](https://bear.app/faq/how-to-disable-smart-quotes-and-dashes/)、[AI 博客](https://blog.bear.app/2024/10/new-apple-intelligence-writing-tools-coming-to-bear/) |
| 链接 | ⌘K 面板可以填网址和标题，可以打开 Show Preview（显示成链接卡片）。选中文字再粘贴网址，变成带标题的链接。粘贴单独的网址时自动取网页标题（Settings > General 可以关）。认 `file://` 本地文件链接。从「邮件」拖一封邮件进来，生成指向那封邮件的链接 | [链接博客](https://blog.bear.app/2025/12/things-you-might-not-know-about-links-in-bear/)、[预览 FAQ](https://bear.app/faq/how-to-add-link-previews-to-bear-notes/)、[隐藏功能博客](https://blog.bear.app/2024/08/5-hidden-macos-features-you-might-not-know/) |
| 其他 | 选中文字右键 Copy As：Rich Text、Plain Text、HTML（Pro）、Markdown（[FAQ](https://bear.app/faq/copy-portions-of-notes-as-html-rtf-txt-or-markdown/)）。右键 New note from selection（2.1）。每篇笔记可以设成只读，用 @readonly 能搜出来。支持从右往左写的语言。写 `#RRGGBB` 会显示一个色点（[18141](https://community.bear.app/t/18141)）。认 YAML front matter（[845](https://community.bear.app/t/845)）。图片宽度、链接预览这类信息，以 HTML 注释的形式存在 Markdown 里（工作人员说的，[17238](https://community.bear.app/t/17238)） | — |

---

## 3. 图片与文件

| 项目 | Bear 的做法 | 来源 |
|---|---|---|
| 插入方式 | 从 Finder 或浏览器拖进来；粘贴（包括用通用剪贴板从 iPhone 粘贴）；Format → File（⇧⌘V）；格式栏；右键用 iPhone 拍照（连续互通相机）；把文件拖到程序坞的 Bear 图标上，新建一篇带这个附件的笔记 | [附件 FAQ](https://bear.app/faq/insert-attachments/)、[媒体博客](https://blog.bear.app/2026/04/bear-beyond-text-working-with-images-pdfs-and-more/)、[Apple 应用博客](https://blog.bear.app/2025/03/how-to-use-bear-with-apples-built-in-apps/) |
| 附件类型 | 什么文件都行，显示成一个框：文件名、修改日期、图标；图片和 PDF 另有预览 | [附件 FAQ](https://bear.app/faq/insert-attachments/) |
| 大小与排版 | Mac 上鼠标移到图片上，拖右下角的手柄调大小，会自动和旁边的图片对齐。裁剪只有 iOS 能做。Bear 2 可以给文件改名。左中右对齐、图片说明：文档里没有（未确认） | [照片 FAQ](https://bear.app/faq/working-with-photos-gifs-pdfs-and-other-attachments/)、[媒体博客](https://blog.bear.app/2026/04/bear-beyond-text-working-with-images-pdfs-and-more/) |
| 预览 | GIF 点了才播。视频点开是快速预览的播放器。PDF 在正文里显示预览，右键可以 Hide preview，双击打开。按空格用 Quick Look 看。macOS 13 起图片右下角有实况文本按钮（2.4）。图库视图：没找到（未确认）。笔记列表能显示缩略图，也能 Hide Attachments | 同上、[2.4 博客](https://blog.bear.app/2025/05/bear-2-4-update-better-encryption-smarter-todo-and-more/) |
| 存储方式 | 数据在 `~/Library/Group Containers/9K33E3U3T4.net.shinyfrog.bear/`，笔记在 `Application Data/database.sqlite`（SQLite，可以只读访问）。图片宽度用 HTML 注释写在图片旁边，具体格式未确认。单个附件超过 250 MB 不同步 | [数据库 FAQ](https://bear.app/faq/where-are-bears-notes-located/)、[18579](https://community.bear.app/t/18579)、[17238](https://community.bear.app/t/17238) |
| 导出时的附件 | TextBundle 里有 assets 文件夹。导出 Markdown 时，附件放进以笔记名命名的子文件夹，也可以选 base64 内嵌。附件可以直接拖到 Finder。备份文件 `.bear2bk` 其实是 zip，里面每篇笔记是一个 textbundle | [导出 FAQ](https://bear.app/faq/export-your-notes/)、[18817](https://community.bear.app/t/18817)、[备份 FAQ](https://bear.app/faq/backup-restore/) |
| 文字识别 | Pro 功能：能搜到图片和 PDF 里的字；`@ocr` 只搜附件；笔记内查找会高亮命中的附件；手写草图搜不到 | [搜索 FAQ](https://bear.app/faq/how-to-search-notes-in-bear/)、[草图 FAQ](https://bear.app/faq/how-to-sketch-in-bear/) |
| 搜索过滤词 | `@images`、`@files`、`@attachments`、`@ocr` | [搜索 FAQ](https://bear.app/faq/how-to-search-notes-in-bear/) |
| 其他 | 2.4 起带附件的笔记也能加密。草图只能在 iPad、iPhone 上画；扫描文稿只有 iOS 能用 | [2.4 博客](https://blog.bear.app/2025/05/bear-2-4-update-better-encryption-smarter-todo-and-more/) |

---

## 4. 笔记管理与组织

| 项目 | Bear 的做法 | 来源 |
|---|---|---|
| 置顶 | 在 Notes、Archive、Trash 里置顶是全局的；在某个标签里置顶，只在那个标签里生效（2.4）。侧栏的 Pinned 汇总所有置顶。⌘ 点选多篇后，右键 Pin to top。标签也能置顶，只限一级标签 | [FAQ](https://bear.app/faq/pin-notes-and-tags/) |
| 归档 | 右键 → Archive。归档的笔记在别处搜不到，要先选中 Archive 再搜 | [FAQ](https://bear.app/faq/hide-notes-with-the-archive/) |
| 废纸篓 | ⌘⌫ 删除，⇧⌘R 恢复，⇧⌘⌫ 清空。文档没说会不会自动清除 | [侧栏 FAQ](https://bear.app/faq/about-the-sidebar-in-bear/) |
| 标签 | 层数不限。把笔记拖到侧栏的标签上，就给它加上这个标签；加在开头还是结尾可以设（2.7）。右键 Edit Tag 可以改名、换 TagCon；Delete Tag 只从笔记里去掉这个标签，不删笔记。改成一个已有的标签名，就是合并（用户说的，工作人员在相关的问题帖里也确认了）。改标签名不改笔记的修改时间。View → Tag Sorting 调标签的排序；2.6.7 起可以一键展开、收起全部标签。按标签导出时，多级标签变成文件夹 | [标签 FAQ](https://bear.app/faq/how-to-use-tags-in-bear/)、[改名 FAQ](https://bear.app/faq/rename-and-delete-tags/)、[17133](https://community.bear.app/t/17133)、[18833](https://community.bear.app/t/18833)、[导出标签 FAQ](https://bear.app/faq/export-your-tags/) |
| TagCon | 一共 260 个图标；常见标签按关键词自动配图，认 11 种语言；可以搜索；Pro 用户在设备之间同步 | [FAQ](https://bear.app/faq/how-tagcons-work/) |
| Workspace（2.9） | 右键标签 → 设为 Workspace，之后列表、侧栏的标签、搜索、Archive 和 Trash 都只看这个标签下的内容；可以在 Notes、Pinned、Recent 之间切换。x-callback 有 `/open-workspace`、`/close-workspace`，快捷指令里也有对应的动作（2.9.4） | [FAQ](https://bear.app/faq/how-to-set-tag-as-workspace/) |
| 多选与批量 | ⌘ 点选、⇧ 点选。可以批量导出、置顶、拖到标签上、去掉标签、加或去掉密码。Mac 上批量加标签只能靠拖（有人提需求）。合并笔记：没有文档记载的命令；导出时可以把选中的笔记合成一个文件（2018 年博客，2.3 说明里的 "merged markdown exports"） | [导出 FAQ](https://bear.app/faq/export-your-notes/)、[18067](https://community.bear.app/t/18067)、[2018 博客](https://blog.bear.app/2018/08/oh-the-places-your-bear-notes-will-go/) |
| 排序与列表显示 | 排序：修改时间、创建时间、标题，外加"最新的在上面"。排序是全局的，不能每个标签单独设（有人提需求）。预览样式分大、中、小，可以 Hide Attachments、Hide Subtag Notes。预览里不显示标签（2.3.4）。加密的笔记只显示标题 | [截图 17288](https://community.bear.app/t/17288)、[13215](https://community.bear.app/t/13215)、[13950](https://community.bear.app/t/13950) |
| 复制笔记 | Note → Duplicate | [18126](https://community.bear.app/t/18126) |
| 加密（Pro） | 每篇笔记单独设密码，可以用触控 ID 解锁。算法是 AES-GCM-256（Themis 库）。快捷指令、小组件、扩展都读不到加密的笔记。另有 "Lock Bear at Launch"，锁住整个 App | [加密 FAQ](https://bear.app/faq/how-to-encrypt-lock-notes-with-bear/)、[原理 FAQ](https://bear.app/faq/how-does-encryption-in-bear-work-under-the-hood/)、[App 锁 FAQ](https://bear.app/faq/how-to-lock-bear-for-privacy/) |
| 模板、每日笔记、版本历史 | 都没有。官方建议复制带 #template 标签的笔记，或者用快捷指令、x-callback 做模板；2026 年还有人在要模板功能。侧栏有 Today；新笔记可以默认以日期开头。版本历史：工作人员 2024 年说"排得很靠前"，到现在还没有 | [模板博客](https://blog.bear.app/2024/02/effortless-productivity-creating-and-using-templates-in-bear/)、[19559](https://community.bear.app/t/19559)、[12381](https://community.bear.app/t/12381) |
| 快速记录 | 没有菜单栏小窗（[15492](https://community.bear.app/t/15492)）。浏览器剪藏插件（Safari、Chrome、Firefox）：存整页或选中的部分；可以设默认标签、存的时候问标签、要不要存图片、附上原网址、只存标题和网址、加 YAML 元数据；2.6.3 起全部在本机处理。Mac 桌面小组件：Single Note、Sidebar、Search、Random、Find、Create。能用聚焦搜索（Spotlight）搜笔记。2.10 起 Siri 能新建笔记、追加文字或文件、置顶、做复杂的搜索，并且知道你正在看哪篇。Bear 有没有往"服务"菜单里加东西：未确认 | [剪藏 FAQ](https://bear.app/faq/browser-extensions/)、[小组件 FAQ](https://bear.app/faq/how-to-use-widgets-with-bear/)、[App Store](https://apps.apple.com/us/app/bear-markdown-notes/id1091189122?mt=12) |
| 多窗口 | 双击笔记在新窗口打开；Float on Top 让窗口浮在最上层；单独的窗口里也能前进、后退（2.6.2） | [FAQ](https://bear.app/faq/open-bear-notes-in-separate-windows/) |
| 自动化 | x-callback-url 动作：`open-note`、`create`、`add-text`、`add-file`、`tags`、`open-tag`、`rename-tag`、`delete-tag`、`trash`、`archive`、`untagged`、`todo`、`today`、`locked`、`search`、`grab-url`，以及 Workspace 相关的。令牌在 Help → Advanced 里。另有快捷指令的动作，以及 2.8 起的 bearcli、MCP 服务、Claude Connector（只有 macOS，可以按标签限定能看到哪些笔记） | [x-callback](https://bear.app/faq/x-callback-url-scheme-documentation/)、[快捷指令 FAQ](https://bear.app/faq/how-to-use-siri-shortcuts-with-bear/)、[命令行 FAQ](https://bear.app/faq/command-line-interface/) |
| 导入 | txt、md、rtf、textbundle、textpack、enex、bear / bearnote、html、Drafts；Markdown 文件夹（连附件一起）、Obsidian 库、Day One。可以保留原来的日期，可以选用第一行或文件名当标题 | [FAQ](https://bear.app/faq/import-your-notes/) |
| 导出 | 免费：txt、md、textbundle、bearnote、rtf。Pro：html、docx、pdf、jpg、epub。选项：Wiki 链接转成 HTML 链接、图片用 base64 内嵌、导出时保留标签。另外可以打印、用 Marked 预览、隔空投送 | [FAQ](https://bear.app/faq/export-your-notes/)、[打印](https://bear.app/faq/print-notes/)、[Marked](https://bear.app/faq/preview-your-notes-in-marked-2/) |
| 同步 | 走 CloudKit，要 Pro；支持 Apple 的高级数据保护，但开了以后笔记标题和标签名仍然不加密。冲突时两个版本都留下，让你自己挑 | [同步 FAQ](https://bear.app/faq/syncing-privacy/)、[冲突 FAQ](https://bear.app/faq/how-bear-pro-handles-conflicted-notes/) |

---

## 5. 搜索

来源：[搜索 FAQ](https://bear.app/faq/how-to-search-notes-in-bear/)

**运算符**

- 整句：`"…"`
- 或：`OR`（官方例子写成小写 or）
- 排除：`-词`、`-"整句"`、`-@code`
- 标签：`#tag`；`!#tag` 不含子标签；`-#tag` 排除；`#*/tag` 只搜子标签
- 数字或日期形式的标签，搜索时结尾也要带 `#`

**特殊搜索**

- 标签：`@tagged`、`@untagged`
- 修改时间：`@today`、`@yesterday`、`@lastXdays`
- 创建时间：`@ctoday`、`@createdXdays`
- 附件：`@images`、`@files`、`@attachments`
- 待办和代码：`@task`、`@todo`、`@done`、`@code`
- 范围：`@title`（只搜标题）、`@ocr`（只搜附件，要 Pro）
- 状态：`@locked`、`@pinned`、`@readonly`
- 空笔记：`@untitled`、`@empty`
- 链接：`@wikilinks`、`@backlinks`
- 按日期：`@date(2018-09-05 / 09-2018 / 2018 / <… / >…)`、`@cdate(…)`。括号前不能有空格；日期可以写 ISO 格式，也可以写本机的格式
- 以上可以组合使用

**中文写法**：@有标签、@无标签、@今天、@今天创建、@昨天、@前十天、@已创建十天、@图片、@文件、@附件、@任务、@待办、@完成、@代码、@已加密、@置顶、@标题、@维基链接、@反向链接、@日期（20180915）、@创建日期（20180915）。

**其他行为**

- 边打字边出结果；结果里高亮特殊搜索词、标签和引号里的整句。
- 打开一篇结果后，用 ⌘G 在命中处之间跳。搜索还开着时打开笔记，自动滚到第一处命中（[2.3.11](https://blog.bear.app/2025/02/bear-2-3-11-update-read-only-mode-new-themes-and-more/)）。
- 搜索范围：选中某个标签就在这个标签里搜；归档的笔记要先选 Archive；开了 Workspace 就只在 Workspace 里搜。
- Quick Open（⌘O）：直接打字搜笔记标题；打 `#tag` 跳到标签；打 `@today` 这类写法跳到侧栏的对应项。
- **没有保存搜索的功能**，社区一直在要（[15592](https://community.bear.app/t/15592)、[13144](https://community.bear.app/t/13144)）。替代办法：在笔记里放 `bear://x-callback-url/search?term=…` 链接，或者用 Search 小组件。

---

## 6. 外观与排版

- **主题**：免费三个（Red Graphite、High Contrast、Dark Graphite）。Pro 有三十个左右，包括 Solarized、Dracula、Nord、Rosé Pine、Tokyo Night、Gruvbox、Catppuccin、Everforest、Shibuya 系列、Notes / Dark Notes、Academia 等（[FAQ](https://bear.app/faq/about-free-and-pro-themes-in-bear/)、[2.3.11 博客](https://blog.bear.app/2025/02/bear-2-3-11-update-read-only-mode-new-themes-and-more/)）。
- **排版**（Settings → Typography）：正文、标题、代码的字体可以分别选任何装了的字体；可以调字号、行高、行宽、段间距、段首缩进（[FAQ](https://bear.app/faq/typography-options/)）。默认字体是自家的 Bear Sans，由 Clarika 改来（[博客](https://blog.bear.app/2023/08/learn-about-our-new-custom-font-bear-sans/)）。
- **其他**：隐藏 Markdown 的开关；⌘+ / ⌘- / ⌘0 缩放；Pro 可以换 App 图标；高亮颜色不随主题变；2.6 起是 Liquid Glass 界面。自定义主题或 CSS：未确认。

---

## 7. 矛盾和未确认的说法

- 表格加行、加列的快捷键（见 1d），Mac 以方向键版为准。
- 退出 Workspace 的快捷键：2.9.2 改过，现在是哪个键不知道。
- 侧栏的 Today：[侧栏 FAQ](https://bear.app/faq/about-the-sidebar-in-bear/) 说是"今天创建的"，而 `@today` 搜的是"今天修改的"。
- 未确认的功能：
  - 表格里 Tab 怎么走。
  - 没选中文字时会不会自动补右括号。
  - 大小写、排序行这类文本变换。
  - 图片对齐、图片说明、图库视图。
  - 图片宽度那段注释的具体格式。
  - 黄、紫两种高亮用哪个字符。
  - Bear 有没有往"服务"菜单里加东西。
  - 认不认 `::mark::`、`++u++`。
