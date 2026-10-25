import * as Y from "../../vendor/yjs.vendor.js";
import { NET, createPageDoc, walk, docOf } from "./core.js";
import { createBridge, keepViewPos } from "./bridge.js";
import { createYProvider, entriesOf, dec } from "./provider.js";

export function createYPageBinding({ store, ydoc = new Y.Doc(), onNotice = () => {}, ownedTokens = [], authorToken = null, setTimer = setTimeout, clearTimer = clearTimeout, compact, captureTimeout = 500, checkpointWithin = () => {}, requestCheckpoint = null, registerUnsavedState = null, onStopped = () => {} }) {
  for (const [, v] of entriesOf(store.value.y)) Y.applyUpdateV2(ydoc, dec(v), NET);
  const pd = createPageDoc(ydoc);
  const provider = createYProvider({ store, ydoc, setTimer, clearTimer, compact, onStopped });
  const stats = { groups: 0, mismatch: 0, renders: 0, first: null };
  const bridge = createBridge({ pd, onNotice, ownedTokens, authorToken, stats, captureTimeout });
  const waiters = new Set();
  let disposed = false;
  let checksQueued = false;
  const unsaved = registerUnsavedState?.({ id: "page:live", isPending: () => store.pending.length > 0 || provider.reconcilePending, flush });
  const changed = () => {
    unsaved?.changed();
    if (checksQueued) return;
    checksQueued = true;
    Promise.resolve().then(() => {
      checksQueued = false;
      if (!disposed) for (const waiter of [...waiters]) waiter.check();
    });
  };
  const offLocal = store.onLocal(() => { checkpointWithin(1500); changed(); });
  const offRebase = store.onRebase(changed);
  const offConfirm = store.onConfirm(changed);

  function flush({ timeoutMs = 10_000 } = {}) {
    if (disposed) return Promise.resolve({ ok: false, code: "disposed" });
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

  return {
    ydoc, pd, provider, bridge, stats, flush,
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
      for (const waiter of [...waiters]) waiter.finish({ ok: false, code: "disposed" });
      bridge.dispose();
      provider.dispose();
    },
  };
}
