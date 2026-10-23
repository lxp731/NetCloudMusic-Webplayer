#!/usr/bin/env bash
# Development launcher for the Tauri shell: ensures the GStreamer audio plugins
# are available, rebuilds (incrementally) and runs against the current session.
set -euo pipefail
cd "$(dirname "$0")/.."

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"

# Audio plugins: WebKitGTK needs autoaudiosink (gst-plugins-good). If the system
# lacks it, fall back to a user-local copy installed by tools/setup-gst.sh.
if ! gst-inspect-1.0 autoaudiosink >/dev/null 2>&1; then
  GD="$HOME/.local/share/netcloud-music/gst-plugins/usr/lib/gstreamer-1.0"
  LD="$HOME/.local/share/netcloud-music/gst-plugins/usr/lib"
  if [ ! -d "$GD" ]; then
    ./tools/setup-gst.sh
  fi
  if [ -d "$GD" ]; then
    export GST_PLUGIN_PATH="$GD"
    export LD_LIBRARY_PATH="$LD${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  fi
fi

cd src-tauri
cargo build

exec ./target/debug/netcloud-music "$@"
