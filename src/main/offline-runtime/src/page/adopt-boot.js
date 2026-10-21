// When a hand-edited article is adopted: the file read at boot, before the
// editor mounts into the article, and every newer file that arrives. Only the
// checkpoint writer adopts (two adopters would both land the same splice). While
// an adoption waits for the binding or an IME composition, autosave is held, so
// a checkpoint cannot save the old article over the edit first.
import { suspendAutosave, resumeAutosave } from "../core/save.js";
import { history } from "../vendor/prosemirror.vendor.js";
import { ADOPT, classifyFile, planAdoption, adoptionTransaction } from "./adopt.js";
import { ARTICLE, pageTags } from "./save-projection.js";
import { HyperMorph } from "../vendor/hyper-morph.vendor.js";

const parseTag = (text) => { try { return HyperMorph.parseJsonRelaxed(text); } catch { return null; } };

export function readFile(root) {
  const article = root.querySelector(ARTICLE);
  return article ? { article: article.cloneNode(true), tags: pageTags(root).map((el) => parseTag(el.textContent)) } : null;
}

export function compositionIdle(view) {
  return new Promise((resolve) => {
    if (!view.composing) return resolve();
    view.dom.addEventListener("compositionend", () => setTimeout(() => resolve(compositionIdle(view)), 0), { once: true });
  });
}

export function installAdoption({
  view,
  source = null,
  ready = Promise.resolve(),
  isAdopter = () => true,
  idle = () => compositionIdle(view),
  requestCheckpoint = () => {},
  notice = () => {},
  hold = suspendAutosave,
  release = resumeAutosave,
  holdMs = 10_000,
  doc = document,
}) {
  let last = source ? source.article.innerHTML : null;
  let queue = Promise.resolve();
  let disposed = false;
  let cancel;
  const cancelled = new Promise((resolve) => (cancel = resolve));

  // The hold never outlives the controller, and never lasts past holdMs: an
  // editor that never settles must not stop every later save.
  async function waitForEditor() {
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve("timeout"), holdMs); });
    try {
      return await Promise.race([Promise.resolve(ready).then(() => idle()).then(() => "ready"), cancelled.then(() => "disposed"), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function adopt(file) {
    const found = classifyFile(file.article, file.tags);
    if (found.kind === "unbased") console.warn("page: the article and its data changed together; kept the data");
    if (found.kind !== "adopt" || !isAdopter()) return null;
    hold();
    try {
      const waited = await waitForEditor();
      if (waited === "timeout") console.warn("page: gave up waiting for the editor; the hand edit was not adopted");
      if (waited !== "ready" || disposed || !isAdopter()) return null;
      const plan = planAdoption(found.base, found.parsed, found.baseItems);
      const tr = plan && adoptionTransaction(view.state, plan);
      if (!tr) return null;
      view.dispatch(tr);
      view.dispatch(history.closeHistory(view.state.tr));
      const counts = { edited: plan.edited.size, created: plan.created.size, deleted: plan.deleted.length, moved: plan.reordered };
      const { displaced } = tr.getMeta(ADOPT);
      if (Object.keys(displaced).length) counts.displaced = displaced;
      return counts;
    } finally {
      release();
    }
  }

  function run(file) {
    queue = queue
      .then(() => adopt(file))
      .then((counts) => {
        if (!counts) return;
        requestCheckpoint();
        notice(counts);
        doc.dispatchEvent(new CustomEvent("clay:page-adopted", { detail: counts }));
      })
      .catch((error) => console.error("page: adoption failed", error));
    return queue;
  }

  function onFrame(event) {
    const html = event.detail?.html;
    if (disposed || typeof html !== "string") return;
    const file = readFile(new DOMParser().parseFromString(html, "text/html"));
    if (!file || file.article.innerHTML === last) return;
    last = file.article.innerHTML;
    run(file);
  }

  doc.addEventListener("clay:sync-applied", onFrame);
  if (source) run(source);

  return {
    idle: () => queue,
    dispose() {
      disposed = true;
      cancel();
      doc.removeEventListener("clay:sync-applied", onFrame);
    },
  };
}
