// C1.3: the truncation guard's `/save` hook. The observer that answers
// `emptyPending` arrives in C2; this pins the refusal it drives.
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const request = require('supertest');

jest.mock('../../src/main/utils/data-extractor', () => ({
  extractData: jest.fn(),
  extractViaTag: jest.fn().mockResolvedValue(null),
  parseExtractionRules: jest.fn()
}));

const { createApp } = require('../../src/main/server.js');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');

const PAGE = 'http://localhost:4321/index.html';
const DOCUMENT = '<!DOCTYPE html><html><body><p>a whole document</p></body></html>';

describe('C1.3: a save over a file that is being emptied on disk is refused', () => {
  let dir;
  let app;
  let emptyPending;

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'truncation-')));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    emptyPending = false;
    app = await listenLoopback(createApp({
      root: { id: 'personal-root', kind: 'personal', path: dir, port: 4321 },
      devHooks: null,
      isKnownPath: null,
      observer: { emptyPending: () => emptyPending }
    }));
    await fs.writeFile(path.join(dir, 'index.html'), '');
  });

  afterEach(async () => {
    await closeLoopback();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    jest.restoreAllMocks();
  });

  const save = () => request(app)
    .post('/save')
    .set('Document-URL', PAGE)
    .set('Content-Type', 'text/plain')
    .send(DOCUMENT);

  test('a pending truncation answers 409 truncation-pending and writes nothing', async () => {
    emptyPending = true;

    const res = await save();

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('truncation-pending');
    expect(res.body.msgType).toBe('error');
    expect(res.body.msg).toBe('index.html was just emptied on disk; retry once that change reaches the page.');
    expect(await fs.readFile(path.join(dir, 'index.html'), 'utf8')).toBe('');
  });

  test('no pending truncation: the save proceeds', async () => {
    emptyPending = false;

    const res = await save();

    expect(res.status).toBe(200);
    expect(await fs.readFile(path.join(dir, 'index.html'), 'utf8')).toBe(DOCUMENT);
  });

  test('the guard is about an empty file, not about the observer alone', async () => {
    emptyPending = true;
    await fs.writeFile(path.join(dir, 'index.html'), '<html>on disk</html>');

    const res = await save();

    expect(res.status).toBe(200);
    expect(await fs.readFile(path.join(dir, 'index.html'), 'utf8')).toBe(DOCUMENT);
  });

  test('a first save of a file that does not exist yet is not a truncation', async () => {
    emptyPending = true;
    await fs.rm(path.join(dir, 'index.html'));

    const res = await save();

    expect(res.status).toBe(200);
    expect(await fs.readFile(path.join(dir, 'index.html'), 'utf8')).toBe(DOCUMENT);
  });
});
