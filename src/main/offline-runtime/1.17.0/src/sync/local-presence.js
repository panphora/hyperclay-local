/**
 * local-presence.js — `clay.presence` over the same-browser channel.
 *
 * A host without a presence endpoint advertises a broadcast transport, and this is
 * the transport the presence store leases for it. Tabs of one document in one
 * browser exchange sessions over the document's BroadcastChannel, so two readers
 * see each other with no room, no writer lock, no data state and no durable lane
 * loaded at all. The channel is the local lane's, shared and reference-counted by
 * `local-channel.js`; the frames are `presence-v1`, which the lane never reads and
 * an older client already ignores as a type it does not handle.
 *
 * A session is a fresh random identifier in this tab, not an account: the roster
 * says this browser, "This computer", with one session per tab, and only this
 * tab's session is `you`. Nothing here advances the durable room's sequence, takes
 * its lock or enters its mirror.
 */

import { EXPIRE_MS, RENEW_MS, validateTarget } from './presence-target.js';
import { PRESENCE_TYPE, localChannel } from '../live/local-channel.js';
import { presence } from './presence-store.js';

export const LOCAL_LABEL = 'This computer';

// A cap on the sessions one tab will hold, so a peer that keeps inventing ids
// cannot grow the roster without bound.
export const MAX_SESSIONS = 64;

const MAX_LABEL = 64;
const SESSION_ID = /^[\x20-\x7e]{1,128}$/;

function randomId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function readLabel(value) {
  if (typeof value !== 'string') return LOCAL_LABEL;
  const trimmed = value.trim().slice(0, MAX_LABEL);
  return trimmed || LOCAL_LABEL;
}

// A session frame carries the editing value the store already validated; anything
// else a peer sends is read as no target rather than repaired into one.
function readEditing(value) {
  const result = validateTarget(value === undefined ? null : value);
  return result.ok ? result.target : null;
}

/**
 * The person-level editing value: this tab when it is as new as any other
 * session, else the newest session that has something to show. Page targets are
 * the store's to drop (they live only in sessions), so this hands over whatever
 * the newest session publishes.
 */
function personEditing(own, others) {
  let best = null;
  let n = -1;
  for (const session of others) {
    if (session.editing === null || session.n <= n) continue;
    best = session.editing;
    n = session.n;
  }
  return own.editing !== null && own.n >= n ? own.editing : best;
}

/**
 * The broadcast presence transport for one tab. `start` joins the document's
 * channel and attaches to the store, which leases the transport; `stop` says
 * goodbye, leaves the channel and lets the store clear its roster.
 *
 * @param {object} [options]
 * @param {string} [options.scope] - the canonical document scope, shared with local
 *   collaboration. Documents that only share a filename have different scopes.
 * @param {string} [options.key] - the channel name, when it is not the scope's
 * @param {object} [options.store] - the presence store to feed and to send for
 * @param {object} [options.channel] - the document's channel, when the local lane
 *   in this tab already owns one
 * @param {string} [options.label] - the honest local name this browser shows
 */
export function localPresence({ scope = null, key = null, store = presence, channel: shared = null, label = LOCAL_LABEL } = {}) {
  const name = readLabel(label);
  const channelKey = key ?? 'clay-live:' + (scope ?? (typeof window !== 'undefined' ? window.location.pathname : '/'));
  const personId = 'local:' + (scope ?? channelKey);
  const sessionId = randomId();

  // session id -> { id, n, editing, seenAt }: what each peer tab last said.
  const peers = new Map();
  let target = null;
  let n = 0;
  let channel = null;
  let unsubscribe = null;
  let lease = null;
  let heartbeat = null;
  let running = false;

  function post(message) {
    if (!channel) return;
    channel.post({ type: PRESENCE_TYPE, from: sessionId, ...message });
  }

  // One person, one session per tab: this tab's own, then every peer's, in id
  // order so two tabs holding the same people publish the same roster.
  function publish() {
    const own = { id: sessionId, you: true, n, editing: target };
    const others = [];
    for (const peer of peers.values()) others.push({ id: peer.id, you: false, n: peer.n, editing: peer.editing });
    const sessions = [own, ...others].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    store.receive({
      people: [{ id: personId, name, you: true, canEdit: true, editing: personEditing(own, others), sessions }],
      anonymous: 0,
    });
  }

  function onMessage(message) {
    if (!message || message.from === sessionId || typeof message.from !== 'string') return;
    if (!SESSION_ID.test(message.from)) return;
    const known = peers.get(message.from);
    if (message.op === 'bye') {
      if (known) peers.delete(message.from);
      publish();
      return;
    }
    if (message.op !== 'hello' && message.op !== 'update' && message.op !== 'beat') return;
    if (!known && peers.size >= MAX_SESSIONS) return;
    // A beat only refreshes a session; it cannot change where the peer is.
    const editing = message.op === 'beat' ? (known ? known.editing : null) : readEditing(message.editing);
    const said = Number.isSafeInteger(message.n) && message.n >= 0 ? message.n : 0;
    if (known && said < known.n) return;
    peers.set(message.from, { id: message.from, n: said, editing, seenAt: Date.now() });
    // A tab that has just arrived is answered, so it learns the tabs already here.
    if (message.op === 'hello' && !known) post({ op: 'hello', n, editing: target, label: name });
    publish();
  }

  function tick() {
    if (!running) return;
    post({ op: 'beat', n });
    const at = Date.now();
    let dropped = false;
    for (const [id, peer] of peers) {
      if (at - peer.seenAt <= EXPIRE_MS) continue;
      peers.delete(id);
      dropped = true;
    }
    if (dropped) publish();
  }

  // The store's side of the lease: its target, as the body it built for a host.
  function send(body) {
    const editing = body && typeof body === 'object' && 'editing' in body ? body.editing : null;
    target = readEditing(editing);
    n += 1;
    post({ op: 'update', n, editing: target });
    publish();
    return true;
  }

  return {
    sessionId,
    /** Join the channel and take the store's targets and roster. Returns the lease. */
    start() {
      if (running) return lease;
      running = true;
      channel = shared ?? localChannel(channelKey);
      unsubscribe = channel.subscribe('presence', onMessage);
      lease = store.attachTransport({ send });
      post({ op: 'hello', n, editing: target, label: name });
      publish();
      heartbeat = setInterval(tick, RENEW_MS);
      return lease;
    },
    /** Say goodbye, leave the channel and give the store its roster back. */
    stop() {
      if (!running) return;
      running = false;
      if (heartbeat !== null) clearInterval(heartbeat);
      heartbeat = null;
      post({ op: 'bye' });
      peers.clear();
      unsubscribe?.();
      unsubscribe = null;
      channel = null;
      lease?.detach();
      lease = null;
    },
  };
}
