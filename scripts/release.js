#!/usr/bin/env node

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ============================================
// CLI ARGUMENT PARSING
// ============================================

let VERSION_TYPE = '';
let RESUME = false;
let IGNORE_WINDOW = false;

for (const arg of process.argv.slice(2)) {
  switch (arg) {
    case '--major': VERSION_TYPE = 'major'; break;
    case '--minor': VERSION_TYPE = 'minor'; break;
    case '--patch': VERSION_TYPE = 'patch'; break;
    case '--resume': RESUME = true; break;
    case '--ignore-window': IGNORE_WINDOW = true; break;
    case '--help':
    case '-h':
      console.log('Usage: node scripts/release.js [--major|--minor|--patch] [--resume] [--ignore-window]');
      console.log('');
      console.log('Bumps the version, pushes it, and hands the build to GitHub Actions.');
      console.log('Nothing is compiled, signed or uploaded on this machine any more.');
      console.log('');
      console.log('Options:');
      console.log('  --major              Major version bump (breaking changes)');
      console.log('  --minor              Minor version bump (new features)');
      console.log('  --patch              Patch version bump (bug fixes)');
      console.log('  --resume             Finish the version already in package.json, skipping');
      console.log('                       the bump, commit and push. Dispatches a fresh build,');
      console.log('                       or picks up after the build if that commit already');
      console.log('                       has a green run.');
      console.log('  --ignore-window      Release inside the Tue-Fri 09:00-18:00 ET window.');
      console.log('                       Deliberate override; a release publishes publicly.');
      console.log('');
      console.log('If no version option is provided, the bump is chosen automatically');
      console.log('from the commit messages since the last tag. Nothing prompts.');
      process.exit(0);
    default:
      console.error(`Unknown argument: ${arg}`);
      console.error('Use --help for usage information');
      process.exit(1);
  }
}

if (RESUME && VERSION_TYPE) {
  console.error('--resume cannot be combined with --major/--minor/--patch');
  console.error('Resume reuses the version already in package.json.');
  process.exit(1);
}

// ============================================
// CONFIGURATION
// ============================================

const ROOT_DIR = path.join(__dirname, '..');

// Load .env file for Apple credentials
require('dotenv').config({ path: path.join(ROOT_DIR, '.env') });
const LOG_FILE = path.join(ROOT_DIR, 'release.log');

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
  fs.writeFileSync(LOG_FILE, `# Release Log - ${new Date().toISOString()}\n\n`);
}

function log(message, color = null) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, logLine);

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
  try {
    return execSync(command, { encoding: 'utf8', cwd: ROOT_DIR, ...options });
  } catch (error) {
    throw new Error(`Command failed: ${command}\n${error.message}`);
  }
}

// ============================================
// VERSION MANAGEMENT
// ============================================

function getCurrentVersion() {
  const pkgPath = path.join(ROOT_DIR, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  return pkg.version;
}

function bumpVersion(current, type) {
  const [major, minor, patch] = current.split('.').map(Number);
  switch (type) {
    case 'major': return `${major + 1}.0.0`;
    case 'minor': return `${major}.${minor + 1}.0`;
    case 'patch': return `${major}.${minor}.${patch + 1}`;
    default: throw new Error(`Invalid bump type: ${type}`);
  }
}

// Written to a known version rather than searched for the previous one. A version
// bumped in the tree without a release (1.21.0, for the license fence) left this
// hunting for a string these files never contained, so the 1.22.0 release rewrote
// nothing and hyperclaylocal.com kept advertising 1.20.1 downloads for four days.
//
// Anchored on the filename prefix, never on a bare version pattern: website/index.html
// is full of SVG path data that reads as version numbers (1.02.08, 2.33.66).
const ANY_VERSION = '\\d+\\.\\d+\\.\\d+';

function updateVersionInFile(filePath, newVersion) {
  const fullPath = path.join(ROOT_DIR, filePath);
  let content = fs.readFileSync(fullPath, 'utf8');

  if (filePath === 'package.json') {
    const pkg = JSON.parse(content);
    pkg.version = newVersion;
    content = JSON.stringify(pkg, null, 2) + '\n';
  } else {
    content = content
      .replace(new RegExp(`HyperclayLocal-Setup-${ANY_VERSION}`, 'g'), `HyperclayLocal-Setup-${newVersion}`)
      .replace(new RegExp(`HyperclayLocal-${ANY_VERSION}`, 'g'), `HyperclayLocal-${newVersion}`)
      .replace(new RegExp(`data-version="${ANY_VERSION}"`, 'g'), `data-version="${newVersion}"`);
  }

  fs.writeFileSync(fullPath, content);
}

function deployWebsite() {
  logInfo('Deploying hyperclaylocal.com...');

  const websiteDir = path.join(ROOT_DIR, 'website');
  if (!fs.existsSync(path.join(websiteDir, 'wrangler.jsonc'))) {
    throw new Error('website/wrangler.jsonc not found; cannot deploy hyperclaylocal.com');
  }

  try {
    execSafe('npx wrangler deploy', { cwd: websiteDir, stdio: 'inherit' });
    logSuccess('Deployed hyperclaylocal.com');
  } catch (error) {
    throw new Error(`Failed to deploy hyperclaylocal.com: ${error.message}`);
  }
}

// ============================================
// EXTERNAL DOCS
// ============================================

function updateExternalDocs(version) {
  logInfo('Updating external documentation...');

  try {
    execSafe(`node scripts/update-external-docs.js ${version}`, { stdio: 'inherit' });
  } catch (error) {
    // Don't fail the release if external docs can't be updated
    logWarn(`Could not update external docs: ${error.message}`);
  }
}

// ============================================
// MAIN
// ============================================

// The First Million Stays Yours License promises each version converts to plain MIT by deleting a
// labelled clause list. CI checks that on push, but this app is released from a
// laptop, so CI is not in the path of an actual publish. Runs first, before the
// version bump, because a release that has already tagged and pushed is a much
// worse place to discover it.
// A release uploads installers to public R2 and redeploys hyperclaylocal.com, so it
// is a public publish. Nothing publishes Tue-Fri 09:00-18:00 America/New_York.
//
// Checked here, at the moment the command is run, rather than inside the workflow:
// this command is the only thing that dispatches a build or deploys the site, so one
// check covers both public actions.
function verifyPublishWindow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date())
      .map(part => [part.type, part.value])
  );

  const blocked = ['Tue', 'Wed', 'Thu', 'Fri'].includes(parts.weekday) &&
    Number(parts.hour) >= 9 && Number(parts.hour) < 18;

  if (!blocked) return;

  if (IGNORE_WINDOW) {
    logWarn(`Releasing inside the publish window (${parts.weekday} ${parts.hour}:${parts.minute} ET) because --ignore-window was passed.`);
    return;
  }

  logSection('Publish window');
  logError(`It is ${parts.weekday} ${parts.hour}:${parts.minute} in New York.`);
  logError('A release publishes installers to R2 and redeploys hyperclaylocal.com,');
  logError('and nothing publishes publicly Tue-Fri 09:00-18:00. Run it after 18:00,');
  logError('or Sat-Mon. Pass --ignore-window to override deliberately.');
  process.exit(1);
}

function verifyLicenseAblation() {
  logSection('License');
  try {
    execSync('python3 scripts/ablation-check.py LICENSE', {
      encoding: 'utf8',
      cwd: ROOT_DIR,
      stdio: 'pipe',
    });
    logSuccess('LICENSE still ablates to plain MIT');
  } catch (error) {
    logError('LICENSE does not ablate to plain MIT. Release stopped.');
    logError('The conversion clause printed in LICENSE is not true of this file.');
    const detail = `${error.stdout || ''}${error.stderr || ''}`.trim();
    if (detail) console.log(detail);
    process.exit(1);
  }
}

// Polled here rather than handed to `gh run watch --exit-status`, which exits nonzero
// both when the run failed and when watching it failed, with no way to tell the two
// apart. On 2026-08-26 it exited nonzero 68 seconds AFTER v1.22.3 had gone green and
// all four installers were on R2, so the release was declared failed and steps 6-9
// never ran: signed installers published, and hyperclaylocal.com left handing out
// 1.22.2 links. The run's own status and conclusion are the verdict now, so a failed
// read is nothing more than a failed read.
//
// Watching also cost about ten times the API calls this does. Measured against a nine
// job run, `gh run watch` makes 27 requests every 20 seconds, most of them per-job
// annotation fetches, so a ten minute wait ran to roughly 800 chances to come back
// bad. This makes two every fifteen seconds.
//
// Every line goes through log(), so release.log finally records the wait. gh's output
// was inherited straight to the terminal, which is why nothing on disk can say what
// the 2026-08-26 failure actually printed.
async function awaitRunVerdict(runId, url) {
  const started = Date.now();
  const seen = new Map();
  let quietSince = Date.now();
  let blindPolls = 0;

  // Three hours. The longest path release.yml can take is about 150 minutes of job
  // timeouts (verify 5, test-macos 25, build-macos 90, upload 30), so a run still
  // unresolved here is stuck rather than slow.
  while (Date.now() - started < 3 * 60 * 60 * 1000) {
    await sleep(15000);

    let run;
    try {
      run = JSON.parse(execSafe(
        `gh run view ${runId} --json status,conclusion,jobs`,
        { stdio: 'pipe', timeout: 30000 }
      ));
      if (blindPolls) logInfo(`Reading the run again after ${blindPolls} failed polls`);
      blindPolls = 0;
    } catch (error) {
      // A poll that fails says something about the network and nothing about the run.
      // Logged rather than swallowed, since not knowing what gh printed is what made
      // the 2026-08-26 failure impossible to explain afterwards.
      if (!blindPolls) logWarn(`Cannot read the run: ${error.message.trim().split('\n').pop()}`);
      if (++blindPolls >= 40) {
        throw new Error(
          `Ten minutes without a readable answer from ${url}\n` +
          '  Nothing here says the run failed. Open that page: if it went green the\n' +
          '  release is published, and `npm run release -- --resume` picks up the rest.'
        );
      }
      continue;
    }

    // gh marshals an empty job list as null, and a dispatched run is briefly real with
    // no jobs on it yet. Progress rendering must never be able to decide the verdict,
    // which is the whole point of this loop.
    const jobs = run.jobs || [];

    const changed = jobs.filter(job => seen.get(job.name) !== (job.conclusion || job.status));
    for (const job of changed) {
      seen.set(job.name, job.conclusion || job.status);
      log(`  ${elapsed(started)}  ${job.name}: ${job.conclusion || job.status}`);
    }

    // build-macos can sit on Apple's notarization queue for most of an hour without a
    // single transition, and silence that long reads as a hang.
    if (changed.length) {
      quietSince = Date.now();
    } else if (Date.now() - quietSince > 5 * 60 * 1000) {
      const running = jobs.filter(job => job.status !== 'completed').map(job => job.name);
      log(`  ${elapsed(started)}  still going: ${running.join(', ')}`);
      quietSince = Date.now();
    }

    // conclusion is "" until the run ends, so status is what says it is over.
    if (run.status !== 'completed') continue;

    if (run.conclusion === 'success') return;

    throw new Error(
      `The release run ${run.conclusion}: ${url}\n` +
      '  Nothing reached R2 unless the upload job itself is the one that failed.\n' +
      '  Fix, push, then re-run with --resume to dispatch the same version again.'
    );
  }

  throw new Error(
    `Still running after three hours: ${url}\n` +
    '  Nothing has failed. Watch that page rather than dispatching another build.'
  );
}

// The build moved to GitHub Actions, so this dispatches release.yml and waits on it
// instead of compiling, signing, notarizing and uploading here. The workflow is the
// gate: it runs the suite on all three platforms and refuses to upload unless every
// one of them is green.
async function dispatchRelease(version) {
  const sha = execSafe('git rev-parse HEAD').trim();

  // A resume whose run already went green needs no second build: this exact commit is
  // already compiled, signed, notarized and on R2, and dispatching again would spend
  // ten more minutes producing the same bytes. Reads before the dispatch are allowed
  // to fail loudly, because nothing is in flight yet; reads after it never decide
  // anything, because a build is running.
  if (RESUME) {
    const rows = JSON.parse(execSafe(
      'gh run list --workflow release.yml --limit 15 --json databaseId,headSha,event,status,conclusion'
    ));
    const done = rows.find(row =>
      row.headSha === sha &&
      row.event === 'workflow_dispatch' &&
      row.status === 'completed' &&
      row.conclusion === 'success'
    );
    if (done) {
      logSuccess(`Run ${done.databaseId} already built and uploaded v${version}. Not rebuilding.`);
      return;
    }
  }

  logInfo(`Dispatching release.yml for v${version}...`);
  execSafe(`gh workflow run release.yml -f version=${version} -f dry_run=false --ref main`);

  // `gh workflow run` returns before the run exists, and the wait below needs an id.
  // Matched on this commit's sha rather than "the newest run", so a run someone else
  // started in the same minute is never mistaken for ours.
  let runId = null;
  for (let attempt = 0; attempt < 30 && !runId; attempt++) {
    await sleep(2000);
    try {
      const rows = JSON.parse(execSafe(
        'gh run list --workflow release.yml --limit 15 --json databaseId,headSha,event',
        { stdio: 'pipe', timeout: 30000 }
      ));
      const match = rows.find(row => row.headSha === sha && row.event === 'workflow_dispatch');
      if (match) runId = match.databaseId;
    } catch {
      // The build is already running by this point, so a failed read here is worth
      // one of the 29 remaining attempts, never an abort.
    }
  }

  if (!runId) {
    throw new Error(
      `Dispatched, but no run appeared for ${sha.slice(0, 7)} within a minute. ` +
      'Check the Actions tab; the version commit is already pushed.'
    );
  }

  const url = `https://github.com/panphora/hyperclay-local/actions/runs/${runId}`;
  logInfo(`Watching ${url}`);
  log('This takes a while: four Apple notarization round-trips, plus Windows signing.');

  await awaitRunVerdict(runId, url);

  logSuccess('Built, signed, notarized, stapled and uploaded on all three platforms');
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
  }
}

async function main() {
  process.chdir(ROOT_DIR);
  initLog();
  verifyPublishWindow();
  verifyLicenseAblation();

  console.log('');
  console.log(`${colors.cyan}╔════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.cyan}║          HyperclayLocal Release                    ║${colors.reset}`);
  console.log(`${colors.cyan}╚════════════════════════════════════════════════════╝${colors.reset}`);
  console.log('');

  let newVersion;

  if (RESUME) {
    logSection('Resume');

    newVersion = getCurrentVersion();
    log(`Resuming v${newVersion}`);

    // The version being resumed must be the COMMITTED one, and that commit must be
    // on origin: the workflow builds a ref, so anything still sitting in the working
    // tree would not be in the build.
    let committedVersion = null;
    try {
      committedVersion = JSON.parse(execSafe('git show HEAD:package.json')).version;
    } catch {
      committedVersion = null;
    }
    if (committedVersion !== newVersion) {
      logError(`package.json says ${newVersion}, but HEAD has ${committedVersion || 'no readable version'}.`);
      logError('That version was never committed, so the workflow cannot build it.');
      logError('Commit it, or run a fresh release.');
      process.exit(1);
    }

    const branch = execSafe('git rev-parse --abbrev-ref HEAD').trim();
    let pushed = false;
    try {
      execSafe(`git merge-base --is-ancestor HEAD origin/${branch}`, { stdio: 'pipe' });
      pushed = true;
    } catch {
      pushed = false;
    }
    if (!pushed) {
      logError(`HEAD is not present on origin/${branch}.`);
      logError('The workflow builds what is on the remote. Push first.');
      process.exit(1);
    }

    const dirty = execSafe('git status --porcelain').trim();
    if (dirty) {
      logWarn('Working tree has uncommitted changes; they will NOT be in this build:');
      dirty.split('\n').forEach(line => log(`  ${line}`));
    }
  } else {
    logSection('Step 1: Pre-flight Checks');

    const status = execSafe('git status --porcelain').trim();
    if (status) {
      const lines = status.split('\n');
      const unexpectedChanges = lines.filter(line => {
        const file = line.slice(3);
        return !FILES_TO_UPDATE.some(allowed => file.endsWith(allowed));
      });

      if (unexpectedChanges.length > 0) {
        logError('Uncommitted changes detected:');
        unexpectedChanges.forEach(line => log(`  ${line}`));
        log('');
        log('Please commit or stash these changes before releasing.');
        process.exit(1);
      }
    }
    logSuccess('Working directory clean');

    // The build is remote now, so a missing or unauthenticated gh is a hard stop
    // rather than a nuisance. Better here than after the version commit is pushed.
    try {
      execSafe('gh auth status', { stdio: 'pipe' });
      logSuccess('GitHub CLI authenticated');
    } catch {
      logError('gh is not authenticated, and the build runs on GitHub Actions now.');
      logError('Run: gh auth login');
      process.exit(1);
    }

    logSection('Step 2: Version');

    const currentVersion = getCurrentVersion();
    log(`Current version: ${currentVersion}`);

    let bumpType;
    if (VERSION_TYPE) {
      bumpType = VERSION_TYPE;
      logSuccess(`Using version type from argument: ${bumpType}`);
    } else {
      logInfo('Asking Claude Code for version bump recommendation...');

      const lastTag = execSafe('git tag --sort=-version:refname | head -1').trim();
      let gitLog = '';
      if (lastTag) {
        gitLog = execSafe(`git log ${lastTag}..HEAD --pretty=format:"%s"`).trim();
      } else {
        gitLog = execSafe('git log --pretty=format:"%s" -20').trim();
      }

      if (!gitLog) {
        logError('No commits found to analyze');
        process.exit(1);
      }

      try {
        const recommendation = execSafe(
          `echo ${JSON.stringify(gitLog)} | env -u CLAUDECODE claude --model sonnet -p "Based on these git commit messages, should this be a patch or minor release? Reply with a single word: patch or minor"`,
          { stdio: 'pipe' }
        ).trim().toLowerCase();

        // Claude sometimes answers in a sentence rather than a bare word, so take
        // the first patch/minor token it mentions.
        const match = recommendation.match(/patch|minor/);
        if (match) {
          bumpType = match[0];
          logSuccess(`Claude recommends: ${bumpType}`);
        } else {
          bumpType = 'patch';
          logError(`Unexpected response from Claude: "${recommendation}" — defaulting to patch.`);
        }
      } catch (error) {
        // A release is not the place to fail on an advisory call. The bump is a
        // recommendation, and patch is the conservative one: shipping 1.20.2
        // where 1.21.0 was meant is a wrong label on a real release, while
        // exiting here strands a train that has already published its libraries.
        bumpType = 'patch';
        logError('Claude Code failed — defaulting to patch. Re-run with --minor if wrong.');
      }
    }

    newVersion = bumpVersion(currentVersion, bumpType);
    log('');
    logSuccess(`Version: ${currentVersion} → ${newVersion}`);

    logSection('Step 3: Update Files');

    for (const file of FILES_TO_UPDATE) {
      updateVersionInFile(file, newVersion);
      logSuccess(`Updated ${file}`);
    }

    logSection('Step 4: Commit & Push');

    for (const file of FILES_TO_UPDATE) {
      execSafe(`git add "${file}"`);
    }
    execSafe(`git commit -m "chore: release v${newVersion}"`);
    logSuccess('Committed version bump');

    // Tag the release commit. This step was missing until 2026-08-29, and the gap was invisible
    // because everything else about a release worked: 1.21.0 through 1.22.6 all shipped publicly
    // while the newest tag stayed at v1.20.1. Two things depend on it. Step 3 above reads
    // `git log <lasttag>..HEAD` to choose the next bump, so with stale tags it was judging a span
    // covering three already-released versions. And a released version with no tag cannot be
    // checked out, diffed, or bisected later.
    //
    // Tolerating an existing tag matters because this script is re-run after a failed release: the
    // version is already committed by then, so a hard failure here would block the retry over a
    // tag that already says the right thing.
    const tag = `v${newVersion}`;
    const tagExists = execSafe(`git tag --list "${tag}"`).trim() !== '';
    if (tagExists) {
      logInfo(`Tag ${tag} already exists, leaving it alone`);
    } else {
      execSafe(`git tag -a "${tag}" -m "${tag}"`);
      logSuccess(`Tagged ${tag}`);
    }

    logInfo('Pushing to remote...');
    execSafe('git push origin HEAD');
    execSafe(`git push origin "${tag}"`);
    logSuccess('Pushed to remote');
  }

  logSection('Step 5: Build, Sign and Upload on GitHub');

  await dispatchRelease(newVersion);

  logSection('Step 6: Download Sizes');

  // The installers were measured on the runner and the byte counts published in
  // release-info.json, since they no longer exist on this machine to stat.
  execSafe('node scripts/write-download-sizes.js', { stdio: 'inherit' });

  execSafe('git add README.md website/index.html');
  const stagedChanges = execSafe('git diff --cached --name-only').trim();
  if (stagedChanges) {
    execSafe(`git commit -m "chore: update download sizes for v${newVersion}"`);
    execSafe('git push origin HEAD');
    logSuccess('Download sizes committed and pushed');
  } else {
    logInfo('Sizes unchanged, nothing to commit');
  }

  logSection('Step 7: Deploy Website');

  deployWebsite();

  fs.writeFileSync(path.join(ROOT_DIR, '.deploy'), execSafe('git rev-parse HEAD').trim() + '\n');
  logSuccess('Wrote .deploy tracking file');

  logSection('Step 8: Update External Docs');

  updateExternalDocs(newVersion);

  logSection('Step 9: Install Locally');

  await installLocally(newVersion);

  const duration = Math.round((Date.now() - startTime) / 1000);
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;

  logSection('Release Complete');

  log(`Version: ${newVersion}`);
  log(`Duration: ${minutes}m ${seconds}s`);
  log('');
  log('Download URLs:');
  log(`  macOS (ARM):   https://local.hyperclay.com/HyperclayLocal-${newVersion}-arm64.dmg`);
  log(`  macOS (Intel): https://local.hyperclay.com/HyperclayLocal-${newVersion}.dmg`);
  log(`  Windows:       https://local.hyperclay.com/HyperclayLocal-Setup-${newVersion}.exe`);
  log(`  Linux (x64):   https://local.hyperclay.com/HyperclayLocal-${newVersion}.AppImage`);
  log(`  Linux (ARM):   https://local.hyperclay.com/HyperclayLocal-${newVersion}-arm64.AppImage`);
  log('');
  logSuccess('Released.');
  log('');
  log(`Full log: ${LOG_FILE}`);
}

main().catch(error => {
  logError(error.message);
  log('');
  log(`Full log: ${LOG_FILE}`);
  process.exit(1);
});
