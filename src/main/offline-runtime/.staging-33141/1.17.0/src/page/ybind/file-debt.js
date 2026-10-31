/**
 * file-debt.js — what this tab authored that no accepted file save has covered yet.
 *
 * One merged Yjs update per page binding, not a list of per-keystroke records and not an
 * IndexedDB journal: a leave needs to know whether this tab's own input still owes the
 * file, and it needs that answer synchronously. Adopting a peer's update, delivering one
 * and compacting the store are not this tab's input, so none of them records here.
 *
 * Only accepted page bytes clear it, and only by the coverage primitive: a state that does
 * not decode, or does not carry every insertion and deletion this tab owns, leaves the
 * obligation exactly where it was.
 */

import { mergeUpdatesV2 } from "../../vendor/yjs.vendor.js";
import { canonicalPageBytes, containsUpdate } from "./recovery-proof.js";

/**
 * The file obligation of one page binding.
 *
 * @param {{changed?: Function}} [options] - notified whenever the answer may have changed
 * @returns {{local: Function, pending: Function, accepted: Function}}
 */
export function createPageFileDebt({ changed = () => {} } = {}) {
  let owned = null;
  return {
    local(update) {
      owned = owned ? mergeUpdatesV2([owned, update]) : update.slice();
      changed();
    },
    pending() {
      return owned !== null;
    },
    accepted(state) {
      if (!owned) return true;
      let covered = false;
      try {
        covered = containsUpdate(canonicalPageBytes(state), owned);
      } catch {}
      if (!covered) return false;
      owned = null;
      changed();
      return true;
    },
  };
}
