#!/bin/bash
# Extract the AppImage and drive its Electron binary with Playwright (see popover.mjs).
source "$(dirname "$0")/lib.sh"
command -v node >/dev/null || fail "node is required"
command -v xvfb-run >/dev/null || fail "xvfb-run is required"
home="$(fresh_home popover)"
( cd "$LAB" && "$APPIMAGE" --appimage-extract > /dev/null 2>&1 ) || fail "could not extract the AppImage"
exe="$(find "$LAB/squashfs-root" -maxdepth 1 -type f -perm -u+x ! -name 'chrome-sandbox' ! -name 'chrome_crashpad_handler' ! -name 'AppRun' ! -name '*.so*' -exec sh -c 'file "$1" | grep -q ELF && echo "$1"' _ {} \; | head -1)"
[ -n "$exe" ] || fail "no Electron executable found in the extracted AppImage: $(ls "$LAB/squashfs-root")"
pass "electron binary: $(basename "$exe")"
port_free_or_fail
( cd "$REPO" && xvfb-run -a -s "-screen 0 1280x800x24" node tests/linux/popover.mjs "$exe" "$home" "$OUT/$CHECK" ) || fail "popover drive failed"
pass "popover driven; screenshots in $OUT/$CHECK"
