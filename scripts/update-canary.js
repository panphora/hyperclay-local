#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP = 'hyperclay-local';
const FLAG = '--hyperclay-update-now=';
const CAPABILITY_KEY = 'HCLUpdateNowArg';
const VERSION_KEY = 'CFBundleShortVersionString';
const INSTALLED_APP = '/Applications/HyperclayLocal.app';
const EXECUTABLE = /^(\/.+\.app)\/Contents\/MacOS\/HyperclayLocal$/;
const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const DEADLINE_MS = 600_000;
// A fallback install starts only while it can still finish (download, copy) well inside the
// deadline; hypersave kills the canary at the deadline plus 60 s. installLocally swaps the app
// in by rename, so a kill mid-install leaves a complete app or one the next run puts back.
const FALLBACK_BY_MS = 420_000;
// The app forgets a request 60 s after its last resend (REQUEST_TTL_MS in src/main/updater.js),
// so the canary resends until the install is committed, and a canary that stops leaves
// nothing behind that could restart the app later.
const RESEND_MS = 30_000;
const POLL_MS = 2_000;
const ACCEPTED = ['accepted', 'draining', 'installing'];

function userDataDir(home = os.homedir()) {
  return path.join(home, 'Library', 'Application Support', 'Hyperclay Local');
}

function above(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if (left[i] !== right[i]) return left[i] > right[i];
  return false;
}

// Chromium's SingletonLock is a symlink to "<hostname>-<pid>" naming the primary process.
function runningApp(deps) {
  let target;
  try { target = deps.readLock(); } catch { return null; }
  const match = /-([0-9]+)$/.exec(String(target));
  if (!match) return null;
  const pid = Number(match[1]);
  if (!deps.alive(pid)) return null;
  const exe = EXECUTABLE.exec(deps.executableOf(pid) || '');
  return exe ? { pid, exe: exe[0], bundle: exe[1] } : null;
}

function answerTo(deps, version, pid, since) {
  let record;
  try { record = JSON.parse(deps.readRequest()); } catch { return null; }
  if (!record || record.version !== version || record.pid !== pid) return null;
  return Date.parse(record.at) >= since ? record : null;
}

// The old install (scripts' installLocally, which pkills the app) runs only when nothing is
// running or the running build predates the trigger. A running app that can answer is
// never replaced by force: whatever it says, it is left as it is.
async function runCanary(version, deps) {
  const started = deps.now();
  const elapsed = () => deps.now() - started;
  const finish = (outcome, from, reason = null, retry = false) => ({
    app: APP, outcome, from, to: version, reason, seconds: Math.round(elapsed() / 1000), retry
  });

  if (!VERSION.test(String(version))) return finish('failed', null, `Not a version: ${version}`);
  const before = runningApp(deps);
  const from = deps.plist(before ? before.bundle : INSTALLED_APP, VERSION_KEY);

  const fallback = async (reason) => {
    if (elapsed() >= FALLBACK_BY_MS) return finish('failed', from, `${reason}, too late for a fallback install`, true);
    deps.log(`${reason}; installing ${version} the old way`);
    try {
      await deps.install(version);
      return finish('installed', from, reason);
    } catch (error) {
      return finish('failed', from, `${reason}; the fallback install failed: ${error.message}`);
    }
  };

  if (!before) return fallback('Hyperclay Local is not running');
  if (from === version) return finish('self-updated', from, `Already running ${version}`);
  if (from && VERSION.test(from) && above(from, version)) return finish('failed', from, `Running ${from}, which is newer than ${version}`);
  if (deps.plist(before.bundle, CAPABILITY_KEY) !== '1') return fallback(`The running ${from || 'build'} predates the update trigger`);

  let firstSentAt = null;
  let sentAt = null;
  let last = null;
  let busy = null;
  let accepted = false;
  let committed = false;
  for (;;) {
    const current = runningApp(deps);
    if (current && current.pid !== before.pid && deps.plist(current.bundle, VERSION_KEY) === version) {
      return finish('self-updated', from);
    }
    const record = firstSentAt === null ? null : answerTo(deps, version, before.pid, firstSentAt);
    if (record) {
      if (record.state === 'refused') return finish('failed', from, `The app refused: ${record.reason}`);
      if (record.state === 'failed') return finish('failed', from, record.reason, record.retry === true);
      last = record.state;
      if (last === 'busy') busy = record.reason;
      if (ACCEPTED.includes(last)) accepted = true;
      if (last === 'installing') committed = true;
    }

    const stillThere = current && current.pid === before.pid;
    if (!stillThere && !committed) {
      if (current) return finish('failed', from, 'Hyperclay Local restarted before it began installing the update', true);
      if (!accepted) return fallback('Hyperclay Local quit before it accepted the update');
      return finish('failed', from, 'Hyperclay Local quit before it began installing the update', true);
    }
    if (elapsed() >= DEADLINE_MS) {
      if (committed) return finish('failed', from, `The app began installing ${version} but was not running it by the deadline`);
      if (busy) return finish('failed', from, `Refused: ${busy}`, true);
      if (last === 'draining') return finish('failed', from, `The app was still waiting for sync before installing ${version}`, true);
      if (accepted) return finish('failed', from, `The app was still downloading ${version} at the deadline`, true);
      if (last) return finish('failed', from, `The update feed never offered ${version} to the app`, true);
      return finish('failed', from, 'The app never answered the update request', true);
    }
    if (stillThere && !committed && (sentAt === null || deps.now() - sentAt >= RESEND_MS)) {
      sentAt = deps.now();
      if (firstSentAt === null) firstSentAt = sentAt;
      deps.trigger(before.exe, version);
    }
    await deps.sleep(POLL_MS);
  }
}

const BUNDLE = 'HyperclayLocal.app';

// A run killed outright (hypersave sends KILL 5 s after TERM) leaves its copies beside the app.
// Between the two renames in installLocally the aside copy is the only complete app, so it goes
// back first.
function recoverInstall(apps) {
  const dest = path.join(apps, BUNDLE);
  let names;
  try { names = fs.readdirSync(apps); } catch { return; }
  for (const name of names) {
    if (!name.startsWith(`.${BUNDLE}.old-`)) continue;
    if (fs.existsSync(dest)) fs.rmSync(path.join(apps, name), { recursive: true, force: true });
    else fs.renameSync(path.join(apps, name), dest);
  }
  for (const name of names) {
    if (name.startsWith(`.${BUNDLE}.new-`)) fs.rmSync(path.join(apps, name), { recursive: true, force: true });
  }
}

// apps and volumes are fixture folders in tests only.
async function installLocally(version, { log = console.log, apps = '/Applications', volumes = '/Volumes' } = {}) {
  const name = `HyperclayLocal-${version}-arm64.dmg`;
  const dmgPath = path.join(os.tmpdir(), name);
  const volume = path.join(volumes, `HyperclayLocal ${version}-arm64`);
  const dest = path.join(apps, BUNDLE);
  const staged = path.join(apps, `.${BUNDLE}.new-${process.pid}`);
  const aside = path.join(apps, `.${BUNDLE}.old-${process.pid}`);
  const run = (file, args) => childProcess.execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  // hypersave stops a late canary with TERM to its process group. The swap below is synchronous,
  // so this handler runs before it or after it, never between its renames.
  const stop = () => process.exit(143);
  process.on('SIGTERM', stop);
  try {
    recoverInstall(apps);
    log(`Downloading ${name}...`);
    run('curl', ['-fsSL', '--max-time', '150', '-o', dmgPath, `https://local.hyperclay.com/${name}`]);
    try { run('pkill', ['-f', 'HyperclayLocal.app']); } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
    run('hdiutil', ['attach', dmgPath, '-nobrowse', '-quiet']);
    run('cp', ['-R', `${volume}/${BUNDLE}`, staged]);
    // The old app goes aside before the new one moves in, so a complete app is at dest, or
    // aside for recoverInstall to put back, at every point.
    if (fs.existsSync(dest)) fs.renameSync(dest, aside);
    fs.renameSync(staged, dest);
    fs.rmSync(aside, { recursive: true, force: true });
    run('hdiutil', ['detach', volume, '-quiet']);
    fs.unlinkSync(dmgPath);
    // A TERM that arrived during the swap stops the canary here, before the relaunch.
    await new Promise((resolve) => setImmediate(resolve));
    const installed = readPlist(dest, VERSION_KEY);
    if (installed !== version) throw new Error(`${apps} holds ${installed || 'nothing readable'} after the copy`);
    log(`Installed to ${apps}`);
    childProcess.spawn('open', [dest], { detached: true, stdio: 'ignore' }).unref();
  } catch (error) {
    try { run('hdiutil', ['detach', volume, '-quiet']); } catch {}
    if (!fs.existsSync(dest) && fs.existsSync(aside)) fs.renameSync(aside, dest);
    fs.rmSync(staged, { recursive: true, force: true });
    fs.rmSync(aside, { recursive: true, force: true });
    throw error;
  } finally {
    process.removeListener('SIGTERM', stop);
  }
}

function readPlist(bundle, key) {
  try {
    return childProcess.execFileSync('plutil', ['-extract', key, 'raw', '-o', '-', path.join(bundle, 'Contents', 'Info.plist')],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function canaryDeps({ log = console.log } = {}) {
  const dir = userDataDir();
  return {
    readLock: () => fs.readlinkSync(path.join(dir, 'SingletonLock')),
    readRequest: () => fs.readFileSync(path.join(dir, 'update-request.json'), 'utf8'),
    alive: (pid) => {
      try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
    },
    executableOf: (pid) => {
      try {
        return childProcess.execFileSync('ps', ['-o', 'comm=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      } catch {
        return '';
      }
    },
    plist: readPlist,
    trigger: (exe, version) => {
      const child = childProcess.spawn(exe, [`${FLAG}${version}`], { detached: true, stdio: 'ignore' });
      child.on('error', (error) => log(`Could not send the update request: ${error.message}`));
      child.unref();
    },
    install: (version) => installLocally(version, { log }),
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log
  };
}

function exitCodeFor(result) {
  if (result.outcome === 'self-updated') return 0;
  if (result.outcome === 'installed') return 10;
  return 1;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const done = (result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = exitCodeFor(result);
  };
  const failed = (reason) => done({ app: APP, outcome: 'failed', from: null, to: args[0] || null, reason, seconds: 0, retry: false });
  if (args.length !== 1) failed('Usage: node scripts/update-canary.js X.Y.Z');
  else if (process.platform !== 'darwin') failed('The update canary runs on macOS only');
  else runCanary(args[0], canaryDeps()).then(done, (error) => failed(error.message));
}

module.exports = { runCanary, canaryDeps, installLocally, exitCodeFor, userDataDir, FLAG, CAPABILITY_KEY, DEADLINE_MS, FALLBACK_BY_MS, RESEND_MS };
