const fs = require('node:fs');
const path = require('node:path');

/** 不跟随库内的符号链接，也不允许 ..、绝对路径、隐藏的内部状态进入正文文件接口。 */
function inside(root, relative, { internal = false } = {}) {
  if (typeof relative !== 'string' || relative.includes('\0') || path.isAbsolute(relative)
      || relative.split('/').some(p => p === '..' || (!internal && p.startsWith('.')))) {
    throw new Error('路径必须在笔记库内');
  }
  const base = fs.realpathSync(root);
  let file = base;
  for (const part of relative.split('/').filter(p => p && p !== '.')) {
    file = path.join(file, part);
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) throw new Error('不支持笔记库内的符号链接');
  }
  return file;
}

function atomic(file, data) {
  const temp = path.join(path.dirname(file), `.bettermd-${process.pid}-${require('node:crypto').randomUUID()}.tmp`);
  let fd;
  try {
    const mode = fs.statSync(file, { throwIfNoEntry: false })?.mode;
    fd = fs.openSync(temp, 'wx', mode === undefined ? 0o600 : mode & 0o777);
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temp, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    fs.rmSync(temp, { force: true });
  }
}

/** 保留后缀和序号，把 UTF-8 文件名控制在 240 字节以内。 */
function fileName(title, suffix = '', ext = '.md') {
  let base = String(title).replace(/[/\\\0\r\n]/g, ' ').replace(/^\.+/, '').trim() || '无标题';
  while (Buffer.byteLength(base + suffix + ext) > 240) base = Array.from(base).slice(0, -1).join('');
  return base + suffix + ext;
}

function unique(root, folder, title, suffix = '', ext = '.md') {
  for (let n = 1; ; n++) {
    const name = fileName(title, suffix + (n === 1 ? '' : ` ${n}`), ext);
    const rel = path.posix.join(folder, name);
    if (!fs.existsSync(inside(root, rel))) return rel;
  }
}

module.exports = { inside, atomic, fileName, unique };
