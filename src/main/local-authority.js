const fs = require('fs');
const { randomUUID } = require('crypto');

const EVENT_NAMES = new Set(['data', 'data-state', 'data-writer']);
const RATE_LIMIT = Object.freeze({ rate: 25, burst: 40, idleMs: 60 * 1000 });

/** A cold room load failed in a way the transport maps to 404 or 409, not 500. */
class LocalAuthorityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LocalAuthorityError';
    this.code = code;
  }
}

/**
 * The canonical registry of Local live editors and room state, keyed by the
 * resolved canonical file path. One room per file is shared by every logical
 * root alias; each editor connection keeps its own proof (clientId plus conn).
 * Pure in memory: the caller owns the disk boundary (withDocument), time and
 * the room sweep timer.
 */
function createLocalAuthority({ rooms, withDocument, readSaved, now = Date.now, newId = randomUUID } = {}) {
  if (typeof withDocument !== 'function') throw new Error('createLocalAuthority requires withDocument');

  // Required here, never at module load: the server package stays Optional for
  // callers that only touch the other Local modules.
  const core = require('@panphora/clayjs/server/rooms');
  if (!rooms) rooms = core.createRooms({ now });
  if (!readSaved) readSaved = (target) => fs.promises.readFile(target.canonicalPath, 'utf8');

  const registry = new Map();
  const buckets = new Map();
  // One entry per admitted logical root/path/origin. The canonical path is what
  // keys a room, so an alias root shares the room and keeps its own entry.
  const logical = new Map();
  const logicalKey = ({ rootId, logicalPath, origin } = {}) => `${rootId}\n${logicalPath}\n${origin}`;

  const recordFor = (canonicalPath) => {
    let record = registry.get(canonicalPath);
    if (!record) {
      record = { identity: newId(), snapshots: new Set(), members: new Set() };
      registry.set(canonicalPath, record);
    }
    return record;
  };

  const identityAt = (canonicalPath) => registry.get(canonicalPath)?.identity ?? null;

  const sameTarget = (member, target, clientId) => member.clientId === clientId &&
    member.target.rootId === target.rootId &&
    member.target.logicalPath === target.logicalPath &&
    member.target.origin === target.origin;

  function bindTarget({ rootId, logicalPath, canonicalPath, origin, live } = {}) {
    if (typeof canonicalPath !== 'string' || !canonicalPath) throw new Error('bindTarget requires canonicalPath');
    const { identity } = recordFor(canonicalPath);
    const target = Object.freeze({ rootId, logicalPath, canonicalPath, origin, live, identity });
    logical.set(logicalKey(target), target);
    return target;
  }

  /**
   * The target already bound for one logical root/path/origin, or null. Read
   * only: it lets the transport answer a request for a document it has already
   * admitted without resolving the disk again. The canonical path is never
   * inferred from these fields.
   */
  function findBoundTarget({ rootId, logicalPath, origin } = {}) {
    const target = logical.get(logicalKey({ rootId, logicalPath, origin }));
    if (!target) return null;
    const record = registry.get(target.canonicalPath);
    if (!record || record.identity !== target.identity) return null;
    for (const member of record.members) {
      if (sameTarget(member, target, member.clientId)) return member.target;
    }
    return null;
  }

  function registerSnapshot(target, { lane, legacy } = {}) {
    const record = recordFor(target.canonicalPath);
    const entry = { target, lane, legacy: lane === 'live' && legacy === true };
    let disposed = false;
    entry.dispose = () => {
      if (disposed) return;
      disposed = true;
      record.snapshots.delete(entry);
    };
    record.snapshots.add(entry);
    return entry.dispose;
  }

  function connectedIds(canonicalPath) {
    const record = registry.get(canonicalPath);
    if (!record) return [];
    const ids = [];
    for (const member of record.members) if (!ids.includes(member.clientId)) ids.push(member.clientId);
    return ids;
  }

  function registerEditor(target, { clientId, send } = {}) {
    const record = recordFor(target.canonicalPath);
    let closed = false;
    const member = {
      conn: newId(),
      clientId,
      target,
      participating: false,
      send,
      close() {
        if (closed) return;
        closed = true;
        record.members.delete(member);
        const room = rooms.get(target.canonicalPath);
        if (!room) return;
        const remaining = connectedIds(target.canonicalPath);
        if (remaining.includes(clientId)) return;
        const result = rooms.leave(room, clientId, remaining);
        if (result && result.writerChanged) {
          sendTo(target.canonicalPath, 'data-writer', { epoch: room.epoch, writer: result.writer });
        }
      },
    };
    record.members.add(member);
    // A connection is current membership, so a room emptied by a previous
    // sweep must not be dropped under it: revive the same window leave() set.
    const warm = rooms.get(target.canonicalPath);
    if (warm && String(warm.nodeId) === String(target.identity ?? identityAt(target.canonicalPath))) {
      rooms.open(target.canonicalPath, '');
    }
    return member;
  }

  function currentEditor(target, clientId, conn) {
    const record = registry.get(target.canonicalPath);
    if (!record) return null;
    if (target.identity != null && record.identity !== target.identity) return null;
    for (const member of record.members) {
      if (member.conn === conn && sameTarget(member, target, clientId)) return member;
    }
    return null;
  }

  function newestEditor(target, clientId) {
    const record = registry.get(target.canonicalPath);
    if (!record) return null;
    if (target.identity != null && record.identity !== target.identity) return null;
    let newest = null;
    for (const member of record.members) if (sameTarget(member, target, clientId)) newest = member;
    return newest;
  }

  function markParticipating(member) {
    const record = registry.get(member.target.canonicalPath);
    if (!record || !record.members.has(member)) return null;
    member.participating = true;
    return member;
  }

  function hasUnjoinedEditors(canonicalPath) {
    const record = registry.get(canonicalPath);
    if (!record) return false;
    for (const snapshot of record.snapshots) if (snapshot.legacy) return true;
    for (const member of record.members) if (!member.participating) return true;
    return false;
  }

  function sendTo(canonicalPath, event, payload) {
    if (!EVENT_NAMES.has(event)) return 0;
    const record = registry.get(canonicalPath);
    if (!record) return 0;
    let sent = 0;
    for (const member of [...record.members]) {
      if (!record.members.has(member) || typeof member.send !== 'function') continue;
      try {
        member.send(event, payload);
        sent += 1;
      } catch {
        member.close();
      }
    }
    return sent;
  }

  const publish = (canonicalPath, event, payload) => sendTo(canonicalPath, event, payload);

  function publishState(canonicalPath) {
    const record = registry.get(canonicalPath);
    if (!record) return 0;
    const room = rooms.get(canonicalPath);
    if (!room) return 0;
    let sent = 0;
    for (const member of [...record.members]) {
      if (!record.members.has(member) || typeof member.send !== 'function') continue;
      const state = rooms.state(room, member.clientId);
      try {
        member.send('data-state', state);
        sent += 1;
      } catch {
        member.close();
      }
    }
    return sent;
  }

  async function roomFor(target, resolveTarget) {
    const key = target.canonicalPath;
    const identity = target.identity ?? identityAt(key) ?? recordFor(key).identity;
    const warm = rooms.get(key);
    // open() on a room that already exists only revives it (emptySince null), so
    // a connected editor keeps its sequence across a sweep window.
    if (warm && String(warm.nodeId) === String(identity)) return rooms.open(key, '');
    if (!warm && (rooms.size() >= core.LIVE_LIMITS.rooms || !rooms.mayFit(key))) return null;

    return withDocument(resolveTarget, async (currentTarget) => {
      const currentPath = currentTarget?.canonicalPath;
      if (typeof currentPath !== 'string' || !currentPath) {
        throw new LocalAuthorityError('not-found', `no document for ${key}`);
      }
      if (currentPath !== key) throw new LocalAuthorityError('moved', `document moved from ${key}`);
      const currentIdentity = currentTarget.identity ?? identityAt(currentPath);
      if (currentIdentity != null && identity != null && String(currentIdentity) !== String(identity)) {
        throw new LocalAuthorityError('moved', `document identity changed for ${key}`);
      }
      const nodeId = currentIdentity ?? identity;

      const opened = rooms.get(currentPath);
      if (opened && String(opened.nodeId) === String(nodeId)) return rooms.open(currentPath, '');
      if (!opened && (rooms.size() >= core.LIVE_LIMITS.rooms || !rooms.mayFit(currentPath))) return null;

      let html;
      try {
        html = await readSaved(currentTarget);
      } catch (err) {
        if (err && err.code === 'ENOENT') throw new LocalAuthorityError('not-found', `no saved file for ${key}`);
        throw err;
      }
      if (html === null || html === undefined) throw new LocalAuthorityError('not-found', `no saved file for ${key}`);

      const held = rooms.get(currentPath);
      if (held) return rooms.reset(currentPath, html, { nodeId });
      return rooms.open(currentPath, html, { nodeId });
    });
  }

  /** A token bucket the transport shares per canonical file and sender address. */
  function rateLimit(key, { rate = RATE_LIMIT.rate, burst = RATE_LIMIT.burst, idleMs = RATE_LIMIT.idleMs } = {}) {
    const t = now();
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { tokens: burst, at: t, idleMs };
      buckets.set(key, bucket);
    }
    bucket.tokens = Math.min(burst, bucket.tokens + ((t - bucket.at) / 1000) * rate);
    bucket.at = t;
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  function sweep() {
    for (const [key, record] of registry) {
      if (record.members.size) continue;
      const room = rooms.get(key);
      if (room && room.emptySince === null) rooms.leave(room, null, []);
    }
    rooms.sweep((key) => connectedIds(key));
    const t = now();
    for (const [key, bucket] of buckets) if (t - bucket.at > bucket.idleMs) buckets.delete(key);
  }

  function closeRoot(rootId) {
    for (const record of registry.values()) {
      for (const member of [...record.members]) if (member.target.rootId === rootId) member.close();
      for (const snapshot of [...record.snapshots]) if (snapshot.target.rootId === rootId) snapshot.dispose();
    }
  }

  return {
    rooms,
    bindTarget,
    findBoundTarget,
    registerSnapshot,
    registerEditor,
    currentEditor,
    newestEditor,
    connectedIds,
    markParticipating,
    hasUnjoinedEditors,
    roomFor,
    publish,
    publishState,
    rateLimit,
    sweep,
    closeRoot,
  };
}

module.exports = { createLocalAuthority, LocalAuthorityError };
