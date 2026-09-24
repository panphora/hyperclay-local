// W2.3: ai-edit as the built-in helper, driven end to end through the real W1
// wire routes with `helper: "ai-edit"` (replaces the old bus suite). Same
// routing, root-jail, generic-adapter, missing-binary and toggle cases as
// before, plus the two the wire adds: MOCK_MODEL=1 reports throttled byte
// progress as wire/status frames, and `page: true` reads the document from disk
// instead of a payload copy.
//
// The engines are the real module's, so this is also what proves the model ids
// the helper ships with.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { runAiEdit } = require('../../src/main/helpers/ai-edit');
const { documentHTML, awaitRequest, withHelperApp } = require('../helpers/helper-harness');

const FIXTURES = path.join(__dirname, '..', 'fixtures');
const NODE = process.execPath;

const engines = () => ({
  echo: [NODE, path.join(FIXTURES, 'echo-agent.js')],
  argbot: [NODE, path.join(FIXTURES, 'arg-agent.js'), '{prompt}'],
  broken: [NODE, path.join(FIXTURES, 'fail-agent.js')],
  prompt: [NODE, path.join(FIXTURES, 'prompt-agent.js')],
  ghost: ['definitely-not-a-real-binary-xyz'],
});

const elementHTML = '<section data-edit-id="hero">\n  <h1>Old title</h1>\n</section>';
const BASE = { editId: 'hero', tag: 'section', elementHTML, contextRefs: [] };

// A clay.wire-shaped request: named, structured, and `document: "none"` so the
// page stays the only writer (decision 4).
const request = (id, comment, extra = {}) => ({
  type: 'wire/request',
  id,
  helper: 'ai-edit',
  document: 'none',
  payload: { ...BASE, comment, ...extra },
});

// The real helper, wired the way main.js wires it: the module's own run, with
// the dispatcher's context passed straight through.
function aiEdit(enabled) {
  return { enabled, run: (payload, ctx) => runAiEdit(payload, ctx) };
}

function settings(extra = {}) {
  return { aiEdit: { enabled: true, engines: engines(), ...extra } };
}

const MOCK = { MOCK_MODEL: '1' };

test('@fable routes to Fable 5.1 through the built-in helper', async () => {
  await withHelperApp({ html: documentHTML(), settings: settings(), env: MOCK, aiEdit: aiEdit(true) }, async (h) => {
    const stream = await h.page.subscribe();

    const reply = await h.page.send(request('p1', '@fable make this poetic'));

    assert.equal(reply.status, 200);
    const frames = await awaitRequest(stream, 'p1');
    assert.equal(frames[0].type, 'wire/ack');
    assert.deepEqual(frames[0].payload, { mode: 'jsonl', budgetMs: 300000 });
    const done = frames.at(-1);
    assert.equal(done.type, 'wire/done');
    assert.equal(done.payload.model, 'mock(claude-fable-5-1)');
    assert.match(done.payload.html, /mock edit: make this poetic/, '@fable is stripped from the prompt');
    assert.equal(done.payload.stopReason, 'end_turn');
    assert.deepEqual(Object.keys(done.payload).sort(), ['html', 'model', 'stopReason']);
  });
});

test('an untagged comment uses the default engine, and MOCK_MODEL reports byte progress', async () => {
  await withHelperApp({ html: documentHTML(), settings: settings(), env: MOCK, aiEdit: aiEdit(true) }, async (h) => {
    const stream = await h.page.subscribe();

    await h.page.send(request('p2', 'make the title friendlier'));
    const frames = await awaitRequest(stream, 'p2');

    const statuses = frames.filter((frame) => frame.type === 'wire/status');
    assert.ok(statuses.length >= 1, 'a growing answer reports progress');
    for (const status of statuses) {
      assert.match(status.text, /^Writing, \d+\.\d KB$/);
      assert.equal(status.payload.progress.unit, 'bytes');
      assert.ok(status.payload.progress.completed > 0);
    }
    const done = frames.at(-1);
    assert.equal(done.type, 'wire/done');
    assert.equal(frames.filter((frame) => frame.type === 'wire/done').length, 1, 'one terminal frame');
    assert.equal(done.payload.model, 'mock(claude-opus-5-5)');
  });
});

test('an unknown leading @agent is an error that lists the known engines', async () => {
  await withHelperApp({ html: documentHTML(), settings: settings(), env: MOCK, aiEdit: aiEdit(true) }, async (h) => {
    const stream = await h.page.subscribe();

    await h.page.send(request('p3', '@nope tighten this'));
    const frames = await awaitRequest(stream, 'p3');

    const error = frames.at(-1);
    assert.equal(error.type, 'wire/error');
    assert.equal(error.payload.source, 'application');
    assert.equal(error.payload.code, 'unknown_engine');
    assert.match(error.text, /unknown agent @nope/);
    assert.match(error.text, /@codex/, 'built-ins are listed');
    assert.match(error.text, /@echo/, 'user-defined engines are listed');
  });
});

test('a leading @page is a context token, and page: true reads the file from disk', async () => {
  const html = documentHTML({ helpers: [], body: '<main>the saved page</main>' });

  await withHelperApp({ html, settings: settings({ default: 'prompt' }), aiEdit: aiEdit(true) }, async (h) => {
    const stream = await h.page.subscribe();

    await h.page.send(request('p4', '@page tighten this', { page: true }));
    const done = (await awaitRequest(stream, 'p4')).at(-1);

    assert.equal(done.type, 'wire/done');
    assert.ok(
      done.payload.html.includes(`prompt:none:${Buffer.byteLength(html, 'utf8')}`),
      `the prompt carried the whole document (${done.payload.html})`,
    );
  });
});

test('a context ref inside the served folder resolves from disk', async () => {
  await withHelperApp({
    html: documentHTML(),
    settings: settings({ default: 'prompt' }),
    aiEdit: aiEdit(true),
    seed: (state) => fs.writeFileSync(path.join(state.dir, 'notes.txt'), 'served-folder context'),
  }, async (h) => {
    const stream = await h.page.subscribe();

    await h.page.send(request('p5', 'see @notes.txt', { contextRefs: ['notes.txt'] }));
    const done = (await awaitRequest(stream, 'p5')).at(-1);

    assert.equal(done.type, 'wire/done');
    assert.ok(done.payload.html.includes('prompt:notes.txt:0'), `the context file reached the prompt (${done.payload.html})`);
  });
});

test('an escaping context ref is refused', async () => {
  await withHelperApp({ html: documentHTML(), settings: settings(), env: MOCK, aiEdit: aiEdit(true) }, async (h) => {
    const stream = await h.page.subscribe();

    await h.page.send(request('p6', 'use @../x', { contextRefs: ['../x'] }));
    const error = (await awaitRequest(stream, 'p6')).at(-1);

    assert.equal(error.type, 'wire/error');
    assert.equal(error.payload.code, 'invalid_context');
    assert.match(error.text, /escapes the served folder/);
  });
});

test('generic engine: the prompt reaches stdin and the reply is the result', async () => {
  await withHelperApp({ html: documentHTML(), settings: settings(), aiEdit: aiEdit(true) }, async (h) => {
    const stream = await h.page.subscribe();

    await h.page.send(request('p7', '@echo do the thing'));
    const frames = await awaitRequest(stream, 'p7');
    const done = frames.at(-1);

    assert.equal(done.type, 'wire/done');
    assert.match(done.payload.html, /echo saw-prompt/);
    assert.equal(done.payload.model, 'echo');
    assert.ok(frames.some((frame) => frame.type === 'wire/status'), 'streamed output becomes progress');
  });
});

test('generic engine: {prompt} substitutes at argv level', async () => {
  await withHelperApp({ html: documentHTML(), settings: settings(), aiEdit: aiEdit(true) }, async (h) => {
    const stream = await h.page.subscribe();

    await h.page.send(request('p8', '@argbot do the thing'));
    const done = (await awaitRequest(stream, 'p8')).at(-1);

    assert.equal(done.type, 'wire/done');
    assert.match(done.payload.html, /arg:ok/);
  });
});

test('a failing engine surfaces the exit code and its stderr', async () => {
  await withHelperApp({ html: documentHTML(), settings: settings(), aiEdit: aiEdit(true) }, async (h) => {
    const stream = await h.page.subscribe();

    await h.page.send(request('p9', '@broken do the thing'));
    const error = (await awaitRequest(stream, 'p9')).at(-1);

    assert.equal(error.type, 'wire/error');
    assert.equal(error.payload.code, 'engine_failed');
    assert.match(error.text, /exited \(3\)/);
    assert.match(error.text, /boom/);
  });
});

test('a missing binary is a friendly error, not a crash', async () => {
  await withHelperApp({ html: documentHTML(), settings: settings(), aiEdit: aiEdit(true) }, async (h) => {
    const stream = await h.page.subscribe();

    await h.page.send(request('p10', '@ghost do the thing'));
    const error = (await awaitRequest(stream, 'p10')).at(-1);

    assert.equal(error.type, 'wire/error');
    assert.equal(error.payload.code, 'engine_unavailable');
    assert.match(error.text, /@ghost isn't available/);
  });
});

test('an empty request is refused before any engine is chosen', async () => {
  await withHelperApp({ html: documentHTML(), settings: settings(), env: MOCK, aiEdit: aiEdit(true) }, async (h) => {
    const stream = await h.page.subscribe();

    await h.page.send({ type: 'wire/request', id: 'p11', helper: 'ai-edit', document: 'none', payload: { comment: '' } });
    const error = (await awaitRequest(stream, 'p11')).at(-1);

    assert.equal(error.type, 'wire/error');
    assert.equal(error.payload.code, 'invalid_request');
    assert.equal(error.text, 'malformed ai-edit request');
  });
});

test('with the toggle off ai-edit is refused and nobody is asked', async () => {
  await withHelperApp({
    html: documentHTML(),
    settings: settings(),
    env: MOCK,
    aiEdit: aiEdit(false),
  }, async (h) => {
    const stream = await h.page.subscribe();

    await h.page.send(request('p12', 'anyone there?'));
    const frames = await awaitRequest(stream, 'p12');

    assert.deepEqual(frames.map((frame) => frame.type), ['wire/error']);
    assert.equal(frames[0].payload.source, 'host');
    assert.equal(frames[0].payload.code, 'helper_not_granted');
    assert.equal(frames[0].text, "AI Editing is off. Turn it on in Hyperclay Local's Options.");
    assert.equal(h.approvals.length, 0, 'a built-in helper needs no approval');
  });
});
