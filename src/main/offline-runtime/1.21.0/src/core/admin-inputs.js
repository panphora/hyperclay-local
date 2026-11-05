import { isEditMode, isOwner } from "./is-edit-mode.js";
import onDomReady from "../lib/dom-ready.js";
import { addDocumentTransform, originalSnapshotNode } from "./snapshot.js";
import { authoredAttr, captureAuthored, restoreAuthoredOrder } from "./preserve-authored.js";

export const SELECTOR_DISABLED = '[viewmode\\:disabled]';
export const SELECTOR_READONLY = '[viewmode\\:readonly]';

const BOOLEANS = [[SELECTOR_DISABLED, 'disabled'], [SELECTOR_READONLY, 'readonly']];

export function disableAdminInputsBeforeSave() {
  addDocumentTransform(docElem => {
    for (const [selector, name] of BOOLEANS) {
      docElem.querySelectorAll(selector).forEach(input => {
        if (input.hasAttribute(name)) return;
        const live = originalSnapshotNode(input);
        const spelled = live ? authoredAttr(live, name) : null;
        input.setAttribute(name, spelled === null ? '' : spelled);
        restoreAuthoredOrder(input, live ?? input);
      });
    }
  });
}

export function enableAdminInputsOnPageLoad() {
  if (!isEditMode) return;

  onDomReady(() => {
    enableAdminInputs();
  });
}

// `root` lets scoped live sync activate a parsed incoming document the same
// way boot activates the live one.
export function enableAdminInputs(root = document) {
  for (const [selector, name] of BOOLEANS) {
    root.querySelectorAll(selector).forEach(input => {
      captureAuthored(input);
      input.removeAttribute(name);
    });
  }
}

// A boolean attribute means the same whatever its value, so the point of putting it
// back is handing the file its own spelling (`disabled="disabled"`) instead of `""`.
export function disableAdminInputs() {
  for (const [selector, name] of BOOLEANS) {
    document.querySelectorAll(selector).forEach(input => {
      const spelled = authoredAttr(input, name);
      if (spelled === null) input.removeAttribute(name);
      else input.setAttribute(name, spelled);
      restoreAuthoredOrder(input);
    });
  }
}

export function init() {
  disableAdminInputsBeforeSave();
  enableAdminInputsOnPageLoad();
}
