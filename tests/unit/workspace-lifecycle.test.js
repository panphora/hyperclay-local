const fs = require('fs').promises;
const path = require('path');
const { createWorkspaceLifecycle } = require('../../src/main/workspace/lifecycle');
const { fixture } = require('./workspace-fixture');

function harness({ replies = [[{ id: 'A', revision: 1, durable: true }]], checkpointResult, dialogResponse = 1,
  hasWindow = true, hasFlushListener = true, timeout = false } = {}) {
  const order = [];
  let lifecycle;
  let call = 0;
  const workspace = {
    hasWindow: () => hasWindow,
    hasFlushListener: () => hasFlushListener,
    requestFlush: jest.fn(id => {
      const participants = replies[Math.min(call++, replies.length - 1)];
      if (!timeout) queueMicrotask(() => lifecycle.receiveFlushResult({ requestId: id, participants }));
    }),
    show: jest.fn(),
  };
  const checkpoint = { flushDirty: jest.fn(async options => {
    order.push('checkpoint');
    return checkpointResult || { attempted: 0, unsaved: [], timedOut: false };
  }) };
  const showMessage = jest.fn(async () => ({ response: dialogResponse }));
  const execute = jest.fn(async (_kind, _root, run) => {
    order.push('sync'); order.push('servers'); order.push('observers'); order.push('window');
    if (run) await run();
    order.push('finish');
  });
  lifecycle = createWorkspaceLifecycle({ workspace, checkpoint, showMessage, execute,
    ...(timeout ? { setTimer: callback => { queueMicrotask(callback); return 1; }, clearTimer: () => {} } : {}) });
  return { lifecycle, workspace, checkpoint, showMessage, execute, order };
}

test.each(['quit', 'stop-server', 'remove-root', 'change-port', 'update-restart'])('%s checkpoints before executing', async kind => {
  const h = harness();
  expect(await h.lifecycle.requestTransition(kind, { rootId: 'root-a' })).toEqual({ ok: true });
  expect(h.checkpoint.flushDirty).toHaveBeenCalledWith({ timeoutMs: 5000, rootId: 'root-a' });
  expect(h.order).toEqual(['checkpoint', 'sync', 'servers', 'observers', 'window', 'finish']);
  expect(h.workspace.requestFlush).toHaveBeenCalledTimes(2);
});

test('a new revision is flushed again inside the same request', async () => {
  const h = harness({ replies: [[{ id: 'A', revision: 1, durable: true }],
    [{ id: 'A', revision: 2, durable: true }], [{ id: 'A', revision: 2, durable: true }]] });
  expect(await h.lifecycle.requestTransition('quit')).toEqual({ ok: true });
  expect(h.workspace.requestFlush).toHaveBeenCalledTimes(3);
  expect(h.checkpoint.flushDirty).toHaveBeenCalledTimes(2);
});

test('a late response from an earlier flush and an older revision cannot authorize shutdown', async () => {
  const h = harness();
  let firstId;
  let round = 0;
  h.workspace.requestFlush.mockImplementation(id => {
    round++;
    queueMicrotask(() => {
      if (round === 1) {
        firstId = id;
        h.lifecycle.receiveFlushResult({ requestId: id, participants: [{ id: 'A', revision: 2, durable: true }] });
      } else {
        expect(h.lifecycle.receiveFlushResult({ requestId: firstId, participants: [{ id: 'A', revision: 2, durable: true }] })).toBe(false);
        expect(h.lifecycle.receiveFlushResult({ requestId: id, participants: [{ id: 'A', revision: 1, durable: true }] })).toBe(false);
        h.lifecycle.receiveFlushResult({ requestId: id, participants: [{ id: 'A', revision: 2, durable: true }] });
      }
    });
  });
  expect(await h.lifecycle.requestTransition('quit')).toEqual({ ok: true });
  expect(round).toBe(2);
});

test.each([
  ['refusal', [{ id: 'A', revision: 1, durable: false }]],
  ['unknown save', [{ id: 'A', revision: 1 }]],
  ['invalid revision', [{ id: 'A', revision: -1, durable: true }]],
  ['malformed participant', [null]],
])('%s cancels and keeps services available', async (_label, participants) => {
  const h = harness({ replies: [participants] });
  expect(await h.lifecycle.requestTransition('quit')).toEqual({ ok: false, error: 'cancelled' });
  expect(h.execute).not.toHaveBeenCalled();
  expect(h.workspace.show).toHaveBeenCalled();
  expect(h.showMessage).toHaveBeenCalledWith(expect.objectContaining({ buttons: ['Retry', 'Cancel'] }));
});

test('a refused named participant appears in the failure dialog', async () => {
  const h = harness({ replies: [[{ id: 'code:root-a/A.html', name: 'A.html', revision: 3, durable: false }]] });
  expect(await h.lifecycle.requestTransition('quit')).toEqual({ ok: false, error: 'cancelled' });
  expect(h.showMessage).toHaveBeenCalledWith(expect.objectContaining({ detail: 'A.html' }));
});

test('timeout and renderer loss cancel', async () => {
  const timed = harness({ timeout: true });
  expect(await timed.lifecycle.requestTransition('quit')).toEqual({ ok: false, error: 'cancelled' });
  const lost = harness({ timeout: true });
  lost.workspace.requestFlush.mockImplementation(() => queueMicrotask(() => lost.lifecycle.rendererGone()));
  expect(await lost.lifecycle.requestTransition('quit')).toEqual({ ok: false, error: 'cancelled' });
});

test('one unsaved room cancels, retry starts a new request, and late answers cannot authorize it', async () => {
  const h = harness({ checkpointResult: { attempted: 1, unsaved: ['/root/A.html'], timedOut: false } });
  const first = h.lifecycle.requestTransition('quit');
  expect(await first).toEqual({ ok: false, error: 'cancelled' });
  expect(h.lifecycle.receiveFlushResult({ requestId: 1, participants: [] })).toBe(false);
  expect(h.execute).not.toHaveBeenCalled();

  h.checkpoint.flushDirty.mockResolvedValue({ attempted: 0, unsaved: [], timedOut: false });
  h.showMessage.mockResolvedValueOnce({ response: 0 });
  h.workspace.requestFlush.mockImplementation(id => queueMicrotask(() => h.lifecycle.receiveFlushResult({ requestId: id,
    participants: [{ id: 'A', revision: 2, durable: true }] })));
  expect(await h.lifecycle.requestTransition('quit')).toEqual({ ok: true });
  expect(h.execute).toHaveBeenCalledTimes(1);
});

test('repeated Quit reuses its active promise; no window still checkpoints', async () => {
  const h = harness({ hasWindow: false });
  const first = h.lifecycle.requestTransition('quit');
  expect(h.lifecycle.requestTransition('quit')).toBe(first);
  expect(await first).toEqual({ ok: true });
  expect(h.workspace.requestFlush).not.toHaveBeenCalled();
  expect(h.checkpoint.flushDirty).toHaveBeenCalledTimes(1);
});

test('a window with no flush listener quits at once, with no dialog and no request', async () => {
  const h = harness({ hasFlushListener: false });
  expect(await h.lifecycle.requestTransition('quit')).toEqual({ ok: true });
  expect(h.workspace.requestFlush).not.toHaveBeenCalled();
  expect(h.showMessage).not.toHaveBeenCalled();
  expect(h.checkpoint.flushDirty).toHaveBeenCalledTimes(1);
  expect(h.order).toEqual(['checkpoint', 'sync', 'servers', 'observers', 'window', 'finish']);
});

test('a listener that unsubscribes before the transition quits like one that never registered', async () => {
  let listeners = 0;
  const h = harness({ hasFlushListener: false });
  h.workspace.hasFlushListener = () => listeners > 0;
  listeners = 1;
  expect(h.workspace.hasFlushListener()).toBe(true);
  listeners = 0;
  expect(await h.lifecycle.requestTransition('quit')).toEqual({ ok: true });
  expect(h.workspace.requestFlush).not.toHaveBeenCalled();
  expect(h.showMessage).not.toHaveBeenCalled();
});

test('real root source save reaches disk before shutdown executes', async () => {
  const h = await fixture();
  try {
    const file = path.join(h.dir, 'A.html');
    await fs.writeFile(file, '<!doctype html><html><body>before</body></html>');
    await h.startRoot();
    const request = await h.start();
    let lifecycle;
    let sent = false;
    const workspace = { hasWindow: () => true, hasFlushListener: () => true, show: jest.fn(), requestFlush: id => {
      void (async () => {
        if (!sent) {
          sent = true;
          const before = await (await request('/api/roots/root-a/source?path=A.html')).json();
          const saved = await request('/api/roots/root-a/source', { method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: 'A.html', html: before.html.replace('before', 'after'),
              etag: before.etag, operationId: 'native-flush' }) });
          expect(saved.status).toBe(200);
        }
        lifecycle.receiveFlushResult({ requestId: id, participants: [{ id: 'A', revision: 1, durable: true }] });
      })();
    } };
    const execute = jest.fn(async () => {
      expect(await fs.readFile(file, 'utf8')).toContain('after');
    });
    lifecycle = createWorkspaceLifecycle({ workspace, checkpoint: { flushDirty: async () => ({ unsaved: [], timedOut: false }) },
      showMessage: jest.fn(), execute });
    expect(await lifecycle.requestTransition('quit')).toEqual({ ok: true });
    expect(execute).toHaveBeenCalledTimes(1);
  } finally { await h.close(); }
});
