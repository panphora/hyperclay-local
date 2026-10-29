// The D13 conformance fixture's host adapter for Hyperclay Local: one page room
// built by the real local-authority over createRooms, read and applied through
// the same room calls and status table local-live-data's handlers use, with each
// commit broadcast through the authority's own frame path. The frame sink is the
// only double: an editor registered on the authority collects what a tab would
// have received.
//
// The fixture is synchronous, so admission answers from `rooms.apply` directly
// rather than through the async Express handlers; the handler's own mapping of a
// refusal code to a status is the table this adapter answers with.

const { createRooms } = require('@panphora/clayjs/server/rooms');
const { createLocalAuthority } = require('../../src/main/local-authority');
const { coreErrorStatus } = require('../../src/main/local-live-data');

const ORIGIN = 'http://127.0.0.1:7000';

function createLocalPageRoomAdapter({ compaction, buildCandidate, newEpoch = null } = {}) {
  if (!compaction) throw new Error('createLocalPageRoomAdapter needs compaction limits');
  if (typeof buildCandidate !== 'function') throw new Error('createLocalPageRoomAdapter needs buildCandidate');
  const limits = Object.freeze({ ...compaction });
  let offset = 0;
  let epochs = 0;
  let ids = 0;
  const at = () => 1000 + offset;
  const epochOf = typeof newEpoch === 'function' ? newEpoch : () => `e${++epochs}`;
  const status = coreErrorStatus();

  let listener = () => {};
  const registry = () => {
    const rooms = createRooms({ now: at, newEpoch: epochOf, compaction: limits });
    rooms.onCompactionDue((wanted, { overflow }) => listener({ key: wanted.key, overflow }));
    const authority = createLocalAuthority({
      rooms,
      withDocument: async (resolve, fn) => fn(await resolve()),
      now: at,
      newId: () => `id${++ids}`,
      pageCompaction: false,
    });
    return { rooms, authority };
  };

  let host = registry();
  let room = null;
  let target = null;
  let sent = 0;

  const opened = (next) => {
    if (!next) return { status: 409, body: { error: 'rooms-full' } };
    room = next;
    target = host.authority.bindTarget({ rootId: 'conformance', logicalPath: next.key, canonicalPath: next.key, origin: ORIGIN, live: true });
    host.authority.registerEditor(target, { clientId: 'table', send: () => { sent += 1; } });
    return { status: 200, body: { key: next.key, epoch: next.epoch, seq: next.seq } };
  };

  const start = (name, html, nodeId) => opened(host.rooms.open(name, html, { nodeId }));

  return {
    limits,
    get broadcasts() { return sent; },
    advanceClock(ms = 0) { offset += ms; },
    onCompactionDue(fn) { listener = typeof fn === 'function' ? fn : () => {}; },
    open({ key: name, html, nodeId = null } = {}) { return start(name, html, nodeId); },
    restart({ key: name, html, nodeId = null } = {}) {
      host = registry();
      room = null;
      return start(name, html, nodeId);
    },
    reset({ key: name, html, nodeId = null } = {}) {
      return opened(host.rooms.reset(name, html, { nodeId }));
    },
    readState({ key: name, tabId = null, capable = true } = {}) {
      if (!room || room.key !== name) return { status: 404, body: null };
      return { status: 200, body: host.rooms.state(room, tabId, undefined, { compaction: capable ? limits.version : 0 }) };
    },
    apply({ key: name, tabId = null, frame } = {}) {
      if (!room || room.key !== name) return { status: 404, body: { error: 'unknown-store' } };
      const answer = host.rooms.apply(room, tabId, frame, { connected: [] });
      if (answer.busy) return { status: 409, body: { error: 'busy', ...(answer.reason && { reason: answer.reason }) } };
      if (answer.error) {
        return {
          status: status[answer.error] ?? 409,
          body: { error: answer.error, ...(answer.retryAfter !== undefined && { retryAfter: answer.retryAfter }), ...(answer.message && { message: answer.message }) },
        };
      }
      if (answer.stale) return { status: 409, body: { stale: true, epoch: answer.epoch ?? null } };
      return { status: 200, body: answer };
    },
    fileWritten({ key: name, html } = {}) {
      const out = host.rooms.fileWritten(name, html);
      if (!out) return { status: 404, body: null };
      return { status: 200, body: { valueChanged: Boolean(out.valueChanged), landed: out.landed ?? [] } };
    },
    usage({ key: name } = {}) {
      if (!room || room.key !== name) return { status: 404, body: null };
      const stores = {};
      for (const [store, s] of room.stores) stores[store] = { bytes: s.bytes, logBytes: s.logBytes };
      return {
        status: 200,
        body: {
          reported: host.rooms.used(),
          receiptBytes: room.receiptBytes ?? 0,
          transitionBytes: room.pageTransition?.bytes ?? 0,
          reservedBytes: room.compaction?.job?.reserved ?? 0,
          stores,
        },
      };
    },
    beginCompaction({ key: name, overflow = false } = {}) {
      if (!room || room.key !== name) return { status: 404, body: null };
      const job = host.rooms.beginCompaction(room, { overflow });
      if (!job) return { status: 409, body: null };
      return { status: 200, body: job };
    },
    buildCandidate({ job } = {}) {
      const result = buildCandidate({ kind: job.kind, sources: job.sources });
      return { status: result.failure ? 409 : 200, body: result };
    },
    commitCompaction({ token, candidate } = {}) {
      const answer = host.rooms.commitCompaction(token, candidate);
      if (answer.seq !== undefined) host.authority.broadcastCompaction(room, answer);
      return { status: answer.refused ? 409 : 200, body: answer };
    },
    abandonCompaction({ token } = {}) {
      const abandoned = host.rooms.abandonCompaction(token);
      return { status: abandoned ? 200 : 409, body: { abandoned: Boolean(abandoned) } };
    },
  };
}

module.exports = { createLocalPageRoomAdapter };
