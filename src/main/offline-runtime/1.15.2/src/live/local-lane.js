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

import { applyOp, applyTracked, checkOp, cloneJson, undoTracked, validateOp, serializeLive, textHash, diffOps } from "./ops.js";
import { parseJsonRelaxed } from "../vendor/hyper-morph-json.vendor.js";
import { movesSince } from "./moves.js";

const VERSION = 4;
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
 */
export function localTransport({ seed, key = "clay-live:" + window.location.pathname }) {
  const clientId = randomId();
  let channel = null;
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
    channel?.postMessage({ v: VERSION, ...message });
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
    room = { epoch: mirror.epoch, seq: mirror.seq, lastN };
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
      .request(key, async () => {
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
      applyAll(m.value, ops).undo();
    } catch (err) {
      return { status: 422, body: { error: err.message }, retryAfter: 0 };
    }
    room.seq += 1;
    room.lastN.set(nKey, { n: frame.n, seq: room.seq });
    const data = { epoch: room.epoch, seq: room.seq, name: frame.name, ops, from, n: frame.n };
    advance(data);
    post({ type: "data", data });
    handlers.frame(cloneJson(data));
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
    if (stopped || !m || m.v !== VERSION) return;
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

  return {
    clientId,
    start(next) {
      handlers = next;
      channel = new BroadcastChannel(key);
      channel.onmessage = onMessage;
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
        channel?.close();
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
