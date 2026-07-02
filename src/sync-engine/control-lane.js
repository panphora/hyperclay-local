/**
 * control-lane — a reusable, best-effort, typed SSE sidecar for Hyperclay Local.
 *
 * BOUNDARY (do not violate): ONLY loss-tolerant, self-correcting signals ride here.
 * No acks, no retries, no ordering, no delivery guarantee. Hashes/metadata only.
 * A signal that needs guaranteed delivery belongs at an authoritative request path.
 * See plans/hyperclay-local/sse-control-lane-plan.md §0.
 */
const { parseEnvelope } = require('./control-lane-core.cjs');

const handlers = new Map();

function registerControlHandler(type, handler) { handlers.set(type, handler); }

async function dispatchControlEnvelope(raw, ctx) {
  const env = parseEnvelope(raw);
  if (!env) return { applied: false, reason: 'malformed' };
  const h = handlers.get(env.type);
  if (!h) return { applied: false, reason: 'unknown-type' };        // forward-compat drop
  try {
    const applied = await h(env.payload, { ...ctx, v: env.v });
    return { applied: applied === true };
  } catch (e) {
    console.error('[control-lane] handler error (non-fatal):', e && e.message);
    return { applied: false, reason: 'error' };                     // never propagates
  }
}

module.exports = { registerControlHandler, dispatchControlEnvelope };
