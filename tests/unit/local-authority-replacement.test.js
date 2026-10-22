const { liveTags } = require('@panphora/clayjs/server/rooms');
const { compatibleContinuation, renderRecovered } = require('../../src/main/external-recovery');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRooms } = require('@panphora/clayjs/server/rooms');
const { createLocalAuthority } = require('../../src/main/local-authority');
const { RootObserver } = require('../../src/main/root-observer');
const { withDocumentWrite } = require('../../src/main/utils/write-queue');
const { publishRecoveredCopy } = require('../../src/main/utils/backup');
const { createApp } = require('../../src/main/server');
const { pageFixture } = require('../helpers/page-fixture');
const request = require('supertest');

const baseline = '<!doctype html><html><body><article>confirmed</article><script type="application/json" merge="count" clay="live">{"n":0}</script></body></html>';
const room = (value) => ({
  epoch: 'epoch1', seq: 3, key: 'page.html', nodeId: 'node-1',
  stores: new Map([['count', { name: 'count', value: { n: value }, last: 3, landed: 0, ephemeral: false, log: [] }]]),
});

test('recovery of a document the checkpoint cannot render rewrites its persistent tags', () => {
  const recovered = renderRecovered(baseline, room(7));
  const [tag] = liveTags(recovered);

  expect(recovered).toContain('<article>confirmed</article>');
  expect(tag.text).toBe('{"n":7}');
  expect(tag.at).toMatchObject({ epoch: 'epoch1', seq: 3 });
  expect(compatibleContinuation(baseline, recovered, room(7))).toBe(true);
});

test('a changed article with identical persistent tags continues the room lineage', () => {
  expect(compatibleContinuation(baseline, baseline.replace('confirmed', 'external'), room(7))).toBe(true);
});

test('duplicate or inert persistent tags refuse recovery', () => {
  const duplicate = baseline.replace('</body>', '<script type="application/json" merge="count" clay="live">{"n":0}</script></body>');
  const inert = baseline.replace('<script', '<template><script').replace('</script>', '</script></template>');
  expect(() => renderRecovered(duplicate, room(7))).toThrow('Missing or duplicate recovery tag');
  expect(() => renderRecovered(inert, room(7))).toThrow('Missing or duplicate recovery tag');
});

describe('external replacement of a dirty room', () => {
  let dir;
  let file;
  let rooms;
  let authority;
  let target;
  let opened;

  beforeEach(async () => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'local-recovery-')));
    file = path.join(dir, 'page.html');
    fs.writeFileSync(file, baseline);
    rooms = createRooms({});
    authority = createLocalAuthority({ rooms, withDocument: withDocumentWrite });
    authority.registerRoot({ id: 'root-a', path: dir, canonicalPath: dir }, { owner: 'server' });
    target = authority.bindTarget({ rootId: 'root-a', logicalPath: 'page.html', canonicalPath: file });
    opened = await authority.roomFor(target, async () => ({
      rootId: 'root-a', logicalPath: 'page.html', canonicalPath: file, identity: target.identity,
    }));
    const accepted = rooms.apply(opened, 'client', {
      name: 'count', n: 1, epoch: opened.epoch, ops: [{ op: 'set', path: ['n'], value: 7 }],
    }, { connected: ['client'] });
    expect(accepted.error).toBeUndefined();
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('the observer saves accepted edits before disk replacement and sends the recovered ID', async () => {
    const foreign = baseline.replace('{"n":0}', '{"n":99}');
    const notifications = [];
    const observer = new RootObserver({ id: 'root-a', path: dir }, {
      localAuthority: authority,
      live: { notify: (...args) => notifications.push(args), broadcast: jest.fn() },
    });
    observer._runDataGuard = jest.fn();
    fs.writeFileSync(file, foreign);

    await observer._raw('change', 'page.html');

    expect(fs.readFileSync(file, 'utf8')).toBe(foreign);
    expect(authority.identityAt(file)).not.toBe(target.identity);
    expect(rooms.get(file)).toBeNull();
    const recovered = notifications[0][1].data.recovered;
    expect(notifications[0][1].data.reason).toBe('external-replacement');
    expect(recovered).toMatch(/^recovered-.*\.html$/);
    const stored = fs.readFileSync(path.join(dir, '.hyperclay', 'recovered', 'page', recovered.slice('recovered-'.length)), 'utf8');
    expect(liveTags(stored)[0].text).toBe('{"n":7}');
    expect(stored).toContain('<article>confirmed</article>');
  });

  test('a page replaced on disk keeps its unsaved edits in the recovered article, not a tag', async () => {
    const fixture = pageFixture('abc');
    const pagePath = path.join(dir, 'article.html');
    fs.writeFileSync(pagePath, fixture.html);
    const pageTarget = authority.bindTarget({ rootId: 'root-a', logicalPath: 'article.html', canonicalPath: pagePath });
    const pageRoom = await authority.roomFor(pageTarget, async () => ({
      rootId: 'root-a', logicalPath: 'article.html', canonicalPath: pagePath, identity: pageTarget.identity,
    }));
    const edited = rooms.apply(pageRoom, 'client', {
      name: 'page', n: 1, epoch: pageRoom.epoch, pageGeneration: pageRoom.pageTransition?.id ?? null,
      ops: [{ op: 'set', path: ['y', 'edit-1'], value: fixture.update }],
    }, { connected: ['client'] });
    expect(edited.error).toBeUndefined();
    const notifications = [];
    const observer = new RootObserver({ id: 'root-a', path: dir }, {
      localAuthority: authority,
      live: { notify: (...args) => notifications.push(args), broadcast: jest.fn() },
    });
    observer._runDataGuard = jest.fn();
    fs.writeFileSync(pagePath, baseline.replace('confirmed', 'external'));

    await observer._raw('change', 'article.html');

    expect(notifications[0][1].data.reason).toBe('external-replacement');
    const recovered = notifications[0][1].data.recovered;
    expect(recovered).toMatch(/^recovered-.*\.html$/);
    const stored = fs.readFileSync(path.join(dir, '.hyperclay', 'recovered', 'article', recovered.slice('recovered-'.length)), 'utf8');
    expect(stored).not.toContain('merge="page"');
    expect(stored).toContain('<p data-id="p">ac</p>');
    expect(stored).not.toContain('>abc<');
  });

  test('every registered alias history receives one recovered copy and its own notice', async () => {
    const aliasRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'local-recovery-second-')));
    const notices = [];
    authority.registerRoot({ id: 'root-b', path: aliasRoot, canonicalPath: aliasRoot }, { owner: 'server' });
    fs.symlinkSync(file, path.join(aliasRoot, 'alias.html'));
    authority.bindTarget({
      rootId: 'root-b', logicalPath: 'alias.html', canonicalPath: file,
      live: { notify: (...args) => notices.push(args) },
    });
    const observer = new RootObserver({ id: 'root-a', path: dir }, {
      localAuthority: authority,
      live: { notify: jest.fn(), broadcast: jest.fn() },
    });
    observer._runDataGuard = jest.fn();
    fs.writeFileSync(file, baseline.replace('{"n":0}', '{"n":99}'));
    try {
      await observer._raw('change', 'page.html');

      const first = fs.readdirSync(path.join(dir, '.hyperclay', 'recovered', 'page'));
      const second = fs.readdirSync(path.join(aliasRoot, '.hyperclay', 'recovered', 'alias'));
      expect(first).toHaveLength(1);
      expect(second).toHaveLength(1);
      expect(liveTags(fs.readFileSync(path.join(aliasRoot, '.hyperclay', 'recovered', 'alias', second[0]), 'utf8'))[0].text)
        .toBe('{"n":7}');
      expect(notices).toEqual([['alias.html', expect.objectContaining({
        data: expect.objectContaining({ reason: 'external-replacement', recovered: `recovered-${second[0]}` }),
      })]]);
    } finally {
      fs.rmSync(aliasRoot, { recursive: true, force: true });
    }
  });

  test('an article-only disk change keeps the accepted room state and its generation', async () => {
    const foreign = baseline.replace('confirmed', 'changed on disk');
    const notifications = [];
    const observer = new RootObserver({ id: 'root-a', path: dir }, {
      localAuthority: authority,
      live: { notify: (...args) => notifications.push(args), broadcast: jest.fn() },
    });
    observer._runDataGuard = jest.fn();
    fs.writeFileSync(file, foreign);

    await observer._raw('change', 'page.html');

    expect(authority.identityAt(file)).toBe(target.identity);
    expect(rooms.get(file)).toBe(opened);
    expect(rooms.get(file).stores.get('count').value).toEqual({ n: 7 });
    expect(notifications[0][1].data.reason).toBeUndefined();
    expect(fs.existsSync(path.join(dir, '.hyperclay', 'recovered'))).toBe(false);
  });

  test('a disk write stamped with the accepted room value continues the same generation', async () => {
    const continued = renderRecovered(baseline, opened).replace('confirmed', 'changed on disk');
    const observer = new RootObserver({ id: 'root-a', path: dir }, {
      localAuthority: authority,
      live: { notify: jest.fn(), broadcast: jest.fn() },
    });
    observer._runDataGuard = jest.fn();
    fs.writeFileSync(file, continued);

    await observer._raw('change', 'page.html');

    expect(authority.identityAt(file)).toBe(target.identity);
    expect(rooms.get(file)).toBe(opened);
    expect(rooms.get(file).stores.get('count').value).toEqual({ n: 7 });
    expect(fs.existsSync(path.join(dir, '.hyperclay', 'recovered'))).toBe(false);
  });

  test('a fresh authority after replacement opens disk bytes with a new epoch and no old receipts', async () => {
    const foreign = baseline.replace('{"n":0}', '{"n":99}');
    const observer = new RootObserver({ id: 'root-a', path: dir }, {
      localAuthority: authority,
      live: { notify: jest.fn(), broadcast: jest.fn() },
    });
    observer._runDataGuard = jest.fn();
    fs.writeFileSync(file, foreign);
    await observer._raw('change', 'page.html');

    const fresh = createLocalAuthority({ rooms: createRooms({}), withDocument: withDocumentWrite });
    fresh.registerRoot({ id: 'root-a', path: dir, canonicalPath: dir }, { owner: 'server' });
    const targetAfterRestart = fresh.bindTarget({ rootId: 'root-a', logicalPath: 'page.html', canonicalPath: file });
    const reopened = await fresh.roomFor(targetAfterRestart, async () => ({
      rootId: 'root-a', logicalPath: 'page.html', canonicalPath: file, identity: targetAfterRestart.identity,
    }));

    expect(reopened.stores.get('count').value).toEqual({ n: 99 });
    expect(reopened.epoch).not.toBe(opened.epoch);
    expect(reopened.lastN.size).toBe(0);
    expect(fs.readdirSync(path.join(dir, '.hyperclay', 'recovered', 'page'))).toHaveLength(1);
  });

  test('publication failure retains the dirty room and retries the missing copy', async () => {
    let fail = true;
    const publishedPaths = [];
    const publishRecovered = async (base, rel, html) => {
      if (fail && rel === 'alias.html') throw new Error('recovered disk unavailable');
      publishedPaths.push(rel);
      return publishRecoveredCopy(base, rel, html);
    };
    const isolated = createLocalAuthority({ rooms: createRooms({}), withDocument: withDocumentWrite, publishRecovered });
    isolated.registerRoot({ id: 'root-b', path: dir, canonicalPath: dir }, { owner: 'server' });
    isolated.registerRoot({ id: 'root-c', path: dir, canonicalPath: dir }, { owner: 'server' });
    const old = isolated.bindTarget({ rootId: 'root-b', logicalPath: 'page.html', canonicalPath: file });
    isolated.bindTarget({ rootId: 'root-c', logicalPath: 'alias.html', canonicalPath: file });
    const dirty = await isolated.roomFor(old, async () => ({ rootId: 'root-b', logicalPath: 'page.html', canonicalPath: file, identity: old.identity }));
    isolated.rooms.apply(dirty, 'client', {
      name: 'count', n: 1, epoch: dirty.epoch, ops: [{ op: 'set', path: ['n'], value: 5 }],
    }, { connected: ['client'] });
    const foreign = baseline.replace('{"n":0}', '{"n":99}');
    fs.writeFileSync(file, foreign);

    await expect(withDocumentWrite(async () => ({ canonicalPath: file }), (_target, token) =>
      isolated.observeExternal(old, foreign, token))).rejects.toThrow('recovered disk unavailable');

    expect(isolated.rooms.get(file)).toBe(dirty);
    isolated.rooms.drop(file);
    expect(isolated.rooms.get(file)).toBe(dirty);
    expect(fs.readdirSync(path.join(dir, '.hyperclay', 'recovered', 'page'))).toHaveLength(1);
    expect(fs.existsSync(path.join(dir, '.hyperclay', 'recovered', 'alias'))).toBe(false);
    expect(isolated.isCurrentTarget(old)).toBe(false);
    const oldClaim = isolated.captureAdmission({ rootId: 'root-b', logicalPath: 'page.html', canonicalPath: file });
    await expect(withDocumentWrite(async () => ({ canonicalPath: file }), (_target, token) =>
      isolated.validateAdmission(oldClaim, { rootId: 'root-b', logicalPath: 'page.html', canonicalPath: file }, token)))
      .rejects.toMatchObject({ code: 'moved' });

    fail = false;
    await withDocumentWrite(async () => ({ canonicalPath: file }), (_target, token) =>
      isolated.observeExternal(old, foreign, token));
    expect(isolated.rooms.get(file)).toBeNull();
    expect(isolated.identityAt(file)).not.toBe(old.identity);
    const files = fs.readdirSync(path.join(dir, '.hyperclay', 'recovered', 'page'));
    expect(files).toHaveLength(1);
    expect(fs.readdirSync(path.join(dir, '.hyperclay', 'recovered', 'alias'))).toHaveLength(1);
    expect(publishedPaths).toEqual(['page.html', 'alias.html']);
    expect(liveTags(fs.readFileSync(path.join(dir, '.hyperclay', 'recovered', 'page', files[0]), 'utf8'))[0].text)
      .toBe('{"n":5}');
  });

  test('an unknown unlink recovers the dirty room and retires the old URL', async () => {
    const notifications = [];
    const observer = new RootObserver({ id: 'root-a', path: dir }, {
      localAuthority: authority,
      live: { notify: (...args) => notifications.push(args), broadcast: jest.fn() },
    });
    const claim = authority.captureAdmission({ rootId: 'root-a', logicalPath: 'page.html', canonicalPath: file });
    fs.unlinkSync(file);

    await observer._raw('unlink', 'page.html');

    expect(authority.isRetired({ rootId: 'root-a', logicalPath: 'page.html', canonicalPath: file })).toBe(true);
    expect(authority.identityAt(file)).toBeNull();
    expect(rooms.get(file)).toBeNull();
    expect(notifications[0][1].data).toEqual(expect.objectContaining({
      reason: 'external-replacement', recovered: expect.stringMatching(/^recovered-.*\.html$/),
    }));
    await expect(withDocumentWrite(async () => ({ canonicalPath: file }), (_target, token) =>
      authority.validateAdmission(claim, { rootId: 'root-a', logicalPath: 'page.html', canonicalPath: file }, token)))
      .rejects.toMatchObject({ code: 'moved' });
  });

  test('a stat error cannot claim an unknown removal', async () => {
    const notify = jest.fn();
    const observer = new RootObserver({ id: 'root-a', path: dir }, {
      localAuthority: authority, live: { notify, broadcast: jest.fn() },
    });
    observer._stat = jest.fn().mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }));
    const logged = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await observer._raw('unlink', 'page.html');
    } finally {
      logged.mockRestore();
    }

    expect(notify).not.toHaveBeenCalled();
    expect(authority.identityAt(file)).toBe(target.identity);
    expect(rooms.get(file)).toBe(opened);
    expect(authority.isRetired({ rootId: 'root-a', logicalPath: 'page.html', canonicalPath: file })).toBe(false);
  });

  test('removing a symlink alias leaves the external room and its other root intact', async () => {
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'local-recovery-alias-')));
    const external = path.join(outside, 'shared.html');
    const alias = path.join(dir, 'alias.html');
    fs.writeFileSync(external, baseline);
    fs.symlinkSync(external, alias);
    authority.registerRoot({ id: 'root-b', path: outside, canonicalPath: outside }, { owner: 'server' });
    const a = authority.bindTarget({ rootId: 'root-a', logicalPath: 'alias.html', canonicalPath: external });
    const b = authority.bindTarget({ rootId: 'root-b', logicalPath: 'shared.html', canonicalPath: external });
    const shared = rooms.open(external, baseline, { nodeId: a.identity });
    const observer = new RootObserver({ id: 'root-a', path: dir }, {
      localAuthority: authority, live: { notify: jest.fn(), broadcast: jest.fn() },
    });
    try {
      fs.unlinkSync(alias);
      await observer._raw('unlink', 'alias.html');

      expect(rooms.get(external)).toBe(shared);
      expect(authority.identityAt(external)).toBe(b.identity);
      expect(authority.isRetired({ rootId: 'root-a', logicalPath: 'alias.html', canonicalPath: external })).toBe(true);
      expect(authority.isRetired({ rootId: 'root-b', logicalPath: 'shared.html', canonicalPath: external })).toBe(false);
      expect(fs.readFileSync(external, 'utf8')).toBe(baseline);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  test('a recovered copy refuses a symlinked history directory before creating a child', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'local-recovery-out-'));
    fs.mkdirSync(path.join(dir, '.hyperclay'));
    fs.symlinkSync(outside, path.join(dir, '.hyperclay', 'recovered'));
    try {
      await expect(publishRecoveredCopy(dir, 'page.html', baseline)).rejects.toThrow();
      expect(fs.readdirSync(outside)).toEqual([]);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  test('metadata advertises the shared room only on an authority-backed root', async () => {
    const root = { id: 'root-a', path: dir, port: 4321 };
    const backed = await request(createApp({ root, localAuthority: authority })).get('/_/meta');
    const legacy = await request(createApp(dir)).get('/_/meta');

    expect(backed.body.extensions).toEqual(expect.arrayContaining(['live-data', 'live-provenance']));
    expect(legacy.body.extensions).not.toContain('live-data');
    expect(legacy.body.extensions).not.toContain('live-provenance');
  });
});
