/* 三栏桌面界面。正文只交给共用编辑器；所有文件操作都通过 preload 的窄接口。
   清单里每篇只有标题、摘要这些（正文在主进程，打开哪篇取哪篇）；侧栏和列表按 key 复用已有的元素，
   只改变了的地方——这样选中、展开才有动画，几千篇也不卡。 */
const $ = selector => document.querySelector(selector);
const node = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (value !== undefined && value !== false) el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) el.append(child);
  return el;
};
const fold = s => s.normalize('NFKC').toLocaleLowerCase();
const folderOf = id => id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '';
const PAGE_SIZE = 120; // 列表一次先画这么多篇，滚到底再接着画
const store = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 记不下界面状态不要紧 */ } },
};

let model = { root: '', folders: [], notes: [] }, byId = new Map();
let selected = null, scope = { kind: 'all', id: '' }, query = '', searchAll = false, hits = null, tagFilter = '';
let busy = false, focusMode = false, initialized = false, limit = PAGE_SIZE;
let sync = { enabled: false, state: 'off', url: null, last: null, error: null };
let shown = null, showToken = 0, searchToken = 0, version = '';
let naming = null; // 正在侧栏里就地起名：{ parent } 新建文件夹，{ id } 重命名
const collapsed = new Set(store.get('collapsed', []));
const pending = new Set(), failedChanges = new Map();
let operations = Promise.resolve();

async function rpc(action, args) {
  const result = await window.desktop.invoke(action, args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

/** 列表和编辑区里的时间：今天“今天 10:24”，昨天“昨天 19:05”，今年“10月3日”，更早“2025年10月3日”（和 macOS 版一样）。 */
function dateLabel(ms, now = new Date()) {
  const date = new Date(ms), pad = n => String(n).padStart(2, '0');
  const sameDay = (x, y) => x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (sameDay(date, now)) return '今天 ' + time;
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return '昨天 ' + time;
  const md = `${date.getMonth() + 1}月${date.getDate()}日`;
  return date.getFullYear() === now.getFullYear() ? md : `${date.getFullYear()}年${md}`;
}

/** 让 parent 的子元素正好是 els（按顺序）：已经在位的不动，所以悬停、动画、滚动位置都不受影响。 */
function reconcile(parent, els) {
  let i = 0;
  for (const el of els) { if (parent.children[i] !== el) parent.insertBefore(el, parent.children[i] ?? null); i++; }
  while (parent.children.length > els.length) {
    const extra = parent.lastElementChild;
    // 要拿掉的元素里有输入框正拿着焦点：先让它失焦（失焦的处理可能会重画），再拿掉
    if (extra.contains(document.activeElement)) document.activeElement.blur();
    if (extra.parentElement === parent) extra.remove();
  }
}

// ---- 提示条 ----

/** 窗口右下角的提示。带「撤销」的、普通的过几秒自己收起；出错这类要紧的（sticky）留到手动关掉。 */
function notice(text, { undo, sticky = false } = {}) {
  const box = $('#notices');
  if ([...box.children].some(n => n.dataset.text === text && !n.classList.contains('leaving'))) return;
  const item = node('div', { class: 'notice', 'data-text': text }, node('span', {}, text));
  let timer;
  const dismiss = () => { clearTimeout(timer); item.classList.add('leaving'); setTimeout(() => item.remove(), 220); };
  if (undo) item.append(node('button', { class: 'undo', onclick: () => { dismiss(); undo(); } }, '撤销'));
  item.append(node('button', { class: 'dismiss', 'aria-label': '关闭提示', onclick: dismiss }, lineIcon('close')));
  if (!sticky) {
    const arm = () => { timer = setTimeout(dismiss, undo ? 8000 : 5000); };
    item.addEventListener('mouseenter', () => clearTimeout(timer));
    item.addEventListener('mouseleave', arm);
    arm();
  }
  box.append(item);
  while (box.children.length > 4) box.firstElementChild.remove();
}
const fail = error => notice(error.message, { sticky: true });

// ---- 和主进程之间：先存再做 ----

async function flushEditor(saveToDisk = true) {
  window.bettermd?.flush();
  await Promise.allSettled([...pending]);
  for (const [id, message] of failedChanges) {
    await rpc('change', message);
    failedChanges.delete(id);
  }
  if (saveToDisk) await rpc('flush');
}

/** 改文件的操作排着队做；做的时候不重画，做完画一次。 */
function perform(work) {
  const run = operations.then(async () => {
    busy = true;
    try { await work(); }
    catch (error) { fail(error); await rpc('cancelClose').catch(() => {}); }
    finally { busy = false; render(); }
  });
  operations = run.catch(fail);
  return run;
}

async function finalizeCurrent() {
  window.bettermd?.prepareToLeave();
  await flushEditor();
  if (selected) selected = await rpc('finalize', { id: selected });
}

function applySnapshot(data) {
  if (model.root && model.root !== data.root) {
    selected = null; scope = { kind: 'all', id: '' }; query = ''; searchAll = false; hits = null; tagFilter = ''; $('#search').value = ''; collapsed.clear(); shown = null;
  }
  const first = !model.root;
  model = data;
  byId = new Map(data.notes.map(n => [n.id, n]));
  if (first) {
    // 回到上次看的地方
    const last = store.get('last', null);
    if (last?.root === data.root) {
      const exists = s => (s.kind === 'folder' ? data.folders.includes(s.id) : s.kind === 'tag' ? data.notes.some(n => !n.trashed && n.tags.some(t => t === s.id || t.startsWith(s.id + '/'))) : ['all', 'unfiled', 'todo', 'trash'].includes(s.kind));
      if (last.scope && exists(last.scope)) scope = { kind: last.scope.kind, id: last.scope.id ?? '' };
      if (byId.has(last.selected)) selected = last.selected;
    }
  }
  if (query.trim()) runSearch();
  if (!busy) render();
}

// ---- 当前范围里有哪些笔记 ----

function matchesScope(note) {
  if (scope.kind === 'trash') return note.trashed;
  if (note.trashed) return false;
  if (scope.kind === 'folder') return note.id.startsWith(scope.id + '/');
  if (scope.kind === 'unfiled') return !note.id.includes('/');
  if (scope.kind === 'todo') return note.todo;
  if (scope.kind === 'tag') return note.tags.some(t => t === scope.id || t.startsWith(scope.id + '/'));
  return true;
}

function visibleNotes() {
  const searching = !!hits; // 有搜索结果了才算在搜索：结果回来之前列表保持原样，不闪一下“没有找到”
  let notes = model.notes.filter(n => (searching && searchAll ? !n.trashed : matchesScope(n)));
  if (searching) notes = notes.filter(n => hits.has(n.id));
  else if (tagFilter && scope.kind === 'folder') notes = notes.filter(n => n.tags.some(t => t === tagFilter || t.startsWith(tagFilter + '/')));
  // 搜索时标题命中的在前；平时置顶的在前；然后按修改时间
  return notes.sort((a, b) => (searching ? hits.get(b.id).title - hits.get(a.id).title : Number(b.pinned) - Number(a.pinned)) || b.modified - a.modified);
}

function scopeName() {
  return ({ all: '我的笔记', unfiled: '未分类', todo: '待办', trash: '废纸篓' })[scope.kind] ?? scope.id.split('/').pop();
}

function setScope(kind, id = '') {
  return perform(async () => {
    await finalizeCurrent();
    scope = { kind, id }; searchAll = false; tagFilter = ''; selected = null; limit = PAGE_SIZE;
    // 选中深处的文件夹或标签时，上级自动展开
    if (kind === 'folder' || kind === 'tag') {
      const parts = id.split('/');
      for (let i = 1; i < parts.length; i++) collapsed.delete(`${kind}:${parts.slice(0, i).join('/')}`);
      if (kind === 'tag') collapsed.delete('tags');
      store.set('collapsed', [...collapsed]);
    }
    $('#note-list').scrollTop = 0;
  });
}

// ---- 侧栏 ----

const navNodes = new Map();

function navSpecs() {
  const kids = new Map();
  for (const folder of model.folders) { const parent = folderOf(folder); if (!kids.has(parent)) kids.set(parent, []); kids.get(parent).push(folder); }
  const namingRow = parent => (naming && naming.parent === parent ? [{ key: 'naming', naming: true }] : []);
  const folders = parent => [...(kids.get(parent) ?? []).map(f => ({ key: `folder:${f}`, kind: 'folder', id: f, label: f.split('/').pop(), icon: 'envelope',
    renaming: naming?.id === f, droppable: true, children: [...folders(f), ...namingRow(f)] })), ...(parent === '' ? namingRow('') : [])];
  const tags = new Set();
  for (const note of model.notes) if (!note.trashed) for (const tag of note.tags) {
    const parts = tag.split('/'); for (let i = 1; i <= parts.length; i++) tags.add(parts.slice(0, i).join('/'));
  }
  const sorted = [...tags].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const tagKids = parent => sorted.filter(t => folderOf(t) === parent).map(t => ({ key: `tag:${t}`, kind: 'tag', id: t, label: t.split('/').pop(), icon: 'tag', children: tagKids(t) }));
  return [
    { key: 'all', kind: 'all', label: '我的笔记', icon: 'notebook', droppable: true, add: true },
    ...folders(''),
    { key: 'unfiled', kind: 'unfiled', label: '未分类', icon: 'sheet', droppable: true },
    { key: 'gap', gap: true },
    { key: 'todo', kind: 'todo', label: '待办', icon: 'todo' },
    ...(sorted.length ? [{ key: 'tags', section: true, label: '标签', children: tagKids('') }] : []),
  ];
}

function toggleCollapsed(key) {
  if (collapsed.has(key)) collapsed.delete(key); else collapsed.add(key);
  store.set('collapsed', [...collapsed]);
  renderNavigation();
}

function createNav(spec) {
  const group = node('div', { class: 'nav-group', 'data-key': spec.key });
  const n = { group, spec };
  if (spec.gap) { group.className = 'nav-gap'; return n; }
  if (spec.naming) {
    // 新建文件夹：在侧栏里就地输入名字，回车确定，Esc 取消
    n.input = node('input', { class: 'nav-input', type: 'text', placeholder: '文件夹名称', 'aria-label': '文件夹名称', spellcheck: 'false' });
    wireNaming(n.input);
    n.row = node('div', { class: 'nav-row' }, node('span', { class: 'chev' }), objectIcon('envelope'), n.input);
    group.append(n.row);
    return n;
  }
  if (spec.section) {
    n.row = node('button', { class: 'nav-section', onclick: () => toggleCollapsed(spec.key) }, lineIcon('chevron'), spec.label);
  } else {
    n.chev = node('span', { class: 'chev', onclick: event => { if (n.spec.children?.length) { event.stopPropagation(); toggleCollapsed(n.spec.key); } } });
    n.label = node('span', { class: 'nav-label' });
    n.row = node('button', { class: 'nav-row', tabindex: '-1', onclick: () => { if (!n.input) setScope(n.spec.kind, n.spec.id); } },
      n.chev, ['notebook', 'sheet', 'envelope'].includes(spec.icon) ? objectIcon(spec.icon) : lineIcon(spec.icon), n.label);
    if (spec.add) n.row.append(node('span', { class: 'nav-add', role: 'button', title: '新建文件夹', 'aria-label': '新建文件夹', onclick: event => { event.stopPropagation(); command('folder', ''); } }, lineIcon('plus')));
    if (spec.kind === 'folder' || spec.kind === 'trash') n.row.addEventListener('contextmenu', event => { event.preventDefault(); showFolderMenu(event.clientX, event.clientY, n.spec); });
    if (spec.droppable) {
      const dragged = event => event.dataTransfer.types.includes('application/x-bettermd-note');
      n.row.addEventListener('dragover', event => { if (dragged(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; n.row.classList.add('drop', 'open'); } });
      n.row.addEventListener('dragleave', () => { n.row.classList.remove('drop'); n.row.classList.toggle('open', n.row.classList.contains('active')); });
      n.row.addEventListener('drop', event => {
        event.preventDefault(); n.row.classList.remove('drop');
        const id = event.dataTransfer.getData('application/x-bettermd-note');
        if (n.spec.kind === 'trash') command('trash', id); else moveNote(id, n.spec.kind === 'folder' ? n.spec.id : '');
      });
    }
  }
  n.inner = node('div');
  group.append(n.row, node('div', { class: 'nav-kids' }, n.inner));
  return n;
}

function wireNaming(input) {
  let done = false;
  const finish = async ok => {
    if (done) return; done = true;
    const name = input.value.trim(), task = naming;
    naming = null;
    if (!ok || !name || !task) { renderNavigation(); return; }
    perform(async () => {
      if (task.id !== undefined) {
        if (name === task.id.split('/').pop()) return;
        await finalizeCurrent();
        const next = await rpc('renameFolder', { id: task.id, name });
        const swap = p => (p === task.id ? next : p.startsWith(task.id + '/') ? next + p.slice(task.id.length) : p);
        if (scope.kind === 'folder') scope = { kind: 'folder', id: swap(scope.id) };
        if (selected) selected = swap(selected);
        for (const key of [...collapsed]) if (key.startsWith('folder:')) { collapsed.delete(key); collapsed.add('folder:' + swap(key.slice(7))); }
      } else {
        const id = await rpc('folder', { parent: task.parent, name });
        await finalizeCurrent();
        scope = { kind: 'folder', id }; selected = null; tagFilter = '';
      }
    });
  };
  input.addEventListener('keydown', event => {
    if (event.isComposing) return;
    event.stopPropagation();
    if (event.key === 'Enter') { event.preventDefault(); finish(true); }
    if (event.key === 'Escape') { event.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', event => event.stopPropagation());
}

function updateNav(n, spec) {
  n.spec = spec;
  if (spec.gap || spec.naming) { if (spec.naming) n.row.style.setProperty('--depth', spec.depth); return; }
  const expandable = !!spec.children?.length;
  n.group.classList.toggle('expanded', expandable && !collapsed.has(spec.key));
  if (spec.section) return;
  const active = scope.kind === spec.kind && scope.id === (spec.id ?? '');
  n.row.style.setProperty('--depth', spec.depth);
  n.row.classList.toggle('active', active);
  if (!n.row.classList.contains('drop')) n.row.classList.toggle('open', active);
  n.row.title = spec.id || spec.label;
  if (expandable && !n.chev.firstChild) n.chev.append(lineIcon('chevron'));
  if (!expandable && n.chev.firstChild) n.chev.replaceChildren();
  if (spec.renaming && !n.input) {
    n.input = node('input', { class: 'nav-input', type: 'text', value: spec.label, 'aria-label': '文件夹名称', spellcheck: 'false' });
    wireNaming(n.input);
    n.label.replaceWith(n.input);
  } else if (!spec.renaming && n.input) { n.input.replaceWith(n.label); n.input = null; }
  if (n.label.textContent !== spec.label) n.label.textContent = spec.label;
}

let navRendering = false, navAgain = false;
function renderNavigation() {
  // 画到一半又被叫（输入框失焦时会）：这一遍画完再画一遍，不嵌套着画
  if (navRendering) { navAgain = true; return; }
  navRendering = true;
  try { drawNavigation(); } finally { navRendering = false; }
  if (navAgain) { navAgain = false; renderNavigation(); }
}

function drawNavigation() {
  const used = new Set();
  const build = (spec, depth) => {
    spec.depth = depth;
    used.add(spec.key);
    let n = navNodes.get(spec.key);
    if (!n) { n = createNav(spec); navNodes.set(spec.key, n); }
    updateNav(n, spec);
    if (spec.children) reconcile(n.inner, spec.children.map(child => build(child, spec.section ? 0 : depth + 1)));
    return n.group;
  };
  reconcile($('#navigation'), navSpecs().map(spec => build(spec, 0)));
  reconcile($('#trash-slot'), [build({ key: 'trash', kind: 'trash', label: '废纸篓', icon: 'trash', droppable: true }, 0)]);
  for (const key of [...navNodes.keys()]) if (!used.has(key)) navNodes.delete(key);
  const input = navNodes.get('naming')?.input ?? [...navNodes.values()].find(n => n.input && n.spec.renaming)?.input;
  if (input && document.activeElement !== input) { input.focus(); input.select(); }
}

/** 侧栏里现在看得见的行（收起来的不算），从上到下。 */
function navRows() {
  const hiddenRow = row => { for (let k = row.parentElement.closest('.nav-kids'); k; k = k.parentElement.closest('.nav-kids')) if (!k.parentElement.classList.contains('expanded')) return true; return false; };
  return [...document.querySelectorAll('#navigation button.nav-row, #trash-slot button.nav-row')].filter(row => !hiddenRow(row));
}
const navOf = row => navNodes.get(row.closest('[data-key]').dataset.key);
const focusNav = () => (document.querySelector('#sidebar .nav-row.active') ?? navRows()[0])?.focus();

// ---- 笔记列表 ----

const cards = new Map();

function highlight(parent, text) {
  const terms = query.trim().split(/\s+/).filter(Boolean).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!terms.length) { parent.textContent = text; return; }
  const regex = new RegExp(terms.join('|'), 'giu');
  let at = 0;
  for (const match of text.matchAll(regex)) { parent.append(text.slice(at, match.index), node('mark', {}, match[0])); at = match.index + match[0].length; }
  parent.append(text.slice(at));
}

function buildCard(note, snippet) {
  const title = node('span', { class: 'note-title' }); highlight(title, note.title);
  const body = snippet ?? note.preview;
  const preview = node('span', { class: `note-preview${body ? '' : ' empty'}` }); highlight(preview, body || '还没有正文');
  const where = note.dir ? note.dir.split('/').pop() : '未分类';
  const card = node('button', { class: `note-card${note.pinned ? ' pinned' : ''}`, role: 'option', tabindex: '-1', 'data-id': note.id, draggable: String(!note.trashed),
    onclick: () => selectNote(note.id), oncontextmenu: event => { event.preventDefault(); showNoteMenu(event.clientX, event.clientY, note); } },
    node('span', { class: 'note-main' }, title, preview,
      node('span', { class: 'note-meta' }, node('span', {}, dateLabel(note.modified)),
        node('span', { class: 'where', title: note.trashed ? `原来在：${note.dir || '未分类'}` : note.dir || '未分类' }, lineIcon(note.dir ? 'mail' : 'doc'), node('span', {}, where)))),
    note.thumb ? node('img', { class: 'note-thumb', alt: '', loading: 'lazy', decoding: 'async', draggable: 'false', src: 'bettermd://library/' + note.thumb.split('/').map(encodeURIComponent).join('/'), onerror: event => event.target.remove() }) : null,
    note.pinned && !note.trashed ? node('span', { class: 'ribbon', title: '已置顶' }) : null);
  card.addEventListener('dragstart', event => { event.dataTransfer.setData('application/x-bettermd-note', note.id); event.dataTransfer.effectAllowed = 'move'; card.classList.add('dragging'); });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));
  return card;
}

function renderList() {
  const list = $('#note-list'), notes = visibleNotes(), searching = !!hits;
  $('#scope-title').textContent = searchAll && searching ? '全部笔记' : scopeName();
  $('#count').textContent = searching ? `在${searchAll ? '全部笔记' : `「${scopeName()}」`}里找到 ${notes.length} 篇` : `${notes.length} 篇`;
  $('#search-scope').hidden = !searching || scope.kind === 'all';
  $('#search-scope').textContent = searchAll ? '只搜这里' : '搜全部';
  $('#search-clear').hidden = !query;
  $('#empty-trash').hidden = searching || scope.kind !== 'trash' || !notes.length;

  // 只有在文件夹里时显示一排标签筛选：只列一级标签，点了包含它的子标签
  const filter = $('#tag-filter');
  const top = scope.kind === 'folder' && !searching ? [...new Set(model.notes.filter(matchesScope).flatMap(n => n.tags.map(t => t.split('/')[0])))].sort((a, b) => a.localeCompare(b, 'zh-CN')) : [];
  filter.hidden = !top.length;
  if (top.length) filter.replaceChildren(...top.map(tag => node('button', { class: `chip${tagFilter === tag ? ' on' : ''}`, onclick: () => { tagFilter = tagFilter === tag ? '' : tag; limit = PAGE_SIZE; render(); } }, '#' + tag)));

  const els = [], seen = new Set();
  for (const note of notes.slice(0, limit)) {
    const snippet = searching ? hits.get(note.id).snippet : null;
    const sig = [note.title, snippet ?? note.preview, dateLabel(note.modified), note.dir, note.pinned, note.thumb, note.trashed, searching ? query : ''].join('\u0001');
    let card = cards.get(note.id);
    if (!card || card.sig !== sig) { card = { el: buildCard(note, snippet), sig }; cards.set(note.id, card); }
    card.el.classList.toggle('selected', note.id === selected);
    card.el.setAttribute('aria-selected', String(note.id === selected));
    els.push(card.el); seen.add(note.id);
  }
  for (const id of [...cards.keys()]) if (!seen.has(id)) cards.delete(id);
  if (!notes.length) {
    const [title, detail, label, run] = searching
      ? ['没有找到', searchAll || scope.kind === 'all' ? '换几个字试试。' : `「${scopeName()}」里没有，别处也许有。`, searchAll || scope.kind === 'all' ? null : '搜全部笔记', () => $('#search-scope').click()]
      : scope.kind === 'trash' ? ['废纸篓是空的', '删掉的笔记会先放在这里，可以放回原处。', null]
      : scope.kind === 'todo' ? ['没有待办', '笔记里写了「- [ ] 要做的事」，就会出现在这里。', null]
      : ['这里还是空白', '写下第一篇吧。', '新建笔记', () => command('new')];
    els.push(node('div', { class: 'list-empty' }, node('strong', {}, title), node('span', {}, detail), label ? node('button', { class: 'link-button', onclick: run }, label) : null));
  } else if (notes.length > limit) els.push(node('div', { class: 'list-more' }, `还有 ${notes.length - limit} 篇，往下滚动继续`));
  reconcile(list, els);
}

/** 让列表里画出来的范围包含这一篇，并滚到看得见的地方。 */
function revealCard(id) {
  const at = visibleNotes().findIndex(n => n.id === id);
  if (at >= limit) { limit = at + PAGE_SIZE; renderList(); }
  cards.get(id)?.el.scrollIntoView({ block: 'nearest' });
}

// ---- 编辑区 ----

function setSaveState(text, failed = false) {
  const el = $('#save-state');
  el.textContent = text;
  el.classList.toggle('failed', failed);
  el.classList.add('show');
  if (!failed) requestAnimationFrame(() => { if (text === '已保存') el.classList.remove('show'); });
}

/** 把选中的那篇放进编辑器。正文从主进程取；显示出来以后告诉主进程（之后发的改动都是在这一版上改的）。 */
async function showNote(selectTitle = false) {
  const note = byId.get(selected);
  $('#editor').hidden = !note; $('#empty-editor').hidden = !!note;
  for (const button of [$('#format-button'), $('[data-command="attach"]')]) button.disabled = !note || note.trashed;
  $('#more-button').disabled = !note;
  const crumb = $('#breadcrumb');
  if (!note) { showToken++; shown = null; window.bettermd?.clear(); crumb.replaceChildren(); return; }
  const where = note.dir ? note.dir.replaceAll('/', ' / ') : '未分类';
  crumb.replaceChildren(note.dir ? objectIcon('envelope') : objectIcon('sheet'), node('span', {}, note.trashed ? `废纸篓 · 原来在 ${where}` : where));
  const sig = [note.id, note.rev, note.dir, note.trashed, dateLabel(note.modified)].join('\u0001');
  if (shown?.sig === sig && !selectTitle) return;
  const token = ++showToken;
  let doc;
  try { doc = await rpc('read', { id: note.id }); } catch (error) { if (token === showToken) fail(error); return; }
  if (token !== showToken || selected !== note.id || !window.bettermd) return; // 取回来的时候已经换了一篇
  // 这一篇有改动没送到主进程时，按这一篇收到的编号算（编辑器会以它自己的为准、重发）；否则给全局最大的
  window.bettermd.setDocument(doc.id, doc.text, { dir: note.dir, readOnly: note.trashed, seq: failedChanges.has(doc.id) ? doc.seq : doc.received, selectTitle,
    meta: { modified: dateLabel(doc.modified), folder: note.trashed ? '废纸篓' : where } });
  shown = { id: note.id, sig, created: doc.created, modified: doc.modified };
  if (window.bettermd.view.state.doc.toString() === doc.text) rpc('seen', { id: doc.id, rev: doc.rev }).catch(() => {});
}

function render() {
  if (!initialized) return;
  if (!byId.has(selected)) selected = visibleNotes()[0]?.id ?? null;
  store.set('last', { root: model.root, scope, selected });
  renderNavigation(); renderList(); showNote();
}

function selectNote(id, selectTitle = false) {
  return perform(async () => {
    if (selected !== id) await finalizeCurrent();
    selected = id;
    renderList();
    await showNote(selectTitle);
  });
}

// ---- 菜单、面板 ----

function place(panel, x, y, origin = 'top left') {
  panel.hidden = false;
  panel.style.setProperty('--origin', origin);
  panel.style.left = `${Math.max(8, Math.min(x, innerWidth - panel.offsetWidth - 8))}px`;
  panel.style.top = `${Math.max(8, Math.min(y, innerHeight - panel.offsetHeight - 8))}px`;
}

/** 菜单项：[名字, 图标, 做什么, { danger, kbd }]；'-' 是分隔线；字符串是一行说明。 */
function popover(items, x, y, origin) {
  const panel = $('#popover');
  panel.className = '';
  panel.replaceChildren(...items.filter(Boolean).map(item => {
    if (item === '-') return node('div', { class: 'menu-sep' });
    if (typeof item === 'string') return node('div', { class: 'menu-caption' }, item);
    const [label, icon, run, options = {}] = item;
    return node('button', { class: `menu-item${options.danger ? ' danger' : ''}`, onclick: () => { panel.hidden = true; run(); } },
      lineIcon(icon), node('span', {}, label), options.kbd ? node('kbd', {}, options.kbd) : null);
  }));
  place(panel, x, y, origin);
}

function showNoteMenu(x, y, note, origin) {
  const times = shown?.id === note.id ? `修改 ${dateLabel(shown.modified)}　创建 ${dateLabel(shown.created)}` : `修改 ${dateLabel(note.modified)}`;
  popover(note.trashed ? [
    times, '-',
    ['放回原处', 'restore', () => command('restore', note.id), { kbd: 'Ctrl Shift R' }],
    ['复制文件路径', 'copy', () => command('copyPath', note.id)],
    '-', ['永久删除…', 'trash', () => command('purge', note.id), { danger: true }],
  ] : [
    times, '-',
    [note.pinned ? '取消置顶' : '置顶', 'pin', () => command('pin', note.id), { kbd: 'Ctrl Shift P' }],
    ['移动到…', 'move', () => command('move', note.id), { kbd: 'Ctrl Shift M' }],
    ['在文件管理器中显示', 'reveal', () => command('reveal', note.id)],
    ['复制文件路径', 'copy', () => command('copyPath', note.id)],
    '-', ['专注模式', 'focus', () => command('focus'), { kbd: 'Ctrl Shift D' }],
    ['键盘快捷键', 'keyboard', () => command('help'), { kbd: 'Ctrl /' }],
    '-', ['移到废纸篓', 'trash', () => command('trash', note.id), { danger: true, kbd: 'Ctrl ⌫' }],
  ], x, y, origin);
}

function showFolderMenu(x, y, spec) {
  if (spec.kind === 'trash') { popover([['清空废纸篓…', 'trash', () => command('emptyTrash'), { danger: true }]], x, y); return; }
  popover([
    ['新建笔记', 'compose', () => setScope('folder', spec.id).then(() => command('new'))],
    ['新建子文件夹', 'folderPlus', () => command('folder', spec.id)],
    ['重命名', 'rename', () => { naming = { id: spec.id }; renderNavigation(); }],
    ['在文件管理器中显示', 'reveal', () => rpc('reveal', { folder: spec.id }).catch(fail)],
    '-', ['删除文件夹', 'trash', () => command('deleteFolder', spec.id), { danger: true }],
  ], x, y);
}

function showFormatPanel() {
  const panel = $('#popover'), rect = $('#format-button').getBoundingClientRect();
  const button = (label, format, title, icon) => node('button', { title, 'aria-label': title, onclick: () => { panel.hidden = true; command(format === 'attach' ? 'attach' : `format:${format}`); } }, icon ? lineIcon(icon) : null, label);
  panel.className = 'format-panel';
  panel.replaceChildren(
    node('div', { class: 'format-row' }, button('H1', 'h1', '一级标题（Ctrl+1）'), button('H2', 'h2', '二级标题（Ctrl+2）'), button('H3', 'h3', '三级标题（Ctrl+3）'), button('正文', 'paragraph', '变回正文（Ctrl+0）')),
    node('div', { class: 'format-row' }, button('', 'bold', '粗体（Ctrl+B）', 'bold'), button('', 'italic', '斜体（Ctrl+I）', 'italic'), button('', 'strike', '删除线（Ctrl+Shift+U）', 'strike'), button('', 'code', '行内代码（Ctrl+Alt+C）', 'code'), button('', 'link', '链接（Ctrl+K）', 'link')),
    node('div', { class: 'format-row' }, button('', 'list', '列表（Ctrl+L）', 'list'), button('', 'numbered', '编号列表（Ctrl+Shift+L）', 'numbered'), button('', 'todo', '待办（Ctrl+T）', 'todo'), button('', 'quote', '引用（Ctrl+Shift+T）', 'quote'), button('', 'rule', '分割线', 'rule')),
    node('div', { class: 'format-row' }, button('', 'codeBlock', '代码块（Ctrl+Shift+C）', 'codeBlock'), button('', 'table', '表格（Ctrl+Alt+T）', 'table'), button('', 'math', '公式（Ctrl+Shift+E）', 'math'), button('', 'attach', '图片或文件（Ctrl+Shift+V）', 'image')),
    node('div', { class: 'format-hint' }, '也可以直接打 Markdown：# 标题、- 列表、$公式$'));
  place(panel, rect.right - 262, rect.bottom + 6, 'top right');
}

/** 移动到文件夹：搜索框加列表，↑↓ 选，回车移动。选了返回文件夹路径（未分类是空串），取消返回 null。 */
function pickFolder(current) {
  const dialog = $('#move-dialog'), input = $('#move-input'), list = $('#move-list');
  let options = [], at = 0, result = null;
  const draw = () => {
    const terms = fold(input.value).split(/\s+/).filter(Boolean);
    options = ['', ...model.folders].filter(f => terms.every(t => fold(f || '未分类').includes(t)));
    at = Math.max(0, Math.min(at, options.length - 1));
    list.replaceChildren(...options.map((f, i) => node('button', { class: `pick${i === at ? ' on' : ''}${f === current ? ' current' : ''}`, role: 'option', tabindex: '-1',
      onclick: () => { result = f; dialog.close(); }, onmousemove: () => { if (at !== i) { at = i; draw(); } } },
      objectIcon(f ? 'envelope' : 'sheet'), node('span', {}, f ? f.split('/').pop() : '未分类'),
      node('span', { class: 'path' }, f === current ? '现在在这里' : folderOf(f).replaceAll('/', ' / ')))));
    if (!options.length) list.append(node('div', { class: 'pick-empty' }, '没有这个文件夹'));
    list.children[at]?.scrollIntoView({ block: 'nearest' });
  };
  input.value = ''; at = 0;
  input.oninput = () => { at = 0; draw(); };
  input.onkeydown = event => {
    if (event.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); at += event.key === 'ArrowDown' ? 1 : -1; draw(); }
    if (event.key === 'Enter') { event.preventDefault(); if (options.length) { result = options[at]; dialog.close(); } }
  };
  draw();
  dialog.showModal();
  input.focus();
  return new Promise(resolve => dialog.addEventListener('close', () => resolve(result), { once: true }));
}

// ---- 同步 ----

function renderSync() {
  const button = $('#sync-button');
  const [icon, label] = !sync.enabled ? ['cloudOff', '开启同步…']
    : sync.state === 'syncing' ? ['sync', '正在同步…']
    : sync.state === 'offline' ? ['cloudOff', '离线，联网后同步']
    : sync.state === 'error' ? ['cloudAlert', '同步出错']
    : ['cloudDone', sync.last ? `已同步 ${dateLabel(sync.last).replace('今天 ', '')}` : '已开启同步'];
  $('#sync-icon').replaceChildren(lineIcon(icon));
  $('#sync-label').textContent = label;
  button.className = sync.state === 'error' ? 'error' : sync.state === 'syncing' ? 'syncing' : '';
  button.title = !sync.enabled ? '让几台电脑上的笔记保持一致' : sync.error ?? `同步到 ${sync.url ?? '远端仓库'}`;
}

async function openSync() {
  const dialog = $('#sync-dialog'), body = $('#sync-body');
  let info;
  try { info = await rpc('syncInfo'); } catch (error) { fail(error); return; }
  const closeButton = node('button', { class: 'secondary', onclick: () => dialog.close() }, '关闭');
  const draw = (message = '') => {
    if (info.enabled) {
      const [icon, text] = info.state === 'syncing' ? ['sync', '正在同步…'] : info.state === 'offline' ? ['cloudOff', '现在连不上，改动已经存在这台电脑上，联网后自动同步']
        : info.state === 'error' ? ['cloudAlert', '上次同步没成功'] : ['cloudDone', info.last ? `已同步，${dateLabel(info.last)}` : '已开启'];
      const now = node('button', { class: 'primary', onclick: async () => {
        now.disabled = true; now.textContent = '正在同步…';
        try { info = { ...info, ...await rpc('syncNow') }; draw(); } catch (error) { info = { ...info, ...sync }; draw(error.message); }
      } }, '立即同步');
      body.replaceChildren(
        node('div', { class: `sync-status${info.state === 'error' ? ' error' : ''}` }, lineIcon(icon), text),
        node('div', { class: 'sync-card' },
          node('h3', {}, lineIcon('sync'), '用 git 同步'),
          node('p', {}, '改完笔记十几秒后自动提交、推送；开着的时候每两分钟、回到窗口时拉一次别的电脑上的改动。'),
          node('p', {}, '仓库：', node('code', {}, info.url ?? info.remote ?? '')),
          node('p', {}, '笔记库：', node('code', {}, info.root)),
          message || info.error ? node('p', { class: 'sync-error' }, message || info.error) : null),
        node('p', { class: 'sync-fine' }, '两台电脑改了同一篇的不同地方，会合成一份；改了同一段，以后改的为准，另一版另存成「标题（别处的版本）」。停止同步不会删任何东西，仓库和历史都留着。'),
        node('form', { method: 'dialog' }, node('button', { class: 'link-button', type: 'button', onclick: async () => {
          try { info = { ...info, ...await rpc('syncDisable') }; draw(); } catch (error) { draw(error.message); }
        } }, '停止同步'), node('span', { class: 'dialog-note' }), closeButton, now));
      return;
    }
    const url = node('input', { type: 'text', placeholder: 'git@github.com:你的名字/notes.git', value: info.remote ?? '', spellcheck: 'false', 'aria-label': '仓库地址' });
    const start = node('button', { class: 'primary', disabled: !info.available || info.nested, onclick: async () => {
      if (!url.value.trim()) { url.focus(); return; }
      start.disabled = true; start.textContent = '正在连接…';
      try { info = { ...info, ...await rpc('syncSetup', { url: url.value }) }; draw(); }
      catch (error) { draw(error.message); $('#sync-body input')?.focus(); }
    } }, '开始同步');
    url.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); start.click(); } });
    body.replaceChildren(
      node('p', {}, '笔记就是文件夹里的 .md 文件。要让几台电脑上的笔记保持一致，有两种办法：'),
      node('div', { class: 'sync-card' },
        node('h3', {}, lineIcon('sync'), 'GitHub（git 仓库）'),
        node('p', {}, '在 GitHub 上建一个私有仓库，把地址填在下面。之后改完笔记会自动提交、推送，别的电脑上的改动自动合进来，每次改动都有历史可查。'),
        node('div', { class: 'row' }, url, start),
        !info.available ? node('p', { class: 'sync-error' }, '这台电脑还没有安装 git：sudo apt install git')
          : info.nested ? node('p', { class: 'sync-error' }, '这个文件夹已经由外面的 git 仓库管着，不能再单独同步。')
          : message ? node('p', { class: 'sync-error' }, message)
          : node('p', { class: 'sync-fine' }, '这台电脑要已经能用 git 访问这个仓库（配好 SSH key，或者 gh auth login）。别的 git 服务、U 盘或 NAS 上的裸仓库也可以。')),
      node('div', { class: 'sync-card' },
        node('h3', {}, lineIcon('cloud'), '同步盘（Dropbox、坚果云、Syncthing…）'),
        node('p', {}, '把笔记库放进同步盘的文件夹，由它来同步，BetterMD 不用设置。'),
        node('div', { class: 'row' }, node('span', { class: 'sync-path' }, info.root), node('span', { class: 'spacer' }),
          node('button', { class: 'secondary', onclick: () => { dialog.close(); command('library'); } }, '选择笔记库位置…'))),
      node('form', { method: 'dialog' }, closeButton));
  };
  draw();
  if (!dialog.open) dialog.showModal();
}

// ---- 命令 ----

function moveNote(id, folder) {
  return perform(async () => {
    if (!byId.has(id) || folderOf(id) === folder) return;
    if (id === selected) window.bettermd?.prepareToLeave();
    await flushEditor();
    const wasSelected = id === selected, oldFolder = folderOf(id), next = await rpc('move', { id, folder });
    if (wasSelected) selected = next;
    notice(`已移到「${folder ? folder.split('/').pop() : '未分类'}」`, { undo: () => moveNote(next, oldFolder) });
  });
}

function setFocusMode(on) {
  focusMode = on;
  document.body.classList.toggle('focus-mode', on);
  $('[data-command="focus"]').classList.toggle('on', on);
  window.bettermd?.setFocusMode(on);
  if (on) window.bettermd?.focus();
}

function command(name, target = selected) {
  if (name.startsWith('format:')) { window.bettermd?.format(name.slice(7)); return; }
  if (name.startsWith('scope:')) return setScope(name.slice(6));
  if (name === 'search') { setFocusMode(false); document.body.classList.remove('sidebar-hidden'); $('#search').focus(); $('#search').select(); return; }
  if (name === 'focus') { setFocusMode(!focusMode); return; }
  if (name === 'sidebar') { if (focusMode) setFocusMode(false); else document.body.classList.toggle('sidebar-hidden'); return; }
  if (name === 'help') { if (!$('#help-dialog').open) $('#help-dialog').showModal(); return; }
  if (name === 'about') { notice(`BetterMD ${version} · Ubuntu 桌面版 · 笔记就是你磁盘上的 Markdown 文件`); return; }
  if (name === 'sync') { openSync(); return; }
  if (name === 'syncNow') { if (!sync.enabled) openSync(); else rpc('syncNow').catch(fail); return; }
  if (name.startsWith('theme:')) { rpc('theme', { value: name.slice(6) }).catch(fail); return; }
  if (name === 'revealLibrary') { rpc('reveal', {}).catch(fail); return; }
  if (name === 'folder') {
    // 在侧栏里就地起名：建在指定的文件夹里；没指定时，正看着某个文件夹就建在它里面
    const parent = typeof target === 'string' && (target === '' || model.folders.includes(target)) ? target : scope.kind === 'folder' ? scope.id : '';
    setFocusMode(false); document.body.classList.remove('sidebar-hidden');
    if (parent) { collapsed.delete(`folder:${parent}`); store.set('collapsed', [...collapsed]); }
    naming = { parent }; renderNavigation(); return;
  }
  if (name === 'move') {
    if (!target || byId.get(target)?.trashed) return;
    pickFolder(folderOf(target)).then(folder => { if (folder !== null) moveNote(target, folder); });
    return;
  }
  return perform(async () => {
    switch (name) {
      case 'new':
        await finalizeCurrent();
        selected = await rpc('create', { folder: scope.kind === 'folder' ? scope.id : '', tag: scope.kind === 'tag' ? scope.id : '' });
        if (scope.kind === 'trash' || scope.kind === 'todo') scope = { kind: 'all', id: '' };
        query = ''; hits = null; tagFilter = ''; $('#search').value = '';
        // 清单随后就到：等它到了再把新笔记放进编辑器、选中标题
        for (let i = 0; i < 60 && !byId.has(selected); i++) await new Promise(resolve => setTimeout(resolve, 15));
        renderList(); await showNote(true); $('#note-list').scrollTop = 0; break;
      case 'library': await finalizeCurrent(); await rpc('chooseLibrary'); break;
      case 'save': await flushEditor(); setSaveState('已保存'); break;
      case 'refresh': await flushEditor(); await rpc('refresh'); break;
      case 'pin': if (target) { await flushEditor(); await rpc('pin', { id: target }); } break;
      case 'trash': if (target && byId.has(target) && !byId.get(target).trashed) {
        if (target === selected) window.bettermd?.prepareToLeave();
        await flushEditor(); const id = await rpc('trash', { id: target });
        if (target === selected) selected = null;
        notice('已移到废纸篓', { undo: () => command('restore', id) });
      } break;
      case 'restore': if (target && byId.get(target)?.trashed) {
        await flushEditor(); const id = await rpc('restore', { id: target });
        scope = folderOf(id) ? { kind: 'folder', id: folderOf(id) } : { kind: 'unfiled', id: '' }; tagFilter = ''; selected = id;
      } break;
      case 'purge': if (target && await rpc('purge', { id: target }) && target === selected) selected = null; break;
      case 'emptyTrash': if (await rpc('purge', {})) notice('废纸篓已清空'); break;
      case 'deleteFolder': {
        await finalizeCurrent();
        const result = await rpc('deleteFolder', { id: target });
        if (scope.kind === 'folder' && (scope.id === target || scope.id.startsWith(target + '/'))) { scope = { kind: 'all', id: '' }; selected = null; }
        const name = target.split('/').pop();
        notice(result.removed ? `已删除文件夹「${name}」${result.trashed.length ? `，${result.trashed.length} 篇笔记在废纸篓里` : ''}` : `「${name}」里的 ${result.trashed.length} 篇笔记已移到废纸篓；文件夹里还有别的文件，留着没删`,
          result.trashed.length ? { undo: () => perform(async () => { await rpc('restoreMany', { ids: result.trashed }); }) } : {});
        break;
      }
      case 'copyPath': if (target) { await rpc('copyPath', { id: target }); notice('已复制文件路径'); } break;
      case 'reveal': await rpc('reveal', { id: target }); break;
      case 'attach': if (selected) {
        const id = selected, items = await rpc('chooseAttachments', { id });
        if (selected === id) window.bettermd.insertAttachments(items);
      } break;
      case 'close': window.bettermd?.prepareToLeave(); await flushEditor(false); await rpc('closed'); break;
    }
  });
}

// ---- 编辑器 → 外壳 ----

window.bettermdDesktop = {
  post(message) {
    if (message.type === 'ready') {
      return rpc('ready').then(data => {
        initialized = true;
        sync = data.sync; version = data.version; renderSync();
        document.body.classList.toggle('framed', !data.frameless);
        applySnapshot(data);
        for (const text of data.notices ?? []) notice(text, { sticky: true });
      }).catch(fail);
    }
    if (message.type === 'change') {
      setSaveState('正在保存…');
      const request = rpc('change', message).then(() => {
        if ((failedChanges.get(message.id)?.seq ?? Infinity) <= message.seq) failedChanges.delete(message.id);
      }).catch(error => {
        if (!failedChanges.has(message.id) || failedChanges.get(message.id).seq < message.seq) failedChanges.set(message.id, message);
        setSaveState('没存下', true); fail(error);
      }).finally(() => pending.delete(request));
      pending.add(request); return request;
    }
    if (message.type === 'attach') return rpc('attach', message).catch(error => { fail(error); return null; });
    if (message.type === 'tag') { setScope('tag', message.name); return Promise.resolve(null); }
    if (message.type === 'exitFocus') { setFocusMode(false); return Promise.resolve(null); }
    if (message.type === 'focusList') { setFocusMode(false); $('#note-list').focus(); return Promise.resolve(null); }
    if (message.type === 'open') return rpc('open', message).then(result => { if (result?.id) { scope = { kind: 'all', id: '' }; return selectNote(result.id); } }).catch(fail);
    return Promise.resolve(null);
  },
};

window.desktop.onEvent(message => {
  if (message.type === 'snapshot') applySnapshot(message.data);
  if (message.type === 'notice') notice(message.text, { sticky: true });
  if (message.type === 'command') command(message.name);
  if (message.type === 'saved') setSaveState('已保存');
  if (message.type === 'saveFailed') setSaveState('没存下', true);
  if (message.type === 'sync') { sync = message.status; renderSync(); }
});

// ---- 鼠标和键盘 ----

for (const el of document.querySelectorAll('[data-icon]')) el.prepend(lineIcon(el.dataset.icon));

document.addEventListener('click', event => {
  const button = event.target.closest('[data-command]'); if (button) command(button.dataset.command);
  if (!event.target.closest('#popover, #format-button, #more-button')) $('#popover').hidden = true;
});
$('#sync-button').addEventListener('click', () => openSync());
$('#menu-button').addEventListener('click', event => { const rect = event.currentTarget.getBoundingClientRect(); rpc('menu', { x: rect.left, y: rect.top - 4 }).catch(fail); });
$('#format-button').addEventListener('click', () => { if ($('#popover').hidden || !$('#popover').classList.contains('format-panel')) showFormatPanel(); else $('#popover').hidden = true; });
$('#more-button').addEventListener('click', event => {
  const note = byId.get(selected); if (!note) return;
  const rect = event.currentTarget.getBoundingClientRect(); showNoteMenu(rect.right - 216, rect.bottom + 6, note, 'top right');
});
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('mousedown', event => {
  const r = dialog.getBoundingClientRect(); // 点在对话框外面（背景上）就关掉
  if (event.target === dialog && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)) dialog.close();
});

let composingSearch = false;
function runSearch() {
  const token = ++searchToken, text = query;
  if (!text.trim()) { hits = null; return; }
  rpc('search', { query: text }).then(result => {
    if (token !== searchToken) return; // 又打了字，这次的结果过时了
    hits = new Map(result.map(h => [h.id, h]));
    limit = PAGE_SIZE; renderList();
  }).catch(fail);
}
function searchChanged() {
  query = $('#search').value;
  if (query.trim()) { $('#search-clear').hidden = false; runSearch(); }
  else { searchToken++; hits = null; searchAll = false; limit = PAGE_SIZE; renderList(); }
}
$('#search').addEventListener('compositionstart', () => { composingSearch = true; });
$('#search').addEventListener('compositionend', () => { composingSearch = false; searchChanged(); });
$('#search').addEventListener('input', () => { if (!composingSearch) searchChanged(); });
$('#search').addEventListener('keydown', event => {
  if (event.isComposing) return;
  if (event.key === 'Escape') { event.stopPropagation(); $('#search').value = ''; searchChanged(); $('#note-list').focus(); }
  if (event.key === 'Enter' || event.key === 'ArrowDown') { event.preventDefault(); const note = visibleNotes()[0]; if (note) selectNote(byId.has(selected) && visibleNotes().some(n => n.id === selected) ? selected : note.id).then(() => $('#note-list').focus()); }
});
$('#search-clear').addEventListener('click', () => { $('#search').value = ''; searchChanged(); $('#search').focus(); });
$('#search-scope').addEventListener('click', () => { searchAll = !searchAll; limit = PAGE_SIZE; renderList(); });
$('#note-list').addEventListener('scroll', event => {
  const list = event.currentTarget;
  if (list.scrollTop + list.clientHeight > list.scrollHeight - 600 && limit < visibleNotes().length) { limit += PAGE_SIZE; renderList(); }
});
$('#note-list').addEventListener('keydown', event => {
  if (event.isComposing) return;
  const notes = visibleNotes(), at = notes.findIndex(n => n.id === selected);
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault(); const next = notes[Math.max(0, Math.min(notes.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))];
    if (next && next.id !== selected) selectNote(next.id).then(() => { $('#note-list').focus(); revealCard(selected); });
  } else if (event.key === 'Enter' || event.key === 'ArrowRight') { event.preventDefault(); window.bettermd?.focus(); }
  else if (event.key === 'ArrowLeft') { event.preventDefault(); if (!document.body.classList.contains('sidebar-hidden')) focusNav(); }
  else if (!event.ctrlKey && !event.altKey && !event.metaKey && event.key.length === 1 && event.key !== ' ') { $('#search').focus(); } // 这个键交给搜索框：中文输入法从第一个键就能拼字
});
$('#note-list').addEventListener('mousedown', event => { if (event.target.closest('.note-card')) $('#note-list').focus(); });
$('#sidebar').addEventListener('keydown', event => {
  if (event.isComposing || event.target.closest('input') || !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(event.key)) return;
  const row = event.target.closest('button.nav-row') ?? document.querySelector('#sidebar .nav-row.active'); if (!row) return;
  event.preventDefault();
  const n = navOf(row), rows = navRows(), expandable = !!n.spec.children?.length, open = n.group.classList.contains('expanded');
  const go = target => { if (target) setScope(navOf(target).spec.kind, navOf(target).spec.id).then(() => navOf(target)?.row.focus()); };
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') go(rows[rows.indexOf(row) + (event.key === 'ArrowDown' ? 1 : -1)]);
  else if (event.key === 'ArrowRight' && expandable && !open) toggleCollapsed(n.spec.key);
  else if (event.key === 'ArrowLeft' && expandable && open) toggleCollapsed(n.spec.key);
  else if (event.key === 'ArrowLeft') go(row.parentElement.parentElement.closest('.nav-group')?.querySelector(':scope > button.nav-row'));
  else $('#note-list').focus();
});
// 外壳自己的快捷键在这里认，不靠菜单栏：菜单栏平时收着，这样不管系统怎么处理收起来的菜单，键都好用。
// 编辑器已经用掉的键（它会 preventDefault）不再处理；这里处理过的键也不会再传给菜单，不会做两遍。
const KEYS = { 'ctrl+n': 'new', 'ctrl+o': 'library', 'ctrl+w': 'close', 'ctrl+q': 'close', 'ctrl+shift+f': 'search', 'ctrl+shift+p': 'pin', 'ctrl+shift+m': 'move', 'ctrl+shift+r': 'restore',
  'ctrl+shift+d': 'focus', 'ctrl+alt+s': 'sidebar', 'ctrl+/': 'help', 'ctrl+alt+1': 'scope:all', 'ctrl+alt+2': 'scope:unfiled', 'ctrl+alt+3': 'scope:todo', 'ctrl+alt+0': 'scope:trash',
  'ctrl+shift+v': 'attach', 'ctrl+=': 'zoom:1', 'ctrl+shift+=': 'zoom:1', 'ctrl+-': 'zoom:-1' };
function shortcut(event) {
  if (!event.ctrlKey || event.metaKey) return null;
  // 按键位认（event.code），不受输入法和键盘布局影响
  const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3).toLowerCase() : /^Digit\d$/.test(event.code) ? event.code.slice(5) : ({ Slash: '/', Equal: '=', Minus: '-' })[event.code];
  return key ? KEYS[`ctrl+${event.altKey ? 'alt+' : ''}${event.shiftKey ? 'shift+' : ''}${key}`] ?? null : null;
}
document.addEventListener('keydown', event => {
  if (event.isComposing) return;
  const name = event.defaultPrevented ? null : shortcut(event);
  // 对话框开着时只认关窗口；在输入框里 Ctrl+Shift+V 仍是粘贴成纯文字
  if (name && (!event.target.closest('dialog') || name === 'close') && !(name === 'attach' && event.target.closest('input'))) {
    event.preventDefault();
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    if (name.startsWith('zoom:')) rpc('zoom', { delta: Number(name.slice(5)) }).catch(fail); else command(name);
    return;
  }
  if (event.target.closest('dialog')) return;
  if (event.key === 'Escape') { if (!$('#popover').hidden) $('#popover').hidden = true; else if (focusMode) setFocusMode(false); }
  if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key === 's') { event.preventDefault(); command('save'); }
  if (event.ctrlKey && event.key === 'Backspace' && !event.target.closest('input, textarea, [contenteditable]')) { event.preventDefault(); command('trash'); }
  if (event.key === 'F2' && scope.kind === 'folder' && event.target.closest('#sidebar')) { naming = { id: scope.id }; renderNavigation(); }
});
// 过了半夜，“今天”变“昨天”：每分钟看一眼列表上的时间
setInterval(() => { if (initialized && !busy) { renderList(); showNote(); } }, 60000);

const shortcuts = [
  ['新建笔记', 'Ctrl N'], ['搜索笔记', 'Ctrl Shift F'], ['在这篇里查找 / 替换', 'Ctrl F / Ctrl Alt F'], ['置顶', 'Ctrl Shift P'], ['移动到文件夹', 'Ctrl Shift M'],
  ['移到废纸篓 / 放回原处', 'Ctrl ⌫ / Ctrl Shift R'], ['我的笔记、未分类、待办、废纸篓', 'Ctrl Alt 1 2 3 0'], ['从列表进正文 / 回到列表', '↩ / Ctrl ↩'], ['专注模式', 'Ctrl Shift D'], ['显示或隐藏侧栏', 'Ctrl Alt S'],
  ['粗体 / 斜体 / 删除线', 'Ctrl B / Ctrl I / Ctrl Shift U'], ['行内代码 / 链接', 'Ctrl Alt C / Ctrl K'], ['一到六级标题 / 正文', 'Ctrl 1…6 / Ctrl 0'], ['列表 / 编号列表', 'Ctrl L / Ctrl Shift L'], ['待办 / 勾上', 'Ctrl T / Ctrl .'],
  ['引用', 'Ctrl Shift T'], ['代码块 / 表格 / 公式', 'Ctrl Shift C / Ctrl Alt T / Ctrl Shift E'], ['插入图片或文件', 'Ctrl Shift V'], ['折叠这一节', "Ctrl '"], ['点链接、标签', 'Ctrl 点击'],
];
$('#shortcut-list').replaceChildren(...shortcuts.map(([label, keys]) => node('div', { class: 'shortcut' }, node('span', {}, label),
  node('span', {}, keys.split(' / ').flatMap((combo, i) => [i ? ' ' : null, node('kbd', {}, combo)])))));
renderSync();
