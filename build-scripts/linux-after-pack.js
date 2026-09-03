/**
 * electron-builder afterPack hook. On Linux, put a launcher in front of the Electron
 * binary so the app starts on a stock Ubuntu 24.04.
 *
 * Ubuntu 24.04 restricts unprivileged user namespaces through AppArmor, and an
 * AppImage cannot carry the setuid sandbox helper as root, so Chromium aborts before
 * any app code runs: "The SUID sandbox helper binary was found, but is not configured
 * correctly". electron-builder only adds --no-sandbox to the .desktop entry, which a
 * plain double-click on the AppImage never reads, and app code runs too late to help.
 * Electron does read ELECTRON_DISABLE_SANDBOX before that check, so the launcher sets
 * it, and only when a user namespace really cannot be created (or the user is root,
 * where Chromium refuses to sandbox at all). The renderer only ever shows the app's
 * own UI; user apps run in the system browser.
 *
 * The launcher also pins Chromium to X11 (XWayland on a Wayland desktop) whenever a
 * DISPLAY exists. Electron 38 otherwise picks native Wayland, where a client cannot
 * position its own window or keep it on top, so the tray panel lands wherever GNOME
 * drops new windows. The switch has to be on the command line: app code runs after
 * Chromium has already chosen its platform, and a switch appended from main.js only
 * reaches the child processes, which then cannot draw. Without a DISPLAY (no
 * XWayland) the app starts on Wayland as before.
 */

const fs = require('fs');
const path = require('path');

const LAUNCHER = `#!/bin/bash
here="$(dirname "$(readlink -f "$0")")"
if [ "$(id -u)" = "0" ] || ! unshare -Ur true 2>/dev/null; then
  export ELECTRON_DISABLE_SANDBOX=1
fi
if [ -n "$DISPLAY" ]; then
  set -- --ozone-platform=x11 "$@"
fi
exec "$here/__EXE__.bin" "$@"
`;

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return;
  const exe = context.packager.executableName;
  const binary = path.join(context.appOutDir, exe);
  fs.renameSync(binary, `${binary}.bin`);
  fs.writeFileSync(binary, LAUNCHER.replace('__EXE__', exe), { mode: 0o755 });
  console.log(`  • ${exe} is now the sandbox-aware launcher; the Electron binary is ${exe}.bin`);
};
