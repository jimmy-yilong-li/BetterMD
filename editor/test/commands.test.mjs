// 格式命令里不依赖界面的部分。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateText } from '../src/commands.js';

test('插入日期的几种写法（⇧⌘7…⇧⌘0）', () => {
  const d = new Date(2026, 9, 8, 9, 5); // 2026-10-08 09:05
  assert.equal(dateText('dateTime', d), '2026年10月8日 09:05');
  assert.equal(dateText('date', d), '2026年10月8日');
  assert.equal(dateText('shortDate', d), '2026-10-08');
  assert.equal(dateText('time', d), '09:05');
  assert.equal(dateText('别的', d), '');
});
