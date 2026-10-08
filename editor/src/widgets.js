// 所见即所得用到的小部件：公式、图片、复选框、圆点、分割线、代码块语言名、表格。
import { WidgetType } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { texHTML, renderInline } from './render.js';
import { parseTable } from './helpers.js';

/** 点了渲染好的东西（公式、表格、图片），就把光标放进它的源码里，让源码露出来。 */
function reveal(view, dom, where) {
  if (view.state.readOnly) return;
  const pos = view.posAtDOM(dom);
  const anchor = where(view.state, pos);
  view.dispatch({ selection: { anchor }, userEvent: 'select.pointer' });
  view.focus();
}
const lineEndAfter = offset => (state, pos) => Math.min(pos + offset, state.doc.lineAt(pos).to);
/** 光标放进公式的源码：开头记号（$、$$、\(、\[）后面；\begin{…} 放在第一行末尾；```math 放在第二行开头。 */
const insideMath = (state, pos) => {
  for (let n = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
    if (n.name === 'InlineMath' || n.name === 'BlockMath') {
      const mark = n.getChild('InlineMathMark') ?? n.getChild('BlockMathMark');
      if (mark && mark.from === n.from) return mark.to;
      return Math.min(state.doc.lineAt(n.from).to, n.to);
    }
    if (n.name === 'FencedCode') {
      const first = state.doc.lineAt(n.from);
      return Math.min(first.to + 1, n.to);
    }
  }
  return pos;
};
/** 光标放到 pos 处那个 `type` 节点的末尾。 */
const nodeEnd = type => (state, pos) => {
  for (let n = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
    if (n.name === type) return n.to;
  }
  return pos;
};
const onPress = (dom, fn) => dom.addEventListener('mousedown', e => {
  if (e.button !== 0 || e.metaKey) return;
  e.preventDefault();
  fn(e);
});

export class MathWidget extends WidgetType {
  /** `display`：按独立公式排版；`block`：整段替换（不在一行文字里）。 */
  constructor(tex, display, block) {
    super();
    this.tex = tex;
    this.display = display;
    this.block = block;
  }
  eq(other) { return other.tex === this.tex && other.display === this.display && other.block === this.block; }
  toDOM(view) {
    const el = document.createElement(this.block ? 'div' : 'span');
    el.className = this.block ? 'cm-math-block' : 'cm-math-inline';
    el.innerHTML = this.tex ? texHTML(this.tex, this.display) : '<span class="cm-math-empty">空公式</span>';
    onPress(el, () => reveal(view, el, insideMath));
    return el;
  }
  get estimatedHeight() { return this.block ? 72 : -1; }
}

/** 正在改公式源码时，紧跟在源码下面的实时排版结果。 */
export class MathPreviewWidget extends WidgetType {
  constructor(tex) {
    super();
    this.tex = tex;
  }
  eq(other) { return other.tex === this.tex; }
  toDOM() {
    const el = document.createElement('div');
    el.className = 'cm-math-preview';
    this.updateDOM(el);
    return el;
  }
  updateDOM(el) {
    el.innerHTML = this.tex ? texHTML(this.tex, true) : '<span class="cm-math-empty">在上面写 LaTeX，这里实时出公式</span>';
    return true;
  }
  get estimatedHeight() { return 72; }
}

export class ImageWidget extends WidgetType {
  /** `src` 是网页能加载的地址；`block`：图片独占一行时整行替换；`editing`：源码露着，这是下面的预览。 */
  constructor(src, alt, block, editing) {
    super();
    this.src = src;
    this.alt = alt;
    this.block = block;
    this.editing = editing;
  }
  eq(other) {
    return other.src === this.src && other.alt === this.alt && other.block === this.block && other.editing === this.editing;
  }
  toDOM(view) {
    const fig = document.createElement(this.block ? 'div' : 'span');
    fig.className = 'cm-image' + (this.block ? ' is-block' : '') + (this.editing ? ' is-editing' : '');
    const img = document.createElement('img');
    img.alt = this.alt;
    img.draggable = false;
    img.addEventListener('load', () => view.requestMeasure());
    img.addEventListener('error', () => {
      fig.classList.add('is-broken');
      view.requestMeasure();
    });
    if (this.src) img.src = this.src;
    else fig.classList.add('is-broken');
    fig.append(img);
    const caption = document.createElement('span');
    caption.className = 'cm-image-caption';
    caption.textContent = this.alt;
    fig.append(caption);
    if (!this.editing) onPress(fig, () => reveal(view, fig, nodeEnd('Image')));
    return fig;
  }
  get estimatedHeight() { return this.block ? 240 : -1; }
}

/** 列表开头的符号：圆点、序号或复选框（连同前面的缩进）。宽度固定，折行的文字和第一行对齐。 */
export class ListMarkWidget extends WidgetType {
  /** kind：'bullet' | 'number' | 'task'；width：整个符号区的宽度（em）；label：序号文字 */
  constructor(kind, width, depth, label, checked) {
    super();
    this.kind = kind;
    this.width = width;
    this.depth = depth;
    this.label = label;
    this.checked = checked;
  }
  eq(other) {
    return other.kind === this.kind && other.width === this.width && other.depth === this.depth
      && other.label === this.label && other.checked === this.checked;
  }
  toDOM(view) {
    const wrap = document.createElement('span');
    wrap.className = 'cm-list-mark cm-list-' + this.kind;
    wrap.style.width = this.width + 'em';
    if (this.kind === 'task') {
      const box = document.createElement('span');
      box.className = 'cm-task-box' + (this.checked ? ' is-done' : '');
      box.setAttribute('role', 'checkbox');
      box.setAttribute('aria-checked', String(this.checked));
      box.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.6 6.3 5 8.6 9.6 3.5"/></svg>';
      onPress(box, () => toggleTask(view, view.posAtDOM(wrap)));
      wrap.append(box);
    } else {
      const glyph = document.createElement('span');
      glyph.className = 'cm-list-glyph';
      glyph.textContent = this.kind === 'bullet' ? ['•', '◦', '▪'][this.depth % 3] : this.label;
      wrap.append(glyph);
    }
    return wrap;
  }
  // 只是勾选状态变了：复用原来的元素，才有“一笔划过”的过渡动画；刚打开的笔记直接显示结果。
  updateDOM(wrap) {
    const box = wrap.querySelector('.cm-task-box');
    if (this.kind !== 'task' || !box || !wrap.classList.contains('cm-list-task')) return false;
    wrap.style.width = this.width + 'em';
    box.classList.toggle('is-done', this.checked);
    box.setAttribute('aria-checked', String(this.checked));
    box.classList.remove('just');
    void box.offsetWidth;
    box.classList.add('just');
    return true;
  }
}

/** 把 pos 所在那一行的待办勾上或取消。 */
export function toggleTask(view, pos) {
  if (view.state.readOnly) return false;
  const line = view.state.doc.lineAt(pos);
  let marker = null;
  syntaxTree(view.state).iterate({
    from: line.from, to: line.to,
    enter: n => {
      if (marker) return false;
      if (n.name === 'TaskMarker') marker = { from: n.from, to: n.to };
    },
  });
  if (!marker) return false;
  const checked = /x/i.test(view.state.sliceDoc(marker.from + 1, marker.to - 1));
  view.dispatch({
    changes: { from: marker.from + 1, to: marker.to - 1, insert: checked ? ' ' : 'x' },
    userEvent: 'input.toggle',
  });
  return true;
}

export class RuleWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-rule';
    el.textContent = '· · ·';
    return el;
  }
}

export class CodeInfoWidget extends WidgetType {
  constructor(lang) {
    super();
    this.lang = lang;
  }
  eq(other) { return other.lang === this.lang; }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-code-lang';
    el.textContent = this.lang;
    return el;
  }
}

export class TableWidget extends WidgetType {
  constructor(source, dir) {
    super();
    this.source = source;
    this.dir = dir;
  }
  eq(other) { return other.source === this.source && other.dir === this.dir; }
  toDOM(view) {
    const { align, header, rows } = parseTable(this.source);
    const wrap = document.createElement('div');
    wrap.className = 'cm-table';
    const table = document.createElement('table');
    const row = (cells, tag) => {
      const tr = document.createElement('tr');
      cells.forEach((text, i) => {
        const cell = document.createElement(tag);
        if (align[i]) cell.style.textAlign = align[i];
        cell.append(renderInline(text, this.dir));
        tr.append(cell);
      });
      return tr;
    };
    const head = document.createElement('thead');
    head.append(row(header, 'th'));
    const body = document.createElement('tbody');
    rows.forEach(cells => body.append(row(cells, 'td')));
    table.append(head, body);
    wrap.append(table);
    onPress(wrap, () => reveal(view, wrap, lineEndAfter(2)));
    return wrap;
  }
  get estimatedHeight() { return 44 + 40 * (this.source.split('\n').length - 2); }
}

/** 标题下面的一行小字：修改时间 · 所在文件夹 · 字数。 */
export class MetaWidget extends WidgetType {
  constructor(parts) {
    super();
    this.parts = parts;
  }
  eq(other) { return other.parts.join('|') === this.parts.join('|'); }
  toDOM() {
    const el = document.createElement('div');
    el.className = 'cm-meta';
    this.parts.forEach((part, i) => {
      if (i) el.append(Object.assign(document.createElement('i'), { ariaHidden: 'true' }));
      el.append(Object.assign(document.createElement('span'), { textContent: part }));
    });
    return el;
  }
  ignoreEvent() { return true; }
  get estimatedHeight() { return 30; }
}
