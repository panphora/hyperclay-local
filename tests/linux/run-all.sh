#!/bin/bash
# Run every Linux check against the AppImage, keep going after a failure, write a
# summary, exit non-zero if any failed. Artifacts land in linux-check-artifacts/.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
export LINUX_CHECK_OUT="${LINUX_CHECK_OUT:-$REPO/linux-check-artifacts}"
mkdir -p "$LINUX_CHECK_OUT"
SUMMARY="$LINUX_CHECK_OUT/summary.txt"; : > "$SUMMARY"
{
  echo "=== environment"; head -2 /etc/os-release; uname -m
  echo "APPIMAGE=${APPIMAGE:-}"; echo "user=$(id -un) userns_restricted=$(sysctl -n kernel.apparmor_restrict_unprivileged_userns 2>/dev/null || echo n/a) libfuse2=$(ldconfig -p | grep -q libfuse.so.2 && echo present || echo absent)"
  for t in xvfb-run dbus-run-session node zenity gio; do printf '%-18s %s\n' "$t" "$(command -v $t || echo MISSING)"; done
} > "$LINUX_CHECK_OUT/environment.txt"
failed=0
for check in ${CHECKS:-appimage-launch server-save popover}; do
  if bash "$HERE/$check.sh" > "$LINUX_CHECK_OUT/$check.out" 2>&1; then
    echo "PASS $check" | tee -a "$SUMMARY"
  else
    echo "FAIL $check" | tee -a "$SUMMARY"; failed=1
    sed 's/^/    /' "$LINUX_CHECK_OUT/$check.out" | tail -30
  fi
done
exit $failed
