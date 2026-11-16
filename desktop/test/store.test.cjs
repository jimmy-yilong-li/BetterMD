const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { NoteStore } = require('../store.cjs');
const { inside } = require('../paths.cjs');

function library(t, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bettermd-linux-store-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  const notices = [], store = new NoteStore(root, text => notices.push(text));
  return { root, store, notices, read: rel => fs.readFileSync(path.join(root, rel), 'utf8') };
}

test('读取现有 macOS 笔记库：标签、待办、置顶、废纸篓和空文件夹', t => {
  const { store } = library(t, {
    '工作/甲.md': '# 甲\n\n#会议/周会\n- [ ] 待办',
    '附件/非笔记.md': '附件', '废纸篓/乙.md': '# 乙', '.隐藏.md': '隐藏',
    '.bettermd/state.json': JSON.stringify({ pinned: ['工作/甲.md'], trashOrigins: { '废纸篓/乙.md': '工作' }, welcomed: true }),
  });
  const snapshot = store.snapshot();
  assert.deepEqual(snapshot.folders, ['工作']);
  assert.equal(snapshot.notes.length, 2);
  assert.deepEqual(snapshot.notes.find(n => n.title === '甲').tags, ['会议/周会']);
  assert.equal(snapshot.notes.find(n => n.title === '甲').pinned, true);
  assert.equal(snapshot.notes.find(n => n.title === '甲').todo, true);
  assert.equal(snapshot.notes.find(n => n.trashed).dir, '工作');
  store.createFolder('工作', '空目录');
  assert.ok(store.snapshot().folders.includes('工作/空目录'));
});

test('保存前检测外部同长度修改：两份正文都保留，不靠 mtime 判断', t => {
  const { root, store, read, notices } = library(t, { '甲.md': '# 甲\n初始' });
  store.stage({ id: '甲.md', text: '# 甲\n本机', seq: 1 });
  fs.writeFileSync(path.join(root, '甲.md'), '# 甲\n外部');
  store.flush(); store.reload();
  assert.equal(read('甲.md'), '# 甲\n本机');
  assert.ok([...store.notes.values()].some(n => n.text === '# 甲\n外部'));
  assert.equal(notices.length, 1);
  store.flush(); assert.equal(notices.length, 1);
});

test('保留 CRLF、BOM、权限；原子替换中途出错不损坏原文，内存仍可恢复', t => {
  const { root, store, read } = library(t, { '甲.md': '\ufeff# 甲\r\n原文' });
  fs.chmodSync(path.join(root, '甲.md'), 0o640);
  store.stage({ id: '甲.md', text: '# 甲\n新正文', seq: 1 });
  const rename = fs.renameSync;
  fs.renameSync = () => { throw new Error('模拟写入失败'); };
  try { assert.throws(() => store.flush(), /模拟写入失败/); }
  finally { fs.renameSync = rename; }
  assert.equal(read('甲.md'), '\ufeff# 甲\r\n原文');
  assert.equal(store.get('甲.md').dirty, true);
  const recovered = store.recover(path.join(root, '恢复'));
  assert.equal(fs.readFileSync(recovered[0], 'utf8'), '# 甲\n新正文');
  store.flush();
  assert.equal(read('甲.md'), '\ufeff# 甲\r\n新正文');
  assert.equal(fs.statSync(path.join(root, '甲.md')).mode & 0o777, 0o640);
  assert.equal(fs.readdirSync(root).some(n => n.endsWith('.tmp')), false);
});

test('外部删掉正在编辑的文件：文字另存，不悄悄丢弃', t => {
  const { root, store, notices } = library(t, { '甲.md': '# 甲\n原文' });
  store.stage({ id: '甲.md', text: '# 甲\n没存的文字', seq: 1 });
  fs.unlinkSync(path.join(root, '甲.md')); store.reload(); store.flush(); store.reload();
  assert.ok([...store.notes.values()].some(n => n.text.includes('没存的文字')));
  assert.equal(fs.existsSync(path.join(root, '甲.md')), false);
  assert.ok(notices[0].includes('另存'));
});

test('移动、标题改名、进出废纸篓：附件链接、置顶和 VS Code 绑定路径都保持可用', t => {
  const { root, store, read } = library(t, {
    '工作/旧名.md': '# 旧名\n\n![](../附件/a.png)\n', '附件/a.png': 'png',
    '.bettermd/state.json': JSON.stringify({ pinned: ['工作/旧名.md'], welcomed: true }),
    '.bettermd/links.json': JSON.stringify({ links: [{ id: 'link1', note: '工作/旧名.md', file: '/tmp/CLAUDE.md' }] }),
  });
  store.createFolder('', '生活'); store.createFolder('生活', '子目录');
  store.stage({ id: '工作/旧名.md', text: '# 新标题\n\n![](../附件/a.png)\n', seq: 1 });
  let id = store.move('工作/旧名.md', '生活/子目录');
  assert.equal(id, '生活/子目录/新标题.md');
  assert.ok(read(id).includes('../../%E9%99%84%E4%BB%B6/a.png'));
  const movedText = read(id);
  id = store.trash(id);
  assert.equal(read(id), movedText); // macOS 的废纸篓仍按原文件夹解析图片。
  assert.equal(store.snapshot().notes.find(n => n.id === id).dir, '生活/子目录');
  assert.throws(() => store.stage({ id, text: '不能改', seq: 2 }), /只读/);
  id = store.restore(id);
  assert.equal(id, '生活/子目录/新标题.md');
  assert.equal(read(id), movedText);
  assert.equal(JSON.parse(read('.bettermd/links.json')).links[0].note, id);
  assert.deepEqual(JSON.parse(read('.bettermd/state.json')).pinned, [id]);
  assert.equal(JSON.parse(read('.bettermd/state.json')).welcomed, true);
  assert.equal(fs.existsSync(path.join(root, '工作/旧名.md')), false);
});

test('不改标题只查看，不会改名；改标题离开时改名，重名不覆盖', t => {
  const { store, read } = library(t, { 'a.md': '# 标题\n原文', '重名.md': '# 重名\n已有' });
  assert.equal(store.finalize('a.md'), 'a.md');
  store.stage({ id: 'a.md', text: '# 重名\n新文', seq: 1 });
  assert.equal(store.finalize('a.md'), '重名 2.md');
  assert.equal(read('重名.md'), '# 重名\n已有');
  assert.equal(read('重名 2.md'), '# 重名\n新文');
});

test('移动前读取磁盘的新版本；元数据损坏时不移动、不覆盖登记', t => {
  const { root, store, read } = library(t, { '甲.md': '# 甲\n旧文' });
  store.createFolder('', '工作');
  fs.writeFileSync(path.join(root, '甲.md'), '# 甲\n外部新文');
  const id = store.move('甲.md', '工作');
  assert.equal(read(id), '# 甲\n外部新文');
  fs.writeFileSync(path.join(root, '.bettermd/state.json'), '{broken');
  assert.throws(() => store.trash(id), /保留原文件/);
  assert.equal(read(id), '# 甲\n外部新文');
  assert.equal(read('.bettermd/state.json'), '{broken');
});

test('文件落盘成功但元数据更新失败：回滚移动，保留原文和登记', t => {
  const { root, store, read } = library(t, { '甲.md': '# 甲\n原文', '.bettermd/state.json': '{"pinned":["甲.md"]}',
    '.bettermd/links.json': JSON.stringify({ links: [{ id: 'l1', note: '甲.md', file: '/tmp/CLAUDE.md' }] }) });
  store.createFolder('', '工作');
  const original = store.writeJSON.bind(store);
  store.writeJSON = (name, data) => { if (name === 'links.json') throw new Error('模拟登记写入失败'); original(name, data); };
  assert.throws(() => store.move('甲.md', '工作'), /登记写入失败/);
  assert.equal(read('甲.md'), '# 甲\n原文');
  assert.equal(fs.readdirSync(path.join(root, '工作')).length, 0);
  assert.deepEqual(JSON.parse(read('.bettermd/state.json')).pinned, ['甲.md']);
});

test('路径穿越、库内符号链接、保留目录均被拒绝，库本身可以是符号链接', t => {
  const { root, store } = library(t, { '甲.md': '# 甲' });
  for (const p of ['../外面.md', '/tmp/外面.md', '.bettermd/state.json', 'a/../../外面']) assert.throws(() => inside(root, p), /笔记库/);
  fs.symlinkSync(os.tmpdir(), path.join(root, '外面'));
  assert.throws(() => inside(root, '外面/文件'), /符号链接/);
  assert.throws(() => store.createFolder('', '附件'), /文件夹/);
  const alias = root + '-alias'; fs.symlinkSync(root, alias);
  t.after(() => fs.unlinkSync(alias));
  assert.equal(new NoteStore(alias).root, root);
});

test('粘贴附件生成相对链接，长 emoji 标题不会超过文件系统限制', t => {
  const { root, store } = library(t, { '工作/甲.md': '# 甲' });
  const attached = store.attach('工作/甲.md', 'a(1).png', 'image/png', Buffer.from('png').toString('base64'));
  assert.ok(attached.link.startsWith('../%E9%99%84%E4%BB%B6/'));
  assert.equal(fs.readdirSync(path.join(root, '附件')).length, 1);
  store.stage({ id: '工作/甲.md', text: '# ' + '😀'.repeat(150) + '\n正文', seq: 1 });
  const renamed = store.finalize('工作/甲.md');
  assert.ok(Buffer.byteLength(path.basename(renamed)) <= 240);
  assert.ok(store.get(renamed).text.includes('正文'));
});

test('过时改动不会覆盖新改动；编辑器拒收的外部版本会另存', t => {
  const { store } = library(t, { '甲.md': '# 甲\n外部版本' });
  store.stage({ id: '甲.md', text: '# 甲\n新输入', seq: 2, overrode: true });
  store.stage({ id: '甲.md', text: '# 甲\n旧输入', seq: 1 });
  store.flush(); store.reload();
  assert.equal(store.get('甲.md').text, '# 甲\n新输入');
  assert.ok([...store.notes.values()].some(n => n.text.includes('外部版本')));
});

test('清单不带正文，摘要去掉 Markdown 符号，缩略图指到库里的图片；搜索不分大小写和全角半角', t => {
  const { store } = library(t, {
    '读书/激活函数.md': '# 激活函数\n#机器学习 #待复习\n\n神经元把**输入**加权求和。\n\n$$\n\\sigma(x)\n$$\n\n| 函数 | 值域 |\n|---|---|\n| ReLU | 非负 |\n\n- [ ] 对比 GELU\n\n![图](../附件/a.png)\n',
    '附件/a.png': 'png', '随手记.md': '# 随手记\n\nＢｅｔｔｅｒＭＤ 很好用',
  });
  const note = store.snapshot().notes.find(n => n.id === '读书/激活函数.md');
  assert.equal(note.text, undefined);
  assert.equal(note.preview, '神经元把输入加权求和。 函数 值域 ReLU 非负 ☐ 对比 GELU 图');
  assert.equal(note.thumb, '附件/a.png');
  assert.deepEqual(store.search('bettermd').map(h => h.id), ['随手记.md']);
  assert.deepEqual(store.search('RELU 激活'), [{ id: '读书/激活函数.md', title: true, snippet: '…ReLU 非负 ☐ 对比 GELU 图' }]);
  assert.deepEqual(store.search('激活函数'), [{ id: '读书/激活函数.md', title: true, snippet: null }]);
  assert.deepEqual(store.search('  '), []);
  assert.equal(store.read('随手记.md').text, '# 随手记\n\nＢｅｔｔｅｒＭＤ 很好用');
});

test('没变的文件不重读；别处改了、编辑器还没显示，这边打的字不会把那一版悄悄盖掉', t => {
  const { root, store, read, notices } = library(t, { '甲.md': '# 甲\n原文', '乙.md': '# 乙' });
  const same = store.notes.get('乙.md');
  const readFile = fs.readFileSync; let reads = 0;
  fs.readFileSync = (...args) => { if (String(args[0]).endsWith('.md')) reads++; return readFile(...args); };
  try { store.reload(); } finally { fs.readFileSync = readFile; }
  assert.equal(reads, 0);
  assert.equal(store.notes.get('乙.md'), same);

  // 别处（同步、别的程序）改了甲；清单里版本号变了，界面据此重新取正文
  const before = store.read('甲.md').rev;
  fs.writeFileSync(path.join(root, '甲.md'), '# 甲\n别处的新版本，比原文长');
  store.reload();
  const shown = store.read('甲.md');
  assert.equal(shown.text, '# 甲\n别处的新版本，比原文长');
  assert.equal(shown.rev, before + 1);
  // 编辑器还没来得及显示，用户基于旧内容打了字：保存时别处那一版另存，谁也不丢
  store.stage({ id: '甲.md', text: '# 甲\n原文，本机接着写', seq: 1 });
  store.flush();
  assert.equal(read('甲.md'), '# 甲\n原文，本机接着写');
  assert.equal(read('甲（别处的版本）.md'), '# 甲\n别处的新版本，比原文长');
  assert.equal(notices.length, 1);
  // 随后编辑器报告它拒收了那一版：已经保住过，不再另存一份
  store.stage({ id: '甲.md', text: '# 甲\n原文，本机接着写。', seq: 2, overrode: true });
  store.flush();
  assert.equal(fs.readdirSync(root).filter(n => n.includes('别处的版本')).length, 1);
});

test('别处改的那一版编辑器显示过了：接着打字就是正常保存，不另存', t => {
  const { root, store, read, notices } = library(t, { '甲.md': '# 甲\n原文' });
  fs.writeFileSync(path.join(root, '甲.md'), '# 甲\n别处的新版本');
  store.reload();
  const shown = store.read('甲.md');
  store.seen('甲.md', shown.rev);
  assert.deepEqual([shown.seq, shown.received], [0, 0]);
  store.stage({ id: '甲.md', text: shown.text + '，接着写', seq: 7 });
  // 编辑器的编号不分笔记：别的笔记（这次运行里没改过）也要报全局收到的最大编号，不然编辑器会把别处的新版本当成过时的
  fs.writeFileSync(path.join(root, '乙.md'), '# 乙');
  store.reload();
  assert.deepEqual([store.read('乙.md').seq, store.read('乙.md').received], [0, 7]);
  fs.rmSync(path.join(root, '乙.md'));
  store.flush();
  assert.equal(read('甲.md'), '# 甲\n别处的新版本，接着写');
  assert.deepEqual(notices, []);
  assert.deepEqual(fs.readdirSync(root).filter(n => n.endsWith('.md')), ['甲.md']);
  // 自己刚存的不算别处改的
  store.reload();
  assert.equal(store.read('甲.md').rev, shown.rev);
});

test('文件夹改名：里面的笔记、置顶、废纸篓来源和绑定都跟着走；重名和保留名不行', t => {
  const { root, store, read } = library(t, {
    '工作/甲.md': '# 甲', '工作/客户/乙.md': '# 乙\n\n![](../../附件/a.png)', '读书/丙.md': '# 丙', '废纸篓/丁.md': '# 丁',
    '.bettermd/state.json': JSON.stringify({ pinned: ['工作/客户/乙.md', '读书/丙.md'], trashOrigins: { '废纸篓/丁.md': '工作/客户' } }),
    '.bettermd/links.json': JSON.stringify({ links: [{ id: 'l1', note: '工作/甲.md', file: '/tmp/CLAUDE.md' }] }),
  });
  store.stage({ id: '工作/甲.md', text: '# 甲\n改了还没存', seq: 3 });
  assert.equal(store.renameFolder('工作', '事业'), '事业');
  assert.deepEqual(store.snapshot().folders, ['读书', '事业', '事业/客户'].sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true })));
  assert.equal(read('事业/甲.md'), '# 甲\n改了还没存');
  assert.equal(store.get('事业/甲.md').seq, 3);
  assert.equal(fs.existsSync(path.join(root, '工作')), false);
  const state = JSON.parse(read('.bettermd/state.json'));
  assert.deepEqual(state.pinned, ['事业/客户/乙.md', '读书/丙.md']);
  assert.deepEqual(state.trashOrigins, { '废纸篓/丁.md': '事业/客户' });
  assert.equal(JSON.parse(read('.bettermd/links.json')).links[0].note, '事业/甲.md');
  assert.equal(store.restore('废纸篓/丁.md'), '事业/客户/丁.md');
  assert.throws(() => store.renameFolder('事业', '读书'), /已经有/);
  assert.throws(() => store.renameFolder('事业', '附件'), /有效/);
  assert.throws(() => store.renameFolder('事业', 'a/b'), /有效/);
  assert.equal(store.renameFolder('事业/客户', '客户'), '事业/客户');
});

test('删文件夹：笔记进废纸篓能放回原处；还有别的文件时留着文件夹', t => {
  const { root, store } = library(t, { '工作/甲.md': '# 甲', '工作/客户/乙.md': '# 乙', '工作/客户/.gitkeep': '', '读书/丙.md': '# 丙', '读书/封面.pdf': 'pdf' });
  const first = store.deleteFolder('工作');
  assert.equal(first.removed, true);
  assert.deepEqual(first.trashed.sort(), ['废纸篓/乙.md', '废纸篓/甲.md']);
  assert.equal(fs.existsSync(path.join(root, '工作')), false);
  assert.deepEqual(store.snapshot().folders, ['读书']);
  assert.equal(store.restore('废纸篓/乙.md'), '工作/客户/乙.md');
  const second = store.deleteFolder('读书');
  assert.equal(second.removed, false);
  assert.ok(fs.existsSync(path.join(root, '读书/封面.pdf')));
});

test('清空废纸篓和永久删除：只动废纸篓里的，登记一起清掉', t => {
  const { root, store, read } = library(t, { '甲.md': '# 甲', '乙.md': '# 乙', '丙.md': '# 丙' });
  const a = store.trash('甲.md'), b = store.trash('乙.md');
  assert.throws(() => store.purge('丙.md'), /废纸篓/);
  assert.equal(store.purge(a), 1);
  assert.equal(fs.existsSync(path.join(root, a)), false);
  assert.deepEqual(Object.keys(JSON.parse(read('.bettermd/state.json')).trashOrigins), [b]);
  assert.equal(store.purge(), 1);
  assert.deepEqual(store.snapshot().notes.map(n => n.id), ['丙.md']);
  assert.deepEqual(JSON.parse(read('.bettermd/state.json')).trashOrigins, {});
  assert.equal(store.purge(), 0);
});
