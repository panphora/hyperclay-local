// A Tailwind compile failure must not report the save as failed. By the time it
// runs, the file is already written, backed up and broadcast, so throwing out of
// the queued section returns 500 for a save that actually succeeded, and skips
// the platform-sync snapshot cached just below it. The sidecar refresh directly
// above already follows this rule; Tailwind was the one that did not.

jest.mock('../../src/main/utils/data-extractor', () => ({
  extractData: jest.fn(),
  extractViaTag: jest.fn().mockResolvedValue(null),
  parseExtractionRules: jest.fn()
}));

jest.mock('tailwind-hyperclay', () => {
  const actual = jest.requireActual('tailwind-hyperclay');
  return {
    ...actual,
    compileTailwind: jest.fn(async () => {
      throw new Error('simulated Tailwind compiler failure');
    })
  };
});

const request = require('supertest');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { createApp } = require('../../src/main/server.js');

const NAME = 'styled.html';
// getTailwindCssName only returns a name when the document links the stylesheet,
// which is what gates the compile we want to fail.
const HTML = '<html><head><link href="https://hyperclay.com/tailwindcss/styled.css"></head>'
  + '<body class="p-4">saved</body></html>';

let dir;
let app;

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'tw-nonfatal-')));
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  app = createApp(dir);
  await fs.writeFile(path.join(dir, NAME), '<html>original</html>');
});

afterEach(async () => {
  // The data-clobber guard is deliberately fire-and-forget, so it can still be
  // writing into .hyperclay/guard when the response has already returned. Without
  // retries this teardown races it and throws ENOTEMPTY.
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  jest.restoreAllMocks();
});

async function save(body) {
  return request(app)
    .post('/_/save')
    .set('Page-URL', `http://localhost:4321/${NAME}`)
    .set('Content-Type', 'text/plain')
    .send(body);
}

test('a Tailwind compile failure does not fail the save', async () => {
  const res = await save(HTML);
  expect(res.status).toBe(200);
});

test('the file is still written when the Tailwind compile throws', async () => {
  await save(HTML);
  expect(await fs.readFile(path.join(dir, NAME), 'utf8')).toContain('saved');
});

test('the failure is logged rather than swallowed silently', async () => {
  await save(HTML);
  const logged = console.error.mock.calls.some(
    (args) => String(args[0]).includes('compileTailwind failed')
  );
  expect(logged).toBe(true);
});
