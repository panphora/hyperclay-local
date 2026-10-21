import { isEditMode, isOwner } from "./is-edit-mode.js";
import onDomReady from "../lib/dom-ready.js";
import { addDocumentTransform } from "./snapshot.js";

export const SELECTOR = '[editmode\\:resource]:is(style, link, script)';
export const SELECTOR_INERT = '[editmode\\:resource]:is(style, link, script)[type^="inert/"]';

const INERT_PREFIX = 'inert/';

// An absent type is recorded as an empty remainder, so enabling restores absence
// rather than inventing text/javascript. A <style> or a stylesheet <link> handed a
// JavaScript MIME on the way back never applies again.
function makeInert(resource) {
  const current = resource.getAttribute('type');
  if (current && current.startsWith(INERT_PREFIX)) return false;
  resource.setAttribute('type', INERT_PREFIX + (current || ''));
  return true;
}

function makeActive(resource) {
  const original = resource.getAttribute('type').slice(INERT_PREFIX.length);
  if (original) resource.setAttribute('type', original);
  else resource.removeAttribute('type');
}

export function disableAdminResourcesBeforeSave () {
  addDocumentTransform(docElem => {
    docElem.querySelectorAll(SELECTOR).forEach(makeInert);
  });
}

export function enableAdminResourcesOnPageLoad () {
  if (!isEditMode) return;

  onDomReady(() => {
    enableAdminResources();
  });
}

// Runtime toggle functions. `root` lets scoped live sync activate a parsed
// incoming document; the clone-swap re-execution trick only applies to the
// live document — in a detached parse nothing executes, and the morph's own
// script handling decides execution when the content lands.
export function enableAdminResources(root = document) {
  const live = (root.ownerDocument || root) === document;
  root.querySelectorAll(SELECTOR_INERT).forEach(resource => {
    makeActive(resource);
    if (live) resource.replaceWith(resource.cloneNode(true));
  });
}

export function disableAdminResources() {
  document.querySelectorAll(SELECTOR).forEach(resource => {
    if (makeInert(resource)) resource.replaceWith(resource.cloneNode(true));
  });
}

// Auto-initialize
export function init() {
  disableAdminResourcesBeforeSave();
  enableAdminResourcesOnPageLoad();
}
