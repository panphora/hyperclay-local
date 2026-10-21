// clay.live's Local fast lane: POST and GET /_/sync/data as Express handlers.
//
// The two handlers own admission's HTTP shape only. Which file a request names --
// exact loopback Host, Document-URL origin, normalized logical path, canonical
// contained path, consent and existence -- belongs to the injected
// `resolveTarget(req, {fresh})`, which binds its result through
// `authority.bindTarget`. Nothing here re-derives a path.
//
// The cache of room state, the per-file token bucket and every membership check
// live in local-authority.js, which also owns the disk boundary. These handlers
// never read a file: a cold room is opened inside `authority.roomFor`'s
// withDocument boundary, and a warm room reaches `rooms.apply` without one.

const CLIENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SINCE = /^([A-Za-z0-9-]{1,64}):(0|[1-9]\d{0,11})$/;

// The hosted map. `checkpointing` and `page-capacity` are not in the hosted
// ERROR_STATUS table yet but the binding handoff names both: 503 with Retry-After 1.
const CORE_ERROR_STATUS = {
  'bad-frame': 400,
  'unknown-store': 404,
  'too-large': 413,
  'bad-op': 422,
  'receipt-expired': 409,
  'page-generation': 409,
  'page-format': 409,
  'page-conversion-required': 409,
  'page-converting': 503,
  checkpointing: 503,
  'page-capacity': 503,
};
const RETRY_AFTER_ONE = new Set(['page-converting', 'checkpointing', 'page-capacity', 'not-connected', 'rate-limited']);
const STATUS_CODE = { 400: 'invalid-request', 401: 'forbidden', 403: 'forbidden', 404: 'not-found', 413: 'too-large' };
const MESSAGE = {
  'bad-frame': 'Live update refused: bad-frame.',
  'unknown-store': 'No store by that name on this document.',
  'too-large': 'Live update refused: too-large.',
  'bad-op': 'Live update refused: bad-op.',
  'receipt-expired': 'Live update refused: receipt-expired.',
  'page-generation': 'Live update refused: page-generation.',
  'page-format': 'Live update refused: page-format.',
  'page-conversion-required': 'Live update refused: page-conversion-required.',
  'page-converting': 'This document is being converted.',
  checkpointing: 'This document is being saved. Try again shortly.',
  'page-capacity': 'Too many page conversions are open right now.',
  'not-connected': "This tab is not on the document's live stream.",
  'rate-limited': 'Too many live updates. Slow down.',
  busy: 'Too many live documents are open right now.',
  'invalid-request': 'Bad request.',
  forbidden: 'Cross-site request blocked',
  'not-found': 'No file here.',
  'internal-error': 'Live data failed.',
};
const KNOWN_CODES = new Set([...Object.keys(CORE_ERROR_STATUS), ...Object.values(STATUS_CODE), 'not-connected', 'rate-limited', 'busy']);

const NOT_FOUND = { status: 404, code: 'not-found', msg: MESSAGE['not-found'] };
const FORBIDDEN = { status: 403, code: 'forbidden', msg: MESSAGE.forbidden };
const UNEXPECTED = { status: 500, code: 'internal-error', msg: MESSAGE['internal-error'] };

// A failure from the injected resolver or the authority's cold load, as a
// response. A resolver refusal carries a numeric status; a missing file carries
// fs's ENOENT or the authority's typed `not-found`/`moved`. Anything else is
// unexpected and stays a generic 500 that names no path and shows no stack.
function admissionFailure(err) {
  const status = Number(err && err.status);
  if (err && err.code === 'ENOENT') return NOT_FOUND;
  if (err && (err.code === 'not-found' || err.code === 'moved')) return NOT_FOUND;
  if (Number.isFinite(status) && status >= 400 && status < 500) {
    const code = typeof err.code === 'string' && KNOWN_CODES.has(err.code) ? err.code : (STATUS_CODE[status] || 'invalid-request');
    return { status, code, msg: MESSAGE[code] || MESSAGE['invalid-request'] };
  }
  return null;
}

function createLocalLiveData({ authority, resolveTarget } = {}) {
  if (!authority) throw new Error('createLocalLiveData requires authority');
  if (typeof resolveTarget !== 'function') throw new Error('createLocalLiveData requires resolveTarget');
  const { rooms } = authority;

  const fail = (res, status, code, msg, retryAfter) => {
    if (res.headersSent) return;
    if (retryAfter !== undefined) res.setHeader('Retry-After', String(retryAfter));
    res.status(status).json({ msg, msgType: 'error', code });
  };

  const failWith = (res, failure) => fail(res, failure.status, failure.code, failure.msg);

  // Admission errors are the resolver's, but the response is the wire contract:
  // JSON `{msg,msgType:'error',code}` even when Accept asks for HTML.
  const refused = (res, err) => failWith(res, admissionFailure(err) || UNEXPECTED);

  const rootOrigin = (req) => `${req.protocol}://${req.get('host')}`;

  // Same-origin admission: Fetch Metadata absent or same-origin/none, and an
  // explicit Origin must be this server's own. POST additionally requires the
  // Origin header itself, so a cross-site form post is refused.
  const sameOriginFetch = (req) => {
    const site = req.get('sec-fetch-site');
    if (site && site !== 'same-origin' && site !== 'none') return false;
    const origin = req.get('origin');
    if (!origin) return true;
    return origin === rootOrigin(req);
  };

  const openRoom = (req, target) => authority.roomFor(target, () => resolveTarget(req, { fresh: true }));

  async function post(req, res) {
    try {
      let target;
      try {
        target = await resolveTarget(req);
      } catch (err) {
        return refused(res, err);
      }
      if (!target) return failWith(res, NOT_FOUND);
      if (!req.get('origin') || !sameOriginFetch(req)) return failWith(res, FORBIDDEN);

      const clientId = req.query && req.query['client-id'];
      if (typeof clientId !== 'string' || !CLIENT_ID.test(clientId)) {
        return fail(res, 400, 'invalid-request', MESSAGE['invalid-request']);
      }
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.conn !== 'string') {
        return fail(res, 400, 'invalid-request', MESSAGE['invalid-request']);
      }

      // The warm path resolves a registered target without touching the disk, so
      // an unproven frame is refused before any read.
      if (!authority.currentEditor(target, clientId, body.conn)) {
        return fail(res, 503, 'not-connected', MESSAGE['not-connected'], 1);
      }
      if (!authority.rateLimit(target.canonicalPath + '\n' + req.ip)) {
        return fail(res, 429, 'rate-limited', MESSAGE['rate-limited'], 1);
      }

      let room;
      try {
        room = await openRoom(req, target);
      } catch (err) {
        return refused(res, err);
      }
      if (!room) return fail(res, 503, 'busy', MESSAGE.busy, 60);

      // A member reference is not lasting authority: the cold read may have
      // outlived its connection. Recheck the exact proof and collect the
      // connected ids immediately before the single synchronous apply.
      const member = authority.currentEditor(target, clientId, body.conn);
      if (!member) return fail(res, 503, 'not-connected', MESSAGE['not-connected'], 1);
      const connected = authority.connectedIds(target.canonicalPath);
      authority.markParticipating(member);

      const writerBefore = room.writer;
      const result = rooms.apply(room, clientId, body, { connected });

      if (result.busy) {
        const message = result.reason === 'budget'
          ? 'Too many live documents are open right now.'
          : 'Too many tabs have sent live updates to this document. Try again shortly.';
        return fail(res, 503, 'busy', message, 60);
      }
      if (result.error) {
        const status = CORE_ERROR_STATUS[result.error] || 503;
        const retryAfter = RETRY_AFTER_ONE.has(result.error) ? 1 : undefined;
        return fail(res, status, result.error, result.message || MESSAGE[result.error] || `Live update refused: ${result.error}.`, retryAfter);
      }
      if (result.duplicate) return res.json({ duplicate: true, seq: result.seq, epoch: result.epoch });
      if (result.stale) return res.json({ stale: true, epoch: result.epoch });

      const frame = {
        epoch: result.epoch,
        seq: result.seq,
        name: result.name,
        ops: result.ops,
        from: clientId,
        n: body.n,
      };
      if (result.checkpoint) frame.checkpoint = true;
      if (result.pageGeneration !== undefined) frame.pageGeneration = result.pageGeneration;
      if (result.receiptGeneration !== undefined) frame.receiptGeneration = result.receiptGeneration;
      authority.publish(target.canonicalPath, 'data', frame);
      if (result.writer !== writerBefore) {
        authority.publish(target.canonicalPath, 'data-writer', { epoch: result.epoch, writer: result.writer });
      }

      const accepted = { seq: result.seq, epoch: result.epoch };
      if (result.receiptGeneration !== undefined) accepted.receiptGeneration = result.receiptGeneration;
      return res.json(accepted);
    } catch {
      return failWith(res, UNEXPECTED);
    }
  }

  async function state(req, res) {
    try {
      let target;
      try {
        target = await resolveTarget(req);
      } catch (err) {
        return refused(res, err);
      }
      if (!target) return failWith(res, NOT_FOUND);
      if (!sameOriginFetch(req)) return failWith(res, FORBIDDEN);

      const supplied = req.query && req.query['client-id'];
      if (supplied !== undefined && (typeof supplied !== 'string' || !CLIENT_ID.test(supplied))) {
        return fail(res, 400, 'invalid-request', MESSAGE['invalid-request']);
      }

      let room;
      try {
        room = await openRoom(req, target);
      } catch (err) {
        return refused(res, err);
      }
      if (!room) return fail(res, 503, 'busy', MESSAGE.busy, 60);

      // The newest still-current connection for this exact proof, chosen after
      // any cold read. Without one there is no personal receipt and no conn: a
      // supplied client id that is not on the stream reads the shared state only.
      let mine = null;
      let conn = null;
      if (typeof supplied === 'string') {
        const member = authority.newestEditor(target, supplied);
        if (member) {
          rooms.touch(room, supplied);
          authority.markParticipating(member);
          mine = supplied;
          conn = member.conn;
        }
      }

      const source = req.query && req.query.since;
      const match = SINCE.exec(typeof source === 'string' ? source : '');
      const since = match ? { epoch: match[1], seq: Number(match[2]) } : null;

      res.setHeader('Cache-Control', 'no-store');
      return res.json({ ...rooms.state(room, mine, since), conn });
    } catch {
      return failWith(res, UNEXPECTED);
    }
  }

  return { post, state };
}

module.exports = { createLocalLiveData };
