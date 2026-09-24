// The named-request dispatcher: one per per-folder app, serving a document's
// `helper: "<name>"` requests itself. A port of htmlclay/internal/server/helper.go's
// helperDispatcher, with the one deliberate difference of decision 1 in the W2
// spec: the host answers EVERY named request, so a file's handler slot is never
// taken over by its declarations and an external handler keeps serving the
// unnamed leg (W1). Nothing here reads the handler slot.
//
// Electron is absent by design: the approval dialog, the settings object, the
// document backup and the ai-edit runner all arrive as `helpers`, so a test
// drives the real routes with fakes. Published frames are the four the protocol
// has — wire/ack, wire/status, wire/done, wire/error — and every refusal is one
// wire/error with source "host".

const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');

const { readHelperNames, validHelperName, SCAN_LIMIT } = require('./declarations');
const { resolveHelper, addProgram, decide, setAnyDocument } = require('./store');
const { run } = require('./runner');
const {
  STRUCTURED_DEADLINE_MS,
  DESCRIBE_DEADLINE_MS,
  DESCRIBE_RESULT_LIMIT,
  MAX_WIRE_ENVELOPE,
} = require('./jsonl');
const { envelopeJSON, MAX_WIRE_ID_LEN } = require('../wire-hub');

const MAX_ACTIVE_PER_FILE = 8;
const APPROVAL_WAIT_MS = 120 * 1000;
const PROGRESS_INTERVAL_MS = 250;
const HELPER_DOCUMENT = /\.html?(clay)?$/i;

const WAITING_TEXT = 'Waiting for your approval in Hyperclay Local';
const DENIED_TEXT = 'You denied this program for this document. Change it in Options > Helper Programs.';
const NOT_ALLOWED_TEXT = 'You did not allow this program for this document.';
const AI_EDIT_OFF_TEXT = "AI Editing is off. Turn it on in Hyperclay Local's Options.";

// helperProgramAvailable, helper.go:519-525: a program that is not a regular
// file, or that lost its execute bit, answers no request and reads as
// unavailable rather than as a promise this host cannot keep.
function programAvailable(program) {
  if (!program || typeof program.path !== 'string' || program.path === '') return false;
  try {
    const info = fs.statSync(program.path);
    if (!info.isFile()) return false;
    return process.platform === 'win32' || (info.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function createHelperDispatcher({ baseDir, helpers, backupBaseline, logger = console }) {
  const live = new Map(); // `${file}\n${id}` -> AbortController
  const pendingApprovals = new Map(); // `${file}\n${name}` -> Promise

  const log = (message) => {
    if (logger && typeof logger.error === 'function') logger.error(`[helpers] ${message}`);
  };

  // The routes hand in the key they resolved, relative to the served folder; a
  // decision belongs to the file itself and is recorded under the canonical
  // absolute path, the same one /_/meta resolves through this call.
  async function documentPathFor(file) {
    const abs = path.isAbsolute(file) ? path.normalize(file) : path.join(baseDir, file);
    try {
      return await fsPromises.realpath(abs);
    } catch {
      return abs;
    }
  }

  // readDocumentHelperNames, helpers.go:163-173: the declaration scan reads the
  // first 512 KiB and nothing else, so a large document costs nothing to inspect.
  async function declaredNames(filePath) {
    let handle = null;
    try {
      handle = await fsPromises.open(filePath, 'r');
      const buffer = Buffer.alloc(SCAN_LIMIT);
      const { bytesRead } = await handle.read(buffer, 0, SCAN_LIMIT, 0);
      return readHelperNames(buffer.subarray(0, bytesRead));
    } catch {
      return [];
    } finally {
      if (handle) await handle.close().catch(() => {});
    }
  }

  function accountOf() {
    const account = helpers.rootAccount ? helpers.rootAccount() : null;
    return { accountId: account?.accountId ?? null, teamName: account?.teamName ?? null };
  }

  function aiEditReady() {
    return Boolean(helpers.aiEdit && helpers.aiEdit.enabled());
  }

  function stateOf(settings, document, name, account) {
    const resolved = resolveHelper(settings, { document, name, accountId: account.accountId });
    if (!resolved.decided) return 'unavailable';
    if (!resolved.allowed) return 'denied';
    return programAvailable(resolved.program) ? 'ready' : 'unavailable';
  }

  // helperDiscovery, helper.go:476-517: every declared name with the state the
  // user's decisions give it, and ai-edit after them, because it is a built-in
  // program every document this host serves can call.
  async function describe(file) {
    const filePath = await documentPathFor(file);
    const settings = helpers.settings();
    const account = accountOf();
    const names = await declaredNames(filePath);
    const list = names.map(name => ({ name, state: stateOf(settings, filePath, name, account) }));
    if (HELPER_DOCUMENT.test(filePath)) {
      list.push({ name: 'ai-edit', state: aiEditReady() ? 'ready' : 'unavailable' });
    }
    return list;
  }

  // helperEventEnvelope, helper.go:433-470: the terminal value is the payload of
  // wire/done, a status carries its progress, and an error carries the code the
  // page branches on. The 1 MiB envelope limit is a host error, never a
  // truncated frame.
  function publishFrame(publish, env, frame) {
    const out = {
      v: 1,
      type: frame.type,
      id: env.id,
      from: 'process',
      file: env.file,
      helper: env.helper,
      payload: frame.payload,
    };
    if (frame.text) out.text = frame.text;
    if (Buffer.byteLength(envelopeJSON(out), 'utf8') > MAX_WIRE_ENVELOPE) {
      out.type = 'wire/error';
      out.text = 'helper result does not fit in a wire envelope';
      out.payload = { source: 'host', code: 'helper_result_too_large' };
    }
    publish(out);
  }

  function refuse(publish, env, code, text) {
    publishFrame(publish, env, { type: 'wire/error', text, payload: { source: 'host', code } });
  }

  function frameOf(event) {
    if (event.kind === 'status') {
      const payload = event.progress ? { progress: JSON.parse(event.progress) } : undefined;
      return { type: 'wire/status', text: event.text, payload };
    }
    if (event.kind === 'result') {
      return { type: 'wire/done', payload: JSON.parse(event.value) };
    }
    const payload = { source: event.source || 'host', code: event.code };
    if (event.details !== undefined && event.details !== null) payload.details = JSON.parse(event.details);
    return { type: 'wire/error', text: event.text, payload };
  }

  // Decision 5: a status record is replaceable progress, so a growing answer is
  // counted and published at most four times a second rather than streamed.
  function createProgress(publish, env) {
    let completed = 0;
    let published = 0;
    return (text) => {
      completed += Buffer.byteLength(String(text), 'utf8');
      const now = Date.now();
      if (published && now - published < PROGRESS_INTERVAL_MS) return;
      published = now;
      publishFrame(publish, env, {
        type: 'wire/status',
        text: `Writing, ${(completed / 1024).toFixed(1)} KB`,
        payload: { progress: { completed, unit: 'bytes' } },
      });
    };
  }

  // Decision 2: concurrent calls for the same document and name share one
  // dialog. The entry is dropped inside the promise's own finally, before any
  // awaiter resumes, so a call that arrives after a "not now" is asked again
  // rather than handed the answer nobody wanted.
  function sharedApproval(key, make) {
    const existing = pendingApprovals.get(key);
    if (existing) return existing;
    const promise = (async () => {
      try {
        return await make();
      } finally {
        pendingApprovals.delete(key);
      }
    })();
    pendingApprovals.set(key, promise);
    return promise;
  }

  async function askForApproval(filePath, name, program, account) {
    const allowBroad = account.accountId === null;
    let timer = null;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ choice: 'not-now' }), APPROVAL_WAIT_MS);
    });
    try {
      const answer = helpers.approve({
        document: filePath,
        displayName: path.basename(filePath),
        name,
        program,
        teamName: account.teamName,
        allowBroad,
      });
      const settled = Promise.resolve(answer).then((choice) => (
        choice && typeof choice.choice === 'string' ? choice : { choice: 'not-now' }
      ));
      return await Promise.race([settled, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  // Step 7: an allow registers the picked program, records the decision under
  // the account the document belongs to, and hands back the program to run. A
  // team document is never handed the broad grant: allowBroad is false there, so
  // the dialog offers no "Any Document" button, and the decision is per file.
  async function grant(filePath, name, resolved, account, answer) {
    const settings = helpers.settings();
    if (answer.choice === 'deny') {
      decide(settings, {
        document: filePath,
        name,
        allowed: false,
        decidedAt: Date.now(),
        accountId: account.accountId,
      });
      helpers.saveSettings();
      return { refused: DENIED_TEXT };
    }
    if (answer.choice !== 'allow' && answer.choice !== 'allow-any') {
      return { refused: NOT_ALLOWED_TEXT };
    }
    let program = resolved.program;
    if (!program) {
      const picked = typeof answer.programPath === 'string' ? answer.programPath : '';
      if (!programAvailable({ path: picked })) {
        return { refused: 'the chosen program is not a file this host can run.' };
      }
      program = addProgram(settings, name, picked);
      if (!program) return { refused: 'no more programs can be registered.' };
    }
    if (answer.choice === 'allow-any') setAnyDocument(settings, program.id, true);
    decide(settings, {
      document: filePath,
      name,
      program: program.id,
      allowed: true,
      decidedAt: Date.now(),
      accountId: account.accountId,
    });
    helpers.saveSettings();
    return { program };
  }

  async function onNamedRequest(env, { file, publish, onCancel }) {
    if (typeof env.id !== 'string' || env.id === '' || Buffer.byteLength(env.id, 'utf8') > MAX_WIRE_ID_LEN) return;
    if (typeof env.helper !== 'string' || env.helper === '') {
      refuse(publish, env, 'helper_name_required', 'a helper name is required');
      return;
    }
    if (!validHelperName(env.helper)) {
      refuse(publish, env, 'invalid_helper', 'the helper name is invalid');
      return;
    }
    const document = typeof env.document === 'string' && env.document !== '' ? env.document : 'none';
    if (document !== 'none' && document !== 'edit') {
      refuse(publish, env, 'invalid_document', 'document must be "edit" or "none"');
      return;
    }
    if (env.type !== 'wire/request' && env.type !== 'wire/describe') {
      refuse(publish, env, 'invalid_type', 'the request type is not a helper request');
      return;
    }

    const budgetMs = env.type === 'wire/describe' ? DESCRIBE_DEADLINE_MS : STRUCTURED_DEADLINE_MS;
    const resultLimit = env.type === 'wire/describe' ? DESCRIBE_RESULT_LIMIT : undefined;
    const budgetAt = Date.now() + budgetMs;
    const name = env.helper;
    const filePath = await documentPathFor(file);
    const liveKey = `${filePath}\n${env.id}`;

    // ai-edit is built in: no declaration, no approval, and on every document
    // this host serves. Only the Options toggle gates it.
    if (name === 'ai-edit') {
      if (!aiEditReady()) {
        refuse(publish, env, 'helper_not_granted', AI_EDIT_OFF_TEXT);
        return;
      }
      publishFrame(publish, env, { type: 'wire/ack', payload: { mode: 'jsonl', budgetMs } });
      const controller = new AbortController();
      live.set(liveKey, controller);
      onCancel(env.id, () => controller.abort());
      const budget = setTimeout(() => controller.abort(), budgetMs);
      try {
        const result = await helpers.aiEdit.run(env.payload, {
          file: filePath,
          baseDir,
          settings: helpers.settings(),
          signal: controller.signal,
          progress: createProgress(publish, env),
        });
        publishFrame(publish, env, {
          type: 'wire/done',
          payload: { html: result.html, model: result.model, stopReason: result.stopReason },
        });
      } catch (err) {
        if (controller.signal.aborted) {
          refuse(publish, env, 'helper_cancelled', 'helper cancelled');
        } else {
          const code = typeof err?.code === 'string' && err.code ? err.code : 'helper_failed';
          publishFrame(publish, env, {
            type: 'wire/error',
            text: String(err?.message || err),
            payload: { source: 'application', code },
          });
        }
      } finally {
        clearTimeout(budget);
        live.delete(liveKey);
      }
      return;
    }

    const declared = await declaredNames(filePath);
    if (!declared.includes(name)) {
      refuse(publish, env, 'helper_not_declared', 'this document did not declare that helper');
      return;
    }
    if (live.has(liveKey)) {
      refuse(publish, env, 'duplicate_request', 'a request with this id is already running');
      return;
    }
    if ([...live.keys()].filter(key => key.startsWith(`${filePath}\n`)).length >= MAX_ACTIVE_PER_FILE) {
      refuse(publish, env, 'helper_busy', `this handler is already running ${MAX_ACTIVE_PER_FILE} requests`);
      return;
    }

    // The ack starts the budget, and the budget covers the approval wait.
    publishFrame(publish, env, {
      type: 'wire/ack',
      payload: { mode: 'jsonl', budgetMs },
    });

    // Registered before the approval wait: a root that closes, or a page that cancels, while
    // the dialog is open must reach this request too.
    const controller = new AbortController();
    live.set(liveKey, controller);
    onCancel(env.id, () => controller.abort());
    try {
      const account = accountOf();
      const resolved = resolveHelper(helpers.settings(), {
        document: filePath,
        name,
        accountId: account.accountId,
      });
      if (resolved.decided && !resolved.allowed) {
        refuse(publish, env, 'helper_not_granted', DENIED_TEXT);
        return;
      }

      let program = resolved.program;
      if (!resolved.decided) {
        publishFrame(publish, env, { type: 'wire/status', text: WAITING_TEXT });
        const answer = await sharedApproval(
          `${filePath}\n${name}`,
          () => askForApproval(filePath, name, resolved.program, account),
        );
        // Another call for the same document and name may have recorded the
        // answer while this one was still waiting on the shared dialog. The
        // recorded decision wins: without this, two concurrent allows register
        // the same program twice.
        const settled = resolveHelper(helpers.settings(), {
          document: filePath,
          name,
          accountId: account.accountId,
        });
        if (settled.decided && !settled.allowed) {
          refuse(publish, env, 'helper_not_granted', DENIED_TEXT);
          return;
        }
        if (settled.decided) {
          program = settled.program;
        } else {
          const granted = await grant(filePath, name, resolved, account, answer);
          if (granted.refused) {
            refuse(publish, env, 'helper_not_granted', granted.refused);
            return;
          }
          program = granted.program;
        }
      }

      if (controller.signal.aborted) {
        refuse(publish, env, 'helper_cancelled', 'helper cancelled');
        return;
      }

      if (document === 'edit') {
        try {
          await backupBaseline(file);
        } catch (err) {
          log(`could not prepare document history for ${filePath}: ${err.message}`);
          refuse(publish, env, 'helper_start_failed', `could not prepare document history: ${err.message}`);
          return;
        }
      }

      // The budget covers the approval wait, so a request whose budget ran out
      // while someone was deciding must not start at all.
      const remaining = budgetAt - Date.now();
      if (remaining <= 0) {
        refuse(publish, env, 'helper_timeout', 'helper timed out');
        return;
      }

      const stdio = {
        v: env.v,
        type: env.type,
        id: env.id,
        file: filePath,
        helper: name,
        document,
        text: env.text || undefined,
        payload: env.payload,
      };
      await run({
        argv: [program.path],
        cwd: path.dirname(filePath),
        stdin: stdio,
        file: filePath,
        id: env.id,
        document,
        deadlineMs: remaining,
        resultLimit,
        signal: controller.signal,
      }, (event) => publishFrame(publish, env, frameOf(event)));
    } finally {
      live.delete(liveKey);
    }
  }

  // DetachHelpers, helper.go:139-160: a root that closes takes every accepted
  // request with it, which the runner turns into helper_cancelled.
  function stopAll() {
    const controllers = [...live.values()];
    live.clear();
    for (const controller of controllers) controller.abort();
  }

  return { onNamedRequest, describe, stopAll };
}

module.exports = { createHelperDispatcher };
