// clay.conflicts before the conflict ledger has loaded. No merge has happened, so
// there are no conflicts: reads answer empty, writes have nothing to act on, and a
// context resolver registered now is handed to the ledger when it loads. Once loaded,
// every member delegates, so the object a page holds never changes.
let ledger = null;
let loading = null;
const resolvers = new Map();

export function loadConflicts() {
  loading ??= Promise.all([import('./conflicts.js'), import('./conflict-footprints.js')]).then(([c, f]) => {
    ledger = { ...c, beginLineageCapture: f.beginLineageCapture };
    // The unregister the real registry handed back, so a resolver the page drops
    // before or after the download leaves the ledger's registry alike.
    for (const resolver of [...resolvers.keys()]) resolvers.set(resolver, c.registerContext(resolver));
    return ledger;
  });
  return loading;
}

export const conflictLedger = () => ledger;

export const conflicts = {
  get size() { return ledger ? ledger.conflicts.size : 0; },
  list() { return ledger ? ledger.conflicts.list() : []; },
  get(id) { return ledger ? ledger.conflicts.get(id) : null; },
  acknowledge(ids, options = {}) {
    if (ledger) return ledger.conflicts.acknowledge(ids, options);
    if (!Array.isArray(ids)) throw new TypeError('clay.conflicts.acknowledge needs an array of ids');
    return { removedIds: [], remainingIds: [] };
  },
  claim(ids, options = {}) {
    if (ledger) return ledger.conflicts.claim(ids, options);
    if (!options.owner) throw new TypeError('clay.conflicts.claim needs an owner');
    return { release() {} };
  },
  registerContext(resolver) {
    if (ledger) return ledger.conflicts.registerContext(resolver);
    if (typeof resolver !== 'function') throw new TypeError('clay.conflicts.registerContext needs a resolver function');
    resolvers.set(resolver, null);
    return () => {
      const registered = resolvers.get(resolver);
      resolvers.delete(resolver);
      if (registered) registered();
    };
  },
  contextFor(rec, apply) { return ledger ? ledger.conflicts.contextFor(rec, apply) : null; },
  recoveryOf(id) { return ledger ? ledger.conflicts.recoveryOf(id) : null; },
  hasPendingApply() { return ledger ? ledger.conflicts.hasPendingApply() : false; },
};
