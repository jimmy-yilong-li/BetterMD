#!/usr/bin/env bash
# 用 1024×1024 的 PNG 生成 App/AppIcon.icns（打包脚本会把它放进 BetterMD.app）。
# 用法：scripts/make-icns.sh <图标-1024.png>
set -euo pipefail
SRC="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
cd "$(dirname "$0")/.."
SET="$(mktemp -d)/AppIcon.iconset"
mkdir -p "$SET"
for s in 16 32 128 256 512; do
  sips -z "$s" "$s" "$SRC" --out "$SET/icon_${s}x${s}.png" >/dev/null
  sips -z "$((s * 2))" "$((s * 2))" "$SRC" --out "$SET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$SET" -o App/AppIcon.icns
echo App/AppIcon.icns
