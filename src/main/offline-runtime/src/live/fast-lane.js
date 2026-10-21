// clay.live's fast lane: every op goes to a room that orders it (seq) and hands
// it to every tab, so stores move at network speed instead of save speed. The
// room is on the host (server-lane.js) or in one tab of this browser; both speak
// the same frames through a transport:
//   start({ open, close, frame, state, writer }) -> stop function
//   send(clientId, { name, n, ops, epoch }) -> Promise<{ status, body, retryAfter }>
//   fetchState(clientId, since, { signal }) -> Promise<{ epoch, seq, writer, stores } | { status } | null>
//     answered within STATE_TIMEOUT_MS or abandoned: its signal aborts and the read is made again
// A new room (a new epoch) holds some of this tab's frames still in flight; see
// sortAwaiting for how each is sorted.
//
// Per open store the room says how far its file reaches: entry.last (the seq of
// the store's latest change) and entry.landed (the seq from which the file plus
// the room's log rebuilds the value; -1: rewrite now). Both are numbers in the
// current epoch, taken from the room and never carried across epochs.

import { unionRanges, contains, frameSet, hasNumber } from "./provenance.js";

export const MIN_GAP_MS = 40;
export const MAX_OPS = 128;
export const RETRY_MS = 500;
export const STATE_TIMEOUT_MS = 10_000;
export const FRAME_BYTES = 63 * 1024;
// What a host still on the old 16 KB body cap takes: a multi-op frame it
// answers 413 is packed again at this size for the rest of the session.
export const OLD_FRAME_BYTES = 15 * 1024;
const BUFFER_MAX = 512;
const RETRY_MAX_MS = 8000;
const REVOKED = new Set([401, 403]);
const STATE_GONE = new Set([401, 403, 404]);
const encoder = new TextEncoder();
const byteSize = (value) => encoder.encode(JSON.stringify(value)).length;

const transient = (status) => status === 0 || status === 408 || status === 429 || status >= 500;
// A refusal sent before the request was handled: the frame was not applied.
const unhandled = (status) => status === 429 || status === 503;

/**
 * @param {object} options
 * @param {object} options.transport
 * @param {Map<string, {store: object}>} options.entries - the live plugin's open stores, by name
 * @param {(epoch: string) => void} [options.onEpoch] - joined a room (first join or restart)
 * @param {() => void} [options.onWriter] - the room's writer may have changed
 * @param {() => void} [options.onApplied] - a store's room value moved (its entry's last advanced)
 * @param {() => void} [options.onLanded] - how far the file reaches moved (an entry's landed)
 * @param {() => void} [options.onCheckpoint] - the room asks the writer to save now (its log is half full)
 * @param {(name: string) => boolean} [options.held] - a save still on the wire carries some of
 *   this store's pending ops in file mode: nothing of the store is framed until release(name),
 *   so those ops are framed in order if the save does not land, and never if it does
 * @param {(name: string) => number[]} [options.heldIds] - the ids of those ops: a room state
 *   cannot say whether they are in its value, so it is not applied to the store until the
 *   room's receipts hold their frames or hold(name, ids) lets go of them
 * @param {(name: string, ids: number[]) => boolean} [options.hold] - true to keep waiting for
 *   the save's answer; false when the ops left pending (the caller gave up on them)
 * @param {(name: string) => void} [options.taken] - the store took a room state
 * @param {() => void} [options.onStop] - the lane stopped for good
 */
export function createFastLane({
  transport,
  entries,
  onEpoch = () => {},
  onLeave = () => {},
  onWriter = () => {},
  onApplied = () => {},
  onLanded = () => {},
  onCheckpoint = () => {},
  held = () => false,
  heldIds = () => [],
  hold = () => true,
  taken = () => {},
  onStop = () => {},
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let clientId = null;
  let connected = false;
  let synced = false;
  let epoch = null;
  let receiptGeneration = null;
  let provenanceVersion = 0;
  let seq = 0;
  let writer = null;
  let roomNames = new Set();
  let buffered = [];
  let fetching = false;
  let stopped = false;
  let inFlight = false;
  // The frame on the wire now.
  let flying = null;
  let lastSentAt = -Infinity;
  let holdUntil = 0;
  let timer = null;
  let readTimer = null;
  let retryDelay = RETRY_MS;
  let frameBytes = FRAME_BYTES;
  let resyncDelay = RETRY_MS;
  // Bumped when the stream opens or closes, and when a state is taken: a state
  // request answered after either is obsolete.
  let connection = 0;
  // The stream connection the host knows this tab by (server lane): a frame
  // applies only under it. undefined on a transport without one.
  let conn;
  let stateCount = 0;
  let fetchAgain = false;
  let reads = 0;
  // A store left the room, so frames went by that its value never took: state
  // reads ask for every store whole, never for the moves since seq, until a
  // state is applied.
  let missed = false;
  let unsubscribe = null;
  // Per store: the next n, ops not yet in a frame, frames sent but not yet seen
  // back (each { n, ops, through, seq, sent, refused, uncertain }), and the
  // newest op id ever put in a frame.
  const lanes = new Map();

  const tell = (name, event) => entries.get(name)?.store.deliver?.({ code: null, n: null, seq: null, through: null, retryAfter: null, client: clientId, ...event });

  function laneOf(name) {
    let lane = lanes.get(name);
    if (!lane) lanes.set(name, (lane = { n: 0, unsent: [], awaiting: [], framed: 0 }));
    return lane;
  }

  // The store's ops still to frame: pending, past what was framed.
  function unframed(name, lane) {
    const store = entries.get(name)?.store;
    if (!store) return [];
    return store.pendingEntries().filter((pending) => pending.id > lane.framed);
  }

  // A frame none of whose ops is pending any more (a save at save speed took
  // them, and the room merges that file) leaves the lane: never sent again.
  function prune(name, lane) {
    const store = entries.get(name)?.store;
    if (!store) return;
    const live = new Set(store.pendingEntries().map((pending) => pending.id));
    lane.awaiting = lane.awaiting.filter((frame) => frame === flying || !frame.entries || frame.entries.some((e) => live.has(e.id)));
  }

  // Never applied: every attempt was refused before the room handled it.
  const unapplied = (frame) => frame.refused === true && !frame.uncertain;

  // Stop sending this store: it leaves the room. Every op the room has not
  // confirmed stays pending, so the next save writes it: an op never framed, a
  // frame refused, a frame that landed but has not come back, and the frame on
  // the wire, whose answer decides it (decide). The frames stay as records: a
  // rejoin settles each by the room's answer or receipt, or sends it again.
  // Leaving wakes the checkpoints (onApplied): what is pending now saves at
  // save speed. kept: the room still holds the store, so its frames go by
  // while this tab is out, and the rejoin reads it whole (missed). A store the
  // room does not hold has no frames to miss.
  function leaveRoom(name, lane, kept = true) {
    const store = entries.get(name)?.store;
    for (const frame of lane.awaiting) if (frame === flying) frame.undecided = true;
    if (kept) missed = true;
    lane.out = true;
    onLeave(name, { epoch, seq });
    lane.unsent = [];
    store?.setMode("file");
    onApplied();
  }

  function schedule() {
    if (timer !== null || inFlight || stopped) return;
    const t = now();
    const delay = Math.max(0, lastSentAt + MIN_GAP_MS - t, holdUntil - t);
    timer = setTimer(() => {
      timer = null;
      flush();
    }, delay);
  }

  // A frame whose send failed goes again first, with its own n. Otherwise the
  // oldest unsent ops of one store; stores take turns.
  function nextFrame() {
    for (const [name, lane] of lanes) {
      if (!roomNames.has(name) || held(name)) continue;
      const retry = lane.awaiting.find((frame) => !frame.sent);
      if (retry) return { name, lane, frame: retry };
    }
    for (const [name, lane] of lanes) {
      if (!lane.unsent.length || !roomNames.has(name) || held(name)) continue;
      // Packed by bytes as well as count: the host refuses a body over 64 KB.
      let size = byteSize({ name, n: lane.n + 1, ops: [], epoch });
      let count = 0;
      while (count < lane.unsent.length && count < MAX_OPS) {
        const more = byteSize(lane.unsent[count].op) + 1;
        if (size + more > frameBytes) break;
        size += more;
        count++;
      }
      // One op larger than a frame: only that op is undone, and the ops queued
      // after it go on (nextFrame starts over).
      if (count === 0) {
        const [entry] = lane.unsent.splice(0, 1);
        console.warn(`clay.live("${name}"): one update was larger than ${frameBytes} bytes, so it was undone`);
        const store = entries.get(name)?.store;
        tell(name, { phase: "undone", code: "op-too-large", from: entry.id, through: entry.id });
        store?.rebase(store.authoritative, { source: "state", drop: [entry.id, entry.id], cause: "undone" });
        return nextFrame();
      }
      const take = lane.unsent.splice(0, count);
      const frame = { n: ++lane.n, ops: take.map((entry) => entry.op), entries: take, first: take[0].id, through: take[take.length - 1].id, seq: null, sent: false, receiptGeneration };
      lane.framed = Math.max(lane.framed, frame.through);
      lane.awaiting.push(frame);
      return { name, lane, frame };
    }
    return null;
  }

  async function flush() {
    if (inFlight || stopped || !connected || !synced || conn === null) return;
    const next = nextFrame();
    if (!next) return;
    const { name, lane, frame } = next;
    lanes.delete(name);
    lanes.set(name, lane);
    const sentEpoch = epoch;
    frame.epoch = sentEpoch;
    frame.client = clientId;
    frame.sentOn = connection;
    frame.sent = true;
    tell(name, { phase: "sent", n: frame.n, first: frame.first, through: frame.through });
    // Refusal is evidence about earlier attempts only: this one may apply.
    frame.refused = false;
    inFlight = true;
    flying = frame;
    lastSentAt = now();
    let result;
    try {
      result = await transport.send(clientId, { name, n: frame.n, ops: frame.ops, epoch: sentEpoch, ...(conn !== undefined && { conn }), ...(frame.receiptGeneration !== null && { receiptGeneration: frame.receiptGeneration }) });
    } catch {
      result = null;
    }
    inFlight = false;
    flying = null;
    if (stopped) return;
    if (frame.undecided) decide(name, lane, frame, result || { status: 0 });
    else if (sentEpoch === epoch && lane.awaiting.includes(frame)) answered(name, lane, frame, result || { status: 0 });
    schedule();
  }

  // The answer to a frame sent to the room before this one. Refused unapplied
  // (stale, a 4xx, 429/503): it goes again here. Otherwise the old room applied
  // it or may have: it is dropped, never sent again.
  function decide(name, lane, frame, { status, body }) {
    delete frame.undecided;
    if (!lane.awaiting.includes(frame)) return;
    const refused = body?.stale === true || unhandled(status) || (status >= 400 && status < 500 && !transient(status));
    if (refused && !frame.uncertain) {
      frame.refused = true;
      frame.sent = false;
      frame.seq = null;
      if (frame.epoch !== epoch) frame.receiptGeneration = receiptGeneration;
      return;
    }
    // Its store left the room meanwhile: its ops stay pending for the save,
    // and the frame waits for the rejoin, which settles it by its seq or the
    // room's receipt.
    if (!roomNames.has(name)) {
      if (status >= 200 && status < 300 && Number.isInteger(body?.seq) && !body?.stale) frame.seq = body.seq;
      else {
        frame.uncertain = true;
        frame.uncertainSince ??= frame.sentOn;
      }
      return;
    }
    lane.awaiting.splice(lane.awaiting.indexOf(frame), 1);
    const store = entries.get(name)?.store;
    store?.rebase(store.authoritative, { source: "state", through: frame.through, cause: "decided" });
  }

  // Every frame the room ordered at or before the applied seq is in the
  // authoritative values now, whether its answer or its event said so.
  function settleAwaiting() {
    for (const [name, lane] of lanes) {
      if (!roomNames.has(name)) continue;
      let through;
      while (lane.awaiting.length && lane.awaiting[0].seq !== null && lane.awaiting[0].seq <= seq) {
        through = lane.awaiting.shift().through;
      }
      if (through === undefined) continue;
      const store = entries.get(name)?.store;
      store?.rebase(store.authoritative, { source: "state", through, cause: "settled" });
    }
  }

  function answered(name, lane, frame, { status, body, retryAfter }) {
    if (status >= 200 && status < 300) {
      retryDelay = RETRY_MS;
      // Made for an earlier room and refused unapplied: it goes again once this
      // tab has the new room's state (which may already be here).
      if (body?.stale) {
        frame.sent = false;
        frame.refused = true;
        if (body.epoch !== epoch) resync();
        else schedule();
        return;
      }
      if (body?.epoch && body.epoch !== epoch) {
        resync();
        return;
      }
      frame.seq = Number.isInteger(body?.seq) ? body.seq : null;
      tell(name, { phase: "landed", n: frame.n, seq: frame.seq, through: frame.through });
      // Its event already went by, or came inside a state this tab took: the ops are in.
      settleAwaiting();
      return;
    }
    if (transient(status)) {
      frame.sent = false;
      tell(name, { phase: "retry", code: body?.code ?? (status === 0 ? "offline" : status === 429 ? "rate-limited" : "server"), n: frame.n, through: frame.through, retryAfter: retryAfter ?? null });
      if (unhandled(status)) frame.refused = true;
      else {
        frame.uncertain = true;
        // The earliest connection an attempt that may have applied was sent on.
        frame.uncertainSince ??= frame.sentOn;
      }
      // Sent under a connection the host no longer has: read the state for the
      // current one, which also settles or resends this frame by its receipt.
      if (status === 503 && body?.code === "not-connected") {
        conn = null;
        resync();
        return;
      }
      // The room holds a receipt for every connected sender and has no room for
      // this one: this store goes at save speed until the room takes it back.
      if (status === 503 && body?.code === "busy") {
        tell(name, { phase: "left", code: "busy", n: frame.n, through: frame.through });
        console.warn(`clay.live("${name}"): the room is full, so it stays at save speed for now`);
        roomNames.delete(name);
        leaveRoom(name, lane);
        setTimer(resync, (retryAfter > 0 ? retryAfter : 60) * 1000);
        return;
      }
      // Its fate is unknown and the stream reconnected while it was on the wire:
      // a state read on the new connection decides it, by its receipt or none.
      if (frame.uncertain && frame.sentOn !== connection) {
        resync();
        return;
      }
      holdUntil = now() + (retryAfter > 0 ? retryAfter * 1000 : retryDelay);
      retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
      return;
    }
    if (REVOKED.has(status)) {
      tell(name, { phase: "refused", code: "revoked", n: frame.n, through: frame.through });
      if (!frame.uncertain) frame.refused = true;
      stop();
      return;
    }
    const reason = body?.error || body?.code || `status ${status}`;
    if (status === 404) {
      tell(name, { phase: "left", code: "no-store", n: frame.n, through: frame.through });
      console.warn(`clay.live("${name}"): the room has no such store, so it stays at save speed (${reason})`);
      frame.refused = true;
      roomNames.delete(name);
      leaveRoom(name, lane, false);
      return;
    }
    lane.awaiting.splice(lane.awaiting.indexOf(frame), 1);
    // A host still on the old body cap: pack its ops again, smaller, and send
    // them again. Only an op too large on its own is refused. That host's 413
    // comes from its body parser, with no code; the room's own size refusal
    // (a store or room cap, code "too-large") is a refusal like any other.
    if (status === 413 && !body?.code && frame.entries?.length > 1 && frameBytes > OLD_FRAME_BYTES) {
      frameBytes = OLD_FRAME_BYTES;
      console.warn(`clay.live("${name}"): the host takes smaller updates, so they go in frames of ${frameBytes} bytes`);
      lane.unsent.unshift(...frame.entries);
      // Unframed again: a new room's state frames them afresh (unframed()).
      lane.framed = frame.first - 1;
      return;
    }
    const store = entries.get(name)?.store;
    tell(name, { phase: "refused", code: body?.code ?? "refused", n: frame.n, from: frame.first, through: frame.through, ...(body?.code === "receipt-expired" && { ops: frame.ops }) });
    console.warn(`clay.live("${name}"): the host refused an update, so it was undone (${reason})`);
    store?.rebase(store.authoritative, { source: "state", drop: frame.first === undefined ? undefined : [frame.first, frame.through], through: frame.first === undefined ? frame.through : undefined, cause: "refused" });
    if (body?.code === "receipt-expired") resync();
  }

  function apply(frame) {
    seq = frame.seq;
    const store = entries.get(frame.name)?.store;
    if (!store) return;
    if (!roomNames.has(frame.name)) {
      missed = true;
      return;
    }
    const ops = store.checkOps(frame.ops);
    if (!ops) {
      resync();
      return;
    }
    let through;
    const own = frame.from === clientId;
    if (own) {
      const lane = laneOf(frame.name);
      const i = lane.awaiting.findIndex((sent) => sent.n === frame.n);
      if (i >= 0) {
        through = lane.awaiting[i].through;
        tell(frame.name, { phase: "echoed", n: frame.n, seq: frame.seq, through });
        lane.awaiting.splice(0, i + 1);
      }
    }
    store.rebaseOps(ops, { source: own ? "state" : "remote", through, frame: { seq: frame.seq, from: frame.from, n: frame.n, ops: frame.ops } });
    entries.get(frame.name).last = frame.seq;
    onApplied();
    if (frame.checkpoint === true) onCheckpoint();
    settleAwaiting();
  }

  function onFrame(frame) {
    if (stopped || !frame || !Number.isInteger(frame.seq)) return;
    if (!synced) {
      buffered.push(frame);
      if (buffered.length > BUFFER_MAX) buffered.shift();
      return;
    }
    if (frame.epoch !== epoch) {
      buffered.push(frame);
      resync();
      return;
    }
    if (frame.seq <= seq) return;
    if (frame.seq !== seq + 1) {
      buffered.push(frame);
      resync();
      return;
    }
    apply(frame);
  }

  // A new room: what becomes of this tab's frames still awaiting an answer.
  // A frame a local successor's receipts (seen) say it holds settles. A frame
  // every attempt of which was refused unapplied goes again. Any other frame the
  // old room may have applied is dropped, never sent again: a late checkpoint of
  // the old room may bring that move back, so sending it again could count it
  // twice. Frames go one at a time and a refusal stops
  // sending until the next state, so the settled or dropped frames come first.
  // Returns the frames to send again and the op id the rest reach (0: none).
  function sortAwaiting(awaiting, room) {
    const seen = room.seen ? (room.seen[clientId] ?? 0) : null;
    const resend = [];
    const dropIds = [];
    for (const frame of awaiting) {
      if ((seen !== null && frame.n <= seen) || hasNumber(room.saved, frame.n)) dropIds.push(...frame.entries.map((e) => e.id));
      else if (frame.sent && frame === flying) {
        // Still on the wire: its answer decides.
        frame.undecided = true;
        resend.push(frame);
      } else if (unapplied(frame)) resend.push(frame);
      else dropIds.push(...frame.entries.map((e) => e.id));
    }
    return { resend, dropIds };
  }

  function waiting(name, lane, room, fresh) {
    const ids = heldIds(name);
    if (!ids.length) return false;
    if (!fresh) {
      const covered = new Set();
      for (const frame of lane.awaiting) {
        if (hasNumber(room.saved, frame.n)) for (const op of frame.entries ?? []) covered.add(op.id);
      }
      if (ids.every((id) => covered.has(id))) return false;
    }
    if (!hold(name, ids)) {
      prune(name, lane);
      return false;
    }
    return true;
  }

  function applyState(state, read = 0) {
    if (stopped || !state || typeof state.epoch !== "string") return;
    stateCount++;
    // Older than what this tab already applied: keep what it has.
    if (state.epoch === epoch && Number.isInteger(state.seq) && state.seq < seq) {
      drain();
      return;
    }
    const fresh = state.epoch !== epoch;
    provenanceVersion = Number.isInteger(state.provenanceVersion) ? state.provenanceVersion : 0;
    receiptGeneration = Number.isSafeInteger(state.receiptGeneration) ? state.receiptGeneration : null;
    let joined = false;
    // Every store is read whole here.
    missed = false;
    epoch = state.epoch;
    seq = Number.isInteger(state.seq) ? state.seq : 0;
    writer = state.writer ?? null;
    if ("conn" in state) conn = state.conn;
    const stores = state.stores || {};
    roomNames = new Set(Object.keys(stores));
    let skipped = false;
    let readDue = false;
    for (const [name, entry] of entries) {
      const room = stores[name];
      const lane = laneOf(name);
      prune(name, lane);
      lane.room = !!room;
      if (!room) {
        // Not in the room (too large, too many stores, or opened after it):
        // there are no frames of it to miss. Already out: its value still
        // descends from where it left.
        if (!lane.out) leaveRoom(name, lane, false);
        // A read the barrier waited for says no room holds this store: the file is its authority.
        if (lane.after !== undefined && read >= lane.after) {
          lane.after = undefined;
          lane.deferred = false;
          taken(name);
        }
        continue;
      }
      const behind = lane.after !== undefined && read < lane.after;
      if (behind || waiting(name, lane, room, fresh || lane.stale === true)) {
        roomNames.delete(name);
        lane.deferred = true;
        if (fresh) lane.stale = true;
        if (behind) readDue = true;
        skipped = true;
        continue;
      }
      const wholly = fresh || lane.stale === true;
      lane.deferred = false;
      lane.stale = false;
      lane.after = undefined;
      const rejoined = entry.store.handle.status.mode === "file";
      lane.out = false;
      entry.store.setMode("fast");
      entry.last = Number.isInteger(room.last) ? room.last : 0;
      entry.landed = Number.isInteger(room.landed) ? room.landed : 0;
      const expired = [];
      if (!wholly && receiptGeneration !== null) {
        const seen = room.seen?.[clientId];
        lane.awaiting = lane.awaiting.filter((frame) => {
          const known = hasNumber(room.saved, frame.n) || (seen !== undefined && frame.n <= seen) || (frame.seq !== null && frame.seq <= seq);
          if (known || (frame.receiptGeneration ?? 0) === receiptGeneration) return true;
          expired.push(...frame.entries.map((e) => e.id));
          tell(name, { phase: "refused", code: "receipt-expired", n: frame.n, from: frame.first, through: frame.through, ops: frame.ops });
          console.warn(`clay.live("${name}"): the room retired an update receipt, so the update was not replayed. Check the saved value before restoring it.`);
          return false;
        });
      }
      if (wholly) {
        const { resend, dropIds } = sortAwaiting(lane.awaiting, room);
        for (const frame of resend) {
          if (frame.undecided) continue;
          frame.sent = false;
          frame.seq = null;
          frame.receiptGeneration = receiptGeneration;
        }
        lane.awaiting = resend;
        entry.store.rebase(room.value, { source: "state", dropIds, room: { seq, fresh: true, moves: state.moves?.[name] ?? null, floor: Number.isInteger(room.floor) ? room.floor : null } });
        lane.unsent = unframed(name, lane);
      } else {
        const seen = room.seen ? room.seen[clientId] : undefined;
        const next = [];
        const dropIds = [...expired];
        for (const frame of lane.awaiting) {
          if (hasNumber(room.saved, frame.n)) {
            dropIds.push(...frame.entries.map((e) => e.id));
          } else if (frame === flying) {
            next.push(frame);
          } else if ((frame.seq !== null && frame.seq <= seq) || (seen !== undefined && frame.n <= seen)) {
            // In this state, by its answer or by the room's receipt.
            dropIds.push(...frame.entries.map((e) => e.id));
          } else if (frame.seq !== null) {
            // Answered as applied after this state was read: its event is on its way.
            next.push(frame);
          } else if (!frame.uncertain || seen !== undefined || frame.uncertainSince === connection) {
            // Provably not applied: every attempt refused before handling, above
            // the room's receipt for this tab, or every attempt that may have
            // applied went on this connection, which never dropped (its receipt
            // cannot have gone). It goes again with the same n.
            frame.sent = false;
            next.push(frame);
          } else {
            // Unanswered, and the stream reconnected since: its receipt may be gone.
            dropIds.push(...frame.entries.map((e) => e.id));
          }
        }
        lane.awaiting = next;
        entry.store.rebase(room.value, { source: "state", dropIds, room: { seq, fresh: false, moves: state.moves?.[name] ?? null, floor: Number.isInteger(room.floor) ? room.floor : null } });
        // Back in the room after a spell at save speed: frame what was made meanwhile.
        if (rejoined) {
          lane.unsent = unframed(name, lane);
          joined = true;
        }
      }
      taken(name);
    }
    if (skipped) missed = true;
    if (fresh || joined) onEpoch(epoch);
    onApplied();
    onWriter();
    drain();
    if (readDue) resync();
  }

  // Back in step: apply what arrived while the state was being read.
  function drain() {
    synced = true;
    const later = buffered.filter((frame) => frame.epoch === epoch && frame.seq > seq).sort((a, b) => a.seq - b.seq);
    buffered = [];
    for (const frame of later) onFrame(frame);
    schedule();
  }

  // Read the room's whole state. Frames wait in the buffer meanwhile, so the
  // answer and the frames after it apply in order.
  async function resync() {
    if (stopped) return;
    if (fetching) {
      fetchAgain = true;
      return;
    }
    fetching = true;
    fetchAgain = false;
    synced = false;
    const asked = { connection, stateCount, read: ++reads };
    let state = null;
    const abort = typeof AbortController === "function" ? new AbortController() : null;
    const expired = new Promise((resolve) => {
      readTimer = setTimer(() => {
        readTimer = null;
        abort?.abort();
        resolve(null);
      }, STATE_TIMEOUT_MS);
    });
    try {
      state = await Promise.race([transport.fetchState(clientId, epoch !== null && seq > 0 && !missed ? { epoch, seq } : null, abort ? { signal: abort.signal } : {}), expired]);
    } catch {}
    if (readTimer !== null) clearTimer(readTimer);
    readTimer = null;
    fetching = false;
    if (stopped) return;
    if (asked.connection !== connection || fetchAgain) {
      if (connected) resync();
      return;
    }
    if (asked.stateCount !== stateCount) {
      if (synced) return;
      state = null;
    }
    if (state && typeof state.epoch === "string") {
      resyncDelay = RETRY_MS;
      applyState(state, asked.read);
      return;
    }
    if (state && STATE_GONE.has(state.status)) {
      stop();
      return;
    }
    // The host has no room for this document now: it holds as much live data
    // as it can (503 busy), or it is not answering (any other 503). Every
    // store goes at save speed, with its own pending ops, so a save never
    // writes the room's stale value. The lane asks again after Retry-After, a
    // minute for busy, or its usual backoff.
    if (state && state.status === 503) {
      const busy = state.code === "busy";
      for (const [name, entry] of entries) {
        if (entry.store.handle.status.mode !== "fast") continue;
        tell(name, { phase: "left", code: busy ? "busy" : "unavailable" });
        console.warn(`clay.live("${name}"): the host has no room for this document now, so it stays at save speed for now`);
        leaveRoom(name, laneOf(name));
      }
      roomNames = new Set();
      if (!connected) return;
      if (busy || state.retryAfter > 0) {
        resyncDelay = RETRY_MS;
        setTimer(resync, (state.retryAfter > 0 ? state.retryAfter : 60) * 1000);
      } else {
        setTimer(resync, resyncDelay);
        resyncDelay = Math.min(resyncDelay * 2, RETRY_MAX_MS);
      }
      return;
    }
    if (connected) {
      setTimer(resync, resyncDelay);
      resyncDelay = Math.min(resyncDelay * 2, RETRY_MAX_MS);
    }
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    if (timer !== null) clearTimer(timer);
    timer = null;
    if (readTimer !== null) clearTimer(readTimer);
    readTimer = null;
    unsubscribe?.();
    for (const [name, entry] of entries) {
      const lane = lanes.get(name);
      if (lane?.out) continue;
      if (lane) leaveRoom(name, lane);
      else {
        onLeave(name, { epoch, seq });
        entry.store.setMode("file");
      }
    }
    onStop();
  }

  const handlers = {
    open(info) {
      clientId = info.clientId;
      connected = true;
      connection++;
      resync();
    },
    close() {
      connected = false;
      connection++;
      synced = false;
      buffered = [];
    },
    frame: onFrame,
    // A broadcast state carries no moves. While a store is out, the rejoin
    // goes through this tab's own read, which carries them.
    state(state) {
      if (missed && state && !("moves" in state)) resync();
      else applyState(state);
    },
    // The room's writer, and how far the file reaches when a save landed.
    writer(data) {
      if (!data || data.epoch !== epoch) return;
      writer = data.writer ?? null;
      if (data.landed && typeof data.landed === "object") {
        // A state read in flight was taken before this: its landed is older.
        stateCount++;
        for (const [name, landed] of Object.entries(data.landed)) {
          const entry = entries.get(name);
          if (entry && Number.isInteger(landed)) {
            entry.landed = landed;
            tell(name, { phase: "checkpointed", seq: landed });
          }
        }
        onLanded();
      }
      onWriter();
    },
  };

  return {
    start() {
      if (!unsubscribe && !stopped) unsubscribe = transport.start(handlers);
    },
    // A store committed ops; lastId is the id of the last one (store.mark).
    local(name, ops, lastId) {
      if (stopped || epoch === null || !roomNames.has(name)) return;
      const lane = laneOf(name);
      const first = lastId - ops.length + 1;
      ops.forEach((op, i) => lane.unsent.push({ id: first + i, op }));
      schedule();
    },
    // The save that held this store ended: frame whatever is still pending past
    // what was framed (an accepted save's ops have left pending). A state it
    // kept from the store, or a value the caller kept (read), is replaced by a
    // read of the room, which frames what is pending when the store takes it.
    release(name, { read = false } = {}) {
      if (stopped) return;
      const lane = laneOf(name);
      // A read release arms the barrier even before the first epoch exists: the
      // state that may apply has to be one read after this, and a lane that has
      // not joined a room yet has nothing to fetch.
      if (lane.deferred || read) {
        lane.after = reads + 1;
        if (epoch !== null && connected) resync();
        return;
      }
      if (epoch === null) return;
      if (!roomNames.has(name)) return;
      prune(name, lane);
      lane.unsent = unframed(name, lane);
      schedule();
    },
    // Lifetime frame counter retained for the legacy fixture harness.
    framed(name) {
      return lanes.get(name)?.n ?? 0;
    },
    pendingFrames(name, at, { reserve = false } = {}) {
      const lane = lanes.get(name);
      if (reserve && lane && clientId && epoch === at?.epoch) {
        const pending = unframed(name, lane);
        while (pending.length) {
          let size = byteSize({ name, n: lane.n + 1, ops: [], epoch });
          let count = 0;
          while (count < pending.length && count < MAX_OPS) {
            const more = byteSize(pending[count].op) + 1;
            if (count && size + more > frameBytes) break;
            size += more;
            count++;
          }
          const take = pending.splice(0, count);
          const frame = { n: ++lane.n, ops: take.map((e) => e.op), entries: take,
            first: take[0].id, through: take[take.length - 1].id, seq: null,
            sent: false, refused: true, epoch, client: clientId, receiptGeneration };
          lane.awaiting.push(frame);
          lane.framed = frame.through;
        }
        lane.unsent = [];
      }
      const ids = new Set(entries.get(name)?.store.pendingEntries().map((e) => e.id) ?? []);
      let frames = [];
      let complete = true;
      for (const frame of lane?.awaiting ?? []) {
        const present = frame.entries.filter((e) => ids.has(e.id));
        if (!present.length) continue;
        if (present.length !== frame.entries.length || frame.epoch !== at?.epoch || !frame.client) {
          complete = false;
          continue;
        }
        frames = unionRanges(frames, [[frame.client, [[frame.n, frame.n]]]]);
      }
      return { frames, complete };
    },
    captured(name, at, by) {
      const lane = lanes.get(name);
      if (!lane || !at || at.epoch !== epoch) return [];
      const included = frameSet(by);
      const dropIds = [];
      lane.awaiting = lane.awaiting.filter((frame) => {
        const held = frame.epoch === at.epoch &&
          (contains(included, frame.client, frame.n) || (frame.seq !== null && frame.seq <= at.seq));
        if (held) dropIds.push(...frame.entries.map((e) => e.id));
        return !held;
      });
      return dropIds;
    },
    // Read the room again: a store opened after this tab joined, or a save the
    // room merged whose state may not have arrived yet.
    refresh() {
      if (epoch !== null && connected) resync();
    },
    storeOpened() {
      if (epoch !== null && connected) resync();
    },
    roomBound(name) {
      return !stopped && lanes.get(name)?.room === true;
    },
    isWriter() {
      return writer !== null && writer === clientId;
    },
    get status() {
      return { connected, synced, epoch, seq, writer, clientId, stopped, provenanceVersion, receiptGeneration };
    },
    stop,
  };
}
