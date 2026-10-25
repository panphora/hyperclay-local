// Optional editor features load the first time a document needs them. One import per
// feature; a caller's abort stops only its own wait; dispose() makes late results inert.
export function createFeatureLoader({ load, install, reportError = (error) => console.error("clayjs: an editor feature failed to load", error) }) {
  const installed = new Map();
  const pending = new Map();
  const prepared = new Map();
  let disposed = false;

  // A preparation fetches the module without installing it, so the boot can overlap
  // that fetch with the room join. The install that follows consumes this same
  // import: a feature is fetched once, and a failed fetch is that attempt. The next
  // ensure after it loads again through the loader's reporting and the feature's
  // Retry.
  function prepare(id) {
    if (disposed) return Promise.reject(new Error(`page: feature loader disposed before ${id}`));
    let shared = prepared.get(id);
    if (!shared) {
      shared = Promise.resolve(load(id));
      prepared.set(id, shared);
      // The install reports the failure; this keeps an unconsumed preparation quiet.
      shared.catch(() => {});
    }
    return shared;
  }

  function loadFor(id) {
    const fetched = prepared.get(id);
    if (!fetched) return load(id);
    prepared.delete(id);
    return fetched;
  }

  function ensure(id, { signal } = {}) {
    if (disposed) return Promise.reject(new Error(`page: feature loader disposed before ${id}`));
    if (installed.has(id)) return Promise.resolve(installed.get(id));
    let shared = pending.get(id);
    if (!shared) {
      shared = loadFor(id)
        .then((mod) => (disposed ? null : Promise.resolve(install(id, mod))))
        .then((feature) => {
          if (disposed) {
            feature?.dispose?.();
            return feature;
          }
          installed.set(id, feature);
          return feature;
        });
      shared.catch((error) => { if (!disposed) reportError(error, id); }).finally(() => pending.delete(id));
      pending.set(id, shared);
    }
    if (!signal) return shared;
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      shared.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
    });
  }

  return {
    prepare,
    ensure,
    has: (id) => installed.has(id),
    dispose() {
      disposed = true;
      for (const feature of installed.values()) feature?.dispose?.();
      installed.clear();
      pending.clear();
      prepared.clear();
    },
  };
}
