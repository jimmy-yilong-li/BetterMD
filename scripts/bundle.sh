#!/usr/bin/env bash
# 把 SwiftPM 编出来的可执行文件装进 build/BetterMD.app，并做本机签名（ad-hoc）。
# 用法：scripts/bundle.sh [debug|release]
set -euo pipefail
cd "$(dirname "$0")/.."
CONFIG="${1:-debug}"
swift build -c "$CONFIG" --product BetterMD
BIN_DIR="$(swift build -c "$CONFIG" --show-bin-path)"
APP="build/BetterMD.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN_DIR/BetterMD" "$APP/Contents/MacOS/BetterMD"
cp App/Info.plist "$APP/Contents/Info.plist"
cp App/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
codesign --force --sign - "$APP" >/dev/null 2>&1
echo "$APP"
