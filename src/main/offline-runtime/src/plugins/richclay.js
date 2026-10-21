// richclay's toolbar, menus, floating toolbar and link dialog, raised above the host
// page by its skin. The vendor bundle is unchanged; the skin goes in first, so the
// editor never draws a frame of chrome the page can repaint.
import { installSkin } from "../ui/vendor-skin.js";
import { CSS, ROOTS } from "../ui/skins/richclay.js";
import { RichClay } from "../vendor/richclay.vendor.js";
import { isEditMode } from "../core/is-edit-mode.js";

installSkin("richclay", CSS, { roots: ROOTS });

// A frame's snapshot carries none of RichClay's runtime state, and the merge removes
// live attributes the merged page lacks, so an applied frame leaves editors that can
// no longer be typed into. RichClay's reattach() restores them. View mode mounts none.
if (isEditMode) {
  document.addEventListener("clay:sync-applied", () => {
    for (const editor of RichClay.init()) editor.reattach();
  });
}

export { RichClay };
export default RichClay;
