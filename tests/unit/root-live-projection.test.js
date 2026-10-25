// A tab that is already open receives frames and external-change notices, not served
// documents. Both carry HTML that can name the public runtime, which an offline tab
// cannot fetch, so both are projected too -- but without the descriptor: the tab
// already holds one, and an inserted element would shift live sync's identity map.

jest.mock('livesync-hyperclay', () => ({
  liveSync: {
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
    notify: jest.fn(),
    broadcast: jest.fn(),
    markBrowserSave: jest.fn(),
    wasBrowserSave: jest.fn(() => false),
  },
}));

const { liveSync } = require('livesync-hyperclay');
const { createRootLive } = require('../../src/main/utils/root-live');
const runtimeAssets = require('../../src/main/runtime-assets');

const selected = runtimeAssets.selectedVersion;
const PUBLIC = 'https://clayjs.com/v1/clay.js';
const LOCAL = `/_/clayjs/${selected}/clay.js`;
const DOC = (head) => `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n${head}\n</head>\n<body><p>hi</p></body>\n</html>`;

beforeEach(() => {
  liveSync.notify.mockClear();
  liveSync.broadcast.mockClear();
});

test('an external-change notice reaches tabs projected and without the descriptor', () => {
  const live = createRootLive({ id: 'root-a', kind: 'team' });

  live.notify('index.html', {
    msgType: 'warning',
    msg: 'index.html changed outside the editor',
    action: 'reload',
    data: { kind: 'external-change', html: DOC(`<script src="${PUBLIC}"></script>`), sender: 'file-system' },
  });

  expect(liveSync.notify).toHaveBeenCalledTimes(1);
  const [channel, payload] = liveSync.notify.mock.calls[0];
  expect(channel).toBe('root-a:index.html');
  expect(payload.msg).toBe('index.html changed outside the editor');
  expect(payload.data.kind).toBe('external-change');
  expect(payload.data.html).toContain(`src="${LOCAL}"`);
  expect(payload.data.html).not.toContain('src="https://clayjs.com');
  expect(payload.data.html).not.toContain('clay-runtime-map');
});

test('a saved frame reaches subscribers projected and without the descriptor', () => {
  const live = createRootLive({ id: 'root-a', kind: 'team' });

  live.broadcast('index.html', { html: DOC(`<script src="${PUBLIC}"></script>`), sender: 'server-save' }, { lane: 'saved' });

  expect(liveSync.broadcast).toHaveBeenCalledTimes(1);
  const [channel, payload, opts] = liveSync.broadcast.mock.calls[0];
  expect(channel).toBe('root-a:index.html');
  expect(opts).toEqual({ lane: 'saved' });
  expect(payload.html).toContain(`src="${LOCAL}"`);
  expect(payload.html).not.toContain('clay-runtime-map');
});

test('a notice with nothing to project is passed through unchanged', () => {
  const live = createRootLive({ id: 'root-a', kind: 'team' });
  const payload = { msgType: 'warning', action: 'reload', data: { kind: 'external-change', sender: 'data-api' } };

  live.notify('index.html', payload);

  expect(liveSync.notify.mock.calls[0][1]).toBe(payload);
});
