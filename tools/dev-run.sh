#!/usr/bin/env bash
# Development launcher: runs the app against the *current* desktop session.
#
# Notes:
#  - `--no-sandbox` is only for development: the chrome-sandbox helper shipped
#    with the npm package is not setuid root. The packaged build relies on
#    unprivileged user namespaces (default on Arch/Fedora/Debian).
#  - `--disable-dev-shm-usage` works around containers with tiny /dev/shm.
set -euo pipefail
cd "$(dirname "$0")/.."

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DISPLAY="${DISPLAY:-:0}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"

if [ -z "${XAUTHORITY:-}" ]; then
  for candidate in "$HOME/.Xauthority" "$XDG_RUNTIME_DIR"/xauth_*; do
    if [ -f "$candidate" ]; then export XAUTHORITY="$candidate"; break; fi
  done
fi

exec ./node_modules/.bin/electron . --no-sandbox --disable-dev-shm-usage "$@"
