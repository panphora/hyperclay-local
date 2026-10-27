/**
 * host-meta.js — what this host can do (spec §5).
 *
 * The first discovery client clayjs has had. Not fetched at boot by core: the first
 * caller is the first file pick, or the people plugin when a page asks for it, so a
 * page that uses neither never asks.
 *
 * The spec's own rule about what counts as an answer is deliberately strict on
 * the way in and forgiving on the way out. Only a 2xx carrying a JSON object with
 * a numeric `spec` is a capability document. A 404, an HTML error page from a
 * proxy, a redirect, a body that will not parse: all of them mean "bare core
 * host", and a bare core host is fully conforming. Discovery failing must never
 * cost a person their save, so this never throws and never rejects.
 */

import { saveToken } from "./host-attrs.js";
import { isDraftMode } from "./is-edit-mode.js";

const META_PATH = "/_/meta";
const META_TIMEOUT_MS = 6000;

// How each answer came about, kept beside the answer rather than on it so its
// shape never changes. "ok": a capability document. "none": no discovery on offer
// (a 404, a file nobody is serving, a server that has never heard of the spec).
// "failed": a host that should have answered did not (a 5xx, a timeout, a dropped
// connection). Save and upload treat the last two alike; people must not, because
// a host that failed to say who you are has not said you are nobody.
const outcomes = new WeakMap();

// The path each answer was fetched for, captured when that fetch started. A document block
// describes one document, and a reply that lands after a route change answers for the one
// that asked.
const paths = new WeakMap();

// Which fetch produced each answer, counted from 1 in the order the fetches started. An
// answer that lands late is still older than one that started later.
const orders = new WeakMap();
let fetches = 0;

function settle(outcome, meta = bareHost(), asked = null, order = null) {
  outcomes.set(meta, outcome);
  if (asked !== null) paths.set(meta, asked);
  if (order !== null) orders.set(meta, order);
  return meta;
}

/**
 * How the discovery that produced `meta` ended: "ok", "none" or "failed".
 *
 * @param {Object} meta - an answer from hostMeta()
 * @returns {"ok"|"none"|"failed"}
 */
export function hostMetaOutcome(meta) {
  return outcomes.get(meta) ?? "none";
}

/**
 * The path the fetch behind `meta` started on, or undefined when there is none.
 *
 * @param {Object} meta - an answer from hostMeta()
 * @returns {string|undefined}
 */
export function hostMetaPath(meta) {
  return paths.get(meta);
}

/**
 * Which fetch produced `meta`, counting from 1 in the order the fetches started, or 0 when none did.
 *
 * @param {Object} meta - an answer from hostMeta()
 * @returns {number}
 */
export function hostMetaOrder(meta) {
  return orders.get(meta) ?? 0;
}

// The bare-core-host answer, which is also every failure's answer.
function bareHost() {
  return { spec: null, extensions: [], document: null };
}

let inFlight = null;
let refreshing = null;

/**
 * Ask the host what it supports, once per page.
 *
 * Memoizes the PROMISE rather than the value, so two pickers opened together
 * make one request instead of two and the second waits on the first.
 *
 * `spec` and `extensions` describe the host and never change under a loaded
 * document, which is why one answer serves the whole page. The `document` block
 * does change: its `etag` ticks on every save, by anyone. A caller that needs a
 * current one passes `fresh`, which asks again and replaces the memoized answer
 * unless it failed where an earlier one succeeded, and concurrent fresh callers
 * still share one request.
 *
 * @param {Object} [options]
 * @param {boolean} [options.fresh]
 * @returns {Promise<{spec: ?number, extensions: string[], document: ?Object}>}
 */
export function hostMeta({ fresh = false } = {}) {
  if (isDraftMode) return Promise.resolve(bareHost());
  if (!fresh) {
    if (!inFlight) inFlight = fetchMeta().catch(bareHost);
    return inFlight;
  }
  if (!refreshing) {
    const previous = inFlight;
    refreshing = fetchMeta().catch(bareHost).finally(() => { refreshing = null; });
    // The caller that asked for a fresh answer gets it, failure and all. The page keeps its
    // last good answer: one 502 during a deploy must not turn uploads off for the session.
    inFlight = refreshing.then(async (meta) => {
      if (hostMetaOutcome(meta) === "ok" || !previous) return meta;
      const last = await previous;
      return hostMetaOutcome(last) === "ok" ? last : meta;
    });
  }
  return refreshing;
}

/**
 * True when the host announced this capability by name.
 *
 * §5: a client must not infer a host's capabilities any other way. Not from the
 * hostname, not from the port, not by probing a route to see whether it answers.
 *
 * @param {string} name
 * @returns {Promise<boolean>}
 */
export async function hostSupports(name) {
  const meta = await hostMeta();
  return meta.extensions.includes(name);
}

/**
 * The page format this host enforces: 1 when it announced `page-format-v1`,
 * otherwise 0.
 *
 * A host announces that extension only once its floor enforcement and tolerant
 * checkpoint renderer are installed, so a host that cannot hold the floor keeps
 * the newer writers off. The answer comes from the memoized discovery: one
 * answer serves every asker under a loaded document.
 *
 * @returns {Promise<number>}
 */
export async function hostPageFormat() {
  const meta = await hostMeta();
  return meta.extensions.includes("page-format-v1") ? 1 : 0;
}

/**
 * Where this host serves the page state of one accepted version, or null.
 *
 * Two things have to be true: the host announced `page-recovery-v1` by name, and its
 * document block named the resource as `pageState.href`. A host that has the resource
 * but has not announced the extension is still launching it, and a client that inferred
 * either one from the other would retire journaled work against a pair nobody promised.
 * Absent, empty or not a string is null, which means no conditional read and no proof
 * from one: the records stay.
 *
 * @returns {Promise<?string>}
 */
export async function hostPageStateHref() {
  const meta = await hostMeta();
  if (!meta.extensions.includes("page-recovery-v1")) return null;
  return meta.document?.pageState?.href || null;
}

/**
 * Whether this host keeps a version history a person can go back to.
 *
 * The `document` block names it: absent means no history, which is the answer every
 * host gave before the field existed. Read through discovery like every other
 * capability, never inferred from the hostname or a probed route.
 *
 * @returns {Promise<boolean>}
 */
export async function hostVersions() {
  const meta = await hostMeta();
  return meta.document?.versions === true;
}

/** Drop the memoized answer. Tests only. */
export function resetHostMeta() {
  inFlight = null;
  refreshing = null;
}

/**
 * Ask the host what became of one identified save.
 *
 * The same discovery document answers it, but this is a separate request with its
 * own abort timer: it must not share the memoized discovery promise, must not
 * update the cached document, and must not record any ETag. Two concurrent
 * questions get two independent answers.
 *
 * The host must have advertised `save-history`, the response must be a spec
 * document that still advertises it, and the echoed id and hash must match this
 * question exactly. Anything else, including a network failure or a timeout at
 * six seconds, is null; a wrong or missing answer is never read as "not applied".
 *
 * @param {Object} query
 * @param {string} query.saveId
 * @param {string} query.requestHash
 * @param {AbortSignal} [query.signal]
 * @returns {Promise<?{saveId: string, requestHash: string, status: "applied"|"unknown"}>}
 */
export async function querySaveOutcome({ saveId, requestHash, signal } = {}) {
  if (isDraftMode) return null;
  if (typeof saveId !== 'string' || !saveId) return null;
  if (typeof requestHash !== 'string' || !requestHash) return null;
  if (!/^https?:$/.test(window.location.protocol)) return null;
  if (signal?.aborted) return null;

  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeoutId = setTimeout(abort, META_TIMEOUT_MS);
  signal?.addEventListener('abort', abort);
  try {
    const meta = await hostMeta();
    if (hostMetaOutcome(meta) !== 'ok' || !meta.extensions.includes('save-history')) return null;
    if (controller.signal.aborted) return null;

    const token = saveToken();
    const path = token ? `${META_PATH}/${token}` : META_PATH;
    const res = await fetch(new URL(path, window.location.origin).href, {
      method: 'GET',
      credentials: token ? 'omit' : 'same-origin',
      headers: {
        'Document-URL': window.location.href,
        'Save-ID': saveId,
        'Save-Request-Hash': requestHash
      },
      cache: 'no-store',
      redirect: 'manual',
      signal: controller.signal
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text) return null;

    let body;
    try {
      body = JSON.parse(text);
    } catch (_) {
      return null;
    }
    if (!body || typeof body !== 'object' || typeof body.spec !== 'number') return null;
    if (!Array.isArray(body.extensions) || !body.extensions.includes('save-history')) return null;
    const outcome = body.document && typeof body.document === 'object' ? body.document.saveOutcome : null;
    if (!outcome || typeof outcome !== 'object') return null;
    if (outcome.saveId !== saveId || outcome.requestHash !== requestHash) return null;
    if (outcome.status !== 'applied' && outcome.status !== 'unknown') return null;

    return { saveId, requestHash, status: outcome.status };
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', abort);
  }
}

async function fetchMeta() {
  const asked = location.pathname;
  const order = ++fetches;
  // A file opened from disk has no host to ask, and fetch would only throw.
  if (!/^https?:$/.test(window.location.protocol)) return settle("none", bareHost(), asked, order);

  const token = saveToken();
  // A host that mints tokens answers discovery per token, because on a sandboxed
  // document the token is the only identity there is: the browser gives it an
  // opaque origin, so it holds no cookie and gets the answer any stranger would.
  // Without this the `document` block, which carries whether this person may
  // upload and how large a file the host takes, is unreachable on exactly the
  // hosts that mint tokens.
  const path = token ? `${META_PATH}/${token}` : META_PATH;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), META_TIMEOUT_MS);
  try {
    const res = await fetch(new URL(path, window.location.origin).href, {
      method: "GET",
      // Same rule as the save lane. The token IS the credential, and a host that
      // mints per-document tokens must never send Access-Control-Allow-Credentials
      // back, so asking for cookies gets the answer blocked before it is read.
      credentials: token ? "omit" : "same-origin",
      headers: { "Document-URL": window.location.href },
      cache: "no-store",
      // A redirect is not an answer (§5), and following one would send the
      // Document-URL header somewhere this host did not choose.
      redirect: "manual",
      signal: controller.signal
    });
    if (!res.ok) return settle(res.status >= 500 ? "failed" : "none", bareHost(), asked, order);
    const text = await res.text();
    if (!text) return settle("none", bareHost(), asked, order);

    let body;
    try {
      body = JSON.parse(text);
    } catch (_) {
      return settle("none", bareHost(), asked, order);
    }
    if (!body || typeof body !== "object" || typeof body.spec !== "number") return settle("none", bareHost(), asked, order);

    return settle("ok", {
      spec: body.spec,
      extensions: Array.isArray(body.extensions) ? body.extensions : [],
      document: body.document && typeof body.document === "object" ? body.document : null
    }, asked, order);
  } catch (_) {
    return settle("failed", bareHost(), asked, order);
  } finally {
    clearTimeout(timeoutId);
  }
}
