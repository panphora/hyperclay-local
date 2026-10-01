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
 * - agy is refused as unsupported: it can read files without asking and has
 *   no switch to stop that, so it cannot run with no tools.
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
const { validateSegments } = require('../utils/path-resolver');

const BUILTIN_ENGINES = {
  claude: { adapter: 'claude', model: 'claude-opus-5-5' },
  fable: { adapter: 'claude', model: 'claude-fable-5-1' },
  codex: { adapter: 'codex' },
  agy: { adapter: 'unsupported' }
};

const SYSTEM = `You edit one HTML element on a static page.
Reply with exactly one complete element: the revised version of the element you are given, keeping its tag and every attribute it already has (id, class, data-*).
Output raw HTML only, no markdown fences, no commentary before or after. Your reply is morphed into the live page verbatim.
The page's stylesheet is external to the element; stay consistent with the class and structure conventions visible in the element you are given.
Never add <script> tags, inline event handlers or javascript: URLs. The page refuses a reply that contains them.`;

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
  const match = comment.match(/^\s*@([a-z0-9_-]+)(?![\w./-])\s*/i);
  if (!match) return { engine: engines[defaultEngine], comment };
  const name = match[1].toLowerCase();
  if (name === 'page') return { engine: engines[defaultEngine], comment };
  if (!engines[name]) {
    throw new Error(`unknown agent @${name} — this server knows ${Object.keys(engines).map(e => '@' + e).join(' ')}`);
  }
  return { engine: engines[name], comment: comment.slice(match[0].length).trim() };
}

// ---------------------------------------------------------------- context (@ tokens)

const MAX_CONTEXT_FILES = 8;
const MAX_CONTEXT_FILE_BYTES = 256 * 1024;
const MAX_CONTEXT_TOTAL_BYTES = 1024 * 1024;

// @file references stay inside the served folder after symlinks are followed, and
// stay small: everything here is sent to the model.
// The static route's segment rules: no dotfile, no dot folder, no internal folder,
// checked against the name asked for and against where it really lands.
function visibleInFolder(rel) {
  try {
    validateSegments(rel.split(path.sep).join('/'));
    return true;
  } catch {
    return false;
  }
}

async function resolveContext(refs = [], baseDir) {
  const wanted = refs.filter(ref => ref !== 'page'); // @page is the page: true flag, read from disk
  if (wanted.length > MAX_CONTEXT_FILES) {
    throw coded('invalid_context', `too many context files (at most ${MAX_CONTEXT_FILES})`);
  }
  const baseReal = await fs.realpath(baseDir).catch(() => baseDir);
  const sections = [];
  let total = 0;
  for (const ref of wanted) {
    const resolved = path.resolve(baseDir, ref);
    if (resolved === baseDir || !resolved.startsWith(baseDir + path.sep)) {
      throw coded('invalid_context', `@${ref} escapes the served folder`);
    }
    if (!visibleInFolder(path.relative(baseDir, resolved))) {
      throw coded('invalid_context', `@${ref} is a hidden or internal file`);
    }
    const real = await fs.realpath(resolved).catch(() => null);
    if (!real) throw coded('invalid_context', `cannot read @${ref}`);
    if (!real.startsWith(baseReal + path.sep)) {
      throw coded('invalid_context', `@${ref} escapes the served folder`);
    }
    if (!visibleInFolder(path.relative(baseReal, real))) {
      throw coded('invalid_context', `@${ref} is a hidden or internal file`);
    }
    const info = await fs.stat(real).catch(() => null);
    if (!info || !info.isFile()) throw coded('invalid_context', `cannot read @${ref}`);
    if (info.size > MAX_CONTEXT_FILE_BYTES) throw coded('invalid_context', `@${ref} is larger than 256 KB`);
    total += info.size;
    if (total > MAX_CONTEXT_TOTAL_BYTES) throw coded('invalid_context', 'the context files are over 1 MB in total');
    const content = await fs.readFile(real, 'utf8').catch(() => {
      throw coded('invalid_context', `cannot read @${ref}`);
    });
    sections.push(`Context file @${ref}:\n\n${content}`);
  }
  return sections;
}

function buildUserPrompt(payload, comment, contextSections, pageText) {
  const parts = [`The element to edit:\n\n${payload.elementHTML}`];
  if (payload.quote) {
    let quote = `The user selected this text inside the element: "${payload.quote}"`;
    const sel = payload.selection;
    if (sel && Number.isInteger(sel.start) && Number.isInteger(sel.end) && sel.start >= 0 && sel.end >= sel.start) {
      quote += ` (characters ${sel.start} to ${sel.end} of the element's text)`;
    }
    parts.push(quote);
  }
  parts.push(...contextSections);
  if (pageText) parts.push(`The full page, for context (@page):\n\n${pageText}`);
  parts.push(`Request: ${comment}`);
  return parts.join('\n\n');
}

// ---------------------------------------------------------------- adapters

// No --bare: it skips the credential store, which breaks keyless subscription
// auth (verified 2026-07-02). --tools '' removes the built-in tools only; MCP
// servers from the person's config still load unless --strict-mcp-config is
// passed with no --mcp-config (verified 2026-09-30).
function claudeArgs(model) {
  return [
    '-p',
    '--model', model,
    '--append-system-prompt', SYSTEM,
    '--tools', '',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--max-turns', '1',
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--verbose'
  ];
}

// A read-only sandbox still lets codex run shell commands; these features are
// what give it tools. With them off it can only answer (verified 2026-09-30).
const CODEX_DISABLED_FEATURES = [
  'shell_tool', 'unified_exec', 'apps', 'browser_use', 'computer_use',
  'multi_agent', 'plugins', 'image_generation', 'view_image'
];

function codexArgs(dir, outFile) {
  return [
    'exec',
    '--ephemeral', '--ignore-user-config', '--ignore-rules',
    '--skip-git-repo-check',
    '--sandbox', 'read-only',
    ...CODEX_DISABLED_FEATURES.flatMap(feature => ['--disable', feature]),
    '-C', dir,
    '-o', outFile,
    '-'
  ];
}

// An agent CLI may start children of its own. On Unix it leads its own process
// group, and cancel kills the group, so nothing it started outlives the request.
function spawnAgent(command, args, options, signal) {
  const child = spawn(command, args, { ...options, detached: process.platform !== 'win32' });
  if (!signal) return child;
  const kill = () => {
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
      else child.kill('SIGKILL');
    } catch {
      try { child.kill('SIGKILL'); } catch {}
    }
  };
  if (signal.aborted) kill();
  else signal.addEventListener('abort', kill, { once: true });
  child.on('close', () => signal.removeEventListener('abort', kill));
  return child;
}

async function claudeAdapter(engine, userPrompt, ctx) {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-edit-claude-'));
  try {
    return await new Promise((resolve, reject) => {
      const child = spawnAgent('claude', claudeArgs(engine.model),
        { cwd: scratch, env: ctx.env, stdio: ['pipe', 'pipe', 'pipe'] }, ctx.signal);
      child.stdin.on('error', () => {});
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
  } finally {
    fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
  }
}

async function codexAdapter(engine, userPrompt, ctx) {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-edit-codex-'));
  const outFile = path.join(scratch, 'last-message.txt');
  try {
    await new Promise((resolve, reject) => {
      const child = spawnAgent('codex', codexArgs(scratch, outFile),
        { cwd: scratch, env: ctx.env, stdio: ['pipe', 'ignore', 'pipe'] }, ctx.signal);
      child.stdin.on('error', () => {});
      child.stdin.end(SYSTEM + '\n\n' + userPrompt);
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
    const child = spawnAgent(substituted[0], substituted.slice(1), {
      cwd: ctx.baseDir, env: ctx.env, stdio: ['pipe', 'pipe', 'pipe']
    }, ctx.signal);
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

const ADAPTERS = { claude: claudeAdapter, codex: codexAdapter, generic: genericAdapter };

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
  if (engine.adapter === 'unsupported') {
    throw coded('engine_unsupported', `@${engine.name} can't be used for AI editing: it can read files without asking, and AI editing only runs agents with no tools`);
  }
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
      const binary = engine.adapter === 'generic' ? 'its command' : `\`${engine.adapter}\``;
      throw coded('engine_unavailable', `@${engine.name} isn't available: ${binary} was not found on this machine. Install it and sign in, or pick another agent with @claude, @fable or @codex.`);
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

module.exports = { runAiEdit, resolveEngines, routeEngine, buildUserPrompt, claudeArgs, codexArgs };
