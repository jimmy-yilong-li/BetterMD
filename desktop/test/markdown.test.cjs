const test = require('node:test');
const assert = require('node:assert/strict');
const { rebase, resolveLocal } = require('../markdown.cjs');

test('移动时改写图片、引用式链接；网址、锚点、代码不变', () => {
  const text = '# 标题\n![](../附件/a.png)\n[文档](b.md#section)\n[ref]: ../附件/a.png "图"\n`[不是链接](b.md)`\n```md\n![](../附件/a.png)\n```\n[网站](https://example.com)\n[锚点](#here)';
  const moved = rebase(text, '工作', '生活/子目录');
  assert.ok(moved.includes('![](../../%E9%99%84%E4%BB%B6/a.png)'));
  assert.ok(moved.includes('[文档](../../%E5%B7%A5%E4%BD%9C/b.md#section)'));
  assert.ok(moved.includes('[ref]: ../../%E9%99%84%E4%BB%B6/a.png "图"'));
  for (const unchanged of ['`[不是链接](b.md)`', '```md\n![](../附件/a.png)\n```', '[网站](https://example.com)', '[锚点](#here)']) assert.ok(moved.includes(unchanged));
  assert.equal(resolveLocal('', '../outside'), null);
  assert.equal(resolveLocal('工作', '../附件/a%20b.png'), '附件/a b.png');
});
