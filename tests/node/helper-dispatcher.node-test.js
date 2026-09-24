// W2.3: the helper dispatcher, driven end to end through the real W1 wire
// routes on a createApp ctx-form app with a fake `approve` and fake
// `ctx.helpers`. Named requests reach the host dispatcher, unnamed ones still
// reach the external handler in the file's slot, and /_/meta reports the
// document's helpers and their states.
//
// The program the user approves is written into the test's own temp folder (see
// tests/helpers/helper-harness.js), and every child it starts has exited by the
// time a test ends.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const { addProgram, decide } = require('../../src/main/helpers/store');
const {
  documentHTML,
  awaitFrame,
  awaitRequest,
  awaitRequests,
  withHelperApp,
  withHelperRootServer,
} = require('../helpers/helper-harness');

const TEAM = { accountId: 42, teamName: 'acme' };

const request = (id, helper, extra = {}) => ({
  type: 'wire/request',
  id,
  helper,
  document: 'none',
  payload: { query: 'needle' },
  ...extra,
});

// A decision, as an approval would have written it: it is what makes a later
// call run without a prompt.
function allow(settings, docPath, program, accountId = null) {
  const registered = addProgram(settings, 'search', program);
  decide(settings, {
    document: docPath,
    name: 'search',
    program: registered.id,
    allowed: true,
    decidedAt: 1,
    accountId,
  });
  return registered;
}

test('a name the document did not declare is refused before anything runs', async () => {
  await withHelperApp({ html: documentHTML({ helpers: ['search'] }) }, async (h) => {
    const stream = await h.page.subscribe();

    const reply = await h.page.send(request('r1', 'ocr'));

    assert.equal(reply.status, 200);
    const frames = await awaitRequest(stream, 'r1');
    assert.deepEqual(frames.map((frame) => frame.type), ['wire/error']);
    assert.equal(frames[0].from, 'process');
    assert.equal(frames[0].payload.source, 'host');
    assert.equal(frames[0].payload.code, 'helper_not_declared');
    assert.equal(h.approvals.length, 0, 'nobody was asked about an undeclared name');
  });
});

test('an undecided helper is asked once, then runs and reports ack, status and done', async () => {
  await withHelperApp({ html: documentHTML({ helpers: ['search'] }) }, async (h) => {
    const stream = await h.page.subscribe();

    await h.page.send(request('r1', 'search'));
    const frames = await awaitRequest(stream, 'r1');

    assert.deepEqual(frames.map((frame) => frame.type), ['wire/ack', 'wire/status', 'wire/status', 'wire/done']);
    assert.deepEqual(frames[0].payload, { mode: 'jsonl', budgetMs: 300000 });
    assert.equal(frames[1].text, 'Waiting for your approval in Hyperclay Local');
    assert.equal(frames[2].text, 'Scanning');
    assert.deepEqual(frames[2].payload, { progress: { completed: 1, total: 2, unit: 'files' } });

    const done = frames[3].payload;
    assert.equal(done.cwd, h.dir, 'the program runs in the document directory');
    assert.equal(done.envelope.file, h.docPath, 'the envelope names the document absolutely');
    assert.equal(done.envelope.helper, 'search');
    assert.equal(done.envelope.document, 'none');
    assert.equal(done.envelope.helperProtocol, 1);
    assert.deepEqual(done.envelope.payload, { query: 'needle' });

    assert.deepEqual(h.approvals, [{
      document: h.docPath,
      displayName: 'app.html',
      name: 'search',
      program: null,
      teamName: null,
      allowBroad: true,
    }]);
    assert.equal(h.settings.helperPrograms.length, 1);
    assert.equal(h.settings.helperPrograms[0].path, h.program);
    assert.equal(h.settings.helperDecisions[0].allowed, true);
    assert.equal(h.saves, 1, 'the decision was saved');
  });
});

test('two concurrent calls for one name share a single prompt', async () => {
  let release = () => {};
  const held = new Promise((resolve) => { release = resolve; });

  await withHelperApp({
    html: documentHTML({ helpers: ['search'] }),
    approve: async (info, state) => {
      await held;
      return { choice: 'allow', programPath: state.program };
    },
  }, async (h) => {
    const stream = await h.page.subscribe();

    await h.page.send(request('c1', 'search'));
    await awaitFrame(stream, (frame) => frame.id === 'c1' && frame.type === 'wire/status');
    await h.page.send(request('c2', 'search'));
    await awaitFrame(stream, (frame) => frame.id === 'c2' && frame.type === 'wire/status');

    assert.equal(h.approvals.length, 1, 'one dialog for both calls');
    release();

    const done = await awaitRequests(stream, ['c1', 'c2']);
    for (const id of ['c1', 'c2']) {
      assert.equal(done.get(id).at(-1).type, 'wire/done', `${id} ran`);
      assert.equal(done.get(id).at(-1).payload.envelope.helper, 'search');
    }
    assert.equal(h.settings.helperPrograms.length, 1, 'one program, not one per call');
    assert.equal(h.settings.helperDecisions.length, 1);
  });
});

test('an allow is remembered: the next call runs with no prompt and no wait', async () => {
  await withHelperApp({
    html: documentHTML({ helpers: ['search'] }),
    seed: (state) => allow(state.settings, state.docPath, state.program),
  }, async (h) => {
    const stream = await h.page.subscribe();

    await h.page.send(request('r1', 'search'));
    const frames = await awaitRequest(stream, 'r1');

    assert.deepEqual(frames.map((frame) => frame.type), ['wire/ack', 'wire/status', 'wire/done']);
    assert.equal(frames[0].payload.mode, 'jsonl');
    assert.equal(frames[2].payload.envelope.helper, 'search');
    assert.equal(h.approvals.length, 0, 'a decided document is never asked again');
  });
});

test('a deny is remembered, and the next call is refused without a prompt', async () => {
  await withHelperApp({
    html: documentHTML({ helpers: ['search'] }),
    approve: async () => ({ choice: 'deny' }),
  }, async (h) => {
    const stream = await h.page.subscribe();

    await h.page.send(request('d1', 'search'));
    const first = await awaitRequest(stream, 'd1');
    assert.equal(first.at(-1).type, 'wire/error');
    assert.equal(first.at(-1).payload.code, 'helper_not_granted');
    assert.match(first.at(-1).text, /You denied this program/);
    assert.equal(h.settings.helperDecisions.length, 1);
    assert.equal(h.settings.helperDecisions[0].allowed, false);

    await h.page.send(request('d2', 'search'));
    const second = await awaitRequest(stream, 'd2');
    assert.deepEqual(second.map((frame) => frame.type), ['wire/ack', 'wire/error']);
    assert.equal(second[1].payload.code, 'helper_not_granted');
    assert.equal(h.approvals.length, 1, 'the denial stands');
  });
});

test('not-now records nothing and the next call is asked again', async () => {
  const answers = [
    { choice: 'not-now' },
    (info, state) => ({ choice: 'allow', programPath: state.program }),
  ];

  await withHelperApp({
    html: documentHTML({ helpers: ['search'] }),
    approve: async (info, state) => {
      const answer = answers.shift();
      return typeof answer === 'function' ? answer(info, state) : answer;
    },
  }, async (h) => {
    const stream = await h.page.subscribe();

    await h.page.send(request('n1', 'search'));
    const first = await awaitRequest(stream, 'n1');
    assert.equal(first.at(-1).type, 'wire/error');
    assert.equal(first.at(-1).payload.code, 'helper_not_granted');
    assert.equal(h.settings.helperDecisions, undefined, 'nothing was recorded');
    assert.equal(h.settings.helperPrograms, undefined, 'no program was registered');
    assert.equal(h.saves, 0);

    await h.page.send(request('n2', 'search'));
    const second = await awaitRequest(stream, 'n2');
    assert.equal(second.at(-1).type, 'wire/done', 'the second call was asked and allowed');
    assert.equal(h.approvals.length, 2);
  });
});

test('a team document is asked with the team named and is never offered a broad grant', async () => {
  await withHelperApp({
    html: documentHTML({ helpers: ['search'] }),
    account: TEAM,
    kind: 'team',
    seed: (state) => {
      const broad = addProgram(state.settings, 'search', state.program);
      broad.anyDocument = true;
    },
  }, async (h) => {
    const stream = await h.page.subscribe();

    await h.page.send(request('t1', 'search'));
    await awaitFrame(stream, (frame) => frame.id === 't1' && frame.type === 'wire/status');

    assert.equal(h.approvals.length, 1, 'an anyDocument program never covers a team document');
    assert.equal(h.approvals[0].teamName, 'acme');
    assert.equal(h.approvals[0].allowBroad, false);
    assert.equal(h.approvals[0].program.path, h.program);

    const frames = await awaitRequest(stream, 't1');
    assert.equal(frames.at(-1).type, 'wire/done');
    assert.equal(h.settings.helperDecisions[0].accountId, 42, 'the decision belongs to the team');
    assert.equal(h.settings.helperPrograms.length, 1, 'the approved program is the one already registered');
  });
});

test('a second request with the same live id is refused as a duplicate', async () => {
  await withHelperApp({
    html: documentHTML({ helpers: ['search'] }),
    env: { HTMLCLAY_TEST_DELAY_MS: '800' },
    seed: (state) => allow(state.settings, state.docPath, state.program),
  }, async (h) => {
    const stream = await h.page.subscribe();

    await h.page.send(request('q1', 'search'));
    await awaitFrame(stream, (frame) => frame.id === 'q1' && frame.type === 'wire/ack');
    await h.page.send(request('q1', 'search'));

    const refused = await awaitRequest(stream, 'q1');
    assert.equal(refused.at(-1).type, 'wire/error');
    assert.equal(refused.at(-1).payload.code, 'duplicate_request');

    const done = await awaitFrame(stream, (frame) => frame.id === 'q1' && frame.type === 'wire/done');
    assert.equal(done.payload.envelope.helper, 'search', 'the first request still finishes');
  });
});

test('the ninth live request for one document is refused as helper_busy', async () => {
  await withHelperApp({
    html: documentHTML({ helpers: ['search'] }),
    env: { HTMLCLAY_TEST_DELAY_MS: '1500' },
    seed: (state) => allow(state.settings, state.docPath, state.program),
  }, async (h) => {
    const stream = await h.page.subscribe();
    const ids = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8'];

    for (const id of ids) await h.page.send(request(id, 'search'));
    // The ack is published before the run is admitted, so eight acks is eight
    // live requests.
    for (const id of ids) await awaitFrame(stream, (frame) => frame.id === id && frame.type === 'wire/ack');

    await h.page.send(request('b9', 'search'));
    const refused = await awaitRequest(stream, 'b9');

    assert.deepEqual(refused.map((frame) => frame.type), ['wire/error']);
    assert.equal(refused[0].payload.code, 'helper_busy');

    const done = await awaitRequests(stream, ids);
    for (const id of ids) assert.equal(done.get(id).at(-1).type, 'wire/done', `${id} still finished`);
  });
});

test('document: "edit" backs the document up before the program runs', async () => {
  const before = documentHTML({ helpers: ['search'], body: '<p>before</p>' });

  await withHelperApp({
    html: before,
    env: (state) => ({ HTMLCLAY_TEST_REWRITE_DOC: '1', HTMLCLAY_TEST_PID_FILE: path.join(state.dir, 'pid') }),
    seed: (state) => allow(state.settings, state.docPath, state.program),
  }, async (h) => {
    const stream = await h.page.subscribe();

    await h.page.send(request('e1', 'search', { document: 'edit' }));
    const frames = await awaitRequest(stream, 'e1');
    assert.equal(frames.at(-1).type, 'wire/done');

    const backups = await fsp.readdir(path.join(h.dir, '.hyperclay', 'versions', 'app.html'));
    assert.equal(backups.length, 1);
    assert.equal(
      await fsp.readFile(path.join(h.dir, '.hyperclay', 'versions', 'app.html', backups[0]), 'utf8'),
      before,
      'the baseline holds the bytes the program was about to replace',
    );
    assert.equal(await fsp.readFile(h.docPath, 'utf8'), 'rewritten by the program');
  });
});

test('a cancel aborts the run: helper_cancelled, and the child is gone', async () => {
  const pidFile = (state) => path.join(state.dir, 'pid');

  await withHelperApp({
    html: documentHTML({ helpers: ['search'] }),
    env: (state) => ({ HTMLCLAY_TEST_SLEEP: '1', HTMLCLAY_TEST_PID_FILE: pidFile(state) }),
    seed: (state) => allow(state.settings, state.docPath, state.program),
  }, async (h) => {
    const stream = await h.page.subscribe();

    await h.page.send(request('x1', 'search'));
    await awaitFrame(stream, (frame) => frame.id === 'x1' && frame.type === 'wire/status');
    const pid = Number(await fsp.readFile(pidFile(h), 'utf8'));

    const cancelled = await h.page.send({ type: 'wire/cancel', id: 'x1' });
    assert.equal(cancelled.reply.ok, true);

    const frames = await awaitRequest(stream, 'x1');
    assert.equal(frames.at(-1).type, 'wire/error');
    assert.equal(frames.at(-1).payload.code, 'helper_cancelled');
    assert.equal(frames.at(-1).payload.source, 'host');

    const deadline = Date.now() + 5000;
    while (alive(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(alive(pid), false, 'the child is gone');
  });
});

test('stopping a root server ends the helper child its document started', async () => {
  await withHelperRootServer({
    html: documentHTML({ helpers: ['search'] }),
    env: (state) => ({ HTMLCLAY_TEST_SLEEP: '1', HTMLCLAY_TEST_PID_FILE: path.join(state.dir, 'pid') }),
    seed: (state) => allow(state.settings, state.docPath, state.program),
  }, async (h) => {
    const stream = await h.page.subscribe();

    await h.page.send(request('s1', 'search'));
    await awaitFrame(stream, (frame) => frame.id === 's1' && frame.type === 'wire/status');
    const pid = Number(await fsp.readFile(path.join(h.dir, 'pid'), 'utf8'));
    assert.equal(alive(pid), true, 'the child is running while the folder server is');

    await h.pool.stopAll();

    const deadline = Date.now() + 5000;
    while (alive(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(alive(pid), false, 'the child is gone');
  });
});

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

test('an unnamed request still reaches the handler in the slot while the host serves the named one', async () => {
  await withHelperApp({
    html: documentHTML({ helpers: ['search'] }),
    seed: (state) => allow(state.settings, state.docPath, state.program),
  }, async (h) => {
    const handler = await h.page.attachHandler(h.docPath);
    const stream = await h.page.subscribe();

    const reply = await h.page.send({ type: 'wire/request', id: 'u1', document: 'edit', payload: { plain: true } });
    assert.equal(reply.reply.delivered, 1, 'the slot still takes unnamed requests');
    assert.equal((await awaitFrame(handler, (frame) => frame.id === 'u1')).from, 'page');

    const frames = await awaitRequest(stream, 'n1', 1).catch(() => null);
    assert.equal(frames, null, 'nothing was sent yet');
    await h.page.send(request('n1', 'search'));
    const named = await awaitRequest(stream, 'n1');
    assert.equal(named.at(-1).type, 'wire/done');
    assert.equal(named.at(-1).payload.envelope.helper, 'search');

    await awaitFrame(handler, (frame) => frame.id === 'n1' && frame.type === 'wire/done');
    const fromPage = handler.frames.filter((frame) => frame.from === 'page').map((frame) => frame.id);
    assert.deepEqual(fromPage, ['u1'], 'the named request never reached the external handler');
  });
});

test('allow-any covers another personal document without asking again', async () => {
  await withHelperApp({
    html: documentHTML({ helpers: ['search'] }),
    approve: async (info, state) => ({ choice: 'allow-any', programPath: state.program }),
    seed: (state) => {
      fs.writeFileSync(path.join(state.dir, 'other.html'), documentHTML({ helpers: ['search'] }));
    },
  }, async (h) => {
    const stream = await h.page.subscribe();
    await h.page.send(request('p1', 'search'));
    assert.equal((await awaitRequest(stream, 'p1')).at(-1).type, 'wire/done');
    assert.equal(h.settings.helperPrograms[0].anyDocument, true);

    const other = h.page.forDocument(`${h.page.origin}/other.html`);
    const otherStream = await other.subscribe();
    await other.send(request('p2', 'search'));
    assert.equal((await awaitRequest(otherStream, 'p2')).at(-1).type, 'wire/done');
    assert.equal(h.approvals.length, 1, 'the broad grant answered for the second document');
  });
});

test('/_/meta lists the declared helpers with their states, then ai-edit', async () => {
  await withHelperApp({
    html: documentHTML({ helpers: ['search', 'ocr', 'never', 'gone'] }),
    seed: (state) => {
      const search = addProgram(state.settings, 'search', state.program);
      decide(state.settings, { document: state.docPath, name: 'search', program: search.id, allowed: true, decidedAt: 1, accountId: null });

      decide(state.settings, { document: state.docPath, name: 'ocr', allowed: false, decidedAt: 1, accountId: null });

      const gone = addProgram(state.settings, 'gone', path.join(state.dir, 'no-such-program'));
      decide(state.settings, { document: state.docPath, name: 'gone', program: gone.id, allowed: true, decidedAt: 1, accountId: null });
    },
  }, async (h) => {
    const res = await fetch(`${h.page.origin}/_/meta`, { headers: { 'Document-URL': h.docUrl } });
    const body = await res.json();

    assert.equal(body.document.etag.length > 0, true, 'the existing fields are still there');
    assert.deepEqual(body.document.helpers, [
      { name: 'search', state: 'ready' },
      { name: 'ocr', state: 'denied' },
      { name: 'never', state: 'unavailable' },
      { name: 'gone', state: 'unavailable' },
      { name: 'ai-edit', state: 'ready' },
    ]);
  });
});

test('/_/meta reads ai-edit as unavailable when the AI Editing toggle is off', async () => {
  await withHelperApp({
    html: documentHTML({ helpers: [] }),
    aiEdit: { enabled: false },
  }, async (h) => {
    const res = await fetch(`${h.page.origin}/_/meta`, { headers: { 'Document-URL': h.docUrl } });

    assert.deepEqual((await res.json()).document.helpers, [{ name: 'ai-edit', state: 'unavailable' }]);
  });
});
