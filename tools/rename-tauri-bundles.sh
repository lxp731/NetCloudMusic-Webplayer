#!/usr/bin/env bash
# 重命名 Tauri 打包产物，加 "-tauri" 标记以区分 Electron 版产物。
#
# Tauri 的 bundler 不支持自定义 artifactName（产物名固定为
# netcloud-music_<version>_<arch>.{deb,AppImage} / netcloud-music-<version>-<release>.<arch>.rpm），
# 所以打包后统一重命名为 netcloud-music-<version>-tauri-<arch>.<ext>。
#
# 用法：tauri build 之后运行  tools/rename-tauri-bundles.sh
set -euo pipefail
cd "$(dirname "$0")/.."

BUNDLE="src-tauri/target/release/bundle"
NAME="netcloud-music"
VERSION="$(grep -m1 '^version = ' src-tauri/Cargo.toml | sed 's/.*"\([^"]*\)".*/\1/')"

ren() {
  local src="$1" dst="$2"
  if [ -f "$src" ]; then
    mv -f "$src" "$dst"
    echo "  $(basename "$src") → $(basename "$dst")"
  fi
}

echo ">> 重命名 Tauri 产物（version=$VERSION）"

# deb:  netcloud-music_0.1.0_amd64.deb        → netcloud-music-0.1.0-tauri-amd64.deb
for f in "$BUNDLE"/deb/*.deb; do
  [ -f "$f" ] || continue
  arch="$(basename "$f" | sed -E "s/${NAME}_${VERSION}_([^.]+)\.deb/\1/")"
  ren "$f" "$(dirname "$f")/${NAME}-${VERSION}-tauri-${arch}.deb"
done

# rpm:  netcloud-music-0.1.0-1.x86_64.rpm     → netcloud-music-0.1.0-tauri-x86_64.rpm
for f in "$BUNDLE"/rpm/*.rpm; do
  [ -f "$f" ] || continue
  arch="$(basename "$f" | sed -E "s/${NAME}-${VERSION}-[0-9]+\.([^.]+)\.rpm/\1/")"
  ren "$f" "$(dirname "$f")/${NAME}-${VERSION}-tauri-${arch}.rpm"
done

# appimage: netcloud-music_0.1.0_x86_64.AppImage → netcloud-music-0.1.0-tauri-x86_64.AppImage
for f in "$BUNDLE"/appimage/*.AppImage; do
  [ -f "$f" ] || continue
  arch="$(basename "$f" | sed -E "s/${NAME}_${VERSION}_([^.]+)\.AppImage/\1/")"
  ren "$f" "$(dirname "$f")/${NAME}-${VERSION}-tauri-${arch}.AppImage"
done

echo ">> 完成"
