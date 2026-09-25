/**
 * The session state machine (C3 §5.6).
 *
 * One runner per session: it owns the stream's lifetime, decides when a
 * reconcile may start (only after the stream's `sync-ready`), buffers node
 * frames that arrive before the inventory, turns live frames into
 * invalidations, and classifies every failure into the session's next state —
 * pause, rediscover, fatal, or a backoff that ends in a restart.
 *
 * Nothing reconciles before `sync-ready`. A migrated personal session imports
 * its legacy baseline before it reconciles anything (C3.8); every other session
 * reconciles the inventory it listed. Every async continuation is fenced by the
 * generation it started under: a pause, a restart or a stop bumps the
 * generation and aborts the signal the engine was handed, so the stale one
 * writes nothing.
 */

const EventEmitter = require('events').EventEmitter;
const { classifyError } = require('./classify-error');
const { importLegacyMeta } = require('./legacy-import');

const READY_TIMEOUT_MS = 30_000;
const BACKOFF_MS = [5_000, 15_000, 60_000];

function withTimeout(promise, ms, message) {
  let timer = null;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

class SessionRunner extends EventEmitter {
  constructor({ engine, api, stream, manager, entry = null, clock = Date }) {
    super();
    Object.assign(this, { engine, api, stream, manager, entry, clock });
    this.state = 'stopped';
    this.generation = 0;
    this.abort = null;
    this.backoffIndex = 0;
    this.invalidations = Promise.resolve();
    this.pendingNodes = new Map();
    this.lastError = null;
  }

  async start() {
    const gen = this.#bump('starting');
    // A resume, a rediscover or a backoff restart never reconciles into a missing folder.
    if (!this.engine.rootPresent()) return this.pause('folder-missing');
    // C3.11: every path into a live session comes through here — a resume, a
    // rediscover, the restart a backoff ends in, and the first start of a
    // session whose init ran no passes (paused at launch, or offline). A
    // session that already watches its folder keeps the subscription it has.
    this.engine.startUnifiedWatcher?.();
    const invalidated = new Set();
    let ready;
    const readyFrame = new Promise((resolve, reject) => { ready = { resolve, reject }; });

    try {
      // C3 \u00a75.9 step 1: a protocol 2 session names its account on every request,
      // and discovery names the personal account a migrated session cannot name
      // yet. Identifying it before the stream opens is what keeps the connect
      // from being refused (428, CONTRACTS \u00a72); offline, the failure below goes
      // to the backoff, exactly as a failed connect would.
      if (this.engine.protocol === 2 && this.engine.accountId == null) {
        this.engine.accountId = await this.manager.resolveAccountId(this.entry);
      }

      this.stream.open({
        signal: this.abort.signal,
        onFrame: (frame) => {
          if (gen !== this.generation) return;
          if (frame.data?.type === 'sync-ready') return ready.resolve(frame.data);
          if (frame.data?.type === 'account-changed') return this.#onAccountChanged(gen, frame.data);
          if (frame.data?.type === 'live-sync') return this.engine.relayLiveFrame(frame.data);
          if (frame.data?.type === 'control') {
            return Promise.resolve(this.engine.handleControlFrame(frame.data)).catch((error) => {
              this.lastError = (error && error.message) || null;
            });
          }
          if (this.state === 'live') return this.#enqueueInvalidation(gen, frame.data);
          if (frame.data?.nodeId != null) invalidated.add(String(frame.data.nodeId));
        },
        onError: (error) => this.#onError(gen, error),
      });

      // A legacy (protocol 1) stream never sends sync-ready; its adapter hands
      // the connect itself over as the ready signal.
      const readyData = await withTimeout(readyFrame, READY_TIMEOUT_MS, 'sync-ready timeout');
      if (gen !== this.generation) return;
      if (!readyData.sync?.enabled) return this.pause(readyData.sync?.reason || 'forbidden');
      this.#set('reconciling');
      const inventory = await this.api.listNodes({ signal: this.abort.signal });
      if (gen !== this.generation) return;
      if (inventory.complete !== true) {
        throw Object.assign(new Error('inventory incomplete'), { statusCode: 503, code: 'inventory-incomplete' });
      }
      await this.#firstPass(inventory, gen);
      if (gen !== this.generation) return;
      for (const nodeId of invalidated) await this.engine.refreshNode(nodeId, { generation: gen });
      if (gen !== this.generation) return;
      this.backoffIndex = 0;
      this.#set('live');
    } catch (error) {
      this.#onError(gen, error);
    }
  }

  /**
   * The session's first pass (C3 §5.9). A migrated personal session proves its
   * identity through discovery, imports its legacy metadata and reconciles once
   * with `bootstrap: true`; offline that fails here, so the session backs off
   * and reconciles nothing until it is identified. Every other session
   * reconciles the inventory it listed, and only once.
   */
  async #firstPass(inventory, gen) {
    const pending = this.engine.legacyImport;
    if (!pending) {
      await this.engine.reconcileAll(inventory, { generation: gen, signal: this.abort.signal });
      return;
    }

    const result = await importLegacyMeta(pending.entry, {
      ...pending.options,
      inventory,
      generation: gen,
      signal: this.abort.signal,
    });
    if (gen !== this.generation) return;
    if (!result.ok) throw Object.assign(new Error(result.reason || result.error), { code: result.error });
    // The session works in its v2 directory from here on: no second import.
    this.engine.legacyImport = null;
  }

  /**
   * C3.11: a session discovery paused before its start is already persisted, so
   * the caller that holds that reason passes `persist: false` and the earlier
   * `since` stands. It persists before it announces: a 'state' listener builds
   * the popover's snapshot synchronously from settings.
   */
  pause(reason, { persist = true } = {}) {
    if (persist) this.manager.persistPaused(this.engine.sessionId, reason);
    this.#bump('paused');
    this.stream.close();
    this.engine.dropPendingWork();
    this.emit('paused', { reason });
  }

  resume() {
    this.manager.persistPaused(this.engine.sessionId, null);
    return this.start();
  }

  stop() {
    this.#bump('stopped');
    this.stream.close();
    this.engine.dropPendingWork();
  }

  whenIdle() {
    return this.engine.whenQueueEmpty().then(() => this.state);
  }

  #bump(state) {
    this.generation += 1;
    if (this.abort) this.abort.abort();
    this.abort = new AbortController();
    this.#set(state);
    return this.generation;
  }

  #set(state) {
    this.state = state;
    this.emit('state', state);
  }

  /**
   * One promise chain per session, coalesced by node id: a later frame for a
   * node already queued replaces the earlier one, and the node is refreshed
   * once. The frame's own body is never applied — the refresh reads the
   * current state and `decide` decides.
   */
  #enqueueInvalidation(gen, data) {
    const nodeId = data?.nodeId;
    if (nodeId == null) return;
    const id = String(nodeId);
    const queued = this.pendingNodes.has(id);
    this.pendingNodes.set(id, data);
    if (queued) return;

    this.invalidations = this.invalidations
      .then(() => this.#refreshQueued(gen, id))
      .catch(() => {});
    return this.invalidations;
  }

  async #refreshQueued(gen, id) {
    this.pendingNodes.delete(id);
    if (gen !== this.generation) return;
    try {
      await this.engine.refreshNode(id, { generation: gen });
    } catch (error) {
      this.#onError(gen, error);
    }
  }

  #onAccountChanged(gen, data) {
    if (gen !== this.generation) return;
    this.stream.close();
    // The key belongs to the install, not the session: every session is done with it.
    if (data.reason === 'key-revoked') return this.manager.pauseAll('key-revoked');
    this.#rediscover(gen, data.reason);
  }

  #rediscover(gen, reason) {
    Promise.resolve(this.manager.rediscover({ reason, sessionId: this.engine.sessionId })).catch((error) => {
      if (gen !== this.generation) return;
      const c = classifyError(error);
      this.lastError = (error && error.message) || null;
      if (c.kind === 'pause-all') return this.manager.pauseAll(c.reason);
      if (c.kind === 'pause') return this.pause(c.reason);
      if (c.kind === 'offline' || c.kind === 'backoff') return this.#backoff(c);
      return this.pause('unavailable');
    });
  }

  #onError(gen, error) {
    if (gen !== this.generation) return;
    const c = classifyError(error);
    // C3 §5.6: the last error the runner classified, for the card's own detail
    // line. The transitions below stay exactly as they are.
    this.lastError = (error && error.message) || null;
    if (c.kind === 'pause') return this.pause(c.reason);
    if (c.kind === 'pause-all') return this.manager.pauseAll(c.reason);
    if (c.kind === 'rediscover') return this.#rediscover(gen, c.reason);
    if (c.kind === 'fatal') {
      this.#bump('error');
      this.emit('fatal', c);
      return;
    }
    return this.#backoff(c);
  }

  #backoff(c) {
    const delay = c.retryAfterMs ?? BACKOFF_MS[Math.min(this.backoffIndex++, BACKOFF_MS.length - 1)];
    this.#bump('offline');
    const offlineGen = this.generation;
    setTimeout(() => { if (offlineGen === this.generation) this.start(); }, delay).unref?.();
  }
}

module.exports = { SessionRunner };
