const { nativeFixture } = require('./workspace-native-fixture');

test('only the owned shell main frame can answer a flush or open an external link', async () => {
  const accepted = jest.fn(() => true);
  const h = nativeFixture({ onFlushResult: accepted });
  const win = await h.workspace.openWorkspace();
  const result = { requestId: 1, participants: [] };
  const trusted = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  expect(h.handlers.get('workspace-flush-result')(trusted, result)).toBe(true);
  expect(accepted).toHaveBeenCalledWith(result);
  const child = { sender: win.webContents, senderFrame: { url: 'http://localhost:4321/A.html' } };
  expect(h.handlers.get('workspace-flush-result')(child, result)).toBe(false);
  expect(h.handlers.get('workspace-open-external')(child, 'https://hyperclay.com/docs')).toEqual({ ok: false, error: 'forbidden' });
  expect(h.handlers.get('workspace-open-external')({ sender: {}, senderFrame: win.webContents.mainFrame }, 'https://hyperclay.com/docs')).toEqual({ ok: false, error: 'forbidden' });
  expect(h.handlers.get('workspace-open-external')(trusted, 'javascript:alert(1)')).toEqual({ ok: false, error: 'blocked' });
  expect(h.handlers.get('workspace-open-external')(trusted, 'https://hyperclay.com/docs')).toEqual({ ok: true });
  expect(h.handlers.get('workspace-open-external')(trusted, 'http://localhost:4321/A.html')).toEqual({ ok: true });
  expect(h.handlers.get('workspace-open-external')(trusted, 'http://localhost:9999/A.html')).toEqual({ ok: false, error: 'blocked' });
});
