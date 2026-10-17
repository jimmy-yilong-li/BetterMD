// 插件和编辑器之间的同步：真的编辑器网页（editor/dist）跑在无头 Chrome 里，真的插件代码（extension.js 的 Session）
// 跑在这里，中间的 VS Code 换成一个假的（文本文档、applyEdit、webview 的消息）。不开 VS Code，不弹窗口。
// 用法：node vscode/test/sync.mjs（先 npm --prefix editor run build）
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const here = dirname(fileURLToPath(import.meta.url));
const page = resolve(here, '../../editor/dist/index.html');
const require = createRequire(import.meta.url);

// ---- 假的 VS Code ----
const listeners = new Set();
const documents = new Map();
class Uri {
  constructor(fsPath, scheme = 'file') { this.fsPath = fsPath; this.scheme = scheme; }
  static file(p) { return new Uri(p); }
  static parse(s) { const m = /^([a-z][a-z0-9+.-]*):/i.exec(s); return new Uri(s, m ? m[1].toLowerCase() : 'file'); }
  static joinPath(u, ...parts) { return new Uri(join(u.fsPath, ...parts)); }
  toString() { return this.scheme === 'file' ? pathToFileURL(this.fsPath).href : this.fsPath; }
}
class Range { constructor(l1, c1, l2, c2) { this.start = { line: l1, character: c1 }; this.end = { line: l2, character: c2 }; } }
class WorkspaceEdit { constructor() { this.edits = []; } replace(uri, range, text) { this.edits.push({ uri, range, text }); } }
const opened = [];
const fakeVscode = {
  Uri, Range, WorkspaceEdit,
  workspace: {
    workspaceFolders: [],
    getConfiguration: () => ({ get: (_k, fallback) => fallback }),
    onDidChangeTextDocument: listener => { listeners.add(listener); return { dispose: () => listeners.delete(listener) }; },
    applyEdit: async edit => {
      await delay(applyDelay); // 真的 VS Code 里写进文档也要一点时间：故意慢一点，看连着打字时会不会丢字
      for (const { uri, range, text } of edit.edits) documents.get(uri.fsPath).replace(range, text);
      return true;
    },
  },
  window: { showErrorMessage: m => errors.push(m), showOpenDialog: async () => [] },
  env: { openExternal: u => opened.push(u.toString()) },
  commands: { executeCommand: (...args) => opened.push(args.join(' ')) },
};
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, ...rest) { return request === 'vscode' ? fakeVscode : originalLoad.call(this, request, ...rest); };
const { Session } = require('../extension.js');

let applyDelay = 5;
const errors = [];

/** 假的文本文档：可以用 \r\n 换行（和 VS Code 一样，插进来的 \n 会换成文档自己的换行）。 */
class FakeDocument {
  constructor(file, text) { this.uri = Uri.file(file); this.text = text; this.isDirty = false; this.isClosed = false; this.saves = 0; }
  get eol() { return this.text.includes('\r\n') ? '\r\n' : '\n'; }
  getText() { return this.text; }
  offsetAt({ line, character }) {
    let offset = 0;
    for (let l = 0; l < line; l++) offset = this.text.indexOf('\n', offset) + 1;
    return offset + character;
  }
  replace(range, text) {
    const from = this.offsetAt(range.start), to = this.offsetAt(range.end);
    const insert = this.eol === '\r\n' ? text.replace(/\r?\n/g, '\r\n') : text;
    this.text = this.text.slice(0, from) + insert + this.text.slice(to);
    this.isDirty = true;
    for (const l of listeners) l({ document: this, contentChanges: [{}] });
  }
  /** 文件在外面被改了（比如 BetterMD App 存了一下），VS Code 重新读进来 */
  externalChange(text) {
    this.text = text;
    for (const l of listeners) l({ document: this, contentChanges: [{}] });
  }
  async save() { this.saves++; this.isDirty = false; return true; }
}

// ---- 无头 Chrome ----
const port = 9400 + Math.floor(Math.random() * 500);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'bettermd-vsc-'))}`,
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--allow-file-access-from-files', 'about:blank',
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
const loaded = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails.exception?.description);
  if (m.method === 'Page.loadEventFired') loaded.forEach(f => f());
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
// 编辑器网页以为自己在 VS Code 里：acquireVsCodeApi 发出的消息先攒在 window.toHost 里
await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.toHost = []; window.acquireVsCodeApi = () => ({ postMessage: m => window.toHost.push(m) });' });

/** 开一个“标签页”：网页重新加载，接上一个新的 Session。 */
async function openTab(file, text) {
  for (const l of [...listeners]) listeners.delete(l);
  const doc = new FakeDocument(file, text);
  documents.set(file, doc);
  const panel = {
    active: true,
    onDidChangeViewState() {}, onDidDispose() {},
    webview: {
      options: null, html: '', cspSource: 'file:',
      asWebviewUri: uri => ({ toString: () => pathToFileURL(uri.fsPath).href }),
      onDidReceiveMessage: handler => { panel.handler = handler; return { dispose() {} }; },
      postMessage: message => run(`window.dispatchEvent(new MessageEvent('message', { data: ${JSON.stringify(message)} }))`),
    },
  };
  const ready = new Promise(ok => loaded.push(ok));
  await send('Page.navigate', { url: pathToFileURL(page).href });
  await ready;
  const session = new Session({ extensionUri: Uri.file(resolve(here, '..')) }, doc, panel);
  return { doc, panel, session };
}

// 把网页发来的消息转给 Session（像 VS Code 那样一条条送）
let tab;
const pump = async () => {
  while (tab) {
    const messages = await run('window.toHost.splice(0)').catch(() => []);
    for (const m of messages ?? []) await tab.panel.handler?.(m);
    await delay(15);
  }
};

const editorText = () => run('window.bettermd.view.state.doc.toString()');
const type = async text => { for (const ch of text) { await send('Input.insertText', { text: ch }); await delay(8); } };
const settle = async () => { await delay(400); };
const atEnd = () => run('(() => { const v = window.bettermd.view; v.focus(); v.dispatch({ selection: { anchor: v.state.doc.length } }); })()');

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✔' : '✘'} ${name}${ok ? '' : '：' + detail}`);
  if (!ok) failures++;
};

// 1. 打开：正文进了编辑器；笔记库里的笔记，位置是文件夹
const library = mkdtempSync(join(tmpdir(), 'bettermd-lib-'));
mkdirSync(join(library, '.bettermd'));
mkdirSync(join(library, '工作'));
tab = await openTab(join(library, '工作', '甲.md'), '# 甲\n\n第一段');
pump();
await settle();
check('打开时正文放进编辑器', (await editorText()) === '# 甲\n\n第一段', JSON.stringify(await editorText()));
check('标题下面写着所在文件夹', (await run('document.querySelector(".cm-meta")?.textContent ?? ""')).includes('工作'));

// 2. 打字：写进文档，停一会儿自动保存
await atEnd();
await type('，接着写');
await settle();
check('编辑器里打的字写进了文档', tab.doc.getText() === '# 甲\n\n第一段，接着写', JSON.stringify(tab.doc.getText()));
await delay(700);
check('停一会儿自动保存', tab.doc.saves >= 1 && !tab.doc.isDirty);

// 3. 写进文档很慢时连着打字：一个字都不丢，最后两边一样
applyDelay = 60;
await type('快快快快快快快快');
await delay(1200);
check('写得慢时连着打字不丢字', tab.doc.getText().endsWith('快快快快快快快快') && tab.doc.getText() === await editorText(),
  JSON.stringify([tab.doc.getText(), await editorText()]));
applyDelay = 5;

// 3b. 正在写进文档时，文件在外面也改了：以编辑器为准（刚打的字不丢），最后两边一样
applyDelay = 80;
await type('还在打');
tab.doc.externalChange(tab.doc.getText() + '（外面同时加的）');
await type('字');
await delay(1500);
check('写进文档的同时外面也改了：两边最后一样，刚打的字还在', tab.doc.getText() === await editorText() && (await editorText()).includes('还在打字'),
  JSON.stringify([tab.doc.getText(), await editorText()]));
applyDelay = 5;

// 4. 文件在外面改了：编辑器跟着变
tab.doc.externalChange('# 甲\n\nApp 那边改过了');
await settle();
check('文件在外面改了，编辑器跟着变', (await editorText()) === '# 甲\n\nApp 那边改过了', JSON.stringify(await editorText()));
const savesBefore = tab.doc.saves;
await delay(700);
check('外面来的改动不会再写回去', tab.doc.saves === savesBefore && tab.doc.getText() === '# 甲\n\nApp 那边改过了');

// 5. 粘贴图片：存进「附件」，插入从这篇的文件夹指过去的链接
await atEnd();
await run(`(async () => {
  const blob = await (await fetch('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==')).blob();
  const dt = new DataTransfer(); dt.items.add(new File([blob], 'image.png', { type: 'image/png' }));
  window.bettermd.view.contentDOM.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
})()`);
await delay(800);
const attachments = existsSync(join(library, '附件')) ? readdirSync(join(library, '附件')) : [];
check('粘贴的图片存进了「附件」', attachments.length === 1 && /^\d{8}-\d{6}\.png$/.test(attachments[0]), JSON.stringify(attachments));
check('正文里插入了 ../附件/… 的链接', (await editorText()).includes(`![](../附件/${attachments[0]})`) && tab.doc.getText().includes('../附件/'),
  JSON.stringify(await editorText()));

// 6. Windows 换行的文件：编辑器里是 \n，写回去还是 \r\n，内容对
tab = null;
await delay(50);
const project = mkdtempSync(join(tmpdir(), 'bettermd-proj-'));
tab = await openTab(join(project, 'README.md'), '# 说明\r\n\r\n第一行\r\n第二行');
pump();
await settle();
check('\\r\\n 的文件在编辑器里是正常的几行', (await editorText()) === '# 说明\n\n第一行\n第二行', JSON.stringify(await editorText()));
await atEnd();
await type('，加了字');
await settle();
check('写回去时保留 \\r\\n，内容也对', tab.doc.getText() === '# 说明\r\n\r\n第一行\r\n第二行，加了字', JSON.stringify(tab.doc.getText()));

// 7. 不在笔记库里的 .md：粘贴的图片放进旁边的 assets/
await run(`(async () => {
  const blob = await (await fetch('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==')).blob();
  const dt = new DataTransfer(); dt.items.add(new File([blob], 'image.png', { type: 'image/png' }));
  window.bettermd.view.contentDOM.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
})()`);
await delay(800);
check('别处的 .md，图片存进旁边的 assets/', existsSync(join(project, 'assets')) && readdirSync(join(project, 'assets')).length === 1
  && (await editorText()).includes('](assets/'), JSON.stringify(await editorText()));

check('插件没有报错', errors.length === 0, errors.join(' | '));
check('页面没有报错', pageErrors.length === 0, pageErrors.join(' | '));
tab = null;
console.log(failures ? `\n${failures} 项没通过` : '\n全部通过');
quit(failures ? 1 : 0);
