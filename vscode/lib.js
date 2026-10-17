// VS Code 插件里不依赖 VS Code 的部分：换行、最小改动、笔记库在哪、附件起名、链接写法、时间。
// 规则和 App（Sources/BetterMDCore）一致，测试在 test/lib.test.js。
const fs = require('node:fs');
const path = require('node:path');

const ATTACHMENTS = '附件';
const META = '.bettermd';
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'tif', 'tiff', 'bmp', 'svg', 'avif', 'ico', 'icns', 'psd', 'jp2', 'exr', 'dng']);

/** Windows 的 \r\n 和老式的 \r 都当成 \n（编辑器里只有 \n）。 */
function normalize(text) {
  return text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text;
}

const isHighSurrogate = c => c >= 0xD800 && c <= 0xDBFF;
const isLowSurrogate = c => c >= 0xDC00 && c <= 0xDFFF;

/**
 * 把 a 改成 b 最少要换掉哪一段：a 里 [from, to) 换成 text。两边一样返回 null。
 * 不从 emoji（还有扩展区的生僻字）这种占两个位置的字中间切开：VS Code 会把这样的范围扩到整个字，多删掉半个，文件里就有了坏字。
 */
function minimalEdit(a, b) {
  if (a === b) return null;
  let start = 0;
  const max = Math.min(a.length, b.length);
  while (start < max && a.charCodeAt(start) === b.charCodeAt(start)) start++;
  if (start > 0 && isHighSurrogate(a.charCodeAt(start - 1))) start--;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a.charCodeAt(endA - 1) === b.charCodeAt(endB - 1)) { endA--; endB--; }
  if (endA < a.length && isLowSurrogate(a.charCodeAt(endA))) { endA++; endB++; }
  return { from: start, to: endA, text: b.slice(start, endB) };
}

/** 只含 \n 的文字里，第 offset 个字符在第几行第几列（都从 0 数）。行列和文件用什么换行无关。 */
function positionAt(text, offset) {
  let line = 0, lineStart = 0;
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) {
    line++;
    lineStart = i + 1;
  }
  return { line, character: offset - lineStart };
}

/** 从这个文件夹往上找 BetterMD 的笔记库（里面有 .bettermd 文件夹）；找不到返回 null。 */
function findLibrary(dir, isDirectory = p => fs.statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false) {
  for (let current = path.resolve(dir); ; current = path.dirname(current)) {
    if (isDirectory(path.join(current, META))) return current;
    if (path.dirname(current) === current) return null;
  }
}

/**
 * 一个 .md 文件在编辑器里怎么摆：root 是图片等相对链接能用到的最上一层，dir 是文件所在的文件夹（相对 root，用 /）。
 * 在笔记库里时 root 是笔记库（「../附件/a.png」这种链接才找得到）；否则是它所在的工作区文件夹，再不然就是它自己的文件夹。
 */
function placeOf(file, workspaceFolders = [], isDirectory) {
  const fileDir = path.dirname(path.resolve(file));
  const library = findLibrary(fileDir, isDirectory);
  const inside = (root) => fileDir === root || fileDir.startsWith(root + path.sep);
  const workspace = workspaceFolders.map(f => path.resolve(f)).filter(inside).sort((x, y) => y.length - x.length)[0];
  const root = library ?? workspace ?? fileDir;
  const dir = path.relative(root, fileDir).split(path.sep).filter(Boolean).join('/');
  return { root, dir, inLibrary: library !== null };
}

/** 图片按时间起名（20261017-153012.png），别的文件保留原名；重名加 -2、-3。和 App 的 NoteStore.saveAttachment 一样。 */
function attachmentName(fileName, mime, now = new Date(), exists = () => false) {
  const parsed = path.parse(fileName || '');
  let ext = parsed.ext.replace(/^\./, '').toLowerCase();
  // 和 App 一样按系统给的扩展名：image/jpeg 是 jpeg，image/svg+xml 是 svg
  if (!ext && mime?.startsWith('image/')) ext = mime.slice(6).replace(/\+.*$/, '');
  const image = ext ? IMAGE_EXT.has(ext) : !!mime?.startsWith('image/');
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const base = image || !parsed.name ? stamp : cleanName(parsed.name);
  for (let n = 1; ; n++) {
    const name = (n === 1 ? base : `${base}-${n}`) + (ext ? '.' + ext : '');
    if (!exists(name)) return name;
  }
}

/** 文件名里不能用的字符换掉：和 App 的 LibraryLayout.fileName 一样。 */
function cleanName(name) {
  let clean = name.replace(/\//g, '／').replace(/:/g, '：').replace(/[\r\n]+/g, ' ').trim().replace(/^\.+/, '');
  if ([...clean].length > 80) clean = [...clean].slice(0, 80).join('').trim();
  return clean || '无标题';
}

/** 链接里的一段路径：空白、括号、尖括号、%、#、? 转义，别的（包括中文）原样。和 App 的 MarkdownLinks.encode 一样。 */
function encodeSegment(segment) {
  let out = '';
  for (const ch of segment) {
    if (/\s/u.test(ch)) out += [...new TextEncoder().encode(ch)].map(b => '%' + b.toString(16).toUpperCase().padStart(2, '0')).join('');
    else out += { '(': '%28', ')': '%29', '<': '%3C', '>': '%3E', '%': '%25', '#': '%23', '?': '%3F' }[ch] ?? ch;
  }
  return out;
}

/** 从文件夹 from 指向 to（都相对同一个根，用 /）的相对链接，比如从“工作/客户”到“附件/a.png”是“../../附件/a.png”。 */
function relativeLink(from, to) {
  const a = from.split('/').filter(Boolean);
  const b = to.split('/').filter(Boolean);
  let common = 0;
  while (common < a.length && common < b.length - 1 && a[common] === b[common]) common++;
  return [...a.slice(common).map(() => '..'), ...b.slice(common).map(encodeSegment)].join('/');
}

/** 列表和编辑区里的时间：今天“今天 10:24”，昨天“昨天 19:05”，今年“10月3日”，更早“2025年10月3日”。和 App 的 NoteDate 一样。 */
function dateLabel(date, now = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  const sameDay = (x, y) => x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (sameDay(date, now)) return '今天 ' + time;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return '昨天 ' + time;
  const md = `${date.getMonth() + 1}月${date.getDate()}日`;
  return date.getFullYear() === now.getFullYear() ? md : `${date.getFullYear()}年${md}`;
}

module.exports = {
  ATTACHMENTS, normalize, minimalEdit, positionAt, findLibrary, placeOf, attachmentName, cleanName, encodeSegment,
  relativeLink, dateLabel,
};
