// Soft delete. A record in the trash keeps its place, id and content and carries
// data-deleted-at; restoring removes the attribute; purging removes the record.
export const DELETED_ATTR = "data-deleted-at";
const run = (label, fn) => (window.clay?.undo?.commit ? window.clay.undo.commit(label, fn) : fn());
const tell = (el, type) => el.dispatchEvent(new CustomEvent(type, { bubbles: true }));

export const trash = Object.assign(
  (el, { at = new Date().toISOString() } = {}) => {
    run("Move to Trash", () => el.setAttribute(DELETED_ATTR, at));
    tell(el, "clay:trashed");
    return { undo: () => trash.restore(el) };
  },
  {
    is: (el) => !!el.getAttribute(DELETED_ATTR),
    restore(el) { run("Restore", () => el.removeAttribute(DELETED_ATTR)); tell(el, "clay:restored"); },
    purge(el) { run("Delete forever", () => el.remove()); },
  },
);
