import { parentPort } from 'node:worker_threads';
import { buildCandidate } from '../../live/page-compaction.js';

parentPort.on('message', ({ id, kind, sources }) => {
  let result;
  try {
    result = buildCandidate({ kind, sources });
  } catch (error) {
    result = { failure: 'crashed', message: error?.message || String(error) };
  }
  parentPort.postMessage({ id, ...result });
});
