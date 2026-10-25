import { state } from "../vendor/prosemirror.vendor.js";
import Mutation from "../lib/mutation.js";
import { titleFor, titleText, writeTitle } from "./document-title-dom.js";

const ATOM = "\uFFFC";

export function titleItemsOfDoc(doc) {
  const items = [];
  for (let i = 0; i < doc.childCount; i++) {
    const node = doc.child(i);
    if (node.type.name !== "heading" || node.attrs.level !== 1 || (node.attrs.parent ?? null) !== null) continue;
    let c = "";
    node.forEach((child) => { c += child.isText ? child.text : child.type.name === "hard_break" ? ATOM : ""; });
    items.push({ t: "heading", level: 1, parent: null, c });
    break;
  }
  return items;
}

export function refreshDocumentTitle(view) {
  if (!view || view.isDestroyed) return null;
  const doc = view.dom?.ownerDocument ?? (typeof document === "undefined" ? null : document);
  if (!doc) return null;
  const items = titleItemsOfDoc(view.state.doc);
  const { custom, title } = titleFor(doc, items);
  if (custom) return title;
  const current = titleText(doc);
  // A document with no title of its own and no root H1 has nothing to derive:
  // inserting a title the file never had would be a change the person did not
  // make, and the save projection, which owns the saved title, writes none for
  // it either. An existing title still follows the model, so deleting the H1
  // reads Untitled.
  if (current === "" && !items.length) return title;
  if (current === title) return title;
  Mutation.pause();
  try { writeTitle(doc, title); }
  finally { Mutation.resume(); }
  return title;
}

export function titlePlugin() {
  return new state.Plugin({
    view(editorView) {
      let doc = null;
      const refresh = () => {
        doc = editorView.state.doc;
        refreshDocumentTitle(editorView);
      };
      refresh();
      return {
        update(next) {
          if (next.state.doc === doc) return;
          refresh();
        },
      };
    },
  });
}

export function observeDocumentTitle(view) {
  const head = view?.dom?.ownerDocument?.head ?? null;
  if (!head) return { refresh: () => refreshDocumentTitle(view), dispose() {} };
  let queued = false;
  const refresh = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      refreshDocumentTitle(view);
    });
  };
  const observer = new MutationObserver(refresh);
  observer.observe(head, { childList: true, characterData: true, subtree: true, attributeFilter: ["content", "name"] });
  refreshDocumentTitle(view);
  return { refresh, dispose() { observer.disconnect(); } };
}
