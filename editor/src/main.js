// BetterMD 编辑器入口：在 WKWebView 里跑的 CodeMirror 6，Markdown 原地渲染，公式用 KaTeX。
// App 通过 window.bettermd 放进笔记；编辑器把改动、粘贴的图片等通过 bridge.post 告诉 App。
import 'katex/dist/katex.min.css';
import './editor.css';
import { EditorState, EditorSelection, Compartment, Annotation, Transaction } from '@codemirror/state';
import { EditorView, keymap, drawSelection, dropCursor, placeholder } from '@codemirror/view';
import { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage, markdownKeymap } from '@codemirror/lang-markdown';
import {
  syntaxHighlighting, HighlightStyle, codeFolding, foldKeymap, foldable, foldedRanges, foldEffect, unfoldEffect,
} from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { mathSyntax } from './math.js';
import { codeLanguages } from './languages.js';
import {
  livePreview, mathTooltip, focusState, focusTracker, dirState, setDir, setFocus, metaState, setMeta, focusModeState, setFocusMode,
  wordCountState,
} from './livePreview.js';
import { toggleWrap, insertLink, insertMath, setHeading, toggleTodo, toggleLinePrefix, toggleList, insertBlock } from './commands.js';
import { countParagraphs } from './helpers.js';
import { post } from './bridge.js';

// 文字的颜色和字形；字号、行距这些在 editor.css 里
const inkStyle = HighlightStyle.define([
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', textDecorationColor: 'var(--text-3)' },
  { tag: t.link, color: 'var(--accent)' },
  { tag: t.url, color: 'var(--text-3)' },
  { tag: t.monospace, fontFamily: 'var(--font-mono)' },
  { tag: t.processingInstruction, color: 'var(--marker)' },
  { tag: t.contentSeparator, color: 'var(--marker)' },
  { tag: t.labelName, color: 'var(--text-3)' },
  { tag: t.quote, color: 'var(--text-2)' },
  // 代码块
  { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword, t.definitionKeyword], color: 'var(--c-kw)' },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], color: 'var(--c-str)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--c-num)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--c-com)', fontStyle: 'italic' },
  { tag: [t.typeName, t.className, t.namespace, t.tagName], color: 'var(--c-type)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: 'var(--c-fn)' },
  { tag: [t.attributeName, t.propertyName], color: 'var(--c-fn)' },
  { tag: t.meta, color: 'var(--text-3)' },
  { tag: t.invalid, color: 'var(--accent)' },
]);

const formatKeys = [
  { key: 'Escape', run: () => { if (!focusMode) return false; post({ type: 'exitFocus' }); return true; } },
  { key: 'Mod-b', run: toggleWrap('**') },
  { key: 'Mod-i', run: toggleWrap('*') },
  { key: 'Mod-Shift-x', run: toggleWrap('~~') },
  { key: 'Mod-e', run: toggleWrap('`') },
  { key: 'Mod-k', run: insertLink },
  { key: 'Mod-Shift-e', run: insertMath },
  { key: 'Mod-Shift-t', run: toggleTodo },
  { key: 'Mod-1', run: setHeading(1) },
  { key: 'Mod-2', run: setHeading(2) },
  { key: 'Mod-3', run: setHeading(3) },
  { key: 'Mod-0', run: setHeading(0) },
];

// 折叠起来的一节显示成“N 段”
const folding = codeFolding({
  preparePlaceholder: (state, range) => countParagraphs(state.sliceDoc(range.from, range.to)),
  placeholderDOM(view, onclick, count) {
    const badge = document.createElement('span');
    badge.className = 'cm-fold-badge';
    badge.textContent = `${count} 段`;
    badge.title = '展开';
    badge.addEventListener('mousedown', e => { e.preventDefault(); onclick(e); });
    return badge;
  },
});

// 中文输入法里 Shift+4 打出的是 ￥：连打两个 ￥ 就换成 $$（公式块的开头）。单个 ￥ 是价钱，不动。
const yuanToDollars = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== '￥' || view.state.readOnly || view.state.sliceDoc(from - 1, from) !== '￥') return false;
  view.dispatch({ changes: { from: from - 1, to, insert: '$$' }, selection: { anchor: from + 1 }, userEvent: 'input.type' });
  return true;
});

/** 从 App 来的改动，不用再告诉 App。 */
const fromApp = Annotation.define();
const readOnly = new Compartment();
const readOnlyConfig = on => [EditorState.readOnly.of(on), EditorView.editable.of(!on)];

const extensions = [
  history(),
  drawSelection(),
  dropCursor(),
  EditorView.lineWrapping,
  // 不要下标、上标语法：中文里“3~5 次”这种范围写法会被当成下标
  markdown({ base: markdownLanguage, codeLanguages, extensions: [mathSyntax, { remove: ['Subscript', 'Superscript'] }], addKeymap: false }),
  wordCountState,
  EditorView.updateListener.of(movePendingInserts),
  syntaxHighlighting(inkStyle),
  focusState, focusTracker, dirState, metaState, focusModeState, livePreview, mathTooltip, folding,
  placeholder('开始写…'),
  yuanToDollars,
  // ⌘/ 留给 App 的「键盘快捷键」，不要默认的“切换注释”
  keymap.of([...formatKeys, ...markdownKeymap, ...foldKeymap, ...defaultKeymap.filter(b => b.key !== 'Mod-/'), ...historyKeymap, indentWithTab]),
  EditorView.updateListener.of(onUpdate),
  EditorView.domEventHandlers({ mousedown: onMouseDown, paste: onPaste, drop: onDrop, compositionend: onCompositionEnd }),
];

function makeState(text, dir, ro, meta = null) {
  return EditorState.create({
    doc: text,
    extensions: [
      extensions, readOnly.of(readOnlyConfig(ro)), dirState.init(() => dir), metaState.init(() => meta),
      focusModeState.init(() => focusMode),
    ],
  });
}

/** 专注模式开着吗（换笔记时带到新的编辑器状态里）。 */
let focusMode = false;

const host = document.getElementById('editor');
const view = new EditorView({ state: makeState('', '', true), parent: host });
let current = { id: null, dir: '', readOnly: true };
/** 每篇笔记离开时的光标和滚动位置；回来时正文没变就恢复。 */
const memory = new Map();

// ---- 编辑器 → App ----

/** 发出去的改动的编号。App 放内容进来时带上它收到的最大编号，编辑器据此判断那份内容是不是过时了。 */
let sentSeq = 0;
/** 输入法拼字期间改了正文、还没发出去。 */
let pendingWhileComposing = false;

function onUpdate(update) {
  if (!current.id) return;
  const typed = update.transactions.some(tr => tr.docChanged && !tr.annotation(fromApp));
  // 中文输入法还在拼的时候先不发，选完字再发，免得把拼音存进文件
  if (update.view.composing) {
    if (typed) pendingWhileComposing = true;
    return;
  }
  if (typed || pendingWhileComposing) sendText();
}

function onCompositionEnd() {
  // 选完字以后 CodeMirror 才把最后的文字写进正文，等它一下
  setTimeout(flushComposing);
}

/** 拼字期间攒下的改动，拼完了就发出去。 */
function flushComposing() {
  if (pendingWhileComposing && !view.composing) sendText();
}

function sendText() {
  pendingWhileComposing = false;
  if (!current.id) return;
  sentSeq += 1;
  post({ type: 'change', id: current.id, text: view.state.doc.toString(), seq: sentSeq });
}

// ---- App → 编辑器 ----

/**
 * 打开一篇笔记，或者把正在编辑的这篇换成 App 那边的最新内容（比如在别的程序里改过）。
 * options：dir 所在文件夹，readOnly 只读，selectTitle 选中标题，seq App 收到的最大改动编号。
 */
function setDocument(id, rawText, options = {}) {
  const text = normalize(rawText);
  const dir = options.dir ?? '';
  const ro = !!options.readOnly;
  const meta = options.meta ?? null;
  flushComposing();
  if (id === current.id) {
    updateDocument(text, dir, ro, options.seq, meta);
    return;
  }
  // 先建好新笔记的编辑器状态；换的过程中 current 不指向任何笔记，万一出错，打的字也不会记到别的笔记上
  const state = makeState(text, dir, ro, meta);
  remember();
  current = { id: null, dir: '', readOnly: true };
  view.setState(state);
  syncFocus();
  current = { id, dir, readOnly: ro };
  const saved = memory.get(id);
  if (saved && saved.text === text) {
    view.dispatch({ selection: EditorSelection.fromJSON(saved.selection), effects: saved.scroll });
  } else if (options.selectTitle) {
    const first = view.state.doc.line(1);
    const start = first.from + (/^#{1,6}\s+/.exec(first.text)?.[0].length ?? 0);
    view.dispatch({ selection: { anchor: start, head: first.to } });
    view.focus();
    syncFocus();
  }
  host.classList.remove('enter');
  void host.offsetWidth;
  host.classList.add('enter');
}

/** 同一篇笔记，App 那边有了新内容。 */
function updateDocument(text, dir, ro, seq, meta) {
  const effects = [];
  if (dir !== current.dir) effects.push(setDir.of(dir));
  const oldMeta = view.state.field(metaState);
  if (JSON.stringify(oldMeta) !== JSON.stringify(meta)) effects.push(setMeta.of(meta));
  if (ro !== current.readOnly) effects.push(readOnly.reconfigure(readOnlyConfig(ro)));
  const old = view.state.doc.toString();
  // App 是在收到我们最新的改动之前做的这份内容：刚打的字比它新，不能被盖掉。
  // 这时只更新文件夹和只读状态，再把正文重发一遍，让 App 以编辑器里的为准。
  // 中文输入法正在拼字时也一样：动了正文会打断输入法，拼完再把正文发过去。
  const composing = view.composing;
  const stale = composing || (typeof seq === 'number' && seq < sentSeq);
  const changes = stale || old === text ? [] : [minimalChange(old, text)];
  if (changes.length || effects.length) {
    view.dispatch({ changes, effects, annotations: [fromApp.of(true), Transaction.addToHistory.of(false)] });
  }
  current = { ...current, dir, readOnly: ro };
  if (stale && old !== text) {
    if (composing) pendingWhileComposing = true;
    else sendText();
  }
}

/** CodeMirror 里只有 \n 一种换行；Windows 的 \r\n 先换掉，不然对比内容时会多出空行。 */
const normalize = text => String(text ?? '').replace(/\r\n?/g, '\n');

/** 只替换真正变了的那一段，光标和滚动位置不乱跳。 */
function minimalChange(a, b) {
  let start = 0;
  const max = Math.min(a.length, b.length);
  while (start < max && a.charCodeAt(start) === b.charCodeAt(start)) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a.charCodeAt(endA - 1) === b.charCodeAt(endB - 1)) { endA--; endB--; }
  return { from: start, to: endA, insert: b.slice(start, endB) };
}

/** 记住这篇笔记的光标和滚动位置，回来时正文没变就恢复。 */
function remember() {
  if (!current.id) return;
  memory.set(current.id, {
    text: view.state.doc.toString(), selection: view.state.selection.toJSON(), scroll: view.scrollSnapshot(),
  });
}

/** 没有选中笔记时：清空，只读。 */
function clear() {
  flushComposing();
  remember();
  current = { id: null, dir: '', readOnly: true };
  view.setState(makeState('', '', true));
  syncFocus();
}

/**
 * 新建的编辑器状态里默认“没有焦点”。编辑器本来就有焦点时（比如边打字边按 ⌘N），
 * 不会再收到获得焦点的事件，要自己补上；不然排版会以为没在编辑，
 * 把光标所在的公式块换成排好的公式，接着打的字就跑到别处去了。
 */
function syncFocus() {
  if (view.state.field(focusState) !== view.hasFocus) view.dispatch({ effects: setFocus.of(view.hasFocus) });
}

// ---- 鼠标：⌘ 点链接或标签、点小标题左边的箭头折叠 ----

function onMouseDown(event, v) {
  if (event.button !== 0) return false;
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return false;
  const link = target.closest('[data-url], [data-path]');
  if (link && (event.metaKey || v.state.readOnly)) {
    event.preventDefault();
    post({ type: 'open', url: link.dataset.url ?? null, path: link.dataset.path ?? null });
    return true;
  }
  const tag = target.closest('.cm-tag');
  if (tag && event.metaKey) {
    event.preventDefault();
    post({ type: 'tag', name: tag.dataset.tag });
    return true;
  }
  const heading = target.closest('.cm-foldable');
  if (heading && !target.closest('.cm-hmark') && event.clientX < heading.getBoundingClientRect().left) {
    event.preventDefault();
    toggleSection(v, v.posAtDOM(heading));
    return true;
  }
  return false;
}

function toggleSection(v, pos) {
  const line = v.state.doc.lineAt(pos);
  let open = null;
  foldedRanges(v.state).between(line.to, line.to + 1, (from, to) => { if (from === line.to) open = { from, to }; });
  if (open) {
    v.dispatch({ effects: unfoldEffect.of(open) });
  } else {
    const range = foldable(v.state, line.from, line.to);
    if (range) v.dispatch({ effects: foldEffect.of(range) });
  }
}

// ---- 粘贴、拖进来的图片和文件：交给 App 存进「附件」，再插入链接 ----

function onPaste(event, v) {
  const data = event.clipboardData;
  const files = [...(data?.files ?? [])];
  if (!files.length || v.state.readOnly) return false;
  // 从 Word、Pages 复制文字时，剪贴板里还会附带一张文字的截图：有正经文字就贴文字（单独一个网址除外）
  const text = data.getData('text/plain').trim();
  if (text && !/^\S+:\/\/\S+$/.test(text)) return false;
  event.preventDefault();
  insertFiles(v, files, v.state.selection.main);
  return true;
}

function onDrop(event, v) {
  host.classList.remove('is-dropping');
  dragDepth = 0;
  const files = [...(event.dataTransfer?.files ?? [])];
  if (!files.length || v.state.readOnly) return false;
  event.preventDefault();
  let pos = v.posAtCoords({ x: event.clientX, y: event.clientY }) ?? v.state.selection.main.head;
  // 拖放的位置不精确：落在一行文字中间时，放到这一行后面，不把句子拆开
  const line = v.state.doc.lineAt(pos);
  if (pos > line.from && pos < line.to) pos = line.to;
  insertFiles(v, files, EditorSelection.cursor(pos));
  return true;
}

// 拖文件进来：整个编辑区（包括正文两边的空白）都能放下，并显示虚线提示框。
// CodeMirror 只在正文上监听拖放，也不会主动接受文件，所以在整个页面上处理。
let dragDepth = 0;
const draggingFiles = event => !view.state.readOnly && !!event.dataTransfer?.types.includes('Files');
document.addEventListener('dragenter', event => {
  if (!draggingFiles(event)) return;
  dragDepth++;
  host.classList.add('is-dropping');
});
document.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) host.classList.remove('is-dropping');
});
document.addEventListener('dragover', event => {
  if (!draggingFiles(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});
document.addEventListener('drop', event => {
  if (view.contentDOM.contains(event.target)) return; // 正文里的由 onDrop 处理
  event.preventDefault();
  onDrop(event, view);
});

/** 正在等 App 存附件的插入点。等的时候还能接着打字，插入点跟着正文的改动挪，存好时插在挪过以后的位置。 */
const pendingInserts = new Set();

function movePendingInserts(update) {
  if (!update.docChanged) return;
  for (const pending of pendingInserts) pending.pos = update.changes.mapPos(pending.pos, -1);
}

async function insertFiles(v, files, range) {
  const id = current.id;
  // 选中的字马上删掉（和普通粘贴一样），只记下插入点
  if (range.from !== range.to) {
    v.dispatch({ changes: { from: range.from, to: range.to }, selection: { anchor: range.from }, userEvent: 'input.paste' });
  }
  const pending = { pos: range.from };
  pendingInserts.add(pending);
  try {
    const items = [];
    for (const file of files) {
      const data = await readBase64(file);
      const reply = await post({ type: 'attach', id, name: file.name, mime: file.type, data });
      if (reply?.link) items.push({ link: reply.link, name: file.name, image: file.type.startsWith('image/') });
    }
    if (current.id !== id || !items.length) return;
    insertAttachments(items, EditorSelection.cursor(pending.pos));
  } finally {
    pendingInserts.delete(pending);
  }
}

function readBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** 在 range 处插入附件链接：图片各占一行，别的文件写成普通链接。 */
function insertAttachments(items, range = view.state.selection.main) {
  if (view.state.readOnly) return;
  const doc = view.state.doc;
  const from = Math.min(range.from, doc.length), to = Math.min(range.to, doc.length);
  const text = items.map(item => {
    const label = item.image ? '' : item.name.replace(/[[\]]/g, '');
    return (item.image ? '!' : '') + `[${label}](${item.link})`;
  }).join(items.every(i => i.image) ? '\n' : ' ');
  const line = doc.lineAt(from);
  const block = items.some(i => i.image);
  const before = block && doc.sliceString(line.from, from).trim() !== '' ? '\n' : '';
  const after = block && doc.sliceString(to, doc.lineAt(to).to).trim() !== '' ? '\n' : '';
  const insert = before + text + after;
  // 光标还在插入点（没在等的时候接着打字）就放到附件后面；否则光标留在原处
  const cursorHere = view.state.selection.main.empty && view.state.selection.main.head === from;
  view.dispatch({
    changes: { from, to, insert },
    selection: cursorHere ? { anchor: from + insert.length } : undefined,
    userEvent: 'input.paste',
    scrollIntoView: cursorHere,
  });
  view.focus();
}

const TABLE = '| 列 1 | 列 2 |\n| --- | --- |\n|  |  |';

/** 格式面板（Aa）里的按钮。 */
const FORMATS = {
  heading: setHeading(2),
  bold: toggleWrap('**'),
  italic: toggleWrap('*'),
  strike: toggleWrap('~~'),
  code: toggleWrap('`'),
  link: insertLink,
  list: toggleList('bullet'),
  numbered: toggleList('number'),
  todo: toggleTodo,
  quote: toggleLinePrefix('> '),
  rule: insertBlock('---\n', 4),
  codeBlock: insertBlock('```\n\n```', 4),
  table: insertBlock(TABLE, TABLE.lastIndexOf('\n') + 3), // 光标在第一个空格子里
  math: view => insertMath(view),
};

function format(kind) {
  const run = FORMATS[kind];
  if (!run || view.state.readOnly) return;
  view.focus();
  run(view);
}

/** 专注模式：其他段落变淡；Esc 退出（交给 App 一起把侧栏和列表放回来）。 */
function setFocusModeOn(on) {
  focusMode = !!on;
  host.classList.toggle('is-focus-mode', focusMode);
  view.dispatch({ effects: setFocusMode.of(focusMode) });
}

window.bettermd = {
  setDocument,
  clear,
  format,
  setFocusMode: setFocusModeOn,
  insertAttachments: items => insertAttachments(items),
  focus: () => view.focus(),
  view,
};

post({ type: 'ready' });
