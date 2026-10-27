// clay.effect(fn): run fn soon and again after anything that can change what it
// reads. Local edits arrive through the mutation hub; a live-sync merge runs with
// the hub paused, so clay:sync-applied covers it; undo and redo write through the
// hub as well, and their events are a backstop. fn runs with the hub paused, so
// its own writes (derived counts, totals) never re-trigger it, never start an
// autosave and never enter undo history. The first run is on a microtask too:
// pausing the hub mid-way through an undo.commit would split the command. fn must
// be synchronous: writes after an await land outside the pause and would loop.
//
// In edit mode each effect warns once about the misuses it can see: a write to
// saved, dirty-tracked content (saved with the file, but never marks it unsaved),
// an effect created inside an effect, undo.commit inside an effect (checked by the
// undo plugin through effect.running), and an effect that keeps re-running.
import { isTabLocalAttr } from "./root-attrs.js";

const LOOP_RUNS = 50;
const LOOP_WINDOW_MS = 1000;
const NO_SNAPSHOT = '[clay~="no-snapshot"], [no-snapshot], [snapshot-remove]';

let running = 0;

const describe = (node) => {
  const el = node.nodeType === 1 ? node : node.parentElement;
  if (!el) return "a detached node";
  let s = el.localName;
  if (el.id) s += "#" + el.id;
  else if (el.classList.length) s += "." + [...el.classList].slice(0, 2).join(".");
  return "<" + s + ">";
};

function savedWrite(records) {
  const policy = window.clay?.region?.resolveRegionPolicy;
  if (!policy) return null;
  const tracked = (el) => !!el && !el.closest(NO_SNAPSHOT) && policy(el).dirtyTracked;
  for (const r of records) {
    if (r.type === "attributes" && isTabLocalAttr(r.attributeName, r.target)) continue;
    const el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
    if (!tracked(el)) continue;
    // A child added or removed counts only when it is saved itself: chrome
    // inserted into a saved parent (clay="editor-ui") is stripped on save.
    if (r.type === "childList" && ![...r.addedNodes, ...r.removedNodes].some((n) => n.nodeType !== 1 || tracked(n))) continue;
    return r.target;
  }
  return null;
}

export function effect(fn) {
  const clay = window.clay;
  const Mutation = clay.Mutation;
  const warned = new Set();
  const warn = (key, message) => {
    if (warned.has(key)) return;
    warned.add(key);
    console.warn("clay.effect: " + message);
  };
  let queued = false;
  let stopped = false;
  let windowStart = 0;
  let runs = 0;

  if (running && clay.isEditMode) {
    console.warn("clay.effect: an effect was created inside another effect, so a new one starts on every run. Create effects once, in clay.start.");
  }

  const watchLoop = () => {
    const now = Date.now();
    if (now - windowStart > LOOP_WINDOW_MS) { windowStart = now; runs = 0; }
    if (++runs > LOOP_RUNS) {
      warn("loop", `this effect ran more than ${LOOP_RUNS} times in a second. Something keeps changing the document, often a timer or async callback the effect started.`);
    }
  };

  const run = () => {
    queued = false;
    if (stopped) return;
    let observer = null;
    Mutation.pause();
    running++;
    try {
      if (clay.isEditMode === true) {
        watchLoop();
        if (!warned.has("saved")) {
          observer = new MutationObserver(() => {});
          observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
        }
      }
      const result = fn();
      if (result && typeof result.then === "function") {
        stop();
        console.error("clay.effect: fn returned a promise. It must be synchronous, so this effect was stopped.");
      }
    } catch (err) {
      console.error("clay.effect:", err);
    } finally {
      running--;
      Mutation.resume();
      const records = observer ? observer.takeRecords() : [];
      observer?.disconnect();
      if (records.length) {
        const target = savedWrite(records);
        if (target) {
          warn("saved", `this effect changed ${describe(target)}, which is saved with the file. Effect writes never mark the page unsaved, so a merge can leave it dirty with no save scheduled. Draw derived values inside clay="no-dirty" or clay="editor-ui".`);
        }
      }
    }
  };
  const schedule = () => {
    if (queued || stopped) return;
    queued = true;
    queueMicrotask(run);
  };

  const undoEvents = ["undo", "redo"];
  const bindUndo = () => {
    for (const type of undoEvents) clay.undo?.on?.(type, schedule);
  };

  const offMutation = Mutation.onAnyChange({ debounce: 0, require: "observed" }, schedule);
  document.addEventListener("clay:sync-applied", schedule);
  document.addEventListener("clay:modechange", bindUndo);
  bindUndo();

  const stop = () => {
    stopped = true;
    offMutation();
    document.removeEventListener("clay:sync-applied", schedule);
    document.removeEventListener("clay:modechange", bindUndo);
    for (const type of undoEvents) clay.undo?.off?.(type, schedule);
  };

  schedule();
  return stop;
}

Object.defineProperty(effect, "running", { get: () => running > 0 });
