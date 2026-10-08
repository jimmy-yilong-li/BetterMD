// 把 Markdown 片段画成网页元素：KaTeX 公式，以及表格单元格里的行内格式（粗体、链接、代码、公式……）。
import katex from 'katex';
import { parser, GFM } from '@lezer/markdown';
import { mathSyntax, texOf, isDisplayMath } from './math.js';
import { resolveTarget, libraryURL } from './helpers.js';

const texCache = new Map();

/** KaTeX 排好的 HTML。写错的公式不抛错，显示成红色原文。结果有缓存。 */
export function texHTML(tex, display) {
  const key = (display ? 'D' : 'I') + tex;
  let html = texCache.get(key);
  if (html === undefined) {
    html = katex.renderToString(tex, {
      displayMode: display, throwOnError: false, strict: 'ignore', output: 'html', errorColor: 'var(--accent)',
    });
    if (texCache.size > 500) texCache.clear();
    texCache.set(key, html);
  }
  return html;
}

const inlineParser = parser.configure([GFM, mathSyntax]);
const SKIP = new Set([
  'EmphasisMark', 'StrikethroughMark', 'CodeMark', 'LinkMark', 'HeaderMark', 'QuoteMark', 'ListMark',
  'InlineMathMark', 'BlockMathMark', 'TaskMarker', 'LinkTitle', 'LinkLabel',
]);
const TAGS = { Emphasis: 'em', StrongEmphasis: 'strong', Strikethrough: 'del' };

/** 一小段 Markdown 的行内排版（用于表格单元格）。`dir` 用来解析相对路径的图片。 */
export function renderInline(cell, dir = '') {
  const frag = document.createDocumentFragment();
  // 前面垫一个零宽空格，单元格里的“1. 第一步”“- 一项”“> 引用”就不会被当成列表、引用；垫的字不画出来
  const text = '\u200B' + cell;
  const tree = inlineParser.parse(text);
  emit(tree.topNode, frag, 1, text.length);
  return frag;

  function emit(node, parent, from, to) {
    let pos = from;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.to <= from || child.from >= to) continue;
      if (child.from > pos) parent.append(text.slice(pos, child.from));
      draw(child, parent);
      pos = child.to;
    }
    if (to > pos) parent.append(text.slice(pos, to));
  }

  function draw(node, parent) {
    const name = node.name;
    if (SKIP.has(name)) return;
    if (TAGS[name]) {
      const el = document.createElement(TAGS[name]);
      const marks = node.getChildren(name === 'Strikethrough' ? 'StrikethroughMark' : 'EmphasisMark');
      emit(node, el, marks.length ? marks[0].to : node.from, marks.length > 1 ? marks[marks.length - 1].from : node.to);
      parent.append(el);
    } else if (name === 'InlineCode') {
      const marks = node.getChildren('CodeMark');
      const el = document.createElement('code');
      el.textContent = text.slice(marks[0]?.to ?? node.from, marks[1]?.from ?? node.to);
      parent.append(el);
    } else if (name === 'InlineMath') {
      const src = text.slice(node.from, node.to);
      const el = document.createElement('span');
      el.className = 'cm-math-inline';
      el.innerHTML = texHTML(texOf(src), isDisplayMath(src));
      parent.append(el);
    } else if (name === 'Link' || name === 'Image') {
      const marks = node.getChildren('LinkMark');
      const url = node.getChild('URL');
      const target = url ? resolveTarget(dir, text.slice(url.from, url.to)) : null;
      const labelFrom = marks[0]?.to ?? node.from, labelTo = marks[1]?.from ?? node.to;
      if (name === 'Image') {
        const img = document.createElement('img');
        img.alt = text.slice(labelFrom, labelTo);
        if (target) img.src = target.url ?? libraryURL(target.path);
        parent.append(img);
      } else {
        const a = document.createElement('a');
        if (target?.url) a.dataset.url = target.url;
        else if (target?.path) a.dataset.path = target.path;
        emit(node, a, labelFrom, labelTo);
        parent.append(a);
      }
    } else if (name === 'Autolink' || name === 'URL') {
      // <https://…> 或直接写出来的网址（链接和图片里的 URL 在上面处理，不会走到这里）
      const url = name === 'URL' ? node : node.getChild('URL');
      const a = document.createElement('a');
      a.textContent = url ? text.slice(url.from, url.to) : text.slice(node.from, node.to);
      a.dataset.url = a.textContent;
      parent.append(a);
    } else if (name === 'Escape') {
      parent.append(text.slice(node.from + 1, node.to));
    } else {
      emit(node, parent, node.from, node.to);
    }
  }
}
