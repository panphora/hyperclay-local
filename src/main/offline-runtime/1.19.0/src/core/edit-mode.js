// Edit mode system - combines the editmode toggle with page type setting.
// Loads in BOTH view and edit mode: setMode must exist in view mode
// (it's the way IN), and setPageTypeOnPageLoad marks <html> in either mode.
import { canEdit, isDraftMode, isEditMode, isOwner, mode, modeState, registerModeParticipant } from "./is-edit-mode.js";
import { writeReceipt } from "./mode-receipt.js";
import onDomReady from "../lib/dom-ready.js";

let leaving = false;

// The public registration. The built-ins own the `clay:` prefix (`clay:resources` and
// every module participant), so an application may not take an id from that space.
const register = (participant) => {
  if (typeof participant?.id === "string" && participant.id.startsWith("clay:")) {
    throw new TypeError(`clay.modeLifecycle: the id "${participant.id}" is reserved`);
  }
  return registerModeParticipant(participant);
};

export const modeLifecycle = {
  register,
  canWrite: () => modeState().phase === "idle" && isEditMode,
  get state() {
    return Object.freeze(modeState());
  },
};

// The lazy dispatcher. The controller is a dynamic target, fetched by an explicit
// initial edit or the first live switch — never because a live declaration, a menu or
// a participant exists — and a rejected fetch is retried on the next ask.
let controller = null;

const fetchController = () => (controller ||= import("./mode-lifecycle.js").catch(() => (controller = null)));

// A live switch is a contract the document signs, not a hint. The loader records both
// resolved plans here only when `<html clay-mode-switch="live">` asked for one; the
// decision behind it and the controller that runs the transaction are a dynamic target,
// fetched by the first switch and never by the declaration itself.
let liveSwitch = null;

export const noteLiveSwitch = (boot) => {
  liveSwitch = boot;
};

export async function activateInitialMode() {
  if (!isEditMode) return;
  try {
    await (await fetchController()).activateInitial();
  } catch (err) {
    console.error("clayjs: the mode lifecycle failed to start:", err);
  }
}

// One mode request at a time, whoever ends up handling it (the workspace shell, the live
// controller or a reload): asking for the same mode joins it, and asking for the other one
// is busy until it settles.
let pending = null;

export async function setMode(next) {
  if (next !== "edit" && next !== "view") throw new TypeError(`clay.setMode: unknown mode "${next}"`);
  if (pending) return pending.target === next ? pending.promise : { ok: false, mode, code: "busy" };
  if (next === mode && !controller) return { ok: true, mode, changed: false };
  if (isDraftMode) return { ok: false, mode, code: "not-allowed" };
  const promise = request(next);
  pending = { target: next, promise };
  try {
    return await promise;
  } finally {
    if (pending?.promise === promise) pending = null;
  }
}

async function request(next) {
  // In a workspace frame the shell owns the frame and decides permission, so a mode change
  // is its reload, not ours: hand it over before anything local starts. Only a shell that
  // does not take part ("host-unsupported") leaves the switch to this document.
  const host = typeof window !== "undefined" ? window.clay?._requestHostMode : undefined;
  if (typeof host === "function" && next !== mode) {
    let answer;
    try {
      answer = await host(next);
    } catch {
      return { ok: false, mode, code: "host-failed" };
    }
    if (answer?.reason !== "host-unsupported") {
      if (!answer?.ok) return { ok: false, mode, code: answer?.reason || "host-refused" };
      leaving = true;
      return { ok: true, mode: next, changed: true, reloading: true };
    }
  }
  if (next === "edit" && mode !== "edit") return enterEdit();
  if (!canEdit && !(next === "view" && mode === "edit")) return { ok: false, mode, code: "not-allowed" };
  return switchTo(next);
}

async function enterEdit() {
  const asked = location.pathname;
  const { checkHostPermission } = await import("./host-permission.js");
  const writable = await checkHostPermission({ fresh: true });
  // The page moved to another document while the host answered: this request was for the old one.
  if (location.pathname !== asked) return { ok: false, mode, code: "cancelled" };
  if (writable === false) return { ok: false, mode, code: "permission-denied" };
  if (!canEdit) return { ok: false, mode, code: "not-allowed" };
  return switchTo("edit");
}

async function switchTo(next) {
  if (liveSwitch) {
    // A fetch that fails keeps the old way in: the guarded reload below.
    const loaded = await fetchController();
    const live = loaded && (await loaded.switchMode(next, liveSwitch));
    if (live) return live;
  }
  if (next === mode) return { ok: true, mode, changed: false };
  if (mode === "edit") {
    let result;
    try {
      result = await window.clay?.save?.flush?.();
    } catch (err) {
      return { ok: false, mode, code: "save-failed", state: err?.state };
    }
    if (result && result.state && result.state !== "saved" && result.state !== "clean") {
      return { ok: false, mode, code: "save-failed", state: result.state };
    }
  }
  leaving = true;
  writeReceipt({ mode: next, canEdit, internal: true });
  location.reload();
  return { ok: true, mode: next, changed: true, reloading: true };
}

function openEditParam() {
  const url = new URL(window.location.href);
  url.searchParams.set('editmode', 'true');
  window.location.href = url.toString();
}

export const toggleEditMode = () =>
  isDraftMode ? openEditParam() : setMode(mode === "edit" ? "view" : "edit");

function keepModeOnReload() {
  if (!canEdit || isDraftMode) return;
  window.addEventListener("pagehide", () => { if (!leaving) writeReceipt({ mode, canEdit, internal: false }); });
}

function markCanEdit() {
  if (canEdit) {
    document.documentElement.setAttribute("canedit", "true");
  } else {
    document.documentElement.removeAttribute("canedit");
  }
}

export function setPageTypeOnPageLoad () {
  onDomReady(() => {
    document.documentElement.setAttribute("editmode", isEditMode ? "true" : "false");
    document.documentElement.setAttribute("pageowner", isOwner ? "true" : "false");
    markCanEdit();
    document.addEventListener("clay:capabilitychange", markCanEdit);
    if (isDraftMode) {
      document.documentElement.setAttribute("draftmode", "true");
    } else {
      document.documentElement.removeAttribute("draftmode");
    }
  });
}

function init() {
  setPageTypeOnPageLoad();
  keepModeOnReload();
}

// Auto-init when module is imported
init();

export { init, isEditMode, isOwner, canEdit, mode };
export default { init, setMode, toggleEditMode, isEditMode, isOwner, canEdit, mode };
