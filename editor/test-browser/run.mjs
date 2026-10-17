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
const key = async (k, code, modifiers = 0, text, keyCode) => {
  const vk = keyCode ?? (k === 'Enter' ? 13 : k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, modifiers, text, windowsVirtualKeyCode: vk });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers });
  await delay(60);
};
const ALT = 1, CTRL = 2, META = 4, SHIFT = 8;
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

// ---- 代码审查找到的问题 ----
// 粘贴图片后 App 还没存好时接着打字：打的字不能被盖掉
await run(`window.slowAttach = true; const orig = window.webkit.messageHandlers.bettermd.postMessage;
  window.webkit.messageHandlers.bettermd.postMessage = m => { window.sent.push(m);
    return m.type === 'attach' ? new Promise(r => setTimeout(() => r({ link: '附件/x.png' }), 600)) : Promise.resolve(null); }; true`);
await setDoc('P', 'hello world');
await run(`(() => { const v = window.bettermd.view; v.focus(); v.dispatch({ selection: { anchor: 0, head: 5 } }); })()`);
await run(`(() => { const dt = new DataTransfer();
  const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
  dt.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
  window.bettermd.view.contentDOM.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
await delay(100);
await type('Hi, ');
await delay(900);
check('粘贴图片时接着打字，字不会被盖掉', (await doc()).includes('Hi, ') && (await doc()).includes('![](附件/x.png)') && (await doc()).includes('world'), JSON.stringify(await doc()));
check('最后发给 App 的就是屏幕上的内容', (await lastChange())?.text === await doc());

// 中文输入法正在拼字时，App 送来同一篇的新内容（比如标题下那行时间变了）：拼的字不能丢，拼完照常发给 App
await setDoc('I', '# 题\n\nA', { meta: { modified: '今天 10:00', folder: '未分类' } });
await atEnd();
await send('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 });
await delay(100);
await setDoc('I', '# 题\n\nA', { meta: { modified: '今天 10:01', folder: '未分类' }, seq: (await lastChange())?.seq ?? 0 });
await delay(100);
await send('Input.insertText', { text: '你' });
await delay(300);
check('拼字时 App 刷新，拼完的字照常进正文并发给 App', (await doc()).endsWith('A你') && (await lastChange())?.text.endsWith('A你'), JSON.stringify(await doc()));

// “3~5 次”不是下标
await setDoc('S', '每天3~5次，持续2~3周');
await delay(150);
check('“3~5 次”照原样显示，不当成下标', (await run('document.querySelector(".cm-content").textContent')).includes('3~5次'));

// 表格单元格里的“1. 第一步”不当成列表
await setDoc('T', '前面一行\n\n| 步骤 | 说明 |\n| --- | --- |\n| 1. 第一步 | - 一项 |');
await delay(150);
check('表格单元格里的“1. 第一步”“- 一项”照原样显示', (await run('document.querySelector(".cm-table")?.textContent ?? ""')).includes('1. 第一步') && (await run('document.querySelector(".cm-table")?.textContent ?? ""')).includes('- 一项'));

// 点公式：光标放在开头记号后面
await setDoc('M', '看 \\( y = x \\) 这里\n\n\\begin{equation}\nE = mc^2\n\\end{equation}');
await delay(200);
await click(...await centerOf('.cm-math-inline'));
await type('Z');
check('点行内 \\( \\) 公式后打字，字在记号后面', (await doc()).startsWith('看 \\(Z y = x \\)'), JSON.stringify((await doc()).split('\n')[0]));
await setDoc('M2', '前面\n\n\\begin{equation}\nE = mc^2\n\\end{equation}');
await delay(200);
await click(...await centerOf('.cm-math-block'));
await type('Z');
check('点 \\begin{equation} 公式块后打字，字在第一行末尾', (await doc()).includes('\\begin{equation}Z\n'), JSON.stringify(await doc()));

// 格式命令
await setDoc('F1', '标题行\n\n正文');
await run(`(() => { const v = window.bettermd.view; v.focus(); v.dispatch({ selection: { anchor: 0, head: 4 } }); })()`);
await key('1', 'Digit1', META);
check('选到下一行开头再按 ⌘1，只改这一行', (await doc()) === '# 标题行\n\n正文', JSON.stringify(await doc()));
await setDoc('F2', 'abc');
await atEnd();
await run('window.bettermd.format("rule")');
check('在文字后面插分割线，中间空一行（不会把文字变成标题）', (await doc()) === 'abc\n\n---\n', JSON.stringify(await doc()));
await setDoc('F3', '');
await atEnd();
await run('window.bettermd.format("table")');
await type('甲');
check('插入表格后光标在第一个空格子里', (await doc()).split('\n')[2] === '| 甲 |  |', JSON.stringify(await doc()));
await setDoc('F4', '1. a\n2. b');
await run(`(() => { const v = window.bettermd.view; v.focus(); v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } }); })()`);
await run('window.bettermd.format("numbered")');
check('编号列表再按一次是去掉编号，不会叠成“1. 1. a”', (await doc()) === 'a\nb', JSON.stringify(await doc()));
await setDoc('F5', '- a\nb');
await run(`(() => { const v = window.bettermd.view; v.focus(); v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } }); })()`);
await run('window.bettermd.format("list")');
check('一半是列表时变成列表，不会叠成“- - a”', (await doc()) === '- a\n- b', JSON.stringify(await doc()));

// 空文字的链接在光标离开后还看得见
await setDoc('L', '看 [](https://x.com) 这里');
await delay(150);
check('空文字的链接在光标离开后还看得见', (await run('document.querySelector(".cm-content").textContent')).includes('https://x.com'));

// ⌘/ 不再把这一行变成注释
await setDoc('C', '一行字');
await atEnd();
await key('/', 'Slash', META);
check('⌘/ 不会把这一行变成 HTML 注释', (await doc()) === '一行字', JSON.stringify(await doc()));


// ---- 快捷键（照 Bear）：按真的按键，看正文怎么变 ----
const selectAll = () => run(`(() => { const v = window.bettermd.view; v.focus(); v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } }); })()`);
await setDoc('K', '买菜');
await atEnd();
await key('t', 'KeyT', META);
check('⌘T 变成待办', (await doc()) === '- [ ] 买菜', JSON.stringify(await doc()));
await key('.', 'Period', META, undefined, 190);
check('⌘. 勾上待办', (await doc()) === '- [x] 买菜', JSON.stringify(await doc()));
await key('.', 'Period', META, undefined, 190);
check('再按 ⌘. 取消', (await doc()) === '- [ ] 买菜', JSON.stringify(await doc()));
await key('t', 'KeyT', META);
check('待办上再按 ⌘T 变回普通文字', (await doc()) === '买菜', JSON.stringify(await doc()));
await run('window.sent = []');
await key('.', 'Period', META, undefined, 190);
check('普通文字上按 ⌘. 什么都不改，也不会当成 Esc', (await doc()) === '买菜' && !(await run('window.sent.some(m => m.type === "exitFocus")')));

await setDoc('K2', '甲\n\n乙');
await selectAll();
await key('t', 'KeyT', META);
check('选了好几行按 ⌘T，空行不变成待办', (await doc()) === '- [ ] 甲\n\n- [ ] 乙', JSON.stringify(await doc()));

const styled = async (name, k, code, mods, vk, before, after) => {
  await setDoc('S' + name, before);
  await selectAll();
  await key(k, code, mods, undefined, vk);
  check(name, (await doc()) === after, JSON.stringify(await doc()));
};
await styled('⇧⌘U 删除线', 'U', 'KeyU', SHIFT | META, 85, '字', '~~字~~');
await styled('⌥⌘C 行内代码', 'ç', 'KeyC', ALT | META, 67, 'x', '`x`');
await styled('⌘L 列表', 'l', 'KeyL', META, 76, 'a', '- a');
await styled('⇧⌘L 编号', 'L', 'KeyL', SHIFT | META, 76, 'a', '1. a');
await styled('⇧⌘T 引用', 'T', 'KeyT', SHIFT | META, 84, 'a', '> a');
await styled('⌘4 四级标题', '4', 'Digit4', META, 52, 'a', '#### a');
await styled('⌃⌘C 选中的文字围成代码块', 'c', 'KeyC', CTRL | META, 67, 'let a = 1', '```\nlet a = 1\n```');

await setDoc('M', '一\n二\n三');
await atText('一');
await key('ArrowDown', 'ArrowDown', ALT | META, undefined, 40);
check('⌥⌘↓ 把这一行往下挪', (await doc()) === '二\n一\n三', JSON.stringify(await doc()));

await setDoc('D', '');
await atEnd();
await key('*', 'Digit8', SHIFT | META, undefined, 56);
check('⇧⌘8 插入日期', /^\d{4}年\d{1,2}月\d{1,2}日$/.test(await doc()), JSON.stringify(await doc()));

await setDoc('F', '# 一节\n\n第一段\n\n第二段\n\n# 下一节\n\n别的');
await atText('第二段');
await key("'", 'Quote', META, undefined, 222);
check("⌘' 在正文里按，折起所在的这一节", (await count('.cm-fold-badge')) === 1);
await key("'", 'Quote', META, undefined, 222);
check("再按 ⌘' 展开", (await count('.cm-fold-badge')) === 0);

await setDoc('Q', '苹果 香蕉 苹果');
await atEnd();
await key('f', 'KeyF', META);
check('⌘F 打开查找栏', (await count('.cm-search')) === 1);
await type('苹果');
// 真打字时每个键松开都会让查找栏读一次输入框；这里是直接塞进去的字，补一个 change
await run(`document.querySelector('.cm-search input[name=search]').dispatchEvent(new Event('change'))`);
await key('Enter', 'Enter', 0, '\r');
const found = await run('(() => { const v = window.bettermd.view; const r = v.state.selection.main; return v.state.sliceDoc(r.from, r.to); })()');
check('查找栏里回车选中下一个', found === '苹果', JSON.stringify(found));
await key('Escape', 'Escape', 0, undefined, 27);
check('Esc 关掉查找栏', (await count('.cm-search')) === 0);
check('查找不改正文', (await doc()) === '苹果 香蕉 苹果');

await key('f', 'KeyF', META);
// 查找栏里的格式键要被编辑器拦下（没拦下的键，App 里会交给菜单，菜单再去改正文）
const swallowed = await run(`(() => {
  const input = document.querySelector('.cm-search input[name=search]');
  return ['b', 't', '1'].map(k => !input.dispatchEvent(new KeyboardEvent('keydown',
    { key: k, code: k === '1' ? 'Digit1' : 'Key' + k.toUpperCase(), keyCode: k.toUpperCase().charCodeAt(0), metaKey: true, bubbles: true, cancelable: true })));
})()`);
check('查找栏里的 ⌘B、⌘T、⌘1 被拦下，不会漏给菜单，也不改正文', swallowed.every(Boolean) && (await doc()) === '苹果 香蕉 苹果', JSON.stringify([swallowed, await doc()]));
await run('window.bettermd.format("bold"); window.bettermd.format("todo")');
check('光标在查找栏里时，菜单来的格式命令不改正文', (await doc()) === '苹果 香蕉 苹果', JSON.stringify(await doc()));
await key('Escape', 'Escape', 0, undefined, 27);

await setDoc('CB', '```sh\n# 注释\necho hi\n```');
await atText('echo');
await key('t', 'KeyT', META);
await key('c', 'KeyC', CTRL | META, undefined, 67);
check('代码块里按 ⌘T、⌃⌘C 不改代码', (await doc()) === '```sh\n# 注释\necho hi\n```', JSON.stringify(await doc()));

await setDoc('F2', '# 一节\n\n```sh\n# 注释\n```\n\n正文');
await atText('正文');
await key("'", 'Quote', META, undefined, 222);
check("⌘' 跳过代码块里的“# 注释”，折起真正的那一节", (await count('.cm-fold-badge')) === 1);

await setDoc('Q', '苹果 香蕉 苹果');
await atEnd();
await run('window.sent = []');
await key('Enter', 'Enter', META, undefined, 13);
check('⌘↩ 请 App 把焦点交给笔记列表', await run('window.sent.some(m => m.type === "focusList")'));
check('⌘↩ 不往正文里加空行', (await doc()) === '苹果 香蕉 苹果');

// ---- 合作者审查（2026-10-17）找到的问题 ----
// 选中文字粘贴附件，App 还没存好时换了笔记：原来那篇不能少字
await run(`window.slowAttach = true; window.webkit.messageHandlers.bettermd.postMessage = m => { window.sent.push(m);
  return m.type === 'attach' ? new Promise(r => setTimeout(() => r({ link: '附件/x.png' }), 500)) : Promise.resolve(null); }; true`);
const pastePNG = `(() => { const dt = new DataTransfer();
  const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
  dt.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
  window.bettermd.view.contentDOM.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`;
await setDoc('R1', 'hello world');
await run('window.sent = []');
await run(`(() => { const v = window.bettermd.view; v.focus(); v.dispatch({ selection: { anchor: 0, head: 5 } }); })()`);
await run(pastePNG);
await delay(50);
await setDoc('R2', '另一篇');
await delay(800);
const toR1 = await run('window.sent.filter(m => m.type === "change" && m.id === "R1").map(m => m.text)');
check('粘贴附件时换了笔记，原来那篇不少字', toR1.every(t => t === 'hello world'), JSON.stringify(toR1));
check('换过去的那篇也没插进附件', (await doc()) === '另一篇', JSON.stringify(await doc()));

// 附件没存成（App 回了空）：选中的字原样
await run(`window.webkit.messageHandlers.bettermd.postMessage = m => { window.sent.push(m); return Promise.resolve(null); }; true`);
await setDoc('R3', 'hello world');
await run(`(() => { const v = window.bettermd.view; v.focus(); v.dispatch({ selection: { anchor: 0, head: 5 } }); })()`);
await run(pastePNG);
await delay(300);
check('附件没存成时，选中的字不会被删', (await doc()) === 'hello world', JSON.stringify(await doc()));

// 附件存好了：选中的字换成链接，一步完成，⌘Z 一次就整个撤回
await run(`window.webkit.messageHandlers.bettermd.postMessage = m => { window.sent.push(m);
  return Promise.resolve(m.type === 'attach' ? { link: '附件/x.png' } : null); }; true`);
await run(`(() => { const v = window.bettermd.view; v.focus(); v.dispatch({ selection: { anchor: 0, head: 5 } }); })()`);
await run(pastePNG);
await delay(300);
check('选中的字换成了附件', (await doc()).startsWith('![](附件/x.png)') && !(await doc()).includes('hello'), JSON.stringify(await doc()));
await key('z', 'KeyZ', META);
check('⌘Z 一次就恢复原样', (await doc()) === 'hello world', JSON.stringify(await doc()));

// 公式块结尾的 $$ 后面还有字：那些字照常显示，不跟着公式藏起来
await setDoc('M2', '开头\n\n$$\nx^2\n$$ 是平方\n\n结尾');
await atText('结尾');
await delay(200);
check('公式块结尾行后面的字照常显示', (await run('document.querySelector(".cm-content").textContent')).includes('是平方'));

// ---- 编辑器和插件的审查（2026-10-17）找到的问题 ----
await run(`window.webkit.messageHandlers.bettermd.postMessage = m => { window.sent.push(m); return Promise.resolve(m.type === 'attach' ? { link: '附件/x.png' } : null); }; true`);
const changesFor = async id => JSON.parse(await run(`JSON.stringify(window.sent.filter(m => m.type === 'change' && m.id === ${JSON.stringify(id)}))`));

// 输入法正在拼字时换了笔记：拼的字不能落进新笔记；之后在新笔记里打的字照常发给 App
await run('window.sent = []');
await setDoc('IA', '甲');
await cursorAt('1');
await send('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 });
await delay(80);
await setDoc('IB', '乙');
// 换过去以后编辑器不能还以为在拼字（不然新笔记里打的字都攒着不发）。
// 拼了一半的字去哪：真的 WebKit 在编辑器失去焦点时把它交给原来那篇；无头 Chrome 模拟不了这一步，这里不查
check('拼字时换了笔记，换过去以后不再是“正在拼字”', (await run('window.bettermd.view.composing')) === false);
await delay(80);
await send('Input.insertText', { text: '你' });
await delay(300);
await atEnd();
await type('abc');
await delay(300);
check('换过去以后打的字照常发给 App', (await changesFor('IB')).at(-1)?.text === await doc(), JSON.stringify([await doc(), await changesFor('IB')]));

// 重新打开一篇：App 还没收到这篇最后的改动（送来的编号小），不能用旧内容盖掉刚打的字
await run('window.sent = []');
await setDoc('A2', '甲的正文');
await cursorAt('4');
await type('！');
const lastA2 = (await changesFor('A2')).at(-1).seq;
await setDoc('B2', '乙');
await setDoc('A2', '甲的正文', { seq: lastA2 - 1 });
check('重新打开时 App 送来旧内容，刚打的字还在', (await doc()) === '甲的正文！', JSON.stringify(await doc()));
check('并且重发给 App，标明拒收了旧内容', (await changesFor('A2')).at(-1)?.overrode === true && (await changesFor('A2')).at(-1)?.text === '甲的正文！');

// 附件还在存时换到别的笔记打字，再回来：附件不会插到错的地方，正文不变，页面不报错
await run(`window.webkit.messageHandlers.bettermd.postMessage = m => { window.sent.push(m);
  return m.type === 'attach' ? new Promise(r => setTimeout(() => r({ link: '附件/x.png' }), 600)) : Promise.resolve(null); }; true`);
await setDoc('PA', 'hello world');
await run(`(() => { const v = window.bettermd.view; v.focus(); v.dispatch({ selection: { anchor: 0, head: 5 } }); })()`);
await run(pastePNG);
await delay(50);
await setDoc('PB', 'abc');
await atEnd();
await type('0123456789');
await setDoc('PA', 'hello world');
await delay(900);
check('附件存好前换走又回来：原来那篇不变', (await doc()) === 'hello world', JSON.stringify(await doc()));
await run(`window.webkit.messageHandlers.bettermd.postMessage = m => { window.sent.push(m); return Promise.resolve(m.type === 'attach' ? { link: '附件/x.png' } : null); }; true`);

// 只有开头没有结尾的 $$：不画成公式，后面的标题、列表照常显示
await setDoc('U', '开头\n\n$$\nx^2\n\n# 后面的标题\n\n- 列表');
await atText('开头');
await delay(200);
check('没写结尾的 $$ 不会把后面整篇变成公式', (await count('.cm-math-block')) === 0 && (await run('document.querySelector(".cm-content").textContent')).includes('后面的标题'));

// 编号列表里的待办：序号和方框都显示
await setDoc('N', '1. [ ] 第一步\n2. [x] 第二步\n\n别处');
await atText('别处');
await delay(200);
check('编号列表里的待办还显示序号', (await run('[...document.querySelectorAll(".cm-task-number")].map(e => e.textContent).join(",")')) === '1.,2.' && (await count('.cm-task-box')) === 2);

// 表格格子里代码中的 \| 显示成 |
await setDoc('T2', '| 写法 | 说明 |\n| --- | --- |\n| `a \\| b` | 竖线 |\n\n别处');
await atText('别处');
await delay(200);
check('表格格子里的 \\| 显示成 |', (await run('document.querySelector(".cm-table code")?.textContent ?? ""')) === 'a | b', await run('document.querySelector(".cm-table code")?.textContent ?? ""'));

// 拖文件进来时接住拖动（VS Code 里没人接的话会交给 VS Code 自己打开那个文件）
check('拖文件进来时接住拖动', await run(`(() => { const dt = new DataTransfer(); dt.items.add(new File(['x'], 'a.png', { type: 'image/png' }));
  const e = new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }); document.body.dispatchEvent(e);
  document.body.dispatchEvent(new DragEvent('dragleave', { dataTransfer: dt, bubbles: true })); return e.defaultPrevented; })()`));

// 在 Finder 里复制文件再粘贴：剪贴板里的文字只是文件名，贴的是文件
await setDoc('FP', '');
await atEnd();
await run(`(() => { const dt = new DataTransfer();
  const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
  dt.items.add(new File([bytes], '截图.png', { type: 'image/png' })); dt.setData('text/plain', '截图.png');
  window.bettermd.view.contentDOM.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
await delay(300);
check('从 Finder 复制的文件粘贴进来是附件，不是文件名', (await doc()).includes('![](附件/x.png)'), JSON.stringify(await doc()));

check('页面没有报错', pageErrors.length === 0, pageErrors.join(' | '));
console.log(failures ? `\n${failures} 项没通过` : '\n全部通过');
quit(failures ? 1 : 0);
