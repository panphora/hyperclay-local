/**
 * Outbox — tracks in-flight mutations so that SSE echoes of our own writes
 * can be detected and skipped.
 *
 * Every time the engine sends a mutation to the server (save, rename, move,
 * delete), it calls markInFlight(op, nodeId). When the same event bounces back
 * via SSE, consumeIfInFlight(op, nodeId) returns true and the handler short-
 * circuits.
 *
 * Entries auto-expire after ttlMs (default 30s) to bound memory if an echo
 * never arrives (e.g. the server rejected the mutation). The engine drives
 * sweep() on a periodic interval.
 */

class Outbox {
  constructor({ ttlMs = 30000 } = {}) {
    this._ttlMs = ttlMs;
    this._inFlight = new Map(); // "op:nodeId" → timestamp ms
  }

  /**
   * Mark a mutation as in-flight. Called right before the API request is made.
   */
  markInFlight(op, nodeId) {
    this._inFlight.set(`${op}:${nodeId}`, Date.now());
  }

  /**
   * If this op/nodeId is in-flight, remove it and return true. Otherwise false.
   * This is the echo-suppression primitive — callers use it to decide whether
   * an incoming SSE event is self-initiated and should be skipped.
   */
  consumeIfInFlight(op, nodeId) {
    const key = `${op}:${nodeId}`;
    if (!this._inFlight.has(key)) return false;
    this._inFlight.delete(key);
    return true;
  }

  /**
   * Drop entries older than ttlMs. Called periodically by the engine's
   * cleanup interval.
   */
  sweep() {
    const cutoff = Date.now() - this._ttlMs;
    for (const [key, ts] of this._inFlight) {
      if (ts < cutoff) this._inFlight.delete(key);
    }
  }

  clear() {
    this._inFlight.clear();
  }

  // --- Introspection for tests and debugging ---

  get size() {
    return this._inFlight.size;
  }

  has(op, nodeId) {
    return this._inFlight.has(`${op}:${nodeId}`);
  }
}

module.exports = Outbox;
