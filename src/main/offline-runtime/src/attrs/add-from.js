/**
 * [add-from] Custom Attribute
 *
 * Adds a new item from a <template> on click. Edit mode only: this module is in
 * the edit-only wave, so a visitor's page never loads it.
 *
 * Usage:
 *   <button add-from="#task-tpl" add-to="#tasks">Add task</button>
 *
 * The template's first element is cloned, given a fresh data-id unless it already
 * has one (templates carry none), and appended to the add-to element. Its first
 * editable field is focused with its text selected, so typing replaces the
 * placeholder. Ids are built without crypto.randomUUID, which is missing outside
 * a secure context.
 */

const FIELD = '[contenteditable]:not([contenteditable="false"]), input, textarea';

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function find(selector) {
  if (!selector) return null;
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

function focusField(item) {
  const field = item.matches(FIELD) ? item : item.querySelector(FIELD);
  if (!field) return;
  field.focus();
  if (typeof field.select === "function") return field.select();
  const range = document.createRange();
  range.selectNodeContents(field);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

export function addFrom(trigger) {
  const template = find(trigger.getAttribute("add-from"));
  const list = find(trigger.getAttribute("add-to"));
  const blueprint = template?.content?.firstElementChild;
  if (!blueprint || !list) {
    console.warn("[add-from] add-from must name a <template> and add-to the element to add into", trigger);
    return null;
  }
  const item = blueprint.cloneNode(true);
  if (!item.getAttribute("data-id")) item.setAttribute("data-id", newId());
  list.append(item);
  focusField(item);
  return item;
}

function onClick(event) {
  const trigger = event.target.closest?.("[add-from]");
  if (!trigger) return;
  event.preventDefault();
  addFrom(trigger);
}

function init() {
  document.addEventListener("click", onClick);
}

init();

export default init;
