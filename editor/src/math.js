// Markdown 里的 LaTeX 公式：行内写 $…$（或 $$…$$），单独成段写 $$…$$。
// 这是给 @lezer/markdown 的语法扩展，产生 InlineMath、BlockMath 两种节点，两头的 $ 是 *MathMark。
import { tags } from '@lezer/highlight';

const DOLLAR = 36, BACKSLASH = 92, NEWLINE = 10;
const isSpace = ch => ch === 32 || ch === 9 || ch === 10 || ch === 13;
const isDigit = ch => ch >= 48 && ch <= 57;

/** 这一行是不是以 $$ 开头（缩进 4 格以上是代码块，不算）。 */
function isMathFence(line) {
  return line.next === DOLLAR && line.text.charCodeAt(line.pos + 1) === DOLLAR && line.indent - line.baseIndent < 4;
}

export const mathSyntax = {
  defineNodes: [
    { name: 'InlineMath', style: tags.special(tags.content) },
    { name: 'InlineMathMark', style: tags.processingInstruction },
    { name: 'BlockMath', block: true, style: tags.special(tags.content) },
    { name: 'BlockMathMark', style: tags.processingInstruction },
  ],
  parseInline: [{
    name: 'InlineMath',
    // 规则同 Pandoc：开头的 $ 后面不能是空白，结尾的 $ 前面不能是空白、后面不能紧跟数字，
    // 所以“花了 $5 和 $6”不是公式。\$ 是转义的美元符号。行内公式不跨行。
    parse(cx, next, pos) {
      if (next !== DOLLAR) return -1;
      const size = cx.char(pos + 1) === DOLLAR ? 2 : 1;
      const start = pos + size;
      const first = cx.char(start);
      if (first < 0 || isSpace(first) || first === DOLLAR) return -1;
      for (let i = start; i < cx.end; i++) {
        const ch = cx.char(i);
        if (ch === NEWLINE) return -1;
        if (ch === BACKSLASH) { i++; continue; }
        if (ch !== DOLLAR) continue;
        if (size === 2) {
          if (cx.char(i + 1) !== DOLLAR) continue;
        } else if (isSpace(cx.char(i - 1)) || isDigit(cx.char(i + 1))) {
          continue;
        }
        const end = i + size;
        return cx.addElement(cx.elt('InlineMath', pos, end, [
          cx.elt('InlineMathMark', pos, start),
          cx.elt('InlineMathMark', i, end),
        ]));
      }
      return -1;
    },
    before: 'Emphasis',
  }],
  parseBlock: [{
    name: 'BlockMath',
    // 从 $$ 开头的行，到下一个含 $$ 的行为止；没有结尾就一直到文末（和代码块一样）。
    parse(cx, line) {
      if (!isMathFence(line)) return false;
      const from = cx.lineStart + line.pos;
      const marks = [cx.elt('BlockMathMark', from, from + 2)];
      const close = line.text.indexOf('$$', line.pos + 2);
      let to = cx.lineStart + line.text.length;
      if (close >= 0) {
        marks.push(cx.elt('BlockMathMark', cx.lineStart + close, cx.lineStart + close + 2));
        cx.nextLine();
      } else {
        while (cx.nextLine() && line.depth >= cx.stack.length) {
          for (const m of line.markers) marks.push(m);
          to = cx.lineStart + line.text.length;
          const end = line.text.indexOf('$$', line.basePos);
          if (end >= 0) {
            marks.push(cx.elt('BlockMathMark', cx.lineStart + end, cx.lineStart + end + 2));
            cx.nextLine();
            break;
          }
        }
      }
      cx.addElement(cx.elt('BlockMath', from, to, marks));
      return true;
    },
    endLeaf: (cx, line) => isMathFence(line),
    before: 'FencedCode',
  }],
};

/** 公式节点里的 LaTeX 源码（去掉两头的 $）。`text` 是节点对应的原文。 */
export function texOf(text) {
  const open = text.startsWith('$$') ? 2 : 1;
  let body = text.slice(open);
  const close = body.lastIndexOf('$'.repeat(open));
  if (close >= 0) body = body.slice(0, close);
  return body.trim();
}
