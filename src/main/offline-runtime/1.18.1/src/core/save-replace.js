// One conditional save of bytes this page did not build: the upgrade path's write
// (plan 05, Step 6). It is deliberately not part of the save core every editor
// loads. There is no capture, no beforeSave, no snapshot and no retry: the bytes
// handed in are the whole document, already composed by the caller, and the only
// question this answers is whether the host took them.
//
// It speaks through the same request builder as every other save, so the endpoint,
// the headers and the token route are the save lane's own. `If-Match` comes from the
// caller (the stamp the page was loaded with or last saved at) and falls back to the
// tab's stamp. A host that did not announce `conditional` gets no request at all:
// without the capability the header means nothing, and a write this large is not
// worth sending to a host that cannot refuse it.
import { buildSaveRequest, mintSaveId } from "./save-core.js";
import { conditionalSaves, lastSeenEtag, recordEtag, seedEtag } from "./etag.js";

const TIMEOUT_MS = 30000;

function failed() {
  return { ok: false, code: "failed" };
}

/**
 * Save exactly `html` over the document, conditional on the version it replaces.
 *
 * @param {string} html - the whole document, as it should be stored
 * @param {Object} [options]
 * @param {?string} [options.etag] - the stamp to replace, defaulting to this tab's
 * @returns {Promise<{ok: true, etag: ?string}|{ok: false, code: "conflict"|"forbidden"|"unsupported"|"failed"}>}
 */
export async function replace(html, { etag } = {}) {
  if (typeof html !== "string" || html === "") return failed();

  const given = typeof etag === "string" && etag ? etag : null;
  // Discovery is what says whether the capability exists, and it is also where a
  // tab that has never saved learns the stamp it is about to replace.
  if (!conditionalSaves()) await seedEtag();
  if (!conditionalSaves()) return { ok: false, code: "unsupported" };

  // With no stamp the write would be unconditional, which is exactly what this lane
  // promises never to send. A reload gives the tab the stamp it is missing.
  const stamp = given || lastSeenEtag();
  if (!stamp) return { ok: false, code: "conflict" };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const { url, options } = buildSaveRequest(html, true, controller.signal, mintSaveId(), stamp);
    const res = await fetch(url, options);
    const text = await res.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (_) {
        data = {};
      }
    }
    if (!res.ok) {
      if (res.status === 412) return { ok: false, code: "conflict" };
      if (res.status === 401 || res.status === 403) return { ok: false, code: "forbidden" };
      return failed();
    }
    const stored = typeof data.etag === "string" && data.etag ? data.etag : null;
    // The write landed, so the stamp it replaced describes bytes the host no longer
    // stores: the answer's own stamp is the one this tab holds from here on.
    recordEtag(stored);
    return { ok: true, etag: stored };
  } catch (_) {
    return failed();
  } finally {
    clearTimeout(timeoutId);
  }
}
