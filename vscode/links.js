// 绑定：项目里的一个 .md 和「我的笔记」里的一篇双向同步（design.md 第 6.14 节）。不依赖 VS Code，测试在 test/links.test.js。
//
// 记在笔记库里：.bettermd/links.json 是哪篇绑了哪个文件；.bettermd/links/<id>.md 是上次同步时两边的内容（底本），
// 三方合并要用它看出两边各改了什么。笔记改名、移动时 BetterMD App 会改 links.json 里的路径。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { merge3 } = require('./merge.js');
const { decode, noteTitle } = require('./notes.js');
const { cleanName } = require('./lib.js');

const REGISTRY = '.bettermd/links.json';
const BASES = '.bettermd/links';
const TRASH = '废纸篓';

// ---- 登记 ----

function readLinks(root) {
  try {
    const json = JSON.parse(fs.readFileSync(path.join(root, REGISTRY), 'utf8'));
    return Array.isArray(json.links) ? json.links.filter(l => l && l.id && l.note && l.file) : [];
  } catch {
    return [];
  }
}

function writeLinks(root, links) {
  writeAtomic(path.join(root, REGISTRY), JSON.stringify({ links }, null, 2) + '\n');
}

/** 改登记：先读磁盘上最新的（App 可能刚改过路径），改完马上写回。 */
function updateLinks(root, change) {
  const links = change(readLinks(root));
  writeLinks(root, links);
  return links;
}

const basePath = (root, id) => path.join(root, BASES, `${id}.md`);
const readBase = (root, id) => readText(basePath(root, id));
const writeBase = (root, id, text) => writeAtomic(basePath(root, id), text);

const linkForNote = (root, note) => readLinks(root).find(l => l.note === note) ?? null;
const linkForFile = (root, file) => readLinks(root).find(l => path.resolve(l.file) === path.resolve(file)) ?? null;

// ---- 读写文件 ----

/** 读成按 \n 换行的正文；文件不在或读不出来返回 null。 */
function readText(file) {
  try { return decode(fs.readFileSync(file)); } catch { return null; }
}

/** 文件原来用什么换行、有没有 BOM：写回去时照原样，免得 git 里整篇都变了。 */
function styleOf(file) {
  try {
    const raw = fs.readFileSync(file);
    const head = raw.subarray(0, 3);
    return { crlf: raw.includes('\r\n'), bom: head.length === 3 && head[0] === 0xEF && head[1] === 0xBB && head[2] === 0xBF };
  } catch {
    return { crlf: false, bom: false };
  }
}

/** 先写到旁边的临时文件再换过去：写到一半出错，原文件还是好的。文件的权限照旧。 */
function writeAtomic(file, text, style = { crlf: false, bom: false }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = (style.bom ? '﻿' : '') + (style.crlf ? text.replace(/\n/g, '\r\n') : text);
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.bettermd-${process.pid}-${Date.now()}`);
  const mode = fs.statSync(file, { throwIfNoEntry: false })?.mode;
  fs.writeFileSync(temp, body);
  if (mode !== undefined) fs.chmodSync(temp, mode & 0o7777);
  fs.renameSync(temp, file);
}

const writeKeepingStyle = (file, text) => writeAtomic(file, text, styleOf(file));

/** 在笔记旁边另存一份：「标题（label 10-17 15:30）.md」，重名加序号。返回文件名。 */
function saveCopy(root, note, text, label, now = new Date()) {
  const dir = path.dirname(path.join(root, ...note.split('/')));
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}`;
  const title = noteTitle(text) || path.basename(note, '.md');
  const base = cleanName(`${title}（${label} ${stamp}）`);
  for (let n = 1; ; n++) {
    const name = `${n === 1 ? base : `${base} ${n}`}.md`;
    try {
      fs.writeFileSync(path.join(dir, name), text, { flag: 'wx' });
      return name;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
}

// ---- 同步一对 ----

/**
 * 同步一对绑定。busy(path) 为 true 的文件这次不写（比如它在 VS Code 里有没存的改动），返回 busy，稍后再来。
 * 返回 { action, conflicts?, copy?, missing? }：
 *   same 两边一样；toNote 项目那边改了，写进笔记；toFile 笔记改了，写进项目；merged 两边都改了，合成一份写回两边；
 *   paused 笔记在废纸篓里，先不同步；missing 有一边的文件不在了；busy 稍后再来。
 * 两边把同一段改得不一样时，以后改的那边为准，输的那边整篇另存一份（copy 是文件名）。
 */
function syncLink(root, link, { busy = () => false, now = new Date() } = {}) {
  if (link.note.split('/')[0] === TRASH) return { action: 'paused' };
  const notePath = path.join(root, ...link.note.split('/'));
  const note = readText(notePath);
  const file = readText(link.file);
  if (note === null || file === null) return { action: 'missing', missing: note === null ? 'note' : 'file' };
  const base = readBase(root, link.id);
  if (note === file) {
    if (base !== note) writeBase(root, link.id, note);
    return { action: 'same' };
  }
  if (busy(notePath) || busy(link.file)) return { action: 'busy' };
  if (base === note) {
    writeKeepingStyle(notePath, file);
    writeBase(root, link.id, file);
    return { action: 'toNote' };
  }
  if (base === file) {
    writeKeepingStyle(link.file, note);
    writeBase(root, link.id, note);
    return { action: 'toFile' };
  }
  // 两边都改了（或者底本丢了）：三方合并；冲突的地方以后改的那边为准
  const newer = (fs.statSync(notePath).mtimeMs >= fs.statSync(link.file).mtimeMs) ? 'note' : 'file';
  const { text, conflicts } = base === null
    ? { text: newer === 'note' ? note : file, conflicts: 1 }
    : merge3(base, note, file, newer);
  let copy = null;
  if (conflicts > 0) copy = saveCopy(root, link.note, newer === 'note' ? file : note, newer === 'note' ? '项目里的版本' : '笔记里的版本', now);
  if (text !== note) writeKeepingStyle(notePath, text);
  if (text !== file) writeKeepingStyle(link.file, text);
  writeBase(root, link.id, text);
  return { action: 'merged', conflicts, copy };
}

// ---- 建立、解除绑定 ----

/** 项目里的文件 file 新建一篇笔记绑上：放进文件夹 folder（相对笔记库），标题取正文第一行，没有就用文件名。返回登记。 */
function bindNewNote(root, file, folder) {
  const text = readText(file);
  if (text === null) throw new Error(`读不出 ${file}`);
  const title = noteTitle(text) || path.basename(file, path.extname(file));
  const dir = path.join(root, ...folder.split('/').filter(Boolean));
  fs.mkdirSync(dir, { recursive: true });
  let notePath;
  for (let n = 1; ; n++) {
    notePath = path.join(dir, `${cleanName(n === 1 ? title : `${title} ${n}`)}.md`);
    try { fs.writeFileSync(notePath, text, { flag: 'wx' }); break; } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  return addLink(root, path.relative(root, notePath).split(path.sep).join('/'), file, text);
}

/**
 * 绑上已有的两份：note（相对笔记库）和 file。两边不一样时以 keep（'note' 或 'file'）那边为准写到另一边，
 * 另一边的原样另存一份。file 还不存在（另存到项目）时直接写出去。返回 { link, copy }。
 */
function bindExisting(root, note, file, keep) {
  const noteText = readText(path.join(root, ...note.split('/')));
  if (noteText === null) throw new Error(`读不出笔记 ${note}`);
  const fileText = readText(file);
  let copy = null;
  let text = noteText;
  if (fileText === null) {
    writeAtomic(file, noteText);
  } else if (fileText !== noteText) {
    text = keep === 'file' ? fileText : noteText;
    copy = saveCopy(root, note, keep === 'file' ? noteText : fileText, keep === 'file' ? '笔记里的版本' : '项目里的版本');
    if (keep === 'file') writeKeepingStyle(path.join(root, ...note.split('/')), text);
    else writeKeepingStyle(file, text);
  }
  return { link: addLink(root, note, file, text), copy };
}

function addLink(root, note, file, text) {
  const link = { id: crypto.randomUUID(), note, file: path.resolve(file) };
  writeBase(root, link.id, text);
  updateLinks(root, links => [...links.filter(l => l.note !== note && path.resolve(l.file) !== link.file), link]);
  return link;
}

/** 解除绑定：两边的文件都原样留着，只是不再同步。 */
function unbind(root, id) {
  updateLinks(root, links => links.filter(l => l.id !== id));
  try { fs.unlinkSync(basePath(root, id)); } catch {}
}

module.exports = {
  REGISTRY, readText, readLinks, writeLinks, linkForNote, linkForFile, readBase, syncLink, bindNewNote, bindExisting, unbind, saveCopy,
};
