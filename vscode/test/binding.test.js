// 绑定在 VS Code 里的同步时机：换上一个假的 vscode，真的文件。node --test vscode/test/binding.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const warnings = [];
const statuses = [];
let dirty = new Set();
class EventEmitter { constructor() { this.listeners = []; this.event = l => { this.listeners.push(l); return { dispose() {} }; }; } fire() { this.listeners.forEach(l => l()); } dispose() {} }
const fake = {
  EventEmitter,
  Uri: { file: p => ({ fsPath: p, scheme: 'file' }) },
  RelativePattern: class { constructor(base, pattern) { this.base = base; this.pattern = pattern; } },
  workspace: {
    createFileSystemWatcher: () => ({ onDidChange() {}, onDidCreate() {}, dispose() {} }),
    get textDocuments() { return [...dirty].map(p => ({ uri: { scheme: 'file', fsPath: p }, isDirty: true })); },
  },
  window: {
    showWarningMessage: async (...args) => { warnings.push(args[0]); return undefined; },
    showErrorMessage: m => warnings.push('错误：' + m),
    setStatusBarMessage: m => statuses.push(m),
  },
  commands: { executeCommand() {} },
};
const originalLoad = Module._load;
Module._load = function (request, ...rest) { return request === 'vscode' ? fake : originalLoad.call(this, request, ...rest); };
const { LinkSync } = require('../binding.js');
const links = require('../links.js');

const wait = ms => new Promise(r => setTimeout(r, ms));

test('VS Code 开着时：哪边存了就同步哪对；两边都改了合成一份；没存的先等着', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bettermd-sync-'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'bettermd-proj-'));
  fs.mkdirSync(path.join(root, '.bettermd'));
  const note = path.join(root, '规范.md');
  const file = path.join(project, 'CLAUDE.md');
  fs.writeFileSync(note, '# 规范\n\n第一段\n\n第二段\n');
  links.bindExisting(root, '规范.md', file, 'note');
  assert.equal(fs.readFileSync(file, 'utf8'), '# 规范\n\n第一段\n\n第二段\n', '另存到项目：文件写出来了');

  const sync = new LinkSync();
  sync.start(root);

  // 项目里存了 → 笔记跟着变
  fs.writeFileSync(file, '# 规范\n\n第一段（项目）\n\n第二段\n');
  sync.saved(file);
  await wait(700);
  assert.equal(fs.readFileSync(note, 'utf8'), '# 规范\n\n第一段（项目）\n\n第二段\n');

  // 笔记改了（App 存的）→ 项目跟着变
  fs.writeFileSync(note, '# 规范\n\n第一段（项目）\n\n第二段（笔记）\n');
  sync.noteChanged(note);
  await wait(700);
  assert.equal(fs.readFileSync(file, 'utf8'), '# 规范\n\n第一段（项目）\n\n第二段（笔记）\n');

  // 项目那边在编辑器里还有没存的：先不写，存了再同步
  fs.writeFileSync(note, '# 规范\n\n笔记又改了\n');
  fs.writeFileSync(file, '# 规范\n\n第一段（项目）\n\n第二段（笔记）\n\n项目加的\n');
  dirty = new Set([file]);
  sync.noteChanged(note);
  await wait(700);
  assert.equal(fs.readFileSync(file, 'utf8'), '# 规范\n\n第一段（项目）\n\n第二段（笔记）\n\n项目加的\n', '没存的那边不写');
  dirty = new Set();
  await wait(1200);
  // 两边都改了：笔记把前两段换成一句，项目在后面加了一段 → 不冲突，合成一份
  assert.equal(fs.readFileSync(note, 'utf8'), '# 规范\n\n笔记又改了\n\n项目加的\n');
  assert.equal(fs.readFileSync(file, 'utf8'), '# 规范\n\n笔记又改了\n\n项目加的\n');
  assert.ok(statuses.some(s => s.includes('合成一份')));

  // 两边改了同一段：合成一份，冲突处以后改的为准，另一边另存，并提示
  fs.writeFileSync(note, '# 规范\n\n笔记的说法\n\n项目加的\n');
  await wait(20);
  fs.writeFileSync(file, '# 规范\n\n项目的说法\n\n项目加的\n');
  sync.saved(file);
  await wait(700);
  assert.equal(fs.readFileSync(note, 'utf8'), '# 规范\n\n项目的说法\n\n项目加的\n');
  assert.ok(fs.readdirSync(root).some(n => n.startsWith('规范（笔记里的版本')), '笔记那边原来的另存了');
  assert.ok(warnings.some(w => w.includes('两边改了同一段')));

  // 项目里的文件被删了：只提醒一次，笔记不动
  warnings.length = 0;
  fs.unlinkSync(file);
  sync.syncAll();
  await wait(100);
  sync.syncAll();
  await wait(100);
  assert.equal(warnings.filter(w => w.includes('不见了')).length, 1);
  assert.ok(fs.existsSync(note));
  sync.dispose();
});
