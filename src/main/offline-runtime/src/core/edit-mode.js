// Edit mode system - combines the editmode toggle with page type setting.
// Loads in BOTH view and edit mode: toggleEditMode must exist in view mode
// (it's the way IN), and setPageTypeOnPageLoad marks <html> in either mode.
import { isDraftMode, isEditMode, isOwner } from "./is-edit-mode.js";
import onDomReady from "../lib/dom-ready.js";
import { addDocumentTransform } from "./snapshot.js";

export function toggleEditMode() {
  const url = new URL(window.location.href);
  const newMode = isEditMode && !isDraftMode ? "false" : "true";
  url.searchParams.set('editmode', newMode);
  window.location.href = url.toString();
}

export function setViewerPageTypeBeforeSave () {
  addDocumentTransform(docElem => {
    docElem.setAttribute("editmode", "false");
    docElem.setAttribute("pageowner", "false");
  });
}

export function setPageTypeOnPageLoad () {
  onDomReady(() => {
    document.documentElement.setAttribute("editmode", isEditMode ? "true" : "false");
    document.documentElement.setAttribute("pageowner", isOwner ? "true" : "false");
    if (isDraftMode) {
      document.documentElement.setAttribute("draftmode", "true");
    } else {
      document.documentElement.removeAttribute("draftmode");
    }
  });
}

function init() {
  setViewerPageTypeBeforeSave();
  setPageTypeOnPageLoad();
}

// Auto-init when module is imported
init();

export { init, isEditMode, isOwner };
export default { init, toggleEditMode, isEditMode, isOwner };
