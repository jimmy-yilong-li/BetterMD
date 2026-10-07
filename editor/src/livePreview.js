// 所见即所得：Markdown 符号只在光标所在的那一处露出来，其他地方直接显示排版效果。
// 装饰（隐藏符号、替换成公式和表格等）全部由一个 StateField 算出来；整段替换（表格、公式块）只能这样提供。
import { StateField, StateEffect } from '@codemirror/state';
import { EditorView, Decoration, showTooltip } from '@codemirror/view';
import { syntaxTree, foldedRanges, foldable } from '@codemirror/language';
import { texOf } from './math.js';
import { texHTML } from './render.js';
import { findTags, resolveTarget, libraryURL } from './helpers.js';
import {
  MathWidget, MathPreviewWidget, ImageWidget, ListMarkWidget, RuleWidget, CodeInfoWidget, TableWidget,
} from './widgets.js';

// ---- 编辑器有没有焦点：没焦点时什么都不算“正在编辑”，整篇都显示排版效果 ----
const setFocus = StateEffect.define();
export const focusState = StateField.define({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setFocus)) value = e.value;
    return value;
  },
});
export const focusTracker = EditorView.focusChangeEffect.of((state, focusing) => setFocus.of(focusing));

// ---- 笔记所在的文件夹（相对「我的笔记」），用来找相对路径的图片 ----
export const setDir = StateEffect.define();
export const dirState = StateField.define({
  create: () => '',
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setDir)) value = e.value;
    return value;
  },
});

const hide = Decoration.replace({});
// 列表符号区的宽度（em）：每层缩进，以及圆点、序号、复选框各自占的宽度
const LIST_STEP = 1.5;
const LIST_MARK = { bullet: 1.25, number: 1.6, task: 1.55 };
const mark = cls => Decoration.mark({ class: cls });
const dim = mark('cm-md-mark');
const lineClass = cls => Decoration.line({ class: cls });

// 这些节点里的 # 不是标签
const NO_TAGS = new Set([
  'InlineCode', 'FencedCode', 'CodeBlock', 'InlineMath', 'BlockMath', 'URL', 'Autolink', 'Link', 'Image',
  'HTMLBlock', 'HTMLTag', 'CommentBlock', 'Comment',
]);

function build(state) {
  const doc = state.doc;
  const focused = state.field(focusState);
  const ranges = state.selection.ranges;
  const dir = state.field(dirState);
  const folded = foldedRanges(state);
  const out = [];
  const replaced = []; // 整段替换掉的范围，里面不再加别的装饰

  const touches = (from, to) => focused && ranges.some(r => r.from <= to && r.to >= from);
  const lineTouches = pos => {
    const line = doc.lineAt(pos);
    return touches(line.from, line.to);
  };
  // 空的标记（比如 [](网址) 的链接文字、没写字的待办）CodeMirror 不接受，会抛错，直接跳过
  const add = (deco, from, to = from) => {
    try {
      out.push(deco.range(from, to));
    } catch {
      // 无效范围：不加这个装饰
    }
  };
  const eachLine = (from, to, fn) => {
    for (let pos = from; pos <= to;) {
      const line = doc.lineAt(pos);
      fn(line);
      pos = line.to + 1;
    }
  };
  /** from 是不是一行的开头（前面只有空白），to 是不是一行的结尾。 */
  const ownsLines = (from, to) => {
    const first = doc.lineAt(from);
    return /^\s*$/.test(doc.sliceString(first.from, from)) && doc.lineAt(to).to === to;
  };
  const replaceBlock = (widget, from, to) => {
    const start = doc.lineAt(from).from;
    add(Decoration.replace({ widget, block: true }), start, to);
    replaced.push([start, to]);
  };

  syntaxTree(state).iterate({
    enter(node) {
      const { name, from, to } = node;
      switch (name) {
        case 'ATXHeading1': case 'ATXHeading2': case 'ATXHeading3':
        case 'ATXHeading4': case 'ATXHeading5': case 'ATXHeading6': {
          const line = doc.lineAt(from);
          let cls = 'cm-h cm-h' + name.slice(-1);
          // 第一行是笔记标题，折起来就整篇都看不见了，不给折
          if (line.number > 1 && foldable(state, line.from, line.to)) {
            cls += ' cm-foldable';
            folded.between(line.to, line.to + 1, (a) => { if (a === line.to) cls += ' is-folded'; });
          }
          add(lineClass(cls), line.from);
          return;
        }
        case 'SetextHeading1': case 'SetextHeading2':
          eachLine(from, to, line => add(lineClass('cm-h cm-h' + name.slice(-1)), line.from));
          return;
        case 'HeaderMark': {
          const parent = node.node.parent;
          if (parent?.name.startsWith('ATXHeading') && from === parent.from) {
            // 开头的 # 挂在左边的空白里，一直显示
            const end = doc.sliceString(to, to + 1) === ' ' ? to + 1 : to;
            add(mark('cm-hmark' + (lineTouches(from) ? ' is-active' : '')), from, end);
          } else {
            add(dim, from, to);
          }
          return;
        }
        case 'EmphasisMark': case 'StrikethroughMark': case 'SubscriptMark': case 'SuperscriptMark': {
          const parent = node.node.parent;
          add(parent && touches(parent.from, parent.to) ? dim : hide, from, to);
          return;
        }
        case 'Subscript': case 'Superscript':
          add(mark(name === 'Subscript' ? 'cm-sub' : 'cm-sup'), from, to);
          return;
        case 'InlineCode': {
          add(mark('cm-inline-code'), from, to);
          const active = touches(from, to);
          for (const m of node.node.getChildren('CodeMark')) add(active ? dim : hide, m.from, m.to);
          return false;
        }
        case 'Link': {
          const url = node.node.getChild('URL');
          const marks = node.node.getChildren('LinkMark');
          if (!url || marks.length < 2) return; // [文字] 这类引用式写法，原样显示
          const target = resolveTarget(dir, doc.sliceString(url.from, url.to));
          const attrs = target?.url ? { 'data-url': target.url } : target?.path ? { 'data-path': target.path } : {};
          add(Decoration.mark({ class: 'cm-link', attributes: attrs }), marks[0].to, marks[1].from);
          if (touches(from, to)) {
            add(dim, marks[0].from, marks[0].to);
            add(dim, marks[1].from, to);
          } else {
            add(hide, marks[0].from, marks[0].to);
            add(hide, marks[1].from, to);
          }
          return;
        }
        case 'Autolink': {
          const url = node.node.getChild('URL');
          if (!url) return false;
          const href = doc.sliceString(url.from, url.to);
          add(Decoration.mark({ class: 'cm-link', attributes: { 'data-url': href } }), url.from, url.to);
          const active = touches(from, to);
          add(active ? dim : hide, from, url.from);
          add(active ? dim : hide, url.to, to);
          return false;
        }
        case 'URL': { // 直接写出来的网址；链接、图片里的地址不算
          if (/^(Link|Image|Autolink)$/.test(node.node.parent?.name ?? '')) return;
          const href = doc.sliceString(from, to);
          const target = /^www\./i.test(href) ? 'https://' + href : href;
          add(Decoration.mark({ class: 'cm-link', attributes: { 'data-url': target } }), from, to);
          return;
        }
        case 'Image': {
          const url = node.node.getChild('URL');
          const marks = node.node.getChildren('LinkMark');
          if (!url || marks.length < 2) return false;
          const target = resolveTarget(dir, doc.sliceString(url.from, url.to));
          const src = target ? target.url ?? libraryURL(target.path) : '';
          const alt = doc.sliceString(marks[0].to, marks[1].from);
          const alone = ownsLines(from, to) && doc.lineAt(from).from === doc.lineAt(to).from;
          if (touches(from, to)) {
            add(dim, from, to);
            add(Decoration.widget({ widget: new ImageWidget(src, alt, alone, true), block: alone, side: 1 }), alone ? doc.lineAt(to).to : to);
          } else if (alone) {
            replaceBlock(new ImageWidget(src, alt, true, false), from, doc.lineAt(to).to);
          } else {
            add(Decoration.replace({ widget: new ImageWidget(src, alt, false, false) }), from, to);
          }
          return false;
        }
        case 'Blockquote':
          eachLine(from, to, line => add(lineClass('cm-quote'), line.from));
          return;
        case 'QuoteMark': {
          const end = doc.sliceString(to, to + 1) === ' ' ? to + 1 : to;
          add(lineTouches(from) ? dim : hide, from, end);
          return;
        }
        case 'ListMark': {
          const item = node.node.parent;
          const task = node.node.nextSibling?.name === 'Task' ? node.node.nextSibling : null;
          const marker = task?.getChild('TaskMarker');
          const kind = marker ? 'task' : item?.parent?.name === 'BulletList' ? 'bullet' : 'number';
          const markEnd = marker ? marker.to : to;
          const end = doc.sliceString(markEnd, markEnd + 1) === ' ' ? markEnd + 1 : markEnd;
          const line = doc.lineAt(from);
          const checked = !!marker && /x/i.test(doc.sliceString(marker.from + 1, marker.to - 1));
          if (checked) add(mark('cm-task-done'), end, task.to);
          // 行首到符号之间只有空白时，整段换成固定宽度的符号区，折行的文字悬挂对齐
          if (/^\s*$/.test(doc.sliceString(line.from, from))) {
            const depth = listDepth(item);
            const width = depth * LIST_STEP + LIST_MARK[kind];
            add(Decoration.line({ class: 'cm-li', attributes: { style: `--hang:${width}em` } }), line.from);
            if (touches(from, markEnd)) {
              add(dim, from, markEnd);
            } else {
              const label = kind === 'number' ? doc.sliceString(from, to) : '';
              add(Decoration.replace({ widget: new ListMarkWidget(kind, width, depth, label, checked) }), line.from, end);
            }
          } else if (touches(from, markEnd)) {
            add(dim, from, markEnd);
          } else if (kind !== 'number') {
            add(Decoration.replace({ widget: new ListMarkWidget(kind, LIST_MARK[kind], 0, '', checked) }), from, end);
          } else {
            add(mark('cm-list-num'), from, to);
          }
          return;
        }
        case 'FencedCode': {
          const active = touches(from, to);
          const first = doc.lineAt(from), last = doc.lineAt(to);
          const marks = node.node.getChildren('CodeMark');
          const info = node.node.getChild('CodeInfo');
          const open = marks[0], close = marks.length > 1 ? marks[marks.length - 1] : null;
          const closeLine = close ? doc.lineAt(close.from).from : -1;
          eachLine(from, to, line => {
            let cls = 'cm-code';
            if (line.from === first.from) cls += ' cm-code-first';
            if (line.from === last.from) cls += ' cm-code-last';
            // 不在编辑时，两条 ``` 线收窄，只当代码块的上下边
            if (!active && (line.from === first.from || line.from === closeLine)) cls += ' cm-code-fence';
            add(lineClass(cls), line.from);
          });
          if (active) {
            if (open) add(dim, open.from, info ? info.to : open.to);
            if (close) add(dim, close.from, close.to);
          } else {
            if (open) {
              const lang = info ? doc.sliceString(info.from, info.to) : '';
              add(Decoration.replace({ widget: new CodeInfoWidget(lang) }), open.from, first.to);
            }
            if (close && doc.lineAt(close.from).from !== first.from) add(hide, close.from, close.to);
          }
          return false;
        }
        case 'CodeBlock':
          eachLine(from, to, line => add(lineClass('cm-code cm-code-indented'), line.from));
          return false;
        case 'HorizontalRule':
          if (lineTouches(from)) add(dim, from, to);
          else add(Decoration.replace({ widget: new RuleWidget() }), from, to);
          return false;
        case 'Table': {
          if (!touches(from, to) && ownsLines(from, to)) {
            replaceBlock(new TableWidget(doc.sliceString(doc.lineAt(from).from, to), dir), from, to);
            return false;
          }
          eachLine(from, to, line => add(lineClass('cm-table-src'), line.from));
          return;
        }
        case 'BlockMath': {
          const tex = texOf(doc.sliceString(from, to));
          const block = ownsLines(from, to);
          if (!touches(from, to) && block) {
            replaceBlock(new MathWidget(tex, true, true), from, to);
            return false;
          }
          const firstLine = doc.lineAt(from).from, lastLine = doc.lineAt(to).from;
          eachLine(from, to, line => {
            let cls = 'cm-math-src';
            if (line.from === firstLine) cls += ' cm-math-first';
            if (line.from === lastLine && !block) cls += ' cm-math-last';
            add(lineClass(cls), line.from);
          });
          for (const m of node.node.getChildren('BlockMathMark')) add(dim, m.from, m.to);
          if (block) add(Decoration.widget({ widget: new MathPreviewWidget(tex), block: true, side: 1 }), to);
          return false;
        }
        case 'InlineMath': {
          const src = doc.sliceString(from, to);
          if (touches(from, to)) {
            add(mark('cm-math-src-inline'), from, to);
          } else {
            add(Decoration.replace({ widget: new MathWidget(texOf(src), src.startsWith('$$'), false) }), from, to);
          }
          return false;
        }
        default:
          return;
      }
    },
  });

  // 标签：印章式的小框
  const tree = syntaxTree(state);
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    if (!line.text.includes('#')) continue;
    for (const tag of findTags(line.text)) {
      const from = line.from + tag.from, to = line.from + tag.to;
      if (replaced.some(([a, b]) => from >= a && from <= b)) continue;
      let skip = false;
      for (let n = tree.resolveInner(from, 1); n && !skip; n = n.parent) skip = NO_TAGS.has(n.name);
      if (!skip) add(Decoration.mark({ class: 'cm-tag', attributes: { 'data-tag': tag.name } }), from, to);
    }
  }

  return Decoration.set(out, true);
}

function listDepth(item) {
  let depth = 0;
  for (let n = item.parent; n; n = n.parent) if (n.name === 'BulletList' || n.name === 'OrderedList') depth++;
  return Math.max(0, depth - 1);
}

/** 排版效果出了意外的错，宁可少显示一点，也不能让编辑器本身坏掉（打字、保存都靠它）。 */
function safeBuild(state, fallback) {
  try {
    return build(state);
  } catch (error) {
    console.error('BetterMD：排版效果出错，这次先不显示', error);
    return fallback;
  }
}

export const livePreview = StateField.define({
  create: state => safeBuild(state, Decoration.none),
  update(deco, tr) {
    const changed = tr.docChanged || tr.selection
      || syntaxTree(tr.state) !== syntaxTree(tr.startState)
      || tr.state.field(focusState) !== tr.startState.field(focusState)
      || tr.state.field(dirState) !== tr.startState.field(dirState)
      || foldedRanges(tr.state) !== foldedRanges(tr.startState);
    return changed ? safeBuild(tr.state, deco.map(tr.changes)) : deco;
  },
  provide: field => EditorView.decorations.from(field),
});

// ---- 光标在行内公式里时，下面浮出实时排版结果 ----
function mathTip(state) {
  if (!state.field(focusState)) return null;
  const { head, empty } = state.selection.main;
  if (!empty) return null;
  for (let n = syntaxTree(state).resolveInner(head, -1); n; n = n.parent) {
    if (n.name !== 'InlineMath') continue;
    if (head <= n.from || head >= n.to) return null;
    const src = state.sliceDoc(n.from, n.to);
    return {
      pos: n.from,
      above: false,
      arrow: false,
      create: () => {
        const dom = document.createElement('div');
        dom.className = 'cm-math-tip';
        dom.innerHTML = texHTML(texOf(src), src.startsWith('$$'));
        return { dom };
      },
    };
  }
  return null;
}

function safeTip(state) {
  try {
    return mathTip(state);
  } catch (error) {
    console.error('BetterMD：公式预览出错', error);
    return null;
  }
}

export const mathTooltip = StateField.define({
  create: safeTip,
  update(tip, tr) {
    if (!tr.docChanged && !tr.selection && tr.state.field(focusState) === tr.startState.field(focusState)) return tip;
    return safeTip(tr.state);
  },
  provide: field => showTooltip.from(field),
});
