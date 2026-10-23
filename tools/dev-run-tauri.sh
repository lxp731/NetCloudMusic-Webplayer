#!/usr/bin/env bash
# Development launcher for the Tauri shell: rebuilds (incrementally) and runs
# against the current desktop session.
set -euo pipefail
cd "$(dirname "$0")/.."

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"

cd src-tauri
cargo build

exec ./target/debug/netcloud-music "$@"
