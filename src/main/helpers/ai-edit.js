/**
 * ai-edit helper — the built-in handler for comment-to-edit AI editing.
 *
 * Served as the named helper `ai-edit` by the helper dispatcher (see
 * ./dispatcher.js): no declaration and no approval, because it is a program
 * this app ships rather than one the user picked for a document. It is a
 * STRUCTURED helper whose result is the edited element's HTML, and it always
 * runs with `document: "none"`, so the page stays the only writer: the page
 * morphs the result in and Keep saves through clay.save().
 *
 * Engines: a leading bare @word in the comment picks the agent — @claude
 * (Opus 5.5, the default), @fable (Fable 5.1), @codex, @agy, plus any engine
 * the user defines in settings.aiEdit.engines. Tokens with a dot or slash
 * are context refs (root-jailed to the served folder), @page is a context
 * token, and mid-comment bare @words are prose. An unknown leading @word is
 * an error, never a silent default.
 *
 * Adapters:
 * - claude: headless Claude Code (`claude -p`), no tools, one turn,
 *   stream-json output, real stop-reason fidelity. No API key — rides the
 *   machine's Claude Code login.
 * - codex: `codex exec` in a read-only sandbox, ephemeral, config-isolated;
 *   final-only via --output-last-message (no streaming).
 * - agy: PTY-wrapped (`script`) because agy silently drops stdout in
 *   non-TTY runs; the prompt and the reply both travel through files in a
 *   scratch dir that doubles as the sandbox cwd. Final-only.
 * - generic (user-defined engines): prompt on stdin (or an argv-level
 *   {prompt} placeholder — never through a shell), stdout as progress,
 *   exit 0 = success. A shell script can be an agent.
 *
 * The agent command comes ONLY from settings. Payloads never name a
 * command, a model flag, or a path outside contextRefs, and every adapter
 * spawns with the login shell's PATH (decision 7).
 *
 * Progress is throttled: the adapters hand raw output to `ctx.progress`,
 * which counts bytes and publishes at most one wire/status every 250 ms.
 * The streaming preview the bus version had is gone (decision 5).
 *
 * MOCK_MODEL=1 produces a deterministic local edit instead of spawning
 * anything (for tests); "[mock:<stop>]" in the comment fakes a stop reason.
 */
const { spawn } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { loginPath, withPath } = require('./runner');

const BUILTIN_ENGINES = {
  claude: { adapter: 'claude', model: 'claude-opus-5-5' },
  fable: { adapter: 'claude', model: 'claude-fable-5-1' },
  codex: { adapter: 'codex' },
  agy: { adapter: 'agy' }
};

const SYSTEM = `You edit one HTML element on a static page.
Reply with exactly one complete element: the revised version of the element you are given, keeping its tag and its data-edit-id attribute.
Output raw HTML only — no markdown fences, no commentary before or after. Your reply is morphed into the live page verbatim.
The page's stylesheet is external to the element; stay consistent with the class and structure conventions visible in the element you are given.
Do not add <script> tags or inline event handlers unless the request explicitly asks for them.`;

const isMock = () => process.env.MOCK_MODEL === '1';
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

function coded(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function stripFences(text) {
  return text.trim().replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '').trim();
}

// ---------------------------------------------------------------- engines

function resolveEngines(aiEditSettings = {}) {
  const engines = {};
  for (const [name, config] of Object.entries(BUILTIN_ENGINES)) {
    engines[name] = { name, ...config };
  }
  for (const [name, command] of Object.entries(aiEditSettings.engines || {})) {
    const key = String(name).toLowerCase();
    if (!/^[a-z0-9_-]{1,32}$/.test(key)) continue; // must work as an @token
    engines[key] = { name: key, adapter: 'generic', command };
  }
  return engines;
}

// A leading bare @word (no dot, no slash) names an engine. @page is a context
// token, never an engine.
function routeEngine(comment, engines, defaultEngine) {
  const match = comment.match(/^\s*@([a-z0-9_-]+)(?![./])\s*/i);
  if (!match) return { engine: engines[defaultEngine], comment };
  const name = match[1].toLowerCase();
  if (name === 'page') return { engine: engines[defaultEngine], comment };
  if (!engines[name]) {
    throw new Error(`unknown agent @${name} — this server knows ${Object.keys(engines).map(e => '@' + e).join(' ')}`);
  }
  return { engine: engines[name], comment: comment.slice(match[0].length).trim() };
}

// ---------------------------------------------------------------- context (@ tokens)

async function resolveContext(refs = [], baseDir) {
  const sections = [];
  for (const ref of refs) {
    if (ref === 'page') continue; // handled by the page: true flag, read from disk
    const resolved = path.resolve(baseDir, ref);
    if (resolved !== baseDir && !resolved.startsWith(baseDir + path.sep)) {
      throw coded('invalid_context', `@${ref} escapes the served folder`);
    }
    const content = await fs.readFile(resolved, 'utf8').catch(() => {
      throw coded('invalid_context', `cannot read @${ref}`);
    });
    sections.push(`Context file @${ref}:\n\n${content}`);
  }
  return sections;
}

function buildUserPrompt(payload, comment, contextSections, pageText) {
  const parts = [`The element to edit:\n\n${payload.elementHTML}`];
  if (payload.quote) parts.push(`The user selected this text inside the element: "${payload.quote}"`);
  parts.push(...contextSections);
  if (pageText) parts.push(`The full page, for context (@page):\n\n${pageText}`);
  parts.push(`Request: ${comment}`);
  return parts.join('\n\n');
}

// ---------------------------------------------------------------- adapters

function claudeAdapter(engine, userPrompt, ctx) {
  return new Promise((resolve, reject) => {
    // No --bare: it skips the credential store, which breaks keyless
    // subscription auth (verified 2026-07-02) — the whole point here.
    const child = spawn('claude', [
      '-p',
      '--model', engine.model,
      '--append-system-prompt', SYSTEM,
      '--tools', '',
      '--max-turns', '1',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--verbose'
    ], { cwd: ctx.baseDir, env: ctx.env, stdio: ['pipe', 'pipe', 'pipe'], signal: ctx.signal });
    child.stdin.end(userPrompt);

    let result = null;
    let modelSeen = engine.model;
    let stderrTail = '';
    let buf = '';
    child.stdout.on('data', chunk => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (event.type === 'stream_event' && event.event?.delta?.type === 'text_delta') {
          ctx.progress(event.event.delta.text);
        } else if (event.type === 'system' && event.subtype === 'init') {
          modelSeen = event.model;
        } else if (event.type === 'result') {
          result = event;
        }
      }
    });
    child.stderr.on('data', chunk => { stderrTail = (stderrTail + chunk).slice(-400); });
    child.on('error', reject);
    child.on('close', code => {
      if (ctx.signal.aborted) {
        reject(abortError());
      } else if (!result) {
        reject(new Error(`claude exited (${code}) without a result${stderrTail ? ': ' + stderrTail.trim() : ''}`));
      } else if (result.is_error) {
        reject(new Error(String(result.result || result.subtype)));
      } else {
        resolve({
          html: stripFences(result.result || ''),
          stopReason: result.stop_reason || (result.subtype === 'success' ? 'end_turn' : result.subtype),
          model: modelSeen
        });
      }
    });
  });
}

async function codexAdapter(engine, userPrompt, ctx) {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-edit-codex-'));
  const outFile = path.join(scratch, 'last-message.txt');
  try {
    await new Promise((resolve, reject) => {
      const child = spawn('codex', [
        'exec',
        '--ephemeral', '--ignore-user-config', '--ignore-rules',
        '--sandbox', 'read-only',
        '-C', ctx.baseDir,
        '-o', outFile,
        SYSTEM + '\n\n' + userPrompt
      ], { env: ctx.env, stdio: ['ignore', 'ignore', 'pipe'], signal: ctx.signal });
      let stderrTail = '';
      child.stderr.on('data', chunk => { stderrTail = (stderrTail + chunk).slice(-400); });
      child.on('error', reject);
      child.on('close', code => {
        if (ctx.signal.aborted) reject(abortError());
        else if (code !== 0) reject(new Error(`codex exited (${code})${stderrTail ? ': ' + stderrTail.trim() : ''}`));
        else resolve();
      });
    });
    const text = await fs.readFile(outFile, 'utf8').catch(() => '');
    if (!text.trim()) throw new Error('codex produced no reply');
    return { html: stripFences(text), stopReason: 'end_turn', model: 'codex' };
  } finally {
    fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
  }
}

async function agyAdapter(engine, userPrompt, ctx) {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-edit-agy-'));
  const promptFile = path.join(scratch, 'prompt.md');
  const replyFile = path.join(scratch, 'reply.html');
  try {
    await fs.writeFile(promptFile, SYSTEM + '\n\n' + userPrompt +
      `\n\nWrite your complete reply (the raw HTML only, nothing else) to the file ${replyFile} — create it. Do not print the reply anywhere else.`);
    // The prompt travels through a file so no user content enters argv or a
    // shell string; the scratch dir is also the cwd, keeping agy's sandbox
    // writes confined to it.
    const instruction = `Read the file ${promptFile} and follow the instructions in it exactly.`;
    const argv = process.platform === 'linux'
      ? ['script', '-qec', `agy -p ${JSON.stringify(instruction)} --sandbox --dangerously-skip-permissions`, '/dev/null']
      : ['script', '-q', '/dev/null', 'agy', '-p', instruction, '--sandbox', '--dangerously-skip-permissions'];
    await new Promise((resolve, reject) => {
      const child = spawn(argv[0], argv.slice(1), { cwd: scratch, env: ctx.env, stdio: ['ignore', 'ignore', 'pipe'], signal: ctx.signal });
      let stderrTail = '';
      child.stderr.on('data', chunk => { stderrTail = (stderrTail + chunk).slice(-400); });
      child.on('error', reject);
      child.on('close', code => {
        if (ctx.signal.aborted) reject(abortError());
        else if (code !== 0) reject(new Error(`agy exited (${code})${stderrTail ? ': ' + stderrTail.trim() : ''}`));
        else resolve();
      });
    });
    const text = await fs.readFile(replyFile, 'utf8').catch(() => '');
    if (!text.trim()) throw new Error('agy produced no reply (its stdout is unreliable headless; the reply file stayed empty)');
    return { html: stripFences(text), stopReason: 'end_turn', model: 'agy' };
  } finally {
    fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
  }
}

function genericAdapter(engine, userPrompt, ctx) {
  const prompt = SYSTEM + '\n\n' + userPrompt;
  const argv = Array.isArray(engine.command)
    ? engine.command.map(String)
    : String(engine.command).split(/\s+/).filter(Boolean);
  if (!argv.length) return Promise.reject(new Error(`engine @${engine.name} has an empty command`));
  let viaStdin = true;
  const substituted = argv.map(arg => {
    if (!arg.includes('{prompt}')) return arg;
    viaStdin = false;
    return arg.replaceAll('{prompt}', prompt); // argv-level: never through a shell
  });
  return new Promise((resolve, reject) => {
    const child = spawn(substituted[0], substituted.slice(1), {
      cwd: ctx.baseDir, env: ctx.env, stdio: ['pipe', 'pipe', 'pipe'], signal: ctx.signal
    });
    child.stdin.on('error', () => {}); // agent may exit without reading stdin
    child.stdin.end(viaStdin ? prompt : '');
    let out = '';
    let stderrTail = '';
    child.stdout.on('data', chunk => {
      out += chunk;
      ctx.progress(String(chunk));
    });
    child.stderr.on('data', chunk => { stderrTail = (stderrTail + chunk).slice(-400); });
    child.on('error', reject);
    child.on('close', code => {
      if (ctx.signal.aborted) reject(abortError());
      else if (code !== 0) reject(new Error(`@${engine.name} (${argv[0]}) exited (${code})${stderrTail ? ': ' + stderrTail.trim() : ''}`));
      else if (!out.trim()) reject(new Error(`@${engine.name} produced no reply`));
      else resolve({ html: stripFences(out), stopReason: 'end_turn', model: engine.name });
    });
  });
}

const ADAPTERS = { claude: claudeAdapter, codex: codexAdapter, agy: agyAdapter, generic: genericAdapter };

async function mockStream(payload, comment, label, progress, signal) {
  const stop = comment.match(/\[mock:(\w+)\]/);
  const note = comment.replace(/\[mock:\w+\]/g, '').trim()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const closing = new RegExp(`</${payload.tag}>\\s*$`, 'i');
  const html = payload.elementHTML.replace(closing, `  <p class="mock-edit">mock edit: ${note}</p>\n</${payload.tag}>`);
  for (let i = 0; i < html.length; i += 48) {
    if (signal.aborted) throw abortError();
    progress(html.slice(i, i + 48));
    await sleep(30);
  }
  return { html, stopReason: stop ? stop[1] : 'end_turn', model: `mock(${label})` };
}

// ---------------------------------------------------------------- the helper

const log = (...args) => console.log('[ai-edit]', ...args);

// runAiEdit, the dispatcher's built-in branch: the payload is a clay.wire
// payload, the answer is { html, model, stopReason }, and every refusal the page
// renders is a thrown Error whose `code` the dispatcher reports as the wire
// error's application code.
async function runAiEdit(payload, { file, baseDir, settings, signal, progress }) {
  const aiEdit = (settings && settings.aiEdit) || {};
  const engines = resolveEngines(aiEdit);
  const defaultEngine = String(aiEdit.default || 'claude').toLowerCase();
  const report = typeof progress === 'function' ? progress : () => {};
  const abortSignal = signal || new AbortController().signal;

  if (!payload || !payload.elementHTML || !payload.comment) throw coded('invalid_request', 'malformed ai-edit request');
  if (!engines[defaultEngine]) throw coded('unknown_engine', `default engine "${defaultEngine}" is not configured`);

  let routed;
  try {
    routed = routeEngine(payload.comment, engines, defaultEngine);
  } catch (err) {
    throw coded('unknown_engine', err.message);
  }
  const { engine, comment: cleanComment } = routed;
  const label = engine.model || engine.name;
  log(`[${payload.editId}] ${isMock() ? 'mock' : label}` +
    (payload.contextRefs?.length ? ` context: ${payload.contextRefs.join(', ')}` : '') +
    (payload.page ? ' +page' : ''));

  // Decision 6: @page reads the saved file from disk rather than a copy in the
  // payload, which an envelope limit would otherwise refuse.
  let pageText = '';
  if (payload.page) {
    try {
      pageText = await fs.readFile(file, 'utf8');
    } catch (err) {
      throw coded('invalid_request', `cannot read the document at ${file}: ${err.message}`);
    }
  }

  let contextSections;
  try {
    contextSections = await resolveContext(payload.contextRefs, baseDir);
  } catch (err) {
    throw coded('invalid_context', err.message);
  }
  const userPrompt = buildUserPrompt(payload, cleanComment, contextSections, pageText);
  const ctx = { baseDir, env: withPath(process.env, await loginPath()), progress: report, signal: abortSignal };

  let result;
  try {
    result = isMock()
      ? await mockStream(payload, cleanComment, label, report, abortSignal)
      : await ADAPTERS[engine.adapter](engine, userPrompt, ctx);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    if (err.code === 'ENOENT') {
      const binary = engine.adapter === 'generic' ? `its command` : `\`${engine.adapter === 'agy' ? 'agy' : engine.adapter}\``;
      throw coded('engine_unavailable', `@${engine.name} isn't available — ${binary} was not found on this machine`);
    }
    throw coded('engine_failed', err.message);
  }

  if (result.stopReason === 'refusal') {
    log(`[${payload.editId}] refused`);
    throw coded('declined', 'the model declined this request');
  }
  if (result.stopReason !== 'end_turn') {
    log(`[${payload.editId}] incomplete (${result.stopReason})`);
    throw coded('incomplete', `reply incomplete (${result.stopReason}) — not applied`);
  }
  log(`[${payload.editId}] done (${result.model})`);
  return { html: result.html, stopReason: result.stopReason, model: result.model };
}

module.exports = { runAiEdit, resolveEngines, routeEngine };
