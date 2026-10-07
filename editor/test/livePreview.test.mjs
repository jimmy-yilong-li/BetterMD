// 排版效果（装饰）对各种写法、光标在任何位置都不能出错：出错会让编辑器和 App 对不上。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { mathSyntax } from '../src/math.js';
import { livePreview, focusState, dirState } from '../src/livePreview.js';

const tricky = [
  '[](https://x.com)',
  '- [x] ',
  '- [ ] ',
  '- [x]',
  '![](附件/a.png)',
  '![]()',
  '[]()',
  '$$',
  '$$\n',
  '$ $ $$ $',
  '**',
  '****',
  '``',
  '# ',
  '#',
  '---',
  '> ',
  '>',
  '| a |\n|---|\n',
  '|',
  '```',
  '```js\n',
  '- \n  - \n    - [ ] ',
  '1. \n2. [ ] x',
  '<https://x.com>',
  '~~~~',
  'x^y^ 和 a~b~',
  '\\(',
  '\\( x \\)',
  '\\[',
  '\\[\n',
  '\\[ x \\]',
  '\\begin{equation}',
  '\\begin{equation}\nx\n\\end{equation}',
  '```math\n',
  '```math\nx^2\n```',
  '$ x $ 和 $ 1 $',
  '# 标题\n\n![图](附件/a.png)\n\n| 名 | $x$ |\n|:-:|--:|\n| 1 | **2** |\n\n$$\n\\int f\n$$\n\n- [x] 完成\n- [ ] 待办 #标签\n\n```python\nprint(1)\n```\n\n> 引用 [链接](a.md)\n\n---\n',
];

function stateFor(doc) {
  const state = EditorState.create({
    doc,
    extensions: [
      markdown({ base: markdownLanguage, extensions: [mathSyntax] }),
      focusState.init(() => true), dirState, livePreview,
    ],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

test('各种边角写法，光标放在任何位置都不出错', t => {
  const errors = [];
  t.mock.method(console, 'error', (...args) => errors.push(args.map(String).join(' ')));
  for (const doc of tricky) {
    let state = stateFor(doc);
    for (let pos = 0; pos <= doc.length; pos++) {
      state = state.update({ selection: { anchor: pos } }).state;
      state.field(livePreview);
    }
    // 再从头到尾选一遍，模拟拖选
    state = state.update({ selection: { anchor: 0, head: doc.length } }).state;
    state.field(livePreview);
  }
  assert.deepEqual(errors, []);
});

test('边打字边更新也不出错', t => {
  const errors = [];
  t.mock.method(console, 'error', (...args) => errors.push(args.map(String).join(' ')));
  const typed = '# 新笔记\n\n- [ ] 买菜 [](x) $a$ **b** `c`\n\n$$\nx^2\n$$\n| a | b |\n|---|---|\n';
  let state = stateFor('');
  for (const ch of typed) {
    const at = state.selection.main.head;
    state = state.update({ changes: { from: at, insert: ch }, selection: { anchor: at + ch.length } }).state;
    state.field(livePreview);
  }
  assert.equal(state.doc.toString(), typed);
  assert.deepEqual(errors, []);
});
