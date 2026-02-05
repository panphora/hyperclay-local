#!/usr/bin/env node

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ============================================
// CLI ARGUMENT PARSING
// ============================================

let VERSION_TYPE = '';
for (const arg of process.argv.slice(2)) {
  switch (arg) {
    case '--major': VERSION_TYPE = 'major'; break;
    case '--minor': VERSION_TYPE = 'minor'; break;
    case '--patch': VERSION_TYPE = 'patch'; break;
    case '--help':
    case '-h':
      console.log('Usage: node scripts/release.js [--major|--minor|--patch]');
      console.log('');
      console.log('Options:');
      console.log('  --major    Major version bump (breaking changes)');
      console.log('  --minor    Minor version bump (new features)');
      console.log('  --patch    Patch version bump (bug fixes)');
      console.log('');
      console.log('If no option is provided, you\'ll be prompted to choose.');
      process.exit(0);
    default:
      console.error(`Unknown argument: ${arg}`);
      console.error('Use --help for usage information');
      process.exit(1);
  }
}

// ============================================
// CONFIGURATION
// ============================================

const ROOT_DIR = path.join(__dirname, '..');

// Load .env file for Apple credentials
require('dotenv').config({ path: path.join(ROOT_DIR, '.env') });
const LOG_FILE = path.join(ROOT_DIR, 'release.log');
const NOTARIZATION_FILE = path.join(ROOT_DIR, '.notarization-submissions-mac.json');

const FILES_TO_UPDATE = [
  { path: 'package.json', type: 'json' },
  { path: 'README.md', type: 'readme' },
  { path: 'src/main/main.js', type: 'main-js' }
];

const NOTARIZATION_POLL_INTERVAL = 30000; // 30 seconds

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

function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
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

function updateVersionInFile(filePath, oldVersion, newVersion) {
  const fullPath = path.join(ROOT_DIR, filePath);
  let content = fs.readFileSync(fullPath, 'utf8');

  if (filePath === 'package.json') {
    // Update version field in JSON
    const pkg = JSON.parse(content);
    pkg.version = newVersion;
    content = JSON.stringify(pkg, null, 2) + '\n';
  } else if (filePath === 'README.md') {
    // Update download URLs: HyperclayLocal-X.X.X patterns
    content = content.replace(
      new RegExp(`HyperclayLocal-${oldVersion.replace(/\./g, '\\.')}`, 'g'),
      `HyperclayLocal-${newVersion}`
    );
    // Update Setup URLs: HyperclayLocal-Setup-X.X.X patterns
    content = content.replace(
      new RegExp(`HyperclayLocal-Setup-${oldVersion.replace(/\./g, '\\.')}`, 'g'),
      `HyperclayLocal-Setup-${newVersion}`
    );
  } else if (filePath === 'src/main/main.js') {
    // Update applicationVersion and version strings
    content = content.replace(
      new RegExp(`applicationVersion: '${oldVersion.replace(/\./g, '\\.')}'`, 'g'),
      `applicationVersion: '${newVersion}'`
    );
    content = content.replace(
      new RegExp(`version: '${oldVersion.replace(/\./g, '\\.')}'`, 'g'),
      `version: '${newVersion}'`
    );
  }

  fs.writeFileSync(fullPath, content);
}

function formatFileSize(bytes) {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)}MB`;
}

function updateReadmeSizes(version) {
  const readmePath = path.join(ROOT_DIR, 'README.md');
  const executablesDir = path.join(ROOT_DIR, 'executables');
  let content = fs.readFileSync(readmePath, 'utf8');

  const files = fs.readdirSync(executablesDir);

  for (const file of files) {
    if (!file.endsWith('.dmg') && !file.endsWith('.AppImage')) continue;

    const size = formatFileSize(fs.statSync(path.join(executablesDir, file)).size);
    const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    content = content.replace(new RegExp(`(${escaped}\\)) \\([^)]+\\)`, 'g'), `$1 (${size})`);

    // Estimate Windows as ~75% of macOS Intel
    if (file.endsWith('.dmg') && !file.includes('arm64')) {
      const winSize = formatFileSize(fs.statSync(path.join(executablesDir, file)).size * 0.75);
      const winFile = file.replace('.dmg', '.exe').replace('HyperclayLocal-', 'HyperclayLocal-Setup-');
      const winEscaped = winFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      content = content.replace(new RegExp(`(${winEscaped}\\)) \\([^)]+\\)`, 'g'), `$1 (~${winSize})`);
    }
  }

  fs.writeFileSync(readmePath, content);
}

// ============================================
// BUILD FUNCTIONS
// ============================================

function runBuild(name, command) {
  return new Promise((resolve, reject) => {
    const proc = spawn('npm', ['run', command], {
      cwd: ROOT_DIR,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let output = '';

    proc.stdout.on('data', data => {
      output += data.toString();
      fs.appendFileSync(LOG_FILE, data.toString());
    });

    proc.stderr.on('data', data => {
      output += data.toString();
      fs.appendFileSync(LOG_FILE, data.toString());
    });

    proc.on('close', code => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(`${name} build failed with code ${code}`));
      }
    });

    proc.on('error', reject);
  });
}

function triggerWindowsBuild() {
  logInfo('Triggering Windows build on GitHub Actions...');

  try {
    execSafe('gh workflow run build-and-sign-windows.yml');
  } catch (error) {
    throw new Error(`Failed to trigger Windows workflow: ${error.message}`);
  }

  // Wait for the run to be created
  logInfo('Waiting for workflow to initialize...');
  execSync('sleep 5');

  // Get the run ID
  const output = execSafe('gh run list --workflow=build-and-sign-windows.yml --limit 1 --json databaseId -q ".[0].databaseId"');
  const runId = output.trim();

  if (!runId) {
    throw new Error('Could not get Windows workflow run ID');
  }

  logSuccess(`Windows build triggered (run ID: ${runId})`);
  return runId;
}


// ============================================
// NOTARIZATION
// ============================================

function getNotarizationSubmissions() {
  if (!fs.existsSync(NOTARIZATION_FILE)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(NOTARIZATION_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function checkNotarizationStatus(submissionId) {
  const appleId = process.env.APPLE_ID;
  const teamId = process.env.APPLE_TEAM_ID;
  const password = process.env.APPLE_APP_SPECIFIC_PASSWORD;

  if (!appleId || !teamId || !password) {
    return { status: 'Error', message: 'Missing Apple credentials in environment' };
  }

  try {
    const cmd = `xcrun notarytool info "${submissionId}" \
      --apple-id "${appleId}" \
      --team-id "${teamId}" \
      --password "${password}" \
      --output-format json`;

    const output = execSafe(cmd, { stdio: 'pipe' });
    return JSON.parse(output);
  } catch (error) {
    return { status: 'Error', message: error.message };
  }
}

async function pollNotarizationUntilComplete() {
  logInfo('Waiting for notarization to complete...');

  while (true) {
    const submissions = getNotarizationSubmissions();
    const pending = submissions.filter(s => s.status === 'submitted');

    if (pending.length === 0) {
      logSuccess('All notarization submissions processed');
      return;
    }

    let allAccepted = true;

    for (const submission of pending) {
      const info = checkNotarizationStatus(submission.id);

      if (info.status === 'Accepted') {
        log(`  Notarization ${submission.arch}: Accepted`, colors.green);
        submission.status = 'accepted';
      } else if (info.status === 'Invalid') {
        logError(`Notarization ${submission.arch}: Invalid - ${info.statusSummary || 'Unknown error'}`);
        submission.status = 'invalid';
        throw new Error('Notarization was rejected by Apple');
      } else if (info.status === 'In Progress') {
        log(`  Notarization ${submission.arch}: In Progress...`, colors.dim);
        allAccepted = false;
      } else {
        log(`  Notarization ${submission.arch}: ${info.status}`, colors.yellow);
        allAccepted = false;
      }
    }

    // Save updated statuses
    fs.writeFileSync(NOTARIZATION_FILE, JSON.stringify(submissions, null, 2));

    if (allAccepted) {
      return;
    }

    await sleep(NOTARIZATION_POLL_INTERVAL);
  }
}

function stapleAndMoveExecutables() {
  logInfo('Stapling notarization tickets and moving executables...');

  try {
    execSafe('node build-scripts/check-notarization.js', { stdio: 'inherit' });
    logSuccess('macOS executables stapled and moved');
  } catch (error) {
    throw new Error(`Failed to staple/move executables: ${error.message}`);
  }
}

// ============================================
// UPLOAD
// ============================================

function uploadToR2() {
  logInfo('Uploading macOS and Linux to R2...');

  try {
    execSafe('node build-scripts/post-build.js', { stdio: 'inherit' });
    logSuccess('Upload complete');
  } catch (error) {
    throw new Error(`Failed to upload to R2: ${error.message}`);
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

async function main() {
  process.chdir(ROOT_DIR);
  initLog();

  console.log('');
  console.log(`${colors.cyan}╔════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.cyan}║          HyperclayLocal Release                    ║${colors.reset}`);
  console.log(`${colors.cyan}╚════════════════════════════════════════════════════╝${colors.reset}`);
  console.log('');

  // ==========================================
  // STEP 1: Version bump selection
  // ==========================================

  logSection('Step 1: Pre-flight Checks');

  // Check for uncommitted changes (other than the files we'll modify)
  const status = execSafe('git status --porcelain').trim();
  if (status) {
    const lines = status.split('\n');
    const allowedFiles = FILES_TO_UPDATE.map(f => f.path);
    const unexpectedChanges = lines.filter(line => {
      const file = line.slice(3); // Remove status prefix like " M " or "?? "
      return !allowedFiles.some(allowed => file.endsWith(allowed));
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

  // Clear executables folder
  const executablesDir = path.join(ROOT_DIR, 'executables');
  if (fs.existsSync(executablesDir)) {
    fs.rmSync(executablesDir, { recursive: true });
  }
  fs.mkdirSync(executablesDir, { recursive: true });
  logSuccess('Cleared executables folder');

  // ==========================================
  // STEP 2: Version bump selection
  // ==========================================

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
        `echo ${JSON.stringify(gitLog)} | npx @anthropic-ai/claude-code -p "Based on these git commit messages, should this be a patch or minor release? Reply with a single word: patch or minor"`,
        { stdio: 'pipe' }
      ).trim().toLowerCase();

      if (recommendation === 'patch' || recommendation === 'minor') {
        bumpType = recommendation;
        logSuccess(`Claude recommends: ${bumpType}`);
      } else {
        logError(`Unexpected response from Claude: "${recommendation}"`);
        process.exit(1);
      }
    } catch (error) {
      logError('Claude Code failed');
      process.exit(1);
    }
  }

  const newVersion = bumpVersion(currentVersion, bumpType);
  log('');
  logSuccess(`Version: ${currentVersion} → ${newVersion}`);

  // ==========================================
  // STEP 3: Update version in files
  // ==========================================

  logSection('Step 3: Update Files');

  for (const file of FILES_TO_UPDATE) {
    updateVersionInFile(file.path, currentVersion, newVersion);
    logSuccess(`Updated ${file.path}`);
  }

  // ==========================================
  // STEP 4: Commit and push version bump
  // ==========================================

  logSection('Step 4: Commit & Push');

  // Stage only the files we modified
  for (const file of FILES_TO_UPDATE) {
    execSafe(`git add "${file.path}"`);
  }
  execSafe(`git commit -m "chore: release v${newVersion}"`);
  logSuccess('Committed version bump');

  // Push to remote so GitHub Actions builds the new version
  logInfo('Pushing to remote...');
  execSafe('git push origin HEAD');
  logSuccess('Pushed to remote');

  // ==========================================
  // STEP 5: Build all platforms
  // ==========================================

  logSection('Step 5: Build');

  // Clear old notarization submissions
  if (fs.existsSync(NOTARIZATION_FILE)) {
    fs.unlinkSync(NOTARIZATION_FILE);
  }

  // Trigger Windows build (runs independently on GitHub Actions)
  triggerWindowsBuild();

  // Start macOS and Linux builds in parallel
  logInfo('Starting macOS and Linux builds in parallel...');

  const buildPromises = [
    runBuild('macOS', 'mac-build:run').then(() => logSuccess('macOS build complete')),
    runBuild('Linux', 'linux-build:run').then(() => logSuccess('Linux build complete'))
  ];

  await Promise.all(buildPromises);

  // ==========================================
  // STEP 6: Wait for notarization
  // ==========================================

  logSection('Step 6: Wait for Notarization');

  logInfo('Waiting for macOS notarization...');
  logInfo('(Windows build runs independently on GitHub Actions)');

  await pollNotarizationUntilComplete();

  // ==========================================
  // STEP 7: Finalize macOS
  // ==========================================

  logSection('Step 7: Finalize');

  stapleAndMoveExecutables();

  // Move Linux executable too
  logInfo('Moving Linux executable...');
  execSafe('node build-scripts/move-executables.js linux');

  // Update README with actual file sizes
  logInfo('Updating README with file sizes...');
  updateReadmeSizes(newVersion);
  logSuccess('README sizes updated');

  // Install to local Applications folder
  logInfo('Installing to /Applications...');
  const dmgPath = path.join(ROOT_DIR, 'executables', `HyperclayLocal-${newVersion}-arm64.dmg`);
  const volumeName = `HyperclayLocal ${newVersion}-arm64`;
  try {
    execSafe(`hdiutil attach "${dmgPath}" -nobrowse -quiet`);
    execSafe('rm -rf "/Applications/HyperclayLocal.app"');
    execSafe(`cp -R "/Volumes/${volumeName}/HyperclayLocal.app" "/Applications/HyperclayLocal.app"`);
    execSafe(`hdiutil detach "/Volumes/${volumeName}" -quiet`);
    logSuccess('Installed to /Applications');
  } catch (error) {
    try { execSafe(`hdiutil detach "/Volumes/${volumeName}" -quiet`); } catch {}
    logWarn(`Could not install locally: ${error.message}`);
  }

  // ==========================================
  // STEP 8: Upload to R2
  // ==========================================

  logSection('Step 8: Upload');

  uploadToR2();

  // ==========================================
  // STEP 9: Update external docs
  // ==========================================

  logSection('Step 9: Update External Docs');

  updateExternalDocs(newVersion);

  // ==========================================
  // DONE
  // ==========================================

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
  log(`  Linux:         https://local.hyperclay.com/HyperclayLocal-${newVersion}.AppImage`);
  log('');
  logSuccess('All platforms built, signed, and uploaded!');
  log('');
  logWarn('Remember to commit changes in hyperclay and hyperclay-website repos!');
  log('');
  log(`Full log: ${LOG_FILE}`);
}

main().catch(error => {
  logError(error.message);
  log('');
  log(`Full log: ${LOG_FILE}`);
  process.exit(1);
});
