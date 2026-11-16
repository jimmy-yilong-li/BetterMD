#!/usr/bin/env bash
# Ubuntu 开发、验证和打包；所有产物写入 build/ubuntu，不改系统设置。
set -euo pipefail
cd "$(dirname "$0")/.."
MODE="${1:-package}"
if (( $# )); then shift; fi
case "$MODE" in
  start|package|pack|test) ;;
  *) echo '用法：scripts/ubuntu.sh [package|pack|start|test] [启动参数]' >&2; exit 2 ;;
esac
if [[ "$(uname -s)" != Linux ]]; then echo '请在 Linux 上运行 Ubuntu 构建脚本。' >&2; exit 1; fi
[[ -d editor/node_modules ]] || npm --prefix editor ci
[[ -d desktop/node_modules ]] || npm --prefix desktop ci
[[ -f desktop/node_modules/electron/path.txt ]] || node desktop/node_modules/electron/install.js
npm --prefix editor run build --silent
node desktop/prepare.cjs
case "$MODE" in
  start) npm --prefix desktop start -- "$@" ;;
  package) npm --prefix desktop run dist -- "$@" ;;
  pack) npm --prefix desktop run pack -- "$@" ;;
  test) scripts/test.sh ;;
esac
