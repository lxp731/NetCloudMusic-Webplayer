#!/usr/bin/env bash
# 构建 Linux 分发包：AppImage + deb + rpm + pacman。
#
# deb/rpm 的构建需要 dpkg-deb 和 rpmbuild；本机（Arch）可能没有。本脚本在
# 系统里找不到时，会自动用 pacman 下载 dpkg / rpm-tools 包并解包到缓存目录
# （不安装、不需要 root），再通过 wrapper 提供给 electron-builder 的 fpm。
#
# 用法：
#   tools/build-linux.sh                    # 全部目标
#   tools/build-linux.sh AppImage pacman    # 只构建指定目标
#   NETCLOUD_TOOLS_DIR=/path tools/build-linux.sh
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

  # dpkg-deb 是静态链接的，可直接用；rpmbuild 的配置路径硬编码在 /usr/lib/rpm，
  # 需要 wrapper 把 --rcfile/--macros 和宏目录指到解包位置。
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

TARGETS=("$@")
if [ "${#TARGETS[@]}" -eq 0 ]; then
  TARGETS=(AppImage deb rpm pacman)
fi

echo ">> 构建目标: ${TARGETS[*]}"
NODE_USE_ENV_PROXY=1 npx electron-builder --linux "${TARGETS[@]}"

echo
echo ">> 产物:"
ls -la dist/*.AppImage dist/*.deb dist/*.rpm dist/*.pacman 2>/dev/null || true
echo
echo ">> sha256:"
(cd dist && sha256sum netcloud-music-* 2>/dev/null) || true
