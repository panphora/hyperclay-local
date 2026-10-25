// The CMS shell, toggle, inline layer and ghost rows, with their --mirk-* tokens pinned
// to Bevel and the Bevel system mono face. The CMS keeps its own stylesheet and its
// own light/dark switching. The "Edit content" toggle also gets Bevel's button face, ink and hover (src/ui/skins/cms-toggle.js).
import { installSkin } from "../ui/vendor-skin.js";
import { CSS } from "../ui/skins/cms.js";
import { CSS as TOGGLE_CSS, ROOTS as TOGGLE_ROOTS } from "../ui/skins/cms-toggle.js";

export { cms, default } from "../vendor/hypercms.vendor.js";

installSkin("cms", CSS);
// The toggle takes the page's scheme, so Bevel's face and ink resolve the way the page reads.
installSkin("cms-toggle", TOGGLE_CSS, { roots: TOGGLE_ROOTS });
