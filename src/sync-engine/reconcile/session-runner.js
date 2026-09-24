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
  constructor({ engine, api, stream, manager, clock = Date }) {
    super();
    Object.assign(this, { engine, api, stream, manager, clock });
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
    const invalidated = new Set();
    let ready;
    const readyFrame = new Promise((resolve, reject) => { ready = { resolve, reject }; });

    this.stream.open({
      signal: this.abort.signal,
      onFrame: (frame) => {
        if (gen !== this.generation) return;
        if (frame.data?.type === 'sync-ready') return ready.resolve(frame.data);
        if (frame.data?.type === 'account-changed') return this.#onAccountChanged(gen, frame.data);
        if (frame.data?.type === 'live-sync') return this.engine.relayLiveFrame(frame.data);
        if (this.state === 'live') return this.#enqueueInvalidation(gen, frame.data);
        if (frame.data?.nodeId != null) invalidated.add(String(frame.data.nodeId));
      },
      onError: (error) => this.#onError(gen, error),
    });

    try {
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

  pause(reason) {
    this.#bump('paused');
    this.stream.close();
    this.engine.dropPendingWork();
    this.manager.persistPaused(this.engine.sessionId, reason);
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
    this.manager.rediscover({ reason: data.reason, sessionId: this.engine.sessionId });
  }

  #onError(gen, error) {
    if (gen !== this.generation) return;
    const c = classifyError(error);
    // C3 §5.6: the last error the runner classified, for the card's own detail
    // line. The transitions below stay exactly as they are.
    this.lastError = (error && error.message) || null;
    if (c.kind === 'pause') return this.pause(c.reason);
    if (c.kind === 'pause-all') return this.manager.pauseAll(c.reason);
    if (c.kind === 'rediscover') return this.manager.rediscover({ reason: c.reason, sessionId: this.engine.sessionId });
    if (c.kind === 'fatal') {
      this.#bump('error');
      this.emit('fatal', c);
      return;
    }
    const delay = c.retryAfterMs ?? BACKOFF_MS[Math.min(this.backoffIndex++, BACKOFF_MS.length - 1)];
    this.#bump('offline');
    const offlineGen = this.generation;
    setTimeout(() => { if (offlineGen === this.generation) this.start(); }, delay).unref?.();
  }
}

module.exports = { SessionRunner };
