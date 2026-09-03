# Shared setup for the Linux checks of the shipped AppImage. Each check runs the app
# as an ordinary user in a throwaway HOME with settings pre-seeded so the server
# starts on launch without anyone clicking the tray. Source this, do not run it.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APPIMAGE="${APPIMAGE:-$(ls "$REPO"/executables/HyperclayLocal-*.AppImage 2>/dev/null | head -1)}"
OUT="${LINUX_CHECK_OUT:-$REPO/linux-check-artifacts}"
CHECK="$(basename "${BASH_SOURCE[1]:-check}" .sh)"
PORT=4321
mkdir -p "$OUT/$CHECK"

[ "$(id -u)" -ne 0 ] || { echo "FAIL: run as an ordinary user, the way the app is used" >&2; exit 1; }
[ -n "$APPIMAGE" ] && [ -f "$APPIMAGE" ] || { echo "FAIL: no AppImage (set APPIMAGE or build with npm run linux-build:run)" >&2; exit 1; }
chmod +x "$APPIMAGE"

LAB="$(mktemp -d /tmp/hyperclay-local-lab.XXXXXX)"
pass() { echo "ok   [$CHECK] $*"; }
fail() { echo "FAIL [$CHECK] $*" >&2; [ -f "$LAB/app.log" ] && { echo "--- app.log (tail)" >&2; tail -40 "$LAB/app.log" >&2; }; [ -f "$LAB/app.pid" ] && stop "$(cat "$LAB/app.pid")"; exit 1; }
keep() { cp -r "$@" "$OUT/$CHECK/" 2>/dev/null || true; }

# A fresh HOME whose settings already name a served folder, so the app starts its
# server on launch (main.js: settings.serverEnabled && settings.serverFolder).
fresh_home() {
  local home="$LAB/home-$1"; local folder="$home/apps"
  # main.js calls app.setName('Hyperclay Local'), so Electron's userData is that name, space included.
  mkdir -p "$folder" "$home/.config/Hyperclay Local"
  printf '{"deviceId":"00000000-0000-4000-8000-%012d","serverEnabled":true,"serverFolder":"%s","selectedFolder":"%s"}\n' "$RANDOM" "$folder" "$folder" \
    > "$home/.config/Hyperclay Local/settings.json"
  echo '<!doctype html><html><head><title>seed</title></head><body><h1>seed</h1></body></html>' > "$folder/seed.html"
  echo "$home"
}

wait_for_server() {
  local t="${1:-40}" i
  for ((i=0; i<t*4; i++)); do
    curl -s -o /dev/null -m 2 "http://127.0.0.1:$PORT/_/meta" && return 0
    sleep 0.25
  done
  return 1
}

# Launch the AppImage under a virtual display in the given HOME. Extra args go to
# the AppImage. Prints the PID; stderr/stdout land in $LAB/app.log.
launch() {
  local home="$1"; shift
  : > "$LAB/app.log"
  HOME="$home" XDG_CONFIG_HOME="$home/.config" setsid xvfb-run -a -s "-screen 0 1280x800x24" "$APPIMAGE" "$@" > "$LAB/app.log" 2>&1 &
  echo $! > "$LAB/app.pid"
  echo $!
}

# A server left behind by an earlier launch would make the next one look broken
# (its auto-start fails on the busy port and the popover shows OFF), so refuse to start.
port_free_or_fail() {
  curl -s -o /dev/null -m 1 "http://127.0.0.1:$PORT/_/meta" && fail "port $PORT is already answering before the launch; a previous app is still running"
  return 0
}

# The launch runs in its own process group (setsid), so killing the group reaches the
# AppImage runtime, AppRun, the launcher, Electron and its zygotes, and Xvfb alike.
stop() {
  local pid="$1"
  kill -TERM -- "-$pid" 2>/dev/null || true
  pkill -TERM -P "$pid" 2>/dev/null || true
  kill -TERM "$pid" 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
  kill -KILL -- "-$pid" 2>/dev/null || true
  kill -KILL "$pid" 2>/dev/null || true
  pkill -KILL -f "$(basename "$APPIMAGE")" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  # The server must be gone before the next variant binds the same port.
  for _ in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null -m 1 "http://127.0.0.1:$PORT/_/meta" || break; sleep 0.5; done
}

startup_error() { grep -m1 -o -E "SUID sandbox helper[^.]*|libfuse\.so\.2[^\n]*|AppImages require FUSE[^\n]*|dlopen\(\): error loading[^\n]*|error while loading shared libraries: [^:]*" "$LAB/app.log"; }
