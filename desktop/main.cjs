const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, protocol, shell, clipboard } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { NoteStore } = require('./store.cjs');
const { GitSync, validURL } = require('./gitsync.cjs');
const { inside, atomic } = require('./paths.cjs');

const PAGE = 'bettermd://app/index.html';
const BAR = 48; // 三栏顶上那一条的高度；窗口按钮（最小化、最大化、关闭）画在这一条的右上角
const option = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const temporaryConfig = option('--user-data-dir');
if (temporaryConfig) app.setPath('userData', path.resolve(temporaryConfig));
app.setName('BetterMD');
app.setDesktopName('bettermd.desktop');
protocol.registerSchemesAsPrivileged([{ scheme: 'bettermd', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

let window, store, watcher, watchTimer, saveTimer, pollTimer;
let quitting = false, closing = false, lastSnapshot = '';
const notices = [];
const smoke = process.argv.includes('--smoke-test');
// 测试用：真窗口但不显示（--smoke-test 是离屏渲染，没有窗口按钮和菜单快捷键）
const hidden = smoke || process.argv.includes('--hidden-window');
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function settings() {
  try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') notify(`设置读取失败，使用默认位置：${error.message}`); return {}; }
}
function saveSettings(change) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  const next = change(settings());
  atomic(settingsFile(), JSON.stringify(next, null, 2) + '\n');
  return next;
}
function notify(text) {
  notices.push(text);
  if (notices.length > 100) notices.shift();
  window?.webContents.send('bettermd:event', { type: 'notice', text });
}
const emit = message => window?.webContents.send('bettermd:event', message);
/** 清单变了才发给界面；返回变没变。 */
function snapshot(force = false) {
  const data = store.snapshot();
  const serialized = JSON.stringify(data);
  const changed = serialized !== lastSnapshot;
  if (force || changed) { lastSnapshot = serialized; emit({ type: 'snapshot', data }); }
  return changed;
}
/** 重新看一遍磁盘。别的程序改了笔记（不是同步拉下来的），过一会儿也同步出去。 */
function refresh(fromSync = false) {
  try { store.reload(); if (snapshot() && !fromSync) syncSoon(); } catch (error) { notify(`刷新笔记库失败：${error.message}`); }
}
function watch() {
  watcher?.close();
  clearTimeout(watchTimer);
  clearInterval(pollTimer);
  try {
    watcher = fs.watch(store.root, { recursive: true }, (_kind, file) => {
      // 自己写文件用的临时文件、图片、git 仓库里的东西不用重读
      if (file && (file.includes('.bettermd-') || file.startsWith('附件/') || file === '.git' || file.startsWith('.git/'))) return;
      clearTimeout(watchTimer);
      watchTimer = setTimeout(refresh, 500);
    });
    watcher.on('error', error => notify(`文件监听暂不可用，继续定时刷新：${error.message}`));
  } catch { /* 不支持递归监听的文件系统仍由定时刷新兜底。 */ }
  pollTimer = setInterval(refresh, 3000);
}
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { if (store.flush()) syncSoon(); snapshot(); emit({ type: 'saved' }); }
    catch (error) { notify(error.message); emit({ type: 'saveFailed' }); }
  }, 600);
}

// ---- 同步（git）：改完 15 秒后提交并推送；开着的时候每 2 分钟、回到窗口时拉一次 ----

let engine = null, syncTimer, syncRunning = null, syncAgain = false, lastAttempt = 0;
const syncStatus = { enabled: false, state: 'off', url: null, last: null, error: null };
const syncEnabled = () => settings().sync?.[store.root]?.kind === 'git';
const emitSync = () => emit({ type: 'sync', status: { ...syncStatus } });

async function configureSync() {
  clearTimeout(syncTimer);
  engine = null;
  Object.assign(syncStatus, { enabled: false, state: 'off', url: null, last: null, error: null });
  if (syncEnabled()) {
    engine = new GitSync(store.root);
    Object.assign(syncStatus, { enabled: true, state: 'idle' });
    try { syncStatus.url = (await engine.state()).remote ?? null; } catch { /* 同步时会再报 */ }
    syncSoon(1500);
  }
  emitSync();
}

function syncSoon(delay = 15000) {
  if (!engine) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => runSync().catch(() => {}), delay);
}

/** 同步一次。手动点的（manual）出错一定提示；自动的只在出错原因变了的时候提示一次，不反复打扰。 */
function runSync({ manual = false, signal } = {}) {
  if (!engine) return Promise.resolve(null);
  if (syncRunning) { syncAgain = true; return syncRunning; }
  const current = engine;
  syncRunning = (async () => {
    clearTimeout(syncTimer);
    lastAttempt = Date.now();
    try { store.flush(); } catch { /* 存不下的照旧留在内存里，先同步已经在磁盘上的 */ }
    syncStatus.state = 'syncing'; emitSync();
    try {
      const result = await current.sync({ signal });
      if (engine !== current) return null; // 同步的时候换了笔记库
      Object.assign(syncStatus, { state: 'idle', last: Date.now(), error: null });
      if (result.pulled.length) refresh(true);
      for (const c of result.conflicts) notify(`两台电脑都改了「${c.file}」：以${c.kept}后改的为准，另一版另存为「${c.copy}」`);
      for (const file of result.skipped) notify(`「${file}」超过 GitHub 的 100MB 限制，没有同步`);
      return result;
    } catch (error) {
      if (engine !== current) return null;
      const changed = syncStatus.error !== error.message;
      Object.assign(syncStatus, { state: error.kind === 'offline' ? 'offline' : 'error', error: error.message });
      if (manual) throw error; // 手动点的：错误交给界面显示在同步面板里
      if (changed && error.kind !== 'offline') notify(`同步没成功：${error.message}`);
      return null;
    } finally {
      syncRunning = null;
      emitSync();
      if (engine === current && !quitting) syncSoon(syncAgain ? 3000 : 120000);
      syncAgain = false;
    }
  })();
  return syncRunning;
}

const safeURL = value => {
  try { const url = new URL(value); return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
};

/** 改了笔记库里的东西的操作：做完以后过一会儿同步出去。 */
const MUTATING = new Set(['create', 'folder', 'renameFolder', 'deleteFolder', 'pin', 'trash', 'restore', 'restoreMany', 'move', 'purge', 'attach', 'chooseAttachments']);

async function action(kind, args = {}) {
  if (MUTATING.has(kind)) syncSoon();
  switch (kind) {
    case 'ready':
      for (const note of store.notes.values()) note.seq = 0;
      store.received = 0;
      lastSnapshot = JSON.stringify(store.snapshot());
      return { ...JSON.parse(lastSnapshot), notices, sync: { ...syncStatus }, frameless: !nativeFrame(), version: app.getVersion() };
    case 'read': return store.read(args.id);
    case 'seen': store.seen(args.id, args.rev); return null;
    case 'search': return store.search(args.query);
    case 'change': store.stage(args); saveSoon(); return null;
    case 'flush': if (store.flush()) syncSoon(); snapshot(); return null;
    case 'refresh': store.flush(); refresh(); return null;
    case 'finalize': { const id = store.finalize(args.id); if (id !== args.id) syncSoon(); snapshot(); return id; }
    case 'create': { store.flush(); const id = store.create(args.folder, args.tag); snapshot(); return id; }
    case 'folder': { const folder = store.createFolder(args.parent ?? '', args.name); snapshot(); return folder; }
    case 'renameFolder': { const folder = store.renameFolder(args.id, args.name); snapshot(); return folder; }
    case 'deleteFolder': { const result = store.deleteFolder(args.id); snapshot(); return result; }
    case 'pin': store.pin(args.id); snapshot(); return null;
    case 'trash': { const id = store.trash(args.id); snapshot(); return id; }
    case 'restore': { const id = store.restore(args.id); snapshot(); return id; }
    case 'restoreMany': {
      const restored = [];
      try { for (const id of args.ids) if (store.notes.has(id)) restored.push(store.restore(id)); }
      finally { snapshot(); }
      return restored;
    }
    case 'purge': {
      const count = args.id === undefined ? [...store.notes.keys()].filter(id => id.startsWith('废纸篓/')).length : 1;
      if (!count) return 0;
      const answer = await dialog.showMessageBox(window, { type: 'warning', buttons: ['取消', '永久删除'], defaultId: 0, cancelId: 0, noLink: true,
        message: args.id === undefined ? `永久删除废纸篓里的 ${count} 篇笔记？` : '永久删除这篇笔记？',
        detail: `删掉以后放不回来了。${syncStatus.enabled ? '（同步仓库的历史里还查得到。）' : ''}` });
      if (answer.response !== 1) return 0;
      const deleted = store.purge(args.id); snapshot(); return deleted;
    }
    case 'move': { const id = store.move(args.id, args.folder); snapshot(); return id; }
    case 'attach': return store.attach(args.id, args.name, args.mime, args.data);
    case 'chooseAttachments': {
      store.get(args.id, true);
      const result = await dialog.showOpenDialog(window, { title: '插入图片或文件', properties: ['openFile', 'multiSelections'] });
      return result.canceled ? [] : result.filePaths.map(file => {
        const stat = fs.statSync(file);
        if (stat.size > 64 * 1024 * 1024) throw new Error('附件超过 64 MiB');
        const ext = path.extname(file).slice(1).toLowerCase();
        const mime = /^(png|jpe?g|gif|webp|svg|avif|bmp)$/.test(ext) ? `image/${ext}` : 'application/octet-stream';
        return store.attach(args.id, path.basename(file), mime, fs.readFileSync(file).toString('base64'));
      });
    }
    case 'chooseLibrary': {
      store.flush(); // 保存失败时不弹选择框，也不清内存。
      const result = await dialog.showOpenDialog(window, { title: '选择笔记库位置', defaultPath: store.root, properties: ['openDirectory', 'createDirectory'] });
      if (result.canceled) return false;
      const next = new NoteStore(result.filePaths[0], notify);
      // 对话框打开期间收到的最后一笔输入也必须存完。
      store.flush();
      saveSettings(config => ({ ...config, libraryPath: next.root }));
      store = next; watch(); snapshot(true);
      await configureSync();
      return true;
    }
    case 'reveal': {
      const file = args.folder !== undefined ? store.validFolder(args.folder) : args.id ? inside(store.root, store.get(args.id).id) : store.root;
      shell.showItemInFolder(file); return null;
    }
    case 'copyPath': await clipboard.writeText(inside(store.root, store.get(args.id).id)); return null;
    case 'open': {
      if (args.url) { const url = safeURL(args.url); if (url) await shell.openExternal(url); return null; }
      if (!args.path) return null;
      const file = inside(store.root, args.path);
      if (store.notes.has(args.path)) return { id: args.path };
      if (!fs.existsSync(file)) throw new Error('链接指向的文件不存在');
      // 脚本、桌面启动器等只在文件管理器中显示。
      if (/\.(png|jpe?g|gif|webp|avif|bmp|pdf|txt)$/i.test(file)) {
        const error = await shell.openPath(file); if (error) throw new Error(error);
      } else shell.showItemInFolder(file);
      return null;
    }
    case 'theme':
      if (!['system', 'light', 'dark'].includes(args.value)) throw new Error('无效主题');
      nativeTheme.themeSource = args.value;
      saveSettings(config => ({ ...config, theme: args.value }));
      return null;
    case 'zoom': {
      const level = Math.max(-3, Math.min(5, window.webContents.getZoomLevel() + (args.delta > 0 ? 0.5 : -0.5)));
      window.webContents.setZoomLevel(level); return level;
    }
    case 'menu': Menu.getApplicationMenu()?.popup({ window, ...(Number.isFinite(args.x) && Number.isFinite(args.y) ? { x: Math.round(args.x), y: Math.round(args.y) } : {}) }); return null;
    case 'syncInfo': {
      // 同步面板要显示的：现在的状态；这个笔记库本来就是 git 仓库时，把它的远端地址先填上
      const probe = await new GitSync(store.root).state();
      return { ...syncStatus, available: probe.available, repo: !!probe.repo, nested: !!probe.nested, remote: probe.remote ?? null, root: store.root };
    }
    case 'syncSetup': {
      if (!validURL(args.url)) throw new Error('仓库地址看起来不对，应该像 git@github.com:名字/仓库.git');
      store.flush();
      const next = new GitSync(store.root);
      Object.assign(syncStatus, { state: 'syncing', error: null }); emitSync();
      try {
        const result = await next.setup(args.url.trim());
        saveSettings(config => ({ ...config, sync: { ...config.sync, [store.root]: { kind: 'git' } } }));
        engine = next;
        Object.assign(syncStatus, { enabled: true, state: 'idle', url: args.url.trim(), last: Date.now(), error: null });
        refresh(true);
        for (const c of result.conflicts) notify(`两边都有「${c.file}」：以${c.kept}后改的为准，另一版另存为「${c.copy}」`);
        syncSoon(120000);
        return { ...syncStatus, pulled: result.pulled.length };
      } catch (error) {
        Object.assign(syncStatus, { state: engine ? 'error' : 'off', error: engine ? error.message : null });
        throw error;
      } finally { emitSync(); }
    }
    case 'syncNow': await runSync({ manual: true }); return { ...syncStatus };
    case 'syncDisable': {
      saveSettings(config => { const sync = { ...config.sync }; delete sync[store.root]; return { ...config, sync }; });
      await configureSync();
      return { ...syncStatus };
    }
    case 'closed': return closeSafely();
    case 'cancelClose': closing = false; return null;
    default: throw new Error('未知的笔记操作');
  }
}

async function closeSafely() {
  try {
    store.flush();
    for (const id of [...store.notes.keys()]) {
      try { store.finalize(id); } catch (error) { notify(`正文已保存，文件名未更新：${error.message}`); }
    }
  }
  catch (error) {
    try {
      const recovered = store.recover(path.join(app.getPath('userData'), '没存下的笔记'));
      dialog.showMessageBoxSync(window, { type: 'warning', title: '笔记已另存', message: '笔记库保存失败，未保存的文字已另存到：', detail: recovered.join('\n') + '\n\n' + error.message });
    } catch (backupError) {
      notify(`暂时不能退出：笔记和备用目录都写不进去。${backupError.message}`);
      closing = false; return false;
    }
  }
  quitting = true;
  // 退出前把刚改的推上去，最多等 8 秒；没推完的已经提交在本机，下次打开接着推
  if (engine) {
    window?.hide();
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 8000);
    try { if (syncRunning) await Promise.race([syncRunning, new Promise(resolve => setTimeout(resolve, 8000))]); await runSync({ signal: abort.signal }); }
    catch { /* 下次再同步 */ }
    finally { clearTimeout(timer); }
  }
  if (!smoke && window && !window.isDestroyed() && !window.isMaximized() && !window.isFullScreen()) {
    try { const [width, height] = window.getSize(); saveSettings(config => ({ ...config, window: { width, height } })); } catch { /* 记不下窗口大小不要紧 */ }
  }
  app.quit();
  return true;
}

/** 用系统自带的标题栏和菜单栏（设置里打开，或启动时加 --native-frame）；默认把纸色铺到窗口顶上。 */
const nativeFrame = () => process.argv.includes('--native-frame') || settings().nativeFrame === true;

function overlay() {
  const dark = nativeTheme.shouldUseDarkColors;
  return { color: dark ? '#1A1816' : '#FBF8F2', symbolColor: dark ? '#AAA194' : '#766E63', height: BAR };
}

function menu() {
  const cmd = (label, name, accelerator) => ({ label, accelerator, click: () => emit({ type: 'command', name }) });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '文件', submenu: [cmd('新建笔记', 'new', 'Ctrl+N'), cmd('新建文件夹…', 'folder'), { type: 'separator' }, cmd('同步…', 'sync'), cmd('立即同步', 'syncNow'), { type: 'separator' },
      cmd('选择笔记库位置…', 'library', 'Ctrl+O'), cmd('在文件管理器中显示笔记库', 'revealLibrary'), { type: 'separator' }, cmd('保存', 'save', 'Ctrl+S'), cmd('关闭窗口', 'close', 'Ctrl+W'), { role: 'quit', label: '退出', accelerator: 'Ctrl+Q' }] },
    { label: '编辑', submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }, { type: 'separator' }, cmd('在笔记中查找', 'format:find'), cmd('查找并替换', 'format:replace'), cmd('搜索笔记', 'search', 'Ctrl+Shift+F')] },
    { label: '格式', submenu: [cmd('粗体', 'format:bold'), cmd('斜体', 'format:italic'), cmd('删除线', 'format:strike'), cmd('行内代码', 'format:code'), { type: 'separator' }, ...[1, 2, 3, 4, 5, 6].map(n => cmd(`${n} 级标题`, `format:h${n}`)), cmd('正文', 'format:paragraph'), { type: 'separator' }, ...[['列表', 'list'], ['编号列表', 'numbered'], ['待办', 'todo'], ['引用', 'quote'], ['分割线', 'rule'], ['代码块', 'codeBlock'], ['表格', 'table'], ['公式', 'math'], ['链接', 'link']].map(([label, name]) => cmd(label, `format:${name}`)), cmd('插入图片或文件…', 'attach', 'Ctrl+Shift+V')] },
    { label: '笔记', submenu: [cmd('置顶 / 取消置顶', 'pin', 'Ctrl+Shift+P'), cmd('移动到文件夹…', 'move', 'Ctrl+Shift+M'), cmd('移到废纸篓', 'trash'), cmd('放回原处', 'restore', 'Ctrl+Shift+R'), cmd('复制文件路径', 'copyPath'), { type: 'separator' },
      cmd('我的笔记', 'scope:all', 'Ctrl+Alt+1'), cmd('未分类', 'scope:unfiled', 'Ctrl+Alt+2'), cmd('待办', 'scope:todo', 'Ctrl+Alt+3'), cmd('废纸篓', 'scope:trash', 'Ctrl+Alt+0'), { type: 'separator' }, cmd('清空废纸篓…', 'emptyTrash')] },
    { label: '显示', submenu: [cmd('专注模式', 'focus', 'Ctrl+Shift+D'), cmd('显示 / 隐藏侧栏', 'sidebar', 'Ctrl+Alt+S'), { type: 'separator' }, cmd('跟随系统主题', 'theme:system'), cmd('浅色', 'theme:light'), cmd('深色', 'theme:dark'), { type: 'separator' },
      { role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }, { role: 'togglefullscreen', label: '全屏' }, { type: 'separator' },
      { label: '使用系统标题栏和菜单栏', type: 'checkbox', checked: nativeFrame(), click: item => { saveSettings(config => ({ ...config, nativeFrame: item.checked })); notify('下次打开 BetterMD 时生效'); } }] },
    { label: '帮助', submenu: [cmd('键盘快捷键', 'help', 'Ctrl+/'), cmd('关于 BetterMD', 'about')] },
  ]));
}

app.whenReady().then(async () => {
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  app.on('second-instance', () => { window?.restore(); window?.focus(); });
  const config = settings();
  store = new NoteStore(path.resolve(option('--libraryPath') ?? option('-libraryPath') ?? config.libraryPath ?? path.join(app.getPath('home'), '我的笔记')), notify);
  nativeTheme.themeSource = ['system', 'light', 'dark'].includes(config.theme) ? config.theme : 'system';
  protocol.handle('bettermd', async request => {
    try {
      const url = new URL(request.url);
      let file;
      if (url.host === 'app') {
        const rel = decodeURIComponent(url.pathname).slice(1) || 'index.html';
        file = rel.startsWith('editor/') ? inside(path.join(__dirname, 'resources/editor'), rel.slice(7)) : inside(path.join(__dirname, 'ui'), rel);
      } else if (url.host === 'library') {
        file = inside(store.root, decodeURIComponent(url.pathname).slice(1));
        if (!/\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i.test(file)) return new Response('Forbidden', { status: 403 });
      } else return new Response('Not found', { status: 404 });
      const ext = path.extname(file).slice(1).toLowerCase();
      const mime = { html: 'text/html; charset=utf-8', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf' }[ext] ?? 'application/octet-stream';
      // 图片可能很大：不在主进程里同步读，免得卡住保存和按键
      return new Response(await fs.promises.readFile(file), { headers: { 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' bettermd: data: https: http:; font-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'" } });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  const framed = nativeFrame();
  const size = config.window && Number.isInteger(config.window.width) && Number.isInteger(config.window.height) ? config.window : { width: 1280, height: 850 };
  window = new BrowserWindow({ width: Math.max(760, size.width), height: Math.max(500, size.height), minWidth: 760, minHeight: 500, show: !hidden,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1A1816' : '#FBF8F2', title: 'BetterMD', icon: path.join(__dirname, 'icons/256x256.png'),
    // 默认不要系统的标题栏：纸色一直铺到窗口顶上，窗口按钮由系统画在右上角（位置跟着系统设置）
    ...(framed ? {} : { titleBarStyle: 'hidden', titleBarOverlay: overlay() }),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, spellcheck: false,
      offscreen: smoke } });
  // 菜单栏收起来（快捷键照常能用）；全部命令在侧栏底下的菜单按钮里
  if (!framed) window.setMenuBarVisibility(false);
  nativeTheme.on('updated', () => { if (!framed && !window.isDestroyed()) { try { window.setTitleBarOverlay(overlay()); } catch { /* 老系统不支持就保持原样 */ } } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.on('render-process-gone', (_event, details) => { try { store.flush(); } catch (error) { notify(error.message); } console.error('编辑器进程退出', details.reason); });
  ipcMain.handle('bettermd:action', async (event, kind, args) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== PAGE) throw new Error('不支持的调用来源');
    try { return { ok: true, value: await action(kind, args) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  window.on('close', event => {
    if (quitting) return;
    event.preventDefault();
    if (!closing) { closing = true; emit({ type: 'command', name: 'close' }); }
  });
  // 回到窗口时拉一次别的电脑上的改动（半分钟内刚同步过就不拉）
  window.on('focus', () => { if (engine && !syncRunning && Date.now() - lastAttempt > 30000) syncSoon(300); });
  app.on('before-quit', event => { if (!quitting) { event.preventDefault(); window.close(); } });
  app.on('will-quit', () => { watcher?.close(); clearInterval(pollTimer); clearTimeout(saveTimer); clearTimeout(watchTimer); clearTimeout(syncTimer); });
  menu(); watch();
  await configureSync();
  await window.loadURL(PAGE);
  const recovery = path.join(app.getPath('userData'), '没存下的笔记');
  if (fs.existsSync(recovery) && fs.readdirSync(recovery).length) notify(`有上次没存进笔记库的文字，请查看 ${recovery}`);
}).catch(error => { console.error(error); dialog.showErrorBox('BetterMD 启动失败', error.message); app.exit(1); });
