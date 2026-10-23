#!/usr/bin/env bash
# Development launcher for the Tauri shell: builds (if needed) and runs against
# the current desktop session.
set -euo pipefail
cd "$(dirname "$0")/.."

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"

cd src-tauri
if [ ! -x "target/debug/netcloud-music" ]; then
  cargo build
fi

exec ./target/debug/netcloud-music "$@"
