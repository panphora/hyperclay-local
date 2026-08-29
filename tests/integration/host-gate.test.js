// The Malleable HTML File conformance page, run against a real listener.
//
// It is a browser test and cannot be anything else. The spec requires exact origin
// validation on every save, so a save can only be proven from the origin that will be
// allowed to make it, and the cross-origin check needs a real sandboxed iframe with a
// real opaque origin. Neither survives being reimplemented with supertest, and the
// unit tests beside this one deliberately do not try: they check the handlers, this
// checks the contract a document on the open web is written against.
//
// Skipped unless HOST_GATE=1, because it needs playwright and a downloaded browser,
// which is a heavy thing to put in front of `npm test` on a developer's machine.
// HOST_GATE_RUNNER points at the runner in the malleablehtmlfile repo.

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');

const run = promisify(execFile);

const enabled = process.env.HOST_GATE === '1';
const describeGate = enabled ? describe : describe.skip;

describeGate('Malleable HTML File host conformance', () => {
  let dir;
  let server;

  beforeAll(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'host-gate-')));
    await fs.writeFile(
      path.join(dir, 'index.html'),
      '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>seed</title></head><body><p>seed</p></body></html>'
    );
    const { createApp } = require('../../src/main/server.js');
    const app = createApp(dir);
    // Port 0, never the app's real 4321: a developer running this almost certainly has
    // Hyperclay Local itself open, and binding its port would either fail or, worse,
    // point the run at their live folder.
    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
  });

  afterAll(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (dir) await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  test('every check the page runs passes', async () => {
    const runner = process.env.HOST_GATE_RUNNER;
    if (!runner) throw new Error('HOST_GATE_RUNNER must point at malleablehtmlfile/scripts/host-test.mjs');

    const url = `http://127.0.0.1:${server.address().port}`;
    let stdout = '';
    try {
      // cwd is this repo, which is where the runner resolves playwright from.
      ({ stdout } = await run('node', [runner, '--url', url, '--root', dir], {
        cwd: path.join(__dirname, '..', '..'),
        maxBuffer: 8 * 1024 * 1024
      }));
    } catch (e) {
      // The runner separates the two, and so does this: exit 1 is a host that failed
      // checks, exit 2 is a harness that never ran them. Reporting a missing browser
      // as "the host is not conforming" would send someone to read server code.
      const what = e.code === 2
        ? 'the conformance run could not start (harness, not host)'
        : 'the conformance page reported failures';
      throw new Error(`${what}:\n${e.stdout || ''}${e.stderr || ''}`);
    }
    console.log(stdout);
    // A runner that exits 0 having produced nothing would pass this silently.
    expect(stdout).toMatch(/ passed,/);
  }, 180000);
});
