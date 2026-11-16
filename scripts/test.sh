#!/usr/bin/env bash
# 跑全部测试：macOS 上的 Swift、共用编辑器、VS Code 插件、Linux 桌面版。
# 浏览器用无头 Chrome；Ubuntu 用隐藏的 Electron 窗口，不打开 VS Code。任何一组失败，最后返回非零。
set -uo pipefail
cd "$(dirname "$0")/.."

failed=()
step() {
  local name=$1; shift
  printf '\n== %s\n' "$name"
  if "$@"; then echo "   通过"; else failed+=("$name"); echo "   没通过"; fi
}

step "编辑器打包" npm --prefix editor run build --silent
if [[ "$(uname -s)" == Darwin ]]; then
  step "Swift" swift test --quiet --no-parallel
else
  echo "Linux：SwiftUI App 测试仅在 macOS 上运行。"
fi
step "编辑器单元测试" npm --prefix editor test --silent
step "编辑器按键测试（无头 Chrome）" npm --prefix editor run test:browser --silent
step "VS Code 插件单元测试" node --test vscode/test/*.test.js
step "VS Code 插件同步测试（无头 Chrome）" node vscode/test/sync.mjs
if [[ "$(uname -s)" == Linux ]]; then
  step "Ubuntu 文件数据层" npm --prefix desktop test --silent
  step "准备 Ubuntu 资源" node desktop/prepare.cjs
  step "Ubuntu 桌面窗口（隐藏窗口、临时笔记库）" npm --prefix desktop run test:smoke --silent
fi

if (( ${#failed[@]} )); then
  printf '\n没通过：%s\n' "${failed[*]}"
  exit 1
fi
printf '\n全部通过\n'
