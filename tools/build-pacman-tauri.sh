#!/usr/bin/env bash
# 构建 Tauri pacman 包：产物名 netcloud-music-<version>-x64.pacman。
#
# 流程：cargo build --release → 把二进制 + .desktop + 图标放到临时目录 →
# makepkg → 重命名产物。
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="$(grep -m1 '^version = ' src-tauri/Cargo.toml | sed 's/.*"\([^"]*\)".*/\1/')"

echo ">> 构建 Tauri pacman 包 (version=$VERSION)"

# 1. 编译 release 二进制
cargo build --release --manifest-path src-tauri/Cargo.toml

# 2. 准备打包目录
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cp packaging/pacman/PKGBUILD "$WORK/PKGBUILD"
cp packaging/pacman/netcloud-music.desktop "$WORK/netcloud-music.desktop"
cp packaging/pacman/netcloud-music.png "$WORK/netcloud-music.png"
cp src-tauri/target/release/netcloud-music "$WORK/netcloud-music"

# 3. 替换版本号
sed -i "s/^pkgver=.*/pkgver=$VERSION/" "$WORK/PKGBUILD"

# 4. makepkg
cd "$WORK"
makepkg -f --skippgpcheck

# 5. 重命名产物：netcloud-music-tauri-<ver>-1-x86_64.pkg.tar.zst
#              → netcloud-music-<ver>-x64.pacman
mkdir -p "$OLDPWD/dist"
PKG="$(ls netcloud-music-tauri-*.pkg.tar.zst)"
mv -f "$PKG" "$OLDPWD/dist/netcloud-music-$VERSION-x64.pacman"

echo
echo ">> 产物: dist/netcloud-music-$VERSION-x64.pacman"
ls -la "$OLDPWD/dist/netcloud-music-$VERSION-x64.pacman"
