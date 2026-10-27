// Browser storage for one document. Two documents on one origin (every file on a
// hyperclay.com subdomain) otherwise share every key an app writes.
export const docKey = (key) => `clay:doc:${location.pathname}:${key}`;

function area(name) {
  const memory = new Map();
  // Keys whose last write or removal could not reach the backend. Memory holds
  // the authoritative value (or the removal) for them until one write lands.
  const overrides = new Set();
  const prefix = () => docKey("");
  const backend = () => { try { return window[name] || null; } catch { return null; } };
  return {
    get(key) {
      const k = prefix() + key;
      if (!overrides.has(k)) {
        try { const raw = backend()?.getItem(k); if (raw != null) return JSON.parse(raw); } catch {}
      }
      return memory.has(k) ? memory.get(k) : undefined;
    },
    set(key, value) {
      const k = prefix() + key;
      memory.set(k, value);
      try { backend().setItem(k, JSON.stringify(value)); overrides.delete(k); return true; } catch { overrides.add(k); return false; }
    },
    remove(key) {
      const k = prefix() + key;
      memory.delete(k);
      try { backend().removeItem(k); overrides.delete(k); } catch { overrides.add(k); }
    },
  };
}

export const storage = { local: area("localStorage"), session: area("sessionStorage") };
