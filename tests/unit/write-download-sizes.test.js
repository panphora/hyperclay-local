'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { renderDownloadSizes } = require('../../scripts/write-download-sizes');

const REPO = path.resolve(__dirname, '..', '..');
const FAILURE_CODE = 'PUBLICATION_EVIDENCE_INVALID';
const VERSION = '9.9.9';
const SOURCE_SHA = '3f9c1d7a4b2e5f8091a2b3c4d5e6f708192a3b4c';
const DATE = '2026-01-02T03:04:05.678Z';

const NAMES = [
  `HyperclayLocal-${VERSION}-arm64.dmg`,
  `HyperclayLocal-${VERSION}.dmg`,
  `HyperclayLocal-Setup-${VERSION}.exe`,
  `HyperclayLocal-${VERSION}.AppImage`,
  `HyperclayLocal-${VERSION}-arm64.AppImage`,
];

const SIZES = {};
SIZES[NAMES[0]] = 108000000;
SIZES[NAMES[1]] = 115000000;
SIZES[NAMES[2]] = 95000000;
SIZES[NAMES[3]] = 130000000;
SIZES[NAMES[4]] = 129500000;

const MB_BEFORE = ['102.3', '108.8', '90.1', '123.7', '123.4'];
const MB_AFTER = ['103.0', '109.7', '90.6', '124.0', '123.5'];

const README_LABELS = [
  'macOS (Apple Silicon)', 'macOS (Intel)', 'Windows', 'Linux (x86_64)', 'Linux (ARM64)'
];
const WEBSITE_OS = ['mac-arm', 'mac-intel', 'windows', 'linux', 'linux-arm'];

function readmeFixture(mb, options = {}) {
  const skip = options.skip || [];
  const lines = [`# HyperclayLocal ${VERSION}`, '', 'Download the app for your platform:', ''];
  for (let index = 0; index < NAMES.length; index += 1) {
    if (skip.includes(NAMES[index])) continue;
    lines.push(
      `   - **${README_LABELS[index]}**: [${NAMES[index]}](https://local.hyperclay.com/${NAMES[index]}) (${mb[index]}MB)`
    );
  }
  lines.push('', 'Install and run the app.', '');
  return lines.join('\n');
}

function websiteFixture(mb, options = {}) {
  const skip = options.skip || [];
  const lines = [
    `<section class="section" id="downloads" data-version="${VERSION}">`,
    '  <ul class="dl-list">',
  ];
  for (let index = 0; index < NAMES.length; index += 1) {
    if (skip.includes(NAMES[index])) continue;
    lines.push(
      `    <li class="dl-row" data-os="${WEBSITE_OS[index]}">`,
      `      <a class="dl-file" download href="https://local.hyperclay.com/${NAMES[index]}">${NAMES[index]}</a>`,
      `      <span class="dl-size">${mb[index]} MB</span>`,
      '    </li>'
    );
  }
  lines.push('  </ul>', '</section>', '');
  return lines.join('\n');
}

const README_BEFORE = readmeFixture(MB_BEFORE);
const README_AFTER = readmeFixture(MB_AFTER);
const WEBSITE_BEFORE = websiteFixture(MB_BEFORE);
const WEBSITE_AFTER = websiteFixture(MB_AFTER);

function sizesFor(names) {
  const sizes = {};
  for (const name of names) sizes[name] = SIZES[name];
  return sizes;
}

function manifest(overrides = {}) {
  return Object.assign({
    version: VERSION,
    commit: SOURCE_SHA,
    date: DATE,
    files: NAMES.slice(),
    sizes: sizesFor(NAMES),
  }, overrides);
}

function render(input = {}, expected = {}) {
  return renderDownloadSizes(
    Object.assign({
      readme: README_BEFORE,
      website: WEBSITE_BEFORE,
      manifest: manifest(),
    }, input),
    Object.assign({ version: VERSION, sourceSha: SOURCE_SHA }, expected)
  );
}

function captureThrow(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

const SENTINEL_SOURCE = `'use strict';

const fs = require('fs');
const childProcess = require('child_process');

const record = process.env.HC_SIZE_WRITE_RECORD;
const writeFileSync = fs.writeFileSync;
const openSync = fs.openSync;
const writeFile = fs.writeFile;
const createWriteStream = fs.createWriteStream;

function note(line) {
  writeFileSync(record, line + '\\n', { flag: 'a' });
}

fs.writeFileSync = function (target, ...rest) {
  note('writeFileSync ' + target);
  return writeFileSync.call(fs, target, ...rest);
};
fs.openSync = function (target, flags, ...rest) {
  if (typeof flags === 'string' && flags.indexOf('w') !== -1) note('openSync ' + target);
  return openSync.call(fs, target, flags, ...rest);
};
fs.writeFile = function (target, ...rest) {
  note('writeFile ' + target);
  return writeFile.call(fs, target, ...rest);
};
fs.createWriteStream = function (target, ...rest) {
  note('createWriteStream ' + target);
  return createWriteStream.call(fs, target, ...rest);
};

for (const name of ['spawn', 'spawnSync', 'exec', 'execSync']) {
  const original = childProcess[name];
  childProcess[name] = function (...args) {
    note(name + ' ' + String(args[0]));
    return original.apply(childProcess, args);
  };
}

global.fetch = function (url) {
  note('fetch ' + url);
  throw new Error('network access is not allowed in this fixture');
};
`;

const ownedDirs = new Set();

function tempDir(label) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `hc-sizes-${label}-`)));
  ownedDirs.add(dir);
  return dir;
}

afterAll(() => {
  for (const dir of ownedDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function fixtureTree(label, options = {}) {
  const dir = tempDir(label);
  fs.cpSync(path.join(REPO, 'scripts'), path.join(dir, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'website'));
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({ version: VERSION }, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'README.md'), options.readme || README_BEFORE);
  fs.writeFileSync(path.join(dir, 'website', 'index.html'), options.website || WEBSITE_BEFORE);
  fs.writeFileSync(
    path.join(dir, 'release-info.json'),
    `${JSON.stringify(options.manifest || manifest(), null, 2)}\n`
  );
  fs.writeFileSync(path.join(dir, 'sentinel.cjs'), SENTINEL_SOURCE);
  fs.writeFileSync(path.join(dir, 'writes.log'), '');
  return dir;
}

function runCli(dir) {
  const env = Object.assign({}, process.env, {
    HC_SIZE_WRITE_RECORD: path.join(dir, 'writes.log'),
  });
  delete env.NODE_OPTIONS;
  return childProcess.spawnSync(
    process.execPath,
    [
      '--require', path.join(dir, 'sentinel.cjs'),
      path.join('scripts', 'write-download-sizes.js'),
      'release-info.json',
    ],
    { cwd: dir, env, encoding: 'utf8' }
  );
}

function readFixtureFile(dir, relative) {
  return fs.readFileSync(path.join(dir, relative), 'utf8');
}

function writes(dir) {
  return readFixtureFile(dir, 'writes.log');
}

describe('renderDownloadSizes', () => {
  it('imports without reading, writing, fetching, spawning or logging', () => {
    const records = { reads: [], writes: [], spawns: [], fetches: [], logs: [], clocks: [] };
    const originals = {
      readFileSync: fs.readFileSync,
      writeFileSync: fs.writeFileSync,
      appendFileSync: fs.appendFileSync,
      openSync: fs.openSync,
      writeFile: fs.writeFile,
      createWriteStream: fs.createWriteStream,
      spawn: childProcess.spawn,
      spawnSync: childProcess.spawnSync,
      exec: childProcess.exec,
      execSync: childProcess.execSync,
      log: console.log,
      error: console.error,
      now: Date.now,
      fetch: global.fetch,
    };
    let exported;
    try {
      fs.readFileSync = (...args) => { records.reads.push(String(args[0])); return originals.readFileSync(...args); };
      fs.writeFileSync = (...args) => { records.writes.push(String(args[0])); return originals.writeFileSync(...args); };
      fs.appendFileSync = (...args) => { records.writes.push(String(args[0])); return originals.appendFileSync(...args); };
      fs.openSync = (...args) => { records.writes.push(String(args[0])); return originals.openSync(...args); };
      fs.writeFile = (...args) => { records.writes.push(String(args[0])); return originals.writeFile(...args); };
      fs.createWriteStream = (...args) => { records.writes.push(String(args[0])); return originals.createWriteStream(...args); };
      childProcess.spawn = (...args) => { records.spawns.push(String(args[0])); return originals.spawn(...args); };
      childProcess.spawnSync = (...args) => { records.spawns.push(String(args[0])); return originals.spawnSync(...args); };
      childProcess.exec = (...args) => { records.spawns.push(String(args[0])); return originals.exec(...args); };
      childProcess.execSync = (...args) => { records.spawns.push(String(args[0])); return originals.execSync(...args); };
      console.log = (...args) => { records.logs.push(args.join(' ')); };
      console.error = (...args) => { records.logs.push(args.join(' ')); };
      Date.now = () => { records.clocks.push('now'); return originals.now(); };
      global.fetch = (url) => { records.fetches.push(String(url)); throw new Error('import touched the network'); };
      jest.isolateModules(() => {
        exported = require('../../scripts/write-download-sizes');
      });
    } finally {
      fs.readFileSync = originals.readFileSync;
      fs.writeFileSync = originals.writeFileSync;
      fs.appendFileSync = originals.appendFileSync;
      fs.openSync = originals.openSync;
      fs.writeFile = originals.writeFile;
      fs.createWriteStream = originals.createWriteStream;
      childProcess.spawn = originals.spawn;
      childProcess.spawnSync = originals.spawnSync;
      childProcess.exec = originals.exec;
      childProcess.execSync = originals.execSync;
      console.log = originals.log;
      console.error = originals.error;
      Date.now = originals.now;
      global.fetch = originals.fetch;
    }

    expect(records).toEqual({ reads: [], writes: [], spawns: [], fetches: [], logs: [], clocks: [] });
    expect(Object.keys(exported)).toEqual(['renderDownloadSizes']);
    expect(typeof exported.renderDownloadSizes).toBe('function');
  });

  it('renders all five distinct installer sizes into both files', () => {
    const rendered = render();

    expect(rendered.readme).toBe(README_AFTER);
    expect(rendered.website).toBe(WEBSITE_AFTER);
    expect(new Set(MB_AFTER).size).toBe(5);
    for (const mb of MB_AFTER) {
      expect(rendered.readme).toContain(`(${mb}MB)`);
      expect(rendered.website).toContain(`>${mb} MB<`);
    }
  });

  it('formats each byte count with the current one-decimal MB arithmetic', () => {
    const rendered = render();

    for (let index = 0; index < NAMES.length; index += 1) {
      const mb = (SIZES[NAMES[index]] / (1024 * 1024)).toFixed(1);
      expect(mb).toBe(MB_AFTER[index]);
      expect(rendered.readme).toContain(`(${mb}MB)`);
      expect(rendered.website).toContain(`>${mb} MB<`);
    }
    expect((SIZES[NAMES[0]] / (1024 * 1024)).toFixed(1)).toBe('103.0');
    expect((SIZES[NAMES[1]] / (1024 * 1024)).toFixed(1)).toBe('109.7');
    expect((SIZES[NAMES[2]] / (1024 * 1024)).toFixed(1)).toBe('90.6');
    expect((SIZES[NAMES[3]] / (1024 * 1024)).toFixed(1)).toBe('124.0');
    expect((SIZES[NAMES[4]] / (1024 * 1024)).toFixed(1)).toBe('123.5');
  });

  it('preserves unrelated surrounding text in both files', () => {
    const rendered = render();

    expect(rendered.readme).toContain('# HyperclayLocal 9.9.9');
    expect(rendered.readme).toContain('Install and run the app.');
    expect(rendered.readme).toContain(
      `[${NAMES[0]}](https://local.hyperclay.com/${NAMES[0]}) (103.0MB)`
    );
    expect(rendered.readme).toContain(`   - **Windows**: [${NAMES[2]}](https://local.hyperclay.com/${NAMES[2]}) (90.6MB)`);
    expect(rendered.website).toContain(`<section class="section" id="downloads" data-version="9.9.9">`);
    expect(rendered.website).toContain(
      `      <a class="dl-file" download href="https://local.hyperclay.com/${NAMES[3]}">${NAMES[3]}</a>\n      <span class="dl-size">124.0 MB</span>`
    );
    expect(rendered.website).toContain('  </ul>\n</section>');
  });

  it('replaces every occurrence of a repeated anchor', () => {
    const repeatedReadme = [readmeFixture(MB_BEFORE), readmeFixture(MB_BEFORE)].join('\n');
    const repeatedWebsite = [websiteFixture(MB_BEFORE), websiteFixture(MB_BEFORE)].join('\n');

    const rendered = render({ readme: repeatedReadme, website: repeatedWebsite });

    expect(rendered.readme).toBe([readmeFixture(MB_AFTER), readmeFixture(MB_AFTER)].join('\n'));
    expect(rendered.website).toBe([websiteFixture(MB_AFTER), websiteFixture(MB_AFTER)].join('\n'));
    expect(rendered.readme.split(`(${MB_AFTER[0]}MB)`).length - 1).toBe(2);
    expect(rendered.website.split(`>${MB_AFTER[1]} MB<`).length - 1).toBe(2);
  });

  it('is idempotent when rendered again from its own output', () => {
    const once = render();
    const twice = render({ readme: once.readme, website: once.website });

    expect(twice.readme).toBe(once.readme);
    expect(twice.website).toBe(once.website);
    expect(twice.readme).toBe(README_AFTER);
    expect(twice.website).toBe(WEBSITE_AFTER);
  });

  it('throws for a missing README anchor and leaves the inputs unchanged', () => {
    const input = {
      readme: readmeFixture(MB_BEFORE, { skip: [NAMES[3]] }),
      website: WEBSITE_BEFORE,
      manifest: manifest(),
    };
    const snapshot = JSON.parse(JSON.stringify(input));

    const error = captureThrow(() => renderDownloadSizes(input, { version: VERSION, sourceSha: SOURCE_SHA }));

    expect(error.message).toBe(`README.md has no size to update for ${NAMES[3]}`);
    expect(error.code).toBeUndefined();
    expect(input).toEqual(snapshot);
    expect(input.readme).not.toContain(MB_AFTER[3]);
  });

  it('throws for a missing website anchor with otherwise valid README input', () => {
    const input = {
      readme: README_BEFORE,
      website: websiteFixture(MB_BEFORE, { skip: [NAMES[2]] }),
      manifest: manifest(),
    };
    const snapshot = JSON.parse(JSON.stringify(input));

    const error = captureThrow(() => renderDownloadSizes(input, { version: VERSION, sourceSha: SOURCE_SHA }));

    expect(error.message).toBe(`website/index.html has no size to update for ${NAMES[2]}`);
    expect(input).toEqual(snapshot);
    expect(input.readme).toBe(README_BEFORE);
    expect(input.website).toBe(snapshot.website);
  });

  it('refuses non-string inputs before validating the manifest', () => {
    const error = captureThrow(() => renderDownloadSizes(
      { readme: null, website: WEBSITE_BEFORE, manifest: manifest() },
      { version: VERSION, sourceSha: SOURCE_SHA }
    ));

    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toBe('Download size inputs must be strings');
  });

  it('refuses malformed manifests through the shared validator', () => {
    const cases = [
      ['missing a size', () => {
        const info = manifest();
        delete info.sizes[NAMES[2]];
        return info;
      }],
      ['an extra size', () => {
        const info = manifest();
        info.sizes['HyperclayLocal-9.9.9-extra.dmg'] = 108000000;
        return info;
      }],
      ['a zero byte count', () => {
        const info = manifest();
        info.sizes[NAMES[0]] = 0;
        return info;
      }],
      ['a fractional byte count', () => {
        const info = manifest();
        info.sizes[NAMES[0]] = 108000000.5;
        return info;
      }],
      ['four files', () => {
        const info = manifest();
        info.files = NAMES.slice(0, 4);
        return info;
      }],
      ['a repeated file', () => {
        const info = manifest();
        info.files = [NAMES[0], NAMES[0], NAMES[2], NAMES[3], NAMES[4]];
        return info;
      }],
      ['an unknown file', () => {
        const info = manifest();
        info.files = [NAMES[0], NAMES[1], NAMES[2], NAMES[3], 'HyperclayLocal-9.9.9-other.dmg'];
        return info;
      }],
      ['a different version', () => manifest({ version: '9.9.8' })],
      ['a different commit', () => manifest({ commit: 'a'.repeat(40) })],
      ['a non-canonical date', () => manifest({ date: '2026-01-02' })],
      ['an extra top-level field', () => manifest({ provenance: 'workflow' })],
      ['a missing top-level field', () => {
        const info = manifest();
        delete info.date;
        return info;
      }],
      ['a non-record manifest', () => null],
    ];

    for (const [label, build] of cases) {
      const input = { readme: README_BEFORE, website: WEBSITE_BEFORE, manifest: build() };
      const error = captureThrow(() => renderDownloadSizes(input, { version: VERSION, sourceSha: SOURCE_SHA }));
      expect({ label, code: error.code }).toEqual({ label, code: FAILURE_CODE });
      expect(input.readme).toBe(README_BEFORE);
      expect(input.website).toBe(WEBSITE_BEFORE);
    }
  });

  it('refuses a manifest whose commit does not match the supplied source', () => {
    const error = captureThrow(() => renderDownloadSizes(
      { readme: README_BEFORE, website: WEBSITE_BEFORE, manifest: manifest() },
      { version: VERSION, sourceSha: 'b'.repeat(40) }
    ));

    expect(error.code).toBe(FAILURE_CODE);
  });
});

describe('legacy CLI on a disposable fixture tree', () => {
  it('writes nothing when the second file is missing an anchor', () => {
    const dir = fixtureTree('missing-website', {
      website: websiteFixture(MB_BEFORE, { skip: [NAMES[2]] }),
    });

    const result = runCli(dir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`website/index.html has no size to update for ${NAMES[2]}`);
    expect(readFixtureFile(dir, 'README.md')).toBe(README_BEFORE);
    expect(readFixtureFile(dir, 'website/index.html')).toBe(websiteFixture(MB_BEFORE, { skip: [NAMES[2]] }));
    expect(writes(dir)).toBe('');
  });

  it('writes both files when both anchors are present', () => {
    const dir = fixtureTree('both-anchors');

    const result = runCli(dir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`  README.md updated for v${VERSION}`);
    expect(result.stdout).toContain(`  website/index.html updated for v${VERSION}`);
    expect(readFixtureFile(dir, 'README.md')).toBe(README_AFTER);
    expect(readFixtureFile(dir, 'website/index.html')).toBe(WEBSITE_AFTER);
    expect(writes(dir)).toBe(
      `writeFileSync ${path.join(dir, 'README.md')}\n` +
      `writeFileSync ${path.join(dir, 'website', 'index.html')}\n`
    );
  });

  it('refuses a manifest for another version without writing', () => {
    const dir = fixtureTree('version-mismatch', { manifest: manifest({ version: '9.9.8' }) });

    const result = runCli(dir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`Published release is 9.9.8 but this tree is ${VERSION}.`);
    expect(readFixtureFile(dir, 'README.md')).toBe(README_BEFORE);
    expect(readFixtureFile(dir, 'website/index.html')).toBe(WEBSITE_BEFORE);
    expect(writes(dir)).toBe('');
  });
});
