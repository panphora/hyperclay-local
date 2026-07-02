/**
 * control-lane-core — the wire-format contract for the SSE control lane.
 *
 * SHARED, VENDORED FILE. Canonical copy lives at
 *   hyperclay/server-lib/control-lane-core.cjs
 * and is copied verbatim to
 *   hyperclay-local/src/sync-engine/control-lane-core.cjs
 * by `node hyperclay/scripts/copy-data-loss-core.js`. Edit the canonical copy
 * only, then re-run the copy script.
 *
 * Pure CommonJS with ZERO dependencies on purpose: the platform (ESM) imports it
 * as a default import and Hyperclay Local (CJS) `require`s it directly, so the
 * wire format is defined exactly once and validated identically in both.
 *
 * The lane is deliberately dumb: best-effort, idempotent, loss-tolerant; no
 * acks, retries, ordering, or delivery guarantees. Only hashes/metadata cross
 * the wire, never bulk data. See
 * plans/hyperclay-local/sse-control-lane-plan.md §0-§1.
 */

'use strict';

// The single reserved SSE transport type. On the multiplexed per-user stream an
// envelope rides nested under { type: LANE_FRAME_TYPE, envelope }; on the
// dedicated POST the envelope IS the body. The outer type gates the lane, the
// inner envelope.type routes the rider.
const LANE_FRAME_TYPE = 'control';

// Build a well-formed envelope. `type` is "<feature>/<signal>" (the dispatch
// key); `v` is the per-type payload version (default 1); `payload` carries
// hashes/metadata only, never bulk data.
function buildEnvelope(type, v, payload) {
  return { type, v: v == null ? 1 : v, payload };
}

// Validate SHAPE only (not rider semantics): `raw` is an object, `raw.type` is a
// non-empty string, `raw.payload` is a non-null plain object, `raw.v` is a
// positive integer or absent (default 1). Anything else -> null -> dropped.
// Riders validate their own payloads.
function parseEnvelope(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { type, payload } = raw;
  if (typeof type !== 'string' || !type) return null;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  let v = raw.v;
  if (v === undefined) v = 1;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) return null;
  return { type, v, payload };
}

module.exports = { LANE_FRAME_TYPE, buildEnvelope, parseEnvelope };
