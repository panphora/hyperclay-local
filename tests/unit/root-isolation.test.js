// C1.3: one app per served root. Two roots are two origins, two live-sync
// namespaces and two snapshot stores, even when they hold the same file names.
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const request = require('supertest');

// The guard and the API sidecar run detached from the request and would race the
// temp dir's removal; their extraction is not what this suite is about.
jest.mock('../../src/main/utils/data-extractor', () => ({
  extractData: jest.fn(),
  extractViaTag: jest.fn().mockResolvedValue(null),
  parseExtractionRules: jest.fn()
}));

const { createApp, getAndClearSnapshot } = require('../../src/main/server.js');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');

const PAGE = (port) => `http://localhost:${port}/index.html`;
const DOCUMENT = '<!DOCTYPE html><html><body><p>saved</p></body></html>';

async function startRoot(root) {
  const ctx = { root, devHooks: null, isKnownPath: null };
  const app = createApp(ctx);
  const server = await listenLoopback(app);
  root.port = server.address().port;
  return server;
}

// The `saved` lane frame a save broadcasts, read straight off the wire.
async function openStream(port, controller) {
  const url = `http://127.0.0.1:${port}/live-sync/stream?lane=saved&document-url=${encodeURIComponent(PAGE(port))}`;
  const res = await fetch(url, { signal: controller.signal });
  if (res.status !== 200) throw new Error(`stream refused: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const frames = [];
  const waiters = [];
  let buf = '';

  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop();
        for (const part of parts) {
          // Spec §10 opens the stream with a named `cursor` event carrying the
          // resume baseline. It is not a live-sync frame, and it deliberately does
          // not reach onmessage, so only unnamed events are frames here.
          if (part.includes('event: ')) continue;
          const line = part.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          const frame = JSON.parse(line.slice(6));
          if (waiters.length) waiters.shift()(frame);
          else frames.push(frame);
        }
      }
    } catch { /* aborted */ }
  })();

  return {
    frames,
    next(timeoutMs = 3000) {
      if (frames.length) return Promise.resolve(frames.shift());
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no frame arrived')), timeoutMs);
        waiters.push((frame) => { clearTimeout(timer); resolve(frame); });
      });
    },
  };
}

describe('C1.3: two roots on their own ports are isolated', () => {
  let personalDir;
  let teamDir;
  let personalRoot;
  let teamRoot;
  let personalApp;
  let teamApp;
  const controllers = [];

  beforeEach(async () => {
    personalDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'iso-personal-')));
    teamDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'iso-team-')));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    await fs.writeFile(path.join(personalDir, 'index.html'), '<html>personal</html>');
    await fs.writeFile(path.join(teamDir, 'index.html'), '<html>team</html>');

    personalRoot = { id: 'personal-root', kind: 'personal', path: personalDir, port: 0 };
    personalApp = await startRoot(personalRoot);
    teamRoot = { id: 'team-root-uuid', kind: 'team', path: teamDir, port: 0 };
    teamApp = await startRoot(teamRoot);
  });

  afterEach(async () => {
    for (const controller of controllers.splice(0)) controller.abort();
    await closeLoopback();
    await fs.rm(personalDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    await fs.rm(teamDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    jest.restoreAllMocks();
  });

  const track = () => {
    const controller = new AbortController();
    controllers.push(controller);
    return controller;
  };

  const save = (app, port, headers = {}) => {
    let req = request(app)
      .post('/save')
      .set('Document-URL', PAGE(port))
      .set('Content-Type', 'text/plain');
    for (const [key, value] of Object.entries(headers)) req = req.set(key, value);
    return req.send(DOCUMENT);
  };

  test('a save from another root\'s origin is refused and the file is untouched', async () => {
    const res = await save(personalApp, personalRoot.port, { Origin: `http://localhost:${teamRoot.port}` });

    expect(res.status).toBe(403);
    expect(res.body.msg).toBe('Cross-origin requests are not allowed.');
    expect(await fs.readFile(path.join(personalDir, 'index.html'), 'utf8')).toBe('<html>personal</html>');
  });

  test('Sec-Fetch-Site: same-site is refused: ports are not part of a browser site', async () => {
    const res = await save(personalApp, personalRoot.port, { 'Sec-Fetch-Site': 'same-site' });

    expect(res.status).toBe(403);
    expect(await fs.readFile(path.join(personalDir, 'index.html'), 'utf8')).toBe('<html>personal</html>');
  });

  test('the origin of the app\'s own port saves, under either loopback name', async () => {
    const named = await save(personalApp, personalRoot.port, { Origin: `http://localhost:${personalRoot.port}` });
    expect(named.status).toBe(200);
    expect(await fs.readFile(path.join(personalDir, 'index.html'), 'utf8')).toBe(DOCUMENT);

    const literal = await save(teamApp, teamRoot.port, { Origin: `http://127.0.0.1:${teamRoot.port}` });
    expect(literal.status).toBe(200);
    expect(await fs.readFile(path.join(teamDir, 'index.html'), 'utf8')).toBe(DOCUMENT);
  });

  test('the same file name in two roots never shares a live-sync channel', async () => {
    const personalStream = await openStream(personalRoot.port, track());
    const teamStream = await openStream(teamRoot.port, track());

    const res = await save(teamApp, teamRoot.port, { Origin: `http://localhost:${teamRoot.port}` });
    expect(res.status).toBe(200);

    const frame = await teamStream.next();
    expect(frame.sender).toBe('server-save');
    expect(frame.html).toBe(DOCUMENT);

    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(personalStream.frames).toEqual([]);
  });

  test('a snapshot is filed under the root that wrote it', async () => {
    const res = await save(teamApp, teamRoot.port, {
      Origin: `http://localhost:${teamRoot.port}`,
      'Save-Trigger': 'user',
    });
    expect(res.status).toBe(200);

    expect(getAndClearSnapshot('index.html', teamRoot.id)).toEqual({ html: null, userDriven: true });
    expect(getAndClearSnapshot('index.html', teamRoot.id)).toBeNull();
    expect(getAndClearSnapshot('index.html', personalRoot.id)).toBeNull();
  });

  test('the removed bus route is 404 on both roots', async () => {
    const team = await request(teamApp).get('/_/bus/subscribe?channel=ok');
    expect(team.status).toBe(404);

    const personal = await request(personalApp).get('/_/bus/subscribe?channel=ok');
    expect(personal.status).toBe(404);
  });
});
