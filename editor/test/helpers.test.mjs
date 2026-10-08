// 标签、表格、路径这些小工具。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findTags, splitRow, parseTable, resolveTarget, libraryURL, countParagraphs, countWords } from '../src/helpers.js';

const names = line => findTags(line).map(t => t.name);

test('标签：和 Swift 端的规则一致', () => {
  assert.deepEqual(names('#想法 和 #会议/周会'), ['想法', '会议/周会']);
  assert.deepEqual(names('# 标题'), []);
  assert.deepEqual(names('a#b'), []);
  assert.deepEqual(names('看看 #读书。下一句'), ['读书']);
  assert.deepEqual(names('#tag. 和 #a/b/'), ['tag', 'a/b']);
  assert.deepEqual(names('#/x'), ['x']);
  assert.deepEqual(names('##'), []);
});

test('标签的位置按 UTF-16 算', () => {
  const line = '😀 #表情';
  const [tag] = findTags(line);
  assert.equal(line.slice(tag.from, tag.to), '#表情');
});

test('拆表格的一行', () => {
  assert.deepEqual(splitRow('| a | b |'), ['a', 'b']);
  assert.deepEqual(splitRow('a | b'), ['a', 'b']);
  assert.deepEqual(splitRow('| a \\| b | c |'), ['a \\| b', 'c']);
  assert.deepEqual(splitRow('| | x |'), ['', 'x']);
});

test('解析表格', () => {
  const t = parseTable('| 名字 | 数量 | 说明 |\n|:--|--:|:-:|\n| 苹果 | 3 | 红 |\n| 梨 | 5 |');
  assert.deepEqual(t.header, ['名字', '数量', '说明']);
  assert.deepEqual(t.align, ['left', 'right', 'center']);
  assert.deepEqual(t.rows, [['苹果', '3', '红'], ['梨', '5', '']]);
});

test('图片和链接的地址', () => {
  assert.deepEqual(resolveTarget('', '附件/a.png'), { path: '附件/a.png' });
  assert.deepEqual(resolveTarget('工作/客户', '../../附件/a.png'), { path: '附件/a.png' });
  assert.deepEqual(resolveTarget('工作', './图.png'), { path: '工作/图.png' });
  assert.deepEqual(resolveTarget('工作', '/附件/a.png'), { path: '附件/a.png' });
  assert.deepEqual(resolveTarget('', 'my%20pic.png'), { path: 'my pic.png' });
  assert.deepEqual(resolveTarget('', '<附件/a b.png>'), { path: '附件/a b.png' });
  assert.deepEqual(resolveTarget('', 'https://x.com/a.png'), { url: 'https://x.com/a.png' });
  assert.deepEqual(resolveTarget('', 'mailto:a@b.c'), { url: 'mailto:a@b.c' });
  assert.equal(resolveTarget('', '../a.png'), null);
  assert.equal(resolveTarget('', '#锚点'), null);
  assert.equal(resolveTarget('', ''), null);
});

test('「我的笔记」里文件的网页地址', () => {
  assert.equal(libraryURL('附件/a b.png'), 'bettermd://library/%E9%99%84%E4%BB%B6/a%20b.png');
});

test('折叠后显示的段数', () => {
  assert.equal(countParagraphs('\n第一段\n还是第一段\n\n第二段\n'), 2);
  assert.equal(countParagraphs('```js\na\n\nb\n```\n\n后面'), 2);
  assert.equal(countParagraphs('$$\nx\n\ny\n$$'), 1);
  assert.equal(countParagraphs('$$x$$\n\n- 列表\n- 列表'), 2);
  assert.equal(countParagraphs(''), 0);
});

test('字数：汉字一个一个算，英文按词算', () => {
  assert.equal(countWords('傅里叶变换'), 5);
  assert.equal(countWords('Fourier transform 很有用'), 5);
  assert.equal(countWords('# 标题\n- [ ] 买菜 **bold**'), 5);
  assert.equal(countWords("don't stop"), 2);
  assert.equal(countWords(''), 0);
});
