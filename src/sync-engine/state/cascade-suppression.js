/**
 * CascadeSuppression — tracks chokidar events that should be silently consumed
 * because they're the aftermath of a folder-level operation already handled
 * via another path (SSE, or direct watcher correlation).
 *
 * When a folder is renamed/moved/deleted locally or by an SSE event, we mark
 * every relative path that will fire as a result so that the chokidar events
 * get swallowed instead of triggering duplicate API calls, nodeMap churn, or
 * echo loops.
 *
 * Entries auto-expire after ttlMs (default 3s) — the window in which chokidar
 * is expected to fire its cascade events. Entries are also one-shot: consume()
 * removes the entry whether or not it was still live.
 *
 * NOTE: the 3-second TTL has known edge cases (slow filesystems or deeply
 * nested trees can emit cascade events after expiry). Replacing it with an
 * operation-token scheme is a separate future fix — this module intentionally
 * preserves current behavior.
 */

class CascadeSuppression {
  constructor({ ttlMs = 3000 } = {}) {
    this._ttlMs = ttlMs;
    this._paths = new Map(); // relPath → expiresAt ms
  }

  /**
   * Mark an array of relative paths for suppression. Called right before
   * a local folder op or after an SSE folder op is applied.
   */
  mark(paths) {
    const expiresAt = Date.now() + this._ttlMs;
    for (const p of paths) {
      this._paths.set(p, expiresAt);
    }
  }

  /**
   * If this path is marked for suppression, remove it and return whether
   * it was still within its TTL. Returns false if unmarked or stale.
   */
  consume(normalizedPath) {
    const expiresAt = this._paths.get(normalizedPath);
    if (expiresAt === undefined) return false;

    this._paths.delete(normalizedPath);
    return expiresAt >= Date.now();
  }

  /**
   * Drop entries whose TTL has elapsed. Called periodically by the engine's
   * cleanup interval.
   */
  sweep() {
    const now = Date.now();
    const expired = [];
    for (const [p, expiresAt] of this._paths) {
      if (expiresAt < now) {
        expired.push(p);
        this._paths.delete(p);
      }
    }
    return expired;
  }

  clear() {
    this._paths.clear();
  }

  get size() {
    return this._paths.size;
  }
}

module.exports = CascadeSuppression;
