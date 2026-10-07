'use strict';

const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const KEYS = ['version', 'bump', 'resume', 'dryRun', 'reconcileOnly', 'resumeSource', 'retrySite', 'ignoreWindow', 'skipUiPass', 'help'];
function invalid(message) {
  return Object.assign(new Error(message), { code: 'RELEASE_OPTIONS_INVALID' });
}
function requireVersion(value) {
  if (typeof value !== 'string' || !VERSION.test(value) || value.split('.').some(n => Number(n) > 65535)) {
    throw invalid('Version must be X.Y.Z with plain numeric components from 0 through 65535');
  }
  return value;
}
function above(a, b) {
  requireVersion(a); requireVersion(b);
  const left = a.split('.').map(Number), right = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if (left[i] !== right[i]) return left[i] > right[i];
  return false;
}
function bumpVersion(version, bump) {
  requireVersion(version);
  const [major, minor, patch] = version.split('.').map(Number);
  const value = bump === 'major' ? `${major + 1}.0.0`
    : bump === 'minor' ? `${major}.${minor + 1}.0`
      : bump === 'patch' ? `${major}.${minor}.${patch + 1}` : null;
  return requireVersion(value);
}
function validateOptions(f) {
  if (!f || typeof f !== 'object' || Array.isArray(f) || Object.keys(f).length !== KEYS.length ||
      KEYS.some(key => !Object.prototype.hasOwnProperty.call(f, key))) throw invalid('Invalid release flags');
  for (const key of ['resume', 'dryRun', 'reconcileOnly', 'retrySite', 'ignoreWindow', 'skipUiPass', 'help']) {
    if (typeof f[key] !== 'boolean') throw invalid(`Invalid ${key} flag`);
  }
  if (f.version !== null) requireVersion(f.version);
  if (f.bump !== null && !['major', 'minor', 'patch'].includes(f.bump)) throw invalid('Invalid bump');
  if (f.resumeSource !== null && (typeof f.resumeSource !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(f.resumeSource))) {
    throw invalid('--resume-source requires a full lowercase object id');
  }
  const selector = f.version !== null || f.bump !== null;
  if (f.version !== null && f.bump !== null) throw invalid('Choose an exact version or a bump, not both');
  if ((f.resume || f.dryRun || f.reconcileOnly) && selector) throw invalid('Version selectors cannot accompany resume, dry-run or reconcile-only');
  if (f.reconcileOnly && (f.dryRun || f.resumeSource !== null || f.retrySite)) throw invalid('Incompatible reconcile-only flags');
  if (f.resumeSource !== null && (!f.resume || f.dryRun || f.retrySite)) throw invalid('--resume-source requires --resume and excludes dry-run/retry-site');
  if (f.retrySite && (!f.resume || f.dryRun || f.resumeSource !== null)) throw invalid('--retry-site requires --resume and excludes dry-run/resume-source');
  return { ...f };
}
function parseReleaseOptions(argv) {
  if (!Array.isArray(argv) || argv.some(arg => typeof arg !== 'string')) throw invalid('Arguments must be strings');
  const f = { version: null, bump: null, resume: false, dryRun: false, reconcileOnly: false,
    resumeSource: null, retrySite: false, ignoreWindow: false, skipUiPass: false, help: false };
  for (const arg of argv) {
    if (arg.startsWith('--version=')) { f.version = requireVersion(arg.slice(10)); continue; }
    if (arg.startsWith('--resume-source=')) { f.resumeSource = arg.slice(16); continue; }
    const key = { '--resume': 'resume', '--dry-run': 'dryRun', '--reconcile-only': 'reconcileOnly',
      '--retry-site': 'retrySite', '--ignore-window': 'ignoreWindow', '--skip-ui-pass': 'skipUiPass',
      '--help': 'help', '-h': 'help' }[arg];
    if (key) { f[key] = true; continue; }
    if (['--major', '--minor', '--patch'].includes(arg)) { f.bump = arg.slice(2); continue; }
    throw invalid(`Unknown or incomplete argument: ${arg}`);
  }
  return validateOptions(f);
}
function assertPublishWindow(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).map(part => [part.type, part.value]));
  if (['Tue', 'Wed', 'Thu', 'Fri'].includes(parts.weekday) && Number(parts.hour) >= 9 && Number(parts.hour) < 18) {
    throw Object.assign(new Error('Release mutations wait until after 18:00 America/New_York, or Sat through Mon'), {
      code: 'RELEASE_WINDOW_CLOSED'
    });
  }
}
module.exports = { parseReleaseOptions, validateOptions, requireVersion, above, bumpVersion, assertPublishWindow };
