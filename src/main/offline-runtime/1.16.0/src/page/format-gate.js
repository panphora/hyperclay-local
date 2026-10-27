// The format gate: the one place a new-format command asks whether the document
// may use that format yet.
//
// R understands floor 1 and sends that capability on every page write, but has
// no floor-1 command of its own. F's first new-format command calls this gate
// before it touches content:
//
//   const gate = createFormatGate({ host, installed, revision, lane });
//   const result = await gate.run({ apply: (selection) => command(selection) });
//
// Activation adds the canonical marker to an otherwise equivalent capture and
// nothing else. It is idempotent, it is refused while an admitted page editor
// could not read floor 1, and a refusal leaves ordinary writing and every
// unsaved store exactly as they were. The command that asked only applies if the
// same editor installation and document revision still exist afterwards;
// otherwise the answer is retryable and the content is untouched.
//
// The host seam is deliberately one object, because the floor is read, checked
// and persisted under one per-document lock:
//
//   read()        -> Promise<{ floor, revision }>   the canonical floor as it stands
//   capabilities()-> Promise<number[]>              admitted page editors' declared capabilities
//   activate({ floor, capability, revision })
//                 -> Promise<{ accepted: true, revision, receipt }
//                          | { accepted: false, code }>
//
// `activate` holds the document's admission/write lock while it checks the
// admitted editors again and persists the marker, so a legacy registration that
// lands between `capabilities()` and `activate()` is refused rather than missed.

import { PAGE_FORMAT, PAGE_FORMAT_EXTENSION, PAGE_FORMAT_UPGRADE, formatCapability, notePageFormatFloor, pageFormatDecision, pageFormatFloor } from "./format-level.js";

const UPGRADE_MESSAGE = "This document uses a newer page format; update the editor in the other tabs to keep writing";

const upgrade = (required) => ({ status: "upgrade-required", code: PAGE_FORMAT_UPGRADE, required, minimum: required, message: UPGRADE_MESSAGE });

export function createFormatGate({
  host,
  capability = PAGE_FORMAT,
  supported = () => true,
  installed = () => null,
  revision = () => null,
  lane = null,
} = {}) {
  if (!host || typeof host.activate !== "function") throw new TypeError("format-gate: a host adapter is required");
  let floor = 0;
  let pending = null;
  let lanePending = false;
  let disposed = false;

  // The floor this gate knows the document at. A save or a room answer can tell
  // it, so a gate opened on an already-floor-1 document never asks to activate
  // again.
  function note(level) {
    floor = Math.max(floor, formatCapability(level));
    notePageFormatFloor(floor);
    return floor;
  }

  async function read() {
    try {
      const answer = await host.read();
      note(answer?.floor ?? pageFormatFloor(answer?.html));
    } catch {}
    return floor;
  }

  async function admittance() {
    try {
      const admitted = await host.capabilities();
      return Array.isArray(admitted) ? admitted : [];
    } catch {
      return [];
    }
  }

  // Whether a floor rise may happen at all: the host must have announced the
  // format contract, and this runtime must declare the capability it writes with.
  async function supportedHere() {
    try {
      return (await supported()) !== false;
    } catch {
      return false;
    }
  }

  async function activateNow() {
    if (disposed) return { status: "disposed", retry: false };
    if (!(await supportedHere())) return { status: "unsupported-host", code: "page-format-unsupported", extension: PAGE_FORMAT_EXTENSION };
    await read();
    if (floor >= PAGE_FORMAT) return { status: "active", floor };
    const admitted = await admittance();
    const early = pageFormatDecision({ floor, required: PAGE_FORMAT, capability, admitted });
    if (!early.ok) return upgrade(early.minimum);
    const stamp = { revision: revision(), installed: installed() };
    let answer;
    try {
      answer = await host.activate({ floor: PAGE_FORMAT, capability, revision: stamp.revision, installed: stamp.installed });
    } catch (error) {
      return { status: "failed", code: "page-format-activation-failed", error, retry: true };
    }
    if (!answer || answer.accepted !== true) {
      if (answer?.code === PAGE_FORMAT_UPGRADE) return upgrade(PAGE_FORMAT);
      return { status: "failed", code: answer?.code ?? "page-format-activation-failed", retry: true };
    }
    if (disposed) {
      // The save was accepted, so the document is at floor 1 either way; this
      // tab is gone and must not act on it.
      note(PAGE_FORMAT);
      return { status: "disposed", retry: false };
    }
    note(PAGE_FORMAT);
    lanePending = true;
    await joinLane(answer.receipt ?? null);
    return { status: "active", floor, receipt: answer.receipt ?? null };
  }

  // Joining the new lane scope happens after the receipt is accepted, and only
  // then: an interrupted switch leaves this tab on floor 0's scope with every
  // store intact and the switch still pending, never a lane it cannot cover.
  async function joinLane(receipt) {
    if (!lane || !lanePending) return false;
    try {
      const result = await lane.switchTo({ floor: PAGE_FORMAT, receipt });
      if (result && result.status === "switched") {
        lanePending = false;
        return true;
      }
    } catch {}
    return false;
  }

  function activate() {
    if (disposed) return Promise.resolve({ status: "disposed", retry: false });
    if (floor >= PAGE_FORMAT) return joinLane(null).then(() => ({ status: "active", floor }));
    if (!pending) pending = activateNow().finally(() => { pending = null; });
    return pending;
  }

  return {
    get floor() {
      return floor;
    },
    get disposed() {
      return disposed;
    },
    note,
    read,
    // Activation, once: a second caller while one is in flight waits on the
    // same attempt, and a retry after a failure starts a new one.
    activate,
    // A new-format command: capture what it applies to, ask the gate, and apply
    // only when activation succeeded and nothing moved underneath it.
    async run(command) {
      const stamp = { revision: revision(), installed: installed() };
      const result = await activate();
      if (result.status !== "active") return result;
      if (disposed) return { status: "disposed", retry: false };
      if (revision() !== stamp.revision || installed() !== stamp.installed) {
        return { status: "retry", code: "format-gate-stale", retry: true };
      }
      return { status: "applied", floor, result: await command?.apply?.(stamp) };
    },
    // Retry what is still pending: a lane switch whose receipt is in hand, or an
    // activation that failed on the wire. Unsaved work is never part of this.
    async retry() {
      if (disposed) return { status: "disposed", retry: false };
      if (await joinLane(null)) return { status: "active", floor };
      return activate();
    },
    // Disposal while awaiting the save: the answer is not applied, the lane is
    // not switched, and the deferred command does not run.
    dispose() {
      disposed = true;
      lanePending = false;
      return { status: "disposed" };
    },
  };
}
