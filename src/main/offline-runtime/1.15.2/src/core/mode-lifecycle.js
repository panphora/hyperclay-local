// The mode controller: the one module that prepares, enables, quiesces and disposes
// edit leases. It is a dynamic target, fetched by an explicit initial edit or the first
// live switch, so a reader that never asks to edit never downloads it.
//
// A lease is `{ready, enable, quiesce, resume, dispose}` for one participant. `prepare`
// may fetch and build inert UI; `enable` is synchronous once every preparation has
// succeeded; `quiesce` stops admission without losing buffers, so a refused exit can
// `resume` the very same lease; and `dispose` runs only after a committed exit.
import { canEdit, isDraftMode, commitModeFacts, modeState, takeModeParticipants } from "./is-edit-mode.js";

let generation = 0;
let leases = [];
let roster = [];
let inFlight = null;

const current = () => modeState().mode;

const fault = (message, code) => Object.assign(new Error(`clay.modeLifecycle: ${message}`), { code });

// A committed change is announced so the engines that follow the session (Sap's undo
// pair) rebind once, keyed on `state.generation`.
function announceMode() {
  document.dispatchEvent(new Event("clay:modechange"));
}

function refuse(code, phase = "idle", extra = {}) {
  commitModeFacts({ phase, reason: code });
  return { ok: false, mode: current(), code, ...extra };
}

// Participants may be queued as promises. Their ids have to stay unique across every
// registration this page ever made, and `order` decides prepare order.
async function rosterOf() {
  for (const entry of takeModeParticipants()) {
    const participant = await entry;
    if (typeof participant?.id !== "string" || typeof participant.prepare !== "function") {
      throw fault("a participant needs an id and a prepare()", "unsupported-plugin");
    }
    if (roster.some(({ id }) => id === participant.id)) {
      throw fault(`duplicate participant id "${participant.id}"`, "unsupported-plugin");
    }
    roster.push(participant);
  }
  return [...roster].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

async function enter() {
  const before = current();
  const controller = new AbortController();
  const context = {
    generation: ++generation,
    destination: modeState().destination,
    signal: controller.signal,
    isCurrent: () => context.generation === generation,
  };
  commitModeFacts({ phase: "entering", generation: context.generation, reason: null });
  const prepared = [];
  try {
    for (const participant of await rosterOf()) {
      const lease = await participant.prepare(context);
      if (!lease) continue;
      prepared.push(lease);
      if (!context.isCurrent()) throw fault(`"${participant.id}" prepared for a stale generation`, "stale-document");
      if (lease.ready) await lease.ready;
      if (!context.isCurrent()) throw fault(`"${participant.id}" became ready for a stale generation`, "stale-document");
    }
    for (const lease of prepared) lease.enable();
  } catch (err) {
    for (const lease of prepared.reverse()) {
      try {
        lease.dispose();
      } catch {}
    }
    controller.abort();
    return refuse(err?.code || "load-failed", "blocked", { message: err?.message });
  }
  leases = prepared;
  commitModeFacts({ mode: isDraftMode ? "draft" : "edit", isEditMode: true, phase: "idle", reason: null });
  announceMode();
  return { ok: true, mode: current(), changed: before !== current() };
}

async function leave() {
  const held = leases;
  commitModeFacts({ phase: "leaving" });
  try {
    for (const lease of [...held].reverse()) await lease.quiesce?.();
    const result = await window.clay?.save?.flush?.();
    if (result && result.state && result.state !== "saved" && result.state !== "clean") {
      throw fault(`save state "${result.state}"`, "save-failed");
    }
  } catch (err) {
    for (const lease of held) {
      try {
        lease.resume?.();
      } catch {}
    }
    commitModeFacts({ phase: "idle", reason: err?.code || "save-failed" });
    return { ok: false, mode: current(), code: err?.code || "save-failed", state: err?.state };
  }
  for (const lease of [...held].reverse()) {
    try {
      lease.dispose?.();
    } catch {}
  }
  leases = [];
  generation++;
  commitModeFacts({ mode: "view", isEditMode: false, phase: "idle", generation, reason: null });
  announceMode();
  return { ok: true, mode: "view", changed: true };
}

// The switch. Joining the transition already running for the same target answers with
// that same promise; asking for the other one while it runs answers busy, and leaves
// the running transition untouched.
export function requestMode(target) {
  if (target !== "edit" && target !== "view") throw new TypeError(`clay.modeLifecycle: unknown mode "${target}"`);
  if (inFlight) return inFlight.target === target ? inFlight.promise : { ok: false, mode: current(), code: "busy" };
  if (target === current()) return { ok: true, mode: current(), changed: false };
  if (!canEdit || isDraftMode) return { ok: false, mode: current(), code: "not-allowed" };
  const promise = (target === "edit" ? enter() : leave()).finally(() => {
    inFlight = null;
  });
  inFlight = { target, promise };
  return promise;
}

// The explicit initial edit: this tab already starts in edit or draft, so nothing
// switches. The preboot queue is drained, prepared and enabled before input instead.
export async function activateInitial() {
  if (current() === "view") return { ok: true, mode: "view", changed: false };
  if (inFlight) return inFlight.promise;
  const promise = enter().finally(() => {
    inFlight = null;
  });
  inFlight = { target: "edit", promise };
  return promise;
}
