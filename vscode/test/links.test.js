// node --test vscode/test/links.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const links = require('../links.js');

function setup(noteText = '# 规范\n\n第一段\n\n第二段\n', fileText = noteText) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bettermd-links-'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'bettermd-proj-'));
  fs.mkdirSync(path.join(root, '.bettermd'));
  fs.mkdirSync(path.join(root, '工作'));
  fs.writeFileSync(path.join(root, '工作/规范.md'), noteText);
  const file = path.join(project, 'CLAUDE.md');
  fs.writeFileSync(file, fileText);
  const { link } = links.bindExisting(root, '工作/规范.md', file, 'note');
  const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
  const touch = (p, seconds) => { const t = new Date(Date.now() + seconds * 1000); fs.utimesSync(p, t, t); };
  return { root, project, file, link, note: path.join(root, '工作/规范.md'), read, touch };
}

test('登记：绑上以后两边都查得到，底本是当时的内容', () => {
  const { root, file, link } = setup();
  assert.equal(links.linkForNote(root, '工作/规范.md').id, link.id);
  assert.equal(links.linkForFile(root, file).id, link.id);
  assert.equal(links.readBase(root, link.id), '# 规范\n\n第一段\n\n第二段\n');
});

test('只有项目那边改了：写进笔记', () => {
  const { root, file, link, read } = setup();
  fs.writeFileSync(file, '# 规范\n\n第一段（项目改的）\n\n第二段\n');
  assert.deepEqual(links.syncLink(root, link), { action: 'toNote' });
  assert.equal(read('工作/规范.md'), '# 规范\n\n第一段（项目改的）\n\n第二段\n');
  assert.deepEqual(links.syncLink(root, link), { action: 'same' }, '再同步一次什么都不做');
});

test('只有笔记改了：写进项目', () => {
  const { root, file, link, note } = setup();
  fs.writeFileSync(note, '# 规范\n\n第一段\n\n第二段（笔记改的）\n');
  assert.deepEqual(links.syncLink(root, link), { action: 'toFile' });
  assert.equal(fs.readFileSync(file, 'utf8'), '# 规范\n\n第一段\n\n第二段（笔记改的）\n');
});

test('两边改了不同的段落：合成一份写回两边，不另存', () => {
  const { root, file, link, note, read } = setup();
  fs.writeFileSync(note, '# 规范\n\n第一段（笔记）\n\n第二段\n');
  fs.writeFileSync(file, '# 规范\n\n第一段\n\n第二段（项目）\n');
  assert.deepEqual(links.syncLink(root, link), { action: 'merged', conflicts: 0, copy: null });
  const merged = '# 规范\n\n第一段（笔记）\n\n第二段（项目）\n';
  assert.equal(read('工作/规范.md'), merged);
  assert.equal(fs.readFileSync(file, 'utf8'), merged);
  assert.equal(links.readBase(root, link.id), merged);
  assert.deepEqual(fs.readdirSync(path.join(root, '工作')), ['规范.md']);
});

test('两边改了同一段：以后改的那边为准，另一边整篇另存', () => {
  const { root, file, link, note, read, touch } = setup();
  fs.writeFileSync(note, '# 规范\n\n第一段：笔记的说法\n\n第二段\n');
  fs.writeFileSync(file, '# 规范\n\n第一段：项目的说法\n\n第二段（项目）\n');
  touch(note, -10); // 项目那边后改
  const result = links.syncLink(root, link, { now: new Date(2026, 9, 17, 15, 30) });
  assert.equal(result.action, 'merged');
  assert.equal(result.conflicts, 1);
  assert.equal(result.copy, '规范（笔记里的版本 10-17 1530）.md');
  assert.equal(read('工作/规范.md'), '# 规范\n\n第一段：项目的说法\n\n第二段（项目）\n');
  assert.equal(read('工作/' + result.copy), '# 规范\n\n第一段：笔记的说法\n\n第二段\n');
});

test('项目里的文件用 \\r\\n：写回去还是 \\r\\n', () => {
  const { root, file, link, note } = setup();
  fs.writeFileSync(file, '# 规范\r\n\r\n第一段\r\n\r\n第二段\r\n');
  assert.deepEqual(links.syncLink(root, link), { action: 'same' }, '只是换行不同，算一样');
  fs.writeFileSync(note, '# 规范\n\n第一段\n\n第二段（笔记改的）\n');
  assert.deepEqual(links.syncLink(root, link), { action: 'toFile' });
  assert.equal(fs.readFileSync(file, 'utf8'), '# 规范\r\n\r\n第一段\r\n\r\n第二段（笔记改的）\r\n');
});

test('笔记进了废纸篓：暂停；有一边的文件不见了：不动另一边', () => {
  const { root, file, link } = setup();
  assert.deepEqual(links.syncLink(root, { ...link, note: '废纸篓/规范.md' }), { action: 'paused' });
  fs.unlinkSync(file);
  assert.deepEqual(links.syncLink(root, link), { action: 'missing', missing: 'file' });
  assert.ok(fs.existsSync(path.join(root, '工作/规范.md')));
});

test('有一边在编辑器里还没存：先不写，稍后再来', () => {
  const { root, file, link, read } = setup();
  fs.writeFileSync(file, '# 规范\n\n项目改的\n');
  assert.deepEqual(links.syncLink(root, link, { busy: p => p === file }), { action: 'busy' });
  assert.equal(read('工作/规范.md'), '# 规范\n\n第一段\n\n第二段\n');
});

test('从项目文件新建一篇笔记绑上', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bettermd-links-'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'bettermd-proj-'));
  const file = path.join(project, 'AGENTS.md');
  fs.writeFileSync(file, '# 给 agent 的说明\n\n规矩\n');
  const link = links.bindNewNote(root, file, '项目/demo');
  assert.equal(link.note, '项目/demo/给 agent 的说明.md');
  assert.equal(fs.readFileSync(path.join(root, link.note), 'utf8'), '# 给 agent 的说明\n\n规矩\n');
  assert.equal(links.linkForFile(root, file).note, link.note);
});

test('绑上已有的两份，内容不一样：按选的那边为准，另一边另存；另存到项目（文件还没有）就直接写出去', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bettermd-links-'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'bettermd-proj-'));
  fs.writeFileSync(path.join(root, '甲.md'), '# 甲\n笔记的');
  fs.writeFileSync(path.join(project, 'a.md'), '# 甲\n项目的');
  const { copy } = links.bindExisting(root, '甲.md', path.join(project, 'a.md'), 'file');
  assert.equal(fs.readFileSync(path.join(root, '甲.md'), 'utf8'), '# 甲\n项目的');
  assert.match(copy, /^甲（笔记里的版本 .+）\.md$/);
  links.bindExisting(root, '甲.md', path.join(project, 'new/CLAUDE.md'), 'note');
  assert.equal(fs.readFileSync(path.join(project, 'new/CLAUDE.md'), 'utf8'), '# 甲\n项目的');
});

test('解除绑定：两边原样，不再同步', () => {
  const { root, file, link } = setup();
  links.unbind(root, link.id);
  assert.equal(links.linkForFile(root, file), null);
  assert.ok(fs.existsSync(file));
});
