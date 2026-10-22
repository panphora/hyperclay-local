const fs = require('fs');
const { randomUUID } = require('crypto');
const upath = require('upath');
const { assertWriteContext, assertStructureContext } = require('./utils/write-queue');
const { documentEtag } = require('./spec-wire');
const { publishRecoveredCopy } = require('./utils/backup');
const { compatibleContinuation, renderRecovered } = require('./external-recovery');
const { logicalDocument } = require('./page-state-store');

const EVENT_NAMES = new Set(['data', 'data-state', 'data-writer']);
const RATE_LIMIT = Object.freeze({ rate: 25, burst: 40, idleMs: 60 * 1000 });

/** A cold room load failed in a way the transport maps to 404 or 409, not 500. */
class LocalAuthorityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LocalAuthorityError';
    this.code = code;
  }
}

/**
 * The canonical registry of Local live editors and room state, keyed by the
 * resolved canonical file path. One room per file is shared by every logical
 * root alias; each editor connection keeps its own proof (clientId plus conn).
 * Pure in memory: the caller owns the disk boundary (withDocument), time and
 * the room sweep timer.
 */
function createLocalAuthority({ rooms, withDocument, readSaved, publishRecovered = publishRecoveredCopy, now = Date.now, newId = randomUUID } = {}) {
  if (typeof withDocument !== 'function') throw new Error('createLocalAuthority requires withDocument');

  // Required here, never at module load: the server package stays Optional for
  // callers that only touch the other Local modules.
  const core = require('@panphora/clayjs/server/rooms');
  if (!rooms) rooms = core.createRooms({ now });
  // The saved document a room is seeded from is the logical one: the file on disk
  // with the page editor's merge state put back, which is what the editor holds.
  if (!readSaved) readSaved = async (target) => {
    const html = await fs.promises.readFile(target.canonicalPath, 'utf8');
    const root = roots.get(target.rootId);
    return root && target.logicalPath ? logicalDocument(root.path, target.logicalPath, html) : html;
  };

  let checkpointService = null;

  const registry = new Map();
  const buckets = new Map();
  // One entry per admitted logical root/path/origin. The canonical path is what
  // keys a room, so an alias root shares the room and keeps its own entry.
  const logical = new Map();
  const logicalKey = ({ rootId, logicalPath, origin } = {}) => `${rootId}\n${logicalPath}\n${origin}`;

  // One entry per configured root: its id and canonical folder path. Closing a
  // root drops only the logical bindings it owns, so an alias root sharing a
  // canonical file keeps its own entry and the one room identity.
  const roots = new Map();

  // Admission state. A revision increases once per admission change, so a claim
  // taken before a location was retired can never be revalidated by a later
  // active event that happens to restore the same path and the same identity.
  // Canonical events key a normalized absolute path; logical events key a
  // normalized relative path inside one root. Each path keeps its exact and
  // prefix event separately; the greatest applicable revision decides.
  let admissionRevision = 0;
  let rootIncarnation = 0;
  const canonicalEvents = new Map();
  const logicalEvents = new Map();

  const normCanonical = (value) => {
    if (typeof value !== 'string' || !value) return '';
    const normalized = upath.normalize(value);
    return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
  };

  const normLogical = (value) => {
    if (typeof value !== 'string' || !value) return '';
    return upath.normalize(value).replace(/^\/+/, '').replace(/\/+$/, '');
  };

  const within = (candidate, prefix) => candidate === prefix || candidate.startsWith(`${prefix}/`);

  /**
   * The applicable event with the greatest revision: an exact match or a
   * segment-bound prefix match. A later retired parent therefore supersedes an
   * earlier active child, and a later active child supersedes an earlier
   * retired parent.
   */
  function latestEvent(events, candidate) {
    let latest = null;
    for (const [at, scopes] of events) {
      const applicable = candidate === at
        ? [scopes.exact, scopes.prefix]
        : within(candidate, at) ? [scopes.prefix] : [];
      for (const event of applicable) {
        if (!event) continue;
        if (!latest || event.revision > latest.revision) latest = event;
      }
    }
    return latest;
  }

  const canonicalEventAt = (canonicalPath) => {
    const at = normCanonical(canonicalPath);
    return at ? latestEvent(canonicalEvents, at) : null;
  };

  const logicalEventAt = (rootId, logicalPath) => {
    const at = normLogical(logicalPath);
    if (!at || rootId == null) return null;
    const events = logicalEvents.get(rootId);
    return events ? latestEvent(events, at) : null;
  };

  const rootIncarnationOf = (rootId) => (rootId == null ? null : roots.get(rootId)?.incarnation ?? null);

  const identityOf = (canonicalPath) => {
    const at = normCanonical(canonicalPath);
    return at ? registry.get(at)?.identity ?? null : null;
  };

  /**
   * Record an admission event for a canonical path, one root's logical path, or
   * both. The caller must already hold the matching boundary: a prefix or
   * logical-only event needs the structure boundary, an exact event with a
   * canonical path needs that document's boundary. Both spaces of one call
   * share one revision.
   */
  function setAdmission(token, { rootId = null, logicalPath = null, canonicalPath = null, active, prefix = false } = {}) {
    if (typeof active !== 'boolean') throw new TypeError('setAdmission requires a boolean active');
    const at = normCanonical(canonicalPath);
    const logicalAt = normLogical(logicalPath);
    const canonicalSpace = Boolean(at);
    const logicalSpace = Boolean(logicalAt) && rootId != null;
    if (!canonicalSpace && !logicalSpace) throw new Error('setAdmission requires a canonical or logical path');
    if (prefix || !canonicalSpace) assertStructureContext(token);
    else assertWriteContext(token, canonicalPath);

    const revision = ++admissionRevision;
    const event = { active, revision };
    const scope = prefix ? 'prefix' : 'exact';
    if (canonicalSpace) {
      const scopes = canonicalEvents.get(at) ?? {};
      scopes[scope] = event;
      canonicalEvents.set(at, scopes);
    }
    if (logicalSpace) {
      let events = logicalEvents.get(rootId);
      if (!events) {
        events = new Map();
        logicalEvents.set(rootId, events);
      }
      const scopes = events.get(logicalAt) ?? {};
      scopes[scope] = event;
      events.set(logicalAt, scopes);
    }
    return revision;
  }

  /** True when the latest applicable canonical or logical event is a retirement. */
  function isRetired({ rootId = null, logicalPath = null, canonicalPath = null } = {}) {
    const canonicalEvent = canonicalEventAt(canonicalPath);
    if (canonicalEvent && !canonicalEvent.active) return true;
    const logicalEvent = logicalEventAt(rootId, logicalPath);
    if (logicalEvent && !logicalEvent.active) return true;
    return false;
  }

  /**
   * A read-only claim for a location a caller is about to queue behind: the root
   * incarnation, both normalized paths, the current identity and the applicable
   * event revisions. It allocates no record, binds nothing and clears no
   * retirement.
   */
  function captureAdmission({ rootId = null, logicalPath = null, canonicalPath = null } = {}) {
    const at = normCanonical(canonicalPath);
    const logicalAt = normLogical(logicalPath);
    return Object.freeze({
      rootId,
      logicalPath: logicalAt,
      canonicalPath: at,
      incarnation: rootIncarnationOf(rootId),
      identity: identityOf(at),
      canonicalRevision: canonicalEventAt(at)?.revision ?? 0,
      logicalRevision: logicalEventAt(rootId, logicalAt)?.revision ?? 0,
    });
  }

  /**
   * Refuse a claim whose root incarnation, either path, identity or applicable
   * admission revision changed, or whose location is retired now. Called inside
   * the caller's document boundary, before any backup, mkdir or write. Only an
   * explicit create may pass allowRetired, and even then it may not clear the
   * retirement: the confirmed write does that.
   */
  function validateAdmission(claim, { rootId = null, logicalPath = null, canonicalPath = null } = {}, token, { allowRetired = false, allowInitialBind = false } = {}) {
    const at = normCanonical(canonicalPath);
    const logicalAt = normLogical(logicalPath);
    assertWriteContext(token, canonicalPath);
    if (registry.get(at)?.recovering) throw new LocalAuthorityError('moved', `recovery is pending for ${at}`);
    const currentIdentity = identityOf(at);
    const identityChanged = claim && claim.identity !== currentIdentity &&
      !(allowInitialBind && claim.identity === null && currentIdentity !== null);
    const stale = !claim ||
      claim.rootId !== rootId ||
      claim.canonicalPath !== at ||
      claim.logicalPath !== logicalAt ||
      claim.incarnation !== rootIncarnationOf(rootId) ||
      identityChanged ||
      claim.canonicalRevision !== (canonicalEventAt(at)?.revision ?? 0) ||
      claim.logicalRevision !== (logicalEventAt(rootId, logicalAt)?.revision ?? 0) ||
      (!allowRetired && isRetired({ rootId, logicalPath: logicalAt, canonicalPath: at }));
    if (stale) throw new LocalAuthorityError('moved', `admission for ${at || logicalAt} is no longer valid`);
    return true;
  }

  // One private state per prepared structure transaction. The plan the caller
  // holds is frozen and opaque: the hold tokens, the validated prefix outcomes
  // and the later-drop marks live here, so no caller can forge or edit a plan.
  const structurePlans = new WeakMap();

  const structurePath = (value, label) => {
    if (typeof value !== 'string' || !value) throw new TypeError(`${label} requires a nonempty path`);
    const normalized = normCanonical(value);
    if (normalized !== value || !upath.isAbsolute(normalized)) {
      throw new TypeError(`${label} requires a normalized absolute path`);
    }
    return normalized;
  };

  const structureRel = (value, label) => {
    const normalized = normLogical(value);
    if (!normalized) throw new TypeError(`${label} requires a nonempty root-relative path`);
    return normalized;
  };

  /**
   * The physical entry one root's logical route occupies: the root's canonical
   * folder joined with the normalized logical path. This is where the user's
   * file or link sits, never the canonical document a final symlink reaches.
   */
  const entryLocation = (root, logicalPath) => upath.join(root.canonicalPath, normLogical(logicalPath));

  /**
   * Whether a step moves that physical entry: exactly it, or at/below it when
   * the step moves a directory. Segment-aware, so dir2 is not inside dir.
   */
  const entryMoves = (step, location) =>
    step.from.isDir ? within(location, step.from.location) : location === step.from.location;

  /**
   * Every registered root whose canonical folder holds the step's source entry,
   * with the relative paths that entry and its destination take inside that
   * root. The initiating root keeps the caller's own relative paths; an alias
   * root maps them from its own canonical folder. A destination outside a root
   * leaves that root, so it has no destination there.
   */
  function physicalRoutes(rootId, step) {
    const routes = [];
    for (const registered of roots.values()) {
      if (registered.id === rootId) {
        routes.push(Object.freeze({ rootId, fromRel: step.fromRel, toRel: step.to ? step.toRel : null }));
        continue;
      }
      if (!within(step.from.location, registered.canonicalPath)) continue;
      const fromRel = normLogical(upath.relative(registered.canonicalPath, step.from.location));
      if (!fromRel) continue;
      const toRel = step.to && within(step.to.location, registered.canonicalPath)
        ? normLogical(upath.relative(registered.canonicalPath, step.to.location)) || null
        : null;
      routes.push(Object.freeze({ rootId: registered.id, fromRel, toRel }));
    }
    return routes;
  }

  /** One resolved structure entry description, normalized and frozen. */
  function structureStep(step, index) {
    const label = `structure step ${index}`;
    if (!step || typeof step !== 'object') throw new TypeError(`${label} requires a descriptor`);
    const from = step.from;
    if (!from || typeof from !== 'object') throw new TypeError(`${label} requires a from entry`);
    if (typeof from.isDir !== 'boolean' || typeof from.isSymlink !== 'boolean') {
      throw new TypeError(`${label} requires boolean isDir and isSymlink`);
    }
    if (step.to != null && typeof step.to !== 'object') throw new TypeError(`${label} requires a to entry or null`);
    const to = step.to ?? null;
    if (to === null && step.toRel != null) throw new TypeError(`${label} has a toRel without a to entry`);
    return Object.freeze({
      from: Object.freeze({
        location: structurePath(from.location, `${label} from.location`),
        canonical: structurePath(from.canonical, `${label} from.canonical`),
        isDir: from.isDir,
        isSymlink: from.isSymlink,
      }),
      to: to ? Object.freeze({
        location: structurePath(to.location, `${label} to.location`),
        canonical: structurePath(to.canonical, `${label} to.canonical`),
      }) : null,
      fromRel: structureRel(step.fromRel, `${label} fromRel`),
      toRel: to ? structureRel(step.toRel, `${label} toRel`) : null,
    });
  }

  /**
   * Every path a step names stays inside the operating root, and no step may
   * move a registered root or an ancestor of one. A symlink is compared by the
   * entry path it occupies, never by its external content target.
   */
  function assertStructureBoundary(root, step) {
    const insideRoot = (candidate) => within(candidate, root.path) || within(candidate, root.canonicalPath);
    const holdsRoot = (candidate) => {
      for (const registered of roots.values()) {
        if (within(registered.path, candidate) || within(registered.canonicalPath, candidate)) return registered;
      }
      return null;
    };
    const paths = step.from.isSymlink ? [step.from.location] : [step.from.location, step.from.canonical];
    if (step.to) {
      paths.push(step.to.location);
      if (!step.from.isSymlink) paths.push(step.to.canonical);
    }
    for (const candidate of paths) {
      const registered = holdsRoot(candidate);
      if (registered) throw new LocalAuthorityError('root-boundary', `${candidate} holds registered root ${registered.id}`);
      if (!insideRoot(candidate)) throw new LocalAuthorityError('root-boundary', `${candidate} is outside root ${root.id}`);
    }
  }

  const structureHoldError = (err, key) => {
    if (err?.code === 'checkpointing') return new LocalAuthorityError('checkpointing', `${key} is already being saved`);
    if (err?.code === 'unlanded' || err?.code === 'room-changed') {
      return new LocalAuthorityError('peers-editing', `${key} has edits that have not landed`);
    }
    return err;
  };

  /**
   * The preparation half of a structure transaction. Under one exclusive
   * structure token it checks the registered root boundaries, validates every
   * possible completed prefix against the finite room, record and logical keys,
   * and holds every affected room clean. It changes no room key, record key,
   * admission event or disk byte, and never calls the eager
   * rooms.rekeyPersistent: D1c's commit applies one prepared prefix.
   */
  function prepareStructure(token, { rootId = null, steps } = {}) {
    assertStructureContext(token);
    const root = rootId == null ? null : roots.get(rootId);
    if (!root) throw new LocalAuthorityError('root-boundary', `structure root ${rootId} is not registered`);
    if (!Array.isArray(steps)) throw new TypeError('prepareStructure requires a steps array');

    const normalized = Object.freeze(steps.map((step, index) => structureStep(step, index)));
    for (const step of normalized) assertStructureBoundary(root, step);

    // The finite snapshot: current room keys, registry keys and logical routes.
    // Preparation never walks a root tree or the disk.
    const virtual = new Set();
    for (const key of registry.keys()) virtual.add(key);
    for (const key of rooms.keys()) virtual.add(key);
    for (const target of logical.values()) if (target.canonicalPath) virtual.add(target.canonicalPath);

    // The logical counterpart of the virtual occupancy: one bound-route set per
    // registered root, keyed without origin, so an alias root's own destination
    // collision refuses even when the initiating root has no binding there.
    // Preparation never rebinds the real logical map; a later step sees only
    // what an earlier step vacated or filled.
    const virtualLogical = new Map();
    for (const registered of roots.values()) virtualLogical.set(registered.id, new Set());
    for (const target of logical.values()) {
      const occupied = virtualLogical.get(target.rootId);
      const logicalPath = normLogical(target.logicalPath);
      if (occupied && logicalPath) occupied.add(logicalPath);
    }

    const moves = [];
    const outcomes = [{ virtual: new Set(virtual), moves: Object.freeze([]), count: 0 }];
    const affected = new Set();
    const stepRoutes = [];

    for (const step of normalized) {
      const routes = physicalRoutes(rootId, step);
      stepRoutes.push(routes);
      const fromCanonical = step.from.canonical;
      const sources = [];
      for (const key of virtual) {
        if (step.from.isDir ? within(key, fromCanonical) : key === fromCanonical) sources.push(key);
      }
      sources.sort();
      for (const key of sources) affected.add(key);

      // Every binding whose physical entry the step moves needs its room held,
      // in every registered root, even when the room itself lives outside the
      // moved entry: a symlink's content, or an alias root's own route.
      for (const target of logical.values()) {
        const registered = target.rootId == null ? null : roots.get(target.rootId);
        if (!registered) continue;
        if (entryMoves(step, entryLocation(registered, target.logicalPath))) affected.add(target.canonicalPath);
      }

      if (!step.from.isSymlink) {
        // Every source vacates before destinations are checked, so a key that
        // is about to move cannot collide with itself. A same-key move is a
        // no-op and skips its one check.
        const destinationBase = step.to ? step.to.canonical : null;
        for (const key of sources) virtual.delete(key);
        if (destinationBase !== null && destinationBase !== fromCanonical &&
            (virtual.has(destinationBase) || rooms.pageReserved(destinationBase))) {
          throw new LocalAuthorityError('destination-exists', `${destinationBase} is already occupied`);
        }
        for (const key of sources) {
          const destination = destinationBase === null ? null : destinationBase + key.slice(fromCanonical.length);
          if (destination !== null && destination !== key &&
              (virtual.has(destination) || rooms.pageReserved(destination))) {
            throw new LocalAuthorityError('destination-exists', `${destination} is already occupied`);
          }
          if (destination !== null) virtual.add(destination);
          moves.push(Object.freeze({ from: key, to: destination }));
        }
      }

      // Each affected root vacates its own source route, then checks and fills
      // its own destinations, so one physical step is validated in every root
      // that exposes it before any room is held or any disk byte moves.
      for (const route of routes) {
        const occupied = virtualLogical.get(route.rootId);
        if (!occupied) continue;
        const logicalSources = [];
        for (const logicalPath of occupied) {
          if (step.from.isDir ? within(logicalPath, route.fromRel) : logicalPath === route.fromRel) {
            logicalSources.push(logicalPath);
          }
        }
        logicalSources.sort();
        for (const logicalPath of logicalSources) occupied.delete(logicalPath);

        if (!route.toRel) continue;
        if (route.toRel !== route.fromRel && occupied.has(route.toRel)) {
          throw new LocalAuthorityError('destination-exists', `${route.toRel} is already occupied`);
        }
        for (const logicalPath of logicalSources) {
          const destination = route.toRel + logicalPath.slice(route.fromRel.length);
          if (destination !== logicalPath && occupied.has(destination)) {
            throw new LocalAuthorityError('destination-exists', `${destination} is already occupied`);
          }
          occupied.add(destination);
        }
      }

      outcomes.push({ virtual: new Set(virtual), moves: Object.freeze(moves.slice()), count: moves.length });
    }

    const holds = [];
    try {
      for (const key of [...affected].sort()) {
        const room = rooms.get(key);
        if (!room) continue;
        let holdToken;
        try {
          holdToken = rooms.holdPersistent(key, { nodeId: room.nodeId, requireClean: true });
        } catch (err) {
          throw structureHoldError(err, key);
        }
        const record = registry.get(key);
        holds.push({
          key,
          token: holdToken,
          nodeId: room.nodeId,
          drop: !record || String(record.identity) !== String(room.nodeId),
        });
      }
    } catch (err) {
      for (const hold of holds) rooms.releasePersistent(hold.token);
      throw err;
    }

    const plan = Object.freeze({
      preview: Object.freeze({
        rootId,
        steps: normalized,
        prefixCounts: Object.freeze(outcomes.map((outcome) => outcome.count)),
      }),
    });
    structurePlans.set(plan, { token, rootId, steps: normalized, routes: stepRoutes, holds, outcomes, released: false });
    return plan;
  }

  /**
   * Release every hold a preparation took, once, and mark the plan unusable.
   * Idempotent: a second call releases nothing and reports false.
   */
  function releaseStructure(plan, token) {
    assertStructureContext(token);
    const state = plan && typeof plan === 'object' ? structurePlans.get(plan) : null;
    if (!state) return false;
    if (state.token !== token) {
      throw new LocalAuthorityError('invalid-reservation', 'structure plan belongs to another structure token');
    }
    if (state.released) return false;
    state.released = true;
    for (const hold of state.holds) if (!hold.released) rooms.releasePersistent(hold.token);
    return true;
  }

  /**
   * The commit half of a structure transaction. The caller has already run the
   * physical operations in order and reports how many prepared steps completed;
   * this applies exactly that prefix to rooms, records, bindings and admission.
   * Synchronous and disk-free: the one structure token is already held, and a
   * foreign, released or already committed plan refuses before any mutation.
   */
  function commitStructure(plan, completed, token, { copiedSteps = [] } = {}) {
    assertStructureContext(token);
    const state = plan && typeof plan === 'object' ? structurePlans.get(plan) : null;
    if (!state) throw new LocalAuthorityError('invalid-reservation', 'unknown structure plan');
    if (state.token !== token) {
      throw new LocalAuthorityError('invalid-reservation', 'structure plan belongs to another structure token');
    }
    if (state.released) throw new LocalAuthorityError('invalid-reservation', 'structure plan has been released');
    if (state.committed) throw new LocalAuthorityError('invalid-reservation', 'structure plan has already been committed');
    if (!Number.isInteger(completed) || completed < 0 || completed > state.steps.length) {
      throw new LocalAuthorityError('invalid-reservation', `completed ${completed} is outside the prepared steps`);
    }
    if (!Array.isArray(copiedSteps)) {
      throw new LocalAuthorityError('invalid-reservation', 'copiedSteps must be an array of step indices');
    }
    const copied = new Set();
    for (const index of copiedSteps) {
      if (!Number.isInteger(index) || index < 0 || index >= completed || copied.has(index)) {
        throw new LocalAuthorityError('invalid-reservation', `copied step ${index} is not a unique index inside the completed prefix`);
      }
      copied.add(index);
    }
    state.committed = true;

    /**
     * A destination that is another move's source may only be filled after that
     * source vacated it, or rooms.rekeyPersistent reports destination-exists.
     */
    const rekeyOrder = (moves) => {
      const pending = moves.slice();
      const ordered = [];
      while (pending.length) {
        const index = pending.findIndex((move) => !pending.some((other) => other !== move && other.from === move.to));
        if (index === -1) return ordered.concat(pending);
        ordered.push(pending.splice(index, 1)[0]);
      }
      return ordered;
    };

    for (let stepIndex = 0; stepIndex < completed; stepIndex++) {
      const step = state.steps[stepIndex];
      const moves = state.outcomes[stepIndex + 1].moves.slice(state.outcomes[stepIndex].count);
      const isDir = step.from.isDir;
      const routes = [];
      const stepRoutes = state.routes[stepIndex] ?? [];

      // A route entry this step moves, in any registered root: an alias root's
      // own copy of the entry detaches even when the room is shared or external.
      const movedEntry = (target) => {
        const registered = target.rootId == null ? null : roots.get(target.rootId);
        return Boolean(registered) && entryMoves(step, entryLocation(registered, target.logicalPath));
      };

      // Detach the proofs and snapshots of the old routes while their old key
      // still resolves to their old record and room.
      if (step.from.isSymlink) {
        for (const record of registry.values()) {
          for (const member of [...record.members]) if (movedEntry(member.target)) member.close();
          for (const snapshot of [...record.snapshots]) if (movedEntry(snapshot.target)) snapshot.dispose();
        }
      } else {
        for (const move of moves) {
          const record = registry.get(move.from);
          if (!record) continue;
          for (const member of [...record.members]) member.close();
          for (const snapshot of [...record.snapshots]) snapshot.dispose();
        }
        for (const record of registry.values()) {
          for (const member of [...record.members]) if (movedEntry(member.target)) member.close();
          for (const snapshot of [...record.snapshots]) if (movedEntry(snapshot.target)) snapshot.dispose();
        }
      }

      // Rekey or drop each held room. A dropped hold releases at once so a later
      // confirmed step may reuse the key; a released hold is never released twice.
      for (const move of rekeyOrder(moves)) {
        const hold = state.holds.find((candidate) => !candidate.released && candidate.key === move.from);
        if (!hold) continue;
        if (move.to === null || hold.drop) {
          rooms.drop(hold.key);
          rooms.releasePersistent(hold.token);
          hold.released = true;
        } else if (hold.key !== move.to) {
          rooms.rekeyPersistent(hold.token, move.to);
          hold.key = move.to;
        }
      }

      // Move the records in one batch per step: every source key goes first, so
      // two records can swap keys. A copied step keeps the identity but cannot
      // keep the old file's confirmation.
      const recordMoves = [];
      for (const move of moves) {
        const record = registry.get(move.from);
        if (record) recordMoves.push({ from: move.from, to: move.to, record });
      }
      for (const entry of recordMoves) registry.delete(entry.from);
      for (const entry of recordMoves) {
        if (entry.to === null) continue;
        if (copied.has(stepIndex)) entry.record.confirmed = null;
        registry.set(entry.to, entry.record);
      }

      // Drop the old logical routes, in every root that held one, plus each
      // prepared root's source entry even when no binding existed. The
      // destination binds lazily, on its next request or observer admission.
      const sources = new Set(moves.map((move) => move.from));
      for (const [key, target] of [...logical]) {
        if (!sources.has(target.canonicalPath) && !movedEntry(target)) continue;
        logical.delete(key);
        routes.push({ rootId: target.rootId, logicalPath: normLogical(target.logicalPath) });
      }
      for (const route of stepRoutes) routes.push({ rootId: route.rootId, logicalPath: route.fromRel });

      // Retire the old locations and admit the destination in one revision
      // sequence: an old claim stays stale even when a later step refills a path.
      if (!step.from.isSymlink) {
        setAdmission(token, { canonicalPath: step.from.canonical, active: false, prefix: isDir });
      }
      const retired = new Set();
      for (const route of routes) {
        if (route.rootId == null || !route.logicalPath) continue;
        const key = `${route.rootId}\n${route.logicalPath}`;
        if (retired.has(key)) continue;
        retired.add(key);
        setAdmission(token, { rootId: route.rootId, logicalPath: route.logicalPath, active: false, prefix: isDir });
      }
      if (step.to) {
        if (!step.from.isSymlink) {
          setAdmission(token, { canonicalPath: step.to.canonical, active: true, prefix: isDir });
        }
        for (const route of stepRoutes) {
          if (route.rootId == null || !route.toRel) continue;
          setAdmission(token, { rootId: route.rootId, logicalPath: route.toRel, active: true, prefix: isDir });
        }
      }
    }

    return completed;
  }

  const recordFor = (canonicalPath, identity) => {
    let record = registry.get(canonicalPath);
    if (!record) {
      record = { identity: identity ?? newId(), snapshots: new Set(), members: new Set() };
      registry.set(canonicalPath, record);
    }
    return record;
  };

  const identityAt = (canonicalPath, { rootId = null, logicalPath = null } = {}) =>
    isRetired({ rootId, logicalPath, canonicalPath }) ? null : registry.get(canonicalPath)?.identity ?? null;

  const sameTarget = (member, target, clientId) => member.clientId === clientId &&
    member.target.rootId === target.rootId &&
    member.target.logicalPath === target.logicalPath &&
    member.target.origin === target.origin;

  // The admission claim one bound target was created under, so a target handed
  // back later is told apart from the generation it replaced even when the path
  // and the identity came back. Private to this authority.
  const targetClaims = new WeakMap();

  /**
   * Install one logical root/path/origin binding, evicting any other canonical
   * file a previous binding for the same root/path held, so a retarget never
   * leaves the file it left behind receiving that alias's events. The exact
   * frozen target remembers the admission it was bound under.
   */
  function bindLogical(target) {
    for (const [key, entry] of [...logical]) {
      if (entry.rootId === target.rootId && entry.logicalPath === target.logicalPath && entry.canonicalPath !== target.canonicalPath) {
        logical.delete(key);
      }
    }
    logical.set(logicalKey(target), target);
    targetClaims.set(target, captureAdmission(target));
    return target;
  }

  function bindTarget({ rootId, logicalPath, canonicalPath, origin, live } = {}) {
    if (typeof canonicalPath !== 'string' || !canonicalPath) throw new Error('bindTarget requires canonicalPath');
    const { identity } = recordFor(canonicalPath);
    return bindLogical(Object.freeze({ rootId, logicalPath, canonicalPath, origin, live, identity }));
  }

  // One private entry per staged write target: whether its identity is fresh,
  // whether only this caller's explicit create may clear the location's
  // retirement, and the token that staged it, so no other document boundary can
  // confirm the write. The frozen target itself stays a proof, not a membership.
  const stagedTargets = new WeakMap();

  /**
   * Stage a write target inside the caller's document boundary without allocating
   * authority: the claim is validated under the live token, but no record, logical
   * binding, admission event, room or disk changes yet. Only an explicit create
   * may stage on a retired location, and only when the old generation is gone.
   */
  function admitWriteTarget(claim, { rootId = null, logicalPath = null, canonicalPath = null, origin, live } = {}, token, { explicitCreate = false } = {}) {
    if (typeof canonicalPath !== 'string' || !canonicalPath) throw new Error('admitWriteTarget requires canonicalPath');
    const at = normCanonical(canonicalPath);
    validateAdmission(claim, { rootId, logicalPath, canonicalPath }, token, { allowRetired: explicitCreate });
    const record = registry.get(at);
    if (record && explicitCreate && isRetired({ rootId, logicalPath, canonicalPath: at })) {
      throw new LocalAuthorityError('moved', `admission for ${at} is no longer valid`);
    }
    const target = Object.freeze({
      rootId, logicalPath, canonicalPath, origin, live, identity: record ? record.identity : newId(),
    });
    stagedTargets.set(target, { fresh: !record, explicitCreate, token });
    return target;
  }

  /**
   * Whether one exact bound target still is the generation its route, its
   * canonical record and its admission events describe. Read only: it allocates
   * no record, binds nothing and clears no retirement, so a stale target is
   * refused before any membership lookup or warm room reuse. A target bound
   * before its root's first registration keeps its initial null incarnation, but
   * only while its own route is still bound: a close drops that binding, so a
   * later reopen of the same path stays stale.
   */
  function isCurrentTarget(target) {
    const claim = targetClaims.get(target);
    if (!claim) return false;
    const bound = logical.get(logicalKey(target));
    if (!bound || bound.canonicalPath !== target.canonicalPath || bound.identity !== target.identity) return false;
    const record = registry.get(target.canonicalPath);
    if (!record || record.identity !== target.identity) return false;
    if (record.recovering) return false;
    if (isRetired({ rootId: target.rootId, logicalPath: target.logicalPath, canonicalPath: target.canonicalPath })) return false;
    const now = captureAdmission(target);
    return now.rootId === claim.rootId &&
      now.canonicalPath === claim.canonicalPath &&
      now.logicalPath === claim.logicalPath &&
      now.identity === claim.identity &&
      now.canonicalRevision === claim.canonicalRevision &&
      now.logicalRevision === claim.logicalRevision &&
      (now.incarnation === claim.incarnation || (claim.incarnation === null && now.incarnation !== null));
  }

  /**
   * The target already bound for one logical root/path/origin, or null. Read
   * only: it lets the transport answer a request for a document it has already
   * admitted without resolving the disk again. The canonical path is never
   * inferred from these fields.
   */
  function findBoundTarget({ rootId, logicalPath, origin } = {}) {
    const target = logical.get(logicalKey({ rootId, logicalPath, origin }));
    if (!target) return null;
    const record = registry.get(target.canonicalPath);
    if (!record || record.identity !== target.identity) return null;
    if (isRetired({ rootId: target.rootId, logicalPath: target.logicalPath, canonicalPath: target.canonicalPath })) return null;
    if (!isCurrentTarget(target)) return null;
    for (const member of record.members) {
      if (!isCurrentTarget(member.target)) continue;
      if (sameTarget(member, target, member.clientId)) return member.target;
    }
    return null;
  }

  function registerSnapshot(target, { lane, legacy } = {}) {
    if (!isCurrentTarget(target)) throw new LocalAuthorityError('moved', `registration for ${target.canonicalPath} is no longer valid`);
    const record = recordFor(target.canonicalPath);
    const entry = { target, lane, legacy: lane === 'live' && legacy === true };
    let disposed = false;
    entry.dispose = () => {
      if (disposed) return;
      disposed = true;
      record.snapshots.delete(entry);
    };
    record.snapshots.add(entry);
    return entry.dispose;
  }

  function connectedIds(canonicalPath) {
    const record = registry.get(canonicalPath);
    if (!record) return [];
    const ids = [];
    for (const member of record.members) if (!ids.includes(member.clientId)) ids.push(member.clientId);
    return ids;
  }

  function registerEditor(target, { clientId, send } = {}) {
    if (!isCurrentTarget(target)) throw new LocalAuthorityError('moved', `registration for ${target.canonicalPath} is no longer valid`);
    const record = recordFor(target.canonicalPath);
    let closed = false;
    const member = {
      conn: newId(),
      clientId,
      target,
      participating: false,
      send,
      close() {
        if (closed) return;
        closed = true;
        record.members.delete(member);
        // A late close after the old path gained another occupant must leave that
        // occupant alone: only the record and room this proof was captured for may
        // see the leave.
        const key = target.canonicalPath;
        if (registry.get(key) !== record) return;
        const room = rooms.get(key);
        if (!room) return;
        const identity = target.identity ?? record.identity;
        if (identity != null && String(room.nodeId) !== String(identity)) return;
        const remaining = connectedIds(key);
        if (remaining.includes(clientId)) return;
        const result = rooms.leave(room, clientId, remaining);
        if (result && result.writerChanged) {
          sendTo(key, 'data-writer', { epoch: room.epoch, writer: result.writer });
        }
        if (member.participating && ![...record.members].some((entry) => entry.participating)) {
          checkpointService?.departed(room);
        }
      },
    };
    record.members.add(member);
    // A connection is current membership, so a room emptied by a previous
    // sweep must not be dropped under it: revive the same window leave() set.
    const warm = rooms.get(target.canonicalPath);
    if (warm && String(warm.nodeId) === String(target.identity ?? identityAt(target.canonicalPath))) {
      rooms.open(target.canonicalPath, '');
    }
    return member;
  }

  function currentEditor(target, clientId, conn) {
    if (!isCurrentTarget(target)) return null;
    const record = registry.get(target.canonicalPath);
    if (!record) return null;
    if (target.identity != null && record.identity !== target.identity) return null;
    for (const member of record.members) {
      if (member.conn === conn && sameTarget(member, target, clientId)) return member;
    }
    return null;
  }

  function newestEditor(target, clientId) {
    if (!isCurrentTarget(target)) return null;
    const record = registry.get(target.canonicalPath);
    if (!record) return null;
    if (target.identity != null && record.identity !== target.identity) return null;
    let newest = null;
    for (const member of record.members) if (sameTarget(member, target, clientId)) newest = member;
    return newest;
  }

  function markParticipating(member) {
    const record = registry.get(member.target.canonicalPath);
    if (!record || !record.members.has(member)) return null;
    member.participating = true;
    checkpointService?.arrived(member.target.canonicalPath);
    return member;
  }

  function hasParticipatingEditors(canonicalPath) {
    const record = registry.get(canonicalPath);
    return Boolean(record && [...record.members].some((member) => member.participating));
  }

  function hasUnjoinedEditors(canonicalPath) {
    const record = registry.get(canonicalPath);
    if (!record) return false;
    for (const snapshot of record.snapshots) if (snapshot.legacy) return true;
    for (const member of record.members) if (!member.participating) return true;
    return false;
  }

  function sendTo(canonicalPath, event, payload) {
    if (!EVENT_NAMES.has(event)) return 0;
    const record = registry.get(canonicalPath);
    if (!record) return 0;
    let sent = 0;
    for (const member of [...record.members]) {
      if (!record.members.has(member) || typeof member.send !== 'function') continue;
      try {
        member.send(event, payload);
        sent += 1;
      } catch {
        member.close();
      }
    }
    return sent;
  }

  const publish = (canonicalPath, event, payload) => sendTo(canonicalPath, event, payload);

  function publishState(canonicalPath) {
    const record = registry.get(canonicalPath);
    if (!record) return 0;
    const room = rooms.get(canonicalPath);
    if (!room) return 0;
    let sent = 0;
    for (const member of [...record.members]) {
      if (!record.members.has(member) || typeof member.send !== 'function') continue;
      const state = rooms.state(room, member.clientId);
      try {
        member.send('data-state', state);
        sent += 1;
      } catch {
        member.close();
      }
    }
    return sent;
  }

  async function roomFor(target, resolveTarget) {
    const key = target.canonicalPath;
    const claim = captureAdmission(target);
    const identity = target.identity ?? identityAt(key);
    const retired = () => isRetired({ rootId: target.rootId, logicalPath: target.logicalPath, canonicalPath: key });
    if (retired()) throw new LocalAuthorityError('moved', `document is retired for ${key}`);
    if (targetClaims.has(target) && !isCurrentTarget(target)) {
      throw new LocalAuthorityError('moved', `admission for ${key} is no longer valid`);
    }
    const warm = rooms.get(key);
    // open() on a room that already exists only revives it (emptySince null), so
    // a connected editor keeps its sequence across a sweep window.
    if (warm && String(warm.nodeId) === String(identity)) return rooms.open(key, '');
    if (!warm && (rooms.size() >= core.LIVE_LIMITS.rooms || !rooms.mayFit(key))) return null;

    return withDocument(resolveTarget, async (currentTarget, token) => {
      const currentPath = currentTarget?.canonicalPath;
      if (typeof currentPath !== 'string' || !currentPath) {
        throw new LocalAuthorityError('not-found', `no document for ${key}`);
      }
      if (currentPath !== key) throw new LocalAuthorityError('moved', `document moved from ${key}`);
      if (retired()) throw new LocalAuthorityError('moved', `document is retired for ${key}`);
      if (token) {
        validateAdmission(claim, {
          rootId: currentTarget.rootId ?? target.rootId,
          logicalPath: currentTarget.logicalPath ?? target.logicalPath,
          canonicalPath: currentPath,
        }, token);
      }
      const currentIdentity = currentTarget.identity ?? identityAt(currentPath);
      if (currentIdentity != null && identity != null && String(currentIdentity) !== String(identity)) {
        throw new LocalAuthorityError('moved', `document identity changed for ${key}`);
      }
      let nodeId = currentIdentity ?? identity;

      const opened = rooms.get(currentPath);
      if (opened && String(opened.nodeId) === String(nodeId)) return rooms.open(currentPath, '');
      if (!opened && (rooms.size() >= core.LIVE_LIMITS.rooms || !rooms.mayFit(currentPath))) return null;

      let html;
      try {
        html = await readSaved(currentTarget);
      } catch (err) {
        if (err && err.code === 'ENOENT') throw new LocalAuthorityError('not-found', `no saved file for ${key}`);
        throw err;
      }
      if (html === null || html === undefined) throw new LocalAuthorityError('not-found', `no saved file for ${key}`);

      if (nodeId == null) nodeId = recordFor(currentPath).identity;
      recordFor(currentPath).baseline = html;

      const held = rooms.get(currentPath);
      if (held) return rooms.reset(currentPath, html, { nodeId });
      return rooms.open(currentPath, html, { nodeId });
    });
  }

  /** A token bucket the transport shares per canonical file and sender address. */
  function rateLimit(key, { rate = RATE_LIMIT.rate, burst = RATE_LIMIT.burst, idleMs = RATE_LIMIT.idleMs } = {}) {
    const t = now();
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { tokens: burst, at: t, idleMs };
      buckets.set(key, bucket);
    }
    bucket.tokens = Math.min(burst, bucket.tokens + ((t - bucket.at) / 1000) * rate);
    bucket.at = t;
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  function sweep() {
    for (const [key, record] of registry) {
      if (record.members.size) continue;
      const room = rooms.get(key);
      if (room && room.emptySince === null) rooms.leave(room, null, []);
    }
    rooms.sweep((key) => connectedIds(key), { mayExpire: room => checkpointService?.mayExpire?.(room) || !roomIsDirty(room) });
    for (const key of rooms.keys()) {
      const room = rooms.get(key);
      if (room && checkpointService?.mayExpire?.(room) && room.emptySince !== null &&
          now() - room.emptySince >= core.LIVE_LIMITS.retainMs && !connectedIds(key).length &&
          !registry.get(key)?.members.size) rooms.drop(key);
    }
    const t = now();
    for (const [key, bucket] of buckets) if (t - bucket.at > bucket.idleMs) buckets.delete(key);
  }

  function checkpointTargets(canonicalPath) {
    return [...logical.values()].filter((target) => target.canonicalPath === canonicalPath && isCurrentTarget(target));
  }

  function roomIsDirty(room) {
    return core.roomIsDirty(room);
  }

  async function reconcileDisk(target, html, token) {
    assertWriteContext(token, target.canonicalPath);
    const record = registry.get(target.canonicalPath);
    if (!record || record.baseline == null || record.baseline === html) return { kind: 'current' };
    return observeExternal(target, html, token);
  }

  const HTML_PATH = /\.(html?|htmlclay)$/i;

  function broadcastSaved(target, html, sender) {
    const live = target && target.live;
    if (!live || typeof live.broadcast !== 'function') return;
    live.broadcast(target.logicalPath, { html, sender }, { lane: 'saved' });
  }

  const broadcasts = (target) => typeof target?.live?.broadcast === 'function';

  /** One entry per current logical root/path alias of this canonical file, plus the caller's target. */
  function bindingsFor(canonicalPath, extraTarget) {
    const found = new Map();
    const record = registry.get(canonicalPath);
    const keep = (key, target) => {
      const existing = found.get(key);
      if (!existing || (!broadcasts(existing) && broadcasts(target))) found.set(key, target);
    };
    for (const target of logical.values()) {
      if (target.canonicalPath !== canonicalPath) continue;
      if (!record || record.identity !== target.identity) continue;
      keep(`${target.rootId}\n${target.logicalPath}`, target);
    }
    if (extraTarget && extraTarget.canonicalPath === canonicalPath) {
      keep(`${extraTarget.rootId}\n${extraTarget.logicalPath}`, extraTarget);
    }
    return [...found.values()];
  }

  /**
   * Confirm the bytes a caller just persisted at target.canonicalPath, inside that
   * caller's document boundary. It stats only after the write, stamps the one
   * canonical record, reconciles the single open room for HTML and tells each live
   * alias once. It acquires no second gate or file lock; a broadcast failure never
   * undoes the confirmed disk write.
   */
  async function confirmKnownWrite(target, bytes, token, { sender = 'server-save', publish = true, persistentToken = null } = {}) {
    const canonicalPath = target && target.canonicalPath;
    assertWriteContext(token, canonicalPath);

    const staged = stagedTargets.get(target) ?? null;
    if (staged && staged.token !== token) {
      throw new LocalAuthorityError('invalid-reservation', 'staged write target belongs to another document boundary');
    }

    let stat;
    try {
      stat = await fs.promises.stat(canonicalPath, { bigint: true });
    } catch {
      return null;
    }
    const held = registry.get(canonicalPath);
    if (staged && held && held.identity !== target.identity) {
      throw new LocalAuthorityError('moved', `document identity changed for ${canonicalPath}`);
    }
    const record = recordFor(canonicalPath, staged ? target.identity : undefined);
    if (record.recovering) throw new LocalAuthorityError('moved', `recovery is pending for ${canonicalPath}`);
    if (staged) {
      bindLogical(target);
      if (staged.explicitCreate) {
        setAdmission(token, { rootId: target.rootId, logicalPath: target.logicalPath, canonicalPath, active: true });
        targetClaims.set(target, captureAdmission(target));
      }
      stagedTargets.delete(target);
    }
    const stamp = {
      identity: record.identity,
      etag: documentEtag(bytes),
      dev: stat.dev,
      ino: stat.ino,
      size: stat.size,
      mtimeNs: stat.mtimeNs,
    };
    record.confirmed = stamp;
    if (sender !== 'file-watcher') {
      try { await checkpointService?.confirmedWrite?.(canonicalPath, stamp); }
      catch (error) { console.error('[auto-name] failed to confirm write:', error); }
    }
    if (HTML_PATH.test(canonicalPath)) record.baseline = typeof bytes === 'string' ? bytes : bytes.toString('utf8');

    // A binary asset has no live tags to reconcile and no HTML to hand editors.
    if (!HTML_PATH.test(canonicalPath)) return stamp;

    const html = typeof bytes === 'string' ? bytes : bytes.toString('utf8');
    const result = persistentToken
      ? rooms.writtenPersistent(persistentToken, { html })
      : rooms.fileWritten(canonicalPath, html);
    if (result) publishState(canonicalPath);
    checkpointService?.wake(canonicalPath);
    if (publish) {
      for (const binding of bindingsFor(canonicalPath, target)) {
        try {
          broadcastSaved(binding, html, sender);
        } catch (err) {
          console.error('[local-authority] saved broadcast failed:', err && err.message ? err.message : err);
        }
      }
    }
    return stamp;
  }

  /**
   * The last stamp confirmKnownWrite recorded for one canonical file, or null.
   * Read-only: an observation of a file nobody confirmed must not create a
   * record, or every watched path would gain one.
   */
  function confirmedStamp(canonicalPath) {
    return registry.get(canonicalPath)?.confirmed ?? null;
  }

  function detachLogical(binding) {
    const record = registry.get(binding.canonicalPath);
    if (record) {
      for (const member of [...record.members]) {
        if (member.target.rootId === binding.rootId && member.target.logicalPath === binding.logicalPath) member.close();
      }
      for (const snapshot of [...record.snapshots]) {
        if (snapshot.target.rootId === binding.rootId && snapshot.target.logicalPath === binding.logicalPath) snapshot.dispose();
      }
    }
    for (const [key, current] of [...logical]) {
      if (current.rootId === binding.rootId && current.logicalPath === binding.logicalPath) logical.delete(key);
    }
  }

  async function observeExternal(target, html, token, { removed = false } = {}) {
    const key = target.canonicalPath;
    assertWriteContext(token, key);
    const record = registry.get(key);
    const room = rooms.get(key);
    if (removed && !record) {
      for (const binding of [...logical.values()]) {
        if (binding.rootId === target.rootId && binding.logicalPath === target.logicalPath &&
            binding.canonicalPath !== key) detachLogical(binding);
      }
    }
    if (!removed && record && !record.recovering && compatibleContinuation(record.baseline, html, room)) {
      await confirmKnownWrite(target, html, token, { sender: 'file-watcher', publish: false });
      return { kind: 'continuation' };
    }

    const routes = new Map();
    const include = (binding) => {
      const root = roots.get(binding.rootId);
      const rel = normLogical(binding.logicalPath);
      if (root && rel) routes.set(`${root.id}\n${rel}`, { root, rel });
    };
    for (const binding of logical.values()) if (binding.canonicalPath === key) include(binding);
    include(target);
    for (const root of roots.values()) {
      if (within(key, root.canonicalPath) && key !== root.canonicalPath) {
        const rel = normLogical(upath.relative(root.canonicalPath, key));
        routes.set(`${root.id}\n${rel}`, { root, rel });
      }
    }

    const dirty = room && [...room.stores.values()].some((store) =>
      !store.ephemeral && (store.landed === -1 || store.landed !== store.last));
    if (dirty || record?.recovering) {
      if (!record) throw new Error(`Missing recovery record for ${key}`);
      if (!record.recovery) {
        const hold = rooms.holdPersistent(key, { nodeId: room.nodeId });
        record.recovering = true;
        record.recovery = { hold, html: null, published: new Map(), byDirectory: new Map() };
      }
      if (!record.recovery.html) record.recovery.html = renderRecovered(record.baseline, room);
      if (!routes.size) throw new Error(`No recovered-copy destination for ${key}`);
      for (const [routeKey, { root, rel }] of routes) {
        if (record.recovery.published.has(routeKey)) continue;
        const directory = upath.join(root.canonicalPath, '.hyperclay/recovered', rel.replace(/\.(html|htmlclay)$/i, ''));
        let version = record.recovery.byDirectory.get(directory);
        if (!version) {
          const published = await publishRecovered(root.path, rel, record.recovery.html);
          version = `recovered-${published.filename}`;
          record.recovery.byDirectory.set(directory, version);
        }
        record.recovery.published.set(routeKey, version);
      }
    }

    const recovered = record?.recovery?.published.get(`${target.rootId}\n${normLogical(target.logicalPath)}`) ??
      record?.recovery?.published.values().next().value ?? null;
    const oldBindings = record ? bindingsFor(key, target) : [];
    if (record) {
      for (const member of [...record.members]) member.close();
      for (const snapshot of [...record.snapshots]) snapshot.dispose();
      rooms.drop(key);
      if (record.recovery) rooms.releasePersistent(record.recovery.hold);
      registry.delete(key);
      for (const [bindingKey, binding] of [...logical]) if (binding.canonicalPath === key) logical.delete(bindingKey);
    }
    setAdmission(token, { rootId: target.rootId, logicalPath: target.logicalPath, canonicalPath: key, active: false });
    if (!removed) {
      setAdmission(token, { rootId: target.rootId, logicalPath: target.logicalPath, canonicalPath: key, active: true });
      const replacement = bindTarget(target);
      await confirmKnownWrite(replacement, html, token, { sender: 'file-watcher', publish: false });
    }
    for (const binding of oldBindings) {
      if (target.live && binding.rootId === target.rootId && binding.logicalPath === target.logicalPath) continue;
      const live = binding.live;
      if (!live || typeof live.notify !== 'function') continue;
      const version = record?.recovery?.published.get(`${binding.rootId}\n${normLogical(binding.logicalPath)}`) ?? recovered;
      try {
        live.notify(binding.logicalPath, {
          msgType: 'warning', msg: `${upath.basename(binding.logicalPath)} changed on disk outside this tab`,
          action: 'reload',
          data: { kind: 'external-change', sender: 'file-system', reason: 'external-replacement',
            ...(version && { recovered: version }) },
        });
      } catch (error) {
        console.error('[local-authority] replacement notification failed:', error && error.message ? error.message : error);
      }
    }
    if (removed) return { kind: 'removal', recovered };
    return { kind: 'replacement', recovered };
  }

  async function observeRemovedPrefix(rootId, logicalPath, canonicalPath, token) {
    assertStructureContext(token);
    setAdmission(token, { rootId, logicalPath, canonicalPath, active: false, prefix: true });
    const targets = new Map();
    for (const binding of logical.values()) {
      if (binding.rootId === rootId && within(normLogical(binding.logicalPath), normLogical(logicalPath))) {
        if (!within(binding.canonicalPath, canonicalPath)) {
          detachLogical(binding);
          continue;
        }
        targets.set(binding.canonicalPath, binding);
      }
    }
    const root = roots.get(rootId);
    for (const key of registry.keys()) {
      if (!within(key, canonicalPath) || targets.has(key)) continue;
      targets.set(key, {
        rootId, logicalPath: root ? upath.relative(root.canonicalPath, key) : logicalPath,
        canonicalPath: key,
      });
    }
    for (const target of targets.values()) await observeExternal({ ...target, live: null }, null, token, { removed: true });
  }

  function registerRoot(root = {}, { owner = 'server' } = {}) {
    if (typeof root.id !== 'string' || !root.id) throw new Error('registerRoot requires root id');
    const canonicalPath = root.canonicalPath ?? root.path;
    if (typeof canonicalPath !== 'string' || !canonicalPath) throw new Error('registerRoot requires canonical root path');
    const existing = roots.get(root.id);
    if (existing) {
      // A root that resolves elsewhere is a different registration; replacing it
      // would silently retarget every alias that relied on the old canonical path.
      if (existing.canonicalPath !== canonicalPath) {
        throw new Error(`registerRoot refuses to retarget ${root.id} to ${canonicalPath}`);
      }
      existing.owners.add(owner);
      return { id: existing.id, canonicalPath: existing.canonicalPath };
    }
    const entry = {
      id: root.id,
      canonicalPath,
      path: root.path ?? canonicalPath,
      incarnation: ++rootIncarnation,
      owners: new Set([owner]),
    };
    roots.set(root.id, entry);
    return { id: entry.id, canonicalPath: entry.canonicalPath };
  }

  function closeRoot(rootId, { owner = 'server' } = {}) {
    const entry = roots.get(rootId);
    if (entry) {
      entry.owners.delete(owner);
      // Another writer still needs this root's registration, logical bindings and
      // rooms: the server stopping must not drop a running sync session's root.
      if (entry.owners.size > 0) return;
    }
    roots.delete(rootId);
    for (const [key, target] of [...logical]) if (target.rootId === rootId) logical.delete(key);
    for (const record of registry.values()) {
      for (const member of [...record.members]) if (member.target.rootId === rootId) member.close();
      for (const snapshot of [...record.snapshots]) if (snapshot.target.rootId === rootId) snapshot.dispose();
    }
  }

  return {
    rooms,
    setCheckpointService(service) { checkpointService = service; },
    roomIsDirty,
    checkpointTargets,
    reconcileDisk,
    bindTarget,
    admitWriteTarget,
    findBoundTarget,
    isCurrentTarget,
    identityAt,
    registerSnapshot,
    registerEditor,
    currentEditor,
    newestEditor,
    connectedIds,
    markParticipating,
    hasParticipatingEditors,
    wakeCheckpoint(key) { checkpointService?.wake(key); },
    hasUnjoinedEditors,
    roomFor,
    publish,
    publishState,
    rateLimit,
    sweep,
    registerRoot,
    closeRoot,
    confirmKnownWrite,
    confirmedStamp,
    observeExternal,
    observeRemovedPrefix,
    setAdmission,
    isRetired,
    captureAdmission,
    validateAdmission,
    prepareStructure,
    releaseStructure,
    commitStructure,
  };
}

module.exports = { createLocalAuthority, LocalAuthorityError };
