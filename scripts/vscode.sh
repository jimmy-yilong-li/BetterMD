#!/bin/zsh
# 打包 VS Code 插件：先打包编辑器网页（和 App 用同一份），放进 vscode/media/editor，再打成 build/bettermd.vsix。
# 装上：scripts/vscode.sh --install（装完要在 VS Code 里重新加载窗口才生效）
set -euo pipefail
cd "$(dirname "$0")/.."

npm --prefix editor run build
rm -rf vscode/media/editor
mkdir -p vscode/media build
cp -R editor/dist vscode/media/editor
node --test vscode/test/lib.test.js > /dev/null

(cd vscode && npx --yes @vscode/vsce@3 package --no-dependencies --allow-missing-repository --skip-license -o ../build/bettermd.vsix)

if [[ "${1:-}" == "--install" ]]; then
  "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" --install-extension build/bettermd.vsix --force
fi
