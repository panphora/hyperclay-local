import onDomReady from "../lib/dom-ready.js";
import { isEditMode } from "./is-edit-mode.js";
import { storage } from "../lib/doc-storage.js";

// The notice itself lives in conflict-notice-ui.js and is 6.8 KB Brotli: most edit
// boots have nothing for it to show, so this shell is what every one of them downloads
// instead. It watches the events that can create something to show and, on the first
// one, fetches the notice once and hands it that event, which it replays as if it had
// been listening all along. From then on the notice owns every listener; this file
// adds no state and draws nothing. Conflicts a reload left in the recovery store have
// no event to announce them, so a boot that holds some asks for the notice at once.
const ledger = () => window.clay?.conflicts || null;

let loading = false;

function load(trigger) {
  if (loading) return;
  loading = true;
  document.removeEventListener("clay:sync-conflicts-changed", onLedgerChanged);
  document.removeEventListener("clay:save-conflict", onSaveConflict);
  document.removeEventListener("clay:document-upgraded", onUpgraded);
  import("./conflict-notice-ui.js").then(
    (ui) => ui.start(trigger),
    (error) => {
      console.error("clayjs: the conflict notice could not be downloaded; it will try again on the next conflict", error);
      loading = false;
      arm();
    }
  );
}

function arm() {
  document.addEventListener("clay:sync-conflicts-changed", onLedgerChanged);
  document.addEventListener("clay:save-conflict", onSaveConflict);
  document.addEventListener("clay:document-upgraded", onUpgraded);
}

function onLedgerChanged(e) {
  if (!ledger()?.size) return;
  load(e);
}

function onSaveConflict(e) {
  load(e);
}

// The document itself was upgraded somewhere else: the notice is drawn for this
// too, because it is the one thing on the page that can offer a reload.
function onUpgraded(e) {
  load(e);
}

// A conflict this tab held before a reload lives in the recovery store, not in the
// ledger. That store keeps one small count key for exactly this question: it is read
// here, and the module behind it is fetched only when the count says something is
// stored, so a boot with nothing stored downloads no recovery code.
const HINT_KEY = "conflicts";

function keptFromEarlier() {
  if (!(storage.local.get(HINT_KEY)?.count > 0)) return;
  import("../recovery/conflicts.js").then(
    (module) => {
      if (!loading && module.pendingConflicts() > 0) load(null);
    },
    () => {}
  );
}

onDomReady(() => {
  if (!isEditMode) return;
  if (ledger()?.size) load(null);
  else {
    // Armed first, always: a conflict can arrive while the hint is still being read.
    arm();
    keptFromEarlier();
  }
});
