// A clay.live store: one JSON value held in memory and changed only through ops.
// What page code reads (state) is the last value the store accepted from outside
// (authoritative) with this tab's own unconfirmed ops (pending) replayed over it.
// Local ops change state at once. When authoritative moves, state is rebuilt in
// place, so an object or list page code holds a reference to stays live.

import { validateOp, checkOp, applyOp, applyOps, applyTracked, undoTracked, cloneJson, assignDeep, coalesce, overlaps, serializeLive } from "./ops.js";

const MUTATORS = new Set(["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "copyWithin"]);
const INDEX = /^(0|[1-9]\d*)$/;
const isContainer = (v) => v !== null && typeof v === "object";
const kind = (v) => (Array.isArray(v) ? "a list" : "an object");

function readPath(root, path) {
  let node = root;
  for (const seg of path) {
    if (!isContainer(node)) return undefined;
    if (Array.isArray(node)) node = node[Number(seg)];
    else node = Object.prototype.hasOwnProperty.call(node, seg) ? node[seg] : undefined;
  }
  return node;
}

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const sameOp = (a, b) => serializeLive(a) === serializeLive(b);

// Applies ops in place, all or none: the records of what changed, or null
// (and root as it was) when one does not apply.
function track(root, ops) {
  const done = [];
  try {
    for (const op of ops) {
      const rec = applyTracked(root, op);
      if (rec) {
        done.push(rec);
        root = rec.root;
      }
    }
    return done;
  } catch {
    untrack(done);
    return null;
  }
}

function untrack(done) {
  let root;
  for (let i = done.length - 1; i >= 0; i--) root = undoTracked(done[i]);
  return root;
}

// What a frame's ops did, slot by slot, when page state can follow them one
// slot at a time instead of a rebuild: each object slot the frame changed once
// or more (path, whether it held a value before and its value then), none
// inside another, no list changed at its own level, no whole value replaced,
// and no key taken out and put back (that moves the key to the end). Pending
// ops this tab has not seen confirmed must not touch those slots, nor add or
// remove keys beside a key the frame adds. With each slot, the object in state
// that mirrors it (into). null: rebuild.
function slotsOf(done, pending, state) {
  const slots = [];
  for (const rec of done) {
    if (rec.at === null || Array.isArray(rec.at)) return null;
    const slot = slots.find((x) => x.path.length === rec.path.length && overlaps(x.path, rec.path));
    if (slot) {
      // Taken out and put back in one frame: the key moves to the end.
      if (slot.removed && rec.kind !== "remove") return null;
      if (rec.kind === "remove") slot.removed = true;
      continue;
    }
    if (slots.some((x) => overlaps(x.path, rec.path))) return null;
    slots.push({ path: rec.path, at: rec.at, key: rec.key, had: rec.kind !== "add", old: rec.old, removed: rec.kind === "remove" });
  }
  for (const slot of slots) {
    slot.has = has(slot.at, slot.key);
    if (slot.had && slot.has && slot.removed) return null;
    slot.into = readPath(state, slot.path.slice(0, -1));
    if (!isContainer(slot.into) || Array.isArray(slot.into) || has(slot.into, slot.key) !== slot.had) return null;
    const parent = slot.path.slice(0, -1);
    for (const entry of pending) {
      const path = entry.op.path;
      if (overlaps(slot.path, path)) return null;
      // A pending delete in a list above the slot shifts the indices the
      // frame's path counts in.
      if (entry.op.op === "del" && path.length <= slot.path.length && overlaps(path.slice(0, -1), slot.path) && Array.isArray(readPath(state, path.slice(0, -1)))) return null;
      // A key the frame adds goes last; a pending op that adds or takes out a
      // key of the same object would order them differently in a rebuild.
      if (!slot.had && slot.has && path.length > parent.length && overlaps(parent, path)) {
        const child = path[parent.length];
        if (path.length === parent.length + 1 ? entry.op.op === "del" || !has(slot.at, String(child)) : !has(slot.at, String(child))) return null;
      }
    }
  }
  return slots;
}

// applyOp, except that a set replacing a container with one of the same kind
// rewrites it in place, so a proxy over the old container still points at the
// value page code sees.
function applyInPlace(root, op) {
  if (op.op === "set") {
    const current = readPath(root, op.path);
    if (isContainer(current) && isContainer(op.value) && Array.isArray(current) === Array.isArray(op.value)) {
      assignDeep(current, cloneJson(op.value));
      return;
    }
  }
  applyOp(root, op);
}

export function createStore({ name, value, ephemeral = false }) {
  if (!isContainer(value)) throw new TypeError(`clay.live("${name}"): the tag must hold a JSON object or list`);

  let authoritative = cloneJson(value);
  const state = cloneJson(value);
  // state is authoritative with pending replayed over it. Only a confirm whose
  // ops no longer apply breaks that, until the next rebuild.
  let coherent = true;
  // This tab's unconfirmed ops, oldest first, each with a local id that only grows.
  let pending = [];
  let nextId = 1;
  let batch = null;
  let mode = "file";
  const listeners = new Set();
  const sinks = new Set();
  const rebases = new Set();
  const confirmations = new Set();
  const deliveries = new Set();
  const views = new WeakMap();

  function emit(source, ops) {
    const event = { source, ops };
    for (const fn of [...listeners]) {
      try {
        fn(event);
      } catch (err) {
        console.error(`clay.live("${name}"): a change listener threw`, err);
      }
    }
  }

  function rebuild() {
    let next = cloneJson(authoritative);
    const kept = [];
    for (const entry of pending) {
      try {
        checkOp(next, entry.op);
        next = applyOp(next, entry.op);
        kept.push(entry);
      } catch {}
    }
    pending = kept;
    assignDeep(state, next);
    coherent = true;
  }

  function tell(event) {
    for (const fn of [...rebases]) {
      try {
        fn(event);
      } catch (err) {
        console.error(`clay.live("${name}"): a rebase listener threw`, err);
      }
    }
  }

  // drop: [first, last], the pending ops with ids in that range are taken out
  // (an op the host refused); the others stay.
  function rebase(next, { source = "remote", confirmed = 0, through, drop, dropIds, frame = null, room = null, cause = null } = {}) {
    if (!isContainer(next) || kind(next) !== kind(state)) {
      console.warn(`clay.live("${name}"): ignored an incoming value that is not ${kind(state)}`);
      return false;
    }
    const before = serializeLive(state);
    const prev = authoritative;
    authoritative = cloneJson(next);
    if (drop) pending = pending.filter((entry) => entry.id < drop[0] || entry.id > drop[1]);
    else if (dropIds) { const ids = new Set(dropIds); pending = pending.filter((entry) => !ids.has(entry.id)); }
    else pending = through === undefined ? pending.slice(confirmed) : pending.filter((entry) => entry.id > through);
    rebuild();
    tell({ source, frame, room, cause, prev, before: (path) => readPath(prev, path), next: authoritative });
    if (serializeLive(state) !== before) emit(source, null);
    return true;
  }

  // The value before the frame whose records are done: authoritative copied,
  // with the records taken back in the copy, path by path.
  function priorOf(done) {
    const copy = cloneJson(authoritative);
    for (let i = done.length - 1; i >= 0; i--) {
      const rec = done[i];
      undoTracked({ ...rec, at: readPath(copy, rec.path.slice(0, -1)) });
    }
    return copy;
  }

  function publish(ops) {
    for (const sink of [...sinks]) {
      try {
        sink(ops);
      } catch (err) {
        console.error(`clay.live("${name}"): a transport threw`, err);
      }
    }
    emit("local", ops);
  }

  function commit(rawOps) {
    const ops = rawOps.map(validateOp);
    for (const op of ops) {
      if (op.path.length === 0 && kind(op.value) !== kind(state)) {
        throw new TypeError(`clay.live("${name}"): the whole value must stay ${kind(state)}`);
      }
    }
    if (ops.length === 1) checkOp(state, ops[0]);
    else applyOps(cloneJson(state), ops);
    for (const op of ops) applyInPlace(state, op);
    pending.push(...ops.map((op) => ({ id: nextId++, op })));
    if (batch) batch.push(...ops);
    else publish(ops);
  }

  function view(target, path) {
    let byPath = views.get(target);
    if (!byPath) views.set(target, (byPath = new Map()));
    const key = JSON.stringify(path);
    let proxy = byPath.get(key);
    if (!proxy) {
      proxy = new Proxy(target, traps(path));
      byPath.set(key, proxy);
    }
    return proxy;
  }

  function traps(path) {
    return {
      get(target, prop) {
        if (Array.isArray(target) && MUTATORS.has(prop)) {
          return (...args) => {
            const copy = cloneJson(target);
            const result = Array.prototype[prop].apply(copy, args);
            commit([{ op: "set", path, value: copy }]);
            return result === copy ? view(target, path) : result;
          };
        }
        const value = target[prop];
        if (typeof prop === "symbol" || !isContainer(value) || !Object.prototype.hasOwnProperty.call(target, prop)) return value;
        return view(value, [...path, Array.isArray(target) ? Number(prop) : prop]);
      },
      set(target, prop, value) {
        if (typeof prop === "symbol") throw new TypeError(`clay.live("${name}"): symbol keys are not JSON`);
        if (Array.isArray(target)) {
          if (prop === "length") {
            const copy = cloneJson(target);
            copy.length = value;
            commit([{ op: "set", path, value: copy }]);
            return true;
          }
          if (!INDEX.test(prop)) throw new TypeError(`clay.live("${name}"): "${prop}" is not a list index`);
          commit([{ op: "set", path: [...path, Number(prop)], value }]);
          return true;
        }
        commit([{ op: "set", path: [...path, prop], value }]);
        return true;
      },
      deleteProperty(target, prop) {
        if (typeof prop === "symbol") return true;
        if (Array.isArray(target)) throw new TypeError(`clay.live("${name}"): remove a list item with splice`);
        commit([{ op: "del", path: [...path, prop] }]);
        return true;
      },
      defineProperty() {
        throw new TypeError(`clay.live("${name}"): assign values instead of defining properties`);
      },
      setPrototypeOf() {
        return false;
      },
      preventExtensions() {
        return false;
      },
    };
  }

  const data = view(state, []);
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });

  const handle = Object.freeze({
    name,
    ephemeral,
    ready,
    get data() {
      return data;
    },
    get status() {
      return { mode };
    },
    set(path, value) {
      commit([{ op: "set", path, value }]);
    },
    delete(path) {
      commit([{ op: "del", path }]);
    },
    add(path, n = 1) {
      commit([{ op: "add", path, n }]);
    },
    update(fn) {
      if (typeof fn !== "function") throw new TypeError(`clay.live("${name}"): update() takes a function`);
      if (batch) return fn(data);
      batch = [];
      const mark = pending.length;
      const markId = nextId;
      let result;
      try {
        result = fn(data);
        if (result && typeof result.then === "function") {
          throw new TypeError(`clay.live("${name}"): update() runs synchronously; do async work before calling it`);
        }
      } catch (err) {
        batch = null;
        pending.length = mark;
        nextId = markId;
        rebuild();
        throw err;
      }
      const ops = coalesce(batch);
      batch = null;
      pending.length = mark;
      nextId = markId;
      pending.push(...ops.map((op) => ({ id: nextId++, op })));
      if (ops.length) publish(ops);
      return result;
    },
    on(type, fn) {
      if (type !== "change") throw new TypeError(`clay.live("${name}"): the only event is "change"`);
      if (typeof fn !== "function") throw new TypeError(`clay.live("${name}"): on() takes a function`);
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    off(type, fn) {
      listeners.delete(fn);
    },
    toJSON() {
      return cloneJson(state);
    },
  });
  resolveReady(handle);

  return {
    handle,
    name,
    ephemeral,
    // The live value itself, for serializing into a save. Never mutate it.
    get value() {
      return state;
    },
    // The room's value. A frame changes it in place (rebaseOps), so a caller
    // that keeps any part of it past the call copies it. Never mutate it.
    get authoritative() {
      return authoritative;
    },
    get pending() {
      return pending.map((entry) => entry.op);
    },
    // The same ops with their ids, for a transport that resends them.
    pendingEntries() {
      return pending.map((entry) => ({ id: entry.id, op: entry.op }));
    },
    // The id of the newest op this store has committed (0 before the first).
    get mark() {
      return nextId - 1;
    },
    setMode(next) {
      mode = next;
    },
    // A transport hears every local op batch, in order, as it is committed.
    onLocal(fn) {
      sinks.add(fn);
      return () => sinks.delete(fn);
    },
    // This tab's ops up to and including `through` are in the file (the save
    // that carried them was accepted) and no newer value arrived since: they
    // become part of authoritative. The value page code sees does not change.
    confirm(through) {
      const taken = pending.filter((entry) => entry.id <= through);
      if (!taken.length) return;
      try {
        authoritative = applyOps(cloneJson(authoritative), taken.map((entry) => entry.op));
      } catch {
        authoritative = cloneJson(state);
        coherent = false;
      }
      pending = pending.filter((entry) => entry.id > through);
      for (const fn of [...confirmations]) {
        try {
          fn({ through });
        } catch (err) {
          console.error(`clay.live("${name}"): a confirmation listener threw`, err);
        }
      }
    },
    onConfirm(fn) {
      confirmations.add(fn);
      return () => confirmations.delete(fn);
    },
    // A new value from outside. Ops already in it are dropped: the first
    // `confirmed` pending ops, or every op up to the mark `through`. The rest
    // replay over it; a pending op that no longer applies is dropped too.
    // Listeners hear about it only when the value page code sees changed.
    rebase,
    // The ops of a frame the room ordered, checked: the same ops validated, or
    // null when they do not apply to authoritative as a whole.
    checkOps(ops) {
      let checked;
      try {
        checked = ops.map(validateOp);
      } catch {
        return null;
      }
      const done = track(authoritative, checked);
      if (!done) return null;
      untrack(done);
      return checked;
    },
    // rebase(authoritative with checked ops applied, options), without copying
    // the whole value: the ops change authoritative in place, and page state
    // follows slot by slot when slotsOf allows, or does not move when the ops
    // are this tab's own pending ops coming back. Anything else rebuilds, as
    // rebase does. Listeners get prev only when they read it, and before(path)
    // for what one path held. next is authoritative itself, changed in place by
    // later frames: a listener copies what it keeps; prev is its own copy.
    rebaseOps(ops, { source = "remote", confirmed = 0, through, frame = null, room = null, cause = null } = {}) {
      const done = track(authoritative, ops);
      if (!done) return false;
      const kept = through === undefined ? pending.slice(confirmed) : pending.filter((entry) => entry.id > through);
      const dropped = pending.length - kept.length;
      const whole = done.some((rec) => rec.at === null);
      const own = coherent && !whole && dropped === ops.length && ops.every((op, i) => sameOp(op, pending[i].op));
      const slots = coherent && !own && dropped === 0 ? slotsOf(done, kept, state) : null;
      if (!own && !slots) {
        untrack(done);
        return rebase(applyOps(cloneJson(authoritative), ops), { source, confirmed, through, frame, room, cause });
      }
      pending = kept;
      let changed = false;
      for (const slot of slots ?? []) {
        const at = slot.into;
        if (slot.has) {
          const value = slot.at[slot.key];
          if (!slot.had || serializeLive(slot.old) !== serializeLive(value)) changed = true;
          const cur = slot.had ? at[slot.key] : undefined;
          const next = cloneJson(value);
          const same = isContainer(cur) && isContainer(next) && Array.isArray(cur) === Array.isArray(next);
          Object.defineProperty(at, slot.key, { value: same ? assignDeep(cur, next) : next, enumerable: true, writable: true, configurable: true });
        } else if (slot.had) {
          changed = true;
          delete at[slot.key];
        }
      }
      let prior = null;
      const prev = () => (prior ??= priorOf(done));
      const shifted = done.some((rec) => Array.isArray(rec.at) && rec.kind !== "put");
      const before = (path) => {
        if (shifted) return readPath(prev(), path);
        for (const rec of done) {
          if (!overlaps(rec.path, path)) continue;
          if (rec.path.length > path.length) return readPath(prev(), path);
          return readPath(rec.old, path.slice(rec.path.length));
        }
        return readPath(authoritative, path);
      };
      tell({ source, frame, room, cause, get prev() { return prev(); }, before, next: authoritative });
      if (changed) emit(source, null);
      return true;
    },
    // Every rebase, whether or not the value page code sees changed, with what
    // caused it: the frame the room applied, the state read, or the lane's own
    // settling. For the page editor; never on the handle.
    onRebase(fn) {
      rebases.add(fn);
      return () => rebases.delete(fn);
    },
    // What became of this tab's frames: { phase, code, n, seq, through, retryAfter }.
    onDelivery(fn) {
      deliveries.add(fn);
      return () => deliveries.delete(fn);
    },
    deliver(event) {
      for (const fn of [...deliveries]) {
        try {
          fn(event);
        } catch (err) {
          console.error(`clay.live("${name}"): a delivery listener threw`, err);
        }
      }
    },
  };
}
