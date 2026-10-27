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

// A copy opens through the article rebuild, so it carries the projected article
// and no page store: the merge state is the host's, never the file's.
// The one page tag is removed from the captured text as it was written there; a
// tag that cannot be found exactly once leaves the capture as it is.
function withoutPageTag(html) {
  let doc;
  try { doc = new DOMParser().parseFromString(html, "text/html"); } catch { return html; }
  const tags = [...doc.querySelectorAll('script[type="application/json"][merge="page"][clay~="live"]')]
    .filter((el) => !el.closest("template") && !el.closest("noscript"));
  if (tags.length !== 1) return html;
  const outer = tags[0].outerHTML;
  const at = html.indexOf(outer);
  if (at < 0 || html.indexOf(outer, at + 1) !== -1) return html;
  return html.slice(0, at) + html.slice(at + outer.length);
}

// One complete, openable file: the capture the save would have sent, with the
// page projection already applied by the live store's snapshot listener, and
// without the page editor's merge state, which no saved file or download carries.
function downloadPageCopy() {
  const { forSave } = captureForSaveAndComparison();
  return downloadHtml({ html: withoutPageTag(forSave), name: `${documentName()}.html` });
}

// A copy of the page captured earlier (captureForSaveAndComparison().forSave), as a download.
function downloadSnapshot(forSave) {
  return downloadHtml({ html: withoutPageTag(forSave), name: `${documentName()}.html` });
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

export { SAVE_STATE_BY_CODE, BLOCKED_TEXT, RETRY_TEXT, saveStateFor, downloadPageCopy, downloadSnapshot, copyPageText };
