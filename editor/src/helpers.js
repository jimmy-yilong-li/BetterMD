// 不依赖浏览器的小工具：找标签、拆表格、解析图片和链接路径。都可以直接在 Node 里测试。

// 标签遇到这些字符就结束（和 Swift 端 NoteText.tagTerminators 保持一致）。
const TAG_END = new Set('#,;:!?()[]"\'，。、；：！？（）【】「」“”');
const isBlank = ch => /\s/.test(ch);

/**
 * 一行文字里的 `#标签`。规则和 Swift 端 NoteText.tagsInLine 一致：
 * `#` 前面必须是行首或空白，`#` 后面紧跟文字（跟空格是 Markdown 标题）；
 * 结尾的 `.` `/` 和开头的 `/` 不算在标签里。返回 [{ from, to, name }]，位置是这一行里的偏移。
 */
export function findTags(line) {
  const out = [];
  const chars = Array.from(line);
  let offset = 0; // 当前字符在 UTF-16 字符串里的位置
  const offsets = chars.map(ch => { const o = offset; offset += ch.length; return o; });
  offsets.push(offset);
  let i = 0;
  while (i < chars.length) {
    if (chars[i] !== '#' || (i > 0 && !isBlank(chars[i - 1]))) { i++; continue; }
    let j = i + 1;
    while (j < chars.length && !isBlank(chars[j]) && !TAG_END.has(chars[j])) j++;
    let start = i + 1, end = j;
    while (end > start && (chars[end - 1] === '.' || chars[end - 1] === '/')) end--;
    while (start < end && chars[start] === '/') start++;
    if (end > start) {
      out.push({ from: offsets[i], to: offsets[end], name: chars.slice(start, end).join('') });
    }
    i = Math.max(j, i + 1);
  }
  return out;
}

/** 按没转义的 `|` 拆开表格的一行，去掉两头的 `|` 和每格两边的空白。 */
export function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cell = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') { cell += '\\|'; i++; continue; }
    if (ch === '|') { cells.push(cell.trim()); cell = ''; continue; }
    cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

/** 把 GFM 表格的原文拆成 { align, header, rows }；align 里是 'left' | 'center' | 'right' | ''。 */
export function parseTable(text) {
  const lines = text.split('\n').filter(l => l.trim() !== '');
  const header = lines.length ? splitRow(lines[0]) : [];
  const align = (lines.length > 1 ? splitRow(lines[1]) : []).map(spec => {
    const left = spec.startsWith(':'), right = spec.endsWith(':');
    return left && right ? 'center' : right ? 'right' : left ? 'left' : '';
  });
  const rows = lines.slice(2).map(splitRow);
  const width = Math.max(header.length, ...rows.map(r => r.length));
  const pad = cells => cells.concat(Array(Math.max(0, width - cells.length)).fill(''));
  return {
    align: pad(align).slice(0, width),
    header: pad(header),
    rows: rows.map(r => pad(r).slice(0, width)),
  };
}

/**
 * 正文里图片或链接的地址指向哪里。`dir` 是笔记所在文件夹（相对「我的笔记」，未分类是 ''）。
 * 网址返回 { url }；本地相对路径返回 { path }（相对「我的笔记」，已去掉 `..`、`.`，已解码 %20 这类转义）；
 * 跳出「我的笔记」或页内锚点返回 null。以 / 开头的路径按「我的笔记」根目录算。
 */
export function resolveTarget(dir, src) {
  const raw = (src || '').trim().replace(/^<(.*)>$/, '$1');
  if (!raw || raw.startsWith('#')) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return { url: raw };
  if (raw.startsWith('//')) return { url: 'https:' + raw };
  let path = raw.split(/[?#]/)[0];
  try { path = decodeURIComponent(path); } catch { /* 不是合法的转义，就按原样用 */ }
  const parts = path.startsWith('/') || !dir ? [] : dir.split('/');
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return parts.length ? { path: parts.join('/') } : null;
}

/** 「我的笔记」里的文件在编辑器网页里的地址（App 里由 bettermd:// 协议供应）。 */
export function libraryURL(path) {
  return 'bettermd://library/' + path.split('/').map(encodeURIComponent).join('/');
}

/** 折叠的一节里有几段：按空行分开的文字块（代码块、公式块算一段）。 */
export function countParagraphs(text) {
  let count = 0, inBlock = false, fence = null;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (fence) {
      if (t.startsWith(fence)) fence = null;
      continue;
    }
    const open = /^(```|~~~|\$\$)/.exec(t);
    if (open && !(open[1] === '$$' && t.length > 2 && t.endsWith('$$'))) {
      count++;
      fence = open[1];
      inBlock = false;
      continue;
    }
    if (t === '') { inBlock = false; continue; }
    if (!inBlock) { count++; inBlock = true; }
  }
  return count;
}
