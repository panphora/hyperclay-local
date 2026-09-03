#!/bin/bash
# The Autostart on Login setting is honoured on Linux through an XDG autostart
# entry: enabled writes ~/.config/autostart/hyperclay-local.desktop pointing at
# the AppImage, disabled removes a stale one. Both directions run at startup.
source "$(dirname "$0")/lib.sh"
command -v node >/dev/null || fail "node is required"

home="$(fresh_home autostart)"
settings="$home/.config/Hyperclay Local/settings.json"
entry="$home/.config/autostart/hyperclay-local.desktop"
set_autostart_setting() {
  node -e 'const fs=require("fs");const p=process.argv[1];const s=JSON.parse(fs.readFileSync(p,"utf8"));s.autoStartEnabled=process.argv[2]==="true";fs.writeFileSync(p,JSON.stringify(s))' "$settings" "$1"
}

set_autostart_setting true
port_free_or_fail
pid="$(launch "$home" --appimage-extract-and-run --no-sandbox)"
wait_for_server 40 || fail "server did not come up"
[ -f "$entry" ] || fail "autoStartEnabled=true but $entry was not written"
grep -q '^Type=Application$' "$entry" || fail "entry has no Type=Application"
exe="$(sed -n 's/^Exec="\(.*\)"$/\1/p' "$entry")"
[ -n "$exe" ] && [ -e "$exe" ] || fail "Exec does not point at an existing file: $(grep '^Exec=' "$entry")"
keep "$entry"
pass "enabled: entry written, Exec=$exe"
stop "$pid"

set_autostart_setting false
port_free_or_fail
pid="$(launch "$home" --appimage-extract-and-run --no-sandbox)"
wait_for_server 40 || fail "server did not come up on the second launch"
[ ! -e "$entry" ] || fail "autoStartEnabled=false but the stale entry survived"
pass "disabled: stale entry removed"
stop "$pid"
keep "$LAB/app.log"
