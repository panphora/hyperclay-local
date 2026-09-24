// Guard for the local /save endpoint. Returns false to make /save return 409 when
// the tab's Page-URL claims a path the sync engine knows is stale — preventing a
// ghost node from being uploaded as a fresh file. The three "stale" shapes:
//   - path is tombstoned: the node was renamed/moved away, tab still has old URL
//   - file exists on disk but not in repo: another form of stale path state
// A genuinely new file (no disk file, no tombstone) is allowed so first-save works.
function makeIsKnownPath(manager, fsModule) {
  return (name, filePath, rootId) => {
    const engine = manager?.forRoot?.(rootId) || null;
    if (!engine || !engine.isRunning) return true;
    if (engine.repo && engine.repo.getByPath(name)) return true;
    if (engine.repo && typeof engine.repo.isTombstoned === 'function'
      && engine.repo.isTombstoned(name)) return false;
    try {
      if (!fsModule.existsSync(filePath)) return true;
    } catch {
      return true;
    }
    return false;
  };
}

module.exports = { makeIsKnownPath };
