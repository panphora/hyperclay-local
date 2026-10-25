import { isEditMode, isOwner } from "./is-edit-mode.js";
import onDomReady from "../lib/dom-ready.js";
import { addDocumentTransform } from "./snapshot.js";

export const SELECTOR = '[editmode\\:contenteditable]';

export function disableContentEditableBeforeSave () {
  addDocumentTransform(docElem => {
    docElem.querySelectorAll(SELECTOR).forEach(resource => {
      const originalValue = resource.getAttribute("contenteditable");
      resource.setAttribute("inert-contenteditable", originalValue === null ? "true" : originalValue);
      resource.removeAttribute("contenteditable");
    });
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
    const val = el.getAttribute("inert-contenteditable");
    // Keywords match ASCII case-insensitively, so `FALSE` means false. The author's own
    // spelling is what gets written, so the save transform puts it back unchanged.
    const keyword = val === null ? null : val.toLowerCase();
    el.setAttribute("contenteditable", ["", "true", "false", "plaintext-only"].includes(keyword) ? val : "true");
    el.removeAttribute("inert-contenteditable");
  });
}

export function disableContentEditable() {
  document.querySelectorAll(SELECTOR).forEach(el => {
    const val = el.getAttribute("contenteditable");
    el.setAttribute("inert-contenteditable", val === null ? "true" : val);
    el.removeAttribute("contenteditable");
  });
}

// Auto-initialize
export function init() {
  disableContentEditableBeforeSave();
  enableContentEditableForAdminOnPageLoad();
}
