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
  // Merged in runs of doubling length, as a binary counter carries: slot k holds 2^k of
  // this tab's updates. A keystroke merges with the runs it completes, not with everything
  // the session typed, so a long session without an accepted save stays cheap to type in.
  let runs = [];
  const owned = () => {
    const parts = runs.filter(Boolean);
    if (!parts.length) return null;
    const merged = parts.length === 1 ? parts[0] : mergeUpdatesV2(parts);
    runs = runs.map(() => null);
    runs[runs.length - 1] = merged;
    return merged;
  };
  return {
    local(update) {
      let carry = update.slice();
      let k = 0;
      for (; runs[k]; k++) {
        carry = mergeUpdatesV2([runs[k], carry]);
        runs[k] = null;
      }
      runs[k] = carry;
      changed();
    },
    pending() {
      return runs.some(Boolean);
    },
    accepted(state) {
      const merged = owned();
      if (!merged) return true;
      let covered = false;
      try {
        covered = containsUpdate(canonicalPageBytes(state), merged);
      } catch {}
      if (!covered) return false;
      runs = [];
      changed();
      return true;
    },
  };
}
