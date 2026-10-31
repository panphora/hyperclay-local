// Other people's carets on the page.
//
// A peer publishes where its selection sits (Document 10 Step 6): `presence`
// carries a page target, and this module draws it where that text is in *this*
// tab's document, through the binding's mapping. Nothing here is saved: the
// decorations are ProseMirror's, the labels are runtime elements, and the only
// thing this file sends is a target the presence store already coalesces.
//
// It loads on its own, after presence is available in an editor, so a reader and
// an editor that nobody shares with never fetch it.
import { state, view as pmView } from "../vendor/prosemirror.vendor.js";
import { encodeSelection, decodeSelection } from "./ybind/awareness.js";
import { presence as presenceStore } from "../sync/presence-store.js";
import { PRESENCE_VERSION } from "../sync/presence-target.js";
import { hostMeta } from "../core/host-meta.js";
import { styleWithLegacyId } from "../lib/style.js";

const { Plugin, PluginKey } = state;
const { Decoration, DecorationSet } = pmView;

export const awarenessKey = new PluginKey("page-awareness");

const STYLE_ID = "page-awareness-style";
const STYLE_CSS = `
.page-remote-selection { background-color: color-mix(in srgb, var(--page-remote-color, currentColor) 22%, transparent); }
.page-remote-caret { position: relative; display: inline-block; width: 0; height: 1.1em; vertical-align: text-bottom; }
.page-remote-caret::before { content: ""; position: absolute; inset-inline-start: -1px; top: 0; bottom: 0; width: 2px; background: var(--page-remote-color, currentColor); }
.page-remote-name { position: absolute; inset-inline-start: -1px; bottom: 100%; padding: 1px 4px; border-radius: 4px; background: var(--page-remote-color, currentColor); color: #fff; font-size: 10px; line-height: 1.4; white-space: nowrap; pointer-events: none; }
.page-remote-cell { outline: 2px solid var(--page-remote-color, currentColor); outline-offset: -2px; }
.page-remote-block { box-shadow: inset 2px 0 0 var(--page-remote-color, currentColor); }
`;

// A fixed palette, chosen for contrast against both page themes. A peer's id
// picks the colour; a peer never supplies one.
const PALETTE = ["#2F5E9E", "#8A3B6E", "#3E6A28", "#8A5A1E", "#5E4596", "#1F5A8A"];
export const colorOf = (id) => {
  const text = typeof id === "string" ? id : "";
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
};

const caretElement = (doc, name, color) => {
  const bar = doc.createElement("span");
  bar.className = "page-remote-caret";
  bar.setAttribute("aria-hidden", "true");
  bar.style.setProperty("--page-remote-color", color);
  const tag = doc.createElement("span");
  tag.className = "page-remote-name";
  tag.textContent = name;
  bar.appendChild(tag);
  return bar;
};

const labelOf = (person) => (typeof person.name === "string" && person.name.trim() ? person.name.trim() : "Someone");

let barrier = false;
if (typeof document !== "undefined") {
  document.addEventListener("clay:presence-quiesce", () => { barrier = true; });
  document.addEventListener("clay:presence-resume", () => { barrier = false; });
}

/**
 * The decorations one snapshot produces in one document.
 *
 * `decode` returns null for anything this tab cannot place — a hidden copy, a
 * deleted block, a peer's relative position from another document, bytes that do
 * not decode — and a null is a caret that simply is not drawn.
 */
export function decorationsFor({ binding, doc, snapshot, epoch }) {
  const generation = binding.awareness.generation();
  const context = { ...binding.awareness.map(), doc };
  const decorations = [];
  for (const person of snapshot.people ?? []) {
    if (person.you) continue;
    const color = colorOf(person.id);
    const name = labelOf(person);
    for (const session of person.sessions ?? []) {
      if (session.you) continue;
      const target = session.editing;
      if (!target || target.kind !== "page" || target.v !== PRESENCE_VERSION) continue;
      if (target.epoch !== epoch || target.generation !== generation) continue;
      const spot = decodeSelection(context, target.selection);
      if (!spot) continue;
      if (spot.kind === "text") {
        if (spot.to > spot.from) decorations.push(Decoration.inline(spot.from, spot.to, { class: "page-remote-selection", style: `--page-remote-color:${color}` }));
        decorations.push(Decoration.widget(spot.to, (view) => caretElement(view.dom.ownerDocument, name, color), { side: 1, key: `caret:${person.id}:${session.id}` }));
      } else if (spot.kind === "cell") {
        decorations.push(Decoration.node(spot.from, spot.to, { class: "page-remote-cell", style: `--page-remote-color:${color}` }));
        decorations.push(Decoration.widget(spot.from + 1, (view) => caretElement(view.dom.ownerDocument, name, color), { side: -1, key: `cell:${person.id}:${session.id}` }));
      } else if (spot.kind === "blocks") {
        const [first] = spot.ranges;
        for (const range of spot.ranges) decorations.push(Decoration.node(range.from, range.to, { class: "page-remote-block", style: `--page-remote-color:${color}` }));
        decorations.push(Decoration.widget(first.from + 1, (view) => caretElement(view.dom.ownerDocument, name, color), { side: -1, key: `blocks:${person.id}:${session.id}` }));
      }
    }
  }
  return decorations.length ? DecorationSet.create(doc, decorations) : DecorationSet.empty;
}

/**
 * Watch a mounted editor: publish this tab's selection while it is focused and
 * draw every permitted peer's, one animation frame after anything changed.
 *
 * Returns the handle the page's teardown releases. In a reader, or on a host
 * without page awareness, nothing is installed and nothing is sent.
 */
export function createPageAwareness({ binding, view, store = presenceStore, epoch, composing = null, frame = (fn) => requestAnimationFrame(fn), cancel = (handle) => cancelAnimationFrame(handle) }) {
  if (!binding?.awareness || !view || typeof epoch !== "string" || !epoch) return null;
  styleWithLegacyId(STYLE_ID, STYLE_CSS, STYLE_ID, ["editor-ui"]);
  const doc = view.dom.ownerDocument;
  let disposed = false;
  // The exit's barrier, and the clear that came with it: while it runs this tab
  // publishes nothing, so a caret move or a doc change during the barrier cannot put
  // a target back the session is about to release.
  let quiesced = barrier;
  // Focus is a fact about the document, not a guess: an editor mounted in a background
  // tab is not focused, and publishing a target for it would claim a caret nobody holds.
  let focused = typeof view.hasFocus === "function" ? view.hasFocus() === true : view.dom.contains(doc.activeElement);
  let pending = null;
  const isComposing = () => (composing ? composing() === true : view.composing === true);

  const supported = () => store.getSnapshot().pageAwareness !== false;

  const publish = (state = view.state) => {
    if (disposed || quiesced) return;
    if (!supported() || !focused || isComposing()) {
      store.setTarget(null);
      return;
    }
    const selection = encodeSelection({ ...binding.awareness.map(), doc: state.doc }, state.selection);
    if (!selection) {
      store.setTarget(null);
      return;
    }
    store.setTarget({ kind: "page", v: PRESENCE_VERSION, epoch, generation: binding.awareness.generation(), selection });
  };

  const rebuild = (next) => {
    // During composition the peer's decorations stay where they were: replacing
    // them mid-word would draw over text the person is still forming.
    if (isComposing()) return awarenessKey.getState(view.state);
    return decorationsFor({ binding, doc: next.doc, snapshot: store.getSnapshot(), epoch });
  };

  const plugin = new Plugin({
    key: awarenessKey,
    state: {
      init: (_config, st) => decorationsFor({ binding, doc: st.doc, snapshot: store.getSnapshot(), epoch }),
      apply: (tr, value, _old, next) => {
        // Every transaction a person makes publishes, including one that only moved
        // the caret: the page's dispatch hands the view a state, not a prop update.
        if (tr.docChanged || tr.selectionSet) publish(next);
        return tr.docChanged || tr.getMeta(awarenessKey) ? rebuild(next) : value;
      },
    },
    props: {
      decorations(st) {
        return awarenessKey.getState(st) ?? DecorationSet.empty;
      },
    },
  });

  const refresh = () => {
    if (disposed || view.isDestroyed) return;
    view.dispatch(view.state.tr.setMeta(awarenessKey, true));
  };

  const schedule = () => {
    if (disposed || pending !== null || view.isDestroyed) return;
    pending = frame(() => {
      pending = null;
      refresh();
    });
  };

  const unsubscribe = store.subscribe((snapshot) => {
    if (snapshot.pageAwareness === false) store.setTarget(null);
    schedule();
  });

  // The edit participant reaches these, so the page's target goes quiet with the
  // sender during the exit's barrier and comes back with it on a refused exit.
  const quiesce = () => {
    if (disposed) return;
    quiesced = true;
    store.setTarget(null);
  };
  const resume = () => {
    if (disposed) return;
    quiesced = false;
    publish();
  };

  const onFocus = () => { focused = true; publish(); schedule(); };
  const onBlur = () => { focused = false; store.setTarget(null); };
  const onHide = () => { store.setTarget(null); };
  const onCompositionEnd = () => { publish(); schedule(); };

  view.dom.addEventListener("focus", onFocus);
  view.dom.addEventListener("blur", onBlur);
  view.dom.addEventListener("compositionend", onCompositionEnd);
  doc.addEventListener("pagehide", onHide);
  doc.addEventListener("clay:presence-quiesce", quiesce);
  doc.addEventListener("clay:presence-resume", resume);
  view.updateState(view.state.reconfigure({ plugins: [...view.state.plugins, plugin] }));
  publish();
  schedule();

  return {
    epoch,
    refresh,
    plugin,
    quiesce,
    resume,
    get decorations() {
      return awarenessKey.getState(view.state) ?? DecorationSet.empty;
    },
    get target() {
      return store.target ?? null;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (pending !== null) { cancel(pending); pending = null; }
      unsubscribe();
      view.dom.removeEventListener("focus", onFocus);
      view.dom.removeEventListener("blur", onBlur);
      view.dom.removeEventListener("compositionend", onCompositionEnd);
      doc.removeEventListener("pagehide", onHide);
      doc.removeEventListener("clay:presence-quiesce", quiesce);
      doc.removeEventListener("clay:presence-resume", resume);
      store.setTarget(null);
      store.releaseTarget();
      if (!view.isDestroyed) {
        const plugins = view.state.plugins.filter((candidate) => candidate !== plugin);
        view.updateState(view.state.reconfigure({ plugins }));
      }
    },
  };
}

/**
 * Install page awareness on a mounted editor, if this host offers it: the
 * document scope the host announced is what a target's epoch names, so peers on
 * the same document agree without the tab guessing its identity.
 */
export async function installPageAwareness({ binding, view, store = presenceStore, meta = null } = {}) {
  if (!binding?.awareness || !view) return null;
  const answer = meta ?? (await hostMeta());
  const extensions = Array.isArray(answer?.extensions) ? answer.extensions : [];
  store.setCapabilities({
    supported: extensions.includes("presence"),
    recordAwareness: extensions.includes("record-awareness-v1"),
    pageAwareness: extensions.includes("page-awareness-v1"),
  });
  if (!extensions.includes("page-awareness-v1")) return null;
  const epoch = answer.document?.awareness?.scope;
  if (typeof epoch !== "string" || !epoch) return null;
  return createPageAwareness({ binding, view, store, epoch });
}
