const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.resolve(__dirname, '../../scripts/update-canary.js');
const BUNDLE = 'HyperclayLocal.app';

// Every command installLocally reaches outside the fixture folders is a fake: curl, pkill,
// hdiutil and open never run for real. cp runs for real but can stop partway (FAKE_PAUSE=cp).
// Each refuses a path under /Applications.
const GUARD = 'for a in "$@"; do case "$a" in /Applications*) echo "test touched $a" >&2; exit 99 ;; esac; done\n';
const FAKES = {
  curl: `#!/bin/bash\n${GUARD}[ "$FAKE_PAUSE" = curl ] && { touch "$W/paused"; exec sleep 30; }\n[ -n "$FAKE_CURL_CODE" ] && exit "$FAKE_CURL_CODE"\nwhile [ $# -gt 0 ]; do [ "$1" = -o ] && { echo dmg > "$2"; shift; }; shift; done\nexit 0\n`,
  pkill: `#!/bin/bash\necho "pkill $*" >> "$W/calls"\nexit 1\n`,
  hdiutil: `#!/bin/bash\n${GUARD}echo "hdiutil $1" >> "$W/calls"\nexit 0\n`,
  open: `#!/bin/bash\n${GUARD}echo "open $*" >> "$W/calls"\n`,
  cp: `#!/bin/bash\n${GUARD}if [ "$FAKE_PAUSE" = cp ]; then\n  mkdir -p "$3/Contents" && /bin/cp "$2/Contents/Info.plist" "$3/Contents/Info.plist"\n  touch "$W/paused"; exec sleep 30\nfi\nexec /bin/cp "$@"\n`
};

// Runs installLocally in its own process group. FAKE_SWAP=<signal>-<n> sends that signal to
// the process itself right after its nth fs.renameSync, which is between the two renames of
// the swap (n=1) or just after it (n=2).
const RUNNER = `
const fs = require('fs');
const childProcess = require('child_process');
const guard = (...args) => {
  for (const a of args.flat()) if (String(a).startsWith('/Applications')) throw new Error('test touched ' + a);
};
for (const [mod, fn] of [[fs, 'renameSync'], [fs, 'rmSync'], [fs, 'cpSync'], [childProcess, 'execFileSync'], [childProcess, 'spawn']]) {
  const real = mod[fn];
  mod[fn] = (...args) => { guard(args[0], args[1]); return real(...args); };
}
const [signal, at] = (process.env.FAKE_SWAP || '-').split('-');
let renames = 0;
const rename = fs.renameSync;
fs.renameSync = (...args) => {
  rename(...args);
  renames += 1;
  if (signal && renames === Number(at)) process.kill(process.pid, signal);
};
const [script, version, apps, volumes] = process.argv.slice(2);
require(script).installLocally(version, { apps, volumes, log: () => {} })
  .then(() => process.exit(0), (error) => { console.error(error.message); process.exit(1); });
`;

function writeApp(app, version) {
  fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
  fs.mkdirSync(path.join(app, 'Contents', 'Resources'), { recursive: true });
  fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>
`);
  fs.writeFileSync(path.join(app, 'Contents', 'MacOS', 'HyperclayLocal'), '#!/bin/sh\n', { mode: 0o755 });
  fs.writeFileSync(path.join(app, 'Contents', 'Resources', 'payload'), version);
}

// The version of the complete app at a path, or '' when it is missing or only partly there.
function completeVersion(app) {
  let version;
  try {
    version = childProcess.execFileSync('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', path.join(app, 'Contents', 'Info.plist')],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
  try {
    if (fs.readFileSync(path.join(app, 'Contents', 'Resources', 'payload'), 'utf8') !== version) return '';
    fs.statSync(path.join(app, 'Contents', 'MacOS', 'HyperclayLocal'));
  } catch {
    return '';
  }
  return version;
}

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hcl-install-'));
  const w = { dir, apps: path.join(dir, 'apps'), volumes: path.join(dir, 'volumes'), bin: path.join(dir, 'bin'), runner: path.join(dir, 'runner.js') };
  fs.mkdirSync(w.apps);
  fs.mkdirSync(w.bin);
  for (const [name, body] of Object.entries(FAKES)) fs.writeFileSync(path.join(w.bin, name), body, { mode: 0o755 });
  fs.writeFileSync(w.runner, RUNNER);
  writeApp(path.join(w.volumes, 'HyperclayLocal 2.0.0-arm64', BUNDLE), '2.0.0');
  return w;
}

function start(w, env = {}) {
  fs.rmSync(path.join(w.dir, 'paused'), { force: true });
  const child = childProcess.spawn(process.execPath, [w.runner, SCRIPT, '2.0.0', w.apps, w.volumes], {
    detached: true,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { PATH: `${w.bin}:/usr/bin:/bin`, HOME: w.dir, TMPDIR: w.dir, W: w.dir, ...env }
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal, stderr })));
  return { child, exited };
}

const run = (w, env) => start(w, env).exited;

async function pausedAt(w, exited, step) {
  const paused = path.join(w.dir, 'paused');
  let gone = false;
  exited.then(() => { gone = true; });
  for (let i = 0; i < 750; i += 1) {
    if (fs.existsSync(paused)) return;
    if (gone) throw new Error(`installLocally exited before reaching ${step}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`installLocally never reached ${step}`);
}

function leftovers(w) {
  return fs.readdirSync(w.apps).filter((name) => name.startsWith(`.${BUNDLE}.`));
}

function expectInstalled(w, version) {
  expect(completeVersion(path.join(w.apps, BUNDLE))).toBe(version);
  expect(leftovers(w)).toEqual([]);
}

const calls = (w) => { try { return fs.readFileSync(path.join(w.dir, 'calls'), 'utf8'); } catch { return ''; } };

// open is spawned detached, so its fake can log after installLocally has returned.
async function waitForCall(w, call) {
  for (let i = 0; i < 250 && !calls(w).includes(call); i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
  return calls(w);
}

const onMac = process.platform === 'darwin' ? describe : describe.skip;

// Each case runs a real install of a fixture app, which takes seconds under load.
jest.setTimeout(30000);

onMac('fallback install swaps the app by rename', () => {
  const made = [];
  const fresh = () => { const w = workspace(); made.push(w); return w; };
  afterAll(() => { for (const w of made) fs.rmSync(w.dir, { recursive: true, force: true }); });

  test('installs and relaunches', async () => {
    const w = fresh();
    writeApp(path.join(w.apps, BUNDLE), '1.0.0');
    const { code, stderr } = await run(w);
    expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
    expectInstalled(w, '2.0.0');
    expect(await waitForCall(w, `open ${path.join(w.apps, BUNDLE)}`)).toContain(`open ${path.join(w.apps, BUNDLE)}`);
  });

  test('installs where nothing was installed', async () => {
    const w = fresh();
    expect((await run(w)).code).toBe(0);
    expectInstalled(w, '2.0.0');
  });

  test("cleans up an earlier run's copies", async () => {
    const w = fresh();
    writeApp(path.join(w.apps, BUNDLE), '1.0.0');
    writeApp(path.join(w.apps, `.${BUNDLE}.new-99999`), '2.0.0');
    writeApp(path.join(w.apps, `.${BUNDLE}.old-99998`), '0.9.0');
    expect((await run(w, { FAKE_CURL_CODE: '22' })).code).toBe(1);
    expectInstalled(w, '1.0.0');
  });

  // For each step: where TERM leaves the destination, and where the next run (whose download
  // fails, so it only recovers) leaves it after a KILL there.
  const steps = [
    { step: 'curl', env: { FAKE_PAUSE: 'curl' }, afterTerm: '1.0.0', afterKill: '1.0.0' },
    { step: 'cp', env: { FAKE_PAUSE: 'cp' }, afterTerm: '1.0.0', afterKill: '1.0.0' },
    { step: 'the first rename', swap: 1, afterTerm: '2.0.0', afterKill: '1.0.0' },
    { step: 'the second rename', swap: 2, afterTerm: '2.0.0', afterKill: '2.0.0' }
  ];
  for (const { step, env, swap, afterTerm, afterKill } of steps) {
    for (const signal of ['SIGTERM', 'SIGKILL']) {
      test(`${signal} at ${step}`, async () => {
        const w = fresh();
        writeApp(path.join(w.apps, BUNDLE), '1.0.0');
        let result;
        if (swap) {
          result = await run(w, { FAKE_SWAP: `${signal}-${swap}` });
        } else {
          const { child, exited } = start(w, env);
          await pausedAt(w, exited, step);
          // hypersave stops the canary this way: the signal goes to the whole process group.
          process.kill(-child.pid, signal);
          result = await exited;
        }
        if (signal === 'SIGTERM') {
          if (swap) {
            expect(result.code).toBe(143);
            expect(calls(w)).not.toContain('open ');
          }
          expectInstalled(w, afterTerm);
          return;
        }
        const dest = completeVersion(path.join(w.apps, BUNDLE));
        const aside = leftovers(w).filter((name) => name.startsWith(`.${BUNDLE}.old-`));
        expect(dest !== '' || (aside.length === 1 && completeVersion(path.join(w.apps, aside[0])) !== '')).toBe(true);
        expect((await run(w, { FAKE_CURL_CODE: '22' })).code).toBe(1);
        expectInstalled(w, afterKill);
      });
    }
  }
});
