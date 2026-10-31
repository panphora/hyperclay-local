import * as Y from "../../vendor/yjs.vendor.js";
import { NET, createPageDoc, walk, docOf } from "./core.js";
import { createBridge, keepViewPos } from "./bridge.js";
import { createYProvider, entriesOf, dec } from "./provider.js";
import { createPageFileDebt } from "./file-debt.js";

export function createYPageBinding({ store, ydoc = new Y.Doc(), onNotice = () => {}, ownedTokens = [], authorToken = null, setTimer = setTimeout, clearTimer = clearTimeout, compact, captureTimeout = 500, checkpointWithin = () => {}, requestCheckpoint = null, requestExitCheckpoint = null, registerUnsavedState = null, onStopped = () => {}, journal = null, exitClosed = () => false, stats = { groups: 0, mismatch: 0, renders: 0, first: null } }) {
  for (const [, v] of entriesOf(store.value.y)) Y.applyUpdateV2(ydoc, dec(v), NET);
  const pd = createPageDoc(ydoc);
  // The journal is installed before the provider, because the provider is what sees an
  // update: nothing can reach the document without passing it first. Its own code lives
  // with the recovery channel and is only loaded when a page has one to journal into.
  const pageJournal = journal || null;
  // The input this tab owes the file, recorded before the provider because the provider is
  // what sees an update. The notification it fires through is attached once the binding's
  // own registration exists, so an update that arrives while this function is still
  // building cannot reach an uninitialized name.
  let notifyDebt = () => {};
  const debt = createPageFileDebt({ changed: () => notifyDebt() });
  const provider = createYProvider({
    store,
    ydoc,
    setTimer,
    clearTimer,
    compact,
    onStopped: (reason) => {
      if (reason === "page-full" || reason === "compaction-failed") Promise.resolve(requestCheckpoint?.({ timeoutMs: 10_000 })).catch(() => {});
      onStopped(reason);
    },
    onLocalUpdate: debt.local,
    journal: { local: (u) => pageJournal?.local(u), dependency: (u) => pageJournal?.dependency(u) },
  });
  const bridge = createBridge({ pd, onNotice, ownedTokens, authorToken, stats, captureTimeout });
  const waiters = new Set();
  let disposed = false;
  let checksQueued = false;
  const unsaved = registerUnsavedState?.({
    id: "page:live",
    isPending: () => (exitClosed() && debt.pending()) || store.pending.length > 0 || provider.pending || provider.reconcilePending || Boolean(pageJournal && pageJournal.pending() > (pageJournal.failure ? 1 : 0)),
    flush,
  });
  const changed = () => {
    unsaved?.changed();
    if (checksQueued) return;
    checksQueued = true;
    Promise.resolve().then(() => {
      checksQueued = false;
      if (!disposed) for (const waiter of [...waiters]) waiter.check();
    });
  };
  notifyDebt = changed;
  const offLocal = store.onLocal(() => { checkpointWithin(1500); changed(); });
  const offRebase = store.onRebase(changed);
  const offConfirm = store.onConfirm(() => {
    pageJournal?.acknowledged();
    changed();
  });
  // Everything the journal reports while this session is the active one is unsaved state:
  // a write in flight, a write the store refused, or a room that has not confirmed.
  if (pageJournal) pageJournal.onChange = changed;

  // Everything the file or the room still owes: this tab's own input, a store op no
  // answer has covered, a reconcile, a journal write still in flight.
  const exitPending = () =>
    debt.pending() || store.pending.length > 0 || provider.pending || provider.reconcilePending ||
    Boolean(pageJournal && pageJournal.pending() > (pageJournal.failure ? 1 : 0));

  // The exit's own flush, under the permit the barrier minted.
  //
  // A fast store's capture holds the room's value, so this tab's ops travel through the
  // room first; a file store's capture holds its pending ops as they stand, so the
  // checkpoint goes while they are still pending and their acceptance is what confirms
  // them. The checkpoint is asked for only when this tab owes the file input: a tab
  // holding nothing of its own leaves without making the room's writer save for it.
  function flushExit({ permit, deadline, keepalive, signal, timeoutMs }) {
    const end = Math.min(deadline ?? Infinity, Date.now() + timeoutMs);
    const over = () => signal?.aborted || Date.now() >= end;
    return new Promise((resolve) => {
      let done = false, timer = null, wake = null;
      const waiter = {
        check() { wake?.(); },
        finish(result) {
          if (done) return;
          done = true;
          waiters.delete(waiter);
          clearTimer(timer);
          signal?.removeEventListener("abort", aborted);
          resolve(result);
        },
      };
      const aborted = () => waiter.finish({ ok: false, code: "timeout" });
      const wait = (ms) => new Promise((woken) => {
        const wakeNow = () => {
          clearTimer(timer);
          wake = null;
          woken();
        };
        timer = setTimer(wakeNow, ms);
        wake = wakeNow;
      });
      const run = async () => {
        provider.settle();
        if (debt.pending() && requestExitCheckpoint) {
          const result = await requestExitCheckpoint({
            permit,
            deadline: end,
            signal,
            keepalive,
            needsSave: () => debt.pending(),
          });
          if (done) return;
          if (!result?.ok) {
            waiter.finish(result?.ok === false ? result : { ok: false, code: "checkpoint-failed" });
            return;
          }
        }
        while (!done) {
          if (!exitPending()) { waiter.finish({ ok: true }); return; }
          if (over()) { waiter.finish({ ok: false, code: "timeout" }); return; }
          await wait(50);
        }
      };
      waiters.add(waiter);
      signal?.addEventListener("abort", aborted, { once: true });
      run().catch((error) => waiter.finish({ ok: false, code: "flush-failed", message: error?.message || String(error) }));
    });
  }

  function flush({ permit = null, deadline: exitDeadline = null, keepalive = false, signal = null, timeoutMs = 10_000 } = {}) {
    if (disposed) return Promise.resolve({ ok: false, code: "disposed" });
    if (permit) return flushExit({ permit, deadline: exitDeadline, keepalive, signal, timeoutMs });
    return new Promise((resolve) => {
      const deadline = Date.now() + timeoutMs;
      let done = false, checking = false, checkpointing = false, timer = null;
      const waiter = { check, finish };
      function finish(result) {
        if (done) return;
        done = true;
        waiters.delete(waiter);
        clearTimer(timer);
        resolve(result);
      }
      function check() {
        if (done || checking || checkpointing) return;
        checking = true;
        try {
          provider.settle();
          if (store.pending.length) {
            checkpointWithin(0);
            if (store.pending.length) return;
          }
          checkpointing = true;
          if (!requestCheckpoint) { finish({ ok: true }); return; }
          Promise.resolve().then(() => {
            if (!done) return requestCheckpoint({ timeoutMs: Math.max(0, deadline - Date.now()) });
          }).then(finish, (error) => finish({ ok: false, code: "checkpoint-failed", message: error?.message || String(error) }));
        } catch (error) {
          finish({ ok: false, code: "flush-failed", message: error?.message || String(error) });
        } finally { checking = false; }
      }
      waiters.add(waiter);
      timer = setTimer(() => finish({ ok: false, code: "timeout" }), timeoutMs);
      check();
    });
  }

  // What the page's awareness UI asks of the mapping: the document, and the bridge's
  // current walk, which is the winning-copy view a remote position is read in and a
  // local one is written from. The UI never reaches into the bridge itself.
  const awareness = {
    generation: () => (Number.isSafeInteger(store.value?.g) && store.value.g >= 0 ? store.value.g : 0),
    map: () => ({ pd, w: bridge.walk }),
  };

  return {
    ydoc, pd, provider, bridge, stats, flush, awareness,
    get journal() { return pageJournal; },
    filePending: () => debt.pending(),
    acceptFile: (state) => debt.accepted(state),
    doc: () => keepViewPos(docOf(pd, walk(pd))),
    attach: (view) => bridge.attach(view),
    dispatch: (tr) => bridge.dispatch(tr),
    moveBlocks: (args) => bridge.moveBlocks(args),
    board: bridge.board,
    undo: () => bridge.undo(),
    redo: () => bridge.redo(),
    restore: (sourceKey, revision) => bridge.restore(sourceKey, revision),
    get recoverable() { return bridge.recoverable; },
    get notices() { return bridge.notices; },
    subscribeRecovery: (listener) => bridge.subscribeRecovery(listener),
    dismiss: (sourceKey, revision) => bridge.dismiss(sourceKey, revision),
    dispose() {
      if (disposed) return;
      disposed = true;
      offLocal();
      offRebase();
      offConfirm();
      unsaved?.dispose();
      // Best effort, never the primary path: every append already resolved on its own
      // commit, and what is left is only a write the store refused.
      pageJournal?.close();
      Promise.resolve(pageJournal?.channel?.flush?.()).catch(() => {});
      for (const waiter of [...waiters]) waiter.finish({ ok: false, code: "disposed" });
      bridge.dispose();
      provider.dispose();
    },
  };
}
