'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const yaml = require('js-yaml');
const { putImmutable } = require('../../build-scripts/immutable-upload');
const { promoteCandidate, validatePromotionRecord, main } = require('../../scripts/release-candidate-promote');
const { expectedInstallerNames } = require('../../scripts/release-publication');
const sha256 = body => crypto.createHash('sha256').update(body).digest('hex');
const version = '1.29.0';
const sourceSha = 'a'.repeat(40);
const releaseSha = 'e'.repeat(40);
const expected = { version, releaseSha, clean: true };
const contract = require('../../scripts/release-candidate').candidateContract();

function fixture(linuxUpdates = true) {
  const objects = new Map();
  const publicObjects = new Map();
  const uploads = [];
  const record = { schema: 2, app: 'hyperclay-local', version, source_sha: sourceSha, release_sha: releaseSha,
    manifest_identity: 'b'.repeat(64), candidate_sha256: 'c'.repeat(64),
    payload_date: '2026-11-01T12:00:00.000Z', bucket: 'hyperclay-candidates', files: [] };
  const add = (group, file, value = `retained:${file}`) => {
    const body = Buffer.from(value);
    const key = `candidates/hyperclay-local/${record.candidate_sha256}/attempt-1/out/${file}`;
    expect(contract.artifacts).toContain(group);
    record.files.push({ group, name: file, key, size: body.length, sha256: sha256(body) });
    objects.set(key, body);
    return file;
  };
  const names = expectedInstallerNames(version);
  add('build-macos', names[0]); add('build-macos', names[1]);
  add('build-windows', names[2]);
  add('build-linux-x64', names[3]); add('build-linux-arm64', names[4]);
  const zips = [`HyperclayLocal-${version}-mac.zip`, `HyperclayLocal-${version}-arm64-mac.zip`]
    .map(file => add('build-macos', file));
  add('build-macos', `${zips[0]}.blockmap`);
  add('linux-update-signing', 'policy.json', JSON.stringify({ linuxUpdates }));
  if (linuxUpdates) for (const file of names.slice(3)) add('linux-update-signing', `${file}.sig`);
  const bytes = file => objects.get(record.files.find(a => a.key.endsWith(`/${file}`)).key);
  const feed = (file, files) => add('update-feed', file, yaml.dump({ version,
    releaseDate: record.payload_date, files: files.map(name => ({
      url: `https://local.hyperclay.com/releases/${version}/${name}`,
      size: bytes(name).length, sha512: crypto.createHash('sha512').update(bytes(name)).digest('base64')
    })) }));
  feed('latest-mac.yml', zips); feed('latest.yml', [names[2]]);
  if (linuxUpdates) { feed('latest-linux.yml', [names[3]]); feed('latest-linux-arm64.yml', [names[4]]); }
  const ports = {
    download: jest.fn(async (bucket, key) => {
      expect(bucket).toBe('hyperclay-candidates');
      if (!objects.has(key)) throw new Error('NoSuchKey');
      return objects.get(key);
    }),
    immutable: jest.fn(async (key, body) => {
      await putImmutable({ bucket: 'public', key, body, client: {
        send: async command => {
          if (command.constructor.name === 'HeadObjectCommand') {
            if (!publicObjects.has(key)) throw Object.assign(new Error('missing'), { name: 'NotFound' });
            return { Metadata: { sha512: crypto.createHash('sha512').update(publicObjects.get(key)).digest('hex') } };
          }
          expect(command.constructor.name).toBe('PutObjectCommand');
          publicObjects.set(key, Buffer.from(command.input.Body));
          uploads.push(key);
        }
      } });
    }),
    put: jest.fn(async (key, body) => { publicObjects.set(key, Buffer.from(body)); uploads.push(key); })
  };
  return { record, objects, publicObjects, ports, uploads, add };
}

let commandSpies;
beforeEach(() => {
  commandSpies = ['execFileSync', 'execSync', 'execFile', 'exec', 'spawnSync', 'spawn'].map(method =>
    jest.spyOn(childProcess, method).mockImplementation(command => {
      throw new Error(`Forbidden promotion command: ${command}`);
    }));
});
afterEach(() => {
  const commands = commandSpies.flatMap(spy => spy.mock.calls);
  commandSpies.forEach(spy => spy.mockRestore());
  expect(commands).toEqual([]);
});

test('publishes the retained bytes only, with immutable files before pointers and recorded sizes', async () => {
  const f = fixture();
  const info = await promoteCandidate(f.record, expected, f.ports);
  expect(f.ports.download).toHaveBeenCalledTimes(f.record.files.length);
  for (const [key, body] of f.publicObjects) {
    if (key === 'release-info.json') continue;
    const artifact = f.record.files.find(a => a.key.endsWith(`/${path.posix.basename(key)}`));
    expect(body).toEqual(f.objects.get(artifact.key));
  }
  expect([...f.publicObjects.keys()].some(key => /diagnostic|policy.json|blockmap/.test(key))).toBe(false);
  expect(info.files).toEqual(expectedInstallerNames(version));
  expect(info.date).toBe(f.record.payload_date);
  expect(f.uploads.at(-1)).toBe('release-info.json');
  expect(f.ports.immutable.mock.calls.length).toBeGreaterThan(5);
  const firstPointer = f.uploads.findIndex(key => key.startsWith('updates/stable/'));
  expect(f.uploads.slice(firstPointer).every(key => !key.startsWith('releases/'))).toBe(true);
});

test.each(['build-linux-arm64', 'build-macos', 'update-feed', 'linux-update-signing'])('missing %s blocks before writes', async group => {
  const f = fixture();
  f.record.files = f.record.files.filter(a => a.group !== group);
  await expect(promoteCandidate(f.record, expected, f.ports)).rejects.toThrow('requalify');
  expect(f.uploads).toEqual([]);
});

test.each(['missing', 'digest', 'size'])('expired or corrupt object (%s) refuses with requalify', async mode => {
  const f = fixture();
  const artifact = f.record.files.at(-1);
  if (mode === 'missing') f.objects.delete(artifact.key);
  if (mode === 'digest') f.objects.set(artifact.key, Buffer.alloc(artifact.size));
  if (mode === 'size') artifact.size += 1;
  await expect(promoteCandidate(f.record, expected, f.ports)).rejects.toThrow('candidate expired or incomplete: requalify');
  expect(f.uploads).toEqual([]);
});

test('an interrupted immutable upload resumes with the same bytes and version', async () => {
  const f = fixture();
  const upload = f.ports.immutable.getMockImplementation();
  let count = 0;
  f.ports.immutable.mockImplementation(async (...args) => {
    count += 1;
    if (count === 4) throw new Error('connection interrupted');
    return upload(...args);
  });
  await expect(promoteCandidate(f.record, expected, f.ports)).rejects.toThrow('connection interrupted');
  expect(f.ports.put).not.toHaveBeenCalled();
  const info = await promoteCandidate(f.record, expected, f.ports);
  expect(info.version).toBe(version);
  expect(f.publicObjects.get('release-info.json')).toEqual(Buffer.from(JSON.stringify(info, null, 2)));
});

test.each([{ ...expected, version: '1.30.0' }, { ...expected, releaseSha: 'd'.repeat(40) }])('version or release SHA mismatch refuses', async identity => {
  const f = fixture();
  await expect(promoteCandidate(f.record, identity, f.ports)).rejects.toThrow('mismatch');
  expect(f.ports.download).not.toHaveBeenCalled();
  expect(f.uploads).toEqual([]);
});

test('retained Linux omission policy omits Linux feeds and signatures explicitly', async () => {
  const f = fixture(false);
  await promoteCandidate(f.record, expected, f.ports);
  expect([...f.publicObjects.keys()].some(key => /latest-linux|\.sig$/.test(key))).toBe(false);
  expect(f.publicObjects.has(`HyperclayLocal-${version}-arm64.AppImage`)).toBe(true);
});

test('Linux policy cannot silently omit an architecture signature', async () => {
  const f = fixture();
  f.record.files = f.record.files.filter(a => !a.key.endsWith('-arm64.AppImage.sig'));
  await expect(promoteCandidate(f.record, expected, f.ports)).rejects.toThrow('requalify');
  expect(f.uploads).toEqual([]);
});

test.each(['bucket', 'key', 'attempt', 'candidate', 'duplicate'])('invalid storage identity (%s) refuses', async mode => {
  const f = fixture();
  if (mode === 'bucket') f.record.bucket = 'public';
  if (mode === 'key') f.record.files[0].key += '/../file';
  if (mode === 'attempt') f.record.files[0].key = f.record.files[0].key.replace('attempt-1', 'attempt-2');
  if (mode === 'candidate') f.record.candidate_sha256 = 'd'.repeat(64);
  if (mode === 'duplicate') f.record.files.push(f.record.files[0]);
  expect(() => validatePromotionRecord(f.record, expected)).toThrow();
});

test('workflow promotion skips build dependencies and downloads no workflow diagnostic files', () => {
  const workflow = yaml.load(fs.readFileSync(path.join(__dirname, '../../.github/workflows/release.yml'), 'utf8'));
  for (const name of ['test-macos', 'test-windows', 'test-linux', 'license']) {
    expect(workflow.jobs[name].if).toBe("${{ inputs.promotion_record == '' }}");
  }
  const steps = workflow.jobs.upload.steps;
  const promote = steps.find(step => step.name === 'Promote qualified candidate without rebuilding');
  expect(promote.run).toBe('node scripts/release-candidate-promote.js');
  for (const step of steps.filter(step => step.uses?.startsWith('actions/download-artifact') || step.run === 'node build-scripts/post-build.js')) {
    expect(step.if).toBe("${{ inputs.promotion_record == '' }}");
  }
  expect(workflow.jobs.upload.if).toContain("inputs.promotion_record != ''");
});

test('existing immutable bytes must agree before any public pointer changes', async () => {
  const f = fixture();
  f.publicObjects.set(`releases/${version}/${expectedInstallerNames(version)[0]}`, Buffer.from('different signed bytes'));
  await expect(promoteCandidate(f.record, expected, f.ports)).rejects.toThrow('already exists');
  expect(f.ports.put).not.toHaveBeenCalled();
});

test('a retained mac feed cannot omit an architecture even when every installer exists', async () => {
  const f = fixture();
  const artifact = f.record.files.find(a => a.key.endsWith('/latest-mac.yml'));
  const feed = yaml.load(f.objects.get(artifact.key).toString('utf8'));
  feed.files.pop();
  const body = Buffer.from(yaml.dump(feed));
  f.objects.set(artifact.key, body);
  artifact.size = body.length;
  artifact.sha256 = sha256(body);
  await expect(promoteCandidate(f.record, expected, f.ports)).rejects.toThrow('architecture mismatch: requalify');
  expect(f.uploads).toEqual([]);
});


test('dirty checkout refuses before downloads', async () => {
  const f = fixture();
  await expect(promoteCandidate(f.record, { ...expected, clean: false }, f.ports)).rejects.toThrow('clean tree');
  expect(f.ports.download).not.toHaveBeenCalled();
});

test.each(['2026-11-01T12:00:00Z', '2026-11-01T12:00:00+00:00'])('UTC ISO date %s normalizes without changing retained bytes', async date => {
  const f = fixture();
  f.record.payload_date = date;
  const info = await promoteCandidate(f.record, expected, f.ports);
  expect(info.date).toBe('2026-11-01T12:00:00.000Z');
  expect(info.commit).toBe(releaseSha);
});

test.each(['identity', 'duplicate'])('schema 2 refuses %s rows', mode => {
  const f = fixture();
  if (mode === 'identity') f.add('identity', 'identity.json', '{}');
  else f.record.files.push({ ...f.record.files[0] });
  expect(() => validatePromotionRecord(f.record)).toThrow();
});

test.each(['2026-11-01', '2026-11-01T12:00:00-05:00', 'not-a-date'])('invalid or non-UTC date %s refuses', date => {
  const f = fixture();
  f.record.payload_date = date;
  expect(() => validatePromotionRecord(f.record)).toThrow('payload date');
});

test('offline check validates the schema 2 file without commands or writes', async () => {
  const f = fixture();
  f.record.payload_date = '2026-11-01T12:00:00Z';
  const read = jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(f.record));
  const write = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => { throw new Error('Unexpected write'); });
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await main(['--check', '/fixture/promotion.json']);
    expect(read).toHaveBeenCalledWith('/fixture/promotion.json', 'utf8');
    expect(write).not.toHaveBeenCalled();
    f.record.files = f.record.files.filter(file => file.name !== `HyperclayLocal-${version}-mac.zip`);
    read.mockReturnValue(JSON.stringify(f.record));
    await expect(main(['--check', '/fixture/promotion.json'])).rejects.toThrow('requalify');
  } finally { read.mockRestore(); write.mockRestore(); log.mockRestore(); }
});
