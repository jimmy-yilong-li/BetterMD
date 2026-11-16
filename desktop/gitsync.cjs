// 用 git 同步笔记库（比如 GitHub 上的私有仓库）。笔记库就是一个普通的 git 仓库：
// 改完自动提交、推送，再把别的电脑推上去的改动合进来。不依赖 Electron，测试在 test/gitsync.test.cjs；
// 也能单独跑：node desktop/gitsync.cjs <笔记库> [仓库地址]
//
// 不丢东西的规则（和 design.md 第 3 节“数据可靠性”、第 6.14 节的合并规则一致）：
// - 合并之前本机的改动都已经提交，合不下去就 `git merge --abort`，工作区回到合并前的样子；
// - 两边改了同一篇的不同地方：都留，合成一份；
// - 两边把同一段改得不一样：这一段以后改的那边为准，输的那一边整篇另存成「标题（别处的版本）.md」；
// - 一边删了、另一边改了：留下改过的那份；
// - 从不 reset --hard、clean、强推。
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const IGNORE_MARK = '# BetterMD：写文件用的临时文件、系统文件不进同步';
const IGNORE_LINES = [IGNORE_MARK, '.bettermd-*.tmp', '.*.bettermd-*', '.DS_Store', '._*', '.~lock.*', '*.swp', '.Trash-*/'];
const KEEP = '.gitkeep';
const GITHUB_LIMIT = 95 * 1024 * 1024; // GitHub 拒收 100MB 以上的文件，推上去以后要改历史才能挽回
const LABEL = '别处的版本';

class SyncError extends Error {
  /** kind：'git'（没装 git）、'offline'、'auth'、'notfound'、'nested'、'url'、'busy'、'other' */
  constructor(kind, message, detail = '') { super(message); this.kind = kind; this.detail = detail; }
}

/** 只接受常见的仓库地址：git@主机:路径、ssh://、https://、file://，或者本机的绝对路径（U 盘、NAS 上的裸仓库）。 */
function validURL(url) {
  if (typeof url !== 'string') return false;
  const u = url.trim();
  if (!u || u.startsWith('-') || /[\s\0]/.test(u)) return false;
  return /^(https?|ssh|git|file):\/\/[^\s]+$/i.test(u) || /^[\w.-]+@[\w.-]+:[^\s]+$/.test(u) || path.isAbsolute(u);
}

function classify(stderr) {
  const s = String(stderr);
  if (/Could not resolve host|Could not resolve hostname|Network is unreachable|Connection timed out|Connection refused|Failed to connect|unable to access|Operation timed out|No route to host|Temporary failure in name resolution/i.test(s)) return 'offline';
  if (/Permission denied|Authentication failed|could not read Username|terminal prompts disabled|Host key verification failed|invalid credentials|access denied/i.test(s)) return 'auth';
  if (/Repository not found|does not appear to be a git repository|not found/i.test(s)) return 'notfound';
  return 'other';
}

const MESSAGES = {
  git: '这台电脑还没有安装 git（sudo apt install git）',
  offline: '连不上远端仓库，联网以后会自动再试',
  auth: '没有权限访问这个仓库：先在终端里确认 git 能访问它（SSH key，或 gh auth login）',
  notfound: '找不到这个仓库，检查一下地址',
  nested: '这个文件夹已经由外面的 git 仓库管着，不能再单独同步；换一个笔记库位置，或者直接用那个仓库',
  url: '仓库地址看起来不对，应该像 git@github.com:名字/仓库.git 或 https://github.com/名字/仓库.git',
};

/** 三方合并 JSON 对象的一层：一边没动就用另一边的，两边都动了用 `prefer` 那边。 */
function mergeKeys(base, ours, theirs, prefer) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const out = {};
  for (const key of new Set([...Object.keys(ours), ...Object.keys(theirs)])) {
    const b = base[key], o = ours[key], t = theirs[key];
    const value = same(o, t) ? o : same(o, b) ? t : same(t, b) ? o : prefer === 'theirs' ? t : o;
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** state.json 按内容合：置顶是集合（两边新加的都留，任何一边取消的都去掉），废纸篓来源按笔记逐条合。 */
function mergeState(baseText, oursText, theirsText, prefer) {
  const parse = text => { const v = JSON.parse(text); if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('不是对象'); return v; };
  let base = {};
  try { base = parse(baseText); } catch { /* 没有底本或底本坏了：当成空的 */ }
  const ours = parse(oursText), theirs = parse(theirsText);
  const list = v => (Array.isArray(v) ? v.filter(p => typeof p === 'string') : []);
  const bp = new Set(list(base.pinned)), op = list(ours.pinned), tp = list(theirs.pinned);
  const gone = new Set([...bp].filter(p => !op.includes(p) || !tp.includes(p)));
  const pinned = [...new Set([...op, ...tp])].filter(p => !gone.has(p));
  const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const merged = mergeKeys(base, ours, theirs, prefer);
  merged.pinned = pinned;
  merged.trashOrigins = mergeKeys(obj(base.trashOrigins), obj(ours.trashOrigins), obj(theirs.trashOrigins), prefer);
  return JSON.stringify(merged, null, 2) + '\n';
}

class GitSync {
  constructor(root, { git = 'git', host = os.hostname(), now = () => new Date() } = {}) {
    this.root = fs.realpathSync(root);
    this.bin = git;
    this.host = host;
    this.now = now;
    this.running = null;
  }

  /** 跑一条 git。`ok` 里列出可以接受的退出码；别的退出码抛 SyncError。输出按字节返回，路径不转义。 */
  run(args, { ok = [0], timeout = 60000, signal, text = true } = {}) {
    const full = ['-C', this.root, '-c', 'core.quotepath=false', '-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false',
      '-c', 'commit.gpgsign=false', '-c', 'protocol.ext.allow=never', '-c', 'merge.renames=true', '-c', 'advice.detachedHead=false', ...args];
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', LANGUAGE: 'C', GIT_MERGE_AUTOEDIT: 'no' };
    // 后台同步不能停在“输入密码”上；用户自己配了 ssh 命令就不动
    if (!env.GIT_SSH_COMMAND) env.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes';
    return new Promise((resolve, reject) => {
      execFile(this.bin, full, { env, timeout, signal, maxBuffer: 256 * 1024 * 1024, encoding: 'buffer' }, (error, stdout, stderr) => {
        const err = stderr.toString('utf8');
        if (error && error.code === 'ENOENT') return reject(new SyncError('git', MESSAGES.git));
        if (error && (error.killed || error.name === 'AbortError')) return reject(new SyncError('offline', '同步超时，稍后会再试', err));
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
        if (!ok.includes(code)) {
          const kind = classify(err);
          return reject(new SyncError(kind, MESSAGES[kind] ?? (err.trim().split('\n').slice(-3).join(' ') || `git ${args[0]} 失败`), err));
        }
        resolve({ code, out: text ? stdout.toString('utf8') : stdout, err });
      });
    });
  }

  async value(args) { return (await this.run(args, { ok: [0, 1, 128] })).out.trim(); }

  /** 现在是什么情况：装没装 git、是不是仓库、远端地址、当前分支。 */
  async state() {
    try { await this.run(['--version']); } catch (error) { if (error.kind === 'git') return { available: false }; throw error; }
    if (!fs.existsSync(path.join(this.root, '.git'))) {
      // 笔记库在别的仓库里面：那个仓库已经管着这里的文件，就不能再建一个；没管（忽略了、没加进去）就可以单独建
      const outer = (await this.run(['rev-parse', '--show-toplevel'], { ok: [0, 128] })).out.trim();
      const nested = !!outer && (await this.run(['ls-files', '-z', '--', '.'], { ok: [0, 128] })).out.length > 0;
      return { available: true, repo: false, nested, remote: null, branch: null };
    }
    return { available: true, repo: true, nested: false,
      remote: await this.value(['config', '--get', 'remote.origin.url']) || null,
      branch: await this.value(['symbolic-ref', '--short', '-q', 'HEAD']) || null };
  }

  /** 第一次开启：建仓库（已经是仓库就沿用）、写 .gitignore、记下远端，然后同步一次。 */
  async setup(url) {
    if (!validURL(url)) throw new SyncError('url', MESSAGES.url);
    url = url.trim();
    const state = await this.state();
    if (!state.available) throw new SyncError('git', MESSAGES.git);
    if (state.nested) throw new SyncError('nested', MESSAGES.nested);
    if (!state.repo) {
      // 老版本的 git 没有 -b：先建，再把 HEAD 指到 main
      await this.run(['init']);
      await this.run(['symbolic-ref', 'HEAD', 'refs/heads/main']);
    }
    if (state.remote) await this.run(['remote', 'set-url', 'origin', url]);
    else await this.run(['remote', 'add', 'origin', url]);
    return this.sync();
  }

  ensureIgnore() {
    const file = path.join(this.root, '.gitignore');
    const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (old.includes(IGNORE_MARK)) return;
    fs.writeFileSync(file, (old && !old.endsWith('\n') ? old + '\n' : old) + (old ? '\n' : '') + IGNORE_LINES.join('\n') + '\n');
  }

  /** git 不记空目录：空的文件夹里放一个 .gitkeep，别的电脑上才看得到这个文件夹。 */
  keepEmptyFolders() {
    const walk = dir => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      if (!entries.length && dir !== this.root) { fs.writeFileSync(path.join(dir, KEEP), ''); return; }
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.')) walk(path.join(dir, entry.name));
      }
    };
    walk(this.root);
  }

  /** 提交时用的身份：用户配过就用他的，没配过用 BetterMD（不然 git 拒绝提交）。 */
  async identity() {
    return await this.value(['config', 'user.email']) ? [] : ['-c', 'user.name=BetterMD', '-c', `user.email=bettermd@${this.host || 'localhost'}`];
  }

  /** 把工作区里的改动提交到本机。返回有没有新提交，以及因为太大没有提交的文件。 */
  async commit(remote = '') {
    this.ensureIgnore();
    this.keepEmptyFolders();
    const skipped = [];
    if (/github\.com/i.test(remote)) {
      const status = (await this.run(['status', '--porcelain', '-z', '--untracked-files=all'])).out.split('\0').filter(Boolean);
      for (let i = 0; i < status.length; i++) {
        const code = status[i].slice(0, 2), file = status[i].slice(3);
        if (code[0] === 'R' || code[0] === 'C') i++; // 改名的条目后面还跟着原来的名字
        const stat = fs.statSync(path.join(this.root, file), { throwIfNoEntry: false });
        if (stat?.isFile() && stat.size > GITHUB_LIMIT) skipped.push(file);
      }
    }
    await this.run(['add', '-A', '--', '.', ...skipped.map(f => `:(exclude,literal)${f}`)]);
    if ((await this.run(['diff', '--cached', '--quiet'], { ok: [0, 1] })).code === 0) return { committed: false, skipped };
    const names = (await this.run(['diff', '--cached', '--name-only', '-z'])).out.split('\0').filter(Boolean);
    // 提交说明里写改了哪几篇，翻历史时好认
    const shown = names.filter(n => /\.md$/i.test(n) && !path.basename(n).startsWith('.')).slice(0, 3).map(n => path.basename(n, path.extname(n)));
    const subject = `BetterMD · ${this.host}：${shown.join('、') || '附件和状态'}${names.length > shown.length ? ` 等 ${names.length} 个文件` : ''}`;
    await this.run([...await this.identity(), 'commit', '--no-verify', '-q', '-m', subject]);
    return { committed: true, skipped };
  }

  /** 同一时间只跑一次；正在同步时再叫，等的是同一次的结果。 */
  sync(options = {}) {
    if (!this.running) this.running = this.cycle(options).finally(() => { this.running = null; });
    return this.running;
  }

  async cycle({ signal } = {}) {
    const state = await this.state();
    if (!state.available) throw new SyncError('git', MESSAGES.git);
    if (state.nested) throw new SyncError('nested', MESSAGES.nested);
    if (!state.repo || !state.remote) throw new SyncError('other', '还没有设置同步的仓库');
    // 上次合并做到一半（断电、被杀掉）：放弃那次合并，工作区回到合并前
    if (fs.existsSync(path.join(this.root, '.git/MERGE_HEAD'))) await this.run(['merge', '--abort'], { ok: [0, 1, 128] });
    const result = { pulled: [], pushed: false, conflicts: [], skipped: [] };
    const branch = state.branch ?? 'main';
    const upstream = `refs/remotes/origin/${branch}`;
    for (let attempt = 0; ; attempt++) {
      const local = await this.commit(state.remote);
      result.skipped = local.skipped;
      await this.run(['fetch', '--quiet', 'origin'], { timeout: 300000, signal });
      const remoteHead = await this.value(['rev-parse', '--verify', '--quiet', upstream]);
      if (remoteHead) {
        const before = await this.value(['rev-parse', 'HEAD']);
        if ((await this.run(['merge-base', '--is-ancestor', upstream, 'HEAD'], { ok: [0, 1, 128] })).code !== 0) {
          result.conflicts.push(...await this.merge(upstream));
          const changed = (await this.run(['diff', '--name-only', '-z', before, 'HEAD'])).out.split('\0').filter(Boolean);
          result.pulled = [...new Set([...result.pulled, ...changed])];
        }
        if (await this.value(['rev-parse', 'HEAD']) === remoteHead) return result; // 远端已经是最新的
      }
      const push = await this.run(['push', '--quiet', '--no-verify', 'origin', `HEAD:refs/heads/${branch}`], { ok: [0, 1], timeout: 300000, signal });
      if (push.code === 0) {
        // 记下远端现在的位置，下次不联网也知道哪些已经推上去了
        await this.run(['update-ref', upstream, 'HEAD']);
        await this.run(['config', `branch.${branch}.remote`, 'origin']);
        await this.run(['config', `branch.${branch}.merge`, `refs/heads/${branch}`]);
        result.pushed = true;
        return result;
      }
      // 推的同时别的电脑也推了：再拉一次、合一次。别的原因（权限、文件太大）直接报出来
      if (!/rejected|fetch first|non-fast-forward/i.test(push.err) || attempt >= 3) {
        const kind = classify(push.err);
        throw new SyncError(kind, MESSAGES[kind] ?? `推送失败：${push.err.trim().split('\n').slice(-3).join(' ')}`, push.err);
      }
    }
  }

  /** 把远端的改动合进来；有冲突按规则解决。返回另存了哪些「别处的版本」。 */
  async merge(upstream) {
    const args = [...await this.identity(), 'merge', '--no-edit', '--no-verify', '--allow-unrelated-histories', '-q',
      '-m', `BetterMD · ${this.host}：合并别的电脑上的改动`, upstream];
    const merged = await this.run(args, { ok: [0, 1, 2, 128] });
    if (merged.code === 0) return [];
    const unmerged = (await this.run(['ls-files', '-u', '-z'])).out.split('\0').filter(Boolean);
    if (!unmerged.length) {
      // 不是内容冲突（比如本机刚好有个没提交的文件会被盖掉）：放弃这次合并，下一轮再来
      await this.run(['merge', '--abort'], { ok: [0, 1, 128] });
      throw new SyncError('other', `这次没合进去，稍后再试：${merged.err.trim().split('\n').slice(-2).join(' ') || '合并失败'}`, merged.err);
    }
    try {
      const conflicts = await this.resolve(unmerged, upstream);
      await this.run([...await this.identity(), 'commit', '--no-verify', '--no-edit', '-q']);
      return conflicts;
    } catch (error) {
      await this.run(['merge', '--abort'], { ok: [0, 1, 128] });
      throw error;
    }
  }

  async resolve(unmerged, upstream) {
    const paths = new Map(); // 路径 → { 1: 底本, 2: 本机, 3: 远端 } 的对象编号
    for (const entry of unmerged) {
      const tab = entry.indexOf('\t');
      const [, sha, stage] = entry.slice(0, tab).split(' ');
      const file = entry.slice(tab + 1);
      if (!paths.has(file)) paths.set(file, {});
      paths.get(file)[stage] = sha;
    }
    const blob = async sha => (sha ? (await this.run(['cat-file', 'blob', sha], { text: false })).out : null);
    const time = async (rev, file) => Number(await this.value(['log', '-1', '--format=%ct', rev, '--', file]) || await this.value(['log', '-1', '--format=%ct', rev])) || 0;
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bettermd-merge-'));
    const conflicts = [];
    try {
      for (const [file, stages] of paths) {
        const target = path.join(this.root, file);
        const [base, ours, theirs] = [await blob(stages[1]), await blob(stages[2]), await blob(stages[3])];
        if (!ours && !theirs) { await this.run(['rm', '-q', '--cached', '--ignore-unmatch', '--', file]); continue; } // 两边都删了、挪走了
        if (!ours || !theirs) {
          // 一边删了，另一边改了：留下改过的那份
          if (!ours) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, theirs); }
          await this.run(['add', '--', file]);
          continue;
        }
        const prefer = await time(upstream, file) > await time('HEAD', file) ? 'theirs' : 'ours';
        const [winner, loser] = prefer === 'theirs' ? [theirs, ours] : [ours, theirs];
        let result = winner, copy = true;
        if (file.startsWith('.bettermd/')) {
          copy = false; // 置顶、登记这类内部文件不另存：旧的在 git 历史里
          // state.json 按内容合；读不出来就以后改的为准
          if (file === '.bettermd/state.json') {
            try { result = Buffer.from(mergeState(base?.toString('utf8') ?? '{}', ours.toString('utf8'), theirs.toString('utf8'), prefer)); } catch { /* 用 winner */ }
          }
        } else if (![ours, theirs, base ?? Buffer.alloc(0)].some(b => b.includes(0))) {
          if (path.basename(file).startsWith('.')) copy = false; // 隐藏文件不另存
          // 文本：两边没冲突的改动都留，冲突的那几段用以后改的那边
          const names = ['ours', 'base', 'theirs'].map(n => path.join(temp, n));
          fs.writeFileSync(names[0], ours); fs.writeFileSync(names[1], base ?? ''); fs.writeFileSync(names[2], theirs);
          // .gitignore 两边的行都要（各台电脑各自加的忽略规则）
          result = (await this.run(['merge-file', '-p', file === '.gitignore' ? '--union' : `--${prefer}`, ...names], { text: false })).out;
        }
        fs.writeFileSync(target, result);
        if (copy && !loser.equals(result)) {
          const saved = this.saveCopy(file, loser);
          conflicts.push({ file, copy: saved, kept: prefer === 'theirs' ? '别的电脑' : '这台电脑' });
          await this.run(['add', '--', saved]);
        }
        await this.run(['add', '--', file]);
      }
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
    return conflicts;
  }

  /** 输的那一版另存在同一个文件夹：「名字（别处的版本）.md」，重名加序号。 */
  saveCopy(file, data) {
    const dir = path.posix.dirname(file), ext = path.extname(file);
    let stem = path.basename(file, ext);
    for (let n = 1; ; n++) {
      const suffix = `（${LABEL}${n === 1 ? '' : ` ${n}`}）`;
      while (Buffer.byteLength(stem + suffix + ext) > 240) stem = Array.from(stem).slice(0, -1).join('');
      const rel = path.posix.join(dir === '.' ? '' : dir, stem + suffix + ext);
      try { fs.writeFileSync(path.join(this.root, rel), data, { flag: 'wx' }); return rel; }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
  }

  /** 本机有多少提交还没推上去（不联网，按上次同步时记下的远端位置算）。 */
  async ahead() {
    const state = await this.state();
    if (!state.repo) return 0;
    const upstream = `refs/remotes/origin/${state.branch ?? 'main'}`;
    if (!await this.value(['rev-parse', '--verify', '--quiet', upstream])) return Number(await this.value(['rev-list', '--count', 'HEAD'])) || 0;
    return Number(await this.value(['rev-list', '--count', `${upstream}..HEAD`])) || 0;
  }
}

module.exports = { GitSync, SyncError, validURL, mergeState, MESSAGES };

if (require.main === module) {
  const [root, url] = process.argv.slice(2);
  if (!root) { console.error('用法：node desktop/gitsync.cjs <笔记库> [仓库地址]'); process.exit(2); }
  const sync = new GitSync(root);
  (url ? sync.setup(url) : sync.sync()).then(result => {
    console.log(`同步好了：拉下 ${result.pulled.length} 个文件${result.pushed ? '，本机的改动已推送' : ''}`);
    for (const c of result.conflicts) console.log(`两边都改了「${c.file}」，以${c.kept}的为准，另一版另存为「${c.copy}」`);
    for (const f of result.skipped) console.log(`「${f}」超过 GitHub 的 100MB 限制，没有同步`);
  }).catch(error => { console.error(error.message); if (error.detail) console.error(error.detail.trim()); process.exit(1); });
}
