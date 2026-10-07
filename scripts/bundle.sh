#!/usr/bin/env bash
# 打包 build/BetterMD.app：先打包编辑器网页（editor/），再编译 Swift，装进 .app，做本机签名（ad-hoc）。
# 用法：scripts/bundle.sh [debug|release]
set -euo pipefail
cd "$(dirname "$0")/.."
CONFIG="${1:-debug}"
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
