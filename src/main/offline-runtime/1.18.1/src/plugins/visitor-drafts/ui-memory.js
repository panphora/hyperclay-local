export function createUiMemory(draftKey, storage) {
  const key = `${draftKey}:ui`;
  const blank = () => ({ v: 1, prompt: {}, intro: { done: null }, src: null });
  let mem = blank();
  try {
    const parsed = JSON.parse(storage?.getItem(key) || "null");
    if (parsed && typeof parsed === "object" && parsed.v === 1) mem = { ...blank(), ...parsed };
  } catch {}
  return {
    get: () => mem,
    save() { try { storage?.setItem(key, JSON.stringify(mem)); } catch {} },
    reset() { mem = blank(); try { storage?.removeItem(key); } catch {} },
  };
}
