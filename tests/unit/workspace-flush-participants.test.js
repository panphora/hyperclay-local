const { createFlushParticipants } = require('../../src/main/workspace/flush-participants');
const { createWorkspaceLifecycle } = require('../../src/main/workspace/lifecycle');

function setup({ window = false, tabs = [] } = {}) {
  const delivered = [];
  const win = { hasWindow: () => window, hasFlushListener: () => window, show: jest.fn(), requestFlush: jest.fn() };
  const shell = { clients: [...tabs], flushClients() { return this.clients; }, requestFlush: jest.fn() };
  const flush = createFlushParticipants({ window: win, shell, deliver: result => delivered.push(result) });
  return { win, shell, flush, delivered };
}

test('answers from the window and every tab come back as one result with prefixed ids', () => {
  const { win, shell, flush, delivered } = setup({ window: true, tabs: ['1', '2'] });
  expect(flush.hasWindow()).toBe(true);
  flush.requestFlush('1:1');
  expect(win.requestFlush).toHaveBeenCalledWith('1:1');
  expect(shell.requestFlush).toHaveBeenCalledWith('1:1');
  const item = { id: 'doc', name: 'A.html', revision: 1, durable: true };
  expect(flush.fromWindow({ requestId: '1:1', participants: [item] })).toBe(true);
  expect(flush.fromTab('1', { requestId: '1:0', participants: [] })).toBe(false);
  expect(flush.fromTab('1', { requestId: '1:1', participants: [item] })).toBe(true);
  expect(delivered).toEqual([]);
  flush.tabGone('2');
  expect(delivered).toEqual([{ requestId: '1:1', participants: [
    { ...item, id: 'window:doc' }, { ...item, id: 'tab-1:doc' }] }]);
});

test('with no window and no tabs there is nobody to flush', () => {
  const { flush, delivered } = setup();
  expect(flush.hasWindow()).toBe(false);
  expect(flush.hasFlushListener()).toBe(false);
  flush.requestFlush('1:1');
  expect(delivered).toEqual([{ requestId: '1:1', participants: [] }]);
});

test('quit waits on a browser tab and warns about its unsaved code editor buffer', async () => {
  const { shell } = setup({ tabs: ['1'] });
  const showMessage = jest.fn(async () => ({ response: 1 }));
  const execute = jest.fn();
  let lifecycle;
  const joined = createFlushParticipants({ window: { hasWindow: () => false, show: jest.fn() }, shell,
    deliver: result => lifecycle.receiveFlushResult(result) });
  lifecycle = createWorkspaceLifecycle({ workspace: joined, showMessage, execute,
    checkpoint: { flushDirty: async () => ({ timedOut: false, unsaved: [] }) } });
  const quitting = lifecycle.requestTransition('quit');
  await new Promise(resolve => setImmediate(resolve));
  const requestId = shell.requestFlush.mock.calls[0][0];
  joined.fromTab('1', { requestId, participants: [{ id: 'code', name: 'A.html', revision: 3, durable: false }] });
  expect(await quitting).toEqual({ ok: false, error: 'cancelled' });
  expect(execute).not.toHaveBeenCalled();
  expect(showMessage.mock.calls[0][0].detail).toBe('A.html');
});
