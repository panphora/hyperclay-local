/**
 * message.js — send a visitor's form to the document's owner (the host's `/_/message`).
 *
 *   <form message-form="Thanks, I'll reply soon"> ... </form>
 *   const result = await clay.message.send({ email, note });   // { ok, error }
 *
 * Any form carrying `message-form`, or whose `action` is `/_/message`, is sent by
 * script on submit: its fields as JSON, with the `Document-URL` header so the host
 * knows whose document it came from. The form resets, the attribute's text shows
 * as a toast, and `clay:message-sent` or `clay:message-failed` fires on the form.
 * Cancel that event to draw your own confirmation instead of the toast.
 *
 * The bot check. The host refuses a message that carries no token from
 * `GET /_/form-token`, so a bot that posts without running the page sends nothing.
 * The token is fetched the first time the visitor focuses or types inside a
 * message form (an untouched form costs no request), and again at submit when it
 * is missing or old. Each token is used once. `formSignals` counts trusted
 * events and reads `navigator.webdriver`; the host only logs it.
 *
 * `send` never rejects, matching upload: one result shape from every exit.
 */

import getDataFromForm from "../dom/form-data.js";

const MESSAGE_PATH = "/_/message";
const TOKEN_PATH = "/_/form-token";
// The host accepts a token for two hours; refetch well before that.
const TOKEN_MAX_AGE_MS = 90 * 60 * 1000;

const TRUSTED_EVENTS = ["click", "keydown", "pointerdown", "touchstart", "input", "change"];
const trusted = Object.fromEntries(TRUSTED_EVENTS.map((type) => [type, 0]));

let token = null;
let tokenAt = 0;
let tokenRequest = null;
const sending = new WeakSet();

function fetchToken() {
  if (!tokenRequest) {
    tokenRequest = fetch(TOKEN_PATH, { credentials: "omit", cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (body && typeof body.token === "string") {
          token = body.token;
          tokenAt = Date.now();
        }
      })
      .catch(() => {})
      .finally(() => {
        tokenRequest = null;
      });
  }
  return tokenRequest;
}

async function takeToken() {
  if (!token || Date.now() - tokenAt > TOKEN_MAX_AGE_MS) await fetchToken();
  const taken = token;
  token = null;
  return taken;
}

function signals() {
  return { webdriver: navigator.webdriver === true, trusted: { ...trusted } };
}

function isMessageForm(form) {
  if (!(form instanceof HTMLFormElement)) return false;
  if (form.hasAttribute("message-form")) return true;
  const action = form.getAttribute("action");
  if (!action) return false;
  try {
    const url = new URL(action, window.location.href);
    return url.origin === window.location.origin && url.pathname === MESSAGE_PATH;
  } catch {
    return false;
  }
}

/**
 * Send one message to the document's owner.
 *
 * @param {Object} data - the fields, as the owner should read them
 * @returns {Promise<{ok: boolean, error: ?string}>}
 */
export async function send(data = {}) {
  const result = await post(data);
  // The host refused the token itself (it restarted, or the token expired): one fresh token,
  // one more try, and the visitor never knows.
  if (result.code === "form-token") return post(data);
  return result;
}

async function post(data) {
  const formToken = await takeToken();
  let res;
  try {
    res = await fetch(MESSAGE_PATH, {
      method: "POST",
      // A signed-in owner testing their own form must not trip the host's CSRF
      // guard, and the message never needs the visitor's cookies.
      credentials: "omit",
      headers: { "Content-Type": "application/json", "Document-URL": window.location.href },
      body: JSON.stringify({ ...data, formToken, formSignals: signals() }),
    });
  } catch {
    return { ok: false, error: "The message couldn't be sent. Check your connection and try again." };
  }
  const body = await res.json().catch(() => null);
  // A host without the message endpoint can answer any path with its HTML page at 200.
  if (res.ok) return body ? { ok: true, error: null } : { ok: false, error: "This page can't send messages." };
  if (!body) return { ok: false, error: `The message couldn't be sent (${res.status}).` };
  const error = body.error || body.msg || `The message couldn't be sent (${res.status}).`;
  return body.code === "form-token" ? { ok: false, error, code: "form-token" } : { ok: false, error };
}

async function onSubmit(event) {
  const form = event.target;
  if (event.defaultPrevented || !isMessageForm(form)) return;
  event.preventDefault();
  if (sending.has(form)) return;
  sending.add(form);
  try {
    const result = await send(getDataFromForm(form));
    if (result.ok) form.reset();
    const outcome = new CustomEvent(result.ok ? "clay:message-sent" : "clay:message-failed", {
      bubbles: true,
      cancelable: true,
      detail: result,
    });
    if (!form.dispatchEvent(outcome)) return;
    const toast = window.clay?.toast;
    if (!toast) return;
    if (result.ok) toast(form.getAttribute("message-form") || "Sent", "success");
    else toast(result.error, "error");
  } finally {
    sending.delete(form);
  }
}

function warmToken(event) {
  if (token || tokenRequest) return;
  const form = event.target?.closest?.("form");
  if (form && isMessageForm(form)) fetchToken();
}

if (typeof document !== "undefined") {
  for (const type of TRUSTED_EVENTS) {
    document.addEventListener(type, (event) => {
      if (event.isTrusted) trusted[type]++;
    }, { capture: true, passive: true });
  }
  document.addEventListener("focusin", warmToken, true);
  document.addEventListener("input", warmToken, true);
  document.addEventListener("submit", onSubmit);
}

export const message = { send };
export default message;
