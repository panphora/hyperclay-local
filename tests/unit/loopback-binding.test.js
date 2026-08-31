// The suite talks to itself over loopback, and for a while it was talking to other
// programs instead. supertest starts a server with `listen(0)`, a WILDCARD bind, and
// then requests `http://127.0.0.1:<port>`. Those are not the same address: macOS will
// hand a wildcard bind a port another process already holds on 127.0.0.1 specifically,
// and it delivers the connection to the more specific listener. HTML Clay keeps one
// such listener per open file, so requests meant for this app came back as its 403s and
// 405s, in whichever suite happened to draw the shared port, at a rate that rose with
// machine load and fell to zero when a suite ran alone.
//
// `tests/helpers/loopback.js` binds 127.0.0.1 instead, which turns the collision into a
// plain EADDRINUSE. These tests hold that guarantee: revert the helper to a wildcard
// bind and the first two fail.

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const http = require('http');
const request = require('supertest');

const { createApp } = require('../../src/main/server.js');
const { listenLoopback, closeLoopback } = require('../helpers/loopback');

describe('a test server is addressable only as itself', () => {
  let dir;

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'loopback-')));
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    await closeLoopback();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    jest.restoreAllMocks();
  });

  test('it binds the address the test will address it on', async () => {
    const server = await listenLoopback(createApp(dir));

    expect(server.address().address).toBe('127.0.0.1');
  });

  test('a port a foreign loopback listener holds is refused, not shadowed', async () => {
    const decoy = http.createServer((req, res) => {
      res.statusCode = 403;
      res.end('not this server');
    });
    await new Promise((resolve) => decoy.listen(0, '127.0.0.1', resolve));
    const { port } = decoy.address();

    let refusal = null;
    try {
      await listenLoopback(createApp(dir), port);
    } catch (error) {
      refusal = error.code;
    }

    try {
      if (!refusal) {
        // The bind was allowed, so the port is shared. Which listener the request
        // reaches is the entire failure, so read it out rather than asserting a
        // bare boolean and reporting nothing.
        const res = await request(`http://127.0.0.1:${port}`).get('/_/meta');
        expect({ answeredBy: res.text, status: res.status })
          .toEqual({ answeredBy: 'the app under test', status: 200 });
      }
      expect(refusal).toBe('EADDRINUSE');
    } finally {
      await new Promise((resolve) => decoy.close(resolve));
    }
  });

  test('supertest reaches the server it was handed', async () => {
    const server = await listenLoopback(createApp(dir));

    const res = await request(server).get('/_/meta');

    expect(res.status).toBe(200);
    expect(res.body.spec).toBe(1);
  });
});
