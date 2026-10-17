// node --test vscode/test
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const lib = require('../lib.js');

test('最小改动：只换中间变了的那一段', () => {
  assert.equal(lib.minimalEdit('abc', 'abc'), null);
  assert.deepEqual(lib.minimalEdit('# 甲\n正文', '# 甲\n正文多了'), { from: 6, to: 6, text: '多了' });
  assert.deepEqual(lib.minimalEdit('aXc', 'aYYc'), { from: 1, to: 2, text: 'YY' });
  assert.deepEqual(lib.minimalEdit('aaa', 'aa'), { from: 2, to: 3, text: '' });
  assert.deepEqual(lib.minimalEdit('', 'x'), { from: 0, to: 0, text: 'x' });
});

test('行列：按 \\n 数，和文件用什么换行无关', () => {
  const text = '第一行\n第二行\n\n第四';
  assert.deepEqual(lib.positionAt(text, 0), { line: 0, character: 0 });
  assert.deepEqual(lib.positionAt(text, 3), { line: 0, character: 3 });
  assert.deepEqual(lib.positionAt(text, 4), { line: 1, character: 0 });
  assert.deepEqual(lib.positionAt(text, 9), { line: 3, character: 0 });
  assert.deepEqual(lib.positionAt(text, text.length), { line: 3, character: 2 });
  assert.equal(lib.normalize('a\r\nb\rc'), 'a\nb\nc');
});

test('找笔记库：往上找带 .bettermd 的文件夹', () => {
  const libraries = new Set(['/u/我的笔记/.bettermd']);
  const isDir = p => libraries.has(p);
  assert.equal(lib.findLibrary('/u/我的笔记/工作/客户', isDir), '/u/我的笔记');
  assert.equal(lib.findLibrary('/u/项目/docs', isDir), null);

  assert.deepEqual(lib.placeOf('/u/我的笔记/工作/甲.md', [], isDir), { root: '/u/我的笔记', dir: '工作', inLibrary: true });
  assert.deepEqual(lib.placeOf('/u/我的笔记/甲.md', [], isDir), { root: '/u/我的笔记', dir: '', inLibrary: true });
  // 不在笔记库里：按最近的工作区文件夹算
  assert.deepEqual(lib.placeOf('/u/项目/docs/设计.md', ['/u', '/u/项目'], isDir), { root: '/u/项目', dir: 'docs', inLibrary: false });
  assert.deepEqual(lib.placeOf('/tmp/x/a.md', ['/u/项目'], isDir), { root: path.resolve('/tmp/x'), dir: '', inLibrary: false });
});

test('附件起名：图片按时间，别的保留原名，重名加序号', () => {
  const now = new Date(2026, 9, 17, 15, 30, 12);
  assert.equal(lib.attachmentName('截图.PNG', 'image/png', now), '20261017-153012.png');
  assert.equal(lib.attachmentName('', 'image/jpeg', now), '20261017-153012.jpg');
  assert.equal(lib.attachmentName('报告 v2.pdf', 'application/pdf', now), '报告 v2.pdf');
  const taken = new Set(['20261017-153012.png', '20261017-153012-2.png']);
  assert.equal(lib.attachmentName('a.png', 'image/png', now, n => taken.has(n)), '20261017-153012-3.png');
  assert.equal(lib.cleanName('a/b:c'), 'a／b：c');
});

test('链接写法：相对位置，空格括号转义，中文原样', () => {
  assert.equal(lib.relativeLink('工作/客户', '附件/a.png'), '../../附件/a.png');
  assert.equal(lib.relativeLink('', '附件/a b(1).png'), '附件/a%20b%281%29.png');
  assert.equal(lib.relativeLink('docs', 'docs/assets/x.png'), 'assets/x.png');
  assert.equal(lib.relativeLink('附件', '附件/x#1?.png'), 'x%231%3F.png');
});

test('时间：今天、昨天、今年、更早', () => {
  const now = new Date(2026, 9, 17, 12, 0);
  assert.equal(lib.dateLabel(new Date(2026, 9, 17, 9, 5), now), '今天 09:05');
  assert.equal(lib.dateLabel(new Date(2026, 9, 16, 19, 5), now), '昨天 19:05');
  assert.equal(lib.dateLabel(new Date(2026, 2, 3), now), '3月3日');
  assert.equal(lib.dateLabel(new Date(2025, 9, 3), now), '2025年10月3日');
});
