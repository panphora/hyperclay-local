const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { refreshLoginPath } = require('../../src/main/helpers/runner');
const { runAiEdit } = require('../../src/main/helpers/ai-edit');

async function fixture(t, { claude = null, codex = true } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-fallback-'));
  const saved = { PATH: process.env.PATH, SHELL: process.env.SHELL, MOCK_MODEL: process.env.MOCK_MODEL };
  t.after(async () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await refreshLoginPath();
    await fs.rm(dir, { recursive: true, force: true });
  });
  process.env.PATH = dir;
  delete process.env.SHELL;
  delete process.env.MOCK_MODEL;
  await refreshLoginPath();
  const agent = async (name, body) => fs.writeFile(path.join(dir, name), `#!${process.execPath}\n${body}`, { mode: 0o755 });
  if (codex) await agent('codex', `const fs=require('node:fs'); fs.writeFileSync(process.argv[process.argv.indexOf('-o')+1], '<p>Codex edited this</p>'); process.stdin.resume();`);
  if (claude) await agent('claude', claude);
  t.fixtureDir = dir;
  return (comment = 'Make this clearer', settings = {}) => runAiEdit(
    { editId: 'test', elementHTML: '<p>Original</p>', comment },
    { file: path.join(dir, 'page.html'), baseDir: dir, settings }
  );
}
const unix = { skip: process.platform === 'win32' ? 'Fixture agents use executable shebang scripts' : false };

test('missing implicit Claude falls back to the real Codex adapter', unix, async t => {
  const run = await fixture(t);
  const result = await run();
  assert.equal(result.model, 'codex');
  assert.equal(result.html, '<p>Codex edited this</p>');
  assert.equal((await run('@page Make this clearer')).model, 'codex');
  assert.equal((await run('Make this clearer', { aiEdit: { default: 'fable' } })).model, 'codex');
});

test('explicit Claude and Fable do not fall back', unix, async t => {
  const run = await fixture(t);
  for (const name of ['claude', 'fable']) {
    await assert.rejects(run(`@${name} Make this clearer`), err => err.code === 'engine_unavailable' && err.message.includes(`@${name}`));
  }
});

test('neither installed produces actionable error', unix, async t => {
  const run = await fixture(t, { codex: false });
  await assert.rejects(run(), { code: 'engine_unavailable', message: 'Neither Claude Code nor Codex is installed. Install one and sign in.' });
});

test('an installed Claude failure does not fall back', unix, async t => {
  const run = await fixture(t, { claude: "process.stderr.write('Sign in required'); process.exit(1);" });
  await assert.rejects(run(), err => err.code === 'engine_failed' && err.message.includes('Sign in required'));
});

test('an installed Claude remains preferred', unix, async t => {
  const run = await fixture(t, { claude: `console.log(JSON.stringify({type:'result',subtype:'success',result:'<p>Claude edited this</p>'})); process.stdin.resume();` });
  assert.equal((await run()).html, '<p>Claude edited this</p>');
});

test('a configured custom default does not fall back', unix, async t => {
  const run = await fixture(t);
  await assert.rejects(run('Edit', { aiEdit: { default: 'custom', engines: { custom: ['missing-custom-agent'] } } }), err => err.code === 'engine_unavailable' && err.message.includes('@custom'));
});


test('an installed Claude with a missing interpreter does not fall back', unix, async t => {
  const run = await fixture(t);
  await fs.writeFile(path.join(t.fixtureDir, 'claude'), '#!/nonexistent/claude-interpreter\n', { mode: 0o755 });
  await assert.rejects(run(), err => err.code === 'engine_unavailable' && err.message.includes('@claude'));
});
