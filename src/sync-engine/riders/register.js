/**
 * riders/register — registers Hyperclay Local's control-lane handlers.
 * Required once from src/sync-engine/index.js (after the prototype Object.assign)
 * for its side effect. See plans/hyperclay-local/sse-control-lane-plan.md §2b.
 */
const { registerControlHandler } = require('../control-lane');
const dataGuard = require('../../main/data-loss-guard');

registerControlHandler('data-loss/dismiss', (payload, ctx) => {
  if (ctx.v !== 1) return false;
  return dataGuard.applyRemoteResolution({
    baseDir: ctx.baseDir,
    name: payload.fileKey,
    recoverableDataHash: payload.recoverableDataHash,
  });
});
