import { isEditMode, isOwner } from "../core/is-edit-mode.js";
import { hasSaveToken } from "../core/host-attrs.js";
import { draftSlot } from "../core/draft-mode.js";
import { inertVisitorDrafts } from "./visitor-drafts/inert.js";

const slot = draftSlot();
const rulesTag = document.querySelector('script[data-rules-name~="api"]');

// The one chip, the mounting on its way to it, and the session that asked: the boot and a
// mode lease both ask, so a second ask joins the first, and a chip that arrives for a
// session that has ended is taken down at once.
let mounted = null;
let mounting = null;
let sessions = 0;

const chipAllowed = () => isOwner && isEditMode && !hasSaveToken() && !!slot && !!rulesTag;

function mountChip() {
  if (mounted) return Promise.resolve(mounted);
  if (!mounting) {
    const asked = sessions;
    mounting = import("./visitor-drafts/owner-chip.js")
      .then(({ mountOwnerChip }) => {
        const chip = mountOwnerChip() || document.getElementById("clay-owner");
        if (asked === sessions) {
          mounted = chip;
          return chip;
        }
        chip?.liftOff?.();
        chip?.remove();
        return null;
      })
      .finally(() => { mounting = null; });
  }
  return mounting;
}

function unmountChip() {
  sessions += 1;
  mounted?.liftOff?.();
  mounted?.remove();
  mounted = null;
  document.getElementById("clay-owner-vars")?.remove();
}

if (!slot || !rulesTag) {
  const missing = [];
  if (!slot) missing.push('a visitor-drafts="<slot>" attribute on <html>');
  if (!rulesTag) missing.push('a <script data-rules-name~="api"> rules tag');
  console.warn(`visitor-drafts: this page keeps no draft (missing ${missing.join(" and ")})`);
}

const ownerChip = chipAllowed() ? mountChip() : Promise.resolve(null);

export const ready = ownerChip;

/**
 * The owner chip as a mode lease: `enable` mounts it, `initial: true` adopts the one the
 * boot armed and mounts nothing, and `dispose` (after the barrier) takes the chip and the
 * room it published down. The chip holds no input anybody has committed, so `quiesce` and
 * `resume` leave it exactly where it is.
 */
export function draftsOwnerParticipant() {
  return {
    id: "clay:drafts-owner",
    order: 400,
    prepare(context = {}) {
      return {
        enable() {
          if (context.initial === true) return;
          if (chipAllowed()) mountChip();
        },
        quiesce() {},
        resume() {},
        dispose() {
          unmountChip();
        },
      };
    },
  };
}

export { draftsOwnerParticipant as modeParticipant };

export const visitorDrafts = inertVisitorDrafts();
