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

   The editor it wires is one mode lease (see sortableParticipant): every instance,
   subscription, listener and pending restore belongs to the session that made it, so a
   page that leaves edit takes all of it back and a later entry starts from nothing
   instead of from the previous session's leftovers.

*/
import { isEditMode, startsAtImport } from "../core/is-edit-mode.js";
import Mutation from "../lib/mutation.js";
import { capabilitySelector } from "../lib/region-capabilities.js";
import { onSnapshot } from "../core/snapshot.js";
import { beginMove, holdMove, releaseMove, releaseAllMoves, recordMove } from "../lib/undo/capture-move.js";

const EDITOR_UI_SELECTOR = capabilitySelector('history');

// The CMS hides one `cms-template` row in every list it fills: it is the seed a new row is
// cloned from, never a row itself. A drag never picks one up, and a move neither takes one
// nor lands before one.
const SEED_SELECTOR = '[cms-template]';

// Sortable marks the picked-up item and its links and images draggable="false" on press, and
// leaves style="" behind after a drag. Those attributes would be saved into the document, so a
// mere click would change the file. Record them when an item is chosen and put them back after.
const RUNTIME_ATTRS = ['draggable', 'style'];

// A press ends on one of these, wherever it lands.
const ENDS = ['pointerup', 'pointercancel', 'dragend', 'drop'];

// What a press recorded, for the snapshot hook below.
const pressed = new Set();

// The page's vendor constructor, snapshot transform, and one sortable session. All three
// outlive a session: a second entry asks for what the page already has rather than adding
// a second copy of it.
let vendor = null;
let installation = null;
let session = null;

// Every listener and timer a session starts is recorded with its target, type and options,
// so cleanup removes the exact subscription instead of hoping a bare type is enough.
function track(record, target, type, handler, options) {
  const entry = { target, type, handler, options };
  target.addEventListener(type, handler, options);
  record.listeners.push(entry);
  return entry;
}

function untrack(record, entry) {
  entry.target.removeEventListener(entry.type, entry.handler, entry.options);
  const index = record.listeners.indexOf(entry);
  if (index !== -1) record.listeners.splice(index, 1);
}

function later(record, run) {
  const id = setTimeout(() => {
    record.timers.delete(id);
    run();
  }, 0);
  record.timers.add(id);
  return id;
}

function ownership(Sortable, root) {
  return {
    Sortable,
    root,
    admitted: false,
    instances: new Set(),
    listeners: [],
    timers: new Set(),
    presses: new Set(),
    stop: null,
  };
}

// A direct makeSortable() call, outside any session, is still wired the same way; nothing
// disposes it, which is what such a call asked for.
const loose = { admitted: true, instances: new Set(), listeners: [], timers: new Set(), presses: new Set() };

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

// What one of a container's items is: a list holds its own rows, any other element holds
// its element children.
function childSelector(container) {
  return /^(UL|OL)$/.test(container.tagName) ? 'li' : '*';
}

function draggableSelector(container) {
  return `> ${childSelector(container)}:not(${EDITOR_UI_SELECTOR})`;
}

// The half of eligibility a container can answer about a node it does not hold yet: is
// this the kind of child it takes, and is it a real row rather than furniture or a seed?
// makeSortable gives the vendor the same rules through draggableSelector.
function acceptsItem(container, node) {
  if (!container || !node || node.nodeType !== 1) return false;
  if (!node.matches(childSelector(container))) return false;
  return !node.closest(EDITOR_UI_SELECTOR) && !node.closest(SEED_SELECTOR);
}

function isItemOf(container, node) {
  if (!container || !node || node.parentElement !== container) return false;
  return acceptsItem(container, node);
}

// The next thing in the container that counts as an item. A seed row or a piece of editor
// furniture between two rows is not a position, so it is stepped over.
function nextItem(container, node) {
  let sibling = node.nextElementSibling;
  while (sibling && !isItemOf(container, sibling)) sibling = sibling.nextElementSibling;
  return sibling;
}

// SortableJS reports a position as the item's element index among its container's
// children, and the facade keeps that convention so a drag report and a move report read
// the same way. Nothing in a template's intent should ever depend on these.
function elementIndex(container, node) {
  return Array.prototype.indexOf.call(container.children, node);
}

// The one notification a completed reorder makes. A drag and clay.sortable.move() both
// reach it exactly once: the source container's author code, then `clay:sorted` with what
// moved, then the compatibility input event, both dispatched on the source container and
// bubbling from it.
function finishMove(result, onSorted) {
  if (onSorted) {
    try {
      const asyncFn = new Function(`return (async function(evt) { ${onSorted} })`)();
      asyncFn.call(result.from, result);
    } catch (error) {
      console.error('Error in onsorted execution:', error);
    }
  }
  // Announce the reorder as a real, self-documenting event carrying what moved.
  // Reactive libs (e.g. Sap) and author code key off this without us knowing
  // about them. Fires only in edit mode, since sortable only inits there.
  result.from.dispatchEvent(new CustomEvent('clay:sorted', {
    bubbles: true,
    detail: {
      item: result.item,
      from: result.from,
      to: result.to,
      oldIndex: result.oldIndex,
      newIndex: result.newIndex,
    },
  }));
  // DEPRECATED: early versions dispatched a synthetic `input` here so reactive
  // libs would re-derive. It is semantically off (a container has no value) and
  // now redundant with clay:sorted and the mutation observers. Kept as a compat shim.
  result.from.dispatchEvent(new Event('input', { bubbles: true }));
}

function makeSortable(sortableElem, Sortable, record = loose) {
  let options = {};
  options.draggable = draggableSelector(sortableElem);

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
      if (!record.admitted) return;
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
    // A session that has closed admission has already handed the page to the exit's
    // barrier. The drop it allowed is not a new edit, so nothing of it reaches an author
    // handler, a reactive engine or the file.
    if (!record.admitted) return;
    const result = { item: evt.item, from: evt.from, to: evt.to, oldIndex: evt.oldIndex, newIndex: evt.newIndex };
    const start = press;
    press = null;
    // The runtime attributes go back before the move is recorded, so the entry holds
    // the move and nothing of what the vendor wrote around it.
    if (restoring) {
      restoreRuntimeAttrs(restoring);
      restoring = null;
    }
    if (start) {
      recordMove(start, result);
      releaseMove(start);
    }
    finishMove(result, onsortedCode);
  };

  // Record on the capture phase, before Sortable's own press handler changes anything, and
  // restore once the press ends: a plain click never fires Sortable's unchoose.
  let recorded = null;
  let press = null;
  let restoring = null;
  let started = false;
  let ends = [];
  // A press that ends without a drop (a click, a cancel) still has to hand the
  // gesture's exclusion back: the drop itself releases it once its entry is recorded.
  const endPress = () => {
    const start = press;
    press = null;
    restoring = null;
    releaseMove(start);
  };
  const restoreSoon = () => {
    const pending = recorded;
    recorded = null;
    if (pending) {
      record.presses.delete(pending);
      pressed.delete(pending);
      restoring = pending;
    }
    ends.forEach(entry => untrack(record, entry));
    ends = [];
    if (pending) later(record, () => restoreRuntimeAttrs(pending));
  };
  const settleSoon = () => {
    // Only the press that became a drag holds: a click has nothing to keep out of
    // history, and its own handler's writes are the next entry.
    if (started) {
      holdMove(press);
    } else {
      releaseMove(press);
      press = null;
    }
    started = false;
    restoreSoon();
    later(record, endPress);
  };
  track(record, sortableElem, 'pointerdown', (event) => {
    let item = event.target instanceof Element ? event.target : null;
    while (item && item.parentElement !== sortableElem) item = item.parentElement;
    if (!item || recorded) return;
    recorded = recordRuntimeAttrs(item);
    press = beginMove(item);
    started = false;
    record.presses.add(recorded);
    pressed.add(recorded);
    ends = ENDS.map(type => track(record, document, type, settleSoon, true));
  }, true);
  options.onUnchoose = restoreSoon;
  // The one signal a click never makes: Sortable says the press became a drag, so this
  // press is the one that may hold the engine. A click's own writes are history's.
  options.onStart = () => {
    started = true;
  };

  Sortable.create(sortableElem, options);
  record.instances.add(sortableElem);
}

// The semantic move: the reorder a drag makes, without dragging, without SortableJS and
// without waiting for it. Everything is validated before anything moves, and every
// refusal says why. It does not guess: an anchor that is gone is refused rather than
// re-targeted at a neighbour, and a request to stay put is not an insertion, an event or
// a history entry.
function move(item, toContainer, beforeItem = null) {
  const refusal = (code) => ({ ok: false, code });

  if (!isEditMode) return refusal('not-editable');
  // Admission is the session's, exactly as a drag's is: a lease whose exit is already
  // running has handed the page on, and a move is a new edit.
  if (session && !session.admitted) return refusal('not-editable');

  const doc = document;
  if (!item || item.nodeType !== 1 || !item.isConnected || item.ownerDocument !== doc) {
    return refusal('detached');
  }
  const from = item.parentElement;
  if (!from || !from.isConnected) return refusal('detached');
  if (!toContainer || toContainer.nodeType !== 1 || !toContainer.isConnected || toContainer.ownerDocument !== doc) {
    return refusal('detached');
  }
  // The item has to be one of its source's own items, and the destination has to be a
  // declared sortable that would hold it. A subtree cannot be moved into itself.
  if (!from.hasAttribute('sortable') || !isItemOf(from, item)) return refusal('item');
  if (!toContainer.hasAttribute('sortable') || !acceptsItem(toContainer, item)) return refusal('item');
  if (item === toContainer || item.contains(toContainer)) return refusal('item');
  // Crossing containers needs an equal, named group on both. Within one container there
  // is nothing to compare, and SortableJS's own ungrouped lists stay single-list too.
  if (from !== toContainer) {
    const group = from.getAttribute('sortable');
    if (!group || group !== toContainer.getAttribute('sortable')) return refusal('group');
  }
  // Asked to land before itself, the item is already where the call wants it.
  if (beforeItem === item) return { ok: true, moved: false };
  if (beforeItem !== null && !isItemOf(toContainer, beforeItem)) return refusal('anchor');
  // The position the item already holds is not a move.
  if (from === toContainer && nextItem(from, item) === beforeItem) return { ok: true, moved: false };

  const oldIndex = elementIndex(from, item);
  const start = beginMove(item);
  holdMove(start);
  let result;
  try {
    toContainer.insertBefore(item, beforeItem);
    result = { item, from, to: toContainer, oldIndex, newIndex: elementIndex(toContainer, item) };
    recordMove(start, result);
  } finally {
    releaseMove(start);
  }
  finishMove(result, from.getAttribute('onsorted'));
  return { ok: true, moved: true, ...result };
}

// Sortable's UMD header picks its target at run time: window.Sortable when no
// module system is present (a module load, and the single-file build), a
// default export when a bundler hands it one. Cover both. A failed fetch is forgotten,
// so the next entry asks again instead of inheriting the rejection.
function loadVendor() {
  if (!vendor) {
    vendor = import('../vendor/Sortable.vendor.js').then((mod) => window.Sortable || mod.default);
    vendor.catch(() => { vendor = null; });
  }
  return vendor;
}

// A save taken mid-drag would otherwise write Sortable's classes and attributes into the
// file. Strip them from the snapshot clone only, so the live drag carries on untouched.
// Installed once, and it reads whatever the live session recorded.
function install() {
  if (installation) return installation;
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
  installation = true;
  return installation;
}

// One edit session over the live DOM. `enable` creates the instances and starts watching
// for containers that arrive afterwards; `quiesce` closes admission, so a drag that ends
// after it produces no event; `resume` is the refused exit; `dispose` destroys every
// instance this session created and removes exactly the subscriptions it added.
function sortableLease(record) {
  return {
    enable() {
      if (record.admitted) return;
      record.admitted = true;
      for (const el of record.root.querySelectorAll('[sortable]')) makeSortable(el, record.Sortable, record);
      // Set up listener for dynamically added elements.
      // require:'observed' so drag works inside no-save / save-* regions (e.g. the
      // CMS panel); pausable:false so it keeps wiring during a live-sync pause.
      record.stop = Mutation.onAddElement({
        selectorFilter: "[sortable]",
        debounce: 200,
        require: 'observed',
        pausable: false
      }, (changes) => {
        if (!record.admitted) return;
        changes.forEach(({ element }) => {
          makeSortable(element, record.Sortable, record);
        });
      });
    },
    quiesce() {
      record.admitted = false;
    },
    resume() {
      record.admitted = true;
    },
    dispose() {
      record.admitted = false;
      if (record.stop) {
        record.stop();
        record.stop = null;
      }
      for (const entry of [...record.listeners]) untrack(record, entry);
      for (const id of record.timers) clearTimeout(id);
      record.timers.clear();
      for (const recording of record.presses) pressed.delete(recording);
      record.presses.clear();
      releaseAllMoves();
      for (const el of record.instances) record.Sortable?.get?.(el)?.destroy?.();
      record.instances.clear();
      if (session === record) session = null;
    },
  };
}

const isStale = (context) => {
  if (!context) return false;
  if (context.signal?.aborted) return true;
  return typeof context.isCurrent === "function" && !context.isCurrent();
};

/**
 * Sortable as a mode participant: the drag editor the commit that enters edit starts, and
 * the one the exit takes back.
 *
 * `prepare` fetches the vendor and answers with the lease; the fetch can outlive the
 * session that asked for it, so the generation is asked again once it is here. `enable`
 * creates the instances. `quiesce` refuses a completion that arrives after it. `dispose`
 * destroys the instances and hands back every listener and timer this session started.
 */
export function sortableParticipant(root = document) {
  return {
    id: "clay:sortable",
    order: 300,
    async prepare(context = {}) {
      if (context.initial === true) return adopt();
      const Sortable = await loadVendor();
      if (isStale(context)) {
        throw Object.assign(new Error("clay:sortable prepared for a stale generation"), { code: "stale-document" });
      }
      install();
      return sortableLease(session || (session = ownership(Sortable, root)));
    },
  };
}

// The boot this tab already made, adopted instead of prepared: it is the session `init`
// below enabled, or, on a boot that started none, nothing to hand back.
async function adopt() {
  const lease = await ready;
  return { enable() {}, quiesce: () => lease?.quiesce(), resume: () => lease?.resume(), dispose: () => lease?.dispose() };
}

// Auto-init when module is imported; the loader awaits `ready` before resolving clay.ready
async function init() {
  if (!startsAtImport()) return null;
  const lease = await sortableParticipant().prepare();
  lease.enable();
  return lease;
}

const ready = init();

// What the loader publishes on clay.sortable as soon as this module evaluates, so a move
// control never waits for the vendor the drag editor awaits.
const sortable = Object.freeze({ move });

export { init, ready, makeSortable, move, sortable };
export { sortableParticipant as modeParticipant };
export default init;
