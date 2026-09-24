/**
 * WireHub — htmlclay's wire, pure and in memory, one instance per app (CONTRACTS §11).
 *
 * A per-file control channel between a page and a local process: a page asks, a
 * process answers with status frames and one terminal frame, and the process edits
 * the FILE. HTML never rides the wire. The hub holds one exclusive handler slot per
 * file, caps observers, retains each request's FIRST terminal frame for five minutes,
 * and replays only the terminals above a reconnecting client's cursor.
 *
 * Pure: no routes, no disk, no timers. The clock is injected, so retention can be
 * tested against it. Port of htmlclay/internal/server/wire.go; the deliberate
 * differences are Node's single thread (no lock), the Go 32-frame subscriber queue
 * becoming a buffered-bytes threshold, and replay being sorted by sequence because
 * this side has no map iteration order to inherit. `bindHelpers`/`unbindHelpers`
 * are not ported yet.
 */

const MAX_WIRE_BODY = 1 << 20;
const MAX_WIRE_TEXT = 4 << 10;
const MAX_WIRE_ID_LEN = 128;
const MAX_WIRE_SUBS = 8;
const MAX_WIRE_TERMINALS = 32;
const WIRE_TERMINAL_TTL_MS = 5 * 60 * 1000;
const WIRE_GLOBAL_MAX_TERMINAL_BYTES = 8 << 20;
const WIRE_MAX_BUFFERED = 1 << 20;

class WireError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function isTerminal(env) {
  return env.type === 'wire/done' || env.type === 'wire/error';
}

function envelopeJSON(env) {
  const out = { v: env.v, type: env.type, id: env.id };
  if (env.from) out.from = env.from;
  out.file = env.file;
  if (env.helper) out.helper = env.helper;
  if (env.document) out.document = env.document;
  if (env.text) out.text = env.text;
  if (env.payload !== undefined) out.payload = env.payload;
  return JSON.stringify(out);
}

class WireHub {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.chans = new Map();
    this.seq = 0;
    this.closed = false;
    this.terminalBytes = 0;
    this.namedHandler = null;
    this.namedCancels = new Map();
  }

  setNamedRequestHandler(fn) {
    this.namedHandler = fn;
  }

  nextSeq() {
    const t = this.now();
    this.seq = t > this.seq ? t : this.seq + 1;
    return this.seq;
  }

  _ensure(key) {
    let c = this.chans.get(key);
    if (!c) {
      c = { subs: new Set(), handler: null, terminal: new Map() };
      this.chans.set(key, c);
    }
    return c;
  }

  add(sub, lastEventId) {
    if (this.closed) throw new WireError('closed');
    this.sweep();
    const c = this._ensure(sub.key);
    if (!sub.handler && c.subs.size >= MAX_WIRE_SUBS) throw new WireError('busy');
    if (sub.handler) {
      if (c.handler) throw new WireError('handler-taken');
      c.handler = sub;
    }
    c.subs.add(sub);
    if (!(lastEventId > 0)) return { cursor: this.nextSeq(), replay: [] };
    const replay = [...c.terminal.values()]
      .filter((t) => t.seq > lastEventId)
      .sort((a, b) => a.seq - b.seq)
      .map((t) => t.frame);
    return { cursor: lastEventId, replay };
  }

  remove(sub) {
    if (sub.removed) return;
    sub.removed = true;
    const c = this.chans.get(sub.key);
    if (c) this._removeFromChannel(c, sub.key, sub);
    this.sweep();
    sub.stop();
  }

  _removeFromChannel(c, key, sub) {
    c.subs.delete(sub);
    if (c.handler === sub) c.handler = null;
    if (c.subs.size === 0 && c.terminal.size === 0) this.chans.delete(key);
  }

  _retain(c, id, t) {
    c.terminal.set(id, t);
    this.terminalBytes += t.frame.length;
    this._expire(c);
    while (this.terminalBytes > WIRE_GLOBAL_MAX_TERMINAL_BYTES) {
      let oldest = null;
      for (const ch of this.chans.values()) {
        for (const [tid, term] of ch.terminal) {
          if (!oldest || term.at < oldest.term.at) oldest = { ch, tid, term };
        }
      }
      if (!oldest) break;
      this._dropTerminal(oldest.ch, oldest.tid);
    }
  }

  _dropTerminal(c, id) {
    const t = c.terminal.get(id);
    if (!t) return;
    c.terminal.delete(id);
    this.terminalBytes -= t.frame.length;
  }

  _expire(c) {
    const cutoff = this.now() - WIRE_TERMINAL_TTL_MS;
    for (const [id, t] of c.terminal) if (t.at < cutoff) this._dropTerminal(c, id);
    while (c.terminal.size > MAX_WIRE_TERMINALS) {
      let oldestId = null;
      let oldestAt = Infinity;
      for (const [id, t] of c.terminal) if (t.at < oldestAt) { oldestId = id; oldestAt = t.at; }
      this._dropTerminal(c, oldestId);
    }
  }

  sweep() {
    for (const [key, c] of this.chans) {
      this._expire(c);
      if (c.subs.size === 0 && c.terminal.size === 0) this.chans.delete(key);
    }
  }

  _fanOut(c, key, frame, skip, countHandlers) {
    let handlers = 0;
    let observers = 0;
    const evicted = [];
    for (const sub of c.subs) {
      if (sub === skip || (!countHandlers && sub.handler)) continue;
      if (sub.offer(frame)) {
        if (sub.handler) handlers += 1;
        else observers += 1;
      } else {
        evicted.push(sub);
      }
    }
    for (const sub of evicted) {
      sub.removed = true;
      this._removeFromChannel(c, key, sub);
      sub.stop();
    }
    return { handlers, observers };
  }

  publish(key, env, owner = null) {
    const c = this.chans.get(key);
    if (!c || this.closed || (owner && c.handler !== owner)) return { handlers: 0, observers: 0, published: false };
    const seq = this.nextSeq();
    const frame = `id: ${seq}\ndata: ${envelopeJSON(env)}\n\n`;
    if (isTerminal(env) && env.id && !c.terminal.has(env.id)) {
      this._retain(c, env.id, { seq, frame, at: this.now() });
    }
    return { ...this._fanOut(c, key, frame, owner, true), published: true };
  }

  handlerMode(key) {
    const c = this.chans.get(key);
    if (!c || !c.handler) return null;
    return c.handler.mode || 'raw';
  }

  rejectNamedForRawHandler(key, request) {
    const c = this.chans.get(key);
    if (!c || !c.handler || (c.handler.mode && c.handler.mode !== 'raw') || this.closed) {
      return { rejected: false, observers: 0 };
    }
    const env = {
      v: 1,
      type: 'wire/error',
      id: request.id,
      from: 'process',
      file: key,
      helper: request.helper,
      text: 'this handler does not support named helpers',
      payload: { source: 'host', code: 'helper_protocol_unsupported' },
    };
    const seq = this.nextSeq();
    const frame = `id: ${seq}\ndata: ${envelopeJSON(env)}\n\n`;
    if (!c.terminal.has(env.id)) this._retain(c, env.id, { seq, frame, at: this.now() });
    const { observers } = this._fanOut(c, key, frame, null, false);
    return { rejected: true, observers };
  }

  shutdown() {
    if (this.closed) return;
    this.closed = true;
    const subs = [];
    for (const c of this.chans.values()) for (const sub of c.subs) { sub.removed = true; subs.push(sub); }
    this.chans = new Map();
    this.terminalBytes = 0;
    for (const sub of subs) sub.stop();
  }
}

function createWireSub({ key, handler, mode, res }) {
  return {
    key,
    handler,
    mode,
    removed: false,
    offer(frame) {
      if (res.writableEnded || res.writableLength > WIRE_MAX_BUFFERED) return false;
      res.write(frame);
      return true;
    },
    stop() {
      if (!res.writableEnded) res.end();
    },
  };
}

module.exports = {
  WireHub, WireError, createWireSub, envelopeJSON,
  MAX_WIRE_BODY, MAX_WIRE_TEXT, MAX_WIRE_ID_LEN, MAX_WIRE_SUBS, MAX_WIRE_TERMINALS,
};
