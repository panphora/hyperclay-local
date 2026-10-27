// richclay's toolbar, menus, floating toolbar and link dialog, raised above the host
// page by its skin. The vendor bundle is unchanged; the skin goes in first, so the
// editor never draws a frame of chrome the page can repaint.
import { installSkin } from "../ui/vendor-skin.js";
import { CSS, ROOTS } from "../ui/skins/richclay.js";
import { RichClay } from "../vendor/richclay.vendor.js";
import { startsAtImport } from "../core/is-edit-mode.js";

installSkin("richclay", CSS, { roots: ROOTS });

let session = null;

const fault = (message, code) => Object.assign(new Error(`clay:richclay: ${message}`), { code });

const isStale = (context) => {
  if (!context) return false;
  if (context.signal?.aborted) return true;
  return typeof context.isCurrent === "function" && !context.isCurrent();
};

const ownership = (root) => ({
  root,
  win: root.ownerDocument?.defaultView || window,
  admitted: false,
  stopWatch: null,
  subscriber: null,
});

const elements = (record) => [...record.root.querySelectorAll(RichClay.selector)];

// Mounts the regions the page has, and repairs the ones an applied frame stripped: a frame's
// snapshot carries none of RichClay's runtime state, and the merge removes live attributes
// the merged page lacks, so an applied frame leaves editors that can no longer be typed
// into. RichClay's reattach() restores them.
function mount(record) {
  for (const editor of RichClay.init(elements(record))) editor.reattach();
}

// One edit session over the live DOM. `enable` mounts the page's regions and starts the one
// watcher for regions that arrive later; `quiesce` closes admission, so a region that
// arrives while the exit runs is given no editor; `resume` is the refused exit, over the
// same session; `dispose` destroys every instance and removes exactly the subscription it
// added, so the view it leaves behind holds no editor and the next entry begins from
// nothing.
function richclayLease(record) {
  const onFrame = () => mount(record);
  return {
    enable() {
      if (record.admitted) return;
      record.admitted = true;
      mount(record);
      record.stopWatch = RichClay.watch(record.win);
      const target = record.root.ownerDocument || document;
      record.subscriber = { target, type: "clay:sync-applied", handler: onFrame };
      target.addEventListener(record.subscriber.type, onFrame);
    },
    quiesce() {
      record.admitted = false;
      if (record.stopWatch) {
        record.stopWatch();
        record.stopWatch = null;
      }
    },
    resume() {
      if (record.admitted) return;
      record.admitted = true;
      record.stopWatch = RichClay.watch(record.win);
    },
    dispose() {
      record.admitted = false;
      if (record.stopWatch) {
        record.stopWatch();
        record.stopWatch = null;
      }
      const subscriber = record.subscriber;
      record.subscriber = null;
      if (subscriber) subscriber.target.removeEventListener(subscriber.type, subscriber.handler);
      for (const el of elements(record)) RichClay.stripElement(el);
      if (session === record) session = null;
    },
  };
}

/**
 * RichClay as a mode participant: the editors the commit that enters edit mounts, and the
 * ones the exit takes back.
 *
 * `prepare` takes the vendor's auto-watch out of the page first, so every instance is this
 * session's to quiesce and destroy and an entry never meets an editor it did not mount; a
 * vendor build without that lifecycle support is refused here rather than left half
 * mounted in a view. `enable` mounts the regions and starts the session's own watcher.
 * `quiesce` stops admitting regions. `dispose` destroys the instances and hands back the
 * frame subscription, leaving no editor behind for the reader's page.
 */
export function richclayParticipant(root = document) {
  return {
    id: "clay:richclay",
    order: 310,
    async prepare(context = {}) {
      if (context.initial === true) return adopt();
      if (typeof RichClay.watch !== "function" || typeof RichClay.stripElement !== "function") {
        throw fault("this vendor build has no watchable lifecycle", "unsupported-plugin");
      }
      if (isStale(context)) throw fault("prepared for a stale generation", "stale-document");
      const stopAutoWatch = RichClay.autoInit?.();
      if (typeof stopAutoWatch === "function") stopAutoWatch();
      return richclayLease(session || (session = ownership(root)));
    },
  };
}

// The boot this tab already made, adopted instead of prepared: it is the session `init`
// below enabled, or, on a boot that started none, nothing to hand back.
async function adopt() {
  const lease = await ready;
  return { enable() {}, quiesce: () => lease?.quiesce(), resume: () => lease?.resume(), dispose: () => lease?.dispose() };
}

// Auto-init when the module is imported; the loader awaits `ready` before resolving clay.ready
async function init() {
  if (!startsAtImport()) return null;
  const lease = await richclayParticipant().prepare();
  lease.enable();
  return lease;
}

const ready = init();

export { RichClay, init, ready };
export { richclayParticipant as modeParticipant };
export default RichClay;
