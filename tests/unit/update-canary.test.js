const { EventEmitter } = require('events');
const { runCanary, exitCodeFor, FLAG, CAPABILITY_KEY, DEADLINE_MS, FALLBACK_BY_MS, RESEND_MS } = require('../../scripts/update-canary');
const { createUpdater, parseUpdateNowArg, REQUEST_TTL_MS } = require('../../src/main/updater');

const EXE = '/Applications/HyperclayLocal.app/Contents/MacOS/HyperclayLocal';
const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });

// A Mac with one Hyperclay Local. `app` is what holds the SingletonLock (null when nothing
// runs); `respond(count, mac)` plays the app's side of each trigger; `onSleep(mac)` lets
// time-based events (Squirrel relaunching the new version) happen between polls.
function fakeMac({ app = { pid: 1839, version: '1.30.3', capable: true }, respond = () => {}, onSleep = () => {}, install = async () => {} } = {}) {
  const mac = {
    clock: 1_800_000_000_000,
    app,
    installed: app ? app.version : '1.30.3',
    request: null,
    triggers: [],
    installs: [],
    logs: [],
    answer(state, reason = null, retry = false) {
      mac.request = { version: mac.triggers[mac.triggers.length - 1].version, state, reason, retry, pid: mac.app.pid, at: new Date(mac.clock + 50).toISOString() };
    }
  };
  mac.deps = {
    readLock: () => { if (!mac.app) throw enoent(); return `panphora.local-${mac.app.pid}`; },
    alive: (pid) => !!mac.app && mac.app.pid === pid,
    executableOf: (pid) => (mac.app && mac.app.pid === pid ? EXE : ''),
    plist: (bundle, key) => {
      if (key === 'CFBundleShortVersionString') return mac.app ? mac.app.version : mac.installed;
      if (key === CAPABILITY_KEY) return mac.app && mac.app.capable ? '1' : null;
      return null;
    },
    readRequest: () => { if (!mac.request) throw enoent(); return JSON.stringify(mac.request); },
    trigger: (exe, version) => {
      mac.triggers.push({ exe, version, at: mac.clock });
      respond(mac.triggers.length, mac);
    },
    install: async (version) => { mac.installs.push(version); await install(version); },
    now: () => mac.clock,
    sleep: async (ms) => { mac.clock += ms; onSleep(mac); },
    log: (line) => mac.logs.push(line)
  };
  return mac;
}

describe('update canary', () => {
  test('a capable running app updates itself: the trigger is re-sent until the feed offers the version, then a new pid runs it', async () => {
    let installingAt = null;
    const mac = fakeMac({
      respond: (count, m) => {
        if (count === 1) m.answer('checking');
        else { m.answer('installing'); installingAt = m.clock; }
      },
      onSleep: (m) => {
        if (installingAt !== null && m.clock - installingAt >= 20_000) m.app = { pid: 2001, version: '1.31.0', capable: true };
      }
    });
    const result = await runCanary('1.31.0', mac.deps);
    expect(result).toEqual({ app: 'hyperclay-local', outcome: 'self-updated', from: '1.30.3', to: '1.31.0', reason: null, seconds: 50, retry: false });
    expect(exitCodeFor(result)).toBe(0);
    expect(mac.triggers.map((t) => [t.exe, t.version, t.at - 1_800_000_000_000])).toEqual([[EXE, '1.31.0', 0], [EXE, '1.31.0', 30_000]]);
    expect(mac.installs).toEqual([]);
  });

  test('the trigger flag is the one the app parses, and the capability key is the one package.json writes', () => {
    expect(parseUpdateNowArg([EXE, `${FLAG}1.31.0`])).toBe('1.31.0');
    expect(require('../../package.json').build.mac.extendInfo[CAPABILITY_KEY]).toBe(1);
  });

  test('an app that is not running is installed the old way and never started by a trigger', async () => {
    const mac = fakeMac({ app: null });
    const result = await runCanary('1.31.0', mac.deps);
    expect(result).toMatchObject({ outcome: 'installed', from: '1.30.3', reason: 'Hyperclay Local is not running' });
    expect(exitCodeFor(result)).toBe(10);
    expect(mac.triggers).toEqual([]);
    expect(mac.installs).toEqual(['1.31.0']);
  });

  test('a lock naming a dead pid or another program counts as not running', async () => {
    const dead = fakeMac();
    dead.deps.alive = () => false;
    expect(await runCanary('1.31.0', dead.deps)).toMatchObject({ outcome: 'installed', reason: 'Hyperclay Local is not running' });
    const other = fakeMac();
    other.deps.executableOf = () => '/usr/bin/vim';
    expect(await runCanary('1.31.0', other.deps)).toMatchObject({ outcome: 'installed' });
    expect([...dead.triggers, ...other.triggers]).toEqual([]);
  });

  test('a build without the capability key is installed the old way without a trigger', async () => {
    const mac = fakeMac({ app: { pid: 1839, version: '1.30.3', capable: false } });
    const result = await runCanary('1.31.0', mac.deps);
    expect(result).toMatchObject({ outcome: 'installed', reason: 'The running 1.30.3 predates the update trigger' });
    expect(mac.triggers).toEqual([]);
  });

  test('a running capable app that refuses is a failure, and nothing is installed or killed', async () => {
    const mac = fakeMac({ respond: (count, m) => m.answer('refused', 'This copy cannot replace itself, so it only offers the download link.') });
    const result = await runCanary('1.31.0', mac.deps);
    expect(result).toMatchObject({ outcome: 'failed', reason: 'The app refused: This copy cannot replace itself, so it only offers the download link.', retry: false });
    expect(exitCodeFor(result)).toBe(1);
    expect(mac.installs).toEqual([]);
    expect(mac.triggers).toHaveLength(1);
  });

  test('a sync that stays busy is reported as a refusal to retry later, and nothing is installed or killed', async () => {
    const mac = fakeMac({ respond: (count, m) => m.answer('busy', 'Sync has unsent changes. Update after it finishes.', true) });
    const result = await runCanary('1.31.0', mac.deps);
    expect(result).toMatchObject({ outcome: 'failed', reason: 'Refused: Sync has unsent changes. Update after it finishes.', retry: true, seconds: DEADLINE_MS / 1000 });
    expect(exitCodeFor(result)).toBe(1);
    expect(mac.installs).toEqual([]);
    expect(mac.triggers).toHaveLength(DEADLINE_MS / 30_000);
  });

  test('a sync that clears while the canary waits lets a later trigger install', async () => {
    const mac = fakeMac({
      respond: (count, m) => {
        if (count < 3) { m.answer('busy', 'Sync has unsent changes. Update after it finishes.', true); return; }
        m.answer('installing');
        m.app = { pid: 2001, version: '1.31.0', capable: true };
      }
    });
    expect(await runCanary('1.31.0', mac.deps)).toMatchObject({ outcome: 'self-updated' });
    expect(mac.triggers).toHaveLength(3);
  });

  test('a failure after acceptance is reported and never followed by the old install', async () => {
    const mac = fakeMac({ respond: (count, m) => m.answer('failed', 'Squirrel could not install the staged bundle') });
    const result = await runCanary('1.31.0', mac.deps);
    expect(result).toMatchObject({ outcome: 'failed', reason: 'Squirrel could not install the staged bundle', retry: false });
    expect(mac.installs).toEqual([]);
  });

  test('an accepted download keeps being re-sent, so the app keeps the request alive, and a deadline while downloading can be retried', async () => {
    const mac = fakeMac({ respond: (count, m) => m.answer('accepted') });
    const result = await runCanary('1.31.0', mac.deps);
    expect(result).toMatchObject({ outcome: 'failed', reason: 'The app was still downloading 1.31.0 at the deadline', retry: true });
    expect(mac.triggers).toHaveLength(DEADLINE_MS / RESEND_MS);
    expect(mac.installs).toEqual([]);
  });

  test('once the app answers installing nothing is re-sent, and an install that never comes up cannot be retried', async () => {
    const mac = fakeMac({ respond: (count, m) => m.answer(count === 1 ? 'draining' : 'installing') });
    const result = await runCanary('1.31.0', mac.deps);
    expect(result).toMatchObject({ outcome: 'failed', reason: 'The app began installing 1.31.0 but was not running it by the deadline', retry: false });
    expect(mac.triggers).toHaveLength(2);
    expect(mac.installs).toEqual([]);
  });

  test('an app that quits after installing began is waited for, never triggered or replaced', async () => {
    const mac = fakeMac({
      respond: (count, m) => { m.answer('installing'); },
      onSleep: (m) => {
        const since = m.clock - 1_800_000_000_000;
        if (since === 10_000) m.app = null;
        if (since === 40_000) m.app = { pid: 2001, version: '1.31.0', capable: true };
      }
    });
    expect(await runCanary('1.31.0', mac.deps)).toMatchObject({ outcome: 'self-updated' });
    expect(mac.triggers).toHaveLength(1);
    expect(mac.installs).toEqual([]);
  });

  test('a deadline while sync is still draining can be retried, even when the last answer was draining rather than busy', async () => {
    const mac = fakeMac({ respond: (count, m) => m.answer(count % 2 ? 'busy' : 'draining', count % 2 ? 'Sync has unsent changes. Update after it finishes.' : null, count % 2 === 1) });
    const result = await runCanary('1.31.0', mac.deps);
    expect(mac.request.state).toBe('draining');
    expect(result).toMatchObject({ outcome: 'failed', reason: 'Refused: Sync has unsent changes. Update after it finishes.', retry: true });
    const slow = fakeMac({ respond: (count, m) => m.answer('draining') });
    expect(await runCanary('1.31.0', slow.deps)).toMatchObject({ outcome: 'failed', reason: 'The app was still waiting for sync before installing 1.31.0', retry: true });
    expect([...mac.installs, ...slow.installs]).toEqual([]);
  });

  test('an app that quits after accepting, before installing began, is a failure to retry and is not replaced', async () => {
    const mac = fakeMac({ respond: (count, m) => { m.answer('accepted'); m.app = null; } });
    const result = await runCanary('1.31.0', mac.deps);
    expect(result).toMatchObject({ outcome: 'failed', reason: 'Hyperclay Local quit before it began installing the update', retry: true });
    expect(mac.installs).toEqual([]);
  });

  test('an app restarted by the user before accepting is left running: a failure to retry, never the old install', async () => {
    const mac = fakeMac({ respond: (count, m) => { m.answer('checking'); m.app = { pid: 1902, version: '1.30.3', capable: true }; } });
    const result = await runCanary('1.31.0', mac.deps);
    expect(result).toMatchObject({ outcome: 'failed', reason: 'Hyperclay Local restarted before it began installing the update', retry: true });
    expect(mac.installs).toEqual([]);
    expect(mac.triggers).toHaveLength(1);
  });

  test('an answer written before the trigger is ignored', async () => {
    const mac = fakeMac();
    mac.request = { version: '1.31.0', state: 'refused', reason: 'stale', retry: false, pid: 1839, at: new Date(mac.clock - 1000).toISOString() };
    const result = await runCanary('1.31.0', mac.deps);
    expect(result).toMatchObject({ outcome: 'failed', reason: 'The app never answered the update request', retry: true });
    expect(mac.installs).toEqual([]);
  });

  test('an answer from another pid is ignored', async () => {
    const mac = fakeMac({ respond: (count, m) => { m.answer('refused', 'other app'); m.request.pid = 77; } });
    const result = await runCanary('1.31.0', mac.deps);
    expect(result).toMatchObject({ outcome: 'failed', reason: 'The app never answered the update request', retry: true });
    expect(mac.installs).toEqual([]);
  });

  test('an app that quits before accepting is never restarted by a trigger', async () => {
    const mac = fakeMac({ respond: (count, m) => { m.answer('checking'); m.app = null; } });
    const result = await runCanary('1.31.0', mac.deps);
    expect(result).toMatchObject({ outcome: 'installed', reason: 'Hyperclay Local quit before it accepted the update' });
    expect(mac.triggers).toHaveLength(1);
  });

  test('an app that quits too late to finish a fallback install is reported instead', async () => {
    const mac = fakeMac({ respond: (count, m) => { m.answer('checking'); if (m.clock - 1_800_000_000_000 >= FALLBACK_BY_MS) m.app = null; } });
    const result = await runCanary('1.31.0', mac.deps);
    expect(result).toMatchObject({ outcome: 'failed', reason: 'Hyperclay Local quit before it accepted the update, too late for a fallback install', retry: true });
    expect(mac.installs).toEqual([]);
  });

  test('a fallback install that fails is a failure', async () => {
    const mac = fakeMac({ app: null, install: async () => { throw new Error('curl: (22) 404'); } });
    expect(await runCanary('1.31.0', mac.deps)).toMatchObject({ outcome: 'failed', reason: 'Hyperclay Local is not running; the fallback install failed: curl: (22) 404' });
  });

  test('already on the version is success without a trigger; a newer running app or a bad version is a failure', async () => {
    const same = fakeMac({ app: { pid: 1839, version: '1.31.0', capable: true } });
    expect(await runCanary('1.31.0', same.deps)).toMatchObject({ outcome: 'self-updated', reason: 'Already running 1.31.0' });
    const newer = fakeMac({ app: { pid: 1839, version: '1.32.0', capable: true } });
    expect(await runCanary('1.31.0', newer.deps)).toMatchObject({ outcome: 'failed', reason: 'Running 1.32.0, which is newer than 1.31.0' });
    const bad = fakeMac();
    expect(await runCanary('1.31', bad.deps)).toMatchObject({ outcome: 'failed', reason: 'Not a version: 1.31' });
    expect([...same.triggers, ...newer.triggers, ...bad.triggers, ...same.installs, ...newer.installs, ...bad.installs]).toEqual([]);
  });
});

// The canary driving the real updater: each trigger calls updateNow, and every answer the
// updater reports is what the canary reads back from update-request.json.
describe('update canary against the real updater', () => {
  function wired({ installInPlace = true, prepareForInstall = async () => {} } = {}) {
    const w = { now: 1_800_000_000_000, request: null, drains: 0, quits: 0, fallbacks: 0 };
    w.autoUpdater = Object.assign(new EventEmitter(), {
      setFeedURL: () => {},
      checkForUpdates: async () => null,
      quitAndInstall: () => { w.quits += 1; }
    });
    w.nativeUpdater = new EventEmitter();
    w.updater = createUpdater({
      currentVersion: '1.30.3',
      installInPlace,
      installOnQuit: true,
      autoUpdater: installInPlace ? w.autoUpdater : null,
      nativeUpdater: installInPlace ? w.nativeUpdater : null,
      fetchJson: async () => null,
      prepareForInstall: async () => { w.drains += 1; await prepareForInstall(); },
      onChange: () => {},
      onRequest: (record) => { w.request = { ...record, pid: 1839, at: new Date(w.now).toISOString() }; },
      logger: { log: () => {} },
      timers: { setTimeout: () => {}, setInterval: () => {} },
      now: () => w.now
    });
    w.updater.start();
    w.deps = {
      readLock: () => 'panphora.local-1839',
      alive: () => true,
      executableOf: () => EXE,
      plist: (bundle, key) => (key === CAPABILITY_KEY ? '1' : '1.30.3'),
      readRequest: () => { if (!w.request) throw enoent(); return JSON.stringify(w.request); },
      trigger: (exe, version) => w.updater.updateNow(version),
      install: async () => { w.fallbacks += 1; },
      now: () => w.now,
      sleep: async (ms) => { w.now += ms; await new Promise((resolve) => setImmediate(resolve)); },
      log: () => {}
    };
    return w;
  }

  test('a copy that cannot replace itself refuses, and the canary neither drains nor falls back', async () => {
    const w = wired({ installInPlace: false });
    const result = await runCanary('1.31.0', w.deps);
    expect(result).toMatchObject({ outcome: 'failed', reason: 'The app refused: This copy cannot replace itself, so it only offers the download link.', retry: false });
    expect([w.drains, w.fallbacks]).toEqual([0, 0]);
  });

  test('a canary that gave up leaves no request behind: the feed offering the version hours later never restarts the app', async () => {
    const w = wired();
    const result = await runCanary('1.31.0', w.deps);
    expect(result).toMatchObject({ outcome: 'failed', reason: 'The update feed never offered 1.31.0 to the app', retry: true });
    expect(RESEND_MS * 2).toBeLessThanOrEqual(REQUEST_TTL_MS);
    w.now += 6 * 60 * 60 * 1000;
    w.autoUpdater.emit('update-available', { version: '1.31.0' });
    w.nativeUpdater.emit('update-downloaded');
    await new Promise((resolve) => setImmediate(resolve));
    expect(w.quits).toBe(0);
    expect(w.updater.get()).toMatchObject({ state: 'ready', latestVersion: '1.31.0' });
  });

  test('a sync that never drains ends in a failure to retry, with the app untouched', async () => {
    const w = wired({ prepareForInstall: async () => { w.now += 30_000; throw new Error('Sync has unsent changes. Update after it finishes.'); } });
    w.autoUpdater.emit('update-available', { version: '1.31.0' });
    w.nativeUpdater.emit('update-downloaded');
    const result = await runCanary('1.31.0', w.deps);
    expect(result).toMatchObject({ outcome: 'failed', retry: true });
    expect([w.quits, w.fallbacks]).toEqual([0, 0]);
    expect(w.drains).toBeGreaterThan(5);
  });
});
