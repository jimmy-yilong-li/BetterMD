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

/** 选中的每一行。 */
function selectedLines(state) {
  const lines = new Map();
  for (const r of state.selection.ranges) {
    for (let pos = r.from; pos <= r.to;) {
      const line = state.doc.lineAt(pos);
      lines.set(line.number, line);
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
