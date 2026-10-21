import { captureForSaveAndComparison } from "../core/snapshot.js";
import { downloadHtml, documentName } from "../core/conflict-download.js";

// One plain state per save refusal code, so the indicator, the toast and the
// page plugin all read the same answer. `saved` is the only happy one; every
// code a failed save or a live notice can carry is either worth another try on
// its own (retrying) or needs a person to do something (blocked). A code this
// table does not know falls to `error`, which leaves the existing generic
// "Couldn't save" feedback exactly as it was.
const SAVE_STATE_BY_CODE = Object.freeze({
  "page-converting": "retrying",
  "page-capacity": "retrying",
  busy: "retrying",
  "rate-limited": "retrying",
  offline: "retrying",
  network: "retrying",
  "network-error": "retrying",
  timeout: "retrying",
  "save-history-pending": "retrying",
  "page-condition-required": "blocked",
  "page-conversion-refused": "blocked",
  "page-conversion-required": "blocked",
  "page-conversion-stale": "blocked",
  "save-id-reused": "blocked",
  "too-large": "blocked",
  "unsupported-host": "blocked",
  "save-history-refresh-required": "blocked",
  "provenance-unsupported": "blocked",
  "receipt-expired": "blocked",
});

const BLOCKED_TEXT = "Can't save here. Your edits are still in this tab.";
const RETRY_TEXT = "Still trying to save. Your edits are safe in this tab.";

function saveStateFor({ ok = false, code = null, offline = false } = {}) {
  if (ok) return "saved";
  if (offline) return "retrying";
  return SAVE_STATE_BY_CODE[code] ?? "error";
}

// One complete, openable file: the capture the save would have sent, with the
// page projection already applied by the live store's snapshot listener. The
// saved article and the page store travel together, so a person can read the
// document or hand it back.
function downloadPageCopy() {
  const { forSave } = captureForSaveAndComparison();
  return downloadHtml({ html: forSave, name: `${documentName()}.html` });
}

// The article's own plain text, never the editor's chrome: the capture carries
// the projected article, and only its text is asked for.
async function copyPageText() {
  try {
    const { forSave } = captureForSaveAndComparison();
    const doc = new DOMParser().parseFromString(forSave, "text/html");
    const articles = doc.querySelectorAll("article[data-page]");
    if (articles.length !== 1) return false;
    await navigator.clipboard.writeText(articles[0].textContent);
    return true;
  } catch {
    return false;
  }
}

export { SAVE_STATE_BY_CODE, BLOCKED_TEXT, RETRY_TEXT, saveStateFor, downloadPageCopy, copyPageText };
