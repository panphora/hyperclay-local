// C6: one human's desktop sync manager in a child process, so two humans never
// share hyperclay-local's module singletons (`livesync-hyperclay`, the
// control-lane handler table). It speaks JSON messages over the fork's IPC
// channel and pins every fetch to the test app's loopback host.
const path = require('path');
const { Agent } = require(process.env.UNDICI_PATH);

const APP_HOST = process.env.APP_HOSTNAME;
const PORT = Number(process.env.APP_PORT);
const dispatcher = new Agent({
  connect: {
    lookup(_h, options, cb) {
      const a = { address: '127.0.0.1', family: 4 };
      return options?.all ? cb(null, [a]) : cb(null, a.address, a.family);
    },
  },
});
const nativeFetch = global.fetch;
global.fetch = (input, init = {}) => {
  const url = new URL(String(input));
  if (url.hostname !== APP_HOST) throw new Error(`driver escaped the test app: ${url.href}`);
  url.port = String(PORT);
  return nativeFetch(url, { ...init, dispatcher });
};

const { SyncManager } = require(path.join(process.env.LOCAL_DIR, 'src/main/sync-manager.js'));

let manager = null;
let apiKey = null;

const handlers = {
  async start({ userData, apiKey: key, roots, sessions = [] }) {
    apiKey = key;
    // The settings store keeps the object in memory: the driver must not touch
    // the human's real settings on disk.
    const settings = { settingsVersion: 2, syncEnabled: true, roots, syncSessions: sessions };
    manager = new SyncManager({
      userData,
      deviceId: `driver-${process.pid}`,
      serverUrl: `http://${APP_HOST}`,
      getApiKey: () => apiKey,
      settingsStore: { get: () => settings, save: () => {} },
    });
    await manager.startEnabledSessions();
    return manager.snapshot();
  },
  async startAll() { await manager.startEnabledSessions(); return manager.snapshot(); },
  async setupTeam({ accountId, folder }) { return manager.setupTeam({ accountId, folder, trusted: true }); },
  async idle({ timeoutMs = 20_000 }) { return manager.whenAllIdle({ timeoutMs }); },
  async snapshot() { return manager.snapshot(); },
  async refresh() { await manager.refreshAccounts(); return manager.snapshot(); },
  async resolve(args) { return manager.resolveConflict(args); },
  async restart({ apiKey: key }) {
    await manager.stopAll();
    apiKey = key;
    await manager.startEnabledSessions();
    return manager.snapshot();
  },
  async stopAll() { await manager.stopAll(); return true; },
  async stop() { await manager.stopAll(); return true; },
};

process.on('message', async ({ id, cmd, args }) => {
  try {
    process.send({ id, ok: true, result: await handlers[cmd](args || {}) });
  } catch (error) {
    process.send({ id, ok: false, error: { message: error.message, code: error.code } });
  }
});
// An orphaned driver never outlives the test that forked it.
process.on('disconnect', () => process.exit(0));
process.send({ ready: true });
