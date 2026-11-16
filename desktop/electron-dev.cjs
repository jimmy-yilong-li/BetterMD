// 开发和测试时怎么启动 Electron（安装包不带这个文件）。
//
// Ubuntu 24.04 以后默认不让普通程序建用户命名空间，Chromium 的沙箱就要靠 root 的 chrome-sandbox 辅助程序。
// npm 装下来的 Electron 自带的那个不是 root 的，直接跑会报 “SUID sandbox helper binary … not configured correctly” 然后退出。
// 机器上装了 Chrome / Chromium 时，它的 chrome-sandbox 已经配好了，借来用：把 Electron 的运行时硬链接一份
// （不带它自己的 chrome-sandbox，不占空间），再用 CHROME_DEVEL_SANDBOX 指到 Chrome 的那个。
// 不改系统设置、不用 sudo、不关沙箱。找不到可借的就照常启动，按 docs/ubuntu.md 里的两条 sudo 命令配一次。
const fs = require('node:fs');
const path = require('node:path');

const helpers = () => [process.env.CHROME_DEVEL_SANDBOX, '/opt/google/chrome/chrome-sandbox', '/opt/google/chrome-beta/chrome-sandbox',
  '/usr/lib/chromium/chrome-sandbox', '/usr/lib/chromium-browser/chrome-sandbox', '/usr/lib64/chromium-browser/chrome-sandbox', '/opt/chromium.org/chromium/chrome-sandbox'].filter(Boolean);
const configured = file => { const s = fs.statSync(file, { throwIfNoEntry: false }); return !!s && s.uid === 0 && (s.mode & 0o4755) === 0o4755; };
const read = file => { try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; } };

/**
 * 返回 { executable, env }：用它们启动，后面跟 App 目录和参数。
 * 不给 executable 就是 npm 装的 Electron；也可以给解包后的 bettermd（验证打包产物）。
 */
function electronCommand(executable = require('electron')) { // electron 包导出的是可执行文件的路径
  executable = path.resolve(executable);
  const dist = path.dirname(executable);
  const restricted = read('/proc/sys/kernel/apparmor_restrict_unprivileged_userns') === '1' || read('/proc/sys/kernel/unprivileged_userns_clone') === '0';
  if (process.platform !== 'linux' || !restricted || configured(path.join(dist, 'chrome-sandbox'))) return { executable, env: {} };
  const helper = helpers().find(configured);
  if (!helper) return { executable, env: {} };
  // 放在原目录旁边（同一个文件系统才能硬链接）；原来的可执行文件换了就重做
  const shadow = path.join(path.dirname(dist), `.${path.basename(dist)}-sandboxed`);
  const stat = fs.statSync(executable), stamp = `${stat.size}:${stat.mtimeMs}`;
  if (read(path.join(shadow, '.stamp')) !== stamp) {
    fs.rmSync(shadow, { recursive: true, force: true });
    const link = (from, to) => {
      fs.mkdirSync(to, { recursive: true });
      for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        if (from === dist && entry.name === 'chrome-sandbox') continue;
        const a = path.join(from, entry.name), b = path.join(to, entry.name);
        if (entry.isDirectory()) link(a, b);
        else { try { fs.linkSync(a, b); } catch { fs.copyFileSync(a, b); } }
      }
    };
    link(dist, shadow);
    fs.writeFileSync(path.join(shadow, '.stamp'), stamp);
  }
  return { executable: path.join(shadow, path.basename(executable)), env: { CHROME_DEVEL_SANDBOX: helper } };
}

module.exports = { electronCommand };

// npm start：node electron-dev.cjs [启动参数]
if (require.main === module) {
  const { spawn } = require('node:child_process');
  const { executable, env } = electronCommand();
  const child = spawn(executable, [__dirname, ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, ...env } });
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}
