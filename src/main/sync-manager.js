const { EventEmitter } = require('events');
const os = require('os');
const path = require('upath');
const crypto = require('crypto');
const fs = require('fs').promises;
const { SyncEngine } = require('../sync-engine');
const { SyncLogger } = require('../sync-engine/logger');
const { getAccounts, listNodes } = require('../sync-engine/api-client');
const { SessionRunner } = require('../sync-engine/reconcile/session-runner');
const { firstBind, inventoryTotals, BIND_MARKER } = require('../sync-engine/reconcile/first-bind');
const { validateRootPath, defaultTeamFolder, allocateTeamPort } = require('./roots');
const { realpathNearestParent } = require('./utils/path-resolver');
const { createRootLive } = require('./utils/root-live');
const { RootObserver } = require('./root-observer');

const FORWARDED = ['sync-start', 'sync-complete', 'sync-error', 'file-synced', 'sync-stats',
  'backup-created', 'sync-retry', 'sync-failed'];
const MAX_CONCURRENT_INITIAL = 2;

async function pathExists(dir) {
  try {
    await fs.stat(dir);
    return true;
  } catch {
    return false;
  }
}

async function dirIsEmpty(dir) {
  try {
    return (await fs.readdir(dir)).length === 0;
  } catch {
    return false;
  }
}

// CONTRACTS §1: every feature must be on for a session to sync. Any false one
// is "server update required", never a guess at an older contract.
const REQUIRED_FEATURES = ['accountScopes', 'accountEvents', 'conditionalContent',
  'conditionalStructure', 'completeInventory'];

function allFeaturesOn(discovery) {
  const features = (discovery && discovery.features) || {};
  return REQUIRED_FEATURES.every((name) => features[name] === true);
}

class SyncManager extends EventEmitter {
  constructor({ userData, deviceId, serverUrl, getApiKey, settingsStore, observerFor = null, takeSnapshot = () => null }) {
    super();
    Object.assign(this, { userData, deviceId, serverUrl, getApiKey, settingsStore, takeSnapshot });
    this.ownObservers = new Map();
    this.observerFor = observerFor || ((rootId) => this._ownObserver(rootId));
    this.sessions = new Map();
    this.initialRunning = 0;
    this.initialWaiters = [];
  }

  /** The session's own metadata directory, once its legacy one is behind it. */
  v2MetaDir(session) {
    return path.join(this.userData, 'sync-meta', 'v2', session.id);
  }

  metaDirFor(session) {
    return session.legacyMetaDir
      ? path.join(this.userData, 'sync-meta', session.legacyMetaDir)
      : this.v2MetaDir(session);
  }

  /**
   * C3 §5.9 step 5: the legacy import proved the session's identity, so the
   * personal session takes the account discovery named it and moves to its v2
   * directory. `metaDirFor` answers with `sync-meta/v2/<sessionId>/` from here.
   */
  adoptLegacyIdentity(session, { accountId }) {
    session.accountId = accountId;
    session.legacyMetaDir = null;
    this.settingsStore.save(this.settingsStore.get());
  }

  /**
   * C3.8: what this session's first pass is. A migrated personal session whose
   * legacy metadata is not imported yet imports it (C3 §5.9); a team session
   * whose bind was interrupted by a quit resumes that bind (C3 §5.8); every
   * other session reconciles normally.
   */
  async firstPassFor(session) {
    if (session.legacyMetaDir) return 'import';
    return await pathExists(path.join(this.metaDirFor(session), BIND_MARKER)) ? 'bind' : null;
  }

  async start(session, root, { syncBase = '/_/sync', protocol = 1, firstBind = false } = {}) {
    if (this.sessions.has(session.id)) return { success: true };
    const apiKey = this.getApiKey();
    if (!apiKey) return { success: false, error: 'no-key' };

    const metaDir = this.metaDirFor(session);
    const setup = firstBind === true;
    const resumed = setup ? null : await this.firstPassFor(session);
    // A bind and an import own the session's first pass, so init runs no passes
    // and opens no stream of its own. Both read the complete inventory only
    // protocol 2 lists, and the import works in the session's v2 directory
    // while `legacyMetaDir` still points at the legacy one.
    const ownsFirstPass = setup || resumed !== null;

    const logger = new SyncLogger();
    await logger.init(root.path, { subdir: session.id });
    const engine = new SyncEngine();
    engine.setLogger(logger);
    const tags = { sessionId: session.id, rootId: root.id, accountId: session.accountId };
    const listeners = FORWARDED.map((name) => {
      const fn = (data) => this.emit(name, { ...data, ...tags });
      engine.on(name, fn);
      return [name, fn];
    });
    const observer = this.observerFor(root.id);
    observer.setRemoteApplyCheck((rel) => engine.isRecentRemoteApply(rel));
    const entry = { session, root, engine, logger, listeners, observer, runner: null };
    this.sessions.set(session.id, entry);
    // The session's stream belongs to its runner (C3.7), so it is attached
    // before init: init opens the legacy transport only when no runner exists.
    this.attachRunner(entry);
    if (resumed === 'import') {
      // The legacy directory stays read-only: the import converts into the
      // session's v2 directory and only `identity.json` moves the session to it
      // (5.9 steps 2 to 5).
      engine.legacyImport = {
        entry,
        options: {
          legacyDir: metaDir,
          metaDir: this.v2MetaDir(session),
          persist: (identity) => this.adoptLegacyIdentity(session, identity),
        },
      };
    }

    await this._acquireInitialSlot();
    try {
      const result = await engine.init(apiKey, session.cached?.username, root.path, this.serverUrl,
        this.deviceId, resumed === 'import' ? this.v2MetaDir(session) : metaDir, {
          sessionId: session.id, accountId: session.accountId,
          syncBase, protocol: ownsFirstPass ? 2 : protocol, firstBind: ownsFirstPass,
          live: createRootLive(root),
          snapshots: { take: (rel) => this.takeSnapshot(rel, root.id) },
          observer,
          logger,
        });
      if (!result.success) {
        await this.stop(session.id);
        return result;
      }
      // A bind saved by an earlier launch is this session's own pass again:
      // the files already there are adopted, the rest is downloaded.
      if (resumed === 'bind') {
        const bind = await this.runBind(entry, {
          metaDir,
          onProgress: (progress) => this.emit('sync-progress', progress),
        }, { drop: false });
        if (!bind.ok) {
          await this.stop(session.id);
          return { success: false, error: bind.error, reason: bind.reason };
        }
      }
      // A first bind is the session's own pass over an empty folder and starts
      // the runner when it is done; every other session runs its runner now.
      if (!setup) this.startRunner(entry);
      return result;
    } finally {
      this._releaseInitialSlot();
    }
  }

  /**
   * C3 §5.6: one state machine per session, owned by the entry and the engine.
   * It opens the session's stream, reconciles once `sync-ready` arrives, turns
   * live frames into invalidations and classifies every failure into the next
   * state.
   */
  attachRunner(entry) {
    const { engine } = entry;
    const runner = new SessionRunner({
      engine,
      api: { listNodes: (options) => listNodes(engine.conn, options) },
      stream: engine.stream,
      manager: this,
    });
    entry.runner = runner;
    engine.runner = runner;
    return runner;
  }

  /** Start the entry's runner. Not awaited: the session is live while it reconciles. */
  startRunner(entry) {
    const runner = entry.runner || this.attachRunner(entry);
    runner.start().catch((error) => {
      if (entry.logger) entry.logger.error('SYNC', 'Session runner failed', { error: error.message });
    });
    return runner;
  }

  async stop(sessionId) {
    const entry = this.sessions.get(sessionId);
    if (!entry) return { success: true };
    this.sessions.delete(sessionId);
    if (entry.runner) {
      entry.runner.stop();
      entry.engine.runner = null;
    }
    entry.observer.setRemoteApplyCheck(null);
    const result = await entry.engine.stop();
    entry.engine.clearApiKey();
    for (const [name, fn] of entry.listeners) entry.engine.off(name, fn);
    return result;
  }

  async stopAll() {
    for (const id of [...this.sessions.keys()]) await this.stop(id);
    for (const obs of this.ownObservers.values()) await obs.stop();
    this.ownObservers.clear();
  }

  // Used only when no observerFor is injected (C6's plain-Node driver, tests).
  _ownObserver(rootId) {
    let obs = this.ownObservers.get(rootId);
    if (!obs) {
      const root = this.settingsStore.get().roots.find((r) => r.id === rootId);
      obs = new RootObserver(root, { live: createRootLive(root) });
      obs.start();
      this.ownObservers.set(rootId, obs);
    }
    return obs;
  }
  get(sessionId) { return this.sessions.get(sessionId)?.engine || null; }
  forRoot(rootId) {
    for (const entry of this.sessions.values()) if (entry.root.id === rootId) return entry.engine;
    return null;
  }
  statuses() {
    return [...this.sessions.values()].map(({ session, root, engine }) => ({
      sessionId: session.id, rootId: root.id, accountId: session.accountId,
      running: engine.isRunning, lastSync: engine.lastSyncedAt, stats: engine.stats,
    }));
  }

  /**
   * Discovery (CONTRACTS §1): the account list every session's eligibility
   * comes from. Runs the reconnect sequence after every refresh.
   */
  async refreshAccounts() {
    const res = await getAccounts({ serverUrl: this.serverUrl, apiKey: this.getApiKey() });
    this.discovery = res;
    this.emit('accounts', res);
    this.onDiscovery(res);
    return res;
  }

  persistPaused(sessionId, reason) {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    entry.session.paused = reason ? { reason, since: new Date().toISOString() } : null;
    this.settingsStore.save(this.settingsStore.get());
  }

  /** Rename is a rebind: same session, root, node map and baseline — a new sync base. */
  rebind(entry, account) {
    entry.session.cached = { username: account.username, displayName: account.displayName, role: account.role };
    entry.engine.syncBase = account.syncBase;
    this.settingsStore.save(this.settingsStore.get());
  }

  /**
   * A refusal that may be a stale permission: ask discovery again and let its
   * answer decide — enabled resumes, absent pauses with `removed`, a second
   * `forbidden` pauses instead of looping.
   */
  async rediscover({ reason, sessionId }) {
    const discovery = await this.refreshAccounts();
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    const account = discovery.accounts.find((a) => a.id === entry.session.accountId);
    if (!account) return entry.runner?.pause(reason === 'unavailable' ? 'unavailable' : 'removed');
    if (!account.sync.enabled) return entry.runner?.pause(account.sync.reason);
    this.rebind(entry, account);
    if (reason === 'forbidden' && entry.lastRediscoverReason === 'forbidden') {
      entry.lastRediscoverReason = null;
      return entry.runner?.pause('forbidden');
    }
    entry.lastRediscoverReason = reason;
    return entry.runner?.start();
  }

  pauseAll(reason) {
    for (const entry of this.sessions.values()) entry.runner?.pause(reason);
  }

  /**
   * After every discovery refresh (launch, wake, the five minute timer, the
   * popover, `account-changed`): a paused session whose cause is gone resumes.
   * `key-revoked` waits for a new key, `port-taken` belongs to C1.
   */
  onDiscovery(discovery) {
    for (const entry of this.sessions.values()) {
      if (!entry.runner || entry.runner.state !== 'paused') continue;
      const reason = entry.session.paused?.reason;
      if (reason === 'key-revoked' || reason === 'port-taken') continue;
      if (reason === 'server-update-required' && !allFeaturesOn(discovery)) continue;
      const account = discovery.accounts.find((a) => a.id === entry.session.accountId);
      if (account?.sync.enabled) { this.rebind(entry, account); entry.runner.resume(); }
    }
  }

  /**
   * C3 §5.8: create the team root and session for one account and bind them.
   * `folder` omitted takes C1's suggested default. The root serves and the
   * files are on disk only once `firstBind` is done; a refusal before the bind
   * marker exists drops what this created, an interrupted bind keeps it so the
   * next start can resume it instead of downloading everything again.
   */
  async setupTeam({
    accountId,
    folder,
    trusted,
    realPathOf = realpathNearestParent,
    home = os.homedir(),
    exists = pathExists,
    isEmptyDir = dirIsEmpty,
    isFree,
    random = Math.random,
  } = {}) {
    if (trusted !== true) return { ok: false, error: 'untrusted' };

    let discovery;
    try {
      discovery = await this.refreshAccounts();
    } catch (error) {
      return { ok: false, error: error.statusCode ? `http-${error.statusCode}` : 'offline' };
    }
    const account = ((discovery && discovery.accounts) || []).find((a) => a.id === accountId);
    if (!account) return { ok: false, error: 'not-found' };
    if (!account.sync || account.sync.enabled !== true) {
      return { ok: false, error: (account.sync && account.sync.reason) || 'forbidden' };
    }

    const settings = this.settingsStore.get();
    const roots = settings.roots || [];
    const chosen = folder || await defaultTeamFolder(account.username, roots, { realPathOf, home, exists, isEmptyDir });
    if (!chosen) return { ok: false, error: 'no-folder' };
    const check = await validateRootPath(chosen, roots, { realPathOf, home });
    if (!check.ok) return { ok: false, error: check.reason };

    const root = {
      id: crypto.randomUUID(),
      kind: 'team',
      path: check.path,
      port: await allocateTeamPort(roots, { isFree, random }),
      trustedAt: new Date().toISOString(),
      formerAccount: null,
    };
    const session = {
      id: crypto.randomUUID(),
      rootId: root.id,
      accountId,
      kind: 'team',
      cached: { username: account.username, displayName: account.displayName, role: account.role },
      paused: null,
      legacyMetaDir: null,
    };

    settings.roots = [...roots, root];
    settings.syncSessions = [...(settings.syncSessions || []), session];
    this.settingsStore.save(settings);
    this.emit('roots-changed', { roots: settings.roots });

    // The engine exists but reconciles nothing: this session's first pass is
    // the bind, which reports progress and checks the disk before it writes.
    const started = await this.start(session, root, { syncBase: account.syncBase, protocol: 2, firstBind: true });
    if (!started.success) {
      this._dropSession(session, root);
      return { ok: false, error: started.error || 'no-key' };
    }

    const entry = this.sessions.get(session.id);
    const result = await this.runBind(entry, {
      account,
      actorId: discovery.actor && discovery.actor.id,
      metaDir: this.metaDirFor(session),
      onProgress: (progress) => this.emit('sync-progress', progress),
    });

    if (result.ok) this.startRunner(entry);
    return result;
  }

  /**
   * C3 §5.8: run one session's first bind — a team setup, or a bind a quit left
   * half done — under one of C2's two initial slots, so no more than two binds
   * download at once. A refusal that wrote nothing drops a freshly created
   * session; `drop: false` keeps a saved one for the next start.
   */
  async runBind(entry, options, { drop = true } = {}) {
    const { session, root } = entry;
    await this._acquireInitialSlot();
    let result;
    try {
      result = await firstBind(entry, options);
    } finally {
      this._releaseInitialSlot();
    }

    if (!result.ok && drop) {
      await this.stop(session.id);
      if (!result.resumable) this._dropSession(session, root);
    }
    return result;
  }

  /** Undo a setup that refused: nothing was downloaded, so nothing is kept. */
  _dropSession(session, root) {
    const settings = this.settingsStore.get();
    settings.roots = (settings.roots || []).filter((r) => r.id !== root.id);
    settings.syncSessions = (settings.syncSessions || []).filter((s) => s.id !== session.id);
    this.settingsStore.save(settings);
    this.emit('roots-changed', { roots: settings.roots });
  }

  /**
   * C3 §5.8: what setting this team up would download — one complete
   * inventory over a temporary protocol 2 connection. No session, root or file
   * is created.
   */
  async previewTeam(accountId) {
    let discovery;
    try {
      discovery = await this.refreshAccounts();
    } catch (error) {
      return { ok: false, error: error.statusCode ? `http-${error.statusCode}` : 'offline' };
    }
    const account = ((discovery && discovery.accounts) || []).find((a) => a.id === accountId);
    if (!account) return { ok: false, error: 'not-found' };

    let inventory;
    try {
      inventory = await listNodes({
        serverUrl: this.serverUrl,
        syncBase: account.syncBase,
        apiKey: this.getApiKey(),
        accountId,
        protocol: 2,
      });
    } catch (error) {
      return { ok: false, error: error.statusCode ? `http-${error.statusCode}` : 'offline' };
    }
    if (!inventory || inventory.complete !== true) return { ok: false, error: 'inventory-incomplete' };

    return { ok: true, ...inventoryTotals(inventory) };
  }

  /** C3 §5.8: the session goes, the folder and its files stay and still serve. */
  async disconnect(sessionId) {
    const entry = this.sessions.get(sessionId);
    const settings = this.settingsStore.get();
    const session = (entry && entry.session) || (settings.syncSessions || []).find((s) => s.id === sessionId);
    if (!session) return { ok: false, error: 'unknown' };

    await this.stop(sessionId);
    const root = (settings.roots || []).find((r) => r.id === session.rootId);
    if (root) {
      root.formerAccount = {
        id: session.accountId ?? null,
        username: (session.cached && session.cached.username) || null,
      };
    }
    settings.syncSessions = (settings.syncSessions || []).filter((s) => s.id !== sessionId);
    this.settingsStore.save(settings);
    this.emit('roots-changed', { roots: settings.roots });
    return { ok: true };
  }

  /** C3 §5.8: every session on the root stops and the root is dropped. */
  async removeRoot(rootId) {
    const settings = this.settingsStore.get();
    if (!(settings.roots || []).some((r) => r.id === rootId)) return { ok: false, error: 'unknown' };

    for (const [sessionId, entry] of [...this.sessions]) {
      if (entry.root.id === rootId) await this.stop(sessionId);
    }
    settings.roots = (settings.roots || []).filter((r) => r.id !== rootId);
    settings.syncSessions = (settings.syncSessions || []).filter((s) => s.rootId !== rootId);
    this.settingsStore.save(settings);
    this.emit('roots-changed', { roots: settings.roots });
    return { ok: true };
  }

  async _acquireInitialSlot() {
    if (this.initialRunning < MAX_CONCURRENT_INITIAL) { this.initialRunning++; return; }
    await new Promise((resolve) => this.initialWaiters.push(resolve));
    this.initialRunning++;
  }
  _releaseInitialSlot() {
    this.initialRunning--;
    const next = this.initialWaiters.shift();
    if (next) next();
  }
}

module.exports = { SyncManager };
