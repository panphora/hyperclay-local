// clay.live's local tab lane: on a host without live-data, tabs of one document
// in one browser share live stores at full speed. One tab, the sequencer (held
// with a Web Lock), runs the room; the others reach it over a BroadcastChannel.
// The transport interface is fast-lane.js's; the frames are the server lane's.
//
// Every tab keeps a mirror of the room: each store's value, the senders'
// receipts, and per store a log of moves with how far the file reaches, all
// advanced together by each data message in order. The room keeps one epoch
// across hand-offs: a sequencer that stops posts its whole room last
// ("closed"), and the next lock holder continues from it. BroadcastChannel
// keeps one sender's messages in order, so nothing the old sequencer posted can
// arrive after it. Without a closed message (a crash) no tab can know whether
// it missed the old room's last messages, so the successor starts a new epoch
// from its mirror: tabs ahead of it take the new room rather than diverge.
//
// A file frame merges like an outside save on the host: the frame's live-at
// stamp (or, without one, the last version known to be in the file) picks
// where in the log it starts, the moves after that go back on top, and the
// merge itself is logged as a diff so a later file stamped before it keeps it.
//
// In the room scope the page store is a host-mode room, compacted by the tab that
// sequences it: an update is one whole client key, a refusal answers with the
// host's code, and a due room folds its keys in an idle task (a tail merge or a
// full, each proven before it is written) and sends the commit as a move of its
// own. A save merges as a union of keys, under names this room makes. The scope is
// part of the lane key, so a tab of the lane before it never shares a sequencer.

import { localChannel } from "./local-channel.js";
import { applyOp, applyTracked, checkOp, cloneJson, undoTracked, validateOp, serializeLive, textHash, diffOps } from "./ops.js";
import { parseJsonRelaxed } from "../vendor/hyper-morph-json.vendor.js";
import { movesSince } from "./moves.js";
import { COMPACTION, ROOM_ERROR_STATUS, admitPageOps, planCompaction, buildCandidate, checkUpdate, pageShape, createRangeCache, unionFileEntries } from "./page-compaction.js";

// The lane's own message version, carried by every message it posts: a tab of
// another version drops its frames even if a scope were ever shared. The shared
// channel keeps its wire version, which presence rides beside.
const VERSION = 5;
export const REQUEST_MS = 2000;
export const CLOSE_WAIT_MS = 500;
export const LOG_ENTRIES = 1024;
export const LOG_BYTES = 256 * 1024;

// ops applied to value in place, all or none: a throw takes back the ones
// before it. Returns the value to go on with, and how to take the ops back.
function applyAll(value, ops) {
  const done = [];
  const undo = () => {
    for (let i = done.length - 1; i >= 0; i--) undoTracked(done[i]);
  };
  try {
    for (const op of ops) {
      const rec = applyTracked(value, op);
      if (rec) {
        done.push(rec);
        value = rec.root;
      }
    }
  } catch (err) {
    undo();
    throw err;
  }
  return { value, undo };
}

const encoder = new TextEncoder();

// Floor 1 moves the durable lane to its own channel scope: a tab that cannot read
// floor 1 never receives future-format updates, and its writes are refused by the
// host floor. The message protocol inside the scope is unchanged.
export const FORMAT_SCOPE = "page-format:1";

// The room scope: this lane's sequencer is a host-mode room, so a tab of the lane
// before it, which cannot read that room, is never on the same channel or lock.
export const ROOM_SCOPE = "page-rooms:2";

export function localLaneKey(floor = 0, path = window.location.pathname) {
  const base = "clay-live:" + path;
  return `${floor >= 1 ? `${base}:${FORMAT_SCOPE}` : base}:${ROOM_SCOPE}`;
}

function idle(fn) {
  if (typeof requestIdleCallback === "function") requestIdleCallback(fn, { timeout: 1000 });
  else setTimeout(fn, 0);
}

const isYValue = (value) => !!value && typeof value === "object" && typeof value.y === "object" && value.y !== null && !Array.isArray(value.y);

export function localLaneSupported() {
  return typeof BroadcastChannel === "function" && typeof navigator !== "undefined" && typeof navigator.locks?.request === "function";
}

function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * @param {object} options
 * @param {() => Map<string, {value: any, ephemeral: boolean}>} options.seed -
 *   what this tab holds for each live tag, used for stores the room does not have yet
 * @param {string} [options.key]
 * @param {object} [options.channel] - the document's channel, when a presence
 *   service in this tab already owns one: the two share it rather than open a second
 * @param {boolean} [options.rooms] - the page's room scope: the channel and the
 *   lock of the host-mode lane, which a tab of the lane before it never joins
 */
// `key` is the room's channel without a floor suffix; `floor` scopes it, and
// `rooms` puts it in the room scope.
export function localTransport({ seed, key = "clay-live:" + window.location.pathname, channel: shared = null, floor = 0, rooms = false }) {
  const clientId = randomId();
  let scopeFloor = floor >= 1 ? 1 : 0;
  const scopeOf = (f) => `${key}${f >= 1 ? `:${FORMAT_SCOPE}` : ""}${rooms ? `:${ROOM_SCOPE}` : ""}`;
  let laneKey = scopeOf(scopeFloor);
  let channel = null;
  let unsubscribe = null;
  let handlers = null;
  let room = null;
  let stopped = false;
  let releaseLock = null;
  let lockRequested = false;
  let awaitingClose = null;
  let rid = 0;
  // Bumped whenever the mirror is replaced or this tab starts a room: a state
  // answer asked for before either is obsolete.
  let gen = 0;
  const waiting = new Map();
  // This tab's posts still waiting: request id -> the sequencer they went to.
  const ownPosts = new Map();
  // Epochs this tab has moved past: their messages are ignored.
  const retired = new Set();
  // The newest file frame per store seen while not the sequencer, merged if
  // this tab takes the room and the room has not merged it already.
  const kept = new Map();

  // The mirror. epoch and seq: the room position it has reached. sequencer: the
  // tab whose room it follows; closedBy: whose closed state it took. seen:
  // "name\nclientId" -> the newest n applied. stores: name -> { value,
  // ephemeral, log: [{ seq, ops, bytes }], logBytes, last, landed (how far the
  // file reaches, null when unknown), floor (the newest move the log dropped),
  // behind (the file holds a version the log cannot rebuild from), file (the
  // last file frame the room merged: { seq, hash }), inFile (seqs of logged
  // merges whose edit the file holds) }. stale: a message was
  // missed, so the mirror stopped advancing.
  let mirror = { epoch: null, seq: 0, sequencer: null, closedBy: null, stale: false, seen: new Map(), stores: new Map() };

  function post(message) {
    channel?.post({ ...message, version: VERSION });
  }

  // Over either cap the oldest entries go, and a file older than them can no
  // longer be merged (floor).
  function pushLog(m, entry) {
    entry.bytes = encoder.encode(JSON.stringify(entry.ops)).length;
    m.log.push(entry);
    m.logBytes += entry.bytes;
    while (m.log.length > LOG_ENTRIES || m.logBytes > LOG_BYTES) {
      const gone = m.log.shift();
      m.logBytes -= gone.bytes;
      m.floor = gone.seq;
    }
  }

  // One move, applied to the mirror: value, receipt, log and position together.
  function advance(data) {
    const m = mirror.stores.get(data.name);
    if (m) {
      m.value = applyAll(m.value, data.ops).value;
      m.last = data.seq;
      if (!m.ephemeral) pushLog(m, { seq: data.seq, ops: data.ops });
    }
    mirror.seq = data.seq;
    const nKey = data.name + "\n" + data.from;
    if ((mirror.seen.get(nKey) ?? 0) < data.n) mirror.seen.set(nKey, data.n);
  }

  function receiptsFor(name) {
    const out = {};
    for (const [nKey, n] of mirror.seen) {
      const cut = nKey.indexOf("\n");
      if (nKey.slice(0, cut) === name) out[nKey.slice(cut + 1)] = n;
    }
    return out;
  }

  const landedIn = (m) => (m.behind || m.landed === null ? -1 : m.landed);

  // A client's own read (since is its { epoch, seq }, or null for a first read)
  // carries moves, as the host's state() does: those after its seq in its own
  // epoch, else this epoch's from its start. A broadcast passes no since.
  function roomState(since) {
    const stores = {};
    const meta = {};
    for (const [name, m] of mirror.stores) {
      stores[name] = { value: cloneJson(m.value), ephemeral: m.ephemeral, seen: receiptsFor(name), last: m.last, landed: landedIn(m) };
      if (name === "page" && isYValue(m.value)) stores[name].compaction = { v: COMPACTION.version, loose: COMPACTION.loose, activeBytes: COMPACTION.activeBytes };
      meta[name] = { log: m.log, last: m.last, landed: m.landed, floor: m.floor, behind: m.behind, file: m.file, inFile: m.inFile };
    }
    const state = { epoch: room.epoch, seq: room.seq, writer: clientId, stores, mirror: { seen: [...mirror.seen], stores: meta } };
    if (since !== undefined) {
      const from = since && since.epoch === mirror.epoch && Number.isInteger(since.seq) ? since.seq : 0;
      const moves = {};
      for (const [name, m] of mirror.stores) moves[name] = movesSince(m, { seq: from });
      state.moves = moves;
    }
    return state;
  }

  function alreadyMerged(m, frame) {
    if (!m?.file) return false;
    if (frame.seq != null && m.file.seq != null) return frame.seq <= m.file.seq;
    return m.file.hash === textHash(serializeLive(parseJsonRelaxed(frame.text)));
  }

  function dropMerged() {
    for (const [name, frame] of kept) {
      try {
        if (alreadyMerged(mirror.stores.get(name), frame)) kept.delete(name);
      } catch {
        kept.delete(name);
      }
    }
  }

  // A state from the sequencer replaces the mirror when it is newer than what
  // this tab holds: a later point of this room, or a room this tab has not had.
  function install(state) {
    if (room || !state || typeof state.epoch !== "string" || !Number.isInteger(state.seq) || !state.mirror) return false;
    if (retired.has(state.epoch)) return false;
    if (state.epoch === mirror.epoch && state.seq < mirror.seq) return false;
    if (mirror.epoch !== null && state.epoch !== mirror.epoch) retired.add(mirror.epoch);
    const stores = new Map();
    for (const [name, held] of Object.entries(state.stores || {})) {
      const meta = state.mirror.stores?.[name] || {};
      const log = Array.isArray(meta.log) ? meta.log : [];
      stores.set(name, {
        value: cloneJson(held.value),
        ephemeral: held.ephemeral === true,
        log,
        logBytes: log.reduce((sum, entry) => sum + (entry.bytes || 0), 0),
        last: Number.isInteger(meta.last) ? meta.last : 0,
        landed: Number.isInteger(meta.landed) ? meta.landed : null,
        floor: Number.isInteger(meta.floor) ? meta.floor : 0,
        behind: meta.behind === true,
        file: meta.file || null,
        inFile: Array.isArray(meta.inFile) ? [...meta.inFile] : [],
      });
    }
    mirror = {
      epoch: state.epoch,
      seq: state.seq,
      sequencer: state.writer ?? null,
      closedBy: null,
      stale: false,
      seen: new Map(state.mirror.seen || []),
      stores,
    };
    dropMerged();
    gen += 1;
    return true;
  }

  function announce() {
    const state = roomState();
    post({ type: "data-state", state });
    handlers.state(state);
  }

  // A new epoch from the mirror's values: every saved store behind, so its next
  // checkpoint writes the file.
  function renewEpoch() {
    if (mirror.epoch !== null) retired.add(mirror.epoch);
    mirror.epoch = randomId();
    mirror.seq = 0;
    for (const m of mirror.stores.values()) {
      m.log = [];
      m.logBytes = 0;
      m.last = 0;
      m.landed = null;
      m.floor = 0;
      m.behind = true;
      m.file = null;
      m.inFile = [];
    }
  }

  // This tab's room, from the mirror. Same epoch when the mirror holds the old
  // room's closed state; a new epoch otherwise. Saved files this tab kept merge
  // first, while the old room's positions still place them. Stores the room
  // never had take the page's values.
  function startRoom({ fresh }) {
    const first = mirror.epoch === null;
    if (first) renewEpoch();
    for (const [name, held] of seed()) {
      if (mirror.stores.has(name)) continue;
      mirror.stores.set(name, { value: cloneJson(held.value), ephemeral: held.ephemeral, log: [], logBytes: 0, last: 0, landed: 0, floor: 0, behind: false, file: null, inFile: [] });
    }
    mirror.stale = false;
    mirror.sequencer = clientId;
    mirror.closedBy = null;
    const lastN = new Map();
    for (const [nKey, n] of mirror.seen) lastN.set(nKey, { n, seq: 0 });
    room = { epoch: mirror.epoch, seq: mirror.seq, lastN, host: pageHost() };
    for (const [name, frame] of kept) {
      const m = mirror.stores.get(name);
      if (!m || m.ephemeral) continue;
      try {
        if (alreadyMerged(m, frame)) continue;
      } catch {
        continue;
      }
      mergeFile(name, frame);
    }
    kept.clear();
    if (fresh && !first) {
      renewEpoch();
      room.epoch = mirror.epoch;
      room.seq = 0;
    }
    gen += 1;
    announce();
  }

  // Another sequencer ran this epoch while this tab held an older view of it (a
  // hand-off it had not heard of yet). Neither room holds the other's moves, so
  // this one starts a new epoch, which every tab then takes.
  function forked() {
    renewEpoch();
    room.epoch = mirror.epoch;
    room.seq = 0;
    gen += 1;
    announce();
  }

  // The sequencer leaves: its whole room goes out last, then the lock.
  function closeRoom() {
    if (!room) return;
    post({ type: "closed", from: clientId, state: roomState() });
    room = null;
    releaseLock?.();
    releaseLock = null;
  }

  // Resolves true once the closed state of sequencer (any, when null) is in.
  function closedFor(sequencer) {
    if (mirror.closedBy !== null && (sequencer === null || mirror.closedBy === sequencer)) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        awaitingClose = null;
        resolve(false);
      }, CLOSE_WAIT_MS);
      awaitingClose = {
        sequencer,
        resolve(ok) {
          clearTimeout(timer);
          awaitingClose = null;
          resolve(ok);
        },
      };
    });
  }

  function requestLock() {
    if (lockRequested || stopped) return;
    lockRequested = true;
    navigator.locks
      .request(laneKey, async () => {
        if (stopped) return undefined;
        const ordered = await closedFor(mirror.sequencer);
        if (stopped) return undefined;
        startRoom({ fresh: mirror.epoch === null || !ordered });
        return new Promise((resolve) => {
          releaseLock = resolve;
        });
      })
      .catch(() => {})
      .finally(() => {
        lockRequested = false;
      });
  }

  // A room's host mode: the sources it retired, the last full fold and the
  // deletions since it (which tell a room that is out of room from one that can
  // still be compacted), a build failure that stops it, the range cache the union
  // merge reads, and the idle task the room has asked for.
  const pageHost = () => ({ retired: new Set(), lastFull: null, deletesSince: 0, failed: null, ranges: createRangeCache(), task: null, overflow: false });

  const pageStore = () => {
    const m = mirror.stores.get("page");
    return m && !m.ephemeral && isYValue(m.value) ? m : null;
  };

  const pageBytes = (value) => encoder.encode(serializeLive(value)).length;

  // A host-mode refusal answers as the server's does: the status its code has and
  // the code itself, which is what a tab acts on.
  const refused = (error, retryAfter = 0) => ({ status: ROOM_ERROR_STATUS[error] ?? 409, body: { code: error }, retryAfter });

  // The room is due a compaction: one idle task, in this tab. The plan, the build
  // and the commit all run inside it without yielding, so no job outlives the
  // sequencer that made it and a hand-off cannot carry one to its successor.
  function due(overflow = false) {
    if (!room) return;
    const host = room.host;
    host.overflow ||= overflow;
    if (host.task) return;
    const target = room;
    host.task = idle(() => {
      host.task = null;
      const over = host.overflow;
      host.overflow = false;
      if (stopped || room !== target || host.failed) return;
      compact(host, { overflow: over });
    });
  }

  function compact(host, { overflow }) {
    const page = pageStore();
    if (!page) return;
    const plan = planCompaction(page.value.y, { overflow }, COMPACTION);
    if (!plan) return;
    const built = buildCandidate({ kind: plan.kind, sources: plan.sources });
    if (typeof built.update !== "string") {
      host.failed = { reason: built.failure };
      return;
    }
    commitPage(host, page, plan, built.update);
  }

  // Every source still there with the identical string, and the candidate proven:
  // then the room retires the sources for one checkpoint key of its own, named for
  // this epoch and position, and the commit goes out as a move like any other.
  function commitPage(host, m, plan, update) {
    const y = m.value.y;
    for (const [key, value] of plan.sources) if (y[key] !== value) return;
    if (!checkUpdate(update)) return;
    const key = `${plan.kind === "full" ? "c" : "t"}${textHash(room.epoch).slice(0, 8)}-${(room.seq + 1).toString(36)}`;
    if (Object.hasOwn(y, key)) return;
    const ops = [...plan.sources.map(([source]) => validateOp({ op: "del", path: ["y", source] })), validateOp({ op: "set", path: ["y", key], value: update })];
    let trial;
    try {
      trial = applyAll(m.value, ops);
    } catch {
      return;
    }
    const bytes = pageBytes(trial.value);
    const grew = bytes > pageBytes(m.value);
    trial.undo();
    if (bytes > COMPACTION.activeBytes && grew) return;
    const clean = !m.behind && m.landed === m.last;
    for (const [source] of plan.sources) {
      host.retired.add(source);
      if (host.retired.size > COMPACTION.retired) host.retired.delete(host.retired.values().next().value);
    }
    room.seq += 1;
    if (plan.kind === "full") {
      host.lastFull = { bytes, seq: room.seq };
      host.deletesSince = 0;
    }
    const data = { epoch: room.epoch, seq: room.seq, name: "page", ops, from: "compactor", n: 0, kind: plan.kind };
    advance(data);
    if (clean) m.landed = room.seq;
    post({ type: "data", data });
    handlers.frame(cloneJson(data));
    const shape = pageShape(m.value.y, COMPACTION);
    if (shape.loose >= COMPACTION.soft || !shape.normal) due();
  }

  function roomApply(from, frame) {
    if (!frame || typeof frame.name !== "string" || !Number.isInteger(frame.n) || frame.n < 1 || !Array.isArray(frame.ops) || !frame.ops.length) {
      return { status: 400, body: { error: "bad-frame" }, retryAfter: 0 };
    }
    const m = mirror.stores.get(frame.name);
    if (!m) return { status: 404, body: { error: "unknown-store" }, retryAfter: 0 };
    const nKey = frame.name + "\n" + from;
    const last = room.lastN.get(nKey);
    if (last && frame.n <= last.n) {
      return { status: 200, body: { duplicate: true, seq: last.seq, epoch: room.epoch }, retryAfter: 0 };
    }
    let ops;
    try {
      ops = frame.ops.map(validateOp);
    } catch (err) {
      return { status: 422, body: { error: err.message }, retryAfter: 0 };
    }
    const host = room.host;
    const admission = frame.name === "page" && isYValue(m.value) ? admitPageOps({ y: m.value.y, ops, state: { ...host, compaction: frame.compaction }, limits: COMPACTION }) : null;
    if (admission?.error) {
      if (admission.error === "checkpoint-required") due();
      return refused(admission.error, admission.retryAfter);
    }
    let trial;
    try {
      trial = applyAll(m.value, ops);
    } catch (err) {
      return { status: 422, body: { error: err.message }, retryAfter: 0 };
    }
    const bytes = admission ? pageBytes(trial.value) : 0;
    trial.undo();
    if (admission && bytes > admission.limit) {
      if (host.lastFull && host.deletesSince === 0) return refused("page-full");
      due(true);
      return refused("checkpoint-required");
    }
    room.seq += 1;
    room.lastN.set(nKey, { n: frame.n, seq: room.seq });
    const data = { epoch: room.epoch, seq: room.seq, name: frame.name, ops, from, n: frame.n };
    advance(data);
    post({ type: "data", data });
    handlers.frame(cloneJson(data));
    if (admission) {
      host.deletesSince += admission.deleted;
      if (bytes > COMPACTION.activeBytes) due(true);
      else if (admission.shape.loose + admission.added >= COMPACTION.soft) due();
    }
    return { status: 200, body: { seq: room.seq, epoch: room.epoch }, retryAfter: 0 };
  }

  // How far the file reaches moved for some stores: the sequencer's lane hears it.
  function tellLanded(names) {
    if (!room || !names.length) return;
    const landed = {};
    for (const name of names) {
      const m = mirror.stores.get(name);
      if (m) landed[name] = landedIn(m);
    }
    handlers.writer({ epoch: room.epoch, writer: clientId, landed });
  }

  // A save of store name holding the room's value at position at was accepted
  // (or, for a hide or close save, sent): the file reaches at least that far.
  function applyLanded(name, at) {
    const m = mirror.stores.get(name);
    if (!m || m.ephemeral || !at || at.epoch !== mirror.epoch || !Number.isInteger(at.seq)) return false;
    if (!m.behind && m.landed !== null && at.seq <= m.landed) return false;
    m.landed = at.seq;
    m.behind = false;
    return true;
  }

  // The sequencer merges one file frame ({ text, at, seq }) into store name.
  // The base is the stamp's seq when it is this room's, else the last version
  // known to be in the file. A base the log no longer reaches leaves the value
  // alone and marks the store behind (its next checkpoint writes the file over).
  // Returns null when the frame does not apply, else { changed, moved }.
  function mergeFile(name, { text, at, seq }) {
    const m = mirror.stores.get(name);
    if (!m || m.ephemeral) return null;
    let value;
    try {
      value = cloneJson(parseJsonRelaxed(text));
    } catch {
      return null;
    }
    if (value === null || typeof value !== "object" || Array.isArray(value) !== Array.isArray(m.value)) return null;
    const file = { seq: seq ?? null, hash: textHash(serializeLive(value)) };
    if (name === "page" && isYValue(m.value) && isYValue(value)) return mergePageFile(m, value, file);
    // A stamp of this room places the file. Still the value its stamp names, it
    // is a capture and holds no merge past the stamp; edited, or unstamped, it
    // descends from the file before it, which holds the merges in inFile.
    const placed = !!at && at.epoch === mirror.epoch && at.seq <= room.seq;
    const stamped = placed && at.hash === file.hash;
    const base = placed ? at.seq : m.behind ? null : m.landed;
    if (base === null || base < m.floor) {
      const moved = !m.behind;
      m.behind = true;
      m.file = file;
      return { changed: false, moved };
    }
    const entries = m.log.filter((entry) => entry.seq > base && (stamped || !m.inFile.includes(entry.seq)));
    if (stamped) m.inFile = [];
    for (const entry of entries) {
      for (const op of entry.ops) {
        try {
          checkOp(value, op);
          value = applyOp(value, op);
        } catch {}
      }
    }
    let changed = false;
    if (serializeLive(value) !== serializeLive(m.value)) {
      // Logged like a move, so a file stamped before this merge keeps it.
      const ops = diffOps(m.value, value);
      m.value = value;
      room.seq += 1;
      mirror.seq = room.seq;
      m.last = room.seq;
      pushLog(m, { seq: room.seq, ops });
      m.inFile = [...m.inFile.filter((seq) => seq > m.floor), room.seq];
      changed = true;
    }
    m.landed = entries.length ? base : m.last;
    m.behind = false;
    m.file = file;
    return { changed, moved: true };
  }

  // A save of the page merges as a union: every key whose content the room cannot
  // rebuild from its own keys goes in under a fresh name of this room's, never the
  // file's, so a key the room retired cannot come back through it. The merge is a
  // move like any other, and the room is due a compaction after it.
  function mergePageFile(m, value, file) {
    if (value.g !== m.value.g) return null;
    const host = room.host;
    const adds = unionFileEntries({
      y: m.value.y,
      fileY: value.y,
      retired: host.retired,
      rangesFor: host.ranges,
      keyFor: (i) => `f${textHash(room.epoch).slice(0, 8)}-${(room.seq + 1).toString(36)}-${i.toString(36)}`,
    });
    m.file = file;
    const taken = new Set();
    const ops = [];
    for (const [key, v] of adds) {
      if (Object.hasOwn(m.value.y, key) || taken.has(key)) continue;
      taken.add(key);
      ops.push(validateOp({ op: "set", path: ["y", key], value: v }));
    }
    if (!ops.length) return { changed: false, moved: false };
    m.value = applyAll(m.value, ops).value;
    room.seq += 1;
    mirror.seq = room.seq;
    m.last = room.seq;
    pushLog(m, { seq: room.seq, ops });
    m.inFile = [...m.inFile.filter((seq) => seq > m.floor), room.seq];
    host.lastFull = null;
    due();
    return { changed: true, moved: true };
  }

  // A file frame (another tab's or device's save, or this browser's own
  // checkpoint coming back), per saved store: { text, at, seq }. The sequencer
  // merges it; every other tab keeps the newest, for the room it may take.
  function onFileFrame(frames) {
    let changed = false;
    const moved = [];
    for (const [name, frame] of frames) {
      const m = mirror.stores.get(name);
      if (!m || m.ephemeral) continue;
      if (!room) {
        kept.set(name, frame);
        continue;
      }
      const result = mergeFile(name, frame);
      if (!result) continue;
      if (result.changed) changed = true;
      else if (result.moved) moved.push(name);
    }
    if (changed) announce();
    else tellLanded(moved);
  }

  function request(message) {
    return new Promise((resolve) => {
      const id = ++rid;
      const timer = setTimeout(() => {
        waiting.delete(id);
        ownPosts.delete(id);
        resolve(null);
      }, REQUEST_MS);
      if (message.type === "post") ownPosts.set(id, mirror.sequencer);
      waiting.set(id, (result) => {
        clearTimeout(timer);
        waiting.delete(id);
        ownPosts.delete(id);
        resolve(result);
      });
      post({ ...message, from: clientId, rid: id });
    });
  }

  // A sequencer ignores every data message: the room has one sequencer, and an
  // earlier one's messages all came before its closed state.
  function onData(data) {
    if (!data || typeof data.name !== "string" || typeof data.epoch !== "string" || !Number.isInteger(data.seq)) return;
    if (room || retired.has(data.epoch)) return;
    if (data.epoch !== mirror.epoch) {
      mirror.stale = true;
    } else if (!mirror.stale && data.seq === mirror.seq + 1) {
      try {
        advance(data);
      } catch {
        mirror.stale = true;
      }
    } else if (data.seq > mirror.seq) {
      mirror.stale = true;
    }
    handlers.frame(data);
  }

  function onClosed(from, state) {
    if (typeof from !== "string" || !state) return;
    if (install(state)) {
      mirror.closedBy = from;
      handlers.state(state);
    }
    // Unanswered by a sequencer that has gone: the lane retries with the same n,
    // and the room's receipts make that count once.
    for (const [id, to] of ownPosts) if (to === from) waiting.get(id)?.(null);
    if (awaitingClose && (awaitingClose.sequencer === null || awaitingClose.sequencer === from)) awaitingClose.resolve(mirror.closedBy === from);
  }

  function onMessage({ data: m }) {
    if (stopped || !m || m.version !== VERSION) return;
    if (room && ((m.type === "data" && m.data?.epoch === room.epoch) || ((m.type === "data-state" || m.type === "closed") && m.state?.epoch === room.epoch && m.state.writer !== clientId))) {
      forked();
      return;
    }
    // A sequencer announcing this epoch behind where this tab's mirror is, and not
    // the one it follows, missed a hand-off: it is told, and starts a new epoch.
    if (!room && m.type === "data-state" && m.state?.epoch === mirror.epoch && m.state.writer !== mirror.sequencer && Number.isInteger(m.state.seq) && m.state.seq < mirror.seq) {
      post({ type: "forked", epoch: mirror.epoch, to: m.state.writer });
      return;
    }
    if (m.type === "forked") {
      if (room && m.epoch === room.epoch && m.to === clientId) forked();
      return;
    }
    if (m.type === "data") {
      onData(m.data);
    } else if (m.type === "data-state") {
      if (install(m.state)) handlers.state(m.state);
    } else if (m.type === "closed") {
      onClosed(m.from, m.state);
    } else if (m.type === "landed") {
      if (typeof m.name === "string" && applyLanded(m.name, m.at)) tellLanded([m.name]);
    } else if (m.type === "answer") {
      if (m.to === clientId) waiting.get(m.rid)?.(m.result);
    } else if (room && m.type === "post") {
      if (m.epoch === room.epoch) post({ type: "answer", to: m.from, rid: m.rid, result: roomApply(m.from, m.frame) });
    } else if (room && m.type === "state-request") {
      post({ type: "answer", to: m.from, rid: m.rid, result: roomState(m.since) });
    }
  }

  function onPageHide() {
    closeRoom();
  }

  // Back from the back/forward cache: take part again, and have the lane read
  // the room this tab may have handed off.
  function onPageShow(event) {
    if (!event.persisted || stopped || room || lockRequested) return;
    mirror.sequencer = null;
    mirror.closedBy = null;
    requestLock();
    handlers.close();
    handlers.open({ clientId, lane: "live" });
  }

  // The floor rose and an accepted receipt covers the pending work: close this
  // scope's room (its closed state carries every store and the position the
  // receipt covers), then join the new one. An interrupted switch leaves this tab
  // where it was, on floor 0's scope, with every store and its pending work
  // intact; the caller retries it from the receipt.
  function switchScope(next, { covered = false } = {}) {
    const want = next >= 1 ? 1 : 0;
    const held = { floor: scopeFloor, scope: laneKey };
    if (want <= scopeFloor) return { status: "already", ...held };
    if (stopped || !channel) return { status: "refused", code: "lane-stopped", ...held };
    if (shared) return { status: "refused", code: "shared-channel", ...held };
    if (!covered) return { status: "refused", code: "uncovered", ...held };
    closeRoom();
    unsubscribe?.();
    laneKey = scopeOf(want);
    scopeFloor = want;
    channel = localChannel(laneKey);
    unsubscribe = channel.subscribe("durable", (data) => onMessage({ data }));
    mirror.sequencer = mirror.closedBy = null;
    lockRequested = false;
    requestLock();
    handlers.close();
    handlers.open({ clientId, lane: "live" });
    return { status: "switched", floor: scopeFloor, scope: laneKey };
  }

  return {
    clientId,
    get scope() {
      return laneKey;
    },
    get floor() {
      return scopeFloor;
    },
    switchScope,
    start(next) {
      handlers = next;
      channel = shared ?? localChannel(laneKey);
      unsubscribe = channel.subscribe("durable", (data) => onMessage({ data }));
      window.addEventListener("pagehide", onPageHide);
      window.addEventListener("pageshow", onPageShow);
      requestLock();
      handlers.open({ clientId, lane: "live" });
      return () => {
        closeRoom();
        stopped = true;
        awaitingClose?.resolve(false);
        window.removeEventListener("pagehide", onPageHide);
        window.removeEventListener("pageshow", onPageShow);
        for (const resolve of waiting.values()) resolve(null);
        unsubscribe?.();
        unsubscribe = null;
        channel = null;
      };
    },
    async send(_clientId, frame) {
        if (room) return roomApply(clientId, frame);
      return (await request({ type: "post", frame, epoch: mirror.epoch })) || { status: 0, body: null, retryAfter: 0 };
    },
    // The sequencer's state, installed into the mirror first. An answer to a
    // request made before the mirror changed (another state, or this tab
    // starting a room) is dropped: the lane asks again or already has it.
    async fetchState(_clientId, since = null) {
      if (room) return roomState(since);
      const asked = gen;
      const state = await request({ type: "state-request", since });
      if (room) return roomState(since);
      if (asked !== gen || !install(state)) return null;
      return state;
    },
    // A file frame arrived: Map<name, { text, at, seq }>, at being the tag's
    // parsed live-at stamp or null, seq the stream's frame number or null.
    fileFrame(frames) {
      if (!stopped) onFileFrame(frames);
    },
    // This tab's save holding store name at position at ({ epoch, seq }) was
    // accepted, or is a hide or close save on its way. Its own save never comes
    // back as a frame, so every tab is told.
    landed(name, at) {
      if (stopped || !at) return;
      if (applyLanded(name, at)) tellLanded([name]);
      post({ type: "landed", name, at: { epoch: at.epoch, seq: at.seq } });
    },
    get isSequencer() {
      return room !== null;
    },
  };
}
