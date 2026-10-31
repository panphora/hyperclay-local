import { startsAtImport } from "../core/is-edit-mode.js";
import onDomReady from "../lib/dom-ready.js";
import { saveFeedback } from "../core/save-feedback.js";

const SAVE_EVENTS = ["saving", "saved", "error", "offline", "retrying", "blocked"];

// The drawing arrives on demand; states that come before it are shown in order once it has.
let chip = null;
const loadChip = () => (chip ??= import("./indicator-chip.js"));
const show = (state) => {
  loadChip().then((m) => { if (listeners) m.show(state); }, () => {});
};

let listeners = null;

// Arming is idempotent: the plugin's own boot and a mode lease both ask for the same
// listeners, and one exit must be able to take all of them back.
function arm() {
  saveFeedback.chip = true;
  if (listeners) return;
  listeners = new AbortController();
  const { signal } = listeners;
  // Typing is the first sign a save is coming: fetch the drawing then, not at boot.
  for (const type of ["beforeinput", "keydown", "pointerdown"]) {
    document.addEventListener(type, loadChip, { signal, once: true, capture: true });
  }
  for (const state of SAVE_EVENTS) {
    document.addEventListener("clay:save-" + state, () => show(state), { signal });
  }
  document.addEventListener("clay:page-save-state", (event) => show(event.detail?.state), { signal });
}

function disarm() {
  listeners?.abort();
  listeners = null;
  chip?.then((m) => m.remove(), () => {});
}

function init() {
  if (!startsAtImport()) return;
  arm();
}

/**
 * The save chip as a mode lease.
 *
 * The chip owns no input: it reports a save somebody else is making, so an exit never
 * waits on it. `quiesce` leaves the chip and its fade timer exactly as they were, which
 * is what a refusal has to keep showing; `resume` has nothing to reopen. `initial: true`
 * adopts the chip the boot already armed and arms nothing again. `dispose` (after the
 * barrier) takes the chip, its listeners and its timer down, so a save event in view
 * draws nothing.
 */
export function indicatorParticipant() {
  return {
    id: "clay:indicator",
    order: 700,
    prepare(context = {}) {
      return {
        enable() {
          if (context.initial === true) return;
          arm();
        },
        quiesce() {},
        resume() {},
        dispose() {
          disarm();
        },
      };
    },
  };
}

export { indicatorParticipant as modeParticipant };

onDomReady(init);
