// C2.4: the RootObserver owns the folder watcher. Real tmp dir, real chokidar,
// generous timeouts — the truncate-then-write window and the quiet publish are
// time behavior, so they are exercised against the clock, not fake timers.
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

jest.mock('../../src/main/data-loss-guard', () => ({
  runDataLossGuard: jest.fn().mockResolvedValue(null)
}));

const dataGuard = require('../../src/main/data-loss-guard');
const { documentEtag } = require('../../src/main/spec-wire');
const { RootObserver, EMPTY_QUIET_MS } = require('../../src/main/root-observer');

jest.setTimeout(20000);

const PAGE = (body) => `<!DOCTYPE html><html><body><p>${body}</p></body></html>`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Nothing is written before the watcher's own scan is done: a file created
// mid-scan is either missed or reported as a change rather than an add.
function watcherReady(watcher) {
  return new Promise((resolve) => watcher.once('ready', resolve));
}

async function waitFor(predicate, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await sleep(25);
  }
  throw new Error('timed out waiting for the watcher');
}

describe('RootObserver', () => {
  let dir;
  let observer;
  let live;
  let browserSaves;
  let changes;
  let removes;

  const file = (name) => path.join(dir, name);

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'root-observer-')));
    browserSaves = new Set();
    live = {
      notify: jest.fn(),
      broadcast: jest.fn(),
      wasBrowserSave: (rel) => browserSaves.has(rel),
      markBrowserSave: (rel) => browserSaves.add(rel)
    };
    changes = [];
    removes = [];
    observer = new RootObserver({ id: 'personal-root', kind: 'personal', path: dir, port: 4321 }, { live });
    observer.on('change', (event) => changes.push(event));
    observer.on('remove', (event) => removes.push(event));
    observer.start();
    await watcherReady(observer.watcher);
  });

  afterEach(async () => {
    await observer.stop();
    jest.clearAllMocks();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  test('an external write notifies, broadcasts the saved lane and emits change kind external', async () => {
    await fs.writeFile(file('index.html'), PAGE('first'));
    await waitFor(() => changes.length === 1);
    expect(changes[0].kind).toBe('external');

    live.notify.mockClear();
    live.broadcast.mockClear();
    changes.length = 0;

    const html = PAGE('edited outside the tab');
    await fs.writeFile(file('index.html'), html);
    await waitFor(() => changes.length === 1);

    const etag = documentEtag(Buffer.from(html));
    expect(live.notify).toHaveBeenCalledWith('index.html', {
      msgType: 'warning',
      msg: 'index.html changed on disk outside this tab',
      action: 'reload',
      data: { kind: 'external-change', html, sender: 'file-system', etag }
    });
    expect(live.broadcast).toHaveBeenCalledWith(
      'index.html',
      { html, sender: 'file-watcher' },
      { lane: 'saved' }
    );
    expect(changes).toEqual([{ rel: 'index.html', kind: 'external', html, etag }]);
    expect(dataGuard.runDataLossGuard).toHaveBeenCalledWith({
      baseDir: dir,
      name: 'index.html',
      newHtml: html,
      prevContent: null,
      prov: 'external',
      live
    });
  });

  test('a write marked by markBrowserSave does not notify and emits change kind self', async () => {
    await fs.writeFile(file('index.html'), PAGE('first'));
    await waitFor(() => changes.length === 1);

    live.notify.mockClear();
    live.broadcast.mockClear();
    dataGuard.runDataLossGuard.mockClear();
    changes.length = 0;
    live.markBrowserSave('index.html');

    await fs.writeFile(file('index.html'), PAGE('the tab saved this'));
    await waitFor(() => changes.length === 1);

    expect(changes).toEqual([{ rel: 'index.html', kind: 'self' }]);
    expect(live.notify).not.toHaveBeenCalled();
    expect(live.broadcast).not.toHaveBeenCalled();
    expect(dataGuard.runDataLossGuard).not.toHaveBeenCalled();
  });

  test('an unlink emits remove', async () => {
    await fs.writeFile(file('index.html'), PAGE('doomed'));
    await waitFor(() => changes.length === 1);

    await fs.unlink(file('index.html'));
    await waitFor(() => removes.length === 1);

    expect(removes).toEqual([{ rel: 'index.html' }]);
  });

  test('poke re-reads a file now instead of waiting for the watcher', async () => {
    const html = PAGE('restored by a poke');
    await fs.writeFile(file('index.html'), html);

    await observer.poke('index.html');

    expect(live.notify).toHaveBeenCalledTimes(1);
    expect(live.notify).toHaveBeenCalledWith('index.html', expect.objectContaining({
      data: expect.objectContaining({ kind: 'external-change', html, etag: documentEtag(Buffer.from(html)) })
    }));
    expect(changes).toEqual([{ rel: 'index.html', kind: 'external', html, etag: documentEtag(Buffer.from(html)) }]);
  });

  test('lease returns an idempotent release and emits lease-released', () => {
    const released = [];
    observer.on('lease-released', (event) => released.push(event));

    const release = observer.lease('index.html');
    expect(observer.leases).toBe(1);

    release();
    release();

    expect(observer.leases).toBe(0);
    expect(released).toEqual([{ rel: 'index.html' }]);
  });

  test('publishExternal sends the given msg', () => {
    const html = PAGE('restored from a backup');
    observer.publishExternal('index.html', Buffer.from(html), 'restored from .hyperclay/versions');

    expect(live.notify).toHaveBeenCalledWith('index.html', expect.objectContaining({
      msg: 'restored from .hyperclay/versions',
      action: 'reload',
      data: expect.objectContaining({ kind: 'external-change', html })
    }));
    expect(live.broadcast).toHaveBeenCalledWith('index.html', { html, sender: 'file-watcher' }, { lane: 'saved' });
    expect(changes).toEqual([{
      rel: 'index.html',
      kind: 'external',
      html,
      etag: documentEtag(Buffer.from(html))
    }]);
  });

  test('a truncate-then-write inside the quiet window publishes only the final content', async () => {
    await fs.writeFile(file('index.html'), PAGE('first'));
    await waitFor(() => changes.length === 1);
    changes.length = 0;

    await fs.writeFile(file('index.html'), '');
    await waitFor(() => observer.emptyPending('index.html'));
    expect(changes).toEqual([]);

    const html = PAGE('the editor wrote this');
    await fs.writeFile(file('index.html'), html);
    await waitFor(() => changes.length === 1);

    expect(changes).toEqual([
      { rel: 'index.html', kind: 'external', html, etag: documentEtag(Buffer.from(html)) }
    ]);
    expect(observer.emptyPending('index.html')).toBe(false);

    await sleep(EMPTY_QUIET_MS);
    expect(changes).toHaveLength(1);
  });

  test('a file left empty publishes once the quiet window passes', async () => {
    await fs.writeFile(file('index.html'), '');
    await waitFor(() => observer.emptyPending('index.html'));
    expect(changes).toEqual([]);

    const startedAt = Date.now();
    await waitFor(() => changes.length === 1);
    expect(Date.now() - startedAt).toBeGreaterThan(EMPTY_QUIET_MS - 500);
    expect(changes).toEqual([
      { rel: 'index.html', kind: 'external', html: '', etag: documentEtag(Buffer.from('')) }
    ]);
    expect(observer.emptyPending('index.html')).toBe(false);
  });

  test('subscribe receives raw events for uploads and folders and stops on dispose', async () => {
    const raws = [];
    const dispose = observer.subscribe((event) => raws.push(event));

    await fs.mkdir(file('projects'));
    await fs.writeFile(file('logo.png'), 'not html');
    await waitFor(() => raws.some((e) => e.event === 'addDir' && e.rel === 'projects')
      && raws.some((e) => e.event === 'add' && e.rel === 'logo.png'));

    expect(raws).toContainEqual({ event: 'addDir', rel: 'projects' });
    expect(raws).toContainEqual({ event: 'add', rel: 'logo.png' });
    expect(live.notify).not.toHaveBeenCalled();

    dispose();
    const seen = raws.length;
    await fs.writeFile(file('second.png'), 'not html either');
    await sleep(1500);
    expect(raws.length).toBe(seen);
  });

  test('stop clears the truncation timers and closes the watcher', async () => {
    await fs.writeFile(file('index.html'), '');
    await waitFor(() => observer.emptyPending('index.html'));

    await observer.stop();

    expect(observer.emptyPending('index.html')).toBe(false);
    expect(observer.emptyTimers.size).toBe(0);
    expect(observer.watcher).toBeNull();

    changes.length = 0;
    await sleep(500);
    expect(changes).toEqual([]);
  });
});
