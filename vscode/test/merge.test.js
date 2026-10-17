// node --test vscode/test/merge.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { diffLines, merge3 } = require('../merge.js');

const base = '# 规范\n\n第一段\n\n第二段\n\n第三段\n';

test('找不同：只换变了的那几行', () => {
  assert.deepEqual(diffLines(['a', 'b', 'c'], ['a', 'b', 'c']), []);
  assert.deepEqual(diffLines(['a', 'b', 'c'], ['a', 'X', 'c']), [{ a0: 1, a1: 2, b0: 1, b1: 2 }]);
  assert.deepEqual(diffLines(['a', 'c'], ['a', 'b', 'c']), [{ a0: 1, a1: 1, b0: 1, b1: 2 }]);
  assert.deepEqual(diffLines(['a', 'b', 'c', 'd'], ['b', 'c', 'X']), [{ a0: 0, a1: 1, b0: 0, b1: 0 }, { a0: 3, a1: 4, b0: 2, b1: 3 }]);
  // 很大的改动不会卡：整段当一处
  const big = Array.from({ length: 3000 }, (_, i) => `行 ${i}`);
  const other = big.map(l => l + '改');
  assert.equal(diffLines(big, other).length, 1);
});

test('只有一边改了：用改了的那边', () => {
  const note = base.replace('第一段', '第一段（笔记里改的）');
  assert.deepEqual(merge3(base, note, base), { text: note, conflicts: 0 });
  const file = base.replace('第三段', '第三段（项目里改的）');
  assert.deepEqual(merge3(base, base, file), { text: file, conflicts: 0 });
});

test('两边改了不同的段落：都留下，合成一份', () => {
  const note = base.replace('第一段', '第一段（笔记）');
  const file = base.replace('第三段', '第三段（项目）');
  assert.deepEqual(merge3(base, note, file), { text: '# 规范\n\n第一段（笔记）\n\n第二段\n\n第三段（项目）\n', conflicts: 0 });
});

test('两边改成一样的：只留一份', () => {
  const both = base.replace('第二段', '第二段改好了');
  assert.deepEqual(merge3(base, both, both), { text: both, conflicts: 0 });
});

test('两边在同一个地方都新加了内容：都留，笔记这边的在前', () => {
  const note = base + '\n笔记加的\n';
  const file = base + '\n项目加的\n';
  assert.deepEqual(merge3(base, note, file), { text: base + '\n笔记加的\n\n项目加的\n', conflicts: 0 });
});

test('一边在一段前面新加，另一边改了这一段：都留', () => {
  const note = base.replace('第二段', '笔记插的一段\n\n第二段');
  const file = base.replace('第二段', '第二段（项目改的）');
  assert.deepEqual(merge3(base, note, file), { text: base.replace('第二段', '笔记插的一段\n\n第二段（项目改的）'), conflicts: 0 });
});

test('两边把同一段改得不一样：用后改的那边，记一处', () => {
  const note = base.replace('第二段', '第二段：笔记的说法');
  const file = base.replace('第二段', '第二段：项目的说法');
  assert.deepEqual(merge3(base, note, file, 'file'), { text: file, conflicts: 1 });
  assert.deepEqual(merge3(base, note, file, 'note'), { text: note, conflicts: 1 });
  // 同时别处的不冲突的改动照样合进来
  const note2 = note.replace('第一段', '第一段（笔记）');
  assert.deepEqual(merge3(base, note2, file, 'file'), { text: file.replace('第一段', '第一段（笔记）'), conflicts: 1 });
});

test('一边删了一段、另一边改了这一段：算冲突，按规则选', () => {
  const note = base.replace('第二段\n\n', '');
  const file = base.replace('第二段', '第二段（项目改的）');
  assert.equal(merge3(base, note, file, 'note').text, note);
  assert.equal(merge3(base, note, file, 'note').conflicts, 1);
});

test('结尾有没有换行照原样', () => {
  assert.equal(merge3('a\nb', 'a\nb', 'a\nB').text, 'a\nB');
  assert.equal(merge3('a\nb\n', 'A\nb\n', 'a\nb\n').text, 'A\nb\n');
  assert.equal(merge3('', '新的', '').text, '新的');
});
