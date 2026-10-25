/**
 * The edit-only half of live sync.
 *
 * `live-sync.js` is the one sync module a reader and an editor both load. The
 * names below are the ones it reaches only in edit mode (or whose view-mode
 * answer is a constant), so they live in this separate chunk: live-sync loads it
 * with `await import()` on its edit path, and a view-mode tab never fetches the
 * save, admin or editing-sender graph behind it.
 */
export { savePageThrottled, setLastSavedBaselines, setUnsavedChanges, getLastSavedBytes, conflictResolvedBySync, isSaveConflicted, baselineSettled, schedulePaintHeal } from "../core/save.js";
export { enableContentEditable } from "../core/admin-contenteditable.js";
export { enableOnClick } from "../core/admin-onclick.js";
export { enableAdminInputs } from "../core/admin-inputs.js";
export { enableAdminResources } from "../core/admin-resources.js";
export { EditingSender } from "./editing-sender.js";
