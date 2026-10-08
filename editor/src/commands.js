// 格式快捷键：加粗、斜体、删除线、代码、链接、公式、标题、待办。
import { EditorSelection } from '@codemirror/state';
import { toggleTask } from './widgets.js';

const format = (view, spec) => view.dispatch(view.state.update(spec, { scrollIntoView: true, userEvent: 'input.format' }));

/** 选中的文字两边加上或去掉 `mark`（比如 **）；没选中时插入一对，光标放在中间。 */
export function toggleWrap(mark) {
  const n = mark.length;
  return view => {
    if (view.state.readOnly) return false;
    const { state } = view;
    format(view, state.changeByRange(range => {
      const before = state.sliceDoc(range.from - n, range.from);
      const after = state.sliceDoc(range.to, range.to + n);
      // 给粗体里的字加斜体时，外面的 ** 不能当成要去掉的 *
      const insideDouble = n === 1
        && state.sliceDoc(range.from - 2, range.from) === mark + mark
        && state.sliceDoc(range.to, range.to + 2) === mark + mark
        && state.sliceDoc(range.from - 3, range.from) !== mark.repeat(3);
      if (before === mark && after === mark && !insideDouble) {
        return {
          changes: [{ from: range.from - n, to: range.from }, { from: range.to, to: range.to + n }],
          range: EditorSelection.range(range.from - n, range.to - n),
        };
      }
      const inner = state.sliceDoc(range.from, range.to);
      if (inner.length > 2 * n && inner.startsWith(mark) && inner.endsWith(mark)) {
        return {
          changes: { from: range.from, to: range.to, insert: inner.slice(n, -n) },
          range: EditorSelection.range(range.from, range.to - 2 * n),
        };
      }
      return {
        changes: [{ from: range.from, insert: mark }, { from: range.to, insert: mark }],
        range: EditorSelection.range(range.from + n, range.to + n),
      };
    }));
    return true;
  };
}

/** ⌘K：选中的文字变成链接文字；选中的是网址，就变成链接地址。光标停在要填的地方。 */
export function insertLink(view) {
  if (view.state.readOnly) return false;
  const { state } = view;
  format(view, state.changeByRange(range => {
    const text = state.sliceDoc(range.from, range.to);
    if (/^https?:\/\/\S+$/.test(text)) {
      return { changes: { from: range.from, to: range.to, insert: `[](${text})` }, range: EditorSelection.cursor(range.from + 1) };
    }
    const insert = `[${text}]()`;
    return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.cursor(range.from + insert.length - 1) };
  }));
  return true;
}

/** ⌘⇧E：空行里插入公式块，否则把选中的文字变成行内公式。 */
export function insertMath(view) {
  if (view.state.readOnly) return false;
  const { state } = view;
  const range = state.selection.main;
  const line = state.doc.lineAt(range.from);
  if (range.empty && line.text.trim() === '') {
    format(view, { changes: { from: line.from, to: line.to, insert: '$$\n\n$$' }, selection: { anchor: line.from + 3 } });
    return true;
  }
  return toggleWrap('$')(view);
}

/** 选中的每一行。选区刚好停在某一行开头（三击选中一行、Shift+↓）时，那一行不算。 */
function selectedLines(state) {
  const lines = new Map();
  for (const r of state.selection.ranges) {
    for (let pos = r.from; pos <= r.to;) {
      const line = state.doc.lineAt(pos);
      if (!(r.to > r.from && line.from === r.to && line.from > r.from)) lines.set(line.number, line);
      pos = line.to + 1;
    }
  }
  return [...lines.values()];
}

/** ⌘1…⌘3：把这一行设成几级标题；已经是这一级就变回正文。⌘0 变回正文。 */
export function setHeading(level) {
  return view => {
    if (view.state.readOnly) return false;
    const changes = selectedLines(view.state).map(line => {
      const m = /^(#{1,6})(\s+|$)/.exec(line.text);
      const current = m ? m[1].length : 0;
      const want = current === level ? 0 : level;
      return { from: line.from, to: line.from + (m ? m[0].length : 0), insert: want ? '#'.repeat(want) + ' ' : '' };
    });
    formatLines(view, changes);
    return true;
  };
}

/** ⌘⇧T：不是待办的行变成待办；已经是待办的就勾上或取消。 */
export function toggleTodo(view) {
  if (view.state.readOnly) return false;
  const lines = selectedLines(view.state);
  const changes = [];
  for (const line of lines) {
    if (/^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]/.test(line.text)) {
      if (lines.length === 1) return toggleTask(view, line.from);
      continue;
    }
    const bullet = /^(\s*(?:[-*+]|\d+[.)])\s+)/.exec(line.text);
    const indent = /^\s*/.exec(line.text)[0];
    changes.push(bullet
      ? { from: line.from + bullet[1].length, insert: '[ ] ' }
      : { from: line.from + indent.length, insert: '- [ ] ' });
  }
  if (changes.length) formatLines(view, changes);
  return true;
}

/** 在行首插入或替换符号；行首的光标落在新符号后面，接着就能打字。 */
function formatLines(view, changes) {
  const set = view.state.changes(changes);
  format(view, { changes: set, selection: view.state.selection.map(set, 1) });
}

/** 列表、引用这类行首符号：选中的行都有就去掉，否则加上（加在缩进后面）。 */
export function toggleLinePrefix(prefix) {
  return view => {
    if (view.state.readOnly) return false;
    const lines = selectedLines(view.state);
    const has = line => line.text.trimStart().startsWith(prefix);
    const remove = lines.every(has);
    const changes = lines.map(line => {
      const indent = /^\s*/.exec(line.text)[0].length;
      return remove
        ? { from: line.from + indent, to: line.from + indent + prefix.length }
        : { from: line.from + indent, insert: prefix };
    });
    formatLines(view, changes);
    return true;
  };
}

/**
 * 插入一整块（分割线、代码块、表格）：当前行是空的就放在这一行，否则另起一段（前面空一行，
 * 不然“文字\n---”会变成标题）。后面紧跟着文字时也空一行。`cursor` 是插入后光标在块里的位置。
 */
export function insertBlock(text, cursor = text.length) {
  return view => {
    if (view.state.readOnly) return false;
    const { state } = view;
    const line = state.doc.lineAt(state.selection.main.head);
    const empty = line.text.trim() === '';
    const from = empty ? line.from : line.to;
    const prefix = empty ? '' : '\n\n';
    const next = line.number < state.doc.lines ? state.doc.line(line.number + 1) : null;
    const suffix = next && next.text.trim() !== '' && !text.endsWith('\n') ? '\n' : '';
    format(view, {
      changes: { from, to: line.to, insert: prefix + text + suffix },
      selection: { anchor: from + prefix.length + cursor },
    });
    return true;
  };
}

const LIST_MARK = /^(\s*)(?:[-*+]|\d+[.)])\s+/;

/** 列表、编号列表：选中的行都已经是这种列表就去掉符号，否则换成这种（已有的别种列表符号直接替换，不叠加）。 */
export function toggleList(kind) {
  return view => {
    if (view.state.readOnly) return false;
    const lines = selectedLines(view.state);
    const isKind = line => kind === 'bullet' ? /^\s*[-*+]\s/.test(line.text) : /^\s*\d+[.)]\s/.test(line.text);
    const remove = lines.every(isKind);
    let n = 0;
    const changes = lines.map(line => {
      const m = LIST_MARK.exec(line.text);
      const indent = m ? m[1].length : /^\s*/.exec(line.text)[0].length;
      const to = m ? line.from + m[0].length : line.from + indent;
      n += 1;
      const insert = remove ? '' : kind === 'bullet' ? '- ' : `${n}. `;
      return { from: line.from + indent, to, insert };
    });
    formatLines(view, changes);
    return true;
  };
}
