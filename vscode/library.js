// VS Code 左边栏的「我的笔记」面板：文件夹、未分类、标签，点一下用 BetterMD 的编辑器打开。
// 在这里新建的笔记直接写进笔记库（默认在 iCloud 云盘里），BetterMD App 那边马上能看到。
const vscode = require('vscode');
const path = require('node:path');
const fs = require('node:fs');
const notes = require('./notes.js');
const { dateLabel } = require('./lib.js');

class LibraryTree {
  constructor() {
    this.changed = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.changed.event;
    this.root = null;
    this.scan = { folders: [], notes: [], texts: new Map() };
    this.tree = [];
    this.watcher = null;
    this.timer = null;
  }

  /** 找笔记库、扫一遍、盯着它的变化。设置里的位置改了也走这里。 */
  async start() {
    this.watcher?.dispose();
    this.root = notes.libraryRoot(vscode.workspace.getConfiguration('bettermd').get('libraryPath', ''));
    const exists = fs.existsSync(this.root);
    vscode.commands.executeCommand('setContext', 'bettermd.libraryFound', exists);
    if (exists) {
      this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(this.root), '**/*'));
      const later = () => this.refreshSoon();
      this.watcher.onDidCreate(later);
      this.watcher.onDidChange(later);
      this.watcher.onDidDelete(later);
    }
    await this.refresh();
  }

  /** 一连串变化（App 保存、git 切分支）合成一次重扫。 */
  refreshSoon() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refresh(), 400);
  }

  async refresh() {
    this.scan = this.root && fs.existsSync(this.root) ? await notes.scanLibrary(this.root) : { folders: [], notes: [], texts: new Map() };
    this.tree = notes.buildTree(this.scan);
    this.changed.fire();
  }

  dispose() {
    clearTimeout(this.timer);
    this.watcher?.dispose();
    this.changed.dispose();
  }

  uri(note) {
    return vscode.Uri.file(path.join(this.root, ...note.path.split('/')));
  }

  getChildren(node) {
    return node ? node.children : this.tree;
  }

  getTreeItem(node) {
    if (node.kind === 'note') {
      const { note } = node;
      const item = new vscode.TreeItem(note.title, vscode.TreeItemCollapsibleState.None);
      item.description = dateLabel(note.modified);
      item.tooltip = note.path;
      item.resourceUri = this.uri(note);
      item.iconPath = new vscode.ThemeIcon(note.pinned ? 'pinned' : note.todo ? 'checklist' : 'note');
      item.contextValue = 'note';
      item.command = { command: 'vscode.open', title: '打开', arguments: [this.uri(note)] };
      return item;
    }
    const open = node.kind === 'tags' || (node.kind === 'folder' && node.path === '' && node.children.length > 0);
    const item = new vscode.TreeItem(node.name, open ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
    item.id = `${node.kind}:${node.path ?? ''}`; // 刷新以后展开收起的状态不丢
    if (node.kind === 'folder') {
      item.iconPath = new vscode.ThemeIcon(node.path === '' ? 'files' : 'folder');
      item.contextValue = 'folder';
      item.description = node.path === '' ? '根目录里的笔记' : undefined;
    } else if (node.kind === 'tags') {
      item.iconPath = new vscode.ThemeIcon('tag');
      if (!node.children.length) item.collapsibleState = vscode.TreeItemCollapsibleState.None;
    } else {
      item.iconPath = new vscode.ThemeIcon('symbol-number');
    }
    return item;
  }

  /** 新建笔记：在点的那个文件夹里（从面板标题栏点就放进「未分类」），问一下标题，建好就打开。 */
  async newNote(node) {
    if (!this.root) return;
    const folder = node?.kind === 'folder' ? node.path : node?.kind === 'note' ? path.posix.dirname(node.note.path).replace(/^\.$/, '') : '';
    const title = await vscode.window.showInputBox({
      title: folder ? `在「${folder.split('/').join(' / ')}」里新建笔记` : '新建笔记（放进「未分类」）',
      prompt: '标题，文件名也用它', value: '新笔记', valueSelection: [0, 3],
    });
    if (title === undefined) return;
    const file = notes.createNote(this.root, folder, title.trim() || '新笔记');
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file));
    this.refreshSoon();
  }

  /** 搜索笔记：每个词都要命中，标题命中的在前（和 App 一样）。回车打开。 */
  async search() {
    const pick = vscode.window.createQuickPick();
    pick.placeholder = '搜索笔记：标题和正文，几个词用空格隔开';
    pick.matchOnDescription = false;
    pick.matchOnDetail = false;
    const show = value => {
      pick.items = notes.searchNotes(this.scan.notes, this.scan.texts, value).slice(0, 200).map(note => ({
        label: note.title,
        description: [note.path.includes('/') ? path.posix.dirname(note.path).split('/').join(' / ') : '未分类', dateLabel(note.modified)].join(' · '),
        detail: value.trim() ? snippet(this.scan.texts.get(note.path) ?? '', value) : undefined,
        alwaysShow: true, // 自己筛过了，别让 VS Code 再按标题筛一遍
        note,
      }));
    };
    pick.onDidChangeValue(show);
    pick.onDidAccept(() => {
      const chosen = pick.selectedItems[0];
      if (chosen) vscode.commands.executeCommand('vscode.open', this.uri(chosen.note));
      pick.hide();
    });
    pick.onDidHide(() => pick.dispose());
    show('');
    pick.show();
  }
}

/** 正文里第一个命中的词附近一小段。 */
function snippet(text, query) {
  const fold = s => s.normalize('NFKC').toLowerCase();
  const body = text.split('\n').slice(1).join(' ').replace(/\s+/g, ' ');
  const term = fold(query).split(/\s+/).find(t => fold(body).includes(t));
  if (!term) return undefined;
  const at = fold(body).indexOf(term);
  const start = Math.max(0, at - 20);
  return (start > 0 ? '…' : '') + body.slice(start, at + term.length + 40);
}

function register(context) {
  const tree = new LibraryTree();
  const view = vscode.window.createTreeView('bettermd.library', { treeDataProvider: tree, showCollapseAll: true });
  const fileOf = target => (target?.kind === 'note' ? tree.uri(target.note) : target instanceof vscode.Uri ? target
    : vscode.window.tabGroups.activeTabGroup.activeTab?.input?.uri);
  context.subscriptions.push(
    tree, view,
    vscode.commands.registerCommand('bettermd.newNote', node => tree.newNote(node)),
    vscode.commands.registerCommand('bettermd.searchNotes', () => tree.search()),
    vscode.commands.registerCommand('bettermd.refreshLibrary', () => tree.refresh()),
    // 复制文件路径：告诉 AI agent 去读哪个文件
    vscode.commands.registerCommand('bettermd.copyPath', async target => {
      const uri = fileOf(target);
      if (!uri) return;
      await vscode.env.clipboard.writeText(uri.fsPath);
      vscode.window.setStatusBarMessage(`已复制：${uri.fsPath}`, 3000);
    }),
    vscode.commands.registerCommand('bettermd.revealInFinder', target => {
      const uri = fileOf(target);
      if (uri) vscode.commands.executeCommand('revealFileInOS', uri);
    }),
    vscode.commands.registerCommand('bettermd.openSource', target => {
      const uri = fileOf(target);
      if (uri) vscode.commands.executeCommand('vscode.openWith', uri, 'default');
    }),
    vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('bettermd.libraryPath')) tree.start(); }),
  );
  tree.start();
  return tree;
}

module.exports = { register, snippet };
