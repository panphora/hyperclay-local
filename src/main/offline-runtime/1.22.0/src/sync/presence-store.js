/**
 * presence-store.js — `clay.presence`: the roster and this tab's target.
 *
 * One store serves a Document's page targets and Kanban's record targets. It holds
 * what the host said, publishes an immutable snapshot, and turns `setTarget` calls
 * into the bounded requests the host accepts. The chrome that draws the roster
 * subscribes here rather than owning the state, so a reader that draws nothing and
 * an editor that draws carets agree about who is present.
 *
 * Everything here is synchronous except the transport's own promise. Detaching a
 * lease that a newer lease replaced cannot clear the newer owner's roster, and a
 * snapshot never contains the private session token, connection ids or socket data.
 */

import { hostMeta } from '../core/host-meta.js';
import {
  COALESCE_MS,
  RENEW_MS,
  PRESENCE_VERSION,
  normalizeEditing,
  normalizeSelfSession,
  normalizeSessions,
  requestBody,
  targetKey,
  validateTarget,
} from './presence-target.js';

const emptySnapshot = () => Object.freeze({
  supported: false,
  recordAwareness: false,
  pageAwareness: false,
  people: Object.freeze([]),
  anonymous: 0,
});

export class PresenceStore {
  constructor() {
    this.supported = false;
    this.recordAwareness = false;
    this.pageAwareness = false;
    this.people = [];
    this.anonymous = 0;
    this.snapshot = emptySnapshot();
    this.listeners = new Set();
    // The `n` each public session last reported, so a frame that overtook a newer
    // one for the same session cannot move a caret back.
    this.sessions = new Map();
    // The private connection session: {id, token}. Consumed by the sender, never
    // published.
    this.session = null;
    this.target = null;
    this.heldKey = '';
    this.owner = null;
    // Whether the target this tab holds belongs to an explicit owner (a page) or to
    // the generic editing path. One of them speaks at a time.
    this.explicit = false;
    this.connecting = null;
    this.n = 0;
    this.sentKey = null;
    this.timer = null;
    this.timerKind = null;
    this.inflight = false;
    // The lease the request in flight belongs to, and the target it carried. A
    // request a lease left behind is its own: giving the lease back resets these, so
    // the next one starts unblocked and a late answer changes nothing.
    this.inflightOwner = null;
    this.inflightKey = null;
  }

  /**
   * The current immutable snapshot. The same object until something changes, so a
   * subscriber can compare by identity.
   */
  getSnapshot() {
    return this.snapshot;
  }

  /**
   * Emits the current snapshot immediately, then every change. Includes the
   * unsupported state, so a consumer never has to wait for a frame to ask.
   *
   * @param {(snapshot: Object) => void} listener
   * @returns {() => void}
   */
  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('clay.presence.subscribe needs a listener function');
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** What the host advertised, asked of it once by the chrome. */
  setCapabilities({ supported = false, recordAwareness = false, pageAwareness = false } = {}) {
    const nextSupported = supported === true;
    const nextRecord = recordAwareness === true;
    const nextPage = pageAwareness === true;
    if (nextSupported === this.supported && nextRecord === this.recordAwareness && nextPage === this.pageAwareness) return this.snapshot;
    this.supported = nextSupported;
    this.recordAwareness = nextRecord;
    this.pageAwareness = nextPage;
    return this.emit();
  }

  /**
   * Take one roster frame. Held and published whether or not the host announced
   * presence: the chrome decides whether to draw, the snapshot says who is there.
   *
   * @param {Object} frame
   * @returns {Object} the snapshot this frame produced
   */
  receive(frame) {
    const data = frame && typeof frame === 'object' ? frame : {};
    const list = Array.isArray(data.people) ? data.people : [];
    const previous = this.sessions;
    const sessions = new Map();
    const people = [];

    for (const person of list) {
      if (!person || typeof person.id !== 'string' || !person.id) continue;
      const name = typeof person.name === 'string' && person.name.trim() ? person.name.trim() : 'Someone';
      const theirs = normalizeSessions(person.sessions, previous);
      for (const session of theirs) sessions.set(session.id, session);
      const entry = {
        id: person.id,
        name,
        you: person.you === true,
        editing: normalizeEditing(person.editing),
        sessions: theirs,
      };
      if (typeof person.canEdit === 'boolean') entry.canEdit = person.canEdit;
      people.push(entry);
    }

    this.people = people;
    this.sessions = sessions;
    const count = data.anonymous;
    this.anonymous = typeof count === 'number' && Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;

    // The connection the frame came over issues this. Page coordinates cannot be
    // sent without it, so a target held while it was missing goes now.
    const self = normalizeSelfSession(data.selfSession);
    const wasSessionless = !this.session || !this.session.token;
    if (self) this.session = self;

    const snapshot = this.emit();
    // The first frame of a connection carries the token, and it upgrades whatever
    // this tab already holds: a record target sent in the single-field shape goes
    // again in the extended envelope, and a page target that had no body goes now.
    if (self && wasSessionless && this.owner && this.target !== null) {
      this.sentKey = null;
      this.flush();
    }
    return snapshot;
  }

  /** The stream went away: nobody is known to be present and the token is spent. */
  clear() {
    this.people = [];
    this.anonymous = 0;
    this.sessions = new Map();
    this.session = null;
    this.cancel();
    this.sentKey = null;
    return this.emit();
  }

  /**
   * Publish this tab's target. Advisory and synchronous: a target that is not the
   * one already held is coalesced to one request every 250 ms, and a clear bypasses
   * the wait. Returns false for a target this client will not publish.
   *
   * A target set here belongs to an explicit owner — the page — and that owner
   * keeps the tab's one session until it releases it: the generic editing path is
   * silenced meanwhile, so a caret marker can never overwrite a page selection. A
   * clear keeps the ownership, so `setTarget(null)` publishes nobody anywhere
   * rather than falling back to a positional marker.
   *
   * @param {null|string|{kind: string}} target
   * @returns {boolean}
   */
  setTarget(target) {
    const result = validateTarget(target === undefined ? null : target);
    if (!result.ok) return false;
    this.explicit = true;
    return this.hold(result.target);
  }

  /**
   * Publish the generic positional marker of the editing path. Ignored while an
   * explicit owner holds the tab's target, and returns false when it is: the page
   * speaks for this tab until its teardown releases the target.
   *
   * @param {null|string} value
   * @returns {boolean}
   */
  setGeneric(value) {
    if (this.explicit) return false;
    const result = validateTarget(value === undefined ? null : value);
    if (!result.ok) return false;
    return this.hold(result.target);
  }

  /**
   * The owner release, for a page's teardown: the explicit target is gone with the
   * thing that set it, so this clears it and lets the generic editing path speak
   * again. Internal to the store's owners — page code clears one selection with
   * `setTarget(null)` and gives the whole target up with this.
   *
   * @returns {boolean}
   */
  releaseTarget() {
    if (!this.explicit) return false;
    this.explicit = false;
    return this.hold(null);
  }

  /**
   * Reconcile the target this tab holds with a target that arrived from its owner,
   * without touching who owns it.
   */
  hold(target) {
    const key = targetKey(target);
    if (key === this.heldKey) {
      // The target did not move, but a stream that went away took its request with
      // it: a target sent before a reconnect is sent again.
      if (this.owner && this.sentKey !== key) this.schedule(COALESCE_MS);
      return true;
    }
    this.target = target;
    this.heldKey = key;
    if (target === null) {
      this.cancel();
      this.flush();
      return true;
    }
    this.schedule(COALESCE_MS);
    return true;
  }

  /**
   * Take ownership of the stream's targets and roster. The returned lease is how an
   * owner gives them back; a lease a newer one replaced detaches nothing.
   *
   * @param {{send: (body: Object) => any}} transport
   * @returns {{active: boolean, detach: () => void}}
   */
  attachTransport(transport) {
    if (!transport || typeof transport.send !== 'function') {
      throw new TypeError('clay.presence.attachTransport needs a transport with a send function');
    }
    const store = this;
    const lease = {
      send: transport.send,
      get active() {
        return store.owner === lease;
      },
      detach() {
        if (store.owner !== lease) return;
        // A clear this lease asked for and the host never heard: the last word it
        // holds is a target, and nothing after this lease will take it back.
        const unsent = store.heldKey === '' && typeof store.inflightKey === 'string' && store.inflightKey !== '';
        store.owner = null;
        store.session = null;
        store.n = 0;
        store.sentKey = null;
        // The request this lease left behind is its own: the next lease starts
        // unblocked, and the answer that arrives late releases nothing.
        store.inflight = false;
        store.inflightOwner = null;
        store.inflightKey = null;
        store.cancel();
        store.target = null;
        store.heldKey = '';
        store.explicit = false;
        store.clear();
        if (unsent) {
          try {
            Promise.resolve(lease.send({ editing: null })).catch(() => {});
          } catch {}
        }
      },
    };
    this.owner = lease;
    this.session = null;
    this.n = 0;
    this.sentKey = null;
    this.inflight = false;
    this.inflightOwner = null;
    this.inflightKey = null;
    this.cancel();
    // A fresh connection starts from nothing, so the target this tab holds is sent
    // again rather than assumed delivered.
    if (this.target !== null) this.flush();
    return lease;
  }

  /**
   * Attach this document's one presence transport, chosen from what the host said
   * about itself and never from receiving an event: the relay it accepts targets
   * on, or the same-browser channel its awareness block names. Exactly one — a
   * broadcast host is never probed at the relay, and a relay host never opens a
   * channel — and a host that names neither gets no transport at all.
   *
   * @param {{send?: ?function(Object): any}} [options] - the relay's send, when
   *   this tab may publish at all. A reader passes none.
   * @returns {Promise<?{active: boolean, detach: function(): void, stop?: function(): void}>}
   */
  connect({ send = null } = {}) {
    if (this.connecting) return this.connecting;
    this.connecting = hostMeta()
      .then((meta) => {
        const extensions = Array.isArray(meta?.extensions) ? meta.extensions : [];
        const awareness = meta?.document && typeof meta.document === 'object' ? meta.document.awareness : null;
        if (
          awareness && awareness.transport === 'broadcast' &&
          (extensions.includes('page-awareness-v1') || extensions.includes('record-awareness-v1'))
        ) {
          const scope = typeof awareness.scope === 'string' && awareness.scope ? awareness.scope : null;
          return import('./local-presence.js').then(({ localPresence }) => {
            const session = localPresence({ scope, store: this });
            const lease = session.start();
            if (!lease) return null;
            // The lease stays the transport this document holds, so it is still the
            // store's one owner; `stop` is the session's, and stopping it is what
            // takes the heartbeat, the channel and the goodbye with the session.
            return Object.defineProperty(lease, 'stop', { value: () => session.stop() });
          });
        }
        if (typeof send === 'function' && extensions.includes('presence-editing')) {
          return this.attachTransport({ send });
        }
        return null;
      })
      .finally(() => {
        this.connecting = null;
      });
    return this.connecting;
  }

  /**
   * The stream reconnected. The host issues a session per connection, so the token
   * this tab held, the order it was sending in and the target it believed delivered
   * are all spent: a page target waits for the new session to name itself, and the
   * generic marker goes again on its own schedule.
   */
  reconnect() {
    this.session = null;
    this.n = 0;
    this.sentKey = null;
    this.cancel();
    if (!this.owner || this.target === null) return;
    this.flush();
  }

  emit() {
    const people = this.people.map((person) => Object.freeze({
      ...person,
      sessions: Object.freeze(person.sessions),
    }));
    this.snapshot = Object.freeze({
      supported: this.supported,
      recordAwareness: this.recordAwareness,
      pageAwareness: this.pageAwareness,
      people: Object.freeze(people),
      anonymous: this.anonymous,
    });
    for (const listener of [...this.listeners]) listener(this.snapshot);
    return this.snapshot;
  }

  /**
   * One timer. A pending coalescing window keeps its deadline when somebody keeps
   * moving — otherwise a moving caret would never send — while a renewal or a retry
   * is exactly what a new target replaces.
   */
  schedule(wait, kind = 'coalesce') {
    if (this.timer !== null) {
      if (this.timerKind === 'coalesce') return;
      clearTimeout(this.timer);
    }
    this.timerKind = kind;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.timerKind = null;
      this.flush();
    }, wait);
  }

  cancel() {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.timerKind = null;
  }

  renew() {
    if (this.timer !== null || !this.owner || this.target === null) return;
    this.schedule(RENEW_MS, 'renew');
  }

  flush() {
    if (this.inflight) return;
    const owner = this.owner;
    if (!owner) return;
    const n = this.n + 1;
    const body = requestBody({ target: this.target, session: this.session, n });
    if (!body) return;
    this.cancel();
    this.sentKey = this.heldKey;
    this.inflight = true;
    this.inflightOwner = owner;
    this.inflightKey = this.sentKey;
    if (body.v === PRESENCE_VERSION) this.n = n;

    const settle = (ok) => {
      // A request a lease that has since let the tab go is not this store's to
      // answer for: the newer owner's request, or the final clear, is what stands.
      if (this.inflightOwner !== owner) return;
      this.inflight = false;
      this.inflightOwner = null;
      this.inflightKey = null;
      if (this.owner !== owner) return;
      if (this.heldKey !== this.sentKey) {
        // A newer target arrived while this one was in flight: the latest wins.
        this.flush();
        return;
      }
      if (ok) this.renew();
      else this.schedule(RENEW_MS, 'renew');
    };
    Promise.resolve(owner.send(body)).then((ok) => settle(Boolean(ok)), () => settle(false));
  }
}

export const presence = new PresenceStore();

export default presence;

// The facade belongs on `clay` the moment it exists. Two entries load this
// module — the roster chrome a reader gets with its first frame, and the editing
// sender an editor starts with — and both find the same store here.
if (typeof window !== 'undefined') {
  window.clay = window.clay || {};
  if (!window.clay.presence) {
    window.clay.presence = presence;
    try {
      document.dispatchEvent(new CustomEvent('clay:presence-ready', { detail: { presence } }));
    } catch {}
  }
}
