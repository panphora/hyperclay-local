import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';

const RETRY_MS = [1000, 5000, 30000];

const MODULE_URL = typeof __dirname === 'string' ? pathToFileURL(`${__dirname}/`).href : import.meta.url;
const WORKER_FILE = typeof __PAGE_COMPACTION_WORKER__ === 'string' ? __PAGE_COMPACTION_WORKER__ : './page-compaction-worker.js';

export const pageCompactionWorkerUrl = () => new URL(WORKER_FILE, MODULE_URL);

export function createPageCompactor({ rooms, onCommit = () => {}, workerUrl = pageCompactionWorkerUrl(),
  timeoutMs = 30000, WorkerClass = Worker, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const queue = new Map();
  const retries = new Map();
  let worker = null;
  let running = null;
  let ids = 0;
  let closed = false;

  const spawn = () => {
    worker = new WorkerClass(workerUrl);
    worker.unref?.();
    worker.on('message', (message) => finish(message));
    worker.on('error', () => crashed());
    worker.on('exit', () => { if (running) crashed(); worker = null; });
  };

  function crashed() {
    const job = running;
    if (!job) return;
    running = null;
    clearTimer(job.timer);
    worker?.terminate?.();
    worker = null;
    rooms.abandonCompaction(job.token);
    const tries = (retries.get(job.room) ?? 0) + 1;
    retries.set(job.room, tries);
    if (tries > RETRY_MS.length) rooms.abandonCompaction(rooms.beginCompaction(job.room)?.token, { failed: 'crashed' });
    else setTimer(() => due(job.room, {}), RETRY_MS[tries - 1]);
    pump();
  }

  function finish({ id, ...result }) {
    const job = running;
    if (!job || job.id !== id) return;
    running = null;
    clearTimer(job.timer);
    if (result.failure) {
      rooms.abandonCompaction(job.token, { failed: result.failure });
    } else {
      const answer = rooms.commitCompaction(job.token, result);
      if (answer.seq !== undefined) {
        retries.delete(job.room);
        try { onCommit(job.room, answer); } catch {}
      }
    }
    pump();
  }

  function pump() {
    if (closed || running || !queue.size) return;
    const [room, { overflow }] = queue.entries().next().value;
    queue.delete(room);
    const begun = rooms.beginCompaction(room, { overflow });
    if (!begun) { pump(); return; }
    if (!worker) spawn();
    const id = ++ids;
    running = { id, room, token: begun.token, timer: setTimer(crashed, timeoutMs) };
    worker.postMessage({ id, kind: begun.kind, sources: begun.sources });
  }

  function due(room, { overflow = false } = {}) {
    const queued = queue.get(room);
    queue.set(room, { overflow: overflow || Boolean(queued?.overflow) });
    queueMicrotask(pump);
  }

  rooms.onCompactionDue(due);
  return {
    get running() { return running !== null; },
    close() { closed = true; rooms.onCompactionDue(null); if (running) clearTimer(running.timer); return worker?.terminate?.(); },
  };
}
