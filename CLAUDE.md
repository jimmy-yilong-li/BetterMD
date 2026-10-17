# BetterMD

Bear 式的 Markdown 笔记 App，只做 macOS，笔记放在 iCloud 云盘里同步。沟通和文档都用中文。

产品名写作 **BetterMD**（B、M、D 大写），文档、界面和代码里都这样写。

## 项目文档规则

每次工作都要遵守：

1. **开始前**先读 `design.md`，再读 `progress.md` 最上面一条。
2. **design.md 只描述当前设计。** 设计一有变化就更新全文，让它始终是最新的，不在里面写历史。
3. **progress.md 是进度日志。** 新条目加在最上面，旧条目不改。只要改了设计、改了代码或删了东西，收尾时就加一条。
4. **design.md 改了，progress.md 必须同时记一条**，写清改了什么、为什么改。这样 design.md 覆盖重写，也不会丢掉来龙去脉。
5. **时间用命令取**：`date '+%Y-%m-%d %H:%M'`，不要估。
6. 本文件只放规则，不放设计内容。设计以 `design.md` 为准，避免两处说法不一致。

## progress.md 条目格式

```markdown
## YYYY-MM-DD HH:MM — 一句话标题

**做了什么**
- 这次完成的工作：新增的功能、文档、决策

**改动了什么**
- 对已有设计或代码的修改，写清从什么改成什么

**删掉了什么 · 为什么**
- 删除的代码、功能、文件，或放弃的方案，每条都写原因；没有就写“无”

**下一步**
1. 接下来要做的事，按优先级排
```

## 开发命令

- 跑全部测试：`scripts/test.sh`（Swift、编辑器、浏览器按键、VS Code 插件，一条命令；不开窗口、不开 App、不开 VS Code）
- 只跑一部分：`swift test`；编辑器（`editor/`）的测试：`npm --prefix editor test`；编辑器在真浏览器里的打字测试：`npm --prefix editor run test:browser`（先 `npm --prefix editor run build`）
- 打包成 App：`scripts/bundle.sh`（默认 release；先打包编辑器网页，再编译 Swift；产物在 `build/BetterMD.app`，`build/` 不进 git）
- 用测试笔记库启动（不碰真正的「我的笔记」）：`open -n build/BetterMD.app --args -libraryPath "$PWD/.build/dev-library"`
- 不开屏幕录制权限也能看界面：再加 `-snapshotPath /某处/图.png`，两秒多以后存下窗口图片、编辑器图片（`图-editor.png`）和一份 `.txt`（每个列表的行数、AppModel 里的数据、编辑器里渲染出了什么），然后自动退出。可选 `-snapshotNote 标题里的字` 先选中某篇，`-snapshotAppearance dark` 用深色，`-snapshotSelect "起|止"` 在编辑器里选中一段。注意：SwiftUI 列表的内容画不进图片，列表要看 `.txt`。
- 只看编辑器：`node scripts/editor-shot.mjs 笔记.md 图.png [--dark] [--cursor 文字] [--select 起 止] [--size 宽x高]`（无头 Chrome；先 `npm --prefix editor run build`）
- VS Code 插件（`vscode/`）：打包 `scripts/vscode.sh`，加 `--install` 装进 VS Code（装完要在 VS Code 里重新加载窗口）；测试 `node --test vscode/test/lib.test.js vscode/test/notes.test.js vscode/test/library.test.js`，和编辑器的同步测试 `node vscode/test/sync.mjs`（无头 Chrome，不开 VS Code；先 `npm --prefix editor run build`）
- 实现计划在 `docs/superpowers/plans/`
