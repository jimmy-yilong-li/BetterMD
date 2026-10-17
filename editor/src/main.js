// BetterMD 编辑器入口：在 WKWebView 里跑的 CodeMirror 6，Markdown 原地渲染，公式用 KaTeX。
// App 通过 window.bettermd 放进笔记；编辑器把改动、粘贴的图片等通过 bridge.post 告诉 App。
import 'katex/dist/katex.min.css';
import './editor.css';
import { EditorState, EditorSelection, Compartment, Annotation, Transaction } from '@codemirror/state';
import { EditorView, keymap, drawSelection, dropCursor, placeholder } from '@codemirror/view';
import {
  history, historyKeymap, defaultKeymap, indentWithTab, moveLineUp, moveLineDown, indentMore, indentLess,
} from '@codemirror/commands';
import { search, openSearchPanel, closeSearchPanel, findNext, findPrevious } from '@codemirror/search';
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
import {
  toggleWrap, insertLink, insertMath, setHeading, toggleTodoLines, toggleDone, toggleLinePrefix, toggleList, insertBlock,
  toggleCodeBlock, insertDate, lineKind,
} from './commands.js';
import { countParagraphs, setLibraryBase } from './helpers.js';
import { watchTheme } from './theme.js';
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

// 快捷键照 Bear 的来（见 docs/bear-reference.md）；⇧⌘E 公式、⌘0 变回正文是 BetterMD 自己的。
// 菜单栏的「格式」「编辑」菜单里也有这些命令：编辑器有焦点时按键先到这里，没焦点时才轮到菜单。
const editKeys = [
  // 查找：在查找栏里按也算
  { key: 'Escape', run: closeSearchPanel, scope: 'editor search-panel' },
  { key: 'Mod-f', run: openSearchPanel, scope: 'editor search-panel', preventDefault: true },
  { key: 'Alt-Mod-f', run: openReplace, scope: 'editor search-panel', preventDefault: true },
  { key: 'Mod-g', run: findNext, shift: findPrevious, scope: 'editor search-panel', preventDefault: true },
  // 查找栏输入框里的撤销：VS Code 的网页外壳把浏览器自带的撤销拦掉了，这里自己做
  { key: 'Mod-z', run: () => document.execCommand('undo'), shift: () => document.execCommand('redo'), scope: 'search-panel' },
  { key: 'Escape', run: () => { if (!focusMode) return false; post({ type: 'exitFocus' }); return true; } },
  // 文字样式
  { key: 'Mod-b', run: toggleWrap('**') },
  { key: 'Mod-i', run: toggleWrap('*') },
  { key: 'Shift-Mod-u', run: toggleWrap('~~') },
  { key: 'Alt-Mod-c', run: toggleWrap('`') },
  { key: 'Mod-k', run: insertLink },
  { key: 'Shift-Mod-e', run: insertMath },
  // 段落
  ...[1, 2, 3, 4, 5, 6].map(n => ({ key: `Mod-${n}`, run: setHeading(n) })),
  { key: 'Mod-0', run: setHeading(0) },
  { key: 'Mod-l', run: toggleList('bullet') },
  { key: 'Shift-Mod-l', run: toggleList('number') },
  { key: 'Mod-t', run: toggleTodoLines },
  { key: 'Mod-.', run: toggleDone },
  { key: 'Shift-Mod-t', run: toggleLinePrefix('> ') },
  { key: 'Ctrl-Mod-c', run: toggleCodeBlock },
  { key: 'Alt-Mod-t', run: v => FORMATS.table(v) },
  // 日期
  { key: 'Shift-Mod-7', run: insertDate('dateTime') },
  { key: 'Shift-Mod-8', run: insertDate('date') },
  { key: 'Shift-Mod-9', run: insertDate('shortDate') },
  { key: 'Shift-Mod-0', run: insertDate('time') },
  // 结构：上下移动行、缩进、折叠
  { key: 'Alt-Mod-ArrowUp', run: moveLineUp },
  { key: 'Alt-Mod-ArrowDown', run: moveLineDown },
  { key: 'Alt-Mod-ArrowRight', run: indentMore },
  { key: 'Alt-Mod-ArrowLeft', run: indentLess },
  { key: "Mod-'", run: v => toggleFoldHere(v) },
];

/** 光标在查找栏里（不在正文里）。 */
const inSearchPanel = v => !!v.dom.querySelector('.cm-panels')?.contains(document.activeElement);

// 在查找栏里打字时，格式快捷键什么都不做：不拦下的话，WKWebView 会把它们交给菜单，菜单又让编辑器去改正文
const formatKeys = [
  ...editKeys.map(b => b.scope ? b : {
    ...b, scope: 'editor search-panel',
    run: v => inSearchPanel(v) || b.run(v),
    shift: b.shift && (v => inSearchPanel(v) || b.shift(v)),
  }),
  { key: 'Shift-Mod-v', run: () => true, scope: 'search-panel' }, // 插入文件也一样
  // ⌘↩：回到笔记列表（在查找栏里 ⌘↩ 是“下一个”，不管）
  { key: 'Mod-Enter', run: () => { post({ type: 'focusList' }); return true; } },
];

/** ⌥⌘F：打开查找栏，光标放进“替换为”（只读的笔记没有替换，就停在查找框里）。 */
function openReplace(v) {
  openSearchPanel(v);
  const focusReplace = () => {
    const field = v.dom.querySelector('.cm-search input[name=replace]');
    if (field) { field.focus(); field.select(); }
  };
  focusReplace();
  setTimeout(focusReplace);
  return true;
}

// 查找栏里的字
const searchPhrases = EditorState.phrases.of({
  'Find': '查找', 'Replace': '替换为', 'next': '下一个', 'previous': '上一个', 'all': '全部选中',
  'match case': '区分大小写', 'regexp': '正则表达式', 'by word': '整词', 'replace': '替换', 'replace all': '全部替换',
  'close': '关闭', 'current match': '当前', 'on line': '行', 'replaced $ matches': '替换了 $ 处',
  'replaced match on line $': '替换了第 $ 行的一处',
});

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
  search({ top: true }), searchPhrases,
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

/** 这次发出去的正文，是不是拒收了 App 送来的另一份内容以后重发的（App 要把那一份另存，不能悄悄丢掉）。 */
let overrodeApp = false;

/** 每篇笔记最后一次发出去的改动编号（重新打开时判断 App 送来的是不是旧内容）。 */
const noteSeq = new Map();

function sendText() {
  pendingWhileComposing = false;
  if (!current.id) return;
  sentSeq += 1;
  noteSeq.set(current.id, sentSeq);
  const message = { type: 'change', id: current.id, text: view.state.doc.toString(), seq: sentSeq };
  if (overrodeApp) message.overrode = true;
  overrodeApp = false;
  post(message);
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
  leaveNote();
  remember();
  // 重新打开一篇：这篇最后发出去的改动 App 还没收到（App 送来的编号比它小），App 给的就是旧内容，
  // 用离开时记下的正文，打开以后重发一遍（和同一篇里的“过时”一样，以编辑器为准）
  const remembered = memory.get(id);
  const stale = typeof options.seq === 'number' && (noteSeq.get(id) ?? 0) > options.seq && remembered && remembered.text !== text;
  // 先建好新笔记的编辑器状态；换的过程中 current 不指向任何笔记，万一出错，打的字也不会记到别的笔记上
  overrodeApp = false;
  const state = makeState(stale ? remembered.text : text, dir, ro, meta);
  current = { id: null, dir: '', readOnly: true };
  view.setState(state);
  syncFocus();
  current = { id, dir, readOnly: ro };
  if (stale) {
    overrodeApp = true;
    sendText();
  }
  const saved = memory.get(id);
  if (saved && saved.text === view.state.doc.toString()) {
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
    overrodeApp = true;
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

/**
 * 离开这篇笔记（换笔记、清空）之前：输入法还在拼字就先让它结束，拼好的字留在这篇里并发出去
 * （不然换过去以后编辑器一直以为在拼字，新笔记里打的字都攒着不发）；等着存的附件作废（不然回来时会插到错的地方）。
 */
function leaveNote() {
  if (view.compositionStarted || view.composing) {
    const refocus = view.hasFocus;
    view.contentDOM.blur();
    view.observer?.flush?.();
    flushComposing();
    if (pendingWhileComposing) sendText();
    if (refocus) view.focus();
  }
  for (const pending of pendingInserts) pending.cancelled = true;
  pendingInserts.clear();
}

/** 没有选中笔记时：清空，只读。 */
function clear() {
  leaveNote();
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

/**
 * ⌘'：折叠或展开光标所在的这一节。光标在小标题或带下级的列表项上，就折它；
 * 在一节的正文里，就折它所在的那一节（光标挪到小标题上，免得被折进去）。
 */
function toggleFoldHere(v) {
  const { state } = v;
  const foldedAt = line => {
    let hit = false;
    foldedRanges(state).between(line.to, line.to + 1, from => { if (from === line.to) hit = true; });
    return hit;
  };
  const canToggle = line => ['heading', 'list'].includes(lineKind(state, line))
    && (foldedAt(line) || foldable(state, line.from, line.to) !== null);
  let line = state.doc.lineAt(state.selection.main.head);
  if (!canToggle(line)) {
    // 往上找最近的、能折的小标题（代码块里的“# 注释”不算）
    let heading = null;
    for (let n = line.number - 1; n >= 1 && !heading; n--) {
      const above = state.doc.line(n);
      if (lineKind(state, above) === 'heading' && canToggle(above)) heading = above;
    }
    if (!heading) return true;
    line = heading;
    v.dispatch({ selection: { anchor: line.to } });
  }
  toggleSection(v, line.from);
  return true;
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
  // 从 Word、Pages 复制文字时，剪贴板里还会附带一张文字的截图：有正经文字就贴文字（单独一个网址除外）。
  // 在 Finder 里复制的文件，剪贴板里的文字只是文件名：那还是贴文件
  const text = data.getData('text/plain').trim();
  const justNames = text.split('\n').every(line => files.some(f => f.name === line.trim() || line.trim().endsWith('/' + f.name)));
  if (text && !justNames && !/^\S+:\/\/\S+$/.test(text)) return false;
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
  event.preventDefault(); // VS Code 的网页外壳看到没人接的拖动，会交给 VS Code 自己（把文件打开），不插进笔记
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

/**
 * 正在等 App 存附件的位置（选中了文字时是一段）。等的时候还能接着打字，这段跟着正文的改动挪，存好时换在挪过以后的地方。
 * 两头往里收：别人在它前后打的字不算进去，存好时不会被一起换掉。
 */
const pendingInserts = new Set();

function movePendingInserts(update) {
  if (!update.docChanged) return;
  for (const pending of pendingInserts) {
    if (pending.from === pending.to) {
      // 粘贴在光标处：在这里接着打的字排在附件后面。选中的字被盖掉以后（follow）：附件跟在打的字后面
      pending.from = pending.to = update.changes.mapPos(pending.from, pending.follow ? 1 : -1);
      continue;
    }
    // 选中的那段被接着打的字盖掉了：附件插在打的字后面，什么都不替换
    let overwritten = false;
    update.changes.iterChangedRanges((fromA, toA) => { if (fromA < pending.to && toA > pending.from) overwritten = true; });
    if (overwritten) {
      pending.from = pending.to = update.changes.mapPos(pending.to, 1);
      pending.follow = true;
    } else {
      pending.from = update.changes.mapPos(pending.from, 1);
      pending.to = Math.max(pending.from, update.changes.mapPos(pending.to, -1));
    }
  }
}

async function insertFiles(v, files, range) {
  const id = current.id;
  // 选中的字先不删：附件存好以后，和链接一起换掉（一步，⌘Z 能整个撤回）。
  // 等的时候换了笔记、附件没存成，正文都原样；先删的话，删掉的字会照常存进文件，插入却取消了
  const pending = { from: range.from, to: range.to };
  pendingInserts.add(pending);
  try {
    const items = [];
    for (const file of files) {
      const data = await readBase64(file);
      const reply = await post({ type: 'attach', id, name: file.name, mime: file.type, data });
      if (reply?.link) items.push({ link: reply.link, name: file.name, image: file.type.startsWith('image/') });
    }
    if (pending.cancelled || current.id !== id || !items.length) return;
    insertAttachments(items, EditorSelection.range(pending.from, pending.to));
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

/** 格式面板（Aa）的按钮和菜单栏的命令。 */
const FORMATS = {
  heading: setHeading(2),
  ...Object.fromEntries([1, 2, 3, 4, 5, 6].map(n => [`h${n}`, setHeading(n)])),
  paragraph: setHeading(0),
  bold: toggleWrap('**'),
  italic: toggleWrap('*'),
  strike: toggleWrap('~~'),
  code: toggleWrap('`'),
  link: insertLink,
  list: toggleList('bullet'),
  numbered: toggleList('number'),
  todo: toggleTodoLines,
  done: toggleDone,
  quote: toggleLinePrefix('> '),
  rule: insertBlock('---\n', 4),
  codeBlock: toggleCodeBlock,
  table: insertBlock(TABLE, TABLE.lastIndexOf('\n') + 3), // 光标在第一个空格子里
  math: view => insertMath(view),
  dateTime: insertDate('dateTime'),
  date: insertDate('date'),
  shortDate: insertDate('shortDate'),
  time: insertDate('time'),
  moveUp: moveLineUp,
  moveDown: moveLineDown,
  fold: v => toggleFoldHere(v),
  find: openSearchPanel,
  replace: openReplace,
  findNext,
  findPrevious,
};

/** 只读的笔记（废纸篓里）也能用的命令。 */
const READ_ONLY_OK = new Set(['find', 'replace', 'findNext', 'findPrevious', 'fold']);
const FIND_COMMANDS = new Set(['find', 'replace', 'findNext', 'findPrevious']);

/** 格式面板、菜单栏的命令（编辑器没有焦点时，快捷键走菜单，最后也到这里）。 */
function format(kind) {
  const run = FORMATS[kind];
  if (!run || (view.state.readOnly && !READ_ONLY_OK.has(kind))) return;
  // 光标在查找栏里时，菜单来的格式命令不改正文（查找命令照常）
  if (inSearchPanel(view) && !FIND_COMMANDS.has(kind)) return;
  view.focus();
  run(view);
}

/** 专注模式：其他段落变淡；Esc 退出（交给 App 一起把侧栏和列表放回来）。 */
function setFocusModeOn(on) {
  focusMode = !!on;
  host.classList.toggle('is-focus-mode', focusMode);
  view.dispatch({ effects: setFocusMode.of(focusMode) });
}

watchTheme();

window.bettermd = {
  setDocument,
  clear,
  format,
  setLibraryBase,
  setFocusMode: setFocusModeOn,
  insertAttachments: items => insertAttachments(items),
  focus: () => view.focus(),
  view,
};

post({ type: 'ready' });
