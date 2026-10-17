// 「我的笔记」面板：换上一个假的 vscode，检查树的每一项、新建笔记、文件变了会重扫。node --test vscode/test/library.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const calls = [];
let inputValue = '周会';
let watcherHandlers = [];
class EventEmitter { constructor() { this.listeners = []; this.event = l => this.listeners.push(l); } fire() { this.listeners.forEach(l => l()); } dispose() {} }
const fake = {
  EventEmitter,
  TreeItem: class { constructor(label, state) { this.label = label; this.collapsibleState = state; } },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: class { constructor(id) { this.id = id; } },
  Uri: { file: p => ({ fsPath: p, scheme: 'file' }) },
  RelativePattern: class { constructor(base, pattern) { this.base = base; this.pattern = pattern; } },
  workspace: {
    getConfiguration: () => ({ get: () => library }),
    createFileSystemWatcher: () => ({ onDidCreate: h => watcherHandlers.push(h), onDidChange: h => watcherHandlers.push(h), onDidDelete: h => watcherHandlers.push(h), dispose() {} }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
  },
  window: { showInputBox: async () => inputValue, createTreeView: () => ({ dispose() {} }), tabGroups: { activeTabGroup: {} }, setStatusBarMessage() {} },
  commands: { executeCommand: (...args) => calls.push(args), registerCommand: () => ({ dispose() {} }) },
  env: { clipboard: { writeText: async () => {} } },
};
const originalLoad = Module._load;
Module._load = function (request, ...rest) { return request === 'vscode' ? fake : originalLoad.call(this, request, ...rest); };
const { register } = require('../library.js');

const library = fs.mkdtempSync(path.join(os.tmpdir(), 'bettermd-tree-'));
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(library, rel)), { recursive: true }); fs.writeFileSync(path.join(library, rel), text); };
write('工作/甲.md', '# 甲\n#会议');
write('乙.md', '# 乙\n- [ ] 待办');

test('面板：文件夹、未分类、标签，点笔记就打开', async () => {
  const tree = register({ subscriptions: [] });
  await new Promise(r => setTimeout(r, 100));
  assert.ok(calls.some(c => c[0] === 'setContext' && c[1] === 'bettermd.libraryFound' && c[2] === true));
  const top = tree.getChildren();
  assert.deepEqual(top.map(n => tree.getTreeItem(n).label), ['工作', '未分类', '标签']);
  const [note] = tree.getChildren(top[0]);
  const item = tree.getTreeItem(note);
  assert.equal(item.label, '甲');
  assert.equal(item.command.command, 'vscode.open');
  assert.equal(item.command.arguments[0].fsPath, path.join(library, '工作/甲.md'));
  assert.equal(tree.getTreeItem(tree.getChildren(top[1])[0]).iconPath.id, 'checklist', '有没勾的待办');
  assert.equal(tree.getTreeItem(tree.getChildren(top[2])[0]).label, '会议');

  // 在「工作」里新建：建好文件、打开它
  await tree.newNote(top[0]);
  assert.equal(fs.readFileSync(path.join(library, '工作/周会.md'), 'utf8'), '# 周会\n\n');
  assert.ok(calls.some(c => c[0] === 'vscode.open' && c[1].fsPath === path.join(library, '工作/周会.md')));

  // 别处改了文件：过一会儿重扫
  write('丙.md', '# 丙');
  watcherHandlers.forEach(h => h());
  await new Promise(r => setTimeout(r, 700));
  assert.ok(tree.getChildren(tree.getChildren()[1]).some(n => n.note.title === '丙'));
  tree.dispose();
});
