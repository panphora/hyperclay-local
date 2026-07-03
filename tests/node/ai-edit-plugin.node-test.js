// The built-in ai-edit plugin, end to end over the real /_/bus HTTP routes:
// @engine routing (@fable, @page, unknown agents), served-folder root jail,
// user-defined engines through the generic adapter (stdin + {prompt} argv,
// streaming, failure, missing binary), and the enabled toggle. Model spawns
// are mocked (MOCK_MODEL) for routing tests; generic-adapter tests spawn the
// real fixture agents in tests/fixtures/. See
// plans/hyperclay-local/ai-edit-plugin-plan.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const { createApp } = require('../../src/main/server.js');
const { startPlugins, stopPlugins } = require('../../src/main/plugins');

const FIXTURES = path.join(__dirname, '..', 'fixtures');

let dir;
let server;
let BUS;
let sub;

const SETTINGS = {
  aiEdit: {
    engines: {
      echo: ['node', path.join(FIXTURES, 'echo-agent.js')],
      argbot: ['node', path.join(FIXTURES, 'arg-agent.js'), '{prompt}'],
      broken: ['node', path.join(FIXTURES, 'fail-agent.js')],
      ghost: ['definitely-not-a-real-binary-xyz']
    }
  }
};

test.before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-edit-plugin-'));
  await fs.writeFile(path.join(dir, 'notes.txt'), 'served-folder context');
  await fs.writeFile(path.join(path.dirname(dir), 'outside-' + path.basename(dir) + '.txt'), 'outside');
  const app = createApp(dir);
  server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  BUS = `http://127.0.0.1:${server.address().port}/_/bus`;
  startPlugins({ baseDir: dir, settings: SETTINGS });
  sub = await subscribe();
});

test.after(async () => {
  stopPlugins();
  delete process.env.MOCK_MODEL;
  sub?.close();
  await new Promise(resolve => server.close(resolve));
  server.closeAllConnections?.();
  await fs.rm(dir, { recursive: true, force: true });
});

// --- page-side helpers (same shape as the hyperclay-pages smoke suite) ------

async function subscribe() {
  const controller = new AbortController();
  const res = await fetch(`${BUS}/subscribe?channel=ai-edit`, { signal: controller.signal });
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
          if (!line) continue;
          const envelope = JSON.parse(line.slice(6));
          if (envelope.sender === 'page-test') continue;
          let waiter;
          while ((waiter = waiters.shift()) && waiter.settled) {}
          if (waiter) waiter.resolve(envelope);
          else frames.push(envelope);
        }
      }
    } catch {}
  })();
  return {
    next(timeoutMs = 8000) {
      if (frames.length) return Promise.resolve(frames.shift());
      return new Promise((resolve, reject) => {
        const waiter = { settled: false, resolve: null };
        const t = setTimeout(() => { waiter.settled = true; reject(new Error('timed out waiting for envelope')); }, timeoutMs);
        waiter.resolve = envelope => { clearTimeout(t); waiter.settled = true; resolve(envelope); };
        waiters.push(waiter);
      });
    },
    close() { controller.abort(); }
  };
}

function send(type, payload) {
  return fetch(`${BUS}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: 'ai-edit', type, v: 1, payload, sender: 'page-test' })
  }).then(r => r.json());
}

async function expectAck(id) {
  const first = await sub.next();
  assert.equal(first.type, 'ai-edit/ack', 'first reply frame is the ack');
  assert.equal(first.payload.id, id);
}

async function gather(id) {
  let buffer = '', nextIndex = 0;
  while (true) {
    const envelope = await sub.next();
    assert.equal(envelope.payload.id, id);
    if (envelope.type === 'ai-edit/delta') {
      assert.equal(envelope.payload.index, nextIndex, 'delta indexes are ordered');
      nextIndex++;
      buffer += envelope.payload.text;
    } else if (envelope.type === 'ai-edit/done' || envelope.type === 'ai-edit/error') {
      return {
        buffer,
        deltas: nextIndex,
        done: envelope.type === 'ai-edit/done' ? envelope.payload : null,
        error: envelope.type === 'ai-edit/error' ? envelope.payload : null
      };
    } else {
      throw new Error('unexpected type ' + envelope.type);
    }
  }
}

const elementHTML = '<section data-edit-id="hero">\n  <h1>Old title</h1>\n</section>';
const base = { editId: 'hero', tag: 'section', elementHTML, contextRefs: [] };

// --- engine routing (mock model) ---------------------------------------------

test('@fable routes to Fable 5 through the plugin', async () => {
  process.env.MOCK_MODEL = '1';
  await send('ai-edit/request', { ...base, id: 'p1', comment: '@fable make this poetic' });
  await expectAck('p1');
  const { done } = await gather('p1');
  assert.equal(done.model, 'mock(claude-fable-5)');
  assert.ok(done.html.includes('mock edit: make this poetic'), '@fable stripped from the prompt');
});

test('untagged comments use the default engine', async () => {
  await send('ai-edit/request', { ...base, id: 'p2', comment: 'make the title friendlier' });
  await expectAck('p2');
  const { done } = await gather('p2');
  assert.equal(done.model, 'mock(claude-opus-4-8)');
});

test('an unknown leading @agent is an error that lists the known engines', async () => {
  await send('ai-edit/request', { ...base, id: 'p3', comment: '@nope tighten this' });
  await expectAck('p3');
  const { done, error } = await gather('p3');
  assert.equal(done, null);
  assert.match(error.message, /unknown agent @nope/);
  assert.match(error.message, /@codex/, 'built-ins are listed');
  assert.match(error.message, /@echo/, 'user-defined engines are listed');
});

test('a leading @page is a context token, never an engine', async () => {
  await send('ai-edit/request', { ...base, id: 'p4', comment: '@page tighten this', pageHTML: '<html></html>' });
  await expectAck('p4');
  const { done } = await gather('p4');
  assert.equal(done.model, 'mock(claude-opus-4-8)');
});

// --- context refs jailed to the served folder --------------------------------

test('a context ref inside the served folder resolves', async () => {
  await send('ai-edit/request', { ...base, id: 'p5', comment: 'see @notes.txt', contextRefs: ['notes.txt'] });
  await expectAck('p5');
  const { done } = await gather('p5');
  assert.ok(done);
});

test('an escaping context ref becomes ai-edit/error', async () => {
  await send('ai-edit/request', { ...base, id: 'p6', comment: 'use @../x', contextRefs: ['../x'] });
  await expectAck('p6');
  const { error } = await gather('p6');
  assert.match(error.message, /escapes the served folder/);
});

// --- user-defined engines: the generic adapter (real spawns) -----------------

test('generic engine: prompt on stdin, streamed stdout deltas, done', async () => {
  delete process.env.MOCK_MODEL;
  await send('ai-edit/request', { ...base, id: 'p7', comment: '@echo do the thing' });
  await expectAck('p7');
  const { done, deltas } = await gather('p7');
  assert.ok(done, 'echo agent completes');
  assert.ok(done.html.includes('echo saw-prompt'), 'the prompt reached stdin');
  assert.equal(done.model, 'echo');
  assert.ok(deltas >= 1, `stdout streamed as deltas (${deltas})`);
});

test('generic engine: {prompt} placeholder substitutes at argv level', async () => {
  await send('ai-edit/request', { ...base, id: 'p8', comment: '@argbot do the thing' });
  await expectAck('p8');
  const { done } = await gather('p8');
  assert.ok(done.html.includes('arg:ok'), 'the prompt reached argv');
});

test('a failing engine surfaces exit code and stderr', async () => {
  await send('ai-edit/request', { ...base, id: 'p9', comment: '@broken do the thing' });
  await expectAck('p9');
  const { done, error } = await gather('p9');
  assert.equal(done, null);
  assert.match(error.message, /exited \(3\)/);
  assert.match(error.message, /boom/);
});

test('a missing binary is a friendly error, not a crash', async () => {
  await send('ai-edit/request', { ...base, id: 'p10', comment: '@ghost do the thing' });
  await expectAck('p10');
  const { error } = await gather('p10');
  assert.match(error.message, /@ghost isn't available/);
});

// --- the enabled toggle -------------------------------------------------------

test('aiEdit.enabled=false serves nothing: no ack, request evaporates', async () => {
  startPlugins({ baseDir: dir, settings: { aiEdit: { ...SETTINGS.aiEdit, enabled: false } } });
  await send('ai-edit/request', { ...base, id: 'p11', comment: 'anyone there?' });
  await assert.rejects(() => sub.next(500), /timed out/, 'no handler answers');
  startPlugins({ baseDir: dir, settings: SETTINGS }); // restore for any later tests
});
