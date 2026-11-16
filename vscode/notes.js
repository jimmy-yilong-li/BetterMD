// 「我的笔记」面板要用的：找到笔记库、扫一遍（标题、标签、修改时间、置顶）、排成树、新建笔记。
// 标题、标签的规则和 App（Sources/BetterMDCore/NoteText.swift）一致；不依赖 VS Code，测试在 test/notes.test.js。
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { cleanName } = require('./lib.js');

const ATTACHMENTS = '附件';
const TRASH = '废纸篓';

/**
 * 笔记库在哪：VS Code 设置里写了就用它；否则和 App 用同一个（App 记在自己的设置里）；
 * 都没有就是 App 的默认位置：iCloud 云盘/我的笔记，没开 iCloud 云盘时是 ~/我的笔记。
 */
function libraryRoot(configured, readAppSetting = appLibraryPath) {
  const expand = p => p.replace(/^~(?=$|\/)/, os.homedir());
  if (configured) return path.resolve(expand(configured));
  const fromApp = readAppSetting();
  if (fromApp) return path.resolve(expand(fromApp));
  const drive = path.join(os.homedir(), 'Library/Mobile Documents/com~apple~CloudDocs');
  return fs.existsSync(drive) ? path.join(drive, '我的笔记') : path.join(os.homedir(), '我的笔记');
}

function appLibraryPath() {
  if (process.platform === 'linux') {
    try {
      const config = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'BetterMD', 'settings.json');
      return JSON.parse(fs.readFileSync(config, 'utf8')).libraryPath || '';
    } catch { return ''; }
  }
  try {
    return execFileSync('defaults', ['read', 'app.bettermd.BetterMD', 'libraryPath'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return ''; // 没设过
  }
}

/** 第一行非空文字；是 Markdown 标题时去掉开头的 # 和空格。和 App 的 NoteText.title 一样。 */
function noteTitle(text) {
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const hashes = /^#+/.exec(line)?.[0] ?? '';
    if (hashes && hashes.length <= 6) {
      const rest = line.slice(hashes.length);
      if (!rest || rest[0] === ' ') return rest.trim();
    }
    return line;
  }
  return '';
}

const TAG_END = new Set('#,;:!?()[]"\'*~|<>`，。、；：！？（）【】「」“”…');

/** 一行里的 #标签。和 App 的 NoteText.tagsInLine、编辑器的 findTags 一样（有测试对照）。 */
function tagsInLine(line) {
  const chars = Array.from(line);
  const out = [];
  let i = 0;
  while (i < chars.length) {
    if (chars[i] !== '#' || (i > 0 && !/\s/.test(chars[i - 1]))) { i++; continue; }
    let j = i + 1;
    while (j < chars.length && !/\s/.test(chars[j]) && !TAG_END.has(chars[j])) j++;
    let tag = chars.slice(i + 1, j).join('');
    tag = tag.replace(/[./]+$/, '').replace(/^\/+/, '');
    if (tag && !/^\p{N}+$/u.test(tag)) out.push(tag);
    i = Math.max(j, i + 1);
  }
  return out;
}

/** 正文里的标签，按出现顺序去重；代码块（围栏、缩进 4 格）和行内代码里的不算。和 App 的 NoteText.tags 一样。 */
function noteTags(text) {
  const seen = new Set();
  let fence = null;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (fence) {
      const run = /^[`~]+/.exec(t)?.[0] ?? '';
      if (run[0] === fence.mark && run.length >= fence.length && !t.slice(run.length).trim()) fence = null;
      continue;
    }
    const open = /^(`{3,}|~{3,})/.exec(t);
    if (open) { fence = { mark: open[1][0], length: open[1].length }; continue; }
    if (/^( {4}|\t)/.test(line) && t && !/^(?:[-*+]|\d+[.)])\s/.test(t)) continue;
    let inCode = false;
    const plain = Array.from(line).map(ch => { if (ch === '`') { inCode = !inCode; return ' '; } return inCode ? ' ' : ch; }).join('');
    for (const tag of tagsInLine(plain)) seen.add(tag);
  }
  return [...seen];
}

/** 有没有还没勾掉的待办；代码块里的不算。 */
function hasOpenTodo(text) {
  let fence = false;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (/^(`{3,}|~{3,})/.test(t)) { fence = !fence; continue; }
    if (!fence && /^[-*+] \[ \]/.test(t)) return true;
  }
  return false;
}

/** 读一篇笔记的正文：UTF-8；读不通时大多数坏字节的才当成 GB18030（规则和 App 的 NoteStore.readText 一样）。 */
function decode(buffer) {
  try {
    return normalize(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
  } catch {
    const loose = new TextDecoder('utf-8').decode(buffer);
    const bad = (loose.match(/�/g) ?? []).length;
    const nonASCII = buffer.reduce((n, b) => n + (b >= 0x80 ? 1 : 0), 0);
    return normalize(bad * 10 <= nonASCII ? loose : new TextDecoder('gb18030').decode(buffer));
  }
}
const normalize = text => text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');

/**
 * 扫一遍笔记库：全部文件夹（不含「附件」「废纸篓」和隐藏的）、全部笔记（废纸篓里的不算）。
 * 笔记：{ path（相对笔记库，用 /）, title, tags, todo, modified（Date）, pinned }；texts：路径 → 正文（搜索用）。读文件是异步的：
 * 只在 iCloud 上的笔记读的时候要下载，不能卡住 VS Code。
 */
async function scanLibrary(root) {
  const state = readState(root);
  const folders = [];
  const files = [];
  const texts = new Map();
  async function walk(dir, rel) {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!rel && (entry.name === ATTACHMENTS || entry.name === TRASH)) continue;
        folders.push(childRel);
        await walk(path.join(dir, entry.name), childRel);
      } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
        files.push(childRel);
      }
    }
  }
  await walk(root, '');
  const notes = await Promise.all(files.map(async rel => {
    const file = path.join(root, ...rel.split('/'));
    try {
      const [buffer, stat] = await Promise.all([fsp.readFile(file), fsp.stat(file)]);
      const text = decode(buffer);
      texts.set(rel, text);
      return { path: rel, title: noteTitle(text) || '无标题', tags: noteTags(text), todo: hasOpenTodo(text),
        modified: stat.mtime, pinned: state.pinned.has(rel) };
    } catch {
      return null; // 读不出来（比如没网时只在 iCloud 上）：这次先不列
    }
  }));
  folders.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true }));
  return { folders, notes: notes.filter(Boolean), texts };
}

function readState(root) {
  try {
    const json = JSON.parse(fs.readFileSync(path.join(root, '.bettermd', 'state.json'), 'utf8'));
    return { pinned: new Set(json.pinned ?? []) };
  } catch {
    return { pinned: new Set() };
  }
}

/** 列表里的顺序：置顶的在前，然后按修改时间从新到旧。和 App 一样。 */
function sortNotes(notes) {
  return [...notes].sort((a, b) => (b.pinned - a.pinned) || (b.modified - a.modified));
}

const parentOf = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

/**
 * 面板里的树。文件夹：{ kind: 'folder', path, name, children }（children 里先是子文件夹，再是这一层的笔记）；
 * 笔记：{ kind: 'note', note }。最上面是各个文件夹，然后是「未分类」（直接放在根目录里的笔记），最后是「标签」。
 */
function buildTree({ folders, notes }) {
  const nodes = new Map(folders.map(p => [p, { kind: 'folder', path: p, name: p.split('/').pop(), children: [] }]));
  const top = [];
  for (const p of folders) (nodes.get(parentOf(p))?.children ?? top).push(nodes.get(p));
  const loose = [];
  for (const note of sortNotes(notes)) (nodes.get(parentOf(note.path))?.children ?? loose).push({ kind: 'note', note });
  const unfiled = { kind: 'folder', path: '', name: '未分类', children: loose };
  return [...top, unfiled, { kind: 'tags', name: '标签', children: tagTree(notes) }];
}

/** 标签树：多级标签按 / 分层；每个标签下是带着它（或它的子标签）的笔记。 */
function tagTree(notes) {
  const all = new Map();
  const ensure = tag => {
    if (!all.has(tag)) all.set(tag, { kind: 'tag', path: tag, name: tag.split('/').pop(), children: [], notes: [] });
    return all.get(tag);
  };
  for (const note of notes) {
    for (const tag of note.tags) {
      const parts = tag.split('/');
      for (let n = 1; n <= parts.length; n++) ensure(parts.slice(0, n).join('/'));
      ensure(tag).notes.push(note);
    }
  }
  const top = [];
  const ordered = [...all.keys()].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true }));
  for (const tag of ordered) (all.get(parentOf(tag))?.children ?? top).push(all.get(tag));
  // 子标签在前，然后是直接带这个标签的笔记
  for (const node of all.values()) node.children.push(...sortNotes(node.notes).map(note => ({ kind: 'note', note })));
  return top;
}

/** 在文件夹 folder（相对笔记库）里新建一篇：文件名跟着标题，重名加“ 2”“ 3”；返回新文件的绝对路径。 */
function createNote(root, folder, title) {
  const dir = path.join(root, ...folder.split('/').filter(Boolean));
  fs.mkdirSync(dir, { recursive: true });
  const base = cleanName(title || '新笔记');
  for (let n = 1; ; n++) {
    const file = path.join(dir, `${n === 1 ? base : `${base} ${n}`}.md`);
    try {
      fs.writeFileSync(file, `# ${title || '新笔记'}\n\n`, { flag: 'wx' }); // wx：已经有同名的就换下一个名字，不会盖掉
      return file;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
}

/** 搜索笔记：每个词都要出现在标题或正文里（不分大小写、全角半角），标题命中的排前面。和 App 的规则一样。 */
function searchNotes(notes, texts, query) {
  const fold = s => s.normalize('NFKC').toLowerCase();
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return sortNotes(notes);
  const hits = notes.filter(n => { const hay = fold(n.title + '\n' + (texts.get(n.path) ?? '')); return terms.every(t => hay.includes(t)); });
  const inTitle = n => terms.some(t => fold(n.title).includes(t));
  return hits.sort((a, b) => (inTitle(b) - inTitle(a)) || (b.modified - a.modified));
}

module.exports = { libraryRoot, noteTitle, noteTags, tagsInLine, hasOpenTodo, decode, scanLibrary, sortNotes, buildTree, createNote, searchNotes };
