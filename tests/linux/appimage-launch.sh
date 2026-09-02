#!/bin/bash
# Does the AppImage start at all, the way a user runs it? Four variants: as the
# machine is; extracted (bypasses FUSE); with unprivileged user namespaces
# restricted, which is stock Ubuntu 24.04 desktop; and with libfuse2 removed, also
# stock 24.04. The last two need sudo and only run when SYSTEM_MUTATIONS=1.
source "$(dirname "$0")/lib.sh"
command -v xvfb-run >/dev/null || fail "xvfb-run is required"
SUMMARY="$OUT/$CHECK/variants.txt"; : > "$SUMMARY"
overall=0

run_variant() {
  local name="$1"; shift
  local home; home="$(fresh_home "$name")"
  port_free_or_fail
  local pid; pid="$(launch "$home" "$@")"
  local result
  if wait_for_server 40; then result="PASS booted, server answered on :$PORT"; else result="FAIL no server after 40s"; fi
  err="$(startup_error || true)"; [ -n "$err" ] && result="$result; stderr shows: $err"
  stop "$pid"
  cp "$LAB/app.log" "$OUT/$CHECK/app-$name.log"
  echo "$name: $result" | tee -a "$SUMMARY"
  [[ "$result" == PASS* ]]
}

echo "kernel.apparmor_restrict_unprivileged_userns=$(sysctl -n kernel.apparmor_restrict_unprivileged_userns 2>/dev/null || echo n/a)" | tee -a "$SUMMARY"
echo "libfuse2: $(ldconfig -p | grep -q 'libfuse.so.2' && echo present || echo absent)" | tee -a "$SUMMARY"
echo "libgtk-3 (a desktop install has it; a server image does not): $(ldconfig -p | grep -q 'libgtk-3.so.0' && echo present || echo absent)" | tee -a "$SUMMARY"

run_variant as-is || overall=1
run_variant extract-and-run --appimage-extract-and-run || overall=1

if [ "${SYSTEM_MUTATIONS:-0}" = "1" ] && sudo -n true 2>/dev/null; then
  prev="$(sysctl -n kernel.apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)"
  sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=1 >/dev/null
  run_variant userns-restricted || overall=1
  run_variant userns-restricted-no-sandbox --no-sandbox || true
  sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns="$prev" >/dev/null
  if ldconfig -p | grep -q 'libfuse.so.2'; then
    sudo apt-get remove -y 'libfuse2*' >/dev/null 2>&1 || true
    run_variant no-libfuse2 || overall=1
  fi
else
  echo "userns-restricted, no-libfuse2: skipped (SYSTEM_MUTATIONS=1 and passwordless sudo required)" | tee -a "$SUMMARY"
fi
exit $overall
