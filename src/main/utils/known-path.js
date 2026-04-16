function makeIsKnownPath(syncEngine, fsModule) {
  return (name, filePath) => {
    if (!syncEngine || !syncEngine.isRunning) return true;
    try {
      if (!fsModule.existsSync(filePath)) return true;
    } catch {
      return true;
    }
    return syncEngine.repo && syncEngine.repo.getByPath(name) !== null;
  };
}

module.exports = { makeIsKnownPath };
