// Runs the clayjs D13 conformance fixture over the Local host adapter in a Node
// process of its own: the fixture and clayjs's source are ES modules, while Local
// and its handlers are CommonJS, so the adapter is required from here.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runPageRoomConformance } from '@panphora/clayjs/src/server/rooms/page-room-conformance.js';
import { buildCandidate } from '@panphora/clayjs/src/live/page-compaction.js';

import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { createLocalPageRoomAdapter } = require('./local-page-room-conformance.cjs');

// The room's byte and tail bounds are small so a 300-step run reaches a full
// commit; everything else is the shipped COMPACTION shape.
export const LIMITS = Object.freeze({
  version: 1,
  loose: 32,
  soft: 16,
  activeBytes: 160 * 1024,
  tailFloor: 8 * 1024,
  leaseMs: 5000,
  deleteReserve: 64 * 1024,
  newPerFrame: 4,
  retired: 8192,
});

const template = readFileSync(new URL('../fixtures/ypage-template.html', import.meta.url), 'utf8');

export function run({ seed = 1, steps = 300, tabs = 3 } = {}) {
  const adapter = createLocalPageRoomAdapter({ compaction: LIMITS, buildCandidate });
  const out = runPageRoomConformance({ adapter, template, seed, steps, tabs });
  return { ...out, broadcasts: adapter.broadcasts };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [from = 1, to = 3, steps = 300, tabs = 3] = process.argv.slice(2).map(Number);
  const runs = [];
  for (let seed = from; seed <= to; seed++) {
    const out = run({ seed, steps, tabs });
    runs.push({
      seed: out.seed,
      admitted: out.admitted,
      full: out.commits.full,
      tail: out.commits.tail,
      legacyMerged: out.legacyMerged,
      blocked: out.blocked,
      refusedRetry: out.refusedRetry,
      capacity: out.capacity,
      broadcasts: out.broadcasts,
    });
  }
  process.stdout.write('CONFORMANCE ' + JSON.stringify(runs) + '\n');
}
