const { spawnSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// The suite lives in the hyperclay repo because it boots the real server against a test database.
// It launches this checkout's Electron app (HYPERCLAY_LOCAL_DIR) and clicks the real popover.
const SUITE = 'tests/db/desktop-ui';

function readVerdict(status, output) {
  const line = output.match(/^Tests:\s+(.*)$/m);
  if (status !== 0) return { ok: false, reason: `the suite exited ${status}`, summary: line ? line[1] : null };
  if (!line) return { ok: false, reason: 'the suite printed no Tests: line, so nothing ran', summary: null };
  const all = line[1].match(/^(\d+) passed, (\d+) total$/);
  if (!all || all[1] !== all[2] || Number(all[1]) === 0) {
    return { ok: false, reason: `not every test ran and passed (${line[1]})`, summary: line[1] };
  }
  return { ok: true, reason: null, summary: line[1] };
}

function changedUnderTest(localDir, git = (cmd) => execSync(cmd, { cwd: localDir, encoding: 'utf8' })) {
  return git('git status --porcelain -- src tests/ui').trim().split('\n').filter(Boolean);
}

function runUiPass({ localDir, hyperclayDir, spawn = spawnSync, git } = {}) {
  if (!fs.existsSync(path.join(hyperclayDir, 'tests/db/desktop-ui.test.js'))) {
    return { ok: false, reason: `no UI suite at ${hyperclayDir}/tests/db/desktop-ui.test.js`, output: '' };
  }
  const changed = changedUnderTest(localDir, git);
  if (changed.length) {
    return {
      ok: false,
      reason: `src/ or tests/ui/ differ from HEAD, so the suite would test code the release does not build:\n  ${changed.join('\n  ')}`,
      output: '',
    };
  }
  const result = spawn('node', ['scripts/jest-project.mjs', 'db', SUITE], {
    cwd: hyperclayDir,
    encoding: 'utf8',
    timeout: 15 * 60 * 1000,
    env: {
      ...process.env,
      PATH: `${path.join(hyperclayDir, 'node_modules/.bin')}${path.delimiter}${process.env.PATH}`,
      RUN_DESKTOP_UI: '1',
      HYPERCLAY_LOCAL_DIR: localDir,
      TEST_DB_PREFIX: `release_${Date.now()}`,
      NODE_OPTIONS: '--experimental-vm-modules',
    },
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  const status = result.error ? `with ${result.error.code || result.error.message}` : result.status;
  return { ...readVerdict(status, output), output };
}

module.exports = { readVerdict, changedUnderTest, runUiPass };
