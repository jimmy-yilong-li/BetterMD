// Ubuntu 的文件数据层。正文仍是普通 Markdown；state.json / links.json 与 macOS、VS Code 共用。
const fs = require('node:fs');
const path = require('node:path');
const { inside, atomic, unique } = require('./paths.cjs');
const { encode, folderOf, rebase, resolveLocal, fold, preview, snippet, firstImage } = require('./markdown.cjs');
const shared = fs.existsSync(path.join(__dirname, 'resources/shared/notes.js')) ? './resources/shared/' : '../vscode/';
const { noteTitle, noteTags, tagsInLine, hasOpenTodo, decode } = require(shared + 'notes.js');
const { attachmentName } = require(shared + 'lib.js');
const TRASH = '废纸篓';
const META = '.bettermd';
const KEEP = '.gitkeep'; // git 同步时放在空文件夹里的占位文件，不算文件夹的内容
const inTrash = id => id.startsWith(TRASH + '/');

class NoteStore {
  constructor(root, notify = () => {}) {
    fs.mkdirSync(root, { recursive: true });
    this.root = fs.realpathSync(root);
    this.notify = notify;
    this.notes = new Map();
    this.folders = [];
    this.received = 0; // 编辑器发来的改动里最大的编号（编号是整个编辑器共用的，不分哪篇）
    for (const name of [META, '附件', TRASH]) fs.mkdirSync(inside(this.root, name, { internal: true }), { recursive: true });
    this.reload();
  }

  json(name, fallback) {
    const file = inside(this.root, `${META}/${name}`, { internal: true });
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('需要 JSON 对象');
      if (name === 'state.json' && ((parsed.pinned !== undefined && (!Array.isArray(parsed.pinned) || parsed.pinned.some(p => typeof p !== 'string')))
          || (parsed.trashOrigins !== undefined && (!parsed.trashOrigins || typeof parsed.trashOrigins !== 'object' || Array.isArray(parsed.trashOrigins))))) throw new Error('笔记状态格式无效');
      if (name === 'links.json' && (!Array.isArray(parsed.links) || parsed.links.some(l => !l || typeof l.note !== 'string'))) throw new Error('绑定登记格式无效');
      return parsed;
    } catch (error) {
      if (error.code === 'ENOENT') return structuredClone(fallback);
      throw new Error(`${name} 读不出来，已保留原文件：${error.message}`);
    }
  }

  writeJSON(name, data) {
    atomic(inside(this.root, `${META}/${name}`, { internal: true }), JSON.stringify(data, null, 2) + '\n');
  }

  /** 内容没变就不写：不平白多出一个 links.json，同步时也不多一次提交。返回写没写。 */
  update(name, before, after) {
    if (JSON.stringify(before) === JSON.stringify(after)) return false;
    this.writeJSON(name, after);
    return true;
  }

  /**
   * 重新看一遍磁盘。文件的修改时间、大小、编号都没变的笔记直接沿用，不重读（几千篇时每几秒看一遍也不费事）；
   * 运行中正文被别处改了的，记成“编辑器还没见过的版本”（unseen），编辑器确认显示过以后才清掉，见 stage 和 save。
   */
  reload() {
    const next = new Map();
    const folders = [];
    const walk = (rel = '') => {
      const dir = inside(this.root, rel);
      // 顶层不可读要报错，不能把读取失败当空库。
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name === '附件' && !rel) continue;
        const id = path.posix.join(rel, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          if (id !== TRASH && !inTrash(id)) folders.push(id);
          walk(id);
        } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
          const old = this.notes.get(id);
          if (old?.dirty) { next.set(id, old); continue; }
          try {
            const file = path.join(dir, entry.name);
            const stat = fs.statSync(file);
            const stamp = `${stat.mtimeMs}:${stat.size}:${stat.ino}`;
            if (old && old.stamp === stamp) { next.set(id, old); continue; }
            const text = decode(fs.readFileSync(file));
            if (old && old.text === text) { old.stamp = stamp; old.modified = stat.mtimeMs; next.set(id, old); continue; }
            next.set(id, { id, text, base: text, modified: stat.mtimeMs, created: stat.birthtimeMs || stat.ctimeMs, stamp, seq: old?.seq ?? 0,
              renameNeeded: old?.renameNeeded ?? false, dirty: false, rev: (old?.rev ?? 0) + 1,
              // 运行中被别处改了：编辑器显示过这一版之前，不能让它的旧内容把这一版盖掉
              unseen: old ? text : undefined });
          } catch (error) {
            if (old) next.set(id, old);
            this.notify(`读不出「${id}」：${error.message}`);
          }
        }
      }
    };
    walk();
    // 外部删除时，内存里未保存的文字仍保留，保存时另存。
    for (const [id, note] of this.notes) if (note.dirty && !next.has(id)) next.set(id, note);
    this.notes = next;
    this.folders = folders.sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
  }

  /** 从正文算出来的东西（标题、标签、摘要、搜索用的文字），正文没变就不重算。 */
  derive(note) {
    if (note.derived?.text !== note.text) {
      const title = noteTitle(note.text) || '无标题';
      note.derived = { text: note.text, title, tags: noteTags(note.text), todo: hasOpenTodo(note.text),
        preview: preview(note.text, tagsInLine, 140), image: firstImage(note.text), foldedTitle: fold(title), folded: null };
    }
    return note.derived;
  }

  /** 给界面的清单：每篇只有标题、摘要这些，不带正文（正文用 read 单独取）。 */
  snapshot() {
    let state = {};
    try { state = this.json('state.json', {}); } catch (error) { this.notify(error.message); }
    const pinned = new Set(state.pinned ?? []);
    return { root: this.root, folders: this.folders, notes: [...this.notes.values()].map(n => {
      const d = this.derive(n), trashed = inTrash(n.id);
      const dir = trashed ? state.trashOrigins?.[n.id] ?? '' : folderOf(n.id);
      return { id: n.id, title: d.title, tags: d.tags, todo: d.todo, preview: d.preview, thumb: d.image ? resolveLocal(dir, d.image) : null,
        modified: n.modified, pinned: pinned.has(n.id), trashed, dir, seq: n.seq, dirty: n.dirty, rev: n.rev };
    }) };
  }

  /** 关键词搜索：空格分开的词都要命中（标题或正文），不分大小写、全角半角。返回命中的笔记和正文里命中的那一段。 */
  search(query) {
    const terms = fold(String(query ?? '')).split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const hits = [];
    for (const note of this.notes.values()) {
      const d = this.derive(note);
      d.folded ??= fold(note.text);
      if (!terms.every(t => d.folded.includes(t))) continue;
      hits.push({ id: note.id, title: terms.some(t => d.foldedTitle.includes(t)), snippet: snippet(note.text, terms) });
    }
    return hits;
  }

  get(id, writable = false) {
    const note = this.notes.get(id);
    if (!note) throw new Error('这篇笔记已经不在了，请刷新笔记库');
    inside(this.root, id);
    if (writable && inTrash(id)) throw new Error('废纸篓里的笔记只读，请先放回原处');
    return note;
  }

  /**
   * 编辑器要显示这篇：给它正文和这一版的编号（显示出来以后用 seen 确认）。
   * 编辑器拿“我们收到的最大改动编号”判断送去的正文是不是过时了。它的编号不分笔记、一直往上数，所以要给全局最大的（received）：
   * 只给这一篇的（seq），没在这次运行里改过的笔记永远是 0，别处一改，编辑器就当成过时的、拿自己的旧内容盖回来。
   */
  read(id) {
    const note = this.get(id);
    const stat = fs.statSync(inside(this.root, id), { throwIfNoEntry: false });
    return { id, text: note.text, seq: note.seq, received: this.received, rev: note.rev, modified: note.modified, created: note.created ?? stat?.birthtimeMs ?? note.modified };
  }

  /** 编辑器已经把这一版显示出来了：之后它发来的改动都是在这一版上改的。 */
  seen(id, rev) {
    const note = this.notes.get(id);
    if (note && note.rev === rev) note.unseen = undefined;
  }

  stage({ id, text, seq, overrode }) {
    const note = this.get(id, true);
    if (typeof text !== 'string' || !Number.isSafeInteger(seq)) return;
    this.received = Math.max(this.received, seq);
    if (seq <= note.seq) return;
    // 编辑器拒收了我们送去的那一版（它那边有更新的字）：那一版要是它没见过的（别处改的），先另存
    if (overrode) {
      if (note.unseen !== undefined) this.preserve(note, text, '编辑器保留了刚输入的字，另一版已另存为');
      else if (note.seq === 0 && note.text !== text) {
        // 这次运行里编辑器还没给这篇发过改动：我们手里的是磁盘上的版本，不是它之前打的字
        const copy = this.copy(id, note.text, '别处的版本');
        this.notify(`编辑器保留了刚输入的字，另一版已另存为「${copy}」`);
      }
    }
    note.renameNeeded ||= noteTitle(note.text) !== noteTitle(text);
    note.text = text;
    note.seq = seq;
    note.dirty = note.text !== note.base;
  }

  /** 编辑器没见过的那一版（别处改的）要被盖掉之前，另存一份。 */
  preserve(note, incoming, message) {
    const other = note.unseen;
    note.unseen = undefined;
    if (other === undefined || other === incoming || note.preserved?.includes(other)) return;
    const copy = this.copy(note.id, other, '别处的版本');
    (note.preserved ??= []).push(other);
    this.notify(`${message}「${copy}」`);
  }

  copy(id, text, label) {
    const rel = unique(this.root, folderOf(id), noteTitle(text) || '无标题', `（${label}）`);
    fs.writeFileSync(inside(this.root, rel), text, { flag: 'wx', mode: 0o600 });
    return rel;
  }

  save(note) {
    if (!note.dirty) return;
    const file = inside(this.root, note.id);
    const raw = fs.existsSync(file) ? fs.readFileSync(file) : null;
    const disk = raw === null ? null : decode(raw);
    if (disk !== note.base && disk !== note.text && disk !== null && !note.preserved?.includes(disk)) {
      const copy = this.copy(note.id, disk, '别处的版本');
      (note.preserved ??= []).push(disk);
      this.notify(`「${note.id}」在别处也改过，那一版已另存为「${copy}」`);
    }
    // 别处改的那一版读进来了、编辑器还没显示，这边又打了字：编辑器随后会说它拒收，这里先保住，不等
    this.preserve(note, note.text, `「${note.id}」在别处也改过，那一版已另存为`);
    if (disk === null) {
      const copy = this.copy(note.id, note.text, '本机未保存');
      this.notify(`原文件已在别处删除，刚输入的文字已另存为「${copy}」`);
      note.dirty = false;
      return;
    }
    const crlf = raw.includes('\r\n');
    const bom = raw.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
    atomic(file, (bom ? '﻿' : '') + (crlf ? note.text.replace(/\n/g, '\r\n') : note.text));
    note.base = note.text;
    const stat = fs.statSync(file);
    note.modified = stat.mtimeMs;
    note.stamp = `${stat.mtimeMs}:${stat.size}:${stat.ino}`;
    note.dirty = false;
  }

  /** 把没存的都存下去；返回这次有没有写文件。 */
  flush() {
    const errors = [];
    let wrote = false;
    for (const note of this.notes.values()) {
      if (!note.dirty) continue;
      try { this.save(note); wrote = true; } catch (error) { errors.push(`「${note.id}」保存失败：${error.message}`); }
    }
    if (errors.length) throw new Error(errors.join('\n'));
    return wrote;
  }

  create(folder = '', tag = '') {
    this.validFolder(folder);
    const id = unique(this.root, folder, '新笔记');
    fs.writeFileSync(inside(this.root, id), `# 新笔记\n\n${tag ? '#' + tag + '\n' : ''}`, { flag: 'wx', mode: 0o600 });
    this.reload();
    return id;
  }

  validFolder(folder) {
    if (typeof folder !== 'string' || folder.split('/').some(p => ['附件', TRASH].includes(p))) throw new Error('请选择普通笔记文件夹');
    const dir = inside(this.root, folder);
    if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error('文件夹不存在');
    return dir;
  }

  validName(name) {
    if (typeof name !== 'string' || !name.trim() || name !== name.trim() || /[/\\\0]/.test(name)
        || name.startsWith('.') || ['附件', TRASH].includes(name) || Buffer.byteLength(name) > 240) throw new Error('请输入有效的文件夹名称');
  }

  createFolder(parent, name) {
    this.validFolder(parent);
    this.validName(name);
    const rel = path.posix.join(parent, name);
    if (fs.existsSync(inside(this.root, rel))) throw new Error(`已经有「${name}」这个文件夹了`);
    fs.mkdirSync(inside(this.root, rel));
    this.reload();
    return rel;
  }

  /** 给文件夹改名：里面笔记的置顶、废纸篓来源、绑定登记跟着改；登记写不进去就改回原名。 */
  renameFolder(id, name) {
    if (!id) throw new Error('请选择一个文件夹');
    const dir = this.validFolder(id);
    this.validName(name);
    const target = path.posix.join(folderOf(id), name);
    if (target === id) return id;
    if (fs.existsSync(inside(this.root, target))) throw new Error(`已经有「${name}」这个文件夹了`);
    this.flush();
    const state = this.json('state.json', {}), registry = this.json('links.json', { links: [] });
    const swap = p => (p === id ? target : p.startsWith(id + '/') ? target + p.slice(id.length) : p);
    const nextState = { ...state };
    if (state.pinned) nextState.pinned = state.pinned.map(swap);
    if (state.trashOrigins) nextState.trashOrigins = Object.fromEntries(Object.entries(state.trashOrigins).map(([k, v]) => [k, typeof v === 'string' ? swap(v) : v]));
    const nextLinks = { ...registry, links: registry.links.map(l => ({ ...l, note: swap(l.note) })) };
    const dest = inside(this.root, target);
    fs.renameSync(dir, dest);
    let stateWritten = false;
    try {
      stateWritten = this.update('state.json', state, nextState);
      this.update('links.json', registry, nextLinks);
    } catch (error) {
      if (stateWritten) this.writeJSON('state.json', state);
      fs.renameSync(dest, dir);
      throw error;
    }
    // 内存里的笔记跟着换路径：文件本身没动，改动编号、还没改的文件名都留着
    const next = new Map();
    for (const [key, note] of this.notes) { note.id = swap(key); next.set(note.id, note); }
    this.notes = next;
    this.reload();
    return target;
  }

  /** 删文件夹：里面的笔记都进废纸篓（能放回原处），空了的文件夹删掉；还有别的文件（图片、PDF）就留着文件夹。 */
  deleteFolder(id) {
    if (!id) throw new Error('请选择一个文件夹');
    const dir = this.validFolder(id);
    this.flush();
    const trashed = [];
    try {
      for (const key of [...this.notes.keys()].filter(k => k.startsWith(id + '/'))) {
        trashed.push(this.relocate(key, TRASH, noteTitle(this.get(key).text) || '无标题', folderOf(key), { batch: true }));
      }
    } finally { this.reload(); }
    const hollow = d => fs.readdirSync(d, { withFileTypes: true }).every(e => (e.isDirectory() && !e.isSymbolicLink() ? hollow(path.join(d, e.name)) : e.name === KEEP || e.name === '.DS_Store'));
    const removed = hollow(dir);
    if (removed) { fs.rmSync(dir, { recursive: true }); this.reload(); }
    return { trashed, removed };
  }

  pin(id) {
    this.get(id, true);
    const state = this.json('state.json', {});
    const pinned = new Set(state.pinned ?? []);
    if (pinned.has(id)) pinned.delete(id); else pinned.add(id);
    this.writeJSON('state.json', { ...state, pinned: [...pinned] });
  }

  /** 文件、置顶/废纸篓来源、绑定路径一起变；中途失败尽量回滚，正文源文件最后才删除。 */
  relocate(id, folder, title, origin, { batch = false } = {}) {
    this.flush();
    const note = this.get(id);
    const source = inside(this.root, id);
    const raw = fs.readFileSync(source);
    const text = decode(raw); // 移动前读最新的，外部修改不被旧内存覆盖。
    const target = unique(this.root, folder, title ?? path.basename(id, path.extname(id)));
    const dest = inside(this.root, target);
    const state = this.json('state.json', {});
    const registry = this.json('links.json', { links: [] });
    const origins = { ...(state.trashOrigins ?? {}) };
    delete origins[id];
    if (origin !== undefined) origins[target] = origin;
    const nextState = { ...state, trashOrigins: origins };
    if (state.pinned) nextState.pinned = state.pinned.map(p => (p === id ? target : p));
    if (!state.trashOrigins && !Object.keys(origins).length) delete nextState.trashOrigins;
    const nextLinks = { ...registry, links: registry.links.map(l => l.note === id ? { ...l, note: target } : l) };
    const fromFolder = inTrash(id) ? state.trashOrigins?.[id] ?? '' : folderOf(id);
    const toFolder = folder === TRASH ? origin ?? '' : folder;
    const rebased = rebase(text, fromFolder, toFolder);
    let stateWritten = false, linksWritten = false;
    fs.linkSync(source, dest); // 排他创建目标；不会覆盖重名文件。
    try {
      if (rebased !== text) {
        const body = raw.includes('\r\n') ? rebased.replace(/\n/g, '\r\n') : rebased;
        atomic(dest, (raw.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ? '﻿' : '') + body);
      }
      stateWritten = this.update('state.json', state, nextState);
      linksWritten = this.update('links.json', registry, nextLinks);
      // 同步程序若在移动期间又改了源文件，保留源文件并回滚本次移动。
      if (!fs.readFileSync(source).equals(raw)) throw new Error('移动时文件又在别处改了，请重试');
      fs.unlinkSync(source);
    } catch (error) {
      if (linksWritten) this.writeJSON('links.json', registry);
      if (stateWritten) this.writeJSON('state.json', state);
      fs.rmSync(dest, { force: true });
      throw error;
    }
    this.notes.delete(id);
    if (batch) return target; // 一次挪很多篇时，最后统一重读
    this.reload();
    this.notes.get(target).seq = note.seq;
    return target;
  }

  finalize(id) {
    const note = this.notes.get(id);
    if (!note?.renameNeeded || inTrash(id)) return id;
    this.flush();
    const title = noteTitle(note.text) || '无标题';
    if (path.basename(id, path.extname(id)) === title) { note.renameNeeded = false; return id; }
    return this.relocate(id, folderOf(id), title);
  }

  move(id, folder) {
    this.get(id, true);
    this.validFolder(folder);
    if (folderOf(id) === folder) return this.finalize(id);
    return this.relocate(id, folder, noteTitle(this.get(id).text) || '无标题');
  }

  trash(id) {
    this.get(id, true);
    return this.relocate(id, TRASH, noteTitle(this.get(id).text) || '无标题', folderOf(id));
  }

  restore(id) {
    if (!inTrash(id)) throw new Error('这篇笔记不在废纸篓里');
    const state = this.json('state.json', {});
    const folder = state.trashOrigins?.[id] ?? '';
    if (typeof folder !== 'string' || folder.split('/').some(p => ['附件', TRASH].includes(p))) throw new Error('废纸篓来源无效');
    fs.mkdirSync(inside(this.root, folder), { recursive: true });
    return this.relocate(id, folder);
  }

  /** 永久删除废纸篓里的笔记（不给 id 就是清空废纸篓）。删了就没有了，界面上要先问一句。返回删了几篇。 */
  purge(id) {
    if (id !== undefined && !inTrash(id)) throw new Error('只能永久删除废纸篓里的笔记');
    const ids = id === undefined ? [...this.notes.keys()].filter(inTrash) : [this.get(id).id];
    if (!ids.length) return 0;
    const state = this.json('state.json', {});
    const gone = new Set(ids);
    const nextState = { ...state };
    if (state.pinned) nextState.pinned = state.pinned.filter(p => !gone.has(p));
    if (state.trashOrigins) nextState.trashOrigins = Object.fromEntries(Object.entries(state.trashOrigins).filter(([k]) => !gone.has(k)));
    // 先改登记再删文件：登记写不进去时一篇也没删
    this.update('state.json', state, nextState);
    for (const key of ids) { fs.rmSync(inside(this.root, key), { force: true }); this.notes.delete(key); }
    this.reload();
    return ids.length;
  }

  attach(id, name, mime, data) {
    this.get(id, true);
    if (typeof data !== 'string' || data.length > 90 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error('附件无效或超过 64 MiB');
    const dir = inside(this.root, '附件');
    const suggested = attachmentName(path.basename(name || '文件'), mime, new Date(), n => fs.existsSync(path.join(dir, n)));
    const rel = unique(this.root, '附件', path.parse(suggested).name, '', path.extname(suggested));
    fs.writeFileSync(inside(this.root, rel), Buffer.from(data, 'base64'), { flag: 'wx', mode: 0o600 });
    return { link: encode(path.posix.relative(folderOf(id) || '.', rel)), name, image: mime?.startsWith('image/') ?? false };
  }

  recover(dir) {
    fs.mkdirSync(dir, { recursive: true });
    const saved = [];
    for (const note of this.notes.values()) if (note.dirty) {
      const rel = unique(dir, '', noteTitle(note.text) || '无标题', `（${Date.now()}）`);
      fs.writeFileSync(inside(dir, rel), note.text, { flag: 'wx', mode: 0o600 });
      saved.push(path.join(dir, rel));
    }
    return saved;
  }
}

module.exports = { NoteStore };
