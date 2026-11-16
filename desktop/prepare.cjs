// 开发和安装包使用同一份编辑器和解析规则；生成物不进 git。图标在 icons/（scripts/make-linux-icons.sh 生成，进 git）。
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const resources = path.join(__dirname, 'resources');
fs.mkdirSync(path.join(resources, 'shared'), { recursive: true });
fs.cpSync(path.join(root, 'editor/dist'), path.join(resources, 'editor'), { recursive: true });
for (const name of ['notes.js', 'lib.js']) fs.copyFileSync(path.join(root, 'vscode', name), path.join(resources, 'shared', name));
fs.rmSync(path.join(resources, 'icon.png'), { force: true }); // 以前放在这里的 1024 图标，现在用 icons/
