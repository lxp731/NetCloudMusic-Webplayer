#!/usr/bin/env bash
# 构建 Tauri 分发包：deb + rpm + AppImage（Tauri bundler 不支持 pacman）。
#
# deb/rpm 需要 dpkg-deb 和 rpmbuild；本机（Arch）可能没有。本脚本在系统里
# 找不到时，自动用 pacman 下载 dpkg / rpm-tools 包并解包到缓存目录（不安装、
# 不需要 root），再通过 wrapper 提供给 tauri 的 bundler。AppImage 的工具
# （linuxdeploy/appimagetool）由 tauri bundler 自动下载。
#
# 用法：
#   tools/build-linux-tauri.sh                  # 全部目标（deb,rpm,appimage）
#   tools/build-linux-tauri.sh deb rpm          # 只构建指定目标（逗号分隔也可）
set -euo pipefail
cd "$(dirname "$0")/.."

TOOLS_DIR="${NETCLOUD_TOOLS_DIR:-$HOME/.cache/netcloud-music/pkg-tools}"

prepare_pkg_tools() {
  if command -v dpkg-deb >/dev/null 2>&1 && command -v rpmbuild >/dev/null 2>&1; then
    return 0 # 系统已有完整工具
  fi

  echo ">> 准备 deb/rpm 打包工具（下载 dpkg + rpm-tools 到 $TOOLS_DIR）"
  mkdir -p "$TOOLS_DIR"

  pacman -Sp --print-format '%l' dpkg rpm-tools 2>/dev/null | while read -r url; do
    f="$TOOLS_DIR/$(basename "$url")"
    if [ ! -f "$f" ]; then
      echo "   + $(basename "$url")"
      curl -sSL --max-time 180 -o "$f" "$url"
    fi
  done

  rm -rf "$TOOLS_DIR/root" "$TOOLS_DIR/bin"
  mkdir -p "$TOOLS_DIR/root" "$TOOLS_DIR/bin"
  for f in "$TOOLS_DIR"/*.pkg.tar.zst; do
    bsdtar -xf "$f" -C "$TOOLS_DIR/root"
  done

  ln -sf "$TOOLS_DIR/root/usr/bin/dpkg-deb" "$TOOLS_DIR/bin/dpkg-deb"
  cat > "$TOOLS_DIR/bin/rpmbuild" <<EOF
#!/bin/bash
R="$TOOLS_DIR/root"
export LD_LIBRARY_PATH="\$R/usr/lib\${LD_LIBRARY_PATH:+:\$LD_LIBRARY_PATH}"
exec "\$R/usr/bin/rpmbuild" \
  --rcfile "\$R/usr/lib/rpm/rpmrc" \
  --macros "\$R/usr/lib/rpm/macros" \
  --define "_rpmconfigdir \$R/usr/lib/rpm" \
  --define "_rpmmacrodir \$R/usr/lib/rpm/macros.d" \
  --define "_dbpath \$R/usr/lib/rpm/db" \
  --define "_var \$R/usr" \
  "\$@"
EOF
  chmod +x "$TOOLS_DIR/bin/rpmbuild"
  echo ">> 工具就绪"
}

prepare_pkg_tools
export PATH="$TOOLS_DIR/bin:$PATH"

# 目标：默认 deb,rpm,appimage；可用空格或逗号分隔覆盖
if [ "$#" -eq 0 ]; then
  BUNDLES="deb,rpm,appimage"
else
  BUNDLES="$(echo "$*" | tr ' ' ',')"
fi

echo ">> 构建 Tauri 包: $BUNDLES"
pnpm exec tauri build --bundles "$BUNDLES"

echo
echo ">> 重命名产物（加 -tauri 标记）"
tools/rename-tauri-bundles.sh

echo
echo ">> 产物:"
ls -la src-tauri/target/release/bundle/deb/*.deb \
       src-tauri/target/release/bundle/rpm/*.rpm \
       src-tauri/target/release/bundle/appimage/*.AppImage 2>/dev/null || true
echo
echo ">> sha256:"
(cd src-tauri/target/release/bundle && sha256sum deb/netmusic-webplayer-* rpm/netmusic-webplayer-* appimage/netmusic-webplayer-* 2>/dev/null) || true
