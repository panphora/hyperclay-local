#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

if (process.argv.slice(2).includes('--status-json')) {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    fs.writeSync(2, '--status-json must be used alone\n');
    process.exitCode = 2;
    return;
  }
  let status;
  try {
    status = require('./release-status').readStatus({ repoRoot: path.resolve(__dirname, '..') });
  } catch {
    status = {
      schema: 1, repoKey: null, currentVersion: null,
      publish: null, siteReceipt: null, dryRun: null,
      readError: { code: 'STATUS_READ_FAILED', message: 'Desktop release status could not be read' }
    };
  }
  const bytes = Buffer.from(JSON.stringify(status) + '\n');
  let offset = 0;
  while (offset < bytes.length) {
    const written = fs.writeSync(1, bytes, offset, bytes.length - offset);
    if (written <= 0) throw new Error('Status output could not be written');
    offset += written;
  }
  process.exitCode = status.readError === null ? 0 : 2;
  return;
}

const { execCaptured, execFileCaptured, writeOutput } = require('./release-command');
const { superviseRelease, externalCapturePath } = require('./release-transcript');

// A standalone run captures its whole output outside the checkout. A hypersave run
// already has a sink open for this process, so the handshake in the condition says so
// and this process stays the one doing the release.
if (process.env.HYPERCLAY_RELEASE_LOG_WORKER !== '1' && !externalCapturePath(process.env)) {
  superviseRelease({ scriptPath: __filename, args: process.argv.slice(2) }).then(({ code, signal }) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exitCode = code === null ? 1 : code;
    }
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
  return;
}

const { parseReleaseOptions } = require('./release-options');
let flags;
try {
  flags = parseReleaseOptions(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  console.error('Use --help for usage information');
  process.exitCode = 1;
  return;
}
if (flags.help) {
  console.log('Usage: node scripts/release.js [--major|--minor|--patch|--version=X.Y.Z] [--resume] [--dry-run]');
  console.log('');
  console.log('Finish the recorded release before starting another version. Nothing prompts.');
  console.log('  --major|--minor|--patch  Choose the next version bump');
  console.log('  --version=X.Y.Z         Choose an exact higher version');
  console.log('  --resume                Continue the recorded release without bumping');
  console.log('  --dry-run               Build/sign/notarize without publishing installers');
  console.log('  --reconcile-only        Observe existing work and finish a proven publication tail');
  console.log('                          Never prepare source, create an attempt or dispatch');
  console.log('  --resume-source=SHA     With --resume, repair failed CI at a different full source SHA');
  console.log('  --retry-site            With --resume, explicitly retry a recorded unknown site attempt');
  console.log('  --skip-ui-pass          Explicitly skip the Electron UI suite for new builds');
  console.log('  --ignore-window         Accepted for compatibility; does not bypass the time policy');
  console.log('  --status-json           Alone, print local read-only release status');
  console.log('');
  console.log('New version advice uses commit messages when no version option is provided.');
  console.log('Commits, pushes, tags, dispatches and deploys wait outside Tue-Fri 09:00-18:00 America/New_York.');
  process.exitCode = 0;
  return;
}
const SKIP_UI_PASS = flags.skipUiPass;

// ============================================
// CONFIGURATION
// ============================================

const ROOT_DIR = path.join(__dirname, '..');

// A display pointer only: the supervisor holds the real sink, and this says where it
// is so the console can point at it. It is never proof that anything is captured.
const TRANSCRIPT = externalCapturePath(process.env) || process.env.HYPERCLAY_RELEASE_LOG || 'console output only';

// src/main/main.js used to carry a literal version; it reads app.getVersion() now,
// so it is not in this list any more.
const FILES_TO_UPDATE = ['package.json', 'README.md', 'website/index.html'];


// ============================================
// COLORS
// ============================================

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m'
};

// ============================================
// LOGGING
// ============================================

let startTime;

function initLog() {
  startTime = Date.now();
}

function log(message, color = null) {
  if (color) {
    console.log(`${color}${message}${colors.reset}`);
  } else {
    console.log(message);
  }
}

function logSection(title) {
  const line = '═'.repeat(50);
  log('');
  log(line, colors.cyan);
  log(`  ${title}`, colors.cyan);
  log(line, colors.cyan);
  log('');
}

function logSuccess(message) {
  log(`✓ ${message}`, colors.green);
}

function logError(message) {
  log(`✗ ${message}`, colors.red);
}

function logInfo(message) {
  log(`→ ${message}`, colors.blue);
}

function logWarn(message) {
  log(`⚠ ${message}`, colors.yellow);
}

// ============================================
// UTILITIES
// ============================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function elapsed(since) {
  const seconds = Math.round((Date.now() - since) / 1000);
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`;
}

function execSafe(command, options = {}) {
  return execCaptured(command, { encoding: 'utf8', cwd: ROOT_DIR, ...options });
}

// ============================================
// MAIN
// ============================================

function verifyLicenseAblation() {
  logSection('License');
  try {
    execSafe('python3 scripts/ablation-check.py LICENSE', { stdio: 'pipe' });
    logSuccess('LICENSE still ablates to plain MIT');
  } catch (cause) {
    logError('LICENSE does not ablate to plain MIT. Release stopped.');
    logError('The conversion clause printed in LICENSE is not true of this file.');
    throw Object.assign(new Error('LICENSE does not ablate to plain MIT'), { code: 'RELEASE_LICENSE_FAILED', cause });
  }
}

// The suite clicks the real popover of this checkout's Electron app against a real test server.
// 1.24.1 shipped "Sync won't turn on" because nothing before it ran main.js; this is that check.
function verifyUiPass() {
  logSection('Electron UI suite');
  if (SKIP_UI_PASS) {
    logWarn('Skipping the Electron UI suite because --skip-ui-pass was passed.');
    logWarn('Nothing has clicked this build\'s popover.');
    return;
  }
  const { runUiPass } = require('./ui-pass-gate');
  const started = Date.now();
  const verdict = runUiPass({ localDir: ROOT_DIR, hyperclayDir: path.join(ROOT_DIR, '..', 'hyperclay') });
  if (verdict.output) writeOutput(1, verdict.output);
  if (verdict.ok) {
    logSuccess(`${verdict.summary} in ${elapsed(started)}`);
    return;
  }
  logError(`The Electron UI suite did not pass: ${verdict.reason}`);
  logError('Release stopped before anything was committed, tagged or dispatched.');
  logError(`Full output is in ${TRANSCRIPT}. Pass --skip-ui-pass to override deliberately.`);
  throw Object.assign(new Error(`The Electron UI suite did not pass: ${verdict.reason}`), { code: 'RELEASE_UI_FAILED' });
}

// Kept, per the decision to keep auto-install: the DMG no longer exists locally, so
// it comes back down from R2. Best-effort. A release is already published by this
// point, and failing to install it on one machine is not a failed release.
async function installLocally(version) {
  const name = `HyperclayLocal-${version}-arm64.dmg`;
  const dmgPath = path.join(os.tmpdir(), name);
  const volume = `/Volumes/HyperclayLocal ${version}-arm64`;

  try {
    logInfo(`Downloading ${name}...`);
    execSafe(`curl -fsSL -o "${dmgPath}" "https://local.hyperclay.com/${name}"`);

    try { execSafe('pkill -f "HyperclayLocal.app"'); } catch {}
    await sleep(1000);

    execSafe(`hdiutil attach "${dmgPath}" -nobrowse -quiet`);
    execSafe('rm -rf "/Applications/HyperclayLocal.app"');
    execSafe(`cp -R "${volume}/HyperclayLocal.app" "/Applications/HyperclayLocal.app"`);
    execSafe(`hdiutil detach "${volume}" -quiet`);
    fs.unlinkSync(dmgPath);

    logSuccess('Installed to /Applications');
    spawn('open', ['/Applications/HyperclayLocal.app'], { detached: true, stdio: 'ignore' }).unref();
    logSuccess('Launched HyperclayLocal');
  } catch (error) {
    try { execSafe(`hdiutil detach "${volume}" -quiet`); } catch {}
    logWarn(`Could not install locally: ${error.message}`);
    throw error;
  }
}

async function chooseBump() {
  logInfo('Asking Claude Code for version bump recommendation...');
  const read = args => execFileCaptured('git', args, { cwd: ROOT_DIR, echoStdout: false }).trim();
  const lastTag = read(['tag', '--sort=-version:refname']).split('\n')[0];
  const gitLog = lastTag
    ? read(['log', `${lastTag}..HEAD`, '--pretty=format:%s'])
    : read(['log', '--pretty=format:%s', '-20']);
  if (!gitLog) throw Object.assign(new Error('No commits found to analyze'), { code: 'RELEASE_NO_COMMITS' });
  const env = { ...process.env };
  delete env.CLAUDECODE;
  try {
    const recommendation = execFileCaptured('claude', ['--model', 'sonnet', '-p',
      'Based on these git commit messages, should this be a patch or minor release? Reply with a single word: patch or minor'],
    { cwd: ROOT_DIR, env, input: gitLog + '\n', stdio: 'pipe', echoStdout: false }).trim().toLowerCase();
    const match = recommendation.match(/patch|minor/);
    if (match) {
      logSuccess(`Claude recommends: ${match[0]}`);
      return match[0];
    }
    logWarn(`Unexpected response from Claude: ${JSON.stringify(recommendation)}. Defaulting to patch.`);
  } catch (error) {
    logWarn('Claude Code failed. Defaulting to patch. Re-run with --minor if wrong.');
  }
  return 'patch';
}

async function newBuildGates({ kind }) {
  require('dotenv').config({ path: path.join(ROOT_DIR, '.env') });
  logSection('Pre-flight Checks');
  const dirty = execSafe('git status --porcelain').replace(/\n$/, '');
  if (kind === 'fresh' && dirty) {
    const unexpected = dirty.split('\n').filter(line => {
      const file = line.slice(3);
      return !FILES_TO_UPDATE.includes(file);
    });
    if (unexpected.length) {
      unexpected.forEach(line => log(`  ${line}`));
      throw Object.assign(new Error('Commit unrelated working changes before releasing'), { code: 'RELEASE_WORKTREE_DIRTY' });
    }
  } else if (dirty) {
    logWarn('Working changes are not part of a recorded source commit:');
    dirty.split('\n').forEach(line => log(`  ${line}`));
  }
  try {
    execSafe('gh auth status', { stdio: 'pipe' });
    logSuccess('GitHub CLI authenticated');
  } catch (cause) {
    throw Object.assign(new Error('gh is not authenticated. Run: gh auth login'), { code: 'RELEASE_AUTH_FAILED', cause });
  }
  verifyLicenseAblation();
  verifyUiPass();
}

async function main() {
  process.chdir(ROOT_DIR);
  initLog();
  console.log('');
  console.log(`${colors.cyan}╔════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.cyan}║          HyperclayLocal Release                    ║${colors.reset}`);
  console.log(`${colors.cyan}╚════════════════════════════════════════════════════╝${colors.reset}`);
  console.log('');
  const controller = new AbortController();
  let signalCode = null;
  const onInt = () => { signalCode = 130; controller.abort(new Error('SIGINT')); };
  const onTerm = () => { signalCode = 143; controller.abort(new Error('SIGTERM')); };
  process.once('SIGINT', onInt);
  process.once('SIGTERM', onTerm);
  try {
    const { runRelease } = require('./release-coordinator');
    const outcome = await runRelease({ repoRoot: ROOT_DIR, flags }, {
      chooseBump, newBuildGates, install: installLocally,
      signal: controller.signal, log: logInfo
    });
    if (outcome.outcome === 'complete') {
      logSection('Release complete');
      logSuccess(`v${outcome.state.version}: publication, sizes, site and both documentation targets are verified`);
      logInfo('https://hyperclaylocal.com');
    } else if (outcome.outcome === 'dry-run-complete') {
      logSection('Dry run complete');
      logSuccess(`v${outcome.state.version} built, signed and notarized. No installers were published.`);
      logInfo('The installers are downloadable from the run artifacts.');
    } else {
      logError(outcome.error ? outcome.error.message : 'Release remains pending');
      if (outcome.outcome === 'failed-ci') logInfo('Repair with --resume --resume-source=<full SHA> after committing and pushing the same-version fix.');
      process.exitCode = 1;
    }
    if (outcome.deferredVersion) logInfo(`v${outcome.deferredVersion} was deferred. Invoke release again to start it.`);
  } finally {
    process.removeListener('SIGINT', onInt);
    process.removeListener('SIGTERM', onTerm);
    if (signalCode !== null) process.exitCode = signalCode;
  }
}

main().catch(error => {
  logError(error.message);
  if (error.code === 'LEGACY_FAILURE_UNRESOLVED' || error.code === 'LEGACY_PUBLICATION_UNRESOLVED') {
    logInfo('Historical release identity is unresolved. No new version or dispatch was authorized.');
  }
  if (!process.exitCode) process.exitCode = 1;
});
