// Text typed into chrome and not yet sent (a comment box, a description being edited),
// kept per record and name, outside the file. A redraw or a reload brings it back.
//
// The record a field belongs to is named by an `unsent-key` attribute on its nearest
// such ancestor, and by the nearest `[data-id]` ancestor when there is none: a view
// with two draft fields under one record names each scope it wants kept apart. The
// name is the field's own `unsent` attribute. A draft is pending while the field's
// value differs from the base it started at, an emptied field included.
import { registerUnsavedState } from "../lib/unsaved-state.js";
import { storage } from "../lib/doc-storage.js";

const KEY = "unsent";
const drafts = new Map(Object.entries(storage.session.get(KEY) || {}));
const bases = new WeakMap();
const pending = registerUnsavedState({ id: "unsent", isPending: () => drafts.size > 0 });

const keyOf = (el) => {
  const scope = el.closest("[unsent-key]");
  const record = (scope && scope.getAttribute("unsent-key")) || el.closest("[data-id]")?.dataset.id;
  const name = el.getAttribute("unsent");
  return record && name ? `${record}|${name}` : null;
};
const split = (key) => { const at = key.indexOf("|"); return [key.slice(0, at), key.slice(at + 1)]; };

function persist() {
  storage.session.set(KEY, Object.fromEntries(drafts));
  pending.changed();
  document.dispatchEvent(new CustomEvent("clay:unsent-changed", { detail: { count: drafts.size } }));
}

function onBeforeInput(e) {
  const el = e.target.closest?.("[unsent]");
  if (el && !bases.has(el)) bases.set(el, el.value);
}

function onInput(e) {
  const el = e.target.closest?.("[unsent]");
  const key = el && keyOf(el);
  if (!key) return;
  const base = bases.get(el) ?? drafts.get(key)?.base ?? "";
  if (el.value === base) {
    drafts.delete(key);
    bases.delete(el);
  } else {
    drafts.set(key, { base, text: el.value });
  }
  persist();
}

function restore(el) {
  const key = keyOf(el);
  const draft = key && drafts.get(key);
  if (!draft) return;
  const current = el.value;
  bases.set(el, draft.base);
  el.value = draft.text;
  el.dispatchEvent(new CustomEvent("clay:unsent-restored", {
    bubbles: true,
    detail: { base: draft.base, current, stale: current !== draft.base },
  }));
}

const observer = new MutationObserver((records) => {
  for (const record of records) for (const node of record.addedNodes) {
    if (node.nodeType !== 1) continue;
    if (node.matches("[unsent]")) restore(node);
    for (const el of node.querySelectorAll("[unsent]")) restore(el);
  }
});

function restoreAll() {
  for (const el of document.querySelectorAll("[unsent]")) restore(el);
}

// The listeners and the observer belong to the page, not to an edit session: a reader
// repaint while the page is in view has to bring the drafts back too. Installing twice
// adds nothing, which is what keeps a second entry from recording one keystroke twice.
let installed = false;

function install() {
  if (installed) return;
  installed = true;
  document.addEventListener("beforeinput", onBeforeInput, true);
  document.addEventListener("input", onInput, true);
  observer.observe(document.body, { childList: true, subtree: true });
}

install();
restoreAll();

/**
 * Unsent drafts as a mode participant.
 *
 * Nothing here is the session's to lose: a draft is a revision of one control (its base
 * and its text, per record and name) that the page's bytes cannot show, and the restore
 * that brings it back runs in view as well. So `enable` installs and restores, and
 * `quiesce`, `resume` and `dispose` leave every draft, its base and the pending check
 * exactly where they are — an exit that teardown could acknowledge would report a view
 * while a person's half-written text still waits outside the file.
 */
export function unsentParticipant() {
  return {
    id: "clay:unsent",
    order: 320,
    prepare(context = {}) {
      // Adoption asks for a lease over the boot's session, and this module has none to
      // hand back: it installs once at import and keeps every draft.
      if (context.initial === true) {
        return { enable() {}, quiesce() {}, resume() {}, dispose() {} };
      }
      install();
      return {
        enable() {
          install();
          restoreAll();
        },
        quiesce() {},
        resume() {},
        dispose() {},
      };
    },
  };
}

export { unsentParticipant as modeParticipant };

export const unsent = {
  get size() { return drafts.size; },
  list: () => [...drafts].map(([key, d]) => { const [record, name] = split(key); return { record, name, ...d }; }),
  clear(el) { const key = keyOf(el); if (key && drafts.delete(key)) persist(); bases.delete(el); },
  drop(record, name) { if (drafts.delete(`${record}|${name}`)) persist(); },
};
