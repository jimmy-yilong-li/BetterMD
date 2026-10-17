// Markdown 里的 LaTeX 公式。这是给 @lezer/markdown 的语法扩展，产生 InlineMath、BlockMath 两种节点，
// 两头的记号是 *MathMark。认这些写法：
//   行内：$…$、$ … $（两边都留空格）、\(…\)，以及写在一行里的 $$…$$、\[…\]
//   单独成段：$$ … $$、\[ … \]、\begin{equation} … \end{equation} 这类环境
import { tags } from '@lezer/highlight';

const DOLLAR = 36, BACKSLASH = 92, NEWLINE = 10, PAREN_L = 40, PAREN_R = 41, BRACKET_L = 91, BRACKET_R = 93;
const isSpace = ch => ch === 32 || ch === 9 || ch === 10 || ch === 13;
const isDigit = ch => ch >= 48 && ch <= 57;

/** 内容像不像公式：有反斜杠命令、上下标、等号、花括号或英文字母。用来排除“$ 100 到 $”“\[1\]”这类误判。 */
export function looksLikeTex(text) {
  return /[\\^_={}a-zA-Z]/.test(text);
}

/** 独立排版（居中成段）的公式：$$…$$、\[…\]、\begin{…}。 */
export function isDisplayMath(src) {
  return src.startsWith('$$') || src.startsWith('\\[') || src.startsWith('\\begin');
}

// LaTeX 里单独成段的公式环境（KaTeX 都支持）
const ENVIRONMENTS = 'equation|equation\\*|align|align\\*|aligned|gather|gather\\*|gathered|multline|multline\\*|alignat|alignat\\*|split|cases|matrix|pmatrix|bmatrix|vmatrix|Vmatrix|array';
const BEGIN = new RegExp(`^\\\\begin\\{(${ENVIRONMENTS})\\}`);

/**
 * 这一行是不是公式块的开头。是的话返回 { close, single }：close 是结尾记号；
 * single 为 true 表示开头结尾写在同一行。不是返回 null。缩进 4 格以上是代码块，不算。
 */
function blockOpener(line) {
  if (line.indent - line.baseIndent >= 4) return null;
  const text = line.text.slice(line.pos);
  if (text.startsWith('$$')) {
    const end = text.indexOf('$$', 2);
    if (end < 0) return { open: 2, close: '$$', single: false };
    // $$…$$ 后面还有字（“$$E=mc^2$$ 是质能方程”）：是段落里的公式，交给行内规则
    return text.slice(end + 2).trim() === '' ? { open: 2, close: '$$', single: true } : null;
  }
  if (text.startsWith('\\[')) {
    const rest = text.slice(2);
    const end = rest.indexOf('\\]');
    // 多行的 \[ 必须单独一行（“\[TODO] 修一下”不是公式）
    if (end < 0) return rest.trim() === '' ? { open: 2, close: '\\]', single: false } : null;
    // 写在一行里：后面不能再有别的字，里面要像公式（“\[1\] 参考文献”是转义的方括号，不是公式）
    if (rest.slice(end + 2).trim() !== '' || !looksLikeTex(rest.slice(0, end))) return null;
    return { open: 2, close: '\\]', single: true };
  }
  const begin = BEGIN.exec(text);
  if (begin) {
    const close = `\\end{${begin[1]}}`;
    return { open: 0, close, single: text.indexOf(close) >= 0 };
  }
  return null;
}

/** 行内的 $…$；$$…$$ 写在一行里也算（按独立公式排版）。规则同 Pandoc，另外允许两边都留空格的写法。 */
function dollarMath(cx, pos) {
  const size = cx.char(pos + 1) === DOLLAR ? 2 : 1;
  const start = pos + size;
  const first = cx.char(start);
  if (first < 0 || first === DOLLAR || first === NEWLINE) return -1;
  // 开头的 $ 后面紧跟文字时，结尾的 $ 前面也要紧跟文字；开头留了空格（$ x $），结尾也要留
  const spaced = isSpace(first);
  for (let i = start; i < cx.end; i++) {
    const ch = cx.char(i);
    if (ch === NEWLINE) return -1;
    if (ch === BACKSLASH) { i++; continue; }
    if (ch !== DOLLAR) continue;
    if (size === 2) {
      if (cx.char(i + 1) !== DOLLAR) continue;
    } else {
      // 结尾的 $ 后面紧跟数字的不算（“花了 $5 和 $6”）
      if (isSpace(cx.char(i - 1)) !== spaced || isDigit(cx.char(i + 1))) continue;
      if (spaced && !looksLikeTex(cx.slice(start, i))) return -1;
    }
    const end = i + size;
    return cx.addElement(cx.elt('InlineMath', pos, end, [
      cx.elt('InlineMathMark', pos, start),
      cx.elt('InlineMathMark', i, end),
    ]));
  }
  return -1;
}

/** 行内的 \(…\)，以及写在一行里的 \[…\]。里面不像公式的（比如转义的括号“\[1\]”）不算。 */
function bracketMath(cx, pos) {
  const kind = cx.char(pos + 1);
  if (kind !== PAREN_L && kind !== BRACKET_L) return -1;
  const closer = kind === PAREN_L ? PAREN_R : BRACKET_R;
  const start = pos + 2;
  for (let i = start; i < cx.end - 1; i++) {
    const ch = cx.char(i);
    if (ch === NEWLINE) return -1;
    if (ch !== BACKSLASH) continue;
    if (cx.char(i + 1) === closer) {
      if (!looksLikeTex(cx.slice(start, i))) return -1;
      const end = i + 2;
      return cx.addElement(cx.elt('InlineMath', pos, end, [
        cx.elt('InlineMathMark', pos, start),
        cx.elt('InlineMathMark', i, end),
      ]));
    }
    i++; // 跳过反斜杠后面的那个字符（\\、\{ 之类）
  }
  return -1;
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
    parse(cx, next, pos) {
      if (next === DOLLAR) return dollarMath(cx, pos);
      if (next === BACKSLASH) return bracketMath(cx, pos);
      return -1;
    },
    // 要排在“转义”前面：\( 本来会被当成转义的括号
    before: 'Escape',
  }],
  parseBlock: [{
    name: 'BlockMath',
    // 从开头那一行，到含结尾记号的那一行为止；没有结尾就一直到文末（和代码块一样）。
    parse(cx, line) {
      const opener = blockOpener(line);
      if (!opener) return false;
      const from = cx.lineStart + line.pos;
      const marks = opener.open ? [cx.elt('BlockMathMark', from, from + opener.open)] : [];
      let to = cx.lineStart + line.text.length;
      // 结尾记号后面还有字（“$$ 是质能方程”）：公式块到结尾记号为止，后面的字留在外面照常显示，不跟着公式藏起来
      const endAt = closeAt => {
        const after = closeAt + opener.close.length;
        if (line.text.slice(after).trim() !== '') to = cx.lineStart + after;
      };
      if (opener.single) {
        const close = line.text.indexOf(opener.close, line.pos + Math.max(opener.open, 1));
        if (opener.open) marks.push(cx.elt('BlockMathMark', cx.lineStart + close, cx.lineStart + close + opener.close.length));
        endAt(close);
        cx.nextLine();
      } else {
        while (cx.nextLine() && line.depth >= cx.stack.length) {
          for (const m of line.markers) marks.push(m);
          to = cx.lineStart + line.text.length;
          const end = line.text.indexOf(opener.close, line.basePos);
          if (end >= 0) {
            if (opener.open) marks.push(cx.elt('BlockMathMark', cx.lineStart + end, cx.lineStart + end + opener.close.length));
            endAt(end);
            cx.nextLine();
            break;
          }
        }
      }
      cx.addElement(cx.elt('BlockMath', from, to, marks));
      return true;
    },
    endLeaf: (cx, line) => blockOpener(line) !== null,
    before: 'FencedCode',
  }],
};

/** 公式节点里的 LaTeX 源码：去掉两头的 $、\( \)、\[ \]；\begin{…}…\end{…} 原样保留（KaTeX 认识这些环境）。 */
export function texOf(text) {
  const src = text.trim();
  if (src.startsWith('\\begin')) return src;
  for (const [open, close] of [['$$', '$$'], ['\\[', '\\]'], ['\\(', '\\)'], ['$', '$']]) {
    if (!src.startsWith(open)) continue;
    let body = src.slice(open.length);
    const at = body.lastIndexOf(close);
    if (at >= 0) body = body.slice(0, at);
    return body.trim();
  }
  return src;
}
