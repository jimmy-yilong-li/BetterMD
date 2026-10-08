#!/usr/bin/env bash
# 打包 build/BetterMD.app：先打包编辑器网页（editor/），再编译 Swift，装进 .app，做本机签名（ad-hoc）。
# 用法：scripts/bundle.sh [release|debug]（默认 release：编译慢一点，用起来快好几倍）
set -euo pipefail
cd "$(dirname "$0")/.."
CONFIG="${1:-release}"
[ -d editor/node_modules ] || npm --prefix editor ci --silent
npm --prefix editor run build --silent >/dev/null
swift build -c "$CONFIG" --product BetterMD
BIN_DIR="$(swift build -c "$CONFIG" --show-bin-path)"
APP="build/BetterMD.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/Editor"
cp "$BIN_DIR/BetterMD" "$APP/Contents/MacOS/BetterMD"
cp App/Info.plist "$APP/Contents/Info.plist"
cp App/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
cp -R editor/dist/. "$APP/Contents/Resources/Editor/"
codesign --force --sign - "$APP" >/dev/null 2>&1
echo "$APP"
