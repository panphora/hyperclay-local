/**
 * The edit-only half of live sync.
 *
 * `live-sync.js` is the one sync module a reader and an editor both load. The
 * names below are the ones it reaches only in edit mode (or whose view-mode
 * answer is a constant), so they live in this separate chunk: live-sync loads it
 * with `await import()` on its edit path, and a view-mode tab never fetches the
 * save, admin or editing-sender graph behind it.
 */
import { loadEdit as loadConflictsEdit } from "./conflicts.js";
import { presence } from "./presence-store.js";

export { savePageThrottled, setLastSavedBaselines, setUnsavedChanges, getLastSavedBytes, conflictResolvedBySync, isSaveConflicted, baselineSettled, schedulePaintHeal } from "../core/save.js";
export { enableContentEditable } from "../core/admin-contenteditable.js";
export { enableOnClick } from "../core/admin-onclick.js";
export { enableAdminInputs } from "../core/admin-inputs.js";
export { enableAdminResources } from "../core/admin-resources.js";
export { EditingSender } from "./editing-sender.js";

// The lifecycle participant a live switch prepares for generic sync. `sync` is the
// one LiveSync instance the page owns: the saved lane it follows as a reader is what
// an entry stops, and the live lane it starts is what an exit disposes. The exit's
// saved lane is the controller's to restart, not this lease's.
export function syncParticipant(sync) {
  // The outgoing target goes before the editor is taken down, so a caret this tab
  // published cannot outlive the session that published it. A page target is
  // released with the ownership it came with; the generic marker is cleared
  // outright. Neither falls back to a positional marker: the exit publishes nobody.
  // The sender is stopped rather than only cleared, so the gate stays shut until the
  // exit commits or is refused: a reconnect, a roster change or a focus move during
  // the barrier would otherwise publish a target the session never takes back. The
  // page's own awareness hears the same barrier and resumes with it, so its caret
  // goes quiet with the sender and comes back on a refused exit.
  const quiesce = () => {
    sync._presenceQuiesced = true;
    sync._editing?.stop();
    presence.setGeneric(null);
    presence.releaseTarget();
    if (typeof document !== "undefined") document.dispatchEvent(new Event("clay:presence-quiesce"));
    return sync.lane === "live" && sync._morphInFlight ? { ok: false, code: "pending-input" } : { ok: true };
  };
  const resume = () => {
    sync._presenceQuiesced = false;
    sync._editing?.resume();
    if (typeof document !== "undefined") document.dispatchEvent(new Event("clay:presence-resume"));
  };
  const dispose = () => {
    sync._presenceQuiesced = false;
    sync.stop();
    if (typeof document !== "undefined") document.dispatchEvent(new Event("clay:presence-resume"));
  };
  return {
    id: "clay:sync",
    order: 50,
    async prepare(context) {
      await loadConflictsEdit();
      // Adoption: the explicit initial edit started this lane as the module
      // evaluated, so the lease covers it and starts nothing new.
      if (context?.initial) return { quiesce, resume, dispose };
      let started = false;
      return {
        quiesce,
        resume,
        // The commit: the lane a reader was following stops, and the same stream
        // slot opens on the live lane.
        enable() {
          const file = sync.currentFile;
          sync.stop();
          sync.start(file, { lane: "live" });
          started = true;
        },
        // A refused entry disposes what it prepared as well, and until the commit this
        // lane was the reader's: stopping it would take the saved lane the switch gives
        // back with it.
        dispose: () => {
          sync._presenceQuiesced = false;
          if (started) sync.stop();
          if (typeof document !== "undefined") document.dispatchEvent(new Event("clay:presence-resume"));
        },
      };
    },
  };
}
