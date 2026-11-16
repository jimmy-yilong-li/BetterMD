#!/usr/bin/env bash
# 把 App/Icon/icon-seal.svg 渲染成 Linux 图标主题要的各个尺寸，放进 desktop/icons/（进 git，打包时装进系统的图标目录）。
# 图标换了以后跑一次：scripts/make-linux-icons.sh（要有 Chrome / Chromium）
# 只放一张 1024 的不行：系统的图标主题最大认到 512×512，再大的目录它不看，程序坞和应用列表里就没有图标。
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p desktop/icons
PAGE="$(mktemp -d)/icon.html"
# SVG 自己写死了 1024 的大小，直接渲染成小图只会截到左上角：套一层网页，让它缩到整个画面
printf '<!doctype html><style>html,body{margin:0;background:transparent}img{display:block;width:100vw;height:100vh}</style><img src="file://%s/App/Icon/icon-seal.svg">' "$PWD" > "$PAGE"
for s in 16 24 32 48 64 128 256 512; do
  node scripts/render-png.mjs "$PAGE" "desktop/icons/${s}x${s}.png" "$s" >/dev/null
done
rm -rf "$(dirname "$PAGE")"
ls -l desktop/icons
