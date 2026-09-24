const { configureLiveSync, onLiveFrame } = require('./utils/root-live');

const REPLAY_TTL_MS = 5 * 60 * 1000;
const BUCKET_MAX_FRAMES = 64;
const BUCKET_MAX_BYTES = 16 * 1024 * 1024;
const GLOBAL_MAX_FRAMES = 512;
const GLOBAL_MAX_BYTES = 64 * 1024 * 1024;
const MAX_IDLE_BUCKETS = 1024;
const LANES = new Set(['live', 'saved']);

class ReplayStore {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.buckets = new Map();
    this.frames = 0;
    this.bytes = 0;
    this.lastSeq = now();
  }

  _key(file, lane) {
    return `${lane}\n${file}`;
  }

  _bucket(file, lane) {
    const k = this._key(file, lane);
    let b = this.buckets.get(k);
    if (!b) {
      b = { frames: [], bytes: 0, droppedThrough: 0, createdSeq: this.lastSeq };
      this.buckets.set(k, b);
      this._reapIdle();
    }
    return b;
  }

  record({ file, lane, seq, message }) {
    if (seq > this.lastSeq) this.lastSeq = seq;
    if (!LANES.has(lane)) return;
    const b = this._bucket(file, lane);
    const bytes = Buffer.byteLength(message);
    if (bytes > BUCKET_MAX_BYTES) {
      if (seq > b.droppedThrough) b.droppedThrough = seq;
      return;
    }
    b.frames.push({ seq, message, bytes, at: this.now() });
    b.bytes += bytes;
    this.frames += 1;
    this.bytes += bytes;
    while (b.frames.length > BUCKET_MAX_FRAMES || b.bytes > BUCKET_MAX_BYTES) this._dropOldest(b);
    while (this.frames > GLOBAL_MAX_FRAMES || this.bytes > GLOBAL_MAX_BYTES) {
      let oldest = null;
      for (const cand of this.buckets.values()) {
        if (cand.frames.length && (!oldest || cand.frames[0].seq < oldest.frames[0].seq)) oldest = cand;
      }
      if (!oldest) break;
      this._dropOldest(oldest);
    }
  }

  _dropOldest(b) {
    const f = b.frames.shift();
    b.bytes -= f.bytes;
    this.frames -= 1;
    this.bytes -= f.bytes;
    if (f.seq > b.droppedThrough) b.droppedThrough = f.seq;
  }

  expire() {
    const cutoff = this.now() - REPLAY_TTL_MS;
    for (const b of this.buckets.values()) {
      while (b.frames.length && b.frames[0].at < cutoff) this._dropOldest(b);
    }
  }

  _reapIdle() {
    let idle = 0;
    for (const b of this.buckets.values()) if (b.frames.length === 0) idle += 1;
    if (idle <= MAX_IDLE_BUCKETS) return;
    for (const [k, b] of this.buckets) {
      if (idle <= MAX_IDLE_BUCKETS) break;
      if (b.frames.length === 0) {
        this.buckets.delete(k);
        idle -= 1;
      }
    }
  }

  resume(file, lane, since) {
    this.expire();
    const b = this._bucket(file, lane);
    if (!(since > 0) || since > this.lastSeq) {
      return { baseline: this.lastSeq, replay: [], resync: false };
    }
    const replay = b.frames.filter((f) => f.seq > since).map((f) => f.message);
    const resync = since < b.createdSeq || since < b.droppedThrough;
    return { baseline: since, replay, resync };
  }

  reset(file) {
    this.lastSeq += 1;
    for (const lane of LANES) {
      const k = this._key(file, lane);
      const b = this.buckets.get(k);
      if (b) {
        while (b.frames.length) this._dropOldest(b);
        this.buckets.delete(k);
      }
      this.buckets.set(k, { frames: [], bytes: 0, droppedThrough: 0, createdSeq: this.lastSeq });
    }
  }
}

const replayStore = new ReplayStore();
configureLiveSync({ frameIds: true });
onLiveFrame((frame) => replayStore.record(frame));
setInterval(() => replayStore.expire(), 30 * 1000).unref();

module.exports = { ReplayStore, replayStore };
