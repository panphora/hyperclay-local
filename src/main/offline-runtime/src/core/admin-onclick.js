import { isEditMode, isOwner } from "./is-edit-mode.js";
import onDomReady from "../lib/dom-ready.js";
import { addDocumentTransform } from "./snapshot.js";

export const SELECTOR = '[editmode\\:onclick]';

export function disableOnClickBeforeSave () {
  addDocumentTransform(docElem => {
    docElem.querySelectorAll(SELECTOR).forEach(resource => {
      const originalValue = resource.getAttribute("onclick");
      // Only an element edit mode activated has an onclick to put back. One whose
      // inert-onclick was empty or missing was never activated, so its authored
      // attributes are already right, and `setAttribute(name, null)` would store the
      // string "null" in the file.
      if (originalValue === null) return;
      resource.setAttribute("inert-onclick", originalValue);
      resource.removeAttribute("onclick");
    });
  });
}

export function enableOnClickForAdminOnPageLoad () {
  if (!isEditMode) return;

  onDomReady(() => {
    enableOnClick();
  });
}

// Runtime toggle functions. `root` lets scoped live sync activate a parsed
// incoming document the same way boot activates the live one.
export function enableOnClick(root = document) {
  root.querySelectorAll(SELECTOR).forEach(el => {
    const val = el.getAttribute("inert-onclick");
    if (val) {
      el.setAttribute("onclick", val);
      el.removeAttribute("inert-onclick");
    }
  });
}

export function disableOnClick() {
  document.querySelectorAll(SELECTOR).forEach(el => {
    const val = el.getAttribute("onclick");
    if (val) {
      el.setAttribute("inert-onclick", val);
      el.removeAttribute("onclick");
    }
  });
}

// Auto-initialize
export function init() {
  disableOnClickBeforeSave();
  enableOnClickForAdminOnPageLoad();
}
