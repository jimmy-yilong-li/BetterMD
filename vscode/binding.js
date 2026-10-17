// 绑定在 VS Code 里的那一半：什么时候同步、怎么提示、绑定和解除的命令。同步的规则在 links.js 和 merge.js。
// VS Code 开着时：项目里的文件或笔记一保存（不管是谁存的：VS Code、BetterMD App、agent）就同步那一对；
// 文件监听可能漏，所以每 15 秒再看一眼修改时间。VS Code 没开时的改动，下次打开时补上。
const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const links = require('./links.js');
const notes = require('./notes.js');

class LinkSync {
  constructor() {
    this.root = null;
    this.watchers = [];
    this.timers = new Map();
    /** 每对上次看到的两边修改时间（定时检查时比这个） */
    this.seen = new Map();
    /** 已经提醒过“文件不见了”的绑定，不反复提醒 */
    this.warnedMissing = new Set();
    this.poll = null;
    this.onDidChange = new vscode.EventEmitter(); // 登记变了：面板要重画
  }

  start(root) {
    this.stopWatching();
    this.root = root && fs.existsSync(root) ? root : null;
    if (!this.root) return;
    const libraryWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(this.root), '**/*.md'));
    const registryWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.join(this.root, '.bettermd')), 'links.json'));
    const noteChanged = uri => this.noteChanged(uri.fsPath);
    libraryWatcher.onDidChange(noteChanged);
    libraryWatcher.onDidCreate(noteChanged);
    const registryChanged = () => { this.watchFiles(); this.onDidChange.fire(); this.syncAll(); };
    registryWatcher.onDidChange(registryChanged);
    registryWatcher.onDidCreate(registryChanged);
    this.watchers.push(libraryWatcher, registryWatcher);
    this.watchFiles();
    this.poll = setInterval(() => this.checkTimes(), 15000);
    this.syncAll();
  }

  /** 给每个绑定的项目文件单独开一个监听（它们不在笔记库里，也不一定在工作区里）。 */
  watchFiles() {
    for (const w of this.fileWatchers ?? []) w.dispose();
    this.fileWatchers = links.readLinks(this.root).map(link => {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(path.dirname(link.file)), path.basename(link.file)));
      const later = () => this.schedule(link.id);
      watcher.onDidChange(later);
      watcher.onDidCreate(later);
      return watcher;
    });
  }

  stopWatching() {
    for (const w of [...this.watchers, ...(this.fileWatchers ?? [])]) w.dispose();
    this.watchers = [];
    this.fileWatchers = [];
    clearInterval(this.poll);
  }

  dispose() {
    this.stopWatching();
    for (const t of this.timers.values()) clearTimeout(t);
    this.onDidChange.dispose();
  }

  /** 笔记库里的某篇变了：它要是绑着的，同步那一对。 */
  noteChanged(fsPath) {
    if (!this.root) return;
    const rel = path.relative(this.root, fsPath).split(path.sep).join('/');
    for (const link of links.readLinks(this.root)) if (link.note === rel) this.schedule(link.id);
  }

  /** VS Code 里存了一个文件：是绑定的哪一边，就同步那一对。 */
  saved(fsPath) {
    if (!this.root) return;
    const full = path.resolve(fsPath);
    for (const link of links.readLinks(this.root)) {
      if (path.resolve(link.file) === full || path.join(this.root, ...link.note.split('/')) === full) this.schedule(link.id);
    }
  }

  syncAll() {
    if (!this.root) return;
    for (const link of links.readLinks(this.root)) this.schedule(link.id, 0);
  }

  /** 定时看一眼两边的修改时间：变了就同步（文件监听漏掉的、App 改的都能补上）。 */
  checkTimes() {
    if (!this.root) return;
    for (const link of links.readLinks(this.root)) {
      const mtime = p => fs.statSync(p, { throwIfNoEntry: false })?.mtimeMs ?? 0;
      const stamp = `${mtime(path.join(this.root, ...link.note.split('/')))}|${mtime(link.file)}`;
      if (this.seen.get(link.id) !== stamp) this.schedule(link.id, 0);
    }
  }

  /** 同一对一连串的变化合成一次（停 0.5 秒）。 */
  schedule(id, delay = 500) {
    clearTimeout(this.timers.get(id));
    this.timers.set(id, setTimeout(() => this.run(id), delay));
  }

  run(id) {
    this.timers.delete(id);
    const link = links.readLinks(this.root).find(l => l.id === id);
    if (!link) return;
    // 在 VS Code 里有没存的改动的那一边先不写（不然存的时候 VS Code 会说文件比编辑器里的新）；稍后再来
    const busy = p => vscode.workspace.textDocuments.some(d => d.uri.scheme === 'file' && d.isDirty && path.resolve(d.uri.fsPath) === path.resolve(p));
    let result;
    try {
      result = links.syncLink(this.root, link, { busy });
    } catch (error) {
      vscode.window.showErrorMessage(`BetterMD：同步「${path.basename(link.file)}」没成功（${error.message}）`);
      return;
    }
    const notePath = path.join(this.root, ...link.note.split('/'));
    const mtime = p => fs.statSync(p, { throwIfNoEntry: false })?.mtimeMs ?? 0;
    this.seen.set(id, `${mtime(notePath)}|${mtime(link.file)}`);
    if (result.action === 'busy') { this.schedule(id, 1000); return; }
    if (result.action === 'missing') {
      if (this.warnedMissing.has(id)) return;
      this.warnedMissing.add(id);
      const which = result.missing === 'file' ? `项目里的「${link.file}」` : `笔记「${link.note}」`;
      vscode.window.showWarningMessage(`BetterMD：${which}不见了，这一对先不同步。文件回来以后会接着同步。`, '解除绑定')
        .then(choice => { if (choice) this.unbindLink(link); });
      return;
    }
    this.warnedMissing.delete(id);
    if (result.action === 'toFile' || result.action === 'toNote') {
      vscode.window.setStatusBarMessage(`$(sync) 已同步：${path.basename(link.file)} ↔ ${link.note}`, 3000);
    } else if (result.action === 'merged' && !result.conflicts) {
      vscode.window.setStatusBarMessage(`$(sync) 两边的改动已合成一份：${path.basename(link.file)} ↔ ${link.note}`, 5000);
    } else if (result.action === 'merged') {
      const copyUri = vscode.Uri.file(path.join(path.dirname(notePath), result.copy));
      vscode.window.showWarningMessage(
        `BetterMD：「${path.basename(link.file)}」和笔记「${link.note}」两边改了同一段。已经合成一份同步到两边，冲突的地方以后改的那边为准；另一边原来的样子另存成了「${result.copy}」。`,
        '查看差异', '打开另存的',
      ).then(choice => {
        if (choice === '查看差异') vscode.commands.executeCommand('vscode.diff', copyUri, vscode.Uri.file(notePath), `${result.copy} ↔ 合成的一份`);
        if (choice === '打开另存的') vscode.commands.executeCommand('vscode.openWith', copyUri, 'default');
      });
    }
  }

  unbindLink(link) {
    links.unbind(this.root, link.id);
    this.watchFiles();
    this.onDidChange.fire();
    vscode.window.setStatusBarMessage(`已解除绑定：${path.basename(link.file)} ↔ ${link.note}（两边的文件都还在）`, 4000);
  }
}

// ---- 命令 ----

const isMarkdown = p => /\.(md|markdown)$/i.test(p);
const activeFile = () => vscode.window.tabGroups.activeTabGroup.activeTab?.input?.uri;

function register(context, tree) {
  const sync = new LinkSync();
  const root = () => tree.root && fs.existsSync(tree.root) ? tree.root : null;
  const relInLibrary = fsPath => {
    const r = root();
    if (!r) return null;
    const rel = path.relative(r, fsPath);
    return rel.startsWith('..') || path.isAbsolute(rel) ? null : rel.split(path.sep).join('/');
  };
  const noteOf = target => target?.kind === 'note' ? target.note.path
    : (() => { const uri = target instanceof vscode.Uri ? target : activeFile(); return uri ? relInLibrary(uri.fsPath) : null; })();

  /** 项目里的 .md 绑到「我的笔记」：新建一篇，或者挑一篇已有的。 */
  async function bindFile(target) {
    const uri = target instanceof vscode.Uri ? target : activeFile();
    const r = root();
    if (!uri || !r) return vscode.window.showWarningMessage('BetterMD：先打开一个 .md 文件，并且要能找到「我的笔记」。');
    if (!isMarkdown(uri.fsPath)) return vscode.window.showWarningMessage('BetterMD：只能绑定 .md 文件。');
    if (relInLibrary(uri.fsPath)) return vscode.window.showInformationMessage('BetterMD：这篇本来就在「我的笔记」里。');
    const existing = links.linkForFile(r, uri.fsPath);
    if (existing) return vscode.window.showInformationMessage(`BetterMD：已经和笔记「${existing.note}」绑着了。`);
    const workspace = vscode.workspace.getWorkspaceFolder(uri)?.name ?? path.basename(path.dirname(uri.fsPath));
    const NEW = '$(new-file) 新建一篇笔记';
    const picks = [
      { label: NEW, description: '把这个文件的内容放进「我的笔记」，以后两边同步' },
      { label: '绑到已有的笔记', kind: vscode.QuickPickItemKind.Separator },
      ...notes.sortNotes(tree.scan.notes).map(n => ({ label: n.title, description: n.path, note: n.path })),
    ];
    const chosen = await vscode.window.showQuickPick(picks, { title: `把「${path.basename(uri.fsPath)}」绑到「我的笔记」`, matchOnDescription: true });
    if (!chosen) return;
    if (chosen.label === NEW) {
      const folders = [`项目/${workspace}`, ...tree.scan.folders.filter(f => f !== `项目/${workspace}`)];
      const folder = await vscode.window.showQuickPick(
        [...folders.map(f => ({ label: f.split('/').join(' / '), folder: f })), { label: '未分类', folder: '' }],
        { title: '放进哪个文件夹' });
      if (!folder) return;
      const link = links.bindNewNote(r, uri.fsPath, folder.folder);
      done(`已绑定：${path.basename(uri.fsPath)} ↔ 笔记「${link.note}」`);
    } else {
      await bindPair(chosen.note, uri.fsPath);
    }
  }

  /** 绑上已有的一篇笔记和一个文件；两边不一样时问以哪边为准，另一边另存。 */
  async function bindPair(note, file) {
    const r = root();
    const noteText = links.readText(path.join(r, ...note.split('/')));
    const fileText = links.readText(file);
    let keep = 'note';
    if (fileText !== null && fileText !== noteText) {
      const answer = await vscode.window.showWarningMessage(
        `「${path.basename(file)}」和笔记「${note}」的内容不一样。以哪边为准？另一边原来的样子会另存一份在笔记旁边。`,
        { modal: true }, '以项目里的为准', '以笔记里的为准');
      if (!answer) return;
      keep = answer === '以项目里的为准' ? 'file' : 'note';
    }
    const { copy } = links.bindExisting(r, note, file, keep);
    done(`已绑定：${path.basename(file)} ↔ 笔记「${note}」` + (copy ? `；另一边原来的样子另存成了「${copy}」` : ''));
  }

  /** 笔记另存到项目里（比如存成 CLAUDE.md），以后两边同步。 */
  async function exportNote(target) {
    const note = noteOf(target);
    const r = root();
    if (!note || !r) return vscode.window.showWarningMessage('BetterMD：先在「我的笔记」面板里选一篇笔记，或者打开一篇笔记。');
    const existing = links.linkForNote(r, note);
    if (existing) return vscode.window.showInformationMessage(`BetterMD：这篇已经和「${existing.file}」绑着了。`);
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file(require('node:os').homedir());
    const target2 = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.joinPath(folder, path.basename(note)), filters: { Markdown: ['md'] },
      saveLabel: '存到这里并绑定', title: `把笔记「${note}」存到项目里（以后两边同步）`,
    });
    if (!target2) return;
    if (relInLibrary(target2.fsPath)) return vscode.window.showWarningMessage('BetterMD：要存到「我的笔记」外面（项目里）。');
    await bindPair(note, target2.fsPath);
  }

  function findLink(target) {
    const r = root();
    if (!r) return null;
    if (target?.kind === 'note') return links.linkForNote(r, target.note.path);
    const uri = target instanceof vscode.Uri ? target : activeFile();
    if (!uri) return null;
    const rel = relInLibrary(uri.fsPath);
    return rel ? links.linkForNote(r, rel) : links.linkForFile(r, uri.fsPath);
  }

  function done(message) {
    sync.watchFiles();
    sync.onDidChange.fire();
    sync.syncAll();
    vscode.window.showInformationMessage(`BetterMD：${message}`);
  }

  context.subscriptions.push(
    sync,
    vscode.commands.registerCommand('bettermd.bindFile', bindFile),
    vscode.commands.registerCommand('bettermd.exportNote', exportNote),
    vscode.commands.registerCommand('bettermd.unbind', target => {
      const link = findLink(target);
      if (link) sync.unbindLink(link);
      else vscode.window.showInformationMessage('BetterMD：这篇没有绑定。');
    }),
    vscode.commands.registerCommand('bettermd.openBoundFile', target => {
      const link = findLink(target);
      if (link) vscode.commands.executeCommand('vscode.open', vscode.Uri.file(link.file));
    }),
    vscode.commands.registerCommand('bettermd.openBoundNote', target => {
      const link = findLink(target);
      if (link) vscode.commands.executeCommand('vscode.open', vscode.Uri.file(path.join(root(), ...link.note.split('/'))));
    }),
    vscode.workspace.onDidSaveTextDocument(doc => { if (doc.uri.scheme === 'file') sync.saved(doc.uri.fsPath); }),
    // 笔记库的位置改了（面板先换好 tree.root）：换一个笔记库重新开始
    vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('bettermd.libraryPath')) sync.start(root()); }),
    sync.onDidChange.event(() => tree.linksChanged()),
  );
  sync.start(root());
  return sync;
}

module.exports = { register, LinkSync };
