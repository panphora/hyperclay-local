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
const hintCanEdit = hostCanEdit || keptCanEdit;
// What the document or the URL itself rules out; a host's yes never overrides these.
const authoredRestriction = isDraftMode || servedStaleToken() || forcedEditMode === false ||
  query.editmode === "false" || (isViewOnlyDocument && query.editmode !== "true");
let canEdit = hintCanEdit;

// The host's own answer to "may this caller save here": false takes edit away, true grants
// it unless the document rules it out, and no answer leaves the hints in charge.
export function noteHostWritable(writable) {
  const next = writable === false ? false : writable === true ? hintCanEdit || !authoredRestriction : hintCanEdit;
  if (next === canEdit) return;
  canEdit = next;
  if (typeof document !== "undefined") document.dispatchEvent(new Event("clay:capabilitychange"));
}

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
  if (next.isEditMode !== undefined) {
    isEditMode = next.isEditMode;
    if (typeof window !== "undefined") window.__hyperclayEditMode = isEditMode;
  }
  if (next.canEdit !== undefined) canEdit = next.canEdit;
  for (const key in lifecycle) if (next[key] !== undefined) lifecycle[key] = next[key];
}

export const modeState = () => ({ mode, ...lifecycle });

// A module that starts a session when it evaluates belongs to the session that was idle when
// it landed: during any transition the committed mode is still the one being left, so a late
// import would start an editor no exit holds a lease over.
export function startsAtImport() {
  return isEditMode && modeState().phase === "idle";
}

// The one registration queue, on `window.clay`: the API, a preboot push and a later raw
// push all land in the array the controller drains. Non-enumerable, because it is a
// handoff and not a member of the facade a page boots with.
const queue = (() => {
  if (typeof window === "undefined" || !window.clay) return [];
  if (window.clay.modeParticipants) return window.clay.modeParticipants;
  Object.defineProperty(window.clay, "modeParticipants", { value: [], writable: true, configurable: true });
  return window.clay.modeParticipants;
})();
const registered = new Set();

// The readiness check reads the queue without draining it. A registration taken back also
// leaves the controller's roster, but only when the controller is already loaded.
let forgetFromRoster = () => {};
export const noteParticipantForget = (fn) => (forgetFromRoster = fn);
export const peekModeParticipants = () => queue.slice();

const refuse = (message) => {
  throw new TypeError(`clay.modeLifecycle: ${message}`);
};

const refuseUnlessIdleInView = () => {
  if (lifecycle.phase !== "idle" || isEditMode) refuse("the page is not idle in view");
};

// A blocked page is a view with a reason: the transition that refused is over and the page
// is not idle only so the refusal can be read. A participant that arrives then is recorded
// for the next entry, which is the answer the block already gave, so it is not a second
// refusal on top of it.
const refuseUnlessAnEntryCanTakeIt = () => {
  if (lifecycle.phase === "blocked" && !isEditMode) return;
  refuseUnlessIdleInView();
};

export function takeModeParticipants() {
  registered.clear();
  return queue.splice(0);
}

export function registerModeParticipant(participant) {
  const id = participant && participant.id;
  if (typeof id !== "string" || !id || typeof participant.prepare !== "function") refuse("a participant needs an id and a prepare()");
  if (registered.has(id)) refuse(`duplicate participant id "${id}"`);
  refuseUnlessAnEntryCanTakeIt();
  registered.add(id);
  queue.push(participant);
  // `live`, not `registered`: a drain clears that set while the roster keeps the
  // participant, so an unregister after the first drain still has to reach the roster.
  let live = true;
  return () => {
    if (!live) return;
    refuseUnlessAnEntryCanTakeIt();
    live = false;
    registered.delete(id);
    const index = queue.indexOf(participant);
    if (index !== -1) queue.splice(index, 1);
    forgetFromRoster(id);
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
