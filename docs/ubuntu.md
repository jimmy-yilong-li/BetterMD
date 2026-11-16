# Ubuntu 使用与开发

Ubuntu 版用 Electron 做桌面外壳，与 macOS 和 VS Code 版本共用 `editor/` 的 CodeMirror 6 + KaTeX 编辑器。已在 Ubuntu 26.04 x86_64 验证；其他 Ubuntu 版本和 ARM64 尚未实测。

## 构建和安装

需要 Node.js 22.12 以上、npm、Ubuntu 图形桌面。构建时联网下载 npm 依赖、Electron 和打包工具；本地编辑无需联网。

```bash
scripts/ubuntu.sh package
sudo apt install ./build/ubuntu/BetterMD-0.2.0-linux-amd64.deb
bettermd
```

产物位于 `build/ubuntu/`：`.deb` 安装包、`tar.gz` 便携目录和 `linux-unpacked/`。`.deb` 带桌面启动入口、各个尺寸的图标和 Chromium 沙箱的安装配置；装过旧版本的，直接再装一次新的 `.deb` 就是升级。便携版直接解压运行 `bettermd`，但仍需按下文配置主机所需的沙箱权限。脚本不修改系统设置，不会自动安装包。

装好以后应用列表和程序坞里是朱印图标。图标换了要重新生成各个尺寸：`scripts/make-linux-icons.sh`（结果在 `desktop/icons/`，进 git）。

## 笔记库

- 默认笔记库：`~/我的笔记`。侧栏底下的菜单按钮 →「文件 → 选择笔记库位置…」（Ctrl+O）可切换，不搬动旧笔记库里的文件。
- 可直接打开从 Mac 复制过来的完整笔记库，包括「附件」「废纸篓」和 `.bettermd`。
- 笔记仍是 `.md` 文件，文件夹就是真实目录；标题改动后，离开笔记时调整文件名。置顶和废纸篓来源使用原来的 `.bettermd/state.json`。
- VS Code 的 `bettermd.libraryPath` 留空时读取 Ubuntu App 的配置；也可手动指定同一目录。已有的绑定记录在笔记改名、移动、进出废纸篓、文件夹改名时更新，绑定同步仍由 VS Code 插件执行。
- App 设置位于 `${XDG_CONFIG_HOME:-~/.config}/BetterMD/settings.json`，笔记写不进去而退出时，备用正文存入同目录的「没存下的笔记/」，下次启动提示查看。

## 同步

Linux 不能直接访问 iCloud。让几台电脑上的笔记保持一致有两种办法，都在侧栏底下的同步按钮里。

### 用 GitHub（git）

1. 在 GitHub 上建一个**私有**仓库（空的就行）。
2. 确认这台电脑能用 git 访问它：配好 SSH key（`ssh -T git@github.com` 能认出你），或者用 `gh auth login`。App 不存密码和令牌，用的是系统里 git 自己的凭据。没装 git 的先 `sudo apt install git`。
3. 点侧栏底下的「开启同步…」，填仓库地址（比如 `git@github.com:你的名字/notes.git`），点「开始同步」。

之后不用管它：改完笔记十几秒后自动提交、推送；App 开着时每两分钟、回到窗口时拉一次别的电脑上的改动；退出前再推一次。侧栏底下那行小字是状态，点开可以「立即同步」或「停止同步」（停止不删任何东西）。

- 第二台电脑：装好 BetterMD，同样填这个地址，仓库里的笔记就下来了。两台电脑原来各自有笔记也可以，都会留下。
- 两台电脑改了同一篇的不同地方，会合成一份。把同一段改得不一样时，以后改的为准，另一版另存成「标题（别处的版本）.md」，两份都在，并有提示。
- 离线时照常写，改动提交在本机，联网以后自动补上。
- 笔记库就是普通的 git 仓库：每次改动都在历史里（`git log`），误删、改坏了可以找回。别的 git 服务、NAS 或 U 盘上的裸仓库也可以当远端。
- GitHub 不收 100MB 以上的文件：95MB 以上的附件留在本机不同步，并有提示。
- 笔记不加密，仓库请建成私有的。
- 没有界面的电脑、或者 Mac 上，可以用命令同步一次：`node desktop/gitsync.cjs <笔记库路径> [仓库地址]`（第一次带上地址）。macOS App 里还没有这个功能。

### 用同步盘

把笔记库放进 Dropbox、坚果云、Syncthing 这类工具同步的文件夹：菜单「选择笔记库位置…」选那个文件夹就行，BetterMD 不用设置。

## 操作

三栏界面：暖白纸色、朱砂强调色和宋体排版，深浅主题默认跟随系统，也可在菜单「显示」里指定。窗口没有系统的标题栏：每栏顶上那一条可以拖动窗口，最小化、最大化、关闭在右上角；全部命令在侧栏底下的菜单按钮里。想用系统标题栏和菜单栏：「显示 → 使用系统标题栏和菜单栏」，下次打开生效。

建议安装 `fonts-noto-cjk`（中文正文用 Noto 宋体）；想让引用显示成楷体，再装 `fonts-arphic-ukai` 或霞鹜文楷。

- **侧栏**：我的笔记、文件夹（信封）、未分类、待办、标签、废纸篓。把鼠标移到「我的笔记」上点「+」新建文件夹，直接在侧栏里输入名字。文件夹上右键可以新建笔记、新建子文件夹、重命名（F2）、删除（里面的笔记进废纸篓）。
- **列表**：直接打字就开始搜索；在文件夹里时可以按标签筛选。笔记可以拖到侧栏的文件夹或废纸篓上；右键菜单里有置顶、移动、复制文件路径、移到废纸篓。
- **撤销**：移动、删除后右下角的提示条上有「撤销」。废纸篓里的笔记只读，可以放回原处；「清空」和「永久删除」放不回来，会先问一句。

常用快捷键：Ctrl+N 新建、Ctrl+Shift+F 搜索、Ctrl+F 文内查找、Ctrl+B 粗体、Ctrl+1…6 标题、Ctrl+T 待办、Ctrl+Shift+E 公式、Ctrl+Shift+C 代码块、Ctrl+Shift+V 插入附件、Ctrl+Shift+M 移动、Ctrl+Shift+P 置顶、Ctrl+Shift+D 专注、Ctrl+Alt+S 侧栏、Ctrl+Alt+1/2/3/0 我的笔记/未分类/待办/废纸篓。Ctrl+点击链接或标签跳转，Ctrl+Enter 从正文回到列表。完整的表：Ctrl+/。

和 macOS 版相比还没有的：玻璃材质、列表里切换和移走笔记的动画、多选。

## 开发与 Chromium 沙箱

```bash
scripts/ubuntu.sh start --libraryPath "$PWD/.build/ubuntu-dev-library"
```

Ubuntu 24.04 以后默认不让普通程序建用户命名空间，Chromium 的沙箱要靠 root 所有、权限 4755 的 `chrome-sandbox` 辅助程序；npm 装下来的 Electron 自带的那个不是，直接启动会报 `SUID sandbox helper binary ... not configured correctly`。

- 机器上装了 Chrome 或 Chromium 时不用管：启动脚本和测试会借用它已经配好的辅助程序（`desktop/electron-dev.cjs`：把 Electron 运行时硬链接一份、不带它自己的 `chrome-sandbox`，再用 `CHROME_DEVEL_SANDBOX` 指过去）。不改系统设置，不用 sudo，也不关沙箱。
- 没装的话，配一次下载下来的辅助程序（重新安装 Electron 后要再配）：

  ```bash
  sudo chown root:root desktop/node_modules/electron/dist/chrome-sandbox
  sudo chmod 4755 desktop/node_modules/electron/dist/chrome-sandbox
  ```

安装 `.deb` 会配置安装位置需要的沙箱和 AppArmor。无需关闭系统 AppArmor 或给 App 添加 `--no-sandbox`。网页启用 context isolation 和 renderer sandbox，不开放 Node API；主进程验证调用来源，只提供笔记操作；本地资源通过 `bettermd://` 供应，禁止目录穿越及库内符号链接。

代码怎么分的：

| 文件 | 管什么 |
|---|---|
| `desktop/main.cjs` | 主进程：窗口、菜单、`bettermd://`、命名操作、自动保存、文件监听、同步的时机 |
| `desktop/store.cjs` | 笔记库的读写：增量重读、保存前比对、移动改名回滚、文件夹、废纸篓 |
| `desktop/gitsync.cjs` | git 同步：提交、拉取、合并规则、推送（不依赖 Electron，可以单独跑） |
| `desktop/markdown.cjs` · `paths.cjs` | 链接改写、摘要和搜索片段；库内路径检查、原子写入 |
| `desktop/ui/` | 界面：`index.html`、`app.css`（纸墨样式）、`icons.js`（图标）、`renderer.js`（三栏的交互） |
| `desktop/icons/` | 各尺寸的 App 图标（`scripts/make-linux-icons.sh` 生成） |

## 验证

需要 Chrome / Chromium；脚本自动寻找浏览器，也可用 `CHROME_BIN=/path/to/chromium` 指定。Electron 的测试窗口隐藏并使用临时笔记库，仍需要图形会话（CI 可用 Xvfb）。同步的测试用本机的裸仓库当远端，不联网，不读你自己的 git 设置。

```bash
scripts/ubuntu.sh test                    # 全部 Linux 适用测试
npm --prefix desktop test                # 文件数据层和 git 同步，纯 Node，不需要图形会话
npm --prefix desktop run test:smoke      # 真实 Electron：编辑、保存、搜索、文件夹、同步、快捷键
node desktop/test/smoke.cjs "$PWD/build/ubuntu/linux-unpacked/bettermd"  # 验证打包产物
```

`scripts/test.sh` 在 Linux 跳过仅 macOS 能运行的 SwiftUI 测试，继续跑共用编辑器、Chrome 按键、VS Code 和 Electron 测试。桌面测试截图写入 `build/ubuntu/smoke-light.png`。测试覆盖保存冲突副本、别处改了正开着的笔记、CRLF/BOM/权限保留、原子写入失败、外部删除、移动回滚、文件夹改名和删除、清空废纸篓、超长文件名、路径限制、跨平台元数据，以及两台电脑之间同步的各种情况（各改各的、改了同一段、一边删一边改、离线、同时推送、合并被打断）。

窗口右上角的按钮、菜单按钮弹出的菜单是系统画的，自动测试的截图里没有，改了相关代码要在真窗口里看一眼。
