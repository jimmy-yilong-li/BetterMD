// 开发用：用无头 Chrome 打开打包好的编辑器（editor/dist），放进一篇 Markdown，截图。
// 用法：node scripts/editor-shot.mjs <笔记.md> <输出.png> [--dark] [--cursor <文字>] [--select <起> <止>] [--size 宽x高] [--dir 文件夹]
//   --cursor：把光标放在第一次出现这段文字的地方（看源码露出来的样子）
//   --select：从第一次出现“起”的地方选到第一次出现“止”的末尾（看选区的样子）
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
const dark = args.includes('--dark') && args.splice(args.indexOf('--dark'), 1);
const cursor = flag('--cursor');
const selectAt = args.indexOf('--select');
const select = selectAt >= 0 ? args.splice(selectAt, 3).slice(1) : null;
const [width, height] = (flag('--size') ?? '900x1400').split('x').map(Number);
const dir = flag('--dir') ?? '';
const [input, output] = args;
if (!input || !output) {
  console.error('用法：node scripts/editor-shot.mjs <笔记.md> <输出.png> [--dark] [--cursor <文字>] [--size 宽x高] [--dir 文件夹]');
  process.exit(1);
}
const page = resolve(dirname(fileURLToPath(import.meta.url)), '../editor/dist/index.html');
const text = readFileSync(input, 'utf8');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9400 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'bettermd-chrome-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--force-device-scale-factor=2',
  '--disable-background-networking', '--disable-component-update', 'about:blank',
], { stdio: 'ignore' });
const quit = () => { try { chrome.kill('SIGKILL'); } catch {} };
const timer = setTimeout(() => { console.error('截图超时'); quit(); process.exit(2); }, 60000);

let target;
for (let i = 0; i < 80 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch {}
  if (!target) await delay(250);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
let id = 0;
const pending = new Map();
const listeners = [];
const logs = [];
ws.onmessage = e => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.consoleAPICalled') logs.push(msg.params.type + ': ' + msg.params.args.map(a => a.value ?? a.description).join(' '));
  if (msg.method === 'Runtime.exceptionThrown') logs.push('异常: ' + msg.params.exceptionDetails.exception?.description);
  listeners.forEach(f => f(msg));
};
const send = (method, params = {}) => new Promise(ok => { const i = ++id; pending.set(i, ok); ws.send(JSON.stringify({ id: i, method, params })); });
const run = async expression => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? '执行出错');
  return r.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
const loaded = new Promise(ok => listeners.push(m => m.method === 'Page.loadEventFired' && ok()));
await send('Page.navigate', { url: 'file://' + page });
await loaded;
await run(`window.bettermd.setDocument('dev', ${JSON.stringify(text)}, { dir: ${JSON.stringify(dir)} })`);
if (cursor) {
  await run(`(() => {
    const v = window.bettermd.view;
    const at = v.state.doc.toString().indexOf(${JSON.stringify(cursor)});
    if (at < 0) throw new Error('找不到光标位置');
    v.focus();
    v.dispatch({ selection: { anchor: at } });
  })()`);
}
if (select) {
  await run(`(() => {
    const v = window.bettermd.view, text = v.state.doc.toString();
    const from = text.indexOf(${JSON.stringify(select[0])}), end = text.indexOf(${JSON.stringify(select[1])});
    if (from < 0 || end < 0) throw new Error('找不到要选的文字');
    v.focus();
    v.dispatch({ selection: { anchor: from, head: end + ${JSON.stringify(select[1])}.length } });
  })()`);
}
await delay(900);
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(output, Buffer.from(shot.result.data, 'base64'));
clearTimeout(timer);
ws.close();
quit();
if (logs.length) console.log(logs.join('\n'));
console.log(output);
process.exit(0);
