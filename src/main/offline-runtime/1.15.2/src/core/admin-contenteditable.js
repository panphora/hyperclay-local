import { isEditMode, isOwner } from "./is-edit-mode.js";
import onDomReady from "../lib/dom-ready.js";
import { addDocumentTransform } from "./snapshot.js";
import { authoredAttr, canonicalContentEditable, captureAuthored, restoreAuthoredOrder } from "./preserve-authored.js";

export const SELECTOR = '[editmode\\:contenteditable]';

export function disableContentEditableBeforeSave () {
  addDocumentTransform(docElem => {
    docElem.querySelectorAll(SELECTOR).forEach(canonicalContentEditable);
  });
}

export function enableContentEditableForAdminOnPageLoad () {
  if (!isEditMode) return;

  onDomReady(() => {
    enableContentEditable();
  });
}

// Runtime toggle functions. `root` lets scoped live sync activate a parsed
// incoming document the same way boot activates the live one.
export function enableContentEditable(root = document) {
  root.querySelectorAll(SELECTOR).forEach(el => {
    captureAuthored(el);
    // Already active (a second activation of the same node) keeps the value it already
    // holds, so re-running this never downgrades `plaintext-only` to `true`.
    const val = el.getAttribute("inert-contenteditable")
      ?? el.getAttribute("contenteditable")
      ?? authoredAttr(el, "inert-contenteditable")
      ?? "true";
    // Keywords match ASCII case-insensitively, so `FALSE` means false. The author's own
    // spelling is what gets written, so the save transform puts it back unchanged.
    const keyword = val.toLowerCase();
    el.setAttribute("contenteditable", ["", "true", "false", "plaintext-only"].includes(keyword) ? val : "true");
    el.removeAttribute("inert-contenteditable");
  });
}

export function disableContentEditable() {
  document.querySelectorAll(SELECTOR).forEach(el => {
    canonicalContentEditable(el);
    restoreAuthoredOrder(el);
  });
}

// Auto-initialize
export function init() {
  disableContentEditableBeforeSave();
  enableContentEditableForAdminOnPageLoad();
}
