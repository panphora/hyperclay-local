import { isEditMode, isOwner } from "./is-edit-mode.js";
import onDomReady from "../lib/dom-ready.js";
import { addDocumentTransform, originalSnapshotNode } from "./snapshot.js";

export const SELECTOR_DISABLED = '[viewmode\\:disabled]';
export const SELECTOR_READONLY = '[viewmode\\:readonly]';

const BOOLEANS = [[SELECTOR_DISABLED, 'disabled'], [SELECTOR_READONLY, 'readonly']];

// What the author wrote for `disabled` / `readonly` on each live element, from before
// edit mode removed it. A boolean attribute means the same whatever its value, so this
// is only about handing the file back its own spelling (`disabled="disabled"`).
const authored = new WeakMap();

export function disableAdminInputsBeforeSave() {
  addDocumentTransform(docElem => {
    for (const [selector, name] of BOOLEANS) {
      docElem.querySelectorAll(selector).forEach(input => {
        if (input.hasAttribute(name)) return;
        const live = originalSnapshotNode(input);
        const spelled = live && authored.get(live);
        input.setAttribute(name, spelled && spelled[name] !== undefined ? spelled[name] : '');
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
      const value = input.getAttribute(name);
      if (value !== null) authored.set(input, { ...(authored.get(input) || {}), [name]: value });
      input.removeAttribute(name);
    });
  }
}

export function disableAdminInputs() {
  document.querySelectorAll(SELECTOR_DISABLED).forEach(input => {
    input.setAttribute('disabled', '');
  });
  document.querySelectorAll(SELECTOR_READONLY).forEach(input => {
    input.setAttribute('readonly', '');
  });
}

export function init() {
  disableAdminInputsBeforeSave();
  enableAdminInputsOnPageLoad();
}
