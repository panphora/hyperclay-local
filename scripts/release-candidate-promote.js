'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { requireVersion } = require('./release-options');
const { expectedInstallerNames } = require('./release-publication');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const need = (condition, message) => { if (!condition) throw new Error(message); };

function validatePromotionRecord(record, expected) {
  need(record && record.schema === 2 && record.app === 'hyperclay-local', 'Invalid Local promotion record');
  requireVersion(record.version);
  for (const field of ['manifest_identity', 'candidate_sha256']) {
    need(/^[a-f0-9]{64}$/.test(record[field]), `Invalid promotion ${field}`);
  }
  need(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(record.source_sha), 'Invalid promotion source');
  need(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(record.release_sha), 'Invalid promotion release SHA');
  need(typeof record.payload_date === 'string' && Number.isFinite(Date.parse(record.payload_date)) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|\+00:00)$/.test(record.payload_date), 'Invalid promotion payload date');
  need(record.bucket === 'hyperclay-candidates', 'Invalid candidate bucket');
  if (expected) {
    need(record.version === expected.version && record.release_sha === expected.releaseSha,
      'Promotion version or release SHA mismatch');
    need(expected.clean === true, 'Promotion requires a clean tree');
  }
  need(Array.isArray(record.files) && record.files.length > 0, 'Missing candidate objects: requalify');
  const keys = new Set();
  let prefix;
  for (const artifact of record.files) {
    need(artifact && typeof artifact.group === 'string' && typeof artifact.name === 'string' &&
      typeof artifact.key === 'string' && /^[a-f0-9]{64}$/.test(artifact.sha256) &&
      Number.isSafeInteger(artifact.size) && artifact.size > 0, 'Invalid candidate object');
    const match = artifact.key.match(/^candidates\/hyperclay-local\/([a-f0-9]{64})\/([a-zA-Z0-9_-]+)\/out\/([a-zA-Z0-9_.-]+)$/);
    need(match && match[1] === record.candidate_sha256 && !keys.has(artifact.key), 'Invalid or repeated candidate key');
    need(match[3] === artifact.name, 'Candidate key does not match file name');
    const parent = artifact.key.slice(0, artifact.key.lastIndexOf('/'));
    need(prefix === undefined || prefix === parent, 'Candidate objects span attempts');
    prefix = parent;
    keys.add(artifact.key);
  }
  selectFiles(record);
  return { ...record, payload_date: new Date(record.payload_date).toISOString() };
}

function selectFiles(record) {
  const version = record.version;
  const installers = expectedInstallerNames(version);
  const groups = {
    'build-macos': [installers[0], installers[1], `HyperclayLocal-${version}-mac.zip`, `HyperclayLocal-${version}-arm64-mac.zip`],
    'build-windows': [installers[2]],
    'build-linux-x64': [installers[3]],
    'build-linux-arm64': [installers[4]],
    'linux-update-signing': ['policy.json'],
    'update-feed': ['latest-mac.yml', 'latest.yml']
  };
  const optional = { 'linux-update-signing': installers.slice(3).map(file => `${file}.sig`),
    'update-feed': ['latest-linux.yml', 'latest-linux-arm64.yml'] };
  const blockmaps = Object.fromEntries(Object.entries(groups).filter(([group]) => group.startsWith('build-'))
    .map(([group, files]) => [group, files.map(file => `${file}.blockmap`)]));
  for (const file of record.files) {
    need(groups[file.group] && [...groups[file.group], ...(optional[file.group] || []),
      ...(blockmaps[file.group] || [])].includes(file.name),
      'Invalid candidate publication file');
  }
  const selected = new Map();
  const requireFile = (group, file) => {
    const matches = record.files.filter(a => a.group === group && a.name === file);
    need(matches.length === 1, `Missing candidate ${group}/${file}: requalify`);
    selected.set(file, matches[0]);
  };
  for (const [group, files] of Object.entries(groups)) for (const file of files) requireFile(group, file);
  if (record.files.some(file => (optional[file.group] || []).includes(file.name))) {
    for (const [group, files] of Object.entries(optional)) for (const file of files) requireFile(group, file);
  }
  return { installers, selected, requireFile };
}

async function promoteCandidate(record, expected, ports) {
  record = validatePromotionRecord(record, expected);
  const selection = selectFiles(record);
  const bytes = new Map();
  for (const artifact of record.files) {
    let body;
    try { body = Buffer.from(await ports.download(record.bucket, artifact.key)); }
    catch { throw new Error('candidate expired or incomplete: requalify'); }
    need(body.length === artifact.size && digest(body) === artifact.sha256,
      'candidate expired or incomplete: requalify');
    bytes.set(artifact.key, body);
  }
  const body = name => bytes.get(selection.selected.get(name).key);
  let policy;
  try { policy = JSON.parse(body('policy.json').toString('utf8')); }
  catch { throw new Error('Invalid candidate Linux feed policy: requalify'); }
  need(policy && typeof policy.linuxUpdates === 'boolean', 'Missing Linux feed policy: requalify');
  if (policy.linuxUpdates) {
    for (const file of selection.installers.slice(3)) selection.requireFile('linux-update-signing', `${file}.sig`);
    for (const file of ['latest-linux.yml', 'latest-linux-arm64.yml']) selection.requireFile('update-feed', file);
  } else {
    need(!record.files.some(a => a.group === 'update-feed' && /latest-linux/.test(a.key)) &&
      !record.files.some(a => a.group === 'linux-update-signing' && a.key.endsWith('.sig')),
    'Candidate Linux feed policy contradicts retained files: requalify');
  }
  const feeds = [...selection.selected.keys()].filter(name => name.endsWith('.yml'));
  for (const name of feeds) {
    const feed = require('js-yaml').load(body(name).toString('utf8'));
    need(feed && feed.version === record.version && new Date(feed.releaseDate).toISOString() === record.payload_date &&
      Array.isArray(feed.files) && feed.files.length > 0, 'Candidate feed identity mismatch: requalify');
    const expectedFiles = name === 'latest-mac.yml'
      ? [`HyperclayLocal-${record.version}-mac.zip`, `HyperclayLocal-${record.version}-arm64-mac.zip`]
      : name === 'latest.yml' ? [selection.installers[2]]
        : name === 'latest-linux.yml' ? [selection.installers[3]] : [selection.installers[4]];
    const actualFiles = feed.files.map(entry => path.posix.basename(new URL(entry.url).pathname));
    need(actualFiles.length === expectedFiles.length && new Set(actualFiles).size === expectedFiles.length &&
      expectedFiles.every(file => actualFiles.includes(file)), 'Candidate feed architecture mismatch: requalify');
    for (const entry of feed.files) {
      const url = new URL(entry.url);
      const file = path.posix.basename(url.pathname);
      need(selection.selected.has(file) && url.origin === 'https://local.hyperclay.com' &&
        url.pathname === `/releases/${record.version}/${file}`, 'Candidate feed target mismatch: requalify');
      need(entry.size === body(file).length && entry.sha512 === crypto.createHash('sha512').update(body(file)).digest('base64'),
        'Candidate feed bytes mismatch: requalify');
    }
  }
  const immutable = [...selection.selected.keys()].filter(name => !name.endsWith('.yml') && name !== 'policy.json');
  for (const name of immutable) await ports.immutable(`releases/${record.version}/${name}`, body(name));
  for (const name of feeds) await ports.immutable(`updates/archive/${record.version}/${name}`, body(name));
  for (const name of selection.installers) await ports.put(name, body(name));
  for (const name of feeds) await ports.put(`updates/stable/${name}`, body(name));
  const info = { version: record.version, commit: record.release_sha, date: record.payload_date,
    files: selection.installers, sizes: Object.fromEntries(selection.installers.map(name => [name, body(name).length])) };
  await ports.put('release-info.json', Buffer.from(JSON.stringify(info, null, 2)));
  return info;
}

function contentType(key) {
  return { '.dmg': 'application/x-apple-diskimage', '.exe': 'application/x-msdos-program',
    '.appimage': 'application/x-executable', '.yml': 'text/yaml', '.blockmap': 'application/json',
    '.zip': 'application/zip', '.json': 'application/json' }[path.extname(key).toLowerCase()] || 'application/octet-stream';
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length) {
    need(argv.length === 2 && argv[0] === '--check', 'Use --check <record>');
    validatePromotionRecord(JSON.parse(fs.readFileSync(argv[1], 'utf8')));
    console.log('Local promotion record valid');
    return;
  }
  const record = JSON.parse(process.env.PROMOTION_RECORD);
  const root = path.resolve(__dirname, '..');
  const expected = { version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version,
    releaseSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    clean: execFileSync('git', ['-c', 'core.fsmonitor=false', 'status', '--porcelain', '--untracked-files=all'],
      { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).trim() === '' };
  validatePromotionRecord(record, expected);
  const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
  const { putImmutable } = require('../build-scripts/immutable-upload');
  const client = new S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY, secretAccessKey: process.env.R2_SECRET_KEY } });
  const bucket = process.env.R2_BUCKET;
  need(bucket, 'Missing public R2 bucket');
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'local-promotion-'));
  await promoteCandidate(record, expected, {
    download: (privateBucket, key) => {
      const file = path.join(dir, digest(Buffer.from(key)));
      execFileSync('aws', ['--endpoint-url', `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        '--region', 'auto', 's3api', 'get-object', '--bucket', privateBucket, '--key', key, file], { stdio: 'pipe' });
      return fs.readFileSync(file);
    },
    immutable: (key, body) => putImmutable({ client, bucket, key, body,
      contentType: contentType(key),
      cacheControl: 'public, max-age=31536000, immutable' }),
    put: (key, body) => client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body,
      ContentType: contentType(key),
      ...(key.startsWith('updates/stable/') ? { CacheControl: 'public, max-age=60' } : {}) }))
  });
}

module.exports = { validatePromotionRecord, promoteCandidate, selectFiles, main };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
