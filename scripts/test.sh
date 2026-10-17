#!/bin/zsh
# 跑全部测试：Swift、编辑器单元测试、编辑器在真浏览器里的按键测试、VS Code 插件的单元测试和同步测试。
# 浏览器测试用无头 Chrome，不开窗口、不开 App、不开 VS Code。任何一组失败，最后返回非零。
set -uo pipefail
cd "$(dirname "$0")/.."

failed=()
step() {
  local name=$1; shift
  print -P "%B== $name%b"
  if "$@"; then print "   通过"; else failed+=("$name"); print "   没通过"; fi
}

step "编辑器打包" npm --prefix editor run build --silent
step "Swift" swift test --quiet --no-parallel
step "编辑器单元测试" npm --prefix editor test --silent
step "编辑器按键测试（无头 Chrome）" npm --prefix editor run test:browser --silent
step "VS Code 插件单元测试" node --test vscode/test/*.test.js
step "VS Code 插件同步测试（无头 Chrome）" node vscode/test/sync.mjs

if (( ${#failed} )); then
  print -P "\n%B没通过：${(j:、:)failed}%b"
  exit 1
fi
print -P "\n%B全部通过%b"
