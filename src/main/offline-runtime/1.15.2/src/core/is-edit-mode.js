import cookie from "../lib/cookie.js";
import query from "../lib/query.js";
import { hasSaveToken, servedStaleToken, servedSiteVisibility } from "./host-attrs.js";
import { draftEligible } from "./draft-mode.js";
import { takeReceipt } from "./mode-receipt.js";

// Two answers come out of here, both decided once, at module evaluation: may this
// person edit the document (`canEdit`), and does this tab start in edit (`mode`).
//
// canEdit is the edit-mode ladder, read as permission. An explicit ?editmode=true|false
// URL param wins, then an authored `viewonly` attribute on <html> (a tool page that must
// never save its runtime state, even on a host that hands it a save token), then an
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
// mode is the narrower question: permission alone no longer opens a document for
// editing, so an owner reads every document the way a visitor does. A tab starts
// editing only when something explicit asks for it: a receipt this tab left for its
// own reload (the person's choice in this tab, newer than the URL it was served with),
// an ?editmode=true param, window.clayEditMode = true, or an authored
// <html opens-in="edit"> for a tool page. clay.setMode('edit') is the way in.
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

const receipt = typeof window !== "undefined" ? takeReceipt() : null;
const opensInEdit =
  typeof document !== "undefined" && document.documentElement.getAttribute("opens-in") === "edit";

// May this person edit here? The old rule, read as permission.
const hostCanEdit = query.editmode
  ? query.editmode === "true" || (!isViewOnlyDocument && !servedStaleToken() && (forcedEditMode ?? (hasSaveToken() || ownerCookie)))
  : isViewOnlyDocument || servedStaleToken()
    ? false
    : forcedEditMode != null
      ? forcedEditMode
      : hasSaveToken() || ownerCookie;
const keptCanEdit =
  receipt?.canEdit === true && forcedEditMode !== false && !servedStaleToken() &&
  !(isViewOnlyDocument && query.editmode !== "true");
let canEdit = hostCanEdit || keptCanEdit;

// Does this tab start editing? Only when something explicit asks for it.
const startsEditing = receipt
  ? receipt.mode === "edit"
  : query.editmode
    ? query.editmode === "true"
    : forcedEditMode === true || opensInEdit;

// Live bindings, not constants: the lifecycle controller commits a transition by
// rewriting them here, and every facade reads them through a getter, so a boolean
// copied onto `clay` at boot can never go stale.
let isEditMode = isDraftMode ? true : canEdit && startsEditing;
let mode = isDraftMode ? "draft" : isEditMode ? "edit" : "view";
const isOwner = ownerCookie;

// The rest of `clay.modeLifecycle.state`: where edits land, which transition is
// running, and why the last one refused. The controller is the only writer.
const lifecycle = {
  phase: "idle",
  destination: isDraftMode ? "draft" : "host",
  generation: 0,
  reason: null,
};

export function commitModeFacts(next) {
  if (next.mode !== undefined) mode = next.mode;
  if (next.isEditMode !== undefined) isEditMode = next.isEditMode;
  if (next.canEdit !== undefined) canEdit = next.canEdit;
  for (const key in lifecycle) if (next[key] !== undefined) lifecycle[key] = next[key];
}

export const modeState = () => ({ mode, ...lifecycle });

// The lifecycle's registration queue: the same array an application pushed onto
// window.clay before boot, so a preboot push lands here. Registering never imports the
// controller, which takes the queue when it starts.
const queue = (typeof window !== "undefined" && window.clay && window.clay.modeParticipants) || [];
const registered = new Set();

const refuse = (message) => {
  throw new TypeError(`clay.modeLifecycle: ${message}`);
};

const refuseUnlessIdleInView = () => {
  if (lifecycle.phase !== "idle" || isEditMode) refuse("the page is not idle in view");
};

export function takeModeParticipants() {
  registered.clear();
  return queue.splice(0);
}

export function registerModeParticipant(participant) {
  const id = participant && participant.id;
  if (typeof id !== "string" || !id || typeof participant.prepare !== "function") refuse("a participant needs an id and a prepare()");
  if (registered.has(id)) refuse(`duplicate participant id "${id}"`);
  refuseUnlessIdleInView();
  registered.add(id);
  queue.push(participant);
  return () => {
    if (!registered.has(id)) return;
    refuseUnlessIdleInView();
    registered.delete(id);
    const index = queue.indexOf(participant);
    if (index !== -1) queue.splice(index, 1);
  };
}

const siteVisibility = servedSiteVisibility;

export {
  isDraftMode,
  isEditMode,
  isOwner,
  siteVisibility,
  canEdit,
  mode
}
