// `/_/bus` message-bus route wiring: marker gating, channel validation, SSE
// subscribe/send round-trips, origin stamping, cross-origin rejection, body
// limits, and disconnect cleanup. See plans/hyperclay-local/message-bus-plan.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const request = require('supertest');

const { createApp, isLoopbackOrigin } = require('../../src/main/server.js');

// --- harness -----------------------------------------------------------------

let dir;
let app;
let server;
let port;
const openStreams = new Set();

test.before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bus-'));
  app = createApp(dir);
  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  port = server.address().port;
});

test.after(async () => {
  for (const controller of openStreams) controller.abort();
  await new Promise(resolve => server.close(resolve));
  server.closeAllConnections?.();
  await fs.rm(dir, { recursive: true, force: true });
});

// Open an SSE subscription and return { frames, next, close }. `next()`
// resolves with the next parsed envelope; frames buffers everything seen.
async function subscribe(query) {
  const controller = new AbortController();
  openStreams.add(controller);
  const res = await fetch(`http://127.0.0.1:${port}/_/bus/subscribe?${query}`, {
    signal: controller.signal
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const frames = [];
  const waiters = [];
  let buf = '';

  (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop();
        for (const part of parts) {
          const line = part.split('\n').find(l => l.startsWith('data: '));
          if (!line) continue; // comments (: connected / : ping)
          const envelope = JSON.parse(line.slice(6));
          if (waiters.length) waiters.shift()(envelope);
          else frames.push(envelope);
        }
      }
    } catch {}
  })();

  return {
    frames,
    next(timeoutMs = 2000) {
      if (frames.length) return Promise.resolve(frames.shift());
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out waiting for envelope')), timeoutMs);
        waiters.push(envelope => { clearTimeout(timer); resolve(envelope); });
      });
    },
    close() {
      controller.abort();
      openStreams.delete(controller);
    }
  };
}

function send(body, headers = {}) {
  let req = request(server).post('/_/bus/send');
  for (const [key, value] of Object.entries(headers)) req = req.set(key, value);
  return req.send(body);
}

// --- send/subscribe round-trips ----------------------------------------------

test('subscribe/send round-trip: envelope arrives with server stamps', async () => {
  const sub = await subscribe('channel=ai-edit');
  const res = await send(
    { channel: 'ai-edit', type: 'ai-edit/request', payload: { id: 'r1' }, sender: 'page-1' },
    { 'Page-URL': 'http://localhost:4321/hyperclay.html' }
  );
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { delivered: 1 });

  const envelope = await sub.next();
  assert.equal(envelope.channel, 'ai-edit');
  assert.equal(envelope.type, 'ai-edit/request');
  assert.equal(envelope.v, 1);
  assert.deepEqual(envelope.payload, { id: 'r1' });
  assert.equal(envelope.sender, 'page-1');
  assert.equal(envelope.origin, 'hyperclay.html'); // normalized from Page-URL
  assert.equal(typeof envelope.seq, 'number');
  sub.close();
});

test('origin stamps as "process" when no Page-URL header is present', async () => {
  const sub = await subscribe('channel=sys');
  await send({ channel: 'sys', type: 'sys/x', payload: {} });
  assert.equal((await sub.next()).origin, 'process');
  sub.close();
});

test('multi-channel subscribe demuxes on the channel field', async () => {
  const sub = await subscribe('channel=chan-a&channel=chan-b');
  await send({ channel: 'chan-a', type: 't/a', payload: {} });
  await send({ channel: 'chan-b', type: 't/b', payload: {} });
  assert.equal((await sub.next()).channel, 'chan-a');
  assert.equal((await sub.next()).channel, 'chan-b');
  sub.close();
});

test('send to an empty channel reports delivered: 0', async () => {
  const res = await send({ channel: 'nobody', type: 't/a', payload: {} });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { delivered: 0 });
});

test('sender echo: a subscriber receives its own sends and can filter by sender id', async () => {
  const sub = await subscribe('channel=echo');
  await send({ channel: 'echo', type: 't/a', payload: {}, sender: 'me' });
  const envelope = await sub.next();
  assert.equal(envelope.sender, 'me'); // server does not filter; receiver does
  sub.close();
});

test('disconnecting a subscriber unsubscribes it (next send delivers 0)', async () => {
  const sub = await subscribe('channel=leaver');
  await send({ channel: 'leaver', type: 't/a', payload: {} });
  await sub.next();
  sub.close();
  // The close propagates asynchronously; poll briefly for delivered to drop.
  let delivered = 1;
  for (let i = 0; i < 20 && delivered > 0; i++) {
    await new Promise(resolve => setTimeout(resolve, 25));
    delivered = (await send({ channel: 'leaver', type: 't/a', payload: {} })).body.delivered;
  }
  assert.equal(delivered, 0);
});

// --- validation and hardening --------------------------------------------------

test('subscribe requires at least one channel', async () => {
  const res = await request(server).get('/_/bus/subscribe');
  assert.equal(res.status, 400);
});

test('bad channel names are rejected on subscribe and send', async () => {
  assert.equal((await request(server).get('/_/bus/subscribe?channel=Bad%20Name')).status, 400);
  assert.equal((await send({ channel: 'Bad Name', type: 't/a' })).status, 400);
  assert.equal((await send({ channel: 'x'.repeat(65), type: 't/a' })).status, 400);
});

test('send requires a non-empty string type', async () => {
  assert.equal((await send({ channel: 'ok', type: '' })).status, 400);
  assert.equal((await send({ channel: 'ok' })).status, 400);
});

test('send requires a JSON body (text/plain is rejected)', async () => {
  const res = await request(server)
    .post('/_/bus/send')
    .set('Content-Type', 'text/plain')
    .send('{"channel":"ok","type":"t/a"}');
  assert.equal(res.status, 400);
});

test('cross-origin senders are rejected; loopback origins pass', async () => {
  const remote = await send({ channel: 'ok', type: 't/a' }, { Origin: 'https://evil.example' });
  assert.equal(remote.status, 403);
  const local = await send({ channel: 'ok', type: 't/a' }, { Origin: `http://localhost:${port}` });
  assert.equal(local.status, 200);
  const loopback = await send({ channel: 'ok', type: 't/a' }, { Origin: 'http://127.0.0.1:4321' });
  assert.equal(loopback.status, 200);
});

test('oversized bodies are rejected by the 10mb limit', async () => {
  const res = await send({ channel: 'ok', type: 't/a', payload: { blob: 'x'.repeat(11_000_000) } });
  assert.equal(res.status, 413);
});

test('non-loopback Host is rejected on both lanes (DNS rebinding)', async () => {
  const post = await send({ channel: 'ok', type: 't/a' }, { Host: 'evil.example:4321' });
  assert.equal(post.status, 403);
  const sub = await request(server).get('/_/bus/subscribe?channel=ok').set('Host', 'evil.example');
  assert.equal(sub.status, 403);
});

test('isLoopbackOrigin accepts loopback hosts only', () => {
  assert.equal(isLoopbackOrigin('http://localhost:4321'), true);
  assert.equal(isLoopbackOrigin('http://127.0.0.1:9999'), true);
  assert.equal(isLoopbackOrigin('http://[::1]:4321'), true);
  assert.equal(isLoopbackOrigin('https://evil.example'), false);
  assert.equal(isLoopbackOrigin('http://localhost.evil.example'), false);
  assert.equal(isLoopbackOrigin('not a url'), false);
});

// --- marker gating -------------------------------------------------------------

test('bare /bus/... falls through to static serving, not the bus', async () => {
  await fs.mkdir(path.join(dir, 'bus'), { recursive: true });
  await fs.writeFile(path.join(dir, 'bus', 'subscribe'), 'REAL FILE');
  const res = await request(server).get('/bus/subscribe?channel=ok');
  assert.equal(res.status, 200);
  assert.equal(Buffer.from(res.body).toString(), 'REAL FILE'); // extensionless file → served as a buffer
  const post = await request(server).post('/bus/send').send({ channel: 'ok', type: 't/a' });
  assert.equal(post.status, 404); // no static handler for POST → file lookup 404s
});
