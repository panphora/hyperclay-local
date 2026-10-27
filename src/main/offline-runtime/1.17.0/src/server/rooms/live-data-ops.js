// The operation model behind clay.live stores: a verbatim copy of ClayJS's
// src/live/ops.js. Keep the two identical; tests/fixtures/live-ops.json pins both.
// Every client and the server apply the same ops to the same value and get
// byte-identical JSON, object key order included, so nothing here may depend
// on timing or on where a value came from.

const INDEX = /^(0|[1-9]\d*)$/;
const OPS = new Set(["set", "del", "add"]);

const isContainer = (v) => v !== null && typeof v === "object";
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function setOwn(obj, key, value) {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
}

// "players.alice.x" or ["players", "alice", "x"] -> segments. In the dotted form a
// canonical non-negative integer becomes an index; a key containing a dot needs
// the array form.
export function parsePath(path) {
  if (Array.isArray(path)) {
    for (const seg of path) checkSegment(seg);
    return path.slice();
  }
  if (typeof path !== "string") throw new TypeError("clay.live: a path is a dotted string or an array of keys");
  if (path === "") return [];
  return path.split(".").map((s) => (INDEX.test(s) ? Number(s) : s));
}

function checkSegment(seg) {
  if (typeof seg === "string") return;
  if (Number.isInteger(seg) && seg >= 0) return;
  throw new TypeError(`clay.live: path segment ${String(seg)} is not a string or a non-negative integer`);
}

// A deep copy that refuses anything JSON cannot hold, so a stored value can
// never be mutated through an outside reference and always serializes.
export function cloneJson(value, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("clay.live: numbers must be finite");
    return value;
  }
  if (typeof value !== "object") throw new TypeError(`clay.live: a ${typeof value} is not JSON`);
  if (seen.has(value)) throw new TypeError("clay.live: the value contains a cycle");
  seen.add(value);
  let out;
  if (Array.isArray(value)) {
    out = [];
    for (let i = 0; i < value.length; i++) {
      if (!(i in value)) throw new TypeError("clay.live: sparse arrays are not JSON");
      out.push(cloneJson(value[i], seen));
    }
  } else {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw new TypeError("clay.live: only plain objects and arrays are JSON");
    out = {};
    for (const key of Object.keys(value)) setOwn(out, key, cloneJson(value[key], seen));
  }
  seen.delete(value);
  return out;
}

// Shape check, before anything is touched. Returns a normalized op with its
// value already cloned.
export function validateOp(op) {
  if (!isContainer(op) || !OPS.has(op.op)) throw new TypeError("clay.live: an op is { op: \"set\" | \"del\" | \"add\", path, ... }");
  const path = parsePath(op.path);
  if (op.op === "set") {
    if (op.value === undefined) throw new TypeError("clay.live: set needs a value; use delete to remove");
    const value = cloneJson(op.value);
    if (path.length === 0 && !isContainer(value)) throw new TypeError("clay.live: the whole value must be an object or an array");
    return { op: "set", path, value };
  }
  if (path.length === 0) throw new TypeError(`clay.live: ${op.op} needs a path`);
  if (op.op === "add") {
    if (typeof op.n !== "number" || !Number.isFinite(op.n)) throw new TypeError("clay.live: add needs a finite number");
    return { op: "add", path, n: op.n };
  }
  return { op: "del", path };
}

function indexOf(arr, seg) {
  if (typeof seg === "number") return seg;
  if (INDEX.test(seg)) return Number(seg);
  return -1;
}

function read(container, seg) {
  if (Array.isArray(container)) {
    const i = indexOf(container, seg);
    return i >= 0 && i < container.length ? container[i] : undefined;
  }
  const key = String(seg);
  return has(container, key) ? container[key] : undefined;
}

// Throws, without mutating anything, when op cannot apply to root: a string
// key on a list, or a list index past the end. A missing or non-container
// step along the way is not an error: applyOp replaces it with a container.
export function checkOp(root, op) {
  if (op.path.length === 0) {
    if (op.op === "set" && (!isContainer(op.value) || Array.isArray(op.value) !== Array.isArray(root))) {
      throw new TypeError(`clay.live: the whole value must stay ${Array.isArray(root) ? "a list" : "an object"}`);
    }
    return;
  }
  let node = root;
  for (let i = 0; i < op.path.length; i++) {
    const seg = op.path[i];
    const last = i === op.path.length - 1;
    if (!isContainer(node)) {
      // The rest of the path will be created, and a new list starts empty: an
      // index other than 0 would leave holes, which are not JSON.
      if (op.op === "del") return;
      for (let j = i; j < op.path.length; j++) {
        if (typeof op.path[j] === "number" && op.path[j] !== 0) {
          throw new RangeError(`clay.live: index ${op.path[j]} would leave holes in a new list at ${op.path.slice(0, j).join(".") || "the root"}`);
        }
      }
      return;
    }
    if (Array.isArray(node)) {
      const idx = indexOf(node, seg);
      if (idx < 0) throw new TypeError(`clay.live: "${seg}" is not an index of the list at ${op.path.slice(0, i).join(".") || "the root"}`);
      const limit = last && op.op !== "del" ? node.length : node.length - 1;
      if (idx > limit && !(last && op.op === "del")) throw new RangeError(`clay.live: index ${idx} is past the end of the list at ${op.path.slice(0, i).join(".") || "the root"}`);
    }
    if (last) return;
    node = read(node, seg);
  }
}

function put(container, seg, value) {
  if (Array.isArray(container)) container[indexOf(container, seg)] = value;
  else setOwn(container, String(seg), value);
}

// Applies one checked op. Mutates root and returns it, or returns the new root
// for a whole-value set.
export function applyOp(root, op) {
  const { path } = op;
  if (path.length === 0) return cloneJson(op.value);
  let parent = root;
  for (let i = 0; i < path.length - 1; i++) {
    let next = read(parent, path[i]);
    if (!isContainer(next)) {
      if (op.op === "del") return root;
      next = typeof path[i + 1] === "number" ? [] : {};
      put(parent, path[i], next);
    }
    parent = next;
  }
  const last = path[path.length - 1];
  if (op.op === "set") {
    put(parent, last, cloneJson(op.value));
  } else if (op.op === "add") {
    const cur = read(parent, last);
    put(parent, last, (typeof cur === "number" && Number.isFinite(cur) ? cur : 0) + op.n);
  } else if (Array.isArray(parent)) {
    const idx = indexOf(parent, last);
    if (idx >= 0 && idx < parent.length) parent.splice(idx, 1);
  } else {
    delete parent[String(last)];
  }
  return root;
}

// Applies a list of ops in order; checks each one against the value as it
// stands at that point. Callers that need atomicity apply to a clone.
export function applyOps(root, ops) {
  let value = root;
  for (const op of ops) {
    checkOp(value, op);
    value = applyOp(value, op);
  }
  return value;
}

// applyOp, keeping what it changed so a caller can size the change or take it
// back. null when the op changes nothing. Otherwise root is the value to go on
// with (a new one only for a whole-value set, where at is null and old is the
// previous root), and at[key] is the one slot the op changed, at path. kind
// says how: "put" replaced old, "add" made the slot (a new key, or an item
// appended to a list of size items), "remove" took old out. For an object, keys
// lists its keys before a remove, and empty says it had none before an add.
// Checks the op first, so a throw changes nothing.
export function applyTracked(root, op) {
  checkOp(root, op);
  const { path } = op;
  if (path.length === 0) {
    return { root: cloneJson(op.value), at: null, key: null, kind: "put", old: root, path: [], size: 0, keys: null, empty: false };
  }
  let at = root;
  let depth = path.length - 1;
  for (let i = 0; i < path.length - 1; i++) {
    const next = read(at, path[i]);
    if (!isContainer(next)) {
      if (op.op === "del") return null;
      depth = i;
      break;
    }
    at = next;
  }
  const list = Array.isArray(at);
  const key = list ? indexOf(at, path[depth]) : String(path[depth]);
  const size = list ? at.length : 0;
  const had = list ? key < size : has(at, key);
  if (op.op === "del" && !had) return null;
  const kind = op.op === "del" ? "remove" : had ? "put" : "add";
  const rec = { root, at, key, kind, old: had ? at[key] : undefined, path: path.slice(0, depth + 1), size, keys: null, empty: false };
  if (!list && kind === "remove") rec.keys = Object.keys(at);
  if (!list && kind === "add") rec.empty = isEmpty(at);
  applyOp(root, op);
  return rec;
}

function isEmpty(obj) {
  for (const key in obj) if (has(obj, key)) return false;
  return true;
}

// Takes back one applyTracked change; a frame's records go back newest first.
// Returns the root as it was before that op.
export function undoTracked(rec) {
  const { at, key, kind, old } = rec;
  if (at === null) return old;
  if (Array.isArray(at)) {
    if (kind === "put") at[key] = old;
    else if (kind === "add") at.length = rec.size;
    else at.splice(key, 0, old);
  } else if (kind === "put") setOwn(at, key, old);
  else if (kind === "add") delete at[key];
  else if (rec.keys[rec.keys.length - 1] === key) setOwn(at, key, old);
  else {
    // Back in its place: every key after it is put back behind it.
    const values = rec.keys.map((k) => (k === key ? old : at[k]));
    for (const k of rec.keys) if (k !== key) delete at[k];
    rec.keys.forEach((k, i) => setOwn(at, k, values[i]));
  }
  return rec.root;
}

// What one applyTracked change did to the length of serializeLive(root), with
// size(v) the length of serializeLive(v) in the caller's unit and total the
// root's length before. Call it before the next op touches the slot.
export function sizeChange(rec, size, total) {
  const { at, key, kind, old } = rec;
  if (at === null) return size(rec.root) - total;
  const list = Array.isArray(at);
  const slot = list ? 0 : size(key) + 1;
  if (kind === "put") return size(at[key]) - size(old);
  if (kind === "add") return slot + size(at[key]) + ((list ? rec.size > 0 : !rec.empty) ? 1 : 0);
  return -(slot + size(old)) - ((list ? rec.size : rec.keys.length) > 1 ? 1 : 0);
}

const samePath = (a, b) => a.length === b.length && a.every((s, i) => String(s) === String(b[i]));

// Merges neighbouring ops on the same path, without changing the result:
// set,set -> the later set; add,add -> one add of the sum; set,add -> one set of
// the sum; set,del and add,del -> the del, but only on a one-segment path (a
// deeper set may have created the parents the del leaves behind). A del is never
// merged with what follows it (on a list it shifts the indexes after it).
export function coalesce(ops) {
  const out = [];
  for (const op of ops) {
    const prev = out[out.length - 1];
    if (!prev || prev.op === "del" || !samePath(prev.path, op.path)) {
      out.push(op);
      continue;
    }
    if (op.op === "del" && op.path.length > 1) {
      out.push(op);
    } else if (op.op === "set" || op.op === "del") {
      out[out.length - 1] = op;
    } else if (prev.op === "add") {
      out[out.length - 1] = { op: "add", path: prev.path, n: prev.n + op.n };
    } else {
      const base = typeof prev.value === "number" ? prev.value : 0;
      out[out.length - 1] = { op: "set", path: prev.path, value: base + op.n };
    }
  }
  return out;
}

// True when one path is a prefix of the other: an op on one can change what
// the other reads.
export function overlaps(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (String(a[i]) !== String(b[i])) return false;
  return true;
}

// Makes target equal next in place, keeping the identity of every nested
// object or list that still sits at the same path with the same type, so a
// reference handed out earlier stays live. Object keys end up in next's order.
// next's own nested values are moved in, not copied: pass a fresh value.
export function assignDeep(target, next) {
  if (Array.isArray(target)) {
    for (let i = 0; i < next.length; i++) target[i] = reuse(i < target.length ? target[i] : undefined, next[i]);
    target.length = next.length;
    return target;
  }
  const keys = Object.keys(next);
  const values = keys.map((k) => reuse(has(target, k) ? target[k] : undefined, next[k]));
  for (const k of Object.keys(target)) delete target[k];
  keys.forEach((k, i) => setOwn(target, k, values[i]));
  return target;
}

function reuse(cur, next) {
  if (isContainer(cur) && isContainer(next) && Array.isArray(cur) === Array.isArray(next)) return assignDeep(cur, next);
  return next;
}

// The text a live store writes into its script tag. `<` is escaped so a value
// holding "</script>" can never end the element.
export function serializeLive(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

// A live tag's lineage, `live-at="<epoch>:<seq>:<hash>"`: the room position its
// value was written at, and a hash of the exact text, so a room can tell its own
// unedited value from an edit of it.
const STAMP = /^([A-Za-z0-9-]{1,64}):(0|[1-9]\d*):([0-9a-f]{8})$/;

// FNV-1a over UTF-16 code units, as 8 hex digits. Both copies must agree.
export function textHash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function stampOf(epoch, seq, text) {
  return `${epoch}:${seq}:${textHash(text)}`;
}

export function parseStamp(value) {
  const m = typeof value === "string" ? STAMP.exec(value) : null;
  return m ? { epoch: m[1], seq: Number(m[2]), hash: m[3] } : null;
}

// The leaf-level ops that turn before into after: set for a changed or added
// leaf, del for a removed key, a whole-value set where the container kind or a
// list's length changes. Every op is idempotent, so replaying the result over a
// value that already holds `after` at those paths changes nothing.
export function diffOps(before, after, path = []) {
  if (!isContainer(before) || !isContainer(after) || Array.isArray(before) !== Array.isArray(after)) {
    return [{ op: "set", path, value: cloneJson(after) }];
  }
  if (Array.isArray(before)) {
    if (before.length !== after.length) return [{ op: "set", path, value: cloneJson(after) }];
    const out = [];
    for (let i = 0; i < after.length; i++) {
      if (serializeLive(before[i]) !== serializeLive(after[i])) out.push(...diffOps(before[i], after[i], [...path, i]));
    }
    return out;
  }
  const out = [];
  for (const key of Object.keys(before)) if (!has(after, key)) out.push({ op: "del", path: [...path, key] });
  for (const key of Object.keys(after)) {
    if (!has(before, key)) out.push({ op: "set", path: [...path, key], value: cloneJson(after[key]) });
    else if (serializeLive(before[key]) !== serializeLive(after[key])) out.push(...diffOps(before[key], after[key], [...path, key]));
  }
  return out;
}
