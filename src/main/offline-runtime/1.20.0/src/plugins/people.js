/**
 * people.js — who is editing, and who wrote what (spec §9, People).
 *
 *   clay.me                        { id, name, initials, color } or null
 *   clay.people.get(id)            always a record; an unknown id is "Unknown person"
 *   clay.people.list()             the people this document names
 *   await clay.people.available()  the host's team for a picker, or null
 *   clay.people.add(person)        record a person in the document; returns the record
 *   clay.people.remove(id)         forget a person the document no longer names
 *   clay.people.canRename()        true when my name was chosen in this browser
 *   clay.people.rename(name)       change that name here and in this page
 *   await clay.author(el, attr?)   stamp el with my id (asks my name once if needed)
 *   event clay:people              the viewer, the team or the registry changed
 *
 * An id is attribution, never authorization: anyone who can edit the page can
 * write any id. Names on screen prefer the host's live answer; the copy stored in
 * the document changes only when that person next writes (author or add), so
 * opening a page never changes its bytes.
 */

import { hostMeta, hostMetaOutcome } from "../core/host-meta.js";
import { isEditMode, modeState } from "../core/is-edit-mode.js";

const editing = () => (window.clay && "isEditMode" in window.clay ? !!window.clay.isEditMode : isEditMode);
import { colorIndexOf, initialsOf } from "../lib/person-face.js";

const ID = /^[A-Za-z0-9_-]{8,64}$/;
const STORE = "clay:people:me";
const BOOT_WAIT_MS = 2000;
const MAX_NAME = 120;
const EMAIL = /\S+@\S+\.\S+/;

let host = { supports: false, me: null, members: null, unavailable: false };
let outcome = null;
let local;
let cache = null;
let asking = null;
let askingRoot = null;
let cancelAsking = null;
let lastRegistry = "";
let dialogLoad = null;

function clean(person) {
  if (!person || typeof person !== "object") return null;
  const id = typeof person.id === "string" ? person.id : "";
  const name = typeof person.name === "string" ? person.name.trim().replace(/\s+/g, " ") : "";
  if (!ID.test(id) || !name || name.length > MAX_NAME || EMAIL.test(name)) return null;
  return { id, name };
}

function record({ id, name }) {
  return Object.freeze({ id, name, initials: initialsOf(name), color: colorIndexOf(id) });
}

function emit() {
  document.dispatchEvent(new CustomEvent("clay:people", { detail: { me: currentMe() } }));
}

function registry() {
  return document.querySelector("[clay-people]");
}

// Every registry counts: two editors whose first comments race can each create one, and a
// merge may keep both.
function entries() {
  return [...document.querySelectorAll("[clay-people] data[value]")];
}

function saved() {
  if (cache) return cache;
  cache = new Map();
  for (const el of entries()) {
    const person = clean({ id: el.getAttribute("value"), name: el.textContent });
    if (person && !cache.has(person.id)) cache.set(person.id, record(person));
  }
  return cache;
}

function readLocal() {
  if (local === undefined) {
    local = null;
    try {
      local = clean(JSON.parse(window.localStorage.getItem(STORE) || "null"));
    } catch (_) {}
  }
  return local;
}

function writeLocal(person) {
  local = person;
  try {
    window.localStorage.setItem(STORE, JSON.stringify(person));
  } catch (_) {}
}

function mint() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Only an editor is anyone: a read-only page has no me, so it shows no compose UI. The
// host's answer wins when it names you. A host that failed to answer has not said you are
// nobody, so no local name stands in for a known account. Otherwise (no discovery, a host
// without people, or a guest it cannot name) an editor is whoever this browser says it is.
export function currentMe() {
  if (!editing()) return null;
  if (host.me) return record(host.me);
  // The host knows who you are but cannot say right now: not a reason to become whoever
  // this browser last was.
  if (host.unavailable) return null;
  if (outcome !== "ok" && outcome !== "none") return null;
  const mine = readLocal();
  return mine ? record(mine) : null;
}

function applyMeta(meta) {
  const nextOutcome = hostMetaOutcome(meta);
  // Once the host has named people, a later answer that is not a capability document is a
  // blip (a deploy, a proxy), not news that it forgot everyone: the last good answer stands.
  if (nextOutcome !== "ok" && host.supports) return;
  const people = meta.document?.people;
  const supports = meta.extensions.includes("people") && !!people && typeof people === "object";
  const next = {
    supports,
    me: supports ? clean(people.me) : null,
    members: supports && Array.isArray(people.members) ? people.members.map(clean).filter(Boolean) : null,
    unavailable: supports && people.unavailable === true,
  };
  const changed = nextOutcome !== outcome || JSON.stringify(next) !== JSON.stringify(host);
  host = next;
  outcome = nextOutcome;
  if (changed) emit();
}

async function refresh(fresh) {
  applyMeta(await hostMeta({ fresh }));
}

function get(id) {
  observe();
  const key = String(id ?? "");
  const live = (host.me?.id === key && host.me) || host.members?.find((person) => person.id === key);
  if (live) return record(live);
  const mine = readLocal();
  if (mine?.id === key) return record(mine);
  return saved().get(key) || Object.freeze({ id: key, name: "Unknown person", initials: "?", color: colorIndexOf(key) });
}

function list() {
  observe();
  return [...saved().keys()].map(get);
}

async function available() {
  await refresh(outcome !== "none");
  return host.members ? host.members.map(record) : null;
}

function add(person) {
  const p = clean(person);
  if (!p) throw new TypeError("clay.people.add: needs an id of 8 to 64 letters, digits, _ or -, and a name of 1 to 120 characters");
  let root = registry();
  if (!root) {
    root = document.createElement("div");
    root.setAttribute("clay-people", "");
    root.hidden = true;
    document.body.append(root);
  }
  const same = entries().filter((el) => el.getAttribute("value") === p.id);
  if (same.length) {
    if (same[0].textContent !== p.name) same[0].textContent = p.name;
    for (const extra of same.slice(1)) extra.remove();
  } else {
    const el = document.createElement("data");
    el.setAttribute("value", p.id);
    el.textContent = p.name;
    root.append(el);
  }
  cache = null;
  return record(p);
}

// Forget a person the document no longer names, so their name stops travelling with it.
function remove(id) {
  const key = String(id ?? "");
  for (const el of entries()) if (el.getAttribute("value") === key) el.remove();
  cache = null;
}

// Only a name this browser chose can change here; a host's name is the host's to change.
function canRename() {
  return editing() && !host.me && (outcome === "ok" || outcome === "none") && !!readLocal() && !host.unavailable;
}

/**
 * Change the name this browser uses, and this page's record of it. Other pages keep the
 * old name until this person next writes there. Returns the new record.
 */
function rename(name) {
  if (!canRename()) throw Object.assign(new Error("clay.people.rename: only a name chosen in this browser can be changed here"), { code: "not-renamable" });
  const mine = readLocal();
  const next = clean({ id: mine.id, name });
  if (!next) throw new TypeError("clay.people.rename: needs a name of 1 to 120 characters that is not an email address");
  writeLocal(next);
  if (entries().some((el) => el.getAttribute("value") === next.id)) add(next);
  emit();
  return record(next);
}

// Same session and still editing: the two facts an await can invalidate.
const stale = (generation) => generation !== modeState().generation || !editing();

function refuseIfStale(generation) {
  if (!stale(generation)) return;
  throw Object.assign(new Error("clay.author: the page left edit mode before your name was recorded"), {
    code: "stale-document",
  });
}

function unavailable() {
  return Object.assign(new Error("Can't reach the host to check who you are. Try again in a moment."), { code: "people-unavailable" });
}

/**
 * Stamp `el` with the current person's id, recording them in the document.
 * Resolves the person's record, or null when they cancel the name prompt.
 * Rejects with code "people-unavailable" when the host failed to answer.
 */
export async function author(el, attr = "data-by") {
  if (!window.clay?.isEditMode) throw new Error("clay.author: this page is not in edit mode");
  if (!(el instanceof Element)) throw new TypeError("clay.author: needs an element");
  // Attribution belongs to the session that asked for it. Asking the host who I am and
  // asking a person their name both take long enough for the page to leave edit, and a
  // stamp recorded afterwards would credit a session that has already ended.
  const generation = modeState().generation;
  // A host that names people can change who you are while the page is open (a sign-out,
  // a rename in the app), so a stamp asks it again first. If it cannot answer now, nothing
  // is stamped: the last answer might name someone who is no longer here.
  if (host.supports) {
    const meta = await hostMeta({ fresh: true });
    refuseIfStale(generation);
    const fresh = hostMetaOutcome(meta);
    if (fresh === "none") throw Object.assign(new Error("This page lost its connection to the host. Reload it to keep editing."), { code: "people-unavailable" });
    if (fresh !== "ok") throw unavailable();
    applyMeta(meta);
    if (host.unavailable) throw Object.assign(new Error("The app hosting this file can't name you right now. Check its Profile settings, then try again."), { code: "people-unavailable" });
  } else if (outcome !== "ok" && outcome !== "none") {
    await refresh(outcome === "failed");
    refuseIfStale(generation);
  }
  if (outcome === "failed") throw unavailable();
  let me = currentMe();
  if (!me) {
    const chosen = await askName();
    refuseIfStale(generation);
    if (!chosen) return null;
    writeLocal(chosen);
    me = record(chosen);
    emit();
  }
  add(me);
  el.setAttribute(attr, me.id);
  return me;
}

// The dialog and the theme it paints with are this page's first-use download: a
// reader is nobody and is asked nothing, so it never fetches them.
function loadDialogUI() {
  dialogLoad ??= Promise.all([
    import("../ui/bevel-dialog.js"),
    import("../ui/bevel-controls.js"),
    import("../ui/theme.js"),
  ]).then(([dialog, controls, theme]) => ({ ...dialog, ...controls, resolveTheme: theme.resolveTheme }))
    .catch((error) => {
      dialogLoad = null;
      throw error;
    });
  return dialogLoad;
}

function askName() {
  if (asking && (askingRoot ? askingRoot.isConnected : true)) return asking;
  if (asking) cancelAsking();
  asking = promptForName().catch((error) => {
    asking = null;
    askingRoot = null;
    cancelAsking = null;
    throw error;
  });
  return asking;
}

async function promptForName() {
  const ui = await loadDialogUI();
  return new Promise((resolve) => {
    const theme = ui.resolveTheme();
    const { root, overlay, panel, heading, body, footer, close } = ui.bevelDialog({
      zIndex: "2147483001", width: "420px", closable: true, titled: true, theme, surface: "people",
    });
    askingRoot = root;
    cancelAsking = () => finish(null);
    heading.textContent = "What name should appear on your changes?";
    panel.setAttribute("aria-label", "Your name");

    const input = ui.bevelInput("input", { rules: ["display:block", "width:100%", "margin:0"], theme, parts: ["dialog.input", "people.input"] });
    input.setAttribute("aria-label", "Your name");
    input.maxLength = MAX_NAME;
    input.autocomplete = "name";
    const hint = ui.bevelText("p", ["display:block", "margin:10px 0 0", "font-size:13px", "opacity:.8"],
      "Saved in this browser. Everyone who can read this page will see it.", { theme, parts: ["dialog.hint", "people.hint"], role: "mutedText" });
    const hintText = hint.textContent;
    body.append(input, hint);

    const known = list().slice(0, 8);
    if (known.length) {
      const label = ui.bevelText("p", ["display:block", "margin:18px 0 8px", "font-size:13px"], "Or continue as someone already in this page:", { theme, parts: ["people.choiceLabel"], role: "mutedText" });
      const row = ui.bevelBox("div", ["display:flex", "flex-wrap:wrap", "gap:8px"], { theme, parts: ["people.choices"] });
      for (const person of known) {
        row.append(ui.bevelButton(person.name, { small: true, onClick: () => finish({ id: person.id, name: person.name }), theme, parts: ["dialog.button", "people.button", "people.choice"], labelParts: ["dialog.buttonLabel", "people.buttonLabel"] }));
      }
      body.append(label, row);
    }

    const cancel = ui.bevelButton("Cancel", { onClick: () => finish(null), theme, parts: ["dialog.button", "people.button"], labelParts: ["dialog.buttonLabel", "people.buttonLabel"] });
    const ok = ui.bevelButton("Continue", { variant: "primary", onClick: () => submit(), theme, parts: ["dialog.button", "people.button"], labelParts: ["dialog.buttonLabel", "people.buttonLabel"] });
    footer.append(cancel, ok);

    const submit = () => {
      const name = input.value.trim().replace(/\s+/g, " ");
      if (!name) {
        input.focus();
        return;
      }
      if (EMAIL.test(name)) {
        hint.textContent = "Use a name, not an email address. Everyone who can read this page will see it.";
        input.focus();
        return;
      }
      finish({ id: mint(), name: name.slice(0, MAX_NAME) });
    };
    input.addEventListener("input", () => {
      if (hint.textContent !== hintText) hint.textContent = hintText;
    });

    panel.addEventListener("submit", (event) => {
      event.preventDefault();
      submit();
    });
    close?.addEventListener("click", () => finish(null));
    let pressedOnBackdrop = false;
    overlay.addEventListener("mousedown", (event) => { pressedOnBackdrop = event.target === overlay; });
    overlay.addEventListener("click", (event) => {
      if (pressedOnBackdrop && event.target === overlay) finish(null);
      pressedOnBackdrop = false;
    });
    const onKey = (event) => {
      if (event.key === "Tab") {
        event.stopPropagation();
        ui.keepFocusIn(panel, event);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(null);
      } else if (event.key === "Enter" && event.target === input) {
        event.preventDefault();
        event.stopPropagation();
        submit();
      }
    };
    document.addEventListener("keydown", onKey, true);

    let done = false;
    function finish(person) {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey, true);
      root.remove();
      // Recorded before the next caller can look, so an author() in the same task finds a me
      // instead of opening a second prompt.
      if (person) writeLocal(person);
      asking = null;
      askingRoot = null;
      cancelAsking = null;
      resolve(person);
    }
    ui.dismissOf.set(root, () => finish(null));

    root.setAttribute("aria-hidden", "false");
    modalHost().append(root);
    input.focus();
  });
}

// A page's own modal <dialog> makes everything outside it inert, so the prompt goes inside
// the topmost one, or it could not be clicked or typed into.
function modalHost() {
  const open = [...document.querySelectorAll("dialog[open]")].filter((d) => d.matches(":modal"));
  return open[open.length - 1] || document.body;
}

function touchesRegistry(node) {
  return node.nodeType === 1 && (node.matches("[clay-people]") || !!node.querySelector("[clay-people]"));
}

function registrySignature() {
  return JSON.stringify([...saved().values()].map(({ id, name }) => [id, name]));
}

// The observer belongs to the page rather than to one edit session — a reader repaint
// has to keep the names in it current — so any read starts it and a session that stops
// takes it down. It is created with the document it watches held once: a test
// environment can tear that document down while a mutation is still queued, and a
// callback that reached for the global afterwards would read a page that is gone.
let watcher = null;

function observe() {
  const doc = document;
  if (watcher?.doc === doc) return;
  watcher?.observer.disconnect();
  lastRegistry = registrySignature();
  const observer = new MutationObserver((records) => {
    if (typeof document === "undefined" || document !== doc) return;
    for (const rec of records) {
      const target = rec.target.nodeType === 1 ? rec.target : rec.target.parentElement;
      // A removed clay-people attribute no longer matches the selector, so it is caught by name.
      if (rec.attributeName === "clay-people" ||
          target?.closest("[clay-people]") ||
          [...rec.addedNodes].some(touchesRegistry) ||
          [...rec.removedNodes].some(touchesRegistry)) {
        cache = null;
        // Only a real change is news; a listener that re-renders the registry must not loop.
        const next = registrySignature();
        if (next !== lastRegistry) {
          lastRegistry = next;
          emit();
        }
        return;
      }
    }
  });
  observer.observe(doc.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["value", "clay-people"] });
  watcher = { doc, observer };
}

function unobserve() {
  watcher?.observer.disconnect();
  watcher = null;
}

// The editing half: the host answer that names me and the two listeners that keep it
// current, added once for the boot and a lease alike. Each checks the mode when it fires,
// so a session that has ended asks the host nothing.
let session = null;

function startEditing() {
  if (!editing()) return Promise.resolve(null);
  if (!session) {
    const listeners = new AbortController();
    const { signal } = listeners;
    window.addEventListener("storage", (event) => {
      if (event.key !== STORE || !editing()) return;
      local = undefined;
      emit();
    }, { signal });
    document.addEventListener("visibilitychange", () => {
      if (!editing()) return;
      if (document.visibilityState === "visible" && outcome !== "none") refresh(true);
    }, { signal });
    session = { listeners, first: refresh(false) };
  }
  return Promise.race([session.first, new Promise((resolve) => setTimeout(resolve, BOOT_WAIT_MS))]);
}

function stopEditing() {
  session?.listeners.abort();
  session = null;
}

async function init() {
  observe();
  // A reader is nobody and picks nobody, so a read-only page never asks the host.
  await startEditing();
}

function peopleLease() {
  return {
    enable() {
      observe();
      startEditing();
    },
    quiesce() {
      if (!asking) return;
      throw Object.assign(new Error("clay:people: a name is still being chosen"), {
        code: "pending-input",
        pending: ["name"],
      });
    },
    resume() {},
    dispose() {
      cancelAsking?.();
      unobserve();
      stopEditing();
    },
  };
}

/**
 * Attribution as a mode lease.
 *
 * Reading names is not editing, so every read keeps the registry observer running and
 * costs a session nothing. What a session adds is a name that is still being chosen: a
 * half-answered prompt is input nobody has committed, so `quiesce` refuses the exit
 * rather than closing it, and `resume` leaves that same prompt on screen. `dispose`
 * (after the barrier) takes back both the prompt and the observer, and the next read
 * starts watching again.
 */
export function peopleParticipant() {
  return {
    id: "clay:people",
    order: 330,
    prepare(context = {}) {
      const lease = peopleLease();
      // An adoption is the session this module's own import already started: the exit
      // takes it back, and the commit starts nothing a second time.
      if (context.initial !== true) return lease;
      return { ...lease, enable() {} };
    },
  };
}

export { peopleParticipant as modeParticipant };

export const people = Object.freeze({ get, list, available, add, remove, canRename, rename });

export const ready = init();

export default people;
