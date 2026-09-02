#!/bin/bash
# The served folder works from a real browser: the app boots from the AppImage, the
# Malleable HTML File conformance page saves a document from the app's own origin,
# and a LAN-style Host header is refused (documented loopback-only behaviour).
source "$(dirname "$0")/lib.sh"
command -v node >/dev/null || fail "node is required"
RUNNER="$REPO/tests/conformance/host-test.mjs"
home="$(fresh_home save)"
port_free_or_fail
pid="$(launch "$home" --appimage-extract-and-run --no-sandbox)"
wait_for_server 40 || fail "server did not come up"
pass "server up on :$PORT"

code="$(curl -s -o /dev/null -w '%{http_code}' -H "Host: 192.168.1.20:$PORT" "http://127.0.0.1:$PORT/seed.html")"
[ "$code" = "403" ] || fail "LAN Host header got $code, expected 403"
code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/seed.html")"
[ "$code" = "200" ] || fail "own origin got $code"
pass "Host gate: 403 for a LAN host, 200 for 127.0.0.1"

( cd "$REPO" && node "$RUNNER" --url "http://127.0.0.1:$PORT" --root "$home/apps" ) > "$LAB/conformance.log" 2>&1 \
  || { keep "$LAB/conformance.log"; fail "conformance run failed: $(tail -20 "$LAB/conformance.log")"; }
keep "$LAB/conformance.log"
pass "conformance page passed against the AppImage's server"

stop "$pid"
keep "$LAB/app.log"
ls "$home/.config/Hyperclay Local/" > "$OUT/$CHECK/userdata-listing.txt" 2>/dev/null || true
pass "stopped cleanly"
