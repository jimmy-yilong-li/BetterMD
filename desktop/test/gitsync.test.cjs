// git 同步：本机的裸仓库当远端，两个临时笔记库当两台电脑。不联网，不碰真正的笔记库和用户的 git 设置。
const base = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { GitSync, validURL, mergeState } = require('../gitsync.cjs');

// 不读用户自己的 git 设置（签名、钩子、默认分支），测试在哪台电脑上跑都一样
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';

// 没装 git 的电脑上跳过（同步本来也用不了）
let hasGit = true;
try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { hasGit = false; }
const test = (name, fn) => base(name, { skip: hasGit ? false : '没有安装 git' }, fn);

function world(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bettermd-gitsync-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const remote = path.join(temp, 'remote.git');
  execFileSync('git', ['init', '--bare', '-q', remote]);
  let clock = Date.parse('2026-11-14T08:00:00Z');
  const machine = name => {
    const root = path.join(temp, name);
    fs.mkdirSync(root);
    const sync = new GitSync(root, { host: name });
    const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
    const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
    const has = rel => fs.existsSync(path.join(root, rel));
    // 每次同步时间往后走一分钟：提交时间决定“以后改的那边”
    const run = async fn => {
      clock += 60000;
      const stamp = `${Math.floor(clock / 1000)} +0000`;
      process.env.GIT_AUTHOR_DATE = stamp; process.env.GIT_COMMITTER_DATE = stamp;
      return fn();
    };
    return { root, sync, write, read, has, go: () => run(() => sync.sync()), setup: () => run(() => sync.setup(remote)) };
  };
  return { temp, remote, a: machine('甲'), b: machine('乙') };
}

test('第一台推上去，第二台拉下来；之后一边改，另一边同步就有', async t => {
  const { a, b } = world(t);
  a.write('工作/计划.md', '# 计划\n\n第一版\n');
  a.write('附件/图.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]));
  a.write('.bettermd/state.json', '{\n  "pinned": ["工作/计划.md"]\n}\n');
  const first = await a.setup();
  assert.equal(first.pushed, true);
  const joined = await b.setup();
  assert.equal(b.read('工作/计划.md'), '# 计划\n\n第一版\n');
  assert.deepEqual(JSON.parse(b.read('.bettermd/state.json')).pinned, ['工作/计划.md']);
  assert.ok(joined.pulled.includes('工作/计划.md'));
  assert.ok(b.has('附件/图.png'));

  b.write('工作/计划.md', '# 计划\n\n第二版\n');
  b.write('读书/新的一篇.md', '# 新的一篇\n');
  assert.equal((await b.go()).pushed, true);
  const pulled = await a.go();
  assert.equal(a.read('工作/计划.md'), '# 计划\n\n第二版\n');
  assert.equal(a.read('读书/新的一篇.md'), '# 新的一篇\n');
  assert.deepEqual(pulled.pulled.sort(), ['工作/计划.md', '读书/新的一篇.md'].sort());
  assert.equal(pulled.pushed, false, '没有本机改动就不推');
  // 再同步一次什么都不做
  const idle = await a.go();
  assert.deepEqual([idle.pulled, idle.pushed, idle.conflicts], [[], false, []]);
  assert.equal(await a.sync.ahead(), 0);
});

test('两边改了不同的笔记、同一篇的不同地方：都留', async t => {
  const { a, b } = world(t);
  a.write('笔记.md', '# 笔记\n\n第一段\n\n第二段\n\n第三段\n');
  a.write('另一篇.md', '# 另一篇\n');
  await a.setup(); await b.setup();
  a.write('笔记.md', '# 笔记\n\n第一段（甲改了）\n\n第二段\n\n第三段\n');
  b.write('笔记.md', '# 笔记\n\n第一段\n\n第二段\n\n第三段（乙改了）\n');
  b.write('另一篇.md', '# 另一篇\n\n乙加的\n');
  await a.go();
  const merged = await b.go();
  assert.deepEqual(merged.conflicts, []);
  await a.go();
  const expected = '# 笔记\n\n第一段（甲改了）\n\n第二段\n\n第三段（乙改了）\n';
  assert.equal(a.read('笔记.md'), expected);
  assert.equal(b.read('笔记.md'), expected);
  assert.equal(a.read('另一篇.md'), '# 另一篇\n\n乙加的\n');
});

test('两边把同一段改得不一样：以后改的为准，另一版整篇另存，两台电脑最后一样', async t => {
  const { a, b } = world(t);
  a.write('工作/会议.md', '# 会议\n\n时间：周一\n\n地点：三楼\n');
  await a.setup(); await b.setup();
  a.write('工作/会议.md', '# 会议\n\n时间：周二\n\n地点：三楼\n');
  await a.go(); // 甲先改先推
  b.write('工作/会议.md', '# 会议\n\n时间：周三\n\n地点：三楼\n\n乙另外加的一段\n');
  const result = await b.go(); // 乙后改：乙的为准
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].file, '工作/会议.md');
  assert.equal(result.conflicts[0].copy, '工作/会议（别处的版本）.md');
  assert.equal(b.read('工作/会议.md'), '# 会议\n\n时间：周三\n\n地点：三楼\n\n乙另外加的一段\n');
  assert.equal(b.read('工作/会议（别处的版本）.md'), '# 会议\n\n时间：周二\n\n地点：三楼\n');
  await a.go();
  assert.equal(a.read('工作/会议.md'), b.read('工作/会议.md'));
  assert.equal(a.read('工作/会议（别处的版本）.md'), '# 会议\n\n时间：周二\n\n地点：三楼\n');
});

test('先改的那边后同步：还是以后改的为准，先改的那版另存', async t => {
  const { a, b } = world(t);
  a.write('笔记.md', '# 笔记\n\n原文\n');
  await a.setup(); await b.setup();
  // 乙先在本机改好并提交（没联网，没推）；甲后改、先推
  b.write('笔记.md', '# 笔记\n\n乙先改的\n');
  process.env.GIT_AUTHOR_DATE = process.env.GIT_COMMITTER_DATE = `${Math.floor(Date.parse('2026-11-14T08:02:30Z') / 1000)} +0000`;
  await b.sync.commit();
  a.write('笔记.md', '# 笔记\n\n甲后改的\n');
  await a.go();
  const result = await b.go();
  assert.equal(result.conflicts[0].kept, '别的电脑');
  assert.equal(b.read('笔记.md'), '# 笔记\n\n甲后改的\n');
  assert.equal(b.read('笔记（别处的版本）.md'), '# 笔记\n\n乙先改的\n');
});

test('一边删了、移走了，另一边改了：改过的内容不丢', async t => {
  const { a, b } = world(t);
  a.write('要删的.md', '# 要删的\n\n原文\n');
  a.write('要搬的.md', '# 要搬的\n\n' + '很长的一段正文。\n'.repeat(20));
  await a.setup(); await b.setup();
  fs.rmSync(path.join(a.root, '要删的.md'));
  fs.mkdirSync(path.join(a.root, '废纸篓'), { recursive: true });
  fs.renameSync(path.join(a.root, '要搬的.md'), path.join(a.root, '废纸篓/要搬的.md'));
  await a.go();
  b.write('要删的.md', '# 要删的\n\n乙改过，不能丢\n');
  b.write('要搬的.md', '# 要搬的\n\n' + '很长的一段正文。\n'.repeat(20) + '乙加了一句\n');
  await b.go(); await a.go();
  assert.equal(a.read('要删的.md'), '# 要删的\n\n乙改过，不能丢\n');
  // 移进废纸篓的那篇：乙加的那句跟着过去
  const everywhere = [a, b].map(m => ['要搬的.md', '废纸篓/要搬的.md'].filter(f => m.has(f)).map(f => m.read(f)).join(''));
  for (const text of everywhere) assert.ok(text.includes('乙加了一句'));
  assert.ok(a.has('废纸篓/要搬的.md') && b.has('废纸篓/要搬的.md'));
});

test('两台电脑各自有笔记，再连到同一个仓库：都留下，同名的另存', async t => {
  const { a, b } = world(t);
  a.write('甲的.md', '# 甲的\n');
  a.write('同名.md', '# 同名\n\n甲写的\n');
  b.write('乙的.md', '# 乙的\n');
  b.write('同名.md', '# 同名\n\n乙写的\n');
  await a.setup();
  const joined = await b.setup();
  await a.go();
  for (const m of [a, b]) {
    assert.ok(m.has('甲的.md') && m.has('乙的.md'));
    assert.deepEqual([m.read('同名.md'), m.read('同名（别处的版本）.md')].sort(), ['# 同名\n\n乙写的\n', '# 同名\n\n甲写的\n'].sort());
  }
  assert.equal(joined.conflicts.length, 1);
});

test('置顶和废纸篓来源按内容合，不留冲突标记', async t => {
  const { a, b } = world(t);
  for (const n of ['一', '二', '三']) a.write(`${n}.md`, `# ${n}\n`);
  a.write('.bettermd/state.json', JSON.stringify({ pinned: ['一.md'], trashOrigins: {} }, null, 2) + '\n');
  await a.setup(); await b.setup();
  a.write('.bettermd/state.json', JSON.stringify({ pinned: ['一.md', '二.md'], trashOrigins: { '废纸篓/甲删的.md': '工作' } }, null, 2) + '\n');
  b.write('.bettermd/state.json', JSON.stringify({ pinned: ['三.md'], trashOrigins: { '废纸篓/乙删的.md': '' } }, null, 2) + '\n');
  await a.go(); await b.go(); await a.go();
  for (const m of [a, b]) {
    const state = JSON.parse(m.read('.bettermd/state.json'));
    assert.deepEqual(state.pinned.sort(), ['三.md', '二.md'], '乙取消了「一」的置顶，两边新加的都留');
    assert.deepEqual(state.trashOrigins, { '废纸篓/甲删的.md': '工作', '废纸篓/乙删的.md': '' });
    assert.ok(!fs.readdirSync(path.join(m.root, '.bettermd')).some(n => n.includes('别处的版本')));
  }
  assert.equal(mergeState('{"pinned":["a"]}', '{"pinned":["a","b"]}', '{"pinned":[]}', 'ours'), '{\n  "pinned": [\n    "b"\n  ],\n  "trashOrigins": {}\n}\n');
});

test('空文件夹也同步；删掉的文件夹在另一台也消失', async t => {
  const { a, b } = world(t);
  a.write('随手记.md', '# 随手记\n');
  fs.mkdirSync(path.join(a.root, '读书/小说'), { recursive: true });
  await a.setup(); await b.setup();
  assert.ok(fs.statSync(path.join(b.root, '读书/小说')).isDirectory());
  fs.rmSync(path.join(a.root, '读书'), { recursive: true });
  await a.go(); await b.go();
  assert.equal(b.has('读书'), false);
});

test('连不上远端：改动留在本机，连上以后补推；同时推的那一边自动再合一次', async t => {
  const { a, b, remote, temp } = world(t);
  a.write('笔记.md', '# 笔记\n');
  await a.setup(); await b.setup();
  fs.renameSync(remote, path.join(temp, '断网'));
  a.write('离线写的.md', '# 离线写的\n');
  await assert.rejects(a.go());
  assert.equal(await a.sync.ahead(), 1, '已经提交到本机，等着推');
  fs.renameSync(path.join(temp, '断网'), remote);
  b.write('乙的.md', '# 乙的\n');
  await b.go();
  const result = await a.go();
  assert.equal(result.pushed, true);
  assert.ok(a.has('乙的.md'));
  await b.go();
  assert.ok(b.has('离线写的.md'));
});

test('原样保留字节：CRLF、中文文件名、图片；合并做到一半被打断，下次接着来', async t => {
  const { a, b } = world(t);
  a.write('换行.md', '# 换行\r\n\r\n第一行\r\n');
  a.write('附件/20261114-080000.png', Buffer.from([0x89, 0x50, 0, 255, 254]));
  await a.setup(); await b.setup();
  assert.equal(b.read('换行.md'), '# 换行\r\n\r\n第一行\r\n');
  assert.deepEqual([...fs.readFileSync(path.join(b.root, '附件/20261114-080000.png'))], [0x89, 0x50, 0, 255, 254]);
  // 假装上次合并被打断：留下 MERGE_HEAD
  a.write('换行.md', '# 换行\r\n\r\n甲改\r\n'); await a.go();
  b.write('换行.md', '# 换行\r\n\r\n乙改\r\n'); await b.sync.commit();
  execFileSync('git', ['-C', b.root, 'fetch', '-q', 'origin']);
  try { execFileSync('git', ['-C', b.root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'merge', '-q', 'origin/main'], { stdio: 'ignore' }); } catch { /* 冲突，停在合并中 */ }
  assert.ok(fs.existsSync(path.join(b.root, '.git/MERGE_HEAD')));
  const result = await b.go();
  assert.equal(result.conflicts.length, 1);
  assert.ok(!b.read('换行.md').includes('<<<<<<<'));
  assert.ok(!fs.existsSync(path.join(b.root, '.git/MERGE_HEAD')));
});

test('地址要像仓库地址；外面的仓库已经管着的文件夹不再单独同步；GitHub 上太大的文件不提交', async t => {
  assert.ok(validURL('git@github.com:someone/notes.git'));
  assert.ok(validURL('https://github.com/someone/notes.git'));
  assert.ok(validURL('/mnt/nas/notes.git'));
  for (const bad of ['', '--upload-pack=touch /tmp/x', 'ext::sh -c id', 'notes', 'git@github.com:a b']) assert.equal(validURL(bad), false, bad);

  const { temp, a } = world(t);
  await assert.rejects(a.sync.setup('ext::sh -c id'), /地址/);
  const outer = path.join(temp, '项目');
  fs.mkdirSync(path.join(outer, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(outer, 'docs/说明.md'), '# 说明\n');
  execFileSync('git', ['init', '-q', outer]);
  execFileSync('git', ['-C', outer, 'add', '-A']);
  await assert.rejects(new GitSync(path.join(outer, 'docs')).setup(path.join(temp, 'remote.git')), /外面的 git 仓库/);
  assert.equal(fs.existsSync(path.join(outer, 'docs/.git')), false);

  // 远端地址里有 github.com 时，95MB 以上的文件留在本机不提交（用稀疏文件，不真的占空间）
  a.write('笔记.md', '# 笔记\n');
  execFileSync('git', ['init', '-q', a.root]);
  const fd = fs.openSync(path.join(a.root, '大文件.bin'), 'w'); fs.ftruncateSync(fd, 96 * 1024 * 1024); fs.closeSync(fd);
  const local = await a.sync.commit('git@github.com:someone/notes.git');
  assert.deepEqual(local.skipped, ['大文件.bin']);
  assert.equal(execFileSync('git', ['-C', a.root, 'ls-files'], { encoding: 'utf8' }).includes('大文件'), false);
});
