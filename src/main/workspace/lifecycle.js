const KINDS = new Set(['quit', 'stop-server', 'remove-root', 'change-port', 'update-restart']);

function createWorkspaceLifecycle({ workspace, checkpoint, showMessage, execute,
  setTimer = setTimeout, clearTimer = clearTimeout, shellTimeoutMs = 10000 } = {}) {
  let nextId = 0;
  let active = null;

  function flush(request) {
    return new Promise((resolve, reject) => {
      if (!workspace.hasWindow() || !workspace.hasFlushListener?.()) return resolve([]);
      const flushId = `${request.id}:${++request.round}`;
      const timer = setTimer(() => {
        request.pending = null;
        reject(new Error('The workspace did not finish saving.'));
      }, shellTimeoutMs);
      request.pending = {
        id: flushId,
        resolve: participants => { clearTimer(timer); request.pending = null; resolve(participants); },
        reject: error => { clearTimer(timer); request.pending = null; reject(error); },
      };
      workspace.requestFlush(flushId);
    });
  }

  function receiveFlushResult(value) {
    const request = active;
    if (!request || !request.pending || value?.requestId !== request.pending.id || !Array.isArray(value.participants)) return false;
    const participants = value.participants;
    if (participants.some(item => !item || typeof item.id !== 'string' || !item.id ||
        !Number.isSafeInteger(item.revision) || item.revision < 0 || item.durable !== true)) {
      const error = new Error('Some edits are not saved yet.');
      error.unsaved = participants.filter(item => item && item.durable !== true).map(item => item.name || item.id);
      request.pending.reject(error);
      return true;
    }
    if (new Set(participants.map(item => item.id)).size !== participants.length) {
      request.pending.reject(new Error('The workspace save state is unknown.'));
      return true;
    }
    if ([...request.latest].some(([id, revision]) => {
      const item = participants.find(candidate => candidate.id === id);
      return !item || item.revision < revision;
    })) return false;
    for (const item of participants) request.latest.set(item.id, item.revision);
    request.pending.resolve(participants);
    return true;
  }

  function rendererGone() {
    active?.pending?.reject(new Error('The workspace stopped responding.'));
  }

  function sameParticipants(left, right) {
    return left.length === right.length && left.every(item =>
      right.some(next => next.id === item.id && next.revision === item.revision && next.durable === true));
  }

  async function once(request) {
    let prior = await flush(request);
    for (;;) {
      const result = await checkpoint.flushDirty({ timeoutMs: 5000, rootId: request.rootId ?? null });
      if (result.timedOut || result.unsaved.length) {
        const error = new Error('Some edits are not saved yet.');
        error.unsaved = result.unsaved;
        throw error;
      }
      if (!workspace.hasWindow()) break;
      const current = await flush(request);
      if (sameParticipants(prior, current)) break;
      prior = current;
    }
  }

  function requestTransition(kind, { rootId = null, run = null } = {}) {
    if (!KINDS.has(kind)) throw new TypeError('Invalid workspace transition');
    if (active) return active.kind === kind ? active.promise : Promise.resolve({ ok: false, error: 'busy' });
    const request = { id: ++nextId, round: 0, latest: new Map(), kind, rootId, run, pending: null, promise: null };
    active = request;
    request.promise = (async () => {
      try {
        await once(request);
      } catch (error) {
        workspace.show();
        const unsaved = Array.isArray(error.unsaved) ? error.unsaved : [];
        const { response } = await showMessage({ type: 'warning', message: "Some edits aren't saved yet.",
          detail: unsaved.length ? unsaved.join('\n') : error.message,
          buttons: ['Retry', 'Cancel'], defaultId: 1, cancelId: 1 });
        return response === 0 ? { retry: true } : { ok: false, error: 'cancelled' };
      }
      await execute(request.kind, request.rootId, request.run);
      return { ok: true };
    })().then(result => {
      if (!result.retry) return result;
      if (active === request) active = null;
      return requestTransition(kind, { rootId, run });
    }).finally(() => { if (active === request) active = null; });
    return request.promise;
  }

  return { requestTransition, receiveFlushResult, rendererGone };
}

module.exports = { createWorkspaceLifecycle };
