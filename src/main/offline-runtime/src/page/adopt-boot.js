// When a hand-edited article is adopted: the file read at boot, before the
// editor mounts into the article, and every newer file that arrives. Only the
// checkpoint writer adopts (two adopters would both land the same splice). While
// an adoption waits for the binding or an IME composition, autosave is held, so
// a checkpoint cannot save the old article over the edit first.
import { suspendAutosave, resumeAutosave } from "../core/save.js";
import { history } from "../vendor/prosemirror.vendor.js";
import { ADOPT, classifyFile, planAdoption, adoptionTransaction, readBack } from "./adopt.js";
import { mergePageModels } from "./merge.js";
import { blockMap } from "./model.js";
import { parseModel } from "./projection.js";
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
  snapshot = () => null,
  mergeTagless = false,
  writerReady = () => Promise.resolve(),
  adopted = () => {},
  hold = suspendAutosave,
  release = resumeAutosave,
  holdMs = 10_000,
  doc = document,
}) {
  let last = source ? source.article.innerHTML : null;
  // A host that keeps no page data (HTML Clay) sends files with no page tag. What
  // this tab saw on disk per data-rev, in the order it saw it: the boot article,
  // every frame, and every article this tab's own save sent. The base for a frame
  // is the last of those with its rev, else the last article on disk: an untouched
  // older copy then merges to nothing, and a hand edit that kept the rev merges in.
  let disk = source ? source.article : null;
  const seen = new Map();
  const record = (article) => {
    const rev = article.getAttribute("data-rev");
    if (!rev) return;
    const list = seen.get(rev) ?? [];
    seen.delete(rev);
    seen.set(rev, list);
    list.push(article);
    if (list.length > 10) list.shift();
    if (seen.size > 20) seen.delete(seen.keys().next().value);
  };
  if (disk) record(disk);
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

  // The editor merged three-way with what the file changed since base.
  function land(blocks, current, baseItems, incoming) {
    const merged = mergePageModels(baseItems, current, incoming, { doc, merge3: HyperMorph.merge3, mergeJson: HyperMorph.mergeJson });
    const lost = merged.conflicts.filter((k) => k.kind === "text" || k.kind === "field");
    const copy = lost.length ? snapshot() : null;
    const plan = planAdoption(blocks, merged.items, current);
    const tr = plan && adoptionTransaction(view.state, plan);
    if (!tr) return null;
    view.dispatch(tr);
    view.dispatch(history.closeHistory(view.state.tr));
    const counts = { edited: plan.edited.size, created: plan.created.size, deleted: plan.deleted.length, moved: plan.reordered };
    const { displaced } = tr.getMeta(ADOPT);
    if (Object.keys(displaced).length) counts.displaced = displaced;
    if (lost.length) counts.conflicts = lost;
    if (copy) counts.copy = copy;
    return counts;
  }

  async function adopt(file) {
    if (mergeTagless && !file.tags.length) return adoptTagless(file);
    const found = classifyFile(file.article, file.tags);
    if (found.kind === "unbased") console.warn("page: the article and its data changed together; kept the data");
    if (found.kind !== "adopt" || !isAdopter()) return null;
    hold();
    try {
      const waited = await waitForEditor();
      if (waited === "timeout") console.warn("page: gave up waiting for the editor; the hand edit was not adopted");
      if (waited !== "ready" || disposed || !isAdopter()) return null;
      const blocks = blockMap(view.state.doc);
      const counts = land(blocks, readBack(blocks, doc), found.baseItems, found.parsed);
      if (counts) adopted(found.A);
      return counts;
    } finally {
      release();
    }
  }

  async function adoptTagless(file) {
    const rev = file.article.getAttribute("data-rev");
    const list = (rev && seen.get(rev)) || [];
    const base = list.at(-1) ?? disk;
    // An untouched older copy leaves the page as it is.
    if (list.slice(0, -1).some((article) => article.innerHTML === file.article.innerHTML)) return null;
    record(file.article);
    disk = file.article;
    if (!base) return null;
    // Only the room's elected writer merges a frame, so it lands once however
    // many tabs see it; and it lands even when the editor never settles, since
    // the next save would otherwise write over the edit.
    hold();
    try {
      await writerReady();
      if (disposed || !isAdopter()) return null;
      const waited = await waitForEditor();
      if (waited === "disposed" || disposed || !isAdopter()) return null;
      const blocks = blockMap(view.state.doc);
      const current = readBack(blocks, doc);
      const known = new Map(current.map((item) => [item.id, item]));
      const parse = (article) => parseModel(article, { seed: article.getAttribute("data-rev") ?? "", known });
      return land(blocks, current, parse(base), parse(file.article));
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
    // A save of this tab landed: the file holds what it sent, so that article is
    // the one an outside edit made on the saved file merges against.
    saved(html) {
      if (!mergeTagless || typeof html !== "string") return;
      const article = new DOMParser().parseFromString(html, "text/html").querySelector(ARTICLE);
      if (!article) return;
      record(article);
      disk = article;
    },
    dispose() {
      disposed = true;
      cancel();
      doc.removeEventListener("clay:sync-applied", onFrame);
    },
  };
}
