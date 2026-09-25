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
  const main = source.slice(source.indexOf('async function main()'), source.indexOf('\nmain().catch('));

  test('calls the gate exactly twice inside main', () => {
    expect(main.split('verifyUiPass();').length - 1).toBe(2);
  });

  test('calls the gate on the resume path, before anything leaves the machine', () => {
    const resumeStart = main.indexOf('if (RESUME) {');
    const resumeEnd = main.indexOf('} else {');
    const call = main.indexOf('verifyUiPass();');

    expect(resumeStart).toBeGreaterThan(-1);
    expect(resumeEnd).toBeGreaterThan(resumeStart);
    expect(call).toBeGreaterThan(resumeStart);
    expect(call).toBeLessThan(resumeEnd);
  });

  test('calls the gate on the release path, before the version bump commits anything', () => {
    const auth = main.indexOf("logSuccess('GitHub CLI authenticated')");
    const step2 = main.indexOf("logSection('Step 2: Version')");
    const call = main.lastIndexOf('verifyUiPass();');

    expect(auth).toBeGreaterThan(-1);
    expect(step2).toBeGreaterThan(auth);
    expect(call).toBeGreaterThan(auth);
    expect(call).toBeLessThan(step2);
  });

  test('both calls come before the commit and the dispatch', () => {
    const step3 = main.indexOf("logSection('Step 3: Update Files')");
    const dispatch = main.indexOf('await dispatchRelease(');

    expect(step3).toBeGreaterThan(-1);
    expect(dispatch).toBeGreaterThan(-1);
    for (const call of [main.indexOf('verifyUiPass();'), main.lastIndexOf('verifyUiPass();')]) {
      expect(call).toBeLessThan(step3);
      expect(call).toBeLessThan(dispatch);
    }
  });
});
