// One-shot proof of the mode this tab was in, written just before a reload and read
// once, at the top of is-edit-mode.js. It is a hint, like the cookie: the host still
// authorizes every save.
import { docKey } from "../lib/doc-storage.js";

const key = () => docKey("mode-receipt");
const MAX_AGE_MS = 30000;

function navigationType() {
  try { return performance.getEntriesByType("navigation")[0]?.type ?? null; } catch { return null; }
}

export function takeReceipt() {
  let raw = null;
  try { raw = sessionStorage.getItem(key()); sessionStorage.removeItem(key()); } catch { return null; }
  if (!raw) return null;
  let receipt;
  try { receipt = JSON.parse(raw); } catch { return null; }
  if (receipt?.v !== 1 || receipt.path !== location.pathname) return null;
  if (receipt.mode !== "edit" && receipt.mode !== "view") return null;
  if (Date.now() - receipt.at > MAX_AGE_MS) return null;
  if (!receipt.internal && navigationType() !== "reload") return null;
  return receipt;
}

export function writeReceipt({ mode, canEdit, internal }) {
  try {
    sessionStorage.setItem(key(), JSON.stringify({ v: 1, path: location.pathname, mode, canEdit, at: Date.now(), internal }));
  } catch {}
}
