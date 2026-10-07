// 在真浏览器（无头 Chrome）里模拟打字、点击、拖文件，检查编辑器的行为和发给 App 的内容。
// 单元测试测不到的问题（光标落错地方、打的字丢了、行序乱了）靠这个抓。
// 用法：npm --prefix editor run test:browser（先 npm --prefix editor run build）
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const here = dirname(fileURLToPath(import.meta.url));
const page = resolve(here, '../dist/index.html');
const samplePNG = resolve(here, '../../App/Icon/icon-1024.png');

// ---- 无头 Chrome ----
const port = 9400 + Math.floor(Math.random() * 500);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'bettermd-test-'))}`,
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking', 'about:blank',
], { stdio: 'ignore' });
const quit = code => { try { chrome.kill('SIGKILL'); } catch {} process.exit(code); };
setTimeout(() => { console.error('超时'); quit(2); }, 120000);

let target;
for (let i = 0; i < 80 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch {}
  if (!target) await delay(250);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(ok => { ws.onopen = ok; });
let seq = 0;
const pending = new Map();
const pageErrors = [];
const loadedListeners = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails.exception?.description);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') pageErrors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
  if (m.method === 'Page.loadEventFired') loadedListeners.forEach(f => f());
};
const send = (method, params = {}) => new Promise(ok => { const i = ++seq; pending.set(i, ok); ws.send(JSON.stringify({ id: i, method, params })); });
const run = async expression => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description);
  return r.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 900, deviceScaleFactor: 1, mobile: false });
const loaded = new Promise(ok => loadedListeners.push(ok));
await send('Page.navigate', { url: 'file://' + page });
await loaded;
// 假装自己是 App：记下编辑器发来的消息；附件回一个固定的链接
await run(`window.sent = []; window.webkit = { messageHandlers: { bettermd: { postMessage: m => {
  window.sent.push(m); return Promise.resolve(m.type === 'attach' ? { link: '附件/x.png' } : null); } } } }; true`);

// ---- 小工具 ----
const doc = () => run('window.bettermd.view.state.doc.toString()');
const lastChange = async () => JSON.parse(await run('JSON.stringify(window.sent.filter(m => m.type === "change").at(-1) ?? null)'));
const setDoc = (id, text, opts = {}) => run(`window.bettermd.setDocument(${JSON.stringify(id)}, ${JSON.stringify(text)}, ${JSON.stringify(opts)})`);
const cursorAt = expr => run(`(() => { const v = window.bettermd.view; v.focus(); v.dispatch({ selection: { anchor: ${expr} } }); })()`);
const atEnd = () => cursorAt('v.state.doc.length');
const atText = text => cursorAt(`v.state.doc.toString().indexOf(${JSON.stringify(text)})`);
const key = async (k, code, modifiers = 0, text) => {
  const vk = k === 'Enter' ? 13 : k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0;
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, modifiers, text, windowsVirtualKeyCode: vk });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers });
  await delay(60);
};
const META = 4;
const type = async text => {
  for (const ch of text) {
    if (ch === '\n') await key('Enter', 'Enter', 0, '\r');
    else await send('Input.insertText', { text: ch });
  }
  await delay(200);
};
const click = async (x, y) => {
  for (const t of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type: t, x, y, button: 'left', clickCount: 1 });
  await delay(150);
};
const centerOf = sel => run(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
const count = sel => run(`document.querySelectorAll(${JSON.stringify(sel)}).length`);

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✔' : '✘'} ${name}${ok ? '' : '：' + detail}`);
  if (!ok) failures++;
};
const HEAD = '# Activation of Neural Network\n## Neuron\n\n';

// ---- 公式：各种写法边打边看。每一例都在编辑器有焦点时换一篇新笔记（⌘N 之后接着写就是这样） ----
const formulas = [
  ['块公式 $$', '$$\n\\sigma(x) = \\frac{1}{1+e^{-x}}\n$$'],
  ['行内 $…$', '激活函数 $\\sigma(x) = \\frac{1}{1+e^{-x}}$ 很常用'],
  ['两边留空格的 $ … $', '激活函数 $ y = \\max(0, x) $ 很常用'],
  ['\\( … \\)', '激活函数 \\( y = \\max(0, x) \\) 很常用'],
  ['\\[ … \\] 公式块', '\\[\ny = \\sum_i w_i x_i + b\n\\]'],
  ['连打两个 ￥ 变成 $$', '￥￥\ny = x^2\n￥￥', '$$\ny = x^2\n$$'],
  ['\\begin{equation}', '\\begin{equation}\nE = mc^2\n\\end{equation}'],
  ['```math 代码块', '```math\ny = x^2\n```'],
];
for (const [name, body, expected = body] of formulas) {
  await setDoc('公式-' + name, HEAD);
  await atEnd();
  await type(body);
  const text = await doc();
  const sent = (await lastChange())?.text;
  await cursorAt('0');
  await delay(150);
  const rendered = await count('.cm-math-inline .katex, .cm-math-block .katex');
  const broken = await count('.cm-math-inline .katex-error, .cm-math-block .katex-error');
  check(`公式：${name}`, text === HEAD + expected && sent === text && rendered === 1 && broken === 0,
    JSON.stringify({ text: text.slice(HEAD.length), sentMatches: sent === text, rendered, broken }));
}

// ---- 复选框、列表、格式快捷键、撤销 ----
await setDoc('基本', '# 标题\n\n第一段\n\n- [ ] 买菜\n- 苹果\n');
await delay(150);
await click(...await centerOf('.cm-task-box'));
check('点复选框勾上待办', (await doc()).includes('- [x] 买菜') && (await lastChange())?.text.includes('- [x] 买菜'));
await atText('苹果');
await cursorAt('v.state.doc.toString().indexOf("苹果") + 2');
await key('Enter', 'Enter', 0, '\r');
await type('香蕉');
check('列表里回车自动接上符号', (await doc()).includes('- 苹果\n- 香蕉'));
await run(`(() => { const v = window.bettermd.view; const at = v.state.doc.toString().indexOf('第一段'); v.dispatch({ selection: { anchor: at, head: at + 3 } }); })()`);
await key('b', 'KeyB', META);
check('⌘B 加粗', (await doc()).includes('**第一段**'));
await key('z', 'KeyZ', META);
check('⌘Z 撤销', (await doc()).includes('\n第一段\n'));

// ---- 和 App 之间不丢字、不串篇 ----
await setDoc('A', '# 甲\n\n甲的正文');
await setDoc('B', '# 乙\n\n看 [](https://x.com) 这里');
await atEnd();
await type('!');
const toB = await lastChange();
check('空链接的笔记里打字，改动记在这篇上', toB?.id === 'B' && toB.text === '# 乙\n\n看 [](https://x.com) 这里!', JSON.stringify(toB));
await key('Enter', 'Enter', 0, '\r');
await key('k', 'KeyK', META);
await type('https://y.com');
check('⌘K 插入链接后打网址', (await doc()).endsWith('[](https://y.com)') && (await lastChange())?.text.endsWith('[](https://y.com)'));
let before = await run('window.sent.length');
await setDoc('B', '# 乙\r\n\r\n外面改过\r\n第二行', { seq: 1e9 });
check('Windows 换行的新内容不多出空行、不回传', (await doc()) === '# 乙\n\n外面改过\n第二行' && (await run('window.sent.length')) === before);
await atEnd();
await type('新打的字');
const latest = (await lastChange()).seq;
await setDoc('B', '# 乙\n\n过时的内容', { seq: latest - 1 });
check('App 送来过时的内容时保留刚打的字并重发', (await doc()).endsWith('新打的字') && (await lastChange()).text.endsWith('新打的字'));
await setDoc('B', '# 乙\n\n外面又改了', { seq: (await lastChange()).seq });
check('不过时的内容照常更新', (await doc()) === '# 乙\n\n外面又改了');
await setDoc('N', '# 新笔记\n\n', { selectTitle: true });
check('新笔记选中标题', (await run('(() => { const v = window.bettermd.view; const r = v.state.selection.main; return v.state.sliceDoc(r.from, r.to); })()')) === '新笔记');
await setDoc('R', '- [ ] 只读', { readOnly: true });
await delay(150);
await click(...await centerOf('.cm-task-box'));
check('废纸篓里的笔记点复选框不改', (await doc()) === '- [ ] 只读');

// ---- 拖文件进来 ----
await setDoc('D', '# 图\n\n第一段\n\n');
await delay(150);
const drop = async (x, y) => {
  const data = { items: [], files: [samplePNG], dragOperationsMask: 1 };
  for (const t of ['dragEnter', 'dragOver', 'drop']) { await send('Input.dispatchDragEvent', { type: t, x, y, data }); await delay(120); }
  await delay(500);
};
const [lx, ly] = await run(`(() => { const r = [...document.querySelectorAll('.cm-line')][2].getBoundingClientRect(); return [r.left + 10, r.top + r.height / 2]; })()`);
await drop(lx, ly);
check('图片拖到一行文字中间时放到这行后面', (await doc()).includes('第一段\n![](附件/x.png)'), JSON.stringify(await doc()));
await drop(8, 400);
check('拖到正文两边的空白处也能放下', (await doc()).split('![](附件/x.png)').length === 3);
check('松手后提示框消失', !(await run('document.getElementById("editor").classList.contains("is-dropping")')));

check('页面没有报错', pageErrors.length === 0, pageErrors.join(' | '));
console.log(failures ? `\n${failures} 项没通过` : '\n全部通过');
quit(failures ? 1 : 0);
