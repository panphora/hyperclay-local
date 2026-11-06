// The mode controller: the one module that prepares, enables, quiesces and disposes
// edit leases. It is a dynamic target, fetched by an explicit initial edit or the first
// live switch, so a reader that never asks to edit never downloads it.
//
// A lease is `{ready, enable, quiesce, resume, dispose}` for one participant. `prepare`
// may fetch and build inert UI; `enable` is synchronous once every preparation has
// succeeded; `quiesce` stops admission without losing buffers, so a refused exit can
// `resume` the very same lease; and `dispose` runs only after a committed exit.
//
// The save generation and the exit's barrier are imported when a transition needs them,
// never at the top: this module's own graph stays what it was.
import {
  canEdit,
  isDraftMode,
  isEditMode,
  commitModeFacts,
  modeState,
  noteParticipantForget,
  takeModeParticipants,
} from "./is-edit-mode.js";
import { supportFor } from "./mode-support.js";

let generation = 0;
let leases = [];
let roster = [];
let inFlight = null;
// A tab that booted in edit started its sessions at evaluation; the first exit adopts them
// instead of preparing its own.
let initialSession = false;
// Whether this boot's sessions have been adopted. `leases` already holds whatever the entry
// prepared, a preboot participant included, so it says nothing about the boot's own.
let adoptedInitial = false;
// The adoption in flight, kept across a refused exit: a participant whose preparation
// outlives the deadline answers the next exit instead of being asked twice.
let adopting = null;
// The file the session was built from. An exit that saved nothing hands it back to the
// reader, so a second entry has a receipt without waiting for a frame.
let entryReceipt = null;

// One deadline covers the whole transition: every import a participant prepares from,
// the preparation itself, and the commit.
const DEADLINE_MS = 15000;

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

// A lease handed nothing back has nothing to take back. Reverse order is the exit's, so a
// lease enabled last is disposed first.
function disposeInReverse(list) {
  for (const lease of [...list].reverse()) {
    try {
      lease.dispose?.();
    } catch {}
  }
}

// A refused entry gives the article back to the reader it took it from: the leases are
// already disposed in reverse, so the claim and then the queue return to their owner.
function giveBack(reader) {
  try {
    reader?.reclaimArticle?.();
  } catch {}
  try {
    reader?.resume?.();
  } catch {}
}

function setRootEditMode(on) {
  document.documentElement.setAttribute("editmode", on ? "true" : "false");
}

// The committed mode owns the mode now: a URL that asked for edit is a request this
// switch has already answered, and a vendor that reads the parameter before the facts
// (RichClay) would hold the page at the old mode after a live entry. The parameter goes
// at the commit that changed the mode, and every other parameter and the hash stay.
function dropEditmodeParam() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("editmode")) return;
    url.searchParams.delete("editmode");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch (error) {
    console.warn("clayjs: the URL could not be rewritten after the mode switch", error);
  }
}

// The modules an edit plan resolves, in the order the plan names them.
const editPlanPaths = (handle) => [
  ...(handle?.edit?.core ?? []),
  ...(handle?.edit?.plugins ?? []),
  ...(handle?.edit?.late ?? []),
];

// The built-ins a session starts: one participant per loaded edit-plan path whose support
// row exports one (or is a function of the namespace that answers one, for a module whose
// participant lives in its edit chunk), in plan order. A path the plan names but the entry
// could not load contributes nothing, and a neutral row never does.
function builtinParticipants(handle) {
  const found = [];
  for (const path of editPlanPaths(handle)) {
    const support = supportFor(path);
    if (support !== "export" && typeof support !== "function") continue;
    const mod = handle.loaded?.[path];
    if (!mod) continue;
    found.push(typeof support === "function" ? support(mod) : mod.modeParticipant?.());
  }
  return found;
}

// Participants may be queued as promises, and the queue is where the authored resources'
// lease arrives. The first claim on an id wins; `order` decides prepare order. A queued
// entry that is not a participant is a document this release cannot start, and it is
// found before anything is prepared.
async function collectRoster(handle) {
  const seen = new Set(roster.map(({ id }) => id));
  const add = (participant) => {
    if (typeof participant?.id !== "string" || typeof participant.prepare !== "function") {
      throw fault("a participant needs an id and a prepare()", "unsupported-plugin");
    }
    if (seen.has(participant.id)) return;
    seen.add(participant.id);
    roster.push(participant);
  };
  if (handle) for (const participant of builtinParticipants(handle)) add(await participant);
  for (const entry of takeModeParticipants()) add(await entry);
  return [...roster].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

// A registration this page took back while idle in view leaves the roster too, so the next
// entry never prepares a participant nobody wants. Loaded, the controller is the only
// owner of the roster; the registry calls this and never fetches the controller for it.
export function forgetParticipant(id) {
  const index = roster.findIndex((participant) => participant.id === id);
  if (index !== -1) roster.splice(index, 1);
}

noteParticipantForget(forgetParticipant);

// A reader that now represents a different file than the session was built from: the seq
// decides it when both name one, and a different stamp is a different file when it cannot.
// Absorbing such a file into the baseline would make a change nobody showed the person
// read as saved, so the entry refuses instead.
function superseded(held, represented) {
  if (!held || held.bytes === null) return false;
  const before = represented ?? {};
  if (typeof held.seq === "number" && typeof before.seq === "number" && held.seq !== before.seq) {
    return held.seq > before.seq;
  }
  return (held.etag ?? null) !== (before.etag ?? null);
}

async function enter(handle = null) {
  const before = current();
  const editBefore = isEditMode;
  const controller = new AbortController();
  const context = {
    generation: ++generation,
    destination: modeState().destination,
    signal: controller.signal,
    // No reader on this road yet: the entry takes the page as it stands.
    represented: null,
    reader: null,
    initial: false,
    // Abandonment is cancellation as well as a newer generation: a lease that resolves
    // after the deadline belongs to no session and must not be kept.
    isCurrent: () => context.generation === generation && !controller.signal.aborted,
  };
  commitModeFacts({ phase: "entering", generation: context.generation, reason: null });
  // A tab that booted in edit is already running the sessions an entry would prepare, so
  // its exit adopts them rather than starting a second set.
  if (!handle) {
    initialSession = true;
    adoptedInitial = false;
    adopting = null;
  }

  const prepared = [];
  const fresh = [];
  let save = null;
  // The reader a declared document already runs: it hands over the file this session is
  // built from, and it is the only owner of the saved lane until the commit.
  let reader = null;
  // Whether any participant has been asked for a lease. Before that, a document this
  // release cannot start still has its guarded reload; after it, a failure is a refusal.
  let started = false;
  // Preparation answers only for itself: whatever it builds after the deadline is
  // disposed by the continuation that notices the abandonment, never here.
  const preparation = (async () => {
    try {
      // The edit plan's missing modules, imported while the committed mode is still view:
      // every import-time edit half is inert there, so what a module starts is exactly
      // what its lease starts at the commit.
      if (handle) {
        const plan = await import("./mode-switch.js");
        // Before anything is imported: the reader is asked for the file it represents,
        // and a reader without one leaves the caller its guarded reload.
        reader = await plan.prepareReader(handle, context);
        fresh.push(...(await plan.importPlan(handle, handle.edit, { signal: controller.signal })));
        // A file that arrived while the plan imported is applied before the baseline is
        // taken, so the session starts on what the article actually shows.
        await reader?.reconcile();
        context.represented = reader ? reader.represented : null;
        context.reader = reader;
        entryReceipt = context.represented;
      }
      // Inside the deadline, because the generation commits in the boundary below.
      save = handle?.loaded?.["core/save.js"] ?? (await import("./save.js"));
      for (const participant of await collectRoster(handle)) {
        started = true;
        const lease = await participant.prepare(context);
        if (!lease) continue;
        prepared.push(lease);
        if (!context.isCurrent()) throw fault(`"${participant.id}" prepared for a stale generation`, "stale-document");
        if (lease.ready) await lease.ready;
        if (!context.isCurrent()) throw fault(`"${participant.id}" became ready for a stale generation`, "stale-document");
      }
      // A live entry's baseline is the page as it stands: no reader has a receipt to take
      // it from, so one capture settles both baselines and the dirty gate's token. It is
      // taken for an entry with a reader and for one that came from view; only a boot that
      // already starts in edit keeps the baseline it settled when it read the file.
      if (handle || !editBefore) {
        const baseline = save.adoptEntryBaseline({ represented: context.represented });
        if (baseline && baseline.ok === false) {
          throw Object.assign(fault("the page moved since the last session", baseline.code || "pending-input"), baseline);
        }
        // One more look, because a frame can land while the roster prepares: the session
        // is built from the newest file the reader holds, queued or applied, not from an
        // older one it still shows.
        if (superseded(reader?.held ?? reader?.represented, context.represented)) {
          throw fault("the reader holds a newer file than the session was built from", "stale-document");
        }
      }
      return true;
    } catch (err) {
      disposeInReverse(prepared);
      throw err;
    }
  })();

  let timer = null;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(false);
    }, DEADLINE_MS);
  });

  let ready;
  try {
    ready = await Promise.race([preparation, deadline]);
  } catch (err) {
    clearTimeout(timer);
    controller.abort();
    // Nothing was prepared, so nothing has changed: the caller keeps its guarded reload
    // and the page goes back to an idle view. Once a lease exists, replacing the page
    // under it is worse than saying no.
    if (!started) {
      // A reader that was already holding the lane gives it back, so the page the guarded
      // reload replaces is not the only owner left.
      giveBack(reader);
      commitModeFacts({ phase: "idle", reason: null });
      return null;
    }
    giveBack(reader);
    return refuse(err?.code || "load-failed", "blocked", { message: err?.message });
  }
  clearTimeout(timer);
  if (!ready) {
    // The entry is over; its continuation still holds a lease that has not resolved.
    preparation.catch(() => {});
    // Everything already prepared is a claim on the article and a save hold: it goes
    // before the article is given back, so the reader takes it and the view updates.
    // Whatever the continuation prepares after this is disposed by its own catch.
    disposeInReverse(prepared.splice(0));
    giveBack(reader);
    return refuse("timeout");
  }

  // One synchronous boundary, no await between these steps: the mode facts commit while
  // the phase still says `entering` (so `canWrite()` is false), the root attribute and the
  // save generation follow, the leases enable, and only then does the phase go `idle` and
  // the one announcement out. An `enable` therefore sees the committed edit facts.
  // The reader retires first: its lane and the file it represents are this session's now,
  // and the leases that follow start on that file.
  reader?.commit();
  commitModeFacts({ mode: isDraftMode ? "draft" : "edit", isEditMode: true });
  // A boot's own entry keeps the parameter: it is how an owner's reload stays in edit.
  if (handle) dropEditmodeParam();
  setRootEditMode(true);
  save?.setSaveGeneration(context.generation);
  try {
    for (const lease of prepared) lease.enable();
  } catch (err) {
    // The blocked fault: the facts and the root attribute go back, everything prepared is
    // taken back in reverse, and the page keeps the reason. The reader this entry retired
    // is restarted from the file it handed over, so the view keeps receiving files.
    commitModeFacts({ mode: before, isEditMode: editBefore });
    setRootEditMode(false);
    disposeInReverse(prepared);
    controller.abort();
    if (handle) {
      const plan = await import("./mode-switch.js").catch(() => null);
      plan?.startReader(handle, entryReceipt);
    }
    return refuse(err?.code || "load-failed", "blocked", { message: err?.message });
  }
  leases = prepared;
  commitModeFacts({ phase: "idle", reason: null });
  announceMode();
  // One announcement per plugin this entry loaded, after the mode change: a plugin is
  // announced by the boot that loaded it exactly once, and a refused entry announces
  // nothing so the next successful one does.
  for (const path of fresh) handle?.announce?.(path);
  return { ok: true, mode: current(), changed: before !== current() };
}

// The sessions this tab's explicit initial edit already started, taken as leases over what
// the imports did rather than started again: a lease that starts nothing, quiesces and
// disposes the running session. A path that cannot be adopted leaves the caller its flush
// and reload.
async function adoptInitial(handle) {
  if (!handle) return [];
  // Only what is loaded now: the boot late tail may still be importing, and an exit waits
  // for no import. A module that lands after this point starts nothing, because it reads
  // the committed mode (or the `leaving` phase) when it evaluates, and it registers for
  // the next entry.
  const participants = [];
  for (const path of editPlanPaths(handle)) {
    const support = supportFor(path);
    if (support !== "export" && typeof support !== "function") continue;
    const mod = handle.loaded?.[path];
    // Not loaded: it started nothing, so there is nothing to hand back.
    if (!mod) continue;
    const participant = await (typeof support === "function" ? support(mod) : mod.modeParticipant?.());
    if (typeof participant?.id !== "string" || typeof participant.prepare !== "function") return null;
    participants.push(participant);
  }
  participants.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const adopted = [];
  const context = {
    generation,
    destination: modeState().destination,
    signal: undefined,
    represented: null,
    reader: null,
    initial: true,
    isCurrent: () => true,
  };
  for (const participant of participants) {
    let lease = null;
    try {
      lease = await participant.prepare(context);
    } catch {
      return null;
    }
    if (lease) adopted.push(lease);
  }
  return adopted;
}

// The bytes and stamp of this session's last accepted save, or null for a session that
// never saved: the receipt the restarted reader starts from. `generation` is this
// session's, so a save an older session made is never handed to the next reader.
async function acceptedReceipt(handle) {
  const save = handle?.loaded?.["core/save.js"] ?? (await import("./save.js").catch(() => null));
  return save?.acceptedReceipt?.(generation) ?? null;
}

// What the deadline answers with, so a wait can tell it apart from its own result.
const EXPIRED = Symbol("the exit deadline passed");

// The deadline every wait of one exit shares, taken before its first await so nothing it
// waits on can outlive the transition. One promise, so reaching it once is enough to
// release all of them.
function startDeadline() {
  let timer = null;
  const at = Date.now() + DEADLINE_MS;
  const expired = new Promise((resolve) => {
    timer = setTimeout(() => resolve(EXPIRED), DEADLINE_MS);
  });
  return { expired, remaining: () => Math.max(0, at - Date.now()), clear: () => clearTimeout(timer) };
}

// The view plan's missing modules, imported before anything is quiesced: an explicit
// Document edit never loaded its reader, and the same failure here refuses with nothing
// stopped. A live entry has them all, so this imports nothing. The import shares the
// boot's late tail, which an exit does not wait for forever: what the view needs is its
// reader, and a module still in flight stays cached and evaluates in view when it lands.
async function importViewPlan(handle, expired) {
  if (!handle) return;
  const plan = await import("./mode-switch.js");
  const importing = plan.importPlan(handle, handle.view);
  importing.catch(() => {});
  const answer = await Promise.race([importing.then(() => null, (err) => err), expired]);
  if (answer && answer !== EXPIRED) throw answer;
}

// Exit. Nothing here is a public flush: the barrier is the one write an exit may make, and
// it runs under the document-operation slot this transition takes and holds, so a
// replacement cannot start between the quiesce and the bytes.
async function leave(handle = null) {
  const deadline = startDeadline();
  try {
    return await leaveWithin(handle, deadline);
  } finally {
    deadline.clear();
  }
}

async function leaveWithin(handle, deadline) {
  // The boot's own sessions stay this exit's until it commits view: a refusal leaves the
  // tab in edit exactly as it was, and the next exit tries again with the same ones.
  const initial = initialSession;
  commitModeFacts({ phase: "leaving" });
  const transition = await import("./mode-transition.js").catch(() => null);
  if (!transition) return refuse("load-failed");
  let held = leases;
  // Adopting the boot's sessions is the first exit's work, and only while nothing has
  // been adopted yet: a refused exit keeps what it adopted to quiesce and dispose next.
  if (initial && !adoptedInitial) {
    adopting ??= adoptInitial(handle);
    // An adoption is a preparation like any other, so the deadline bounds it too: a
    // participant that awaits a boot that never settles cannot hold the exit open.
    const adopted = await Promise.race([adopting, deadline.expired]);
    if (adopted === EXPIRED) return refuse("timeout");
    if (!adopted) {
      adopting = null;
      commitModeFacts({ phase: "idle", reason: null });
      return null;
    }
    adoptedInitial = true;
    held = [...adopted, ...held];
    leases = held;
  }
  try {
    await importViewPlan(handle, deadline.expired);
  } catch (err) {
    return refuse(err?.code || "load-failed", "idle", { message: err?.message });
  }
  const quiesced = [];
  let operation = null;
  try {
    operation = transition.claimOperation("mode");
    if (!operation) throw fault("another document operation is in progress", "busy");
    for (const lease of [...held].reverse()) {
      quiesced.push(lease);
      // A quiesce that never settles is the deadline's business: past it the exit fails
      // and every lease it already asked resumes, so the tab stays in edit rather than
      // stuck in `leaving`.
      const answer = await Promise.race([Promise.resolve(lease.quiesce?.()), deadline.expired]);
      if (answer === EXPIRED) throw fault("the exit deadline passed while a lease quiesced", "timeout");
      // A refusal is a refusal whether it was thrown or answered.
      if (answer && answer.ok === false) {
        throw Object.assign(fault("a lease refused the exit", answer.code || "pending-input"), answer);
      }
    }
    // The barrier writes under the time this exit has left, not a fresh 15 s.
    const barrier = await transition.runSaveBarrier({ operation, timeoutMs: deadline.remaining() });
    if (!barrier.ok) throw Object.assign(fault("the exit barrier refused", barrier.code || "save-failed"), barrier);
  } catch (err) {
    for (const lease of [...quiesced].reverse()) {
      try {
        lease.resume?.();
      } catch {}
    }
    commitModeFacts({ phase: "idle", reason: err?.code || "save-failed" });
    return { ok: false, mode: current(), code: err?.code || "save-failed", state: err?.state, pending: err?.pending };
  } finally {
    if (operation) transition.releaseOperation(operation);
  }
  disposeInReverse(held);
  leases = [];
  initialSession = false;
  adoptedInitial = false;
  adopting = null;
  // The reader comes back on the file this session last saved, or on the one it was built
  // from when it saved nothing: a second entry commits without waiting for a frame.
  const accepted = (await acceptedReceipt(handle)) ?? entryReceipt;
  entryReceipt = null;
  if (handle) {
    const plan = await import("./mode-switch.js").catch(() => null);
    plan?.startReader(handle, accepted);
  }
  generation++;
  setRootEditMode(false);
  commitModeFacts({ mode: "view", isEditMode: false, phase: "idle", generation, reason: null });
  dropEditmodeParam();
  announceMode();
  return { ok: true, mode: "view", changed: true };
}

// The switch. Joining the transition already running for the same target answers with
// that same promise; asking for the other one while it runs answers busy — including for
// the mode still committed — and leaves the running transition untouched.
export function requestMode(target, handle = null) {
  if (target !== "edit" && target !== "view") throw new TypeError(`clay.modeLifecycle: unknown mode "${target}"`);
  if (inFlight) return inFlight.target === target ? inFlight.promise : { ok: false, mode: current(), code: "busy" };
  if (target === current()) return { ok: true, mode: current(), changed: false };
  if (isDraftMode || (target === "edit" && !canEdit)) return { ok: false, mode: current(), code: "not-allowed" };
  const promise = (target === "edit" ? enter(handle) : leave(handle)).finally(() => {
    inFlight = null;
  });
  inFlight = { target, promise };
  return promise;
}

// The public transaction for a document that signed the live-switch contract: the plan it
// resolved for an editor is checked first, and a document this release cannot start and
// take back answers `null` so its caller keeps the guarded reload.
export async function switchMode(target, plan) {
  // A decision this release cannot fetch leaves the caller its guarded reload, and the
  // failed import is not kept: the next ask asks again.
  const decision = await import("./mode-switch.js").catch(() => null);
  if (!decision || !decision.liveAllowed(plan)) return null;
  // A transition already running answers for itself: it joins or refuses, and this call
  // touches nothing on the way there.
  if (inFlight || target === current()) return requestMode(target, plan);
  if (target === "edit") decision.openResources();
  return requestMode(target, plan);
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
