// E5: the release gate reads its verdict from the suite's own Tests: line, refuses
// anything that is not "all passed, none skipped, none missing", and refuses when the
// working tree is not what the release would build. Nothing here runs the real suite:
// spawn and git are injected, so the whole file is milliseconds.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { readVerdict, runUiPass } = require('../../scripts/ui-pass-gate');

const RELEASE = path.resolve(__dirname, '../../scripts/release.js');

function tempHyperclayDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-pass-gate-'));
  fs.mkdirSync(path.join(dir, 'tests/db'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tests/db/desktop-ui.test.js'), '// stub\n');
  return dir;
}

describe('readVerdict', () => {
  test('accepts a full pass', () => {
    expect(readVerdict(0, 'Tests:       16 passed, 16 total')).toEqual({
      ok: true,
      reason: null,
      summary: '16 passed, 16 total',
    });
  });

  test('refuses a failure', () => {
    expect(readVerdict(1, 'Tests:       2 failed, 14 passed, 16 total').ok).toBe(false);
  });

  test('refuses a pass count below the total', () => {
    expect(readVerdict(0, 'Tests:       3 passed, 16 total').ok).toBe(false);
  });

  test('refuses a suite that skipped everything, even though it exited 0', () => {
    expect(readVerdict(0, 'Tests:       16 skipped, 16 total').ok).toBe(false);
  });

  test('refuses a suite that skipped one test', () => {
    expect(readVerdict(0, 'Tests:       1 skipped, 15 passed, 16 total').ok).toBe(false);
  });

  test('refuses output with no Tests: line at all', () => {
    expect(readVerdict(0, 'no tests found').ok).toBe(false);
  });

  test('refuses a suite that ran nothing', () => {
    expect(readVerdict(0, 'Tests:       0 passed, 0 total').ok).toBe(false);
  });
});

describe('runUiPass', () => {
  test('refuses when the hyperclay checkout has no UI suite, without spawning', () => {
    const spawn = jest.fn();
    const git = jest.fn(() => '');

    const verdict = runUiPass({ localDir: '/local', hyperclayDir: '/nowhere', spawn, git });

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('/nowhere/tests/db/desktop-ui.test.js');
    expect(spawn).not.toHaveBeenCalled();
  });

  test('refuses when src/ differs from HEAD, without spawning', () => {
    const hyperclayDir = tempHyperclayDir();
    const spawn = jest.fn();
    const git = jest.fn(() => ' M src/main/main.js\n');

    const verdict = runUiPass({ localDir: '/local', hyperclayDir, spawn, git });

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('src/main/main.js');
    expect(spawn).not.toHaveBeenCalled();
  });

  test('runs the suite against this checkout when the tree is clean', () => {
    const hyperclayDir = tempHyperclayDir();
    const spawn = jest.fn(() => ({ status: 0, stdout: 'Tests:       16 passed, 16 total\n', stderr: '' }));
    const git = jest.fn(() => '');

    const verdict = runUiPass({ localDir: '/local', hyperclayDir, spawn, git });

    expect(verdict.ok).toBe(true);
    expect(verdict.summary).toBe('16 passed, 16 total');
    expect(spawn).toHaveBeenCalledTimes(1);
    const [command, args, options] = spawn.mock.calls[0];
    expect(command).toBe('node');
    expect(args).toEqual(['scripts/jest-project.mjs', 'db', 'tests/db/desktop-ui']);
    expect(options.cwd).toBe(hyperclayDir);
    expect(options.env.RUN_DESKTOP_UI).toBe('1');
    expect(options.env.HYPERCLAY_LOCAL_DIR).toBe('/local');
  });

  test('refuses when the suite times out', () => {
    const hyperclayDir = tempHyperclayDir();
    const spawn = jest.fn(() => ({
      status: null,
      error: Object.assign(new Error('x'), { code: 'ETIMEDOUT' }),
      stdout: '',
      stderr: '',
    }));
    const git = jest.fn(() => '');

    const verdict = runUiPass({ localDir: '/local', hyperclayDir, spawn, git });

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('ETIMEDOUT');
  });
});

describe('release.js wiring', () => {
  const source = fs.readFileSync(RELEASE, 'utf8');

  function sourceBetween(start, end) {
    const begin = source.indexOf(start);
    const finish = source.indexOf(end, begin);
    if (begin < 0 || finish <= begin) throw new Error(`Missing release adapter: ${start}`);
    return source.slice(begin, finish);
  }

  function adapter({ skip = false, verdict = { ok: true, summary: '16 passed, 16 total' } } = {}) {
    const events = [];
    const ui = jest.fn(() => { events.push('ui'); return verdict; });
    const runRelease = jest.fn(async () => ({ outcome: 'complete', state: { version: '1.2.3' } }));
    const context = {
      path,
      ROOT_DIR: '/fixture/hyperclay-local',
      FILES_TO_UPDATE: ['package.json', 'README.md', 'website/index.html'],
      SKIP_UI_PASS: skip,
      TRANSCRIPT: '/fixture/release.log',
      flags: { skipUiPass: skip },
      colors: { cyan: '', reset: '' },
      AbortController,
      process: { chdir: jest.fn(), once: jest.fn(), removeListener: jest.fn() },
      console: { log: jest.fn() },
      initLog: jest.fn(),
      chooseBump: jest.fn(),
      installLocally: jest.fn(),
      log: jest.fn(),
      logSection: jest.fn(),
      logInfo: jest.fn(),
      logSuccess: jest.fn(),
      logWarn: jest.fn(),
      logError: jest.fn(),
      writeOutput: jest.fn(),
      elapsed: () => 'fixture duration',
      verifyLicenseAblation: jest.fn(() => { events.push('license'); }),
      execSafe(command) {
        if (!['git status --porcelain', 'gh auth status'].includes(command)) {
          throw new Error(`Unexpected external command: ${command}`);
        }
        events.push(command);
        return '';
      },
      require(request) {
        if (request === 'dotenv') return { config: () => { events.push('dotenv'); } };
        if (request === './ui-pass-gate') return { runUiPass: ui };
        if (request === './release-coordinator') return { runRelease };
        throw new Error(`Unexpected module: ${request}`);
      },
    };
    require('vm').runInNewContext(
      sourceBetween('function verifyUiPass() {', 'async function installLocally(') +
      sourceBetween('async function newBuildGates({ kind }) {', '\nmain().catch('),
      context,
      { filename: RELEASE }
    );
    return { context, events, ui, runRelease };
  }

  test.each(['fresh', 'source-recovery', 'repair', 'dispatch'])(
    'the %s build adapter runs the UI gate once after authentication and license checks',
    async kind => {
      const { context, events, ui } = adapter();
      await context.newBuildGates({ kind });
      expect(events).toEqual(['dotenv', 'git status --porcelain', 'gh auth status', 'license', 'ui']);
      expect(ui).toHaveBeenCalledTimes(1);
      expect(ui).toHaveBeenCalledWith({
        localDir: '/fixture/hyperclay-local',
        hyperclayDir: path.join('/fixture/hyperclay-local', '..', 'hyperclay'),
      });
    }
  );

  test('a failed UI verdict rejects the build adapter and preserves its output', async () => {
    const { context, ui } = adapter({ verdict: {
      ok: false, reason: 'one UI test failed', output: 'complete fixture suite output\n',
    } });
    await expect(context.newBuildGates({ kind: 'fresh' })).rejects.toMatchObject({
      code: 'RELEASE_UI_FAILED',
      message: 'The Electron UI suite did not pass: one UI test failed',
    });
    expect(ui).toHaveBeenCalledTimes(1);
    expect(context.writeOutput).toHaveBeenCalledWith(1, 'complete fixture suite output\n');
  });

  test('an explicit skip warns and does not run the UI suite', async () => {
    const { context, events, ui } = adapter({ skip: true });
    await context.newBuildGates({ kind: 'dispatch' });
    expect(events).toEqual(['dotenv', 'git status --porcelain', 'gh auth status', 'license']);
    expect(ui).not.toHaveBeenCalled();
    expect(context.logWarn).toHaveBeenCalledWith('Skipping the Electron UI suite because --skip-ui-pass was passed.');
    expect(context.logWarn).toHaveBeenCalledWith("Nothing has clicked this build's popover.");
  });

  test('main supplies its actual build gate to the coordinator', async () => {
    const { context, runRelease } = adapter();
    await context.main();
    expect(runRelease).toHaveBeenCalledTimes(1);
    const [options, dependencies] = runRelease.mock.calls[0];
    expect(options).toEqual({ repoRoot: context.ROOT_DIR, flags: context.flags });
    expect(dependencies.newBuildGates).toBe(context.newBuildGates);
    expect(dependencies.chooseBump).toBe(context.chooseBump);
    expect(dependencies.install).toBe(context.installLocally);
    expect(dependencies.signal.aborted).toBe(false);
    expect(context.process.removeListener).toHaveBeenCalledTimes(2);
  });
});
