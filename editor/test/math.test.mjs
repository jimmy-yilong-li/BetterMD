// 公式语法：什么算公式，什么不算。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parser, GFM } from '@lezer/markdown';
import { mathSyntax, texOf } from '../src/math.js';

const md = parser.configure([GFM, mathSyntax]);
/** 文中所有 `name` 节点对应的原文。 */
function find(text, name) {
  const out = [];
  md.parse(text).iterate({ enter: n => { if (n.name === name) out.push(text.slice(n.from, n.to)); } });
  return out;
}

test('行内公式', () => {
  assert.deepEqual(find('质能方程 $E=mc^2$ 很有名', 'InlineMath'), ['$E=mc^2$']);
  assert.deepEqual(find('$a$ 和 $b$', 'InlineMath'), ['$a$', '$b$']);
});

test('钱数不是公式', () => {
  assert.deepEqual(find('花了 $5 和 $6', 'InlineMath'), []);
  assert.deepEqual(find('$x$5', 'InlineMath'), []);
  assert.deepEqual(find('$ x$', 'InlineMath'), []);
});

test('转义的美元符号和代码里的 $ 不算', () => {
  assert.deepEqual(find('\\$x$', 'InlineMath'), []);
  assert.deepEqual(find('`$x$`', 'InlineMath'), []);
  assert.deepEqual(find('$a\\$b$', 'InlineMath'), ['$a\\$b$']);
});

test('行内公式不跨行', () => {
  assert.deepEqual(find('$a\nb$', 'InlineMath'), []);
});

test('段落里的 $$…$$', () => {
  assert.deepEqual(find('看 $$x^2$$ 这里', 'InlineMath'), ['$$x^2$$']);
});

test('多行公式块', () => {
  const text = '$$\n\\int f\n$$\n后面';
  assert.deepEqual(find(text, 'BlockMath'), ['$$\n\\int f\n$$']);
  assert.deepEqual(find(text, 'Paragraph'), ['后面']);
});

test('公式块可以紧跟在段落后面', () => {
  const text = '上一段\n$$\nx\n$$';
  assert.deepEqual(find(text, 'Paragraph'), ['上一段']);
  assert.deepEqual(find(text, 'BlockMath'), ['$$\nx\n$$']);
});

test('没写完的公式块一直到文末', () => {
  assert.deepEqual(find('$$\nx\ny', 'BlockMath'), ['$$\nx\ny']);
});

test('单行公式块', () => {
  assert.deepEqual(find('$$x$$', 'BlockMath'), ['$$x$$']);
  assert.deepEqual(find('$$ a + b $$\n', 'BlockMath'), ['$$ a + b $$']);
});

test('引用里的公式块', () => {
  assert.deepEqual(find('> $$\n> x\n> $$', 'BlockMath'), ['$$\n> x\n> $$']);
});

test('表格里的行内公式', () => {
  assert.deepEqual(find('| a | $x$ |\n|---|---|\n| 1 | 2 |', 'InlineMath'), ['$x$']);
});

test('缩进 4 格的 $$ 是代码', () => {
  assert.deepEqual(find('    $$\n    x\n    $$', 'BlockMath'), []);
});

test('取出 LaTeX 源码', () => {
  assert.equal(texOf('$E=mc^2$'), 'E=mc^2');
  assert.equal(texOf('$$\n\\int f\n$$'), '\\int f');
  assert.equal(texOf('$$x$$'), 'x');
  assert.equal(texOf('$$\nx\ny'), 'x\ny');
});
