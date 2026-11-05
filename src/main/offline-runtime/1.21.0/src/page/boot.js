export const PHASES = Object.freeze({
  loading: "loading",
  joining: "joining",
  adopting: "adopting",
  ready: "ready",
  blocked: "blocked",
  error: "error",
});

const TERMINAL = new Set([PHASES.ready, PHASES.blocked, PHASES.error]);

let installs = 0;

const monotonic = () => globalThis.performance?.now?.() ?? Date.now();

export function createInstall({ gen = 0, isCurrent = () => true, onPhase = null } = {}) {
  installs += 1;
  return {
    installId: installs,
    gen,
    isCurrent,
    onPhase: typeof onPhase === "function" ? onPhase : null,
    phase: PHASES.loading,
    result: null,
    at: monotonic(),
    controller: new AbortController(),
    disposers: [],
    disposed: false,
    steps: null,
    deferred: null,
  };
}

export function isCurrent(inst) {
  return !inst.disposed && !inst.controller.signal.aborted && inst.isCurrent() !== false;
}

// One owner: the view this installation mounted, and nothing a later or a cancelled
// installation staged. The final input gate asks this before it accepts a key.
export function ownsView(inst, mounted) {
  return isCurrent(inst) && !!mounted?.view && inst.mounted === mounted.view;
}

export function setPhase(inst, phase, reason = null) {
  if (TERMINAL.has(inst.phase) && inst.result) return inst.result;
  inst.phase = phase;
  inst.at = monotonic();
  inst.result = Object.freeze({ phase, reason: reason ?? null, installId: inst.installId, at: inst.at });
  try {
    inst.onPhase?.(inst.result);
  } catch (error) {
    console.error("clayjs: page boot phase callback failed", error);
  }
  return inst.result;
}

export function finishBlocked(inst, reason) {
  const result = setPhase(inst, PHASES.blocked, reason);
  inst.editorReadyResolve?.();
  return result;
}

export function finishError(inst, reason) {
  return setPhase(inst, PHASES.error, reason);
}

export function addDisposer(inst, dispose) {
  if (typeof dispose === "function") inst.disposers.push(dispose);
  return dispose;
}

export function disposeInstall(inst) {
  if (inst.disposed) return;
  inst.disposed = true;
  inst.mounted = null;
  try {
    inst.controller.abort();
  } catch (error) {
    console.error("clayjs: page boot abort failed", error);
  }
  const disposers = inst.disposers.splice(0).reverse();
  for (const dispose of disposers) {
    try {
      dispose();
    } catch (error) {
      console.error("clayjs: a page boot disposer failed", error);
    }
  }
}

export function mark(name, inst) {
  const perf = globalThis.performance;
  if (typeof perf?.mark !== "function") return;
  try {
    perf.mark(name, { detail: { installId: inst.installId } });
  } catch (error) {
    try { perf.mark(name); } catch (ignored) { return; }
  }
}

// A boot that ends without an editor gives up what its steps acquired on the way
// there, through the install's own teardown, before it reports where it stopped.
function release(inst, steps) {
  try {
    steps.release?.(inst);
  } catch (error) {
    console.error("clayjs: page boot release failed", error);
  }
}

function stop(inst, result, steps) {
  if (result.cancelled) return null;
  release(inst, steps);
  return finishBlocked(inst, result.reason ?? "boot-incomplete");
}

// A branch of the parallel boot reports its own failure here, so a rejection in one
// cannot leave an unhandled rejection or a late continuation mounting the other. The
// mark it owns is emitted when it settles, which is what proves the two overlapped.
function branch(promise, inst, reason, name = null) {
  return Promise.resolve(promise)
    .then((result) => result ?? { ok: false, reason }, (error) => {
      console.error(`clayjs: page boot ${reason}`, error);
      return { ok: false, reason };
    })
    .then((result) => {
      if (result.ok && name && isCurrent(inst)) mark(name, inst);
      return result;
    });
}

// The wait on the parallel branches: the first one to fail, or the install's abort,
// answers it at once. A boot blocked by the download that failed must not sit in
// `joining` on the join that never answered, and a disposed install must not wait for
// either of them.
function settleBranches(inst, branches) {
  return new Promise((resolve) => {
    const signal = inst.controller.signal;
    let done = false;
    const finish = (outcome) => {
      if (done) return;
      done = true;
      resolve(outcome);
    };
    if (signal.aborted) return finish({ cancelled: true });
    signal.addEventListener("abort", () => finish({ cancelled: true }), { once: true });
    const results = new Array(branches.length);
    let left = branches.length;
    branches.forEach((branch, index) => {
      branch.then((result) => {
        if (done) return;
        if (!result.ok) return finish({ result, branch });
        results[index] = result;
        left -= 1;
        if (left === 0) finish({ results });
      });
    });
  });
}

// One coordinator for the edit boot: read the source, take the assets while
// authority is prepared, mount, adopt, then enable input. Every step reports an
// outcome and every await is followed by an ownership check, so a late or
// cancelled installation can neither mutate the page nor mark it ready.
export async function runBoot(inst, steps, { activate = true } = {}) {
  mark("document:boot", inst);
  setPhase(inst, PHASES.loading);

  const read = steps.readSource(inst);
  if (!isCurrent(inst)) return null;
  if (!read.ok) return finishBlocked(inst, read.reason);
  const source = read.source;

  // The editor's code arrives while authority is prepared, so the wait is the longer
  // of the two plus adoption rather than their sum. Neither branch subscribes a
  // resource or touches the page: only the coordinator does, after both are in.
  setPhase(inst, PHASES.joining);
  const settled = await settleBranches(inst, [
    branch(steps.loadEditorAssets(inst, source), inst, "editor-assets-failed", "document:assets-ready"),
    branch(steps.prepareAuthority(inst, source), inst, "authority-failed", "document:authority-ready"),
  ]);
  if (settled.cancelled || !isCurrent(inst)) return null;
  if (!settled.results) {
    // The branch still on the wire is not worth waiting for, and it must not go on to
    // subscribe anything: the abort ends it where its next ownership check is.
    try {
      inst.controller.abort();
    } catch (error) {
      console.error("clayjs: page boot abort failed", error);
    }
    return stop(inst, settled.result, steps);
  }
  const [loaded, admitted] = settled.results;

  const mounted = steps.mountAndAttach(inst, source, loaded, admitted);
  if (!isCurrent(inst)) return null;
  if (!mounted.ok) return stop(inst, mounted, steps);
  inst.mounted = mounted.view ?? null;

  setPhase(inst, PHASES.adopting);
  const adoption = await steps.adoptSource(inst, source, mounted);
  if (!isCurrent(inst)) return null;
  if (!adoption.ok) return stop(inst, adoption, steps);

  // A session that has not committed yet stages the editor and leaves input and every
  // write closed: the checks input waits for run now, so the commit that opens it has
  // nothing left to wait on or fail.
  if (!activate) {
    if (steps.prepareInput) {
      const prepared = await steps.prepareInput(inst, mounted);
      if (!isCurrent(inst)) return null;
      if (!prepared.ok) return stop(inst, prepared, steps);
    }
    inst.deferred = mounted;
    return { phase: inst.phase, view: mounted.view, deferred: true };
  }

  const enabled = await steps.enableInput(inst, mounted);
  if (!isCurrent(inst)) return null;
  if (!enabled.ok) return stop(inst, enabled, steps);

  mark("document:input-ready", inst);
  return setPhase(inst, PHASES.ready);
}

// The commit that enters edit opens the input the preparation held back. Every check
// it needs passed for this very mount, so it is synchronous: it changes activation
// only, never durable data.
export function activateInput(inst) {
  const mounted = inst.deferred;
  inst.deferred = null;
  if (!mounted || !isCurrent(inst)) return inst.result ?? null;
  const opened = inst.steps?.openInput?.(inst, mounted);
  if (!opened?.ok) return finishBlocked(inst, opened?.reason ?? "input-refused");
  mark("document:input-ready", inst);
  return setPhase(inst, PHASES.ready);
}
