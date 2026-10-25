/*

   Make elements drag-and-drop sortable

   How to use:
   - add `sortable` attribute to an element to make children sortable
   - e.g. <div sortable></div>
   - add `onsorting` attribute to execute code during drag
   - e.g. <ul sortable onsorting="console.log('Dragging!')"></ul>
   - add `onsorted` attribute to execute code when items are sorted
   - e.g. <ul sortable onsorted="console.log('Items reordered!')"></ul>

   This wrapper conditionally loads the full Sortable.js vendor script (~118KB)
   only when in edit mode, using dynamic import().

*/
import { isEditMode } from "../core/is-edit-mode.js";
import Mutation from "../lib/mutation.js";
import { capabilitySelector } from "../lib/region-capabilities.js";
import { onSnapshot } from "../core/snapshot.js";

const EDITOR_UI_SELECTOR = capabilitySelector('history');

// Sortable marks the picked-up item and its links and images draggable="false" on press, and
// leaves style="" behind after a drag. Those attributes would be saved into the document, so a
// mere click would change the file. Record them when an item is chosen and put them back after.
const RUNTIME_ATTRS = ['draggable', 'style'];

const pressed = new Set();

function recordRuntimeAttrs(item) {
  return [item, ...item.querySelectorAll('*')]
    .filter(el => !el.closest(EDITOR_UI_SELECTOR))
    .map(el => [el, RUNTIME_ATTRS.map(name => el.getAttribute(name))]);
}

function restoreRuntimeAttrs(recorded) {
  for (const [el, values] of recorded) {
    RUNTIME_ATTRS.forEach((name, i) => {
      const before = values[i];
      const now = el.getAttribute(name);
      if (now === before) return;
      if (before === null) {
        if (name === 'style' && now) return;
        el.removeAttribute(name);
      } else {
        el.setAttribute(name, before);
      }
    });
  }
}

function makeSortable(sortableElem, Sortable) {
  let options = {};
  const childSelector = /^(UL|OL)$/.test(sortableElem.tagName) ? 'li' : '*';
  options.draggable = `> ${childSelector}:not(${EDITOR_UI_SELECTOR})`;

  // Check if Sortable instance already exists
  if (Sortable.get(sortableElem)) return;

  const groupName = sortableElem.getAttribute('sortable');
  if (groupName) options.group = groupName;

  // Check for handles, but exclude those inside nested sortable elements
  const handles = sortableElem.querySelectorAll('[sortable-handle]');
  const nestedSortables = sortableElem.querySelectorAll('[sortable]');

  // Check if any handle is NOT inside a nested sortable
  const hasDirectHandle = Array.from(handles).some(handle => {
    return !Array.from(nestedSortables).some(nested => nested.contains(handle));
  });

  if (hasDirectHandle) {
    options.handle = '[sortable-handle]';
  }

  // Add onsorting callback if attribute exists (fires during drag)
  const onsortingCode = sortableElem.getAttribute('onsorting');
  if (onsortingCode) {
    options.onMove = function(evt) {
      try {
        const asyncFn = new Function(`return (async function(evt) { ${onsortingCode} })`)();
        asyncFn.call(sortableElem, evt);
      } catch (error) {
        console.error('Error in onsorting execution:', error);
      }
    };
  }

  // After a drop, run any author onsorted code, then notify reactive libraries.
  const onsortedCode = sortableElem.getAttribute('onsorted');
  options.onEnd = function(evt) {
    if (onsortedCode) {
      try {
        const asyncFn = new Function(`return (async function(evt) { ${onsortedCode} })`)();
        asyncFn.call(sortableElem, evt);
      } catch (error) {
        console.error('Error in onsorted execution:', error);
      }
    }
    // Announce the reorder as a real, self-documenting event carrying what moved.
    // Reactive libs (e.g. Sap) and author code key off this without us knowing
    // about them. Fires only in edit mode, since sortable only inits there.
    sortableElem.dispatchEvent(new CustomEvent('clay:sorted', {
      bubbles: true,
      detail: {
        item: evt.item,
        from: evt.from,
        to: evt.to,
        oldIndex: evt.oldIndex,
        newIndex: evt.newIndex,
      },
    }));
    // DEPRECATED: early versions dispatched a synthetic `input` here so reactive
    // libs would re-derive. It is semantically off (a container has no value) and
    // now redundant with clay:sorted and the mutation observers. Kept as a compat shim.
    sortableElem.dispatchEvent(new Event('input', { bubbles: true }));
  };

  // Record on the capture phase, before Sortable's own press handler changes anything, and
  // restore once the press ends: a plain click never fires Sortable's unchoose.
  const ENDS = ['pointerup', 'pointercancel', 'dragend', 'drop'];
  let recorded = null;
  const restoreSoon = () => {
    const pending = recorded;
    recorded = null;
    pressed.delete(pending);
    ENDS.forEach(type => document.removeEventListener(type, restoreSoon, true));
    if (pending) setTimeout(() => restoreRuntimeAttrs(pending), 0);
  };
  sortableElem.addEventListener('pointerdown', (event) => {
    let item = event.target instanceof Element ? event.target : null;
    while (item && item.parentElement !== sortableElem) item = item.parentElement;
    if (!item || recorded) return;
    recorded = recordRuntimeAttrs(item);
    pressed.add(recorded);
    ENDS.forEach(type => document.addEventListener(type, restoreSoon, true));
  }, true);
  options.onUnchoose = restoreSoon;

  Sortable.create(sortableElem, options);
}

async function init() {
  if (!isEditMode) return;

  // Sortable's UMD header picks its target at run time: window.Sortable when no
  // module system is present (a module load, and the single-file build), a
  // default export when a bundler hands it one. Cover both.
  const mod = await import('../vendor/Sortable.vendor.js');
  const Sortable = window.Sortable || mod.default;

  // A save taken mid-drag would otherwise write Sortable's classes and attributes into the
  // file. Strip them from the snapshot clone only, so the live drag carries on untouched.
  onSnapshot((root, { original }) => {
    for (const el of root.querySelectorAll("[sortable] .sortable-chosen, [sortable] .sortable-ghost, [sortable] .sortable-drag")) {
      el.classList.remove("sortable-chosen", "sortable-ghost", "sortable-drag");
      if (!el.classList.length) el.removeAttribute("class");
    }
    if (!pressed.size) return;
    const before = new Map();
    for (const recording of pressed) for (const [el, values] of recording) before.set(el, values);
    for (const el of root.querySelectorAll("[sortable] *")) {
      const values = before.get(original(el));
      if (!values) continue;
      RUNTIME_ATTRS.forEach((name, i) => {
        if (values[i] === null) el.removeAttribute(name); else el.setAttribute(name, values[i]);
      });
    }
  });

  // Set up sortable on page load
  document.querySelectorAll('[sortable]').forEach(el => makeSortable(el, Sortable));

  // Set up listener for dynamically added elements.
  // require:'observed' so drag works inside no-save / save-* regions (e.g. the
  // CMS panel); pausable:false so it keeps wiring during a live-sync pause.
  Mutation.onAddElement({
    selectorFilter: "[sortable]",
    debounce: 200,
    require: 'observed',
    pausable: false
  }, (changes) => {
    changes.forEach(({ element }) => {
      makeSortable(element, Sortable);
    });
  });
}

// Auto-init when module is imported; the loader awaits `ready` before resolving clay.ready
const ready = init();

export { init, ready, makeSortable };
export default init;
