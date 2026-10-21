import cookie from "../lib/cookie.js";
import query from "../lib/query.js";
import { hasSaveToken, servedStaleToken, servedSiteVisibility } from "./host-attrs.js";
import { draftEligible } from "./draft-mode.js";

// Edit-mode precedence: an explicit ?editmode=true|false URL param wins, then an
// authored `viewonly` attribute on <html> (a tool page that must never save its
// runtime state, even on a host that hands it a save token), then an
// opt-in window.clayEditMode global (with the legacy window.__hyperclayEditMode
// still honored as a fallback for older standalone embedders — htmlclay itself
// uses its injected save token plus the admin cookie, not this global), then
// a save token the host put on the root, then the isAdminOfCurrentResource cookie. The
// global is for standalone uses (demos, htmlclay, any self-saving file) that are
// always editable and have no owner cookie; setting it before clayjs loads turns
// on the edit-only modules. On a page that opts into visitor drafts, draft mode
// comes before ?editmode=true unless the owner cookie is present, and before the
// owner cookie otherwise.
//
// The token sits above the cookie because it is the stronger claim and often the
// only one visible: the host minted it for this response and nothing else, while
// the cookie is ambient. A sandboxed document cannot read the cookie at all, so
// without this rung a host that sandboxes its own documents can hand one a save
// token and still watch it render read-only.
let forcedEditMode = null;
if (typeof window !== "undefined") {
  if (window.clayEditMode != null) {
    forcedEditMode = Boolean(window.clayEditMode);
  } else if (window.__hyperclayEditMode != null) {
    forcedEditMode = Boolean(window.__hyperclayEditMode);
  }
}

// A host older than the save-token rename takes edit mode off the table, above every
// rung below it. Such a host still sets the owner cookie, so without this the page
// would look fully editable while every save 404s against a route that no longer
// matches: an editable page that keeps nothing is worse than a read-only one. Only an
// explicit ?editmode=true outranks it, because that is a person at the keyboard asking
// for it this load, not a decision baked into the document by an author who could not
// have known. stale-host-notice.js puts the reason on the page.
const isViewOnlyDocument =
  typeof document !== "undefined" && document.documentElement.hasAttribute("viewonly");

const draftCandidate = typeof document !== "undefined" && draftEligible();
const ownerCookie = Boolean(cookie.get("isAdminOfCurrentResource"));

const isDraftMode =
  draftCandidate &&
  query.editmode !== "false" &&
  !(query.editmode === "true" && ownerCookie) &&
  !isViewOnlyDocument &&
  !servedStaleToken() &&
  forcedEditMode == null &&
  !hasSaveToken();

const isEditMode = isDraftMode
  ? true
  : query.editmode
    ? query.editmode === "true" // takes precedence over viewonly, the global, token and cookie
    : isViewOnlyDocument || servedStaleToken()
      ? false
      : forcedEditMode != null
        ? forcedEditMode
        : hasSaveToken() || ownerCookie;

const isOwner = ownerCookie;

const siteVisibility = servedSiteVisibility;

export {
  isDraftMode,
  isEditMode,
  isOwner,
  siteVisibility
}
