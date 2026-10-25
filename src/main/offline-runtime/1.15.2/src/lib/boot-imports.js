export const BOOT_IMPORTS = {
  "plugins/sortable.js": ["vendor/Sortable.vendor.js"],
  "plugins/derive.js": ["vendor/sap-core.vendor.js"],
};
export const EDIT_BOOT_IMPORTS = ["core/host-meta.js"];
// Code a Document's edit boot fetches before it can take input. The editor is a
// dynamic target of its own, so only a plan that runs the page plugin preloads it.
export const EDITOR_BOOT_IMPORTS = ["page/editor.js"];
