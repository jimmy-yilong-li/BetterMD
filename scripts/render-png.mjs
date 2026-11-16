// 用无头 Chrome 把 SVG 或 HTML 渲染成 PNG（背景透明）。
// 用法：node scripts/render-png.mjs <输入文件> <输出.png> [宽，默认 1024] [高，默认等于宽]
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const [, , input, output, width = '1024', height = width] = process.argv;
if (!input || !output) {
  console.error('用法：node scripts/render-png.mjs <输入文件> <输出.png> [宽] [高]');
  process.exit(1);
}
const { chromePath } = await import('./chrome.mjs');
const CHROME = chromePath();
const port = 9400 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'bettermd-chrome-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-component-update', 'about:blank',
], { stdio: 'ignore' });
const quit = () => { try { chrome.kill('SIGKILL'); } catch {} };
const timer = setTimeout(() => { console.error('渲染超时'); quit(); process.exit(2); }, 60000);

let page;
for (let i = 0; i < 80 && !page; i++) {
  try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch {}
  if (!page) await delay(250);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
let id = 0;
const pending = new Map();
const events = [];
ws.onmessage = e => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } else events.forEach(f => f(msg));
};
const send = (method, params = {}) => new Promise(ok => { const i = ++id; pending.set(i, ok); ws.send(JSON.stringify({ id: i, method, params })); });

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: +width, height: +height, deviceScaleFactor: 1, mobile: false });
await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
const loaded = new Promise(ok => events.push(m => m.method === 'Page.loadEventFired' && ok()));
await send('Page.navigate', { url: 'file://' + resolve(input) });
await loaded;
await delay(600);
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(output, Buffer.from(shot.result.data, 'base64'));
clearTimeout(timer);
ws.close();
quit();
console.log(output);
process.exit(0);
