const path = require('node:path').posix;

const encode = p => p.split('/').map(s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())).join('/');
const folderOf = p => path.dirname(p) === '.' ? '' : path.dirname(p);

function resolveLocal(folder, target) {
  if (!target || /^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(target)) return null;
  let decoded;
  try { decoded = decodeURIComponent(target.split(/[?#]/)[0]); } catch { return null; }
  const resolved = path.normalize(decoded.startsWith('/') ? decoded.slice(1) : path.join(folder, decoded));
  return resolved === '..' || resolved.startsWith('../') ? null : resolved;
}

/** 和 macOS 一样，只调整这篇笔记自己的相对链接，跳过代码和网址。 */
function rebase(text, from, to) {
  if (from === to) return text;
  let fence = null;
  const dest = raw => {
    const bracket = raw.startsWith('<') && raw.endsWith('>');
    const value = bracket ? raw.slice(1, -1) : raw;
    if (value.startsWith('/')) return raw;
    const target = resolveLocal(from, value);
    if (!target) return raw;
    const tail = /[?#].*$/.exec(value)?.[0] ?? '';
    const rewritten = encode(path.relative(to || '.', target)) + tail;
    return bracket ? `<${rewritten}>` : rewritten;
  };
  return text.split('\n').map(line => {
    const mark = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length && !mark[2].trim()) fence = null;
      return line;
    }
    if (mark) { fence = mark[1]; return line; }
    if (/^(?: {4}|\t)/.test(line)) return line;
    // 先找出行内代码，再按原始偏移判断，避免替换后的位置变化。
    const spans = [...line.matchAll(/(`+).*?\1/g)].map(m => [m.index, m.index + m[0].length]);
    const updated = line.replace(/\]\((<[^>\n]*>|(?:[^()\s]|\([^()\s]*\))+)((?:\s+(?:"[^"]*"|'[^']*'))?\s*)\)/g,
      (all, url, title, at) => spans.some(([a, b]) => at >= a && at < b) ? all : `](${dest(url)}${title})`);
    return updated.replace(/^( {0,3}\[[^\]^][^\]]*\]:[ \t]*)(<[^>\n]*>|\S+)((?:[ \t]+(?:"[^"]*"|'[^']*'|\([^)]*\)))?[ \t]*)$/,
      (all, prefix, url, title) => /[/.]/.test(url) ? prefix + dest(url) + title : all);
  }).join('\n');
}

// ---- 列表里的摘要、搜索（和 macOS 的 NoteText 同一套规则） ----

/** 搜索不分大小写、全角半角。 */
const fold = s => s.normalize('NFKC').toLocaleLowerCase();

const PROTECTED = [/(`+)(.+?)\1/, /(?<!\\)\$\$(.+?)\$\$/, /(?<!\\)\$(?![\s\d])([^$]+?)(?<![\s\\])\$(?!\d)/, /\\\((.+?)\\\)/];
const CLEAN = [
  [/!\[([^\]]*)\]\([^)]*\)/g, '$1'], [/\[([^\]]+)\]\([^)]*\)/g, '$1'],
  [/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '$1'], [/(?<![\p{L}\p{N}_])__(?=\S)(.+?)(?<=\S)__(?![\p{L}\p{N}_])/gu, '$1'],
  [/~~(?=\S)(.+?)(?<=\S)~~/g, '$1'], [/(?<!\*)\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?!\*)/g, '$1'],
  [/(?<![\p{L}\p{N}_])_(?=[^\s_])(.+?)(?<=[^\s_])_(?![\p{L}\p{N}_])/gu, '$1'], [/\\([\\`*_{}[\]()#+\-.!$~|>])/g, '$1'],
];
const cleanText = text => CLEAN.reduce((s, [pattern, to]) => s.replace(pattern, to), text);

/** 行内代码和公式原样保留（只去掉两头的记号），其余部分去掉 Markdown 符号。 */
function cleanInline(line) {
  let out = '', rest = line;
  for (;;) {
    let first = null;
    for (const pattern of PROTECTED) { const m = pattern.exec(rest); if (m && (!first || m.index < first.index)) first = m; }
    if (!first) return out + cleanText(rest);
    out += cleanText(rest.slice(0, first.index)) + first[first.length - 1];
    rest = rest.slice(first.index + first[0].length);
  }
}

/** 一行正文去掉 Markdown 符号：标题的 #、引用、列表符号（待办换成 ☐ ☑）、表格的竖线。 */
function plain(line) {
  let s = line;
  const marker = /^(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+(\[[ xX]\]\s+)?)/.exec(s)?.[0];
  if (marker) s = (marker.includes('[ ]') ? '☐ ' : /\[x\]/i.test(marker) ? '☑ ' : '') + s.slice(marker.length);
  s = cleanInline(s);
  if (s.startsWith('|')) s = s.split('|').map(c => c.trim()).filter(Boolean).join(' ');
  return s.trim();
}

const isFence = line => /^(`{3,}|~{3,})/.test(line);
const isRule = line => /^(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(line);
const isTableDelimiter = line => line.includes('-') && /^\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?$/.test(line);
const isTagOnly = (line, tagsInLine) => { const words = line.split(/\s+/).filter(Boolean); return words.length > 0 && words.every(w => w.startsWith('#')) && tagsInLine(line).length > 0; };
function mathOpener(line) {
  if (line.startsWith('$$')) {
    const close = line.indexOf('$$', 2);
    if (close < 0) return { close: '$$', single: false };
    return line.slice(close + 2).trim() ? null : { close: '$$', single: true };
  }
  if (line === '\\[') return { close: '\\]', single: false };
  if (line.startsWith('\\[') && line.endsWith('\\]') && line.length > 4) return { close: '\\]', single: true };
  if (line.startsWith('\\begin{')) return { close: '\\end{', single: line.includes('\\end{') };
  return null;
}

/** 列表里的摘要：跳过标题行、只有标签的行、公式块的源码、分割线、表格分隔行，去掉 Markdown 符号。 */
function preview(text, tagsInLine, limit = 120) {
  const parts = [];
  let length = 0, skippedTitle = false, mathEnd = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || isFence(line)) continue;
    if (!skippedTitle) { skippedTitle = true; continue; }
    if (mathEnd) { if (line.includes(mathEnd)) mathEnd = null; continue; }
    const math = mathOpener(line);
    if (math) { if (!math.single) mathEnd = math.close; continue; }
    if (isTagOnly(line, tagsInLine) || isRule(line) || isTableDelimiter(line)) continue;
    const cleaned = plain(line);
    if (!cleaned) continue;
    parts.push(cleaned);
    length += cleaned.length;
    if (length >= limit) break;
  }
  return Array.from(parts.join(' ')).slice(0, limit).join('');
}

/** 搜索结果里的摘要：正文（不含标题行）里第一个命中的那一行和后面两行，去掉 Markdown 符号；只有标题命中时返回 null。 */
function snippet(text, terms, before = 12, length = 80) {
  const lines = text.split('\n');
  // 一行行找，找到就停：命中多半在前面，不用把整篇都折叠一遍
  let start = -1;
  for (let i = 1; i < lines.length && start < 0; i++) { const folded = fold(lines[i]); if (terms.some(t => folded.includes(t))) start = i; }
  if (start < 0) return null;
  const picked = [];
  for (let i = start; i < lines.length && picked.length < 3; i++) {
    const line = lines[i].trim();
    const cleaned = isFence(line) ? '' : plain(line);
    if (cleaned) picked.push(cleaned);
  }
  const joined = picked.join(' '), where = Math.min(...terms.map(t => fold(joined).indexOf(t)).filter(i => i >= 0));
  const chars = Array.from(joined), from = Number.isFinite(where) ? Math.max(0, Array.from(joined.slice(0, where)).length - before) : 0;
  return (from > 0 || start > 1 ? '…' : '') + chars.slice(from, from + length).join('');
}

/** 正文里第一张本机图片的地址（列表里的缩略图）；代码块里的不算。 */
function firstImage(text) {
  let fence = null;
  for (const line of text.split('\n')) {
    const mark = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) { if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length) fence = null; continue; }
    if (mark) { fence = mark[1]; continue; }
    for (const m of line.matchAll(/!\[[^\]]*\]\((<[^>\n]*>|(?:[^()\s]|\([^()\s]*\))+)/g)) {
      const target = m[1].startsWith('<') ? m[1].slice(1, -1) : m[1];
      if (/\.(png|jpe?g|gif|webp|svg|avif|bmp)(?:[?#].*)?$/i.test(target) && !/^(?:[a-z][\w+.-]*:|\/\/)/i.test(target)) return target;
    }
  }
  return null;
}

module.exports = { encode, folderOf, resolveLocal, rebase, fold, plain, preview, snippet, firstImage };
