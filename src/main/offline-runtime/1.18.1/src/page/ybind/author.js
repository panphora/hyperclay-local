const POINTER = "clay.page.author";
const OWNED = "clay.page.author.owned.";

const mint = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export function authorIdentity(storage = globalThis.localStorage) {
  try {
    const owned = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && key.startsWith(OWNED)) owned.push(key.slice(OWNED.length));
    }
    let token = storage.getItem(POINTER);
    if (!token || !owned.includes(token)) {
      token = mint();
      storage.setItem(OWNED + token, "1");
      storage.setItem(POINTER, token);
      owned.push(token);
    }
    return { token, owned: owned.sort() };
  } catch {
    const token = mint();
    return { token, owned: [token] };
  }
}
