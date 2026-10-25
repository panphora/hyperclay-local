import { isEditMode, isOwner } from "../core/is-edit-mode.js";
import { hasSaveToken } from "../core/host-attrs.js";
import { draftSlot } from "../core/draft-mode.js";
import { inertVisitorDrafts } from "./visitor-drafts/inert.js";

let ownerChip = Promise.resolve();
const slot = draftSlot();
const rulesTag = document.querySelector('script[data-rules-name~="api"]');

if (!slot || !rulesTag) {
  const missing = [];
  if (!slot) missing.push('a visitor-drafts="<slot>" attribute on <html>');
  if (!rulesTag) missing.push('a <script data-rules-name~="api"> rules tag');
  console.warn(`visitor-drafts: this page keeps no draft (missing ${missing.join(" and ")})`);
} else if (isOwner && isEditMode && !hasSaveToken()) {
  ownerChip = import("./visitor-drafts/owner-chip.js").then(({ mountOwnerChip }) => mountOwnerChip());
}

export const ready = ownerChip;

export const visitorDrafts = inertVisitorDrafts();
