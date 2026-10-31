import { SNAPSHOT_REMOVE_SELECTOR } from '../lib/region-policy.js';
import { EXTENSION_NODE_SELECTOR } from '../lib/extension-noise.js';

export const EDITING_PATH = /^\d{1,4}(?:\.\d{1,4}){0,63}$/;
const MAX_DEPTH = 64;
const MAX_INDEX = 9999;
const CONTROLS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const EDITABLE = '[contenteditable]:not([contenteditable="false"])';
const LOCAL = `${SNAPSHOT_REMOVE_SELECTOR}, ${EXTENSION_NODE_SELECTOR}`;

const sharedChildren = (parent) => Array.from(parent.children).filter((child) => !child.matches(LOCAL));

export function blockOf(target) {
  if (!target || target.nodeType !== 1 || typeof target.closest !== 'function') return null;
  if (CONTROLS.has(target.tagName)) return target;
  const host = target.closest(EDITABLE);
  if (!host) return null;
  const selection = typeof document.getSelection === 'function' ? document.getSelection() : null;
  let node = selection && selection.rangeCount ? selection.focusNode : null;
  if (node && node.nodeType !== 1) node = node.parentElement;
  if (!node || node === host || !host.contains(node)) return host;
  while (node.parentElement && node.parentElement !== host) node = node.parentElement;
  return node.parentElement === host ? node : host;
}

export function pathOf(element) {
  const body = document.body;
  if (!element || !body || element === body || !body.contains(element) || element.closest(LOCAL)) return null;
  const indices = [];
  for (let node = element; node !== body; node = node.parentElement) {
    const index = sharedChildren(node.parentElement).indexOf(node);
    if (index < 0 || index > MAX_INDEX || indices.length === MAX_DEPTH) return null;
    indices.unshift(index);
  }
  return indices.join('.');
}

export function elementAt(path) {
  if (typeof path !== 'string' || !EDITING_PATH.test(path) || !document.body) return null;
  let node = document.body;
  for (const part of path.split('.')) {
    node = sharedChildren(node)[Number(part)];
    if (!node) return null;
  }
  return node;
}
