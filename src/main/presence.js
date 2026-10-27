const { randomUUID } = require('crypto');
const {
  EDITING_PATH,
  EXPIRE_MS,
  RATE_BURST,
  RATE_PER_SECOND,
  normalizeEditing,
  validateTarget,
} = require('./presence-target');

const EVENT = 'presence';

// Local has no accounts, so the roster says exactly what it knows: the person running
// this app, at this computer, with one session per tab that could ever hold a caret.
const LOCAL_NAME = 'This computer';

/**
 * Local authority presence: the sessions behind `clay.presence`, their numbered targets,
 * their TTL, their token bucket, and the recipient-filtered roster each stream is told.
 *
 * Everything here is ephemeral and lives in this closure. Nothing is written to a room
 * value, a live-data state, a checkpoint or a sidecar: a caret that outlived the process
 * would be a claim about a person that nothing here can back. Targets are held beside the
 * admitted connection that published them, exactly like the room's membership proof.
 *
 * Local's privilege model is the lane. A live stream is an edit-mode tab and may carry a
 * target; a saved-lane stream is a reader, receives the roster, and is told no page
 * coordinate. Sessions exist only where a target can come from: a live connection that
 * names its tab (`client-id`). A connection that cannot hold one is still a participant.
 */
function createPresenceRelay({ now = Date.now, newId = randomUUID } = {}) {
  // One document's participants and the identity the roster names them by. Dropped when
  // the last connection leaves, so the id is document-scoped and transient by construction.
  const documents = new Map();
  let documentSeq = 0;
  let sessionSeq = 0;
  let markerSeq = 0;

  const stateFor = (canonicalPath) => {
    let state = documents.get(canonicalPath);
    if (!state) {
      state = { id: `local-${++documentSeq}`, connections: new Set() };
      documents.set(canonicalPath, state);
    }
    return state;
  };

  const liveConnections = (state) => [...state.connections].filter((connection) => !connection.closed);

  /**
   * The session an admitted stream is given: a public id every recipient may see, and a
   * private token only that stream is ever told.
   *
   * Minted on connect rather than on demand, so the first roster frame a tab receives is
   * the frame that tells it its own token. The gate is what keeps a reader's frame free of
   * session fields it has no use for: a target is an edit, and only a live tab naming
   * itself can publish one.
   */
  function sessionOf(connection) {
    if (!connection || connection.closed) return null;
    if (connection.session) return connection.session;
    if (connection.lane !== 'live' || connection.clientId === null) return null;
    const token = newId();
    connection.session = {
      id: `${stateFor(connection.canonicalPath).id}-s${++sessionSeq}`,
      token,
      // The last number this session accepted, so a frame that overtook a newer one
      // cannot move a caret back, including back to one a later clear took away.
      n: 0,
      target: null,
      receivedAt: 0,
      // The burst, full, and refilled from server time on every request.
      tokens: RATE_BURST,
      refilledAt: now(),
      timer: null,
    };
    return connection.session;
  }

  /** The target a session still stands by, or nothing once the host's clock has passed its TTL. */
  function liveTarget(session) {
    if (!session || session.target === null) return null;
    if (now() - session.receivedAt < EXPIRE_MS) return session.target;
    session.target = null;
    return null;
  }

  /**
   * A target a named recipient may be told about whatever its lane: the dotted path and a
   * record target follow the rule they already had, because those also reach readers. Page
   * coordinates are the ones held back, and they are the coordinates of a caret in an
   * editable page.
   */
  const shareableTarget = (target) => target === null || typeof target === 'string' || target.kind === 'record';

  function markerOf(state) {
    let latest = null;
    for (const connection of liveConnections(state)) {
      if (!connection.marker || connection.marker.seq <= (latest?.seq ?? 0)) continue;
      latest = connection.marker;
    }
    return normalizeEditing(latest?.target);
  }

  /** What one connection is told about the document it is on, from its own admission. */
  function rosterFor(canonicalPath, recipient) {
    const state = documents.get(canonicalPath);
    if (!state || !recipient || recipient.closed) return null;
    const connections = liveConnections(state);
    const seesPages = recipient.lane === 'live';
    const sessions = [];
    for (const connection of connections) {
      const session = sessionOf(connection);
      if (!session) continue;
      const target = liveTarget(session);
      if (!seesPages && !shareableTarget(target)) continue;
      sessions.push({ id: session.id, you: connection === recipient, n: session.n, editing: target });
    }
    const editing = markerOf(state);
    const person = {
      id: state.id,
      name: LOCAL_NAME,
      you: true,
      canEdit: connections.some((connection) => connection.lane === 'live'),
      ...(editing ? { editing } : {}),
      ...(sessions.length ? { sessions } : {}),
    };
    const roster = { people: [person], anonymous: 0 };
    const self = recipient.session;
    if (self) roster.selfSession = { id: self.id, token: self.token };
    return roster;
  }

  function publishRoster(canonicalPath) {
    const state = documents.get(canonicalPath);
    if (!state) return 0;
    let sent = 0;
    for (const connection of liveConnections(state)) {
      if (typeof connection.send !== 'function') continue;
      try {
        connection.send(EVENT, rosterFor(canonicalPath, connection));
        sent += 1;
      } catch {
        connection.close();
      }
    }
    return sent;
  }

  /**
   * Take a token from this session's bucket, refilling it first from server time.
   *
   * At most `RATE_PER_SECOND` updates a second with a burst of `RATE_BURST`; the bucket
   * belongs to one admitted session on one document, so one tab cannot spend another's
   * allowance or starve it.
   */
  function takeToken(session, at) {
    const elapsed = Math.max(0, at - session.refilledAt);
    session.tokens = Math.min(RATE_BURST, session.tokens + (elapsed * RATE_PER_SECOND) / 1000);
    session.refilledAt = at;
    if (session.tokens < 1) return false;
    session.tokens -= 1;
    return true;
  }

  /**
   * Clear this session's target once its TTL has run out, and rebuild the roster so the
   * caret actually leaves every peer's screen.
   *
   * A target expires 15 s after the host received it and a renewal resets that clock, so
   * the timer is armed per accepted target and re-checks the receipt time when it fires.
   * It is `unref`ed because a process holding a listener for a caret is a process that will
   * not exit, and it stops without publishing once its connection is gone.
   */
  function armExpiry(canonicalPath, connection) {
    const session = connection.session;
    if (!session || session.timer) return;
    const remaining = Math.max(0, session.receivedAt + EXPIRE_MS - now());
    const timer = setTimeout(() => {
      session.timer = null;
      if (session.target === null) return;
      if (connection.closed) {
        session.target = null;
        return;
      }
      if (now() - session.receivedAt < EXPIRE_MS) {
        armExpiry(canonicalPath, connection);
        return;
      }
      session.target = null;
      publishRoster(canonicalPath);
    }, remaining);
    timer.unref?.();
    session.timer = timer;
  }

  // The number is recorded BEFORE the roster is rebuilt, because it is part of what the
  // roster says: a peer shown the caret with the number it replaced would be reading a
  // frame that never existed.
  function acceptTarget(canonicalPath, connection, session, { editing, n = null, at }) {
    const checked = validateTarget(editing);
    if (!checked.ok) return { status: 'invalid', reason: checked.reason };
    session.n = n === null ? session.n + 1 : n;
    session.target = checked.target;
    session.receivedAt = checked.target === null ? 0 : at;
    connection.marker = { target: checked.target, seq: ++markerSeq };
    if (checked.target !== null) armExpiry(canonicalPath, connection);
    publishRoster(canonicalPath);
    return { status: 'ok', target: checked.target };
  }

  /**
   * Accept one extended request: `{v:1, session, n, editing}` from the tab it belongs to.
   *
   * The token names the stream, so the tab id is only ever compared, never trusted: the
   * ownership check below still has to find a live connection naming that tab and holding
   * that token. Returns why the target was or was not taken, so the route can answer with a
   * status instead of a guess. Nothing here reads an identity or a name out of the body.
   */
  function setTarget(canonicalPath, { clientId, session: token, n, editing } = {}) {
    const state = documents.get(canonicalPath);
    let matched = 0;
    let mine = null;
    if (state) {
      for (const connection of liveConnections(state)) {
        if (connection.lane !== 'live' || connection.clientId === null || connection.clientId !== clientId) continue;
        matched += 1;
        if (connection.session && typeof token === 'string' && connection.session.token === token) mine = connection;
      }
    }
    if (matched === 0) return { status: 'not-connected' };
    if (!mine) return { status: 'forbidden' };

    const session = mine.session;
    const at = now();
    // A number at or below the last one accepted is a frame that arrived out of order. It
    // changes nothing and is not an error, and letting it through would be exactly how a
    // stale caret returns after a newer clear.
    if (!Number.isSafeInteger(n) || n <= session.n) return { status: 'stale' };
    if (!takeToken(session, at)) return { status: 'rate-limited' };

    return acceptTarget(canonicalPath, mine, session, { editing, n, at });
  }

  /**
   * Accept one request in the single-field shape every older client already sends:
   * `{editing}` with a `client-id`. It carries the same ownership rule but no ordering of
   * its own, so it can offer a dotted path or a record and never a page target, whose
   * coordinates need the numbered envelope.
   */
  function report(canonicalPath, { clientId, editing } = {}) {
    const state = documents.get(canonicalPath);
    let matched = 0;
    let latest = null;
    if (state) {
      for (const connection of liveConnections(state)) {
        if (connection.lane !== 'live' || connection.clientId === null || connection.clientId !== clientId) continue;
        matched += 1;
        if (connection.session) latest = connection;
      }
    }
    if (matched === 0 || !latest) return { status: 'not-connected' };

    if (editing !== null && typeof editing !== 'string') {
      const checked = validateTarget(editing);
      if (!checked.ok || checked.target === null || checked.target.kind !== 'record') {
        return { status: 'invalid', reason: checked.ok ? 'page' : checked.reason };
      }
    } else if (editing !== null && !EDITING_PATH.test(editing)) {
      return { status: 'invalid', reason: 'path' };
    }

    return acceptTarget(canonicalPath, latest, latest.session, { editing, at: now() });
  }

  /**
   * One admitted stream joins its document. The connection is the unit of a session, so a
   * reconnect is a new session and an old in-flight request cannot mutate it.
   */
  function connect({ canonicalPath, lane = 'live', clientId = null, send = null } = {}) {
    if (typeof canonicalPath !== 'string' || canonicalPath === '') {
      throw new TypeError('presence.connect requires a canonical path');
    }
    const state = stateFor(canonicalPath);
    const connection = {
      canonicalPath,
      lane: lane === 'saved' ? 'saved' : 'live',
      clientId: typeof clientId === 'string' && clientId !== '' ? clientId : null,
      send,
      session: null,
      marker: null,
      closed: false,
      close() {
        if (connection.closed) return;
        connection.closed = true;
        const current = documents.get(canonicalPath);
        if (!current) return;
        current.connections.delete(connection);
        const session = connection.session;
        if (session) {
          session.target = null;
          if (session.timer) clearTimeout(session.timer);
          session.timer = null;
        }
        publishRoster(canonicalPath);
        if (current.connections.size === 0) documents.delete(canonicalPath);
      },
    };
    state.connections.add(connection);
    sessionOf(connection);
    publishRoster(canonicalPath);
    return connection;
  }

  return {
    connect,
    publishRoster,
    rosterFor,
    setTarget,
    report,
    /** The canonical paths that currently hold a connection. Read-only, for diagnostics. */
    documents() { return [...documents.keys()]; },
  };
}

module.exports = { createPresenceRelay };
