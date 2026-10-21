const crypto = require('crypto');
const path = require('upath');
const { Worker } = require('worker_threads');

class SearchIndex {
  constructor(root, appDataPath, { WorkerClass = Worker, debounceMs = 500 } = {}) {
    this.root = root;
    this.pending = new Map();
    this.updates = new Map();
    this.nextId = 1;
    this.closed = false;
    const key = crypto.createHash('sha256').update(`${root.id}\0${root.path}`).digest('hex');
    const cachePath = path.join(appDataPath, 'search-index', `${key}.json`);
    this.worker = new WorkerClass(path.join(__dirname, 'search-worker.js'), {
      workerData: { rootPath: root.path, cachePath },
    });
    this.ready = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    this.worker.on('message', message => {
      if (message.type === 'ready') { this.stats = message.stats; this.readyResolve(message.stats); }
      else if (message.type === 'result') {
        const call = this.pending.get(message.id);
        if (call) { this.pending.delete(message.id); call.resolve(message.hits); }
      } else if (message.type === 'error') {
        const call = this.pending.get(message.id);
        if (call) { this.pending.delete(message.id); call.reject(new Error(message.message)); }
        else this.readyReject(new Error(message.message));
      }
    });
    this.worker.on('error', error => this.fail(error));
    this.worker.on('exit', code => { if (!this.closed) this.fail(new Error(`Search worker exited (${code})`)); });
    this.debounceMs = debounceMs;
  }

  fail(error) {
    this.closed = true;
    for (const timer of this.updates.values()) clearTimeout(timer);
    this.updates.clear();
    this.readyReject(error);
    for (const call of this.pending.values()) call.reject(error);
    this.pending.clear();
  }

  update(rel) {
    if (this.closed) return;
    const timer = this.updates.get(rel);
    if (timer) clearTimeout(timer);
    const next = setTimeout(() => {
      this.updates.delete(rel);
      this.worker.postMessage({ type: 'update', path: rel });
    }, this.debounceMs);
    next.unref?.();
    this.updates.set(rel, next);
  }

  flushUpdates() {
    for (const [rel, timer] of this.updates) {
      clearTimeout(timer);
      this.worker.postMessage({ type: 'update', path: rel });
    }
    this.updates.clear();
  }

  async query(value) {
    await this.ready;
    if (this.closed) throw new Error('Search index is closed');
    this.flushUpdates();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'query', id, query: value });
    });
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const timer of this.updates.values()) clearTimeout(timer);
    this.updates.clear();
    this.fail(new Error('Search index is closed'));
    await this.worker.terminate();
  }
}

module.exports = { SearchIndex };
