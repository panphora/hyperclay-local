/**
 * EchoWindow — tracks recently applied SSE node-saved events so the local
 * watcher can distinguish "file changed because SSE just wrote it" from
 * "file changed because the user edited it" and suppress a redundant reload
 * toast.
 *
 * Used only for toast suppression. Distinct from Outbox, which tracks our
 * OWN in-flight mutations; EchoWindow tracks mutations coming IN from SSE.
 *
 * Entries auto-expire via a per-entry setTimeout (default 5s) — the window
 * in which the chokidar watcher is expected to observe the written file.
 */

class EchoWindow {
  constructor({ ttlMs = 5000 } = {}) {
    this._ttlMs = ttlMs;
    this._recent = new Map(); // "nodeType:nodeId" → expiresAt ms
    this._timers = new Map(); // "nodeType:nodeId" → Timeout id
  }

  /**
   * Record an SSE node-saved event as recently applied.
   */
  mark(nodeType, nodeId) {
    const key = `${nodeType}:${nodeId}`;
    this._recent.set(key, Date.now() + this._ttlMs);

    const prev = this._timers.get(key);
    if (prev) clearTimeout(prev);

    const timerId = setTimeout(() => {
      this._recent.delete(key);
      this._timers.delete(key);
    }, this._ttlMs);
    this._timers.set(key, timerId);
  }

  /**
   * Was this nodeType/nodeId marked within the TTL window?
   */
  isRecent(nodeType, nodeId) {
    const key = `${nodeType}:${nodeId}`;
    const expiresAt = this._recent.get(key);
    if (expiresAt === undefined) return false;
    if (expiresAt < Date.now()) {
      this._recent.delete(key);
      const prev = this._timers.get(key);
      if (prev) clearTimeout(prev);
      this._timers.delete(key);
      return false;
    }
    return true;
  }

  clear() {
    for (const timerId of this._timers.values()) {
      clearTimeout(timerId);
    }
    this._timers.clear();
    this._recent.clear();
  }

  get size() {
    return this._recent.size;
  }
}

module.exports = EchoWindow;
