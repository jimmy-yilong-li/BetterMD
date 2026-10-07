// 把编辑器打包进 dist/：editor.js、editor.css（含 KaTeX 样式）、fonts/（KaTeX 字体）、index.html。
// 用法：node build.mjs（scripts/bundle.sh 会先跑这个，再把 dist 放进 BetterMD.app）
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'dist');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: { editor: join(here, 'src/main.js') },
  outdir: out,
  bundle: true,
  format: 'iife',
  minify: true,
  target: 'safari18',
  legalComments: 'none',
  loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file' },
  assetNames: 'fonts/[name]',
  logLevel: 'warning',
});
copyFileSync(join(here, 'src/index.html'), join(out, 'index.html'));
console.log('editor/dist');
