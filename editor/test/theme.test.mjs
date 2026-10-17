// 深浅色：VS Code 里看它给 <body> 的 class，别处跟着系统（返回 null）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vscodeTheme } from '../src/theme.js';

const classes = (...names) => ({ contains: n => names.includes(n) });

test('VS Code 的深浅色主题', () => {
  assert.equal(vscodeTheme(classes('vscode-dark')), true);
  assert.equal(vscodeTheme(classes('vscode-light')), false);
  assert.equal(vscodeTheme(classes('vscode-high-contrast')), true);
  assert.equal(vscodeTheme(classes('vscode-high-contrast', 'vscode-high-contrast-light')), false);
  assert.equal(vscodeTheme(classes()), null);
});
