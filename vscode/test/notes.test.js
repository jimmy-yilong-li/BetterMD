// node --test vscode/test/notes.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const notes = require('../notes.js');

const tempLibrary = files => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bettermd-panel-'));
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  return root;
};

test('标题：第一行非空文字，去掉 #', () => {
  assert.equal(notes.noteTitle('\n\n# 机器学习\n正文'), '机器学习');
  assert.equal(notes.noteTitle('#标签 开头'), '#标签 开头');
  assert.equal(notes.noteTitle('####### 七个井号不是标题'), '####### 七个井号不是标题');
  assert.equal(notes.noteTitle(''), '');
});

test('标签：和编辑器的 findTags 一样；代码里的不算；纯数字不算', async () => {
  const { findTags } = await import('../../editor/src/helpers.js');
  for (const line of ['#会议/周会 和 #想法。', 'PR #42 #3d', '网址 a.com/#x 不算', '#a/b/ #/c', '（#中文标签）', '#多# #两个']) {
    assert.deepEqual(notes.tagsInLine(line), findTags(line).map(t => t.name), line);
  }
  assert.deepEqual(notes.noteTags('# 标题\n#会议 `#代码` 正文\n```\n#围栏里\n```\n    #缩进代码\n- 列表 #列表'), ['会议', '列表']);
});

test('读文件：UTF-8、带 BOM、Windows 换行、GB18030', () => {
  assert.equal(notes.decode(Buffer.from('﻿# 甲\r\n乙')), '# 甲\n乙');
  assert.equal(notes.decode(Buffer.from([0xD6, 0xD0, 0xCE, 0xC4])), '中文'); // GB18030 的“中文”
});

test('扫笔记库：文件夹、笔记、置顶；跳过附件、废纸篓、隐藏文件', async () => {
  const root = tempLibrary({
    '甲.md': '# 甲\n#想法',
    '工作/乙.md': '# 乙\n- [ ] 待办',
    '工作/客户/丙.md': '# 丙',
    '附件/图.md': '# 不是笔记',
    '废纸篓/丁.md': '# 删掉的',
    '.bettermd/state.json': JSON.stringify({ pinned: ['工作/乙.md'] }),
    '.hidden.md': '# 隐藏',
  });
  const scan = await notes.scanLibrary(root);
  assert.deepEqual(scan.folders, ['工作', '工作/客户']);
  assert.deepEqual(scan.notes.map(n => n.path).sort(), ['工作/乙.md', '工作/客户/丙.md', '甲.md']);
  assert.equal(scan.notes.find(n => n.path === '工作/乙.md').pinned, true);
  assert.equal(scan.notes.find(n => n.path === '工作/乙.md').todo, true);
  assert.equal(scan.texts.get('甲.md'), '# 甲\n#想法');

  const tree = notes.buildTree(scan);
  assert.deepEqual(tree.map(n => n.name), ['工作', '未分类', '标签']);
  const work = tree[0];
  assert.deepEqual(work.children.map(c => c.kind === 'note' ? c.note.title : c.name), ['客户', '乙']);
  assert.deepEqual(tree[1].children.map(c => c.note.title), ['甲']);
  assert.deepEqual(tree[2].children.map(c => c.name), ['想法']);
  assert.deepEqual(tree[2].children[0].children.map(c => c.note.title), ['甲']);
});

test('多级标签排成树，子标签在前', () => {
  const now = new Date();
  const list = [
    { path: 'a.md', title: 'A', tags: ['会议/周会'], modified: now, pinned: false },
    { path: 'b.md', title: 'B', tags: ['会议'], modified: now, pinned: false },
  ];
  const [meeting] = notes.buildTree({ folders: [], notes: list }).at(-1).children;
  assert.equal(meeting.name, '会议');
  assert.deepEqual(meeting.children.map(c => c.kind === 'note' ? c.note.title : c.name), ['周会', 'B']);
});

test('新建笔记：文件名跟着标题，重名加序号，不会盖掉已有的', () => {
  const root = tempLibrary({ '工作/计划.md': '# 计划\n已有的' });
  const file = notes.createNote(root, '工作', '计划');
  assert.equal(path.basename(file), '计划 2.md');
  assert.equal(fs.readFileSync(path.join(root, '工作/计划.md'), 'utf8'), '# 计划\n已有的');
  assert.equal(fs.readFileSync(file, 'utf8'), '# 计划\n\n');
  assert.equal(path.basename(notes.createNote(root, '', 'a/b:c')), 'a／b：c.md');
});

test('搜索：每个词都要命中，标题命中的在前，不分大小写和全角半角', () => {
  const old = new Date(2026, 0, 1), recent = new Date(2026, 9, 1);
  const list = [
    { path: 'a.md', title: '周会记录', modified: old, pinned: false },
    { path: 'b.md', title: '随手记', modified: recent, pinned: false },
    { path: 'c.md', title: '别的', modified: recent, pinned: false },
  ];
  const texts = new Map([['a.md', '讨论了 BetterMD'], ['b.md', '周会 上说的 ＢｅｔｔｅｒＭＤ'], ['c.md', '无关']]);
  assert.deepEqual(notes.searchNotes(list, texts, '周会 bettermd').map(n => n.path), ['a.md', 'b.md']);
  assert.deepEqual(notes.searchNotes(list, texts, '').map(n => n.path), ['b.md', 'c.md', 'a.md']);
});

test('笔记库的位置：设置 > App 的设置 > 默认位置', () => {
  assert.equal(notes.libraryRoot('/x/笔记', () => '/y'), '/x/笔记');
  assert.equal(notes.libraryRoot('', () => '~/z'), path.join(os.homedir(), 'z'));
  assert.match(notes.libraryRoot('', () => ''), /我的笔记$/);
});
