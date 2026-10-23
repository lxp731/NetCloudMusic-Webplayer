#!/usr/bin/env bash
# 下载并解压 GStreamer 音频插件（gst-plugins-good / gst-plugins-base）到用户
# 目录，供 WebKitGTK 播放音频使用，无需 root/sudo。
#
# 背景：WebKitGTK 依赖系统 GStreamer，playbin 用 autoaudiosink 选择音频输出。
# 系统缺 gst-plugins-good 时，播放失败并伴随 GLib-GObject-CRITICAL 警告。
# 本脚本用 pacman 直接下载包（不安装），解压到 ~/.local，运行时通过
# GST_PLUGIN_PATH / LD_LIBRARY_PATH 让 GStreamer 找到插件。
#
# 用法：tools/setup-gst.sh
set -euo pipefail

DEST="$HOME/.local/share/netcloud-music/gst-plugins"
CACHE="$HOME/.cache/netcloud-music/gst-pkgs"
GST_LIB="$DEST/usr/lib/gstreamer-1.0"
LIB="$DEST/usr/lib"

check() {
  GST_PLUGIN_PATH="$GST_LIB" LD_LIBRARY_PATH="$LIB" \
    gst-inspect-1.0 autoaudiosink >/dev/null 2>&1
}

# 系统已装就直接退出
if gst-inspect-1.0 autoaudiosink >/dev/null 2>&1 || check; then
  echo ">> autoaudiosink 已可用，无需处理"
  exit 0
fi

mkdir -p "$CACHE" "$DEST"
echo ">> 下载 gst-plugins-good / gst-plugins-base（无需 root）"

# 收集包（含依赖）的下载 URL
URLS=$(pacman -Sp --print-format '%l' gst-plugins-good gst-plugins-base 2>/dev/null | sort -u)

for url in $URLS; do
  f="$CACHE/$(basename "$url")"
  if [ ! -f "$f" ]; then
    echo "   + $(basename "$url")"
    curl -sSL --max-time 180 -o "$f" "$url" || rm -f "$f"
  fi
done

rm -rf "$DEST"
mkdir -p "$DEST"
for f in "$CACHE"/*.pkg.tar.zst; do
  [ -f "$f" ] && bsdtar -xf "$f" -C "$DEST"
done

if check; then
  echo ">> 完成。插件就绪于 $GST_LIB"
else
  echo ">> 警告：autoaudiosink 仍不可用，请检查网络或手动 sudo pacman -S gst-plugins-good" >&2
  exit 1
fi
