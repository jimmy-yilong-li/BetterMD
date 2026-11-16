// 隐藏的真实 Electron 窗口 + CDP + 临时笔记库。也可传入解包后的 bettermd 可执行文件验证安装产物。
// 同步用本机的裸仓库当远端：不联网，不碰真正的笔记库，也不读用户自己的 git 设置。
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bettermd-desktop-smoke-'));
  const root = path.join(temp, '笔记库'), profile = path.join(temp, 'config');
  fs.mkdirSync(path.join(root, '工作'), { recursive: true });
  fs.mkdirSync(path.join(root, '读书'), { recursive: true });
  fs.writeFileSync(path.join(root, '工作/试用.md'), '# 试用\n\n中文与 Ubuntu 的第一篇笔记。\n\n#想法/开发\n\n- [ ] 检查自动保存\n\n$$E = mc^2$$\n');
  fs.writeFileSync(path.join(root, '读书/第二篇.md'), '# 第二篇\n\n读书 ＢｅｔｔｅｒＭＤ');
  const port = await new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });
  const dev = require('../electron-dev.cjs').electronCommand(process.argv[2]);
  const args = process.argv[2] ? [] : [path.resolve(__dirname, '..')];
  args.push('--smoke-test', '--libraryPath', root, '--user-data-dir', profile, `--remote-debugging-port=${port}`);
  const gitEnv = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const child = spawn(dev.executable, args, { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, ...dev.env, ...gitEnv } });
  let logs = '', ws, ended = false, serial = 0;
  const requests = new Map(), errors = [];
  child.stderr.on('data', chunk => { logs += chunk; });
  child.on('exit', () => { ended = true; });
  const exited = new Promise(resolve => child.on('exit', (code, signal) => resolve({ code, signal })));
  const timer = setTimeout(() => { console.error('桌面测试超时\n' + logs); child.kill('SIGKILL'); process.exitCode = 1; }, 150000);
  try {
    let target;
    for (let i = 0; i < 120; i++) {
      if (ended) throw new Error('Electron 启动失败：\n' + logs + (/SUID sandbox/.test(logs) ? '\n沙箱没配好：见 docs/ubuntu.md「开发与 Chromium 沙箱」。' : ''));
      try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.url.startsWith('bettermd://app/')); } catch {}
      if (target) break; await delay(100);
    }
    assert.ok(target, '找到真实 Electron 页面');
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    ws.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.id) { requests.get(message.id)?.(message); requests.delete(message.id); }
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map(a => a.value ?? a.description).join(' '));
    };
    const send = (method, params = {}) => new Promise(resolve => { const id = ++serial; requests.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
    const run = async expression => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.error || result.result?.exceptionDetails) throw new Error(JSON.stringify(result));
      return result.result.result.value;
    };
    const until = async (expression, label) => {
      for (let i = 0; i < 100; i++) { if (await run(expression)) return; await delay(50); }
      throw new Error(label + '：等待超时');
    };
    const doc = 'window.bettermd.view.state.doc.toString()';
    const files = dir => fs.readdirSync(path.join(root, dir)).filter(n => !n.startsWith('.')).sort();
    const notices = () => run('[...document.querySelectorAll(".notice > span")].map(n => n.textContent)');
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 850, deviceScaleFactor: 1, mobile: false });
    await until('!!window.bettermd && document.querySelectorAll(".note-card").length === 2', '编辑器和列表启动');
    assert.equal(await run('typeof window.require'), 'undefined');
    await run('selectNote("工作/试用.md")');
    await until('!!document.querySelector(".katex")', '公式排版');
    assert.equal(await run('document.querySelector(".cm-meta")?.textContent.includes("字")'), true, '标题下面有修改时间、文件夹、字数');
    assert.deepEqual(await run('[...document.querySelectorAll("#navigation .nav-label")].map(n => n.textContent)'), ['我的笔记', '读书', '工作', '未分类', '待办', '想法', '开发']);
    assert.equal(await run('document.querySelector("#shell").scrollHeight <= innerHeight && document.querySelector(".side-bottom").getBoundingClientRect().bottom <= innerHeight'), true, '三栏不超出窗口');
    assert.equal(await run('model.notes.every(n => n.text === undefined)'), true, '清单不带正文');
    console.log('通过：三栏、文件夹、标签、待办、公式、隔离的网页环境');

    await run('(() => { const v = window.bettermd.view; v.focus(); v.dispatch({ selection: { anchor: v.state.doc.length } }); })()');
    await send('Input.insertText', { text: '\nUbuntu 自动保存验证' });
    await delay(900);
    assert.ok(fs.readFileSync(path.join(root, '工作/试用.md'), 'utf8').includes('Ubuntu 自动保存验证'));
    await until('document.querySelector(".note-card.selected .note-preview").textContent.includes("Ubuntu 自动保存验证")', '列表摘要跟着更新');
    assert.equal(await run('document.querySelector(".note-card.selected .note-preview").textContent.includes("#")'), false, '摘要里没有标签和 Markdown 符号');
    console.log('通过：真实输入和自动保存');

    // Ctrl+B 通过 Chromium 的真实按键事件进入共用 CodeMirror。
    await run('(() => { const v = window.bettermd.view, at = v.state.doc.toString().indexOf("中文"); v.dispatch({ selection: { anchor: at, head: at + 2 } }); v.focus(); })()');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66, modifiers: 2 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66, modifiers: 2 });
    assert.ok(await run(`${doc}.includes("**中文**")`));
    const beforeCopy = await run(doc);
    await run('window.bettermd.view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "c", code: "KeyC", keyCode: 67, ctrlKey: true, bubbles: true, cancelable: true }))');
    assert.equal(await run(doc), beforeCopy, 'Ctrl+C 保留给复制');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'C', code: 'KeyC', windowsVirtualKeyCode: 67, modifiers: 10 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'C', code: 'KeyC', windowsVirtualKeyCode: 67, modifiers: 10 });
    assert.ok(await run(`${doc}.includes("\`\`\`")`), 'Ctrl+Shift+C 插入代码块');
    await run('window.bettermd.format("codeBlock")');

    const png = fs.readFileSync(path.resolve(__dirname, '../icons/64x64.png')).toString('base64');
    await run(`(() => { const v = window.bettermd.view; v.dispatch({ selection: { anchor: v.state.doc.length } }); const dt = new DataTransfer(); dt.items.add(new File([Uint8Array.from(atob(${JSON.stringify(png)}), c => c.charCodeAt(0))], "test.png", { type: "image/png" })); v.contentDOM.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); window.bettermd.flush(); })()`);
    await until(`${doc}.includes("../%E9%99%84%E4%BB%B6/")`, '粘贴图片');
    assert.equal(files('附件').length, 1);
    await until('[...document.querySelectorAll(".cm-image img")].some(img => img.naturalWidth > 0)', '库内图片实际加载');
    await until('document.querySelector(".note-card.selected .note-thumb")?.naturalWidth > 0', '列表里的缩略图');
    console.log('通过：Linux Ctrl+B、粘贴附件、列表缩略图');

    await run('(() => { const input = document.querySelector("#search"); input.value = "bettermd"; input.dispatchEvent(new Event("input")); })()');
    await until('document.querySelectorAll(".note-card").length === 1 && document.querySelector(".note-title").textContent === "第二篇"', '中文和全角英文搜索');
    await run('(() => { const input = document.querySelector("#search"); input.value = "没有这几个字"; input.dispatchEvent(new Event("input")); })()');
    await until('document.querySelectorAll(".note-card").length === 0 && !!document.querySelector(".list-empty")', '搜不到时给出说明');
    await run('document.querySelector("#search").value = ""; searchChanged()');
    await until('document.querySelectorAll(".note-card").length === 2', '清空搜索');
    console.log('通过：中文和全角英文搜索');

    await run('moveNote("工作/试用.md", "读书")');
    assert.ok(fs.existsSync(path.join(root, '读书/试用.md')));
    await run('command("pin")');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, '.bettermd/state.json'), 'utf8')).pinned, ['读书/试用.md']);
    await until('!!document.querySelector(".note-card.selected .ribbon")', '置顶的书签丝带');
    await run('command("trash")');
    assert.ok(fs.existsSync(path.join(root, '废纸篓/试用.md')));
    await run('setScope("trash")');
    await until('window.bettermd.view.state.readOnly === true', '废纸篓里只读');
    await run('command("restore")');
    assert.ok(fs.existsSync(path.join(root, '读书/试用.md')));
    await until('window.bettermd.view.state.readOnly === false && scope.kind === "folder" && scope.id === "读书"', '放回原处');
    console.log('通过：移动、置顶、废纸篓只读与恢复');

    // 别的程序改了正在看的这篇：编辑器换成新内容；接着打字是在新内容上改，不会另存出「别处的版本」
    const external = '# 试用\n\n外部编辑器保存的新版本。\n\n#想法/开发\n\n$$E=mc^2$$';
    fs.writeFileSync(path.join(root, '读书/试用.md'), external);
    await until(`${doc}.includes("外部编辑器保存的新版本")`, '文件监听');
    await delay(100);
    await run('(() => { const v = window.bettermd.view; v.focus(); v.dispatch({ selection: { anchor: v.state.doc.length } }); })()');
    await send('Input.insertText', { text: '\n在新版本上接着写' });
    await delay(900);
    assert.equal(fs.readFileSync(path.join(root, '读书/试用.md'), 'utf8'), external + '\n在新版本上接着写');
    assert.deepEqual(files('读书'), ['第二篇.md', '试用.md'], '没有多出别处的版本');
    console.log('通过：外部修改后接着编辑');

    // 侧栏里就地新建、重命名文件夹；删文件夹时笔记进废纸篓，能撤销
    await run('command("folder", "")');
    await until('!!document.querySelector("#navigation .nav-input")', '就地起名');
    await send('Input.insertText', { text: '生活' });
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await until('scope.kind === "folder" && scope.id === "生活" && !document.querySelector("#navigation .nav-input")', '新建文件夹');
    assert.ok(fs.statSync(path.join(root, '生活')).isDirectory());
    await run('naming = { id: "读书" }; renderNavigation()');
    await until('document.activeElement?.classList.contains("nav-input")', '重命名输入框');
    await run('document.activeElement.select()');
    await send('Input.insertText', { text: '阅读' });
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await until('model.folders.includes("阅读") && !model.folders.includes("读书")', '重命名文件夹');
    assert.deepEqual(files('阅读'), ['第二篇.md', '试用.md']);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, '.bettermd/state.json'), 'utf8')).pinned, ['阅读/试用.md']);
    await run('command("deleteFolder", "阅读")');
    assert.equal(fs.existsSync(path.join(root, '阅读')), false);
    assert.deepEqual(files('废纸篓'), ['第二篇.md', '试用.md']);
    await run('[...document.querySelectorAll(".notice .undo")].at(-1).click()');
    await until('model.notes.filter(n => n.id.startsWith("阅读/")).length === 2', '撤销删除文件夹');
    assert.deepEqual(files('阅读'), ['第二篇.md', '试用.md']);
    console.log('通过：文件夹就地新建、重命名、删除和撤销');

    // 同步：本机的裸仓库当 GitHub。开启后推上去；“另一台电脑”推了新笔记，立即同步就出现在列表里
    let synced = false;
    try { execFileSync('git', ['--version'], { stdio: 'ignore' }); synced = true; } catch { console.log('跳过：这台电脑没有 git，同步没测'); }
    const remote = path.join(temp, 'remote.git'), other = path.join(temp, '另一台');
    if (synced) {
      const git = (...a) => execFileSync('git', ['-c', 'core.quotepath=false', ...a], { env: { ...process.env, ...gitEnv }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      git('init', '--bare', '-q', '--initial-branch=main', remote);
      assert.equal(await run('document.querySelector("#sync-label").textContent'), '开启同步…');
      await run(`rpc("syncSetup", { url: ${JSON.stringify(remote)} })`);
      await until('document.querySelector("#sync-label").textContent.startsWith("已同步")', '开启同步');
      assert.ok(git('--git-dir', remote, 'ls-tree', '-r', '--name-only', 'main').includes('试用.md'));
      git('clone', '-q', remote, other);
      fs.writeFileSync(path.join(other, '另一台写的.md'), '# 另一台写的\n\n从别的电脑同步过来。\n');
      git('-C', other, 'add', '-A');
      git('-C', other, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', '别的电脑');
      git('-C', other, 'push', '-q', 'origin', 'HEAD:main');
      await run('rpc("syncNow")');
      await until('model.notes.some(n => n.title === "另一台写的")', '别的电脑上的笔记同步过来');
      assert.deepEqual(await notices().then(list => list.filter(t => t.includes('同步'))), []);
      // 别的电脑改了正开着的这篇：同步以后编辑器里就是新内容，接着打字不会另存出「别处的版本」
      await run('setScope("all").then(() => selectNote("阅读/第二篇.md"))');
      git('-C', other, 'pull', '-q', '--ff-only', 'origin', 'main');
      fs.appendFileSync(path.join(other, '阅读/第二篇.md'), '\n\n别的电脑加的一段。\n');
      git('-C', other, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-am', '别的电脑改了第二篇');
      git('-C', other, 'push', '-q', 'origin', 'HEAD:main');
      await run('rpc("syncNow")');
      await until(`${doc}.includes("别的电脑加的一段")`, '同步改到正开着的笔记');
      await delay(100);
      await run('(() => { const v = window.bettermd.view; v.focus(); v.dispatch({ selection: { anchor: v.state.doc.length } }); })()');
      await send('Input.insertText', { text: '这台电脑接着写。' });
      await delay(900);
      assert.ok(fs.readFileSync(path.join(root, '阅读/第二篇.md'), 'utf8').endsWith('别的电脑加的一段。\n这台电脑接着写。'));
      assert.deepEqual(files('阅读'), ['第二篇.md', '试用.md']);
      console.log('通过：git 同步（推送、拉取、改到正开着的笔记）');
    }

    // 外壳的快捷键：菜单栏收着也要好用（真实按键事件）
    const press = async (key, code, vk, modifiers) => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, modifiers });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers });
    };
    await run('setScope("folder", "生活").then(() => document.querySelector("#note-list").focus())');
    await press('n', 'KeyN', 78, 2);
    await until('selected === "生活/新笔记.md" && window.bettermd.view.state.sliceDoc(window.bettermd.view.state.selection.main.from, window.bettermd.view.state.selection.main.to) === "新笔记"', 'Ctrl+N 新建并选中标题');
    await send('Input.insertText', { text: '买菜' });
    await press('F', 'KeyF', 70, 10);
    await until('document.activeElement.id === "search"', 'Ctrl+Shift+F 到搜索框');
    await press('Escape', 'Escape', 27, 0);
    await press('0', 'Digit0', 48, 3);
    await until('scope.kind === "trash"', 'Ctrl+Alt+0 到废纸篓');
    await until('model.notes.some(n => n.id === "生活/买菜.md")', '离开笔记时文件名跟着标题改');
    assert.ok(fs.existsSync(path.join(root, '生活/买菜.md')));
    await run('setScope("all").then(() => selectNote("阅读/试用.md"))');
    await press('D', 'KeyD', 68, 10);
    await until('document.body.classList.contains("focus-mode")', 'Ctrl+Shift+D 专注模式');
    await run('window.bettermd.focus()');
    await press('Escape', 'Escape', 27, 0);
    await until('!document.body.classList.contains("focus-mode")', 'Esc 退出专注');
    await run('command("theme:dark")');
    await until('document.documentElement.classList.contains("theme-dark")', '深色主题');
    await run('command("theme:light")');
    await until('!document.documentElement.classList.contains("theme-dark")', '浅色主题');

    fs.mkdirSync(path.resolve(__dirname, '../../build/ubuntu'), { recursive: true });
    // 存好以后工具栏上的“正在保存…”收起来；截图前把早先的提示条关掉
    await until('!document.querySelector("#save-state").classList.contains("show") && !document.querySelector("#save-state").classList.contains("failed")', '保存状态收起');
    await run('for (const b of document.querySelectorAll(".notice .dismiss")) b.click()');
    await delay(500);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.resolve(__dirname, '../../build/ubuntu/smoke-light.png'), Buffer.from(shot.result.data, 'base64'));
    console.log('通过：键盘快捷键、专注模式、深浅主题与窗口截图');
    assert.deepEqual(errors, [], '页面无运行时错误');
    assert.deepEqual((await notices()).filter(t => /失败|出错|没存下|别处的版本/.test(t)), [], '没有出错的提示');

    // 关闭流程必须把尚未触发自动保存的最后一笔输入写入磁盘；开着同步时，退出前推上去。
    await run('(() => { const v = window.bettermd.view; v.dispatch({ changes: { from: v.state.doc.length, insert: "\\n退出前最后一笔" } }); })()');
    run('command("close")').catch(() => {});
    const exit = await Promise.race([exited, delay(20000).then(() => { throw new Error('关闭流程未完成'); })]);
    assert.equal(exit.code, 0);
    assert.ok(fs.readFileSync(path.join(root, '阅读/试用.md'), 'utf8').includes('退出前最后一笔'));
    if (synced) {
      const pushed = execFileSync('git', ['--git-dir', remote, 'show', 'main:阅读/试用.md'], { env: { ...process.env, ...gitEnv }, encoding: 'utf8' });
      assert.ok(pushed.includes('退出前最后一笔'), '退出前推送');
    }
    console.log('通过：退出前保存最后一笔输入' + (synced ? '并推送' : ''));
  } finally {
    clearTimeout(timer);
    ws?.close();
    if (!ended) { child.kill('SIGKILL'); await exited; }
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
