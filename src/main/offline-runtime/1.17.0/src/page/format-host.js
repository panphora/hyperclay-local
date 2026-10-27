// The production host adapter behind the format gate: the floor the document is
// already at, the host's own admission answer, and the one explicit save that
// raises it.
//
// The host is the authority, so `capabilities()` answers nothing here: the editors
// admitted to the document are checked under its admission/write lock when the save
// carrying the marker arrives, which is the check no registration can race. A save
// refused there reports `page-format-upgrade-required` like any other refusal, and
// this tab stays at the floor it already knew.
//
// Nothing is noted before the host answers: `notePageFormatFloor` runs when the gate
// accepts the activation, so a refusal leaves every later save at floor 0.

import { PAGE_FORMAT, PAGE_FORMAT_META, PAGE_FORMAT_UPGRADE, knownPageFormatFloor, pageFormatFloor } from "./format-level.js";
import { hostPageFormat } from "../core/host-meta.js";

const FAILED = "page-format-activation-failed";

// The document's own marker, as it was served. A tab that joined a document already
// at floor 1 must not ask to activate it again.
function servedFloor() {
  const tag = document.querySelector(`meta[name="${PAGE_FORMAT_META}"]`);
  return tag ? pageFormatFloor(tag.outerHTML) : 0;
}

// The editor's own explicit save, fetched when a floor is really raised: a tab that
// never uses a newer format never downloads the lane to raise one.
const savePage = async (options) => (await import("../core/save.js")).savePageForce(() => {}, options);

export function createFormatHost({
  save = savePage,
  supported = () => hostPageFormat().then((floor) => floor === PAGE_FORMAT),
} = {}) {
  return {
    read() {
      return { floor: Math.max(knownPageFormatFloor(), servedFloor()), revision: null };
    },
    capabilities() {
      return [];
    },
    supported,
    async activate({ floor = PAGE_FORMAT } = {}) {
      let result;
      try {
        result = await save({ pageFormatFloor: floor });
      } catch (error) {
        return { accepted: false, code: error?.code ?? FAILED };
      }
      if (result?.ok) return { accepted: true, revision: null, receipt: result.receipt ?? result.etag ?? null };
      if (result?.code === PAGE_FORMAT_UPGRADE) return { accepted: false, code: PAGE_FORMAT_UPGRADE };
      return { accepted: false, code: result?.code ?? FAILED };
    },
  };
}
