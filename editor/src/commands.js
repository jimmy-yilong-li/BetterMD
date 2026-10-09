// 格式命令：加粗、斜体、删除线、代码、链接、公式、标题、列表、待办、代码块、日期。快捷键在 main.js 里。
import { EditorSelection } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';

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

/**
 * 这一行在语法上是什么：'heading' 小标题、'list' 列表项的第一行、'code' 代码块或公式块里面，别的返回 null。
 * 按语法树判断，不看行首的字：代码块里的“# 注释”“- 项”不是标题、列表。
 */
export function lineKind(state, line) {
  const indent = /^\s*/.exec(line.text)[0].length;
  for (let node = syntaxTree(state).resolveInner(line.from + indent, 1); node; node = node.parent) {
    if (/^(ATX|Setext)Heading/.test(node.name)) return 'heading';
    if (node.name === 'FencedCode' || node.name === 'CodeBlock' || node.name === 'BlockMath') return 'code';
    if (node.name === 'ListItem') return state.doc.lineAt(node.from).number === line.number ? 'list' : null;
  }
  return null;
}

const TODO_LINE = /^(\s*)(?:[-*+]|\d+[.)])\s+\[[ xX]\]\s?/;
const TODO_BOX = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])\]/;

/** ⌘T：选中的行变成待办；全都已经是待办，就变回普通文字。选了好几行时空行不动。 */
export function toggleTodoLines(view) {
  if (view.state.readOnly) return false;
  // 代码块里的行不动；选了好几行时空行也不动
  let lines = selectedLines(view.state).filter(line => lineKind(view.state, line) !== 'code');
  if (lines.length > 1) lines = lines.filter(line => line.text.trim() !== '');
  const allTodo = lines.length > 0 && lines.every(line => TODO_LINE.test(line.text));
  const changes = [];
  for (const line of lines) {
    const todo = TODO_LINE.exec(line.text);
    if (allTodo) {
      changes.push({ from: line.from + todo[1].length, to: line.from + todo[0].length });
    } else if (!todo) {
      const bullet = /^(\s*(?:[-*+]|\d+[.)])\s+)/.exec(line.text);
      const indent = /^\s*/.exec(line.text)[0];
      changes.push(bullet
        ? { from: line.from + bullet[1].length, insert: '[ ] ' }
        : { from: line.from + indent.length, insert: '- [ ] ' });
    }
  }
  if (changes.length) formatLines(view, changes);
  return true;
}

/** ⌘.：勾上或取消选中的待办；有没勾的就全勾上，否则全取消。不是待办的行不动。 */
export function toggleDone(view) {
  if (view.state.readOnly) return false;
  const todos = selectedLines(view.state)
    .filter(line => lineKind(view.state, line) !== 'code')
    .map(line => ({ line, m: TODO_BOX.exec(line.text) })).filter(t => t.m);
  // 没有待办也算处理了：⌘. 漏给系统会被当成 Esc（退出专注模式）
  if (!todos.length) return true;
  const check = todos.some(t => t.m[2] === ' ');
  const changes = todos.map(({ line, m }) => ({ from: line.from + m[1].length, to: line.from + m[1].length + 1, insert: check ? 'x' : ' ' }));
  view.dispatch({ changes, userEvent: 'input.toggle' });
  return true;
}

/** ⌃⌘C：选中了文字就用代码块围起来（整行），没选中就插入一个空代码块。 */
export function toggleCodeBlock(view) {
  if (view.state.readOnly) return false;
  const lines = selectedLines(view.state);
  // 已经在代码块里：再围一层会把外面的代码块提前截断
  if (lines.some(line => lineKind(view.state, line) === 'code')) return true;
  if (view.state.selection.main.empty || !lines.length) return insertBlock('```\n\n```', 4)(view);
  const first = lines[0];
  const last = lines[lines.length - 1];
  format(view, {
    changes: [{ from: first.from, insert: '```\n' }, { from: last.to, insert: '\n```' }],
    selection: { anchor: first.from + 3 }, // 停在 ``` 后面，接着就能写语言名
  });
  return true;
}

/** 插入日期时用的文字：dateTime「2026年10月8日 09:30」、date「2026年10月8日」、shortDate「2026-10-08」、time「09:30」。 */
export function dateText(kind, d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const long = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  switch (kind) {
    case 'dateTime': return `${long} ${time}`;
    case 'date': return long;
    case 'shortDate': return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    case 'time': return time;
    default: return '';
  }
}

/** ⇧⌘7…⇧⌘0：在光标处插入日期、时间（替换选中的文字）。 */
export function insertDate(kind) {
  return view => {
    if (view.state.readOnly) return false;
    format(view, view.state.replaceSelection(dateText(kind)));
    return true;
  };
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
