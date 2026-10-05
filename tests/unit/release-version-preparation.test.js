'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { renderReleaseVersion } = require('../../scripts/release-version-render');

const OLD = '1.28.0';
const NEW = '1.29.0';
const RENDERER_PATH = path.join(__dirname, '..', '..', 'scripts', 'release-version-render.js');

const PKG_BEFORE = `{
  "name": "hyperclay-local-electron",
  "productName": "HyperclayLocal",
  "version": "${OLD}",
  "description": "Hyperclay Local Server - Desktop App",
  "build": {
    "artifactName": "HyperclayLocal-Setup-\${version}.\${ext}"
  },
  "hyper": {
    "status": "active"
  }
}
`;

const README_FORMS = [
  `HyperclayLocal-Setup-${OLD}.exe`,
  `HyperclayLocal-${OLD}-arm64.dmg`,
  `HyperclayLocal-${OLD}.dmg`,
  `HyperclayLocal-${OLD}.AppImage`,
  `HyperclayLocal-${OLD}-arm64.AppImage`,
];

const README_BEFORE = [
  '# Hyperclay Local',
  '',
  '## Download',
  '',
  ...README_FORMS.map(form => `- [${form}](https://local.hyperclay.com/${form})`),
  '',
].join('\n');

const WEBSITE_BEFORE = [
  '<!DOCTYPE html>',
  '<html>',
  '  <body>',
  '    <section class="section" id="downloads" data-version="1.20.1">',
  `      <a class="dl-file" href="https://local.hyperclay.com/HyperclayLocal-1.20.1-arm64.dmg">HyperclayLocal-1.20.1-arm64.dmg</a>`,
  `      <a class="dl-file" href="https://local.hyperclay.com/HyperclayLocal-1.20.1.dmg">HyperclayLocal-1.20.1.dmg</a>`,
  `      <a class="dl-file" href="https://local.hyperclay.com/HyperclayLocal-Setup-1.20.1.exe">HyperclayLocal-Setup-1.20.1.exe</a>`,
  `      <a class="dl-file" href="https://local.hyperclay.com/HyperclayLocal-1.20.1.AppImage">HyperclayLocal-1.20.1.AppImage</a>`,
  `      <a class="dl-file" href="https://local.hyperclay.com/HyperclayLocal-1.20.1-arm64.AppImage">HyperclayLocal-1.20.1-arm64.AppImage</a>`,
  '    </section>',
  '    <svg viewBox="0 0 100 100">',
  '      <path d="M1.02.08L2.33.66L3.44.77z"/>',
  '      <text x="1">1.02.08</text>',
  '    </svg>',
  '  </body>',
  '</html>',
  '',
].join('\n');

function input(overrides) {
  return Object.assign(
    { packageJson: PKG_BEFORE, readme: README_BEFORE, website: WEBSITE_BEFORE },
    overrides
  );
}

function options(overrides) {
  return Object.assign({ previousVersion: OLD, version: NEW }, overrides);
}

function render(overrides, optionOverrides) {
  return renderReleaseVersion(input(overrides), options(optionOverrides));
}

function expectInvalid(run) {
  let error = null;
  try {
    run();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(Error);
  expect(error.code).toBe('RELEASE_VERSION_INVALID');
  return error;
}

const SENTINEL_SOURCE = `'use strict';

const fs = require('fs');
const childProcess = require('child_process');

const record = [];
const note = (name, target) => record.push(target === undefined ? name : name + ':' + target);

const FS_METHODS = [
  'readFileSync', 'readFile', 'writeFileSync', 'writeFile', 'appendFileSync', 'appendFile',
  'openSync', 'open', 'createReadStream', 'createWriteStream', 'mkdirSync', 'readdirSync',
  'existsSync', 'statSync', 'rmSync'
];
for (const name of FS_METHODS) {
  const original = fs[name];
  if (typeof original !== 'function') continue;
  fs[name] = function (...args) {
    note('fs.' + name, typeof args[0] === 'string' ? args[0] : undefined);
    return original.apply(this, args);
  };
}

const COMMAND_METHODS = ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork'];
for (const name of COMMAND_METHODS) {
  const original = childProcess[name];
  if (typeof original !== 'function') continue;
  childProcess[name] = function (...args) {
    note('child_process.' + name);
    return original.apply(this, args);
  };
}

const { renderReleaseVersion } = require(process.argv[2]);
const rendered = renderReleaseVersion(
  {
    packageJson: JSON.stringify({ version: '1.28.0' }),
    readme: 'HyperclayLocal-1.28.0.dmg',
    website: 'data-version="1.28.0"'
  },
  { previousVersion: '1.28.0', version: '1.29.0' }
);
if (rendered.packageJson.indexOf('"version": "1.29.0"') < 0) note('unexpected-result');
process.stdout.write(JSON.stringify(record));
`;

describe('desktop version renderer', () => {
  const owner = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'hc-release-version-render-'));
  const sentinelPath = path.join(owner, 'sentinel.cjs');

  beforeAll(() => {
    fs.writeFileSync(sentinelPath, SENTINEL_SOURCE);
  });

  afterAll(() => {
    fs.rmSync(owner, { recursive: true, force: true });
  });

  test('rewrites package.json with exact formatting, final newline and unrelated fields', () => {
    const result = render();
    const expected = JSON.parse(PKG_BEFORE);
    expected.version = NEW;
    expect(result.packageJson).toBe(JSON.stringify(expected, null, 2) + '\n');
    expect(result.packageJson.endsWith('\n')).toBe(true);
    expect(result.packageJson).toContain('"description": "Hyperclay Local Server - Desktop App"');
    expect(result.packageJson).toContain('"artifactName": "HyperclayLocal-Setup-${version}.${ext}"');
    expect(result.packageJson).toContain('"status": "active"');
    expect(result.packageJson).not.toContain(`"version": "${OLD}"`);
  });

  test('rewrites all five installer filename forms in the README', () => {
    const result = render();
    for (const form of README_FORMS) {
      expect(result.readme).toContain(form.replace(OLD, NEW));
      expect(result.readme).not.toContain(form);
    }
  });

  test('rewrites stale differing versions in README and website', () => {
    const result = render({
      readme: 'HyperclayLocal-1.20.1.dmg and HyperclayLocal-Setup-1.19.7.exe',
      website: 'HyperclayLocal-1.20.1.AppImage',
    });
    expect(result.readme).toBe(`HyperclayLocal-${NEW}.dmg and HyperclayLocal-Setup-${NEW}.exe`);
    expect(result.website).toBe(`HyperclayLocal-${NEW}.AppImage`);
  });

  test('rewrites data-version attributes', () => {
    const result = render({ website: '<section id="downloads" data-version="1.20.1"></section>' });
    expect(result.website).toBe(`<section id="downloads" data-version="${NEW}"></section>`);
  });

  test('leaves SVG numeric text untouched', () => {
    const result = render();
    expect(result.website).toContain('<path d="M1.02.08L2.33.66L3.44.77z"/>');
    expect(result.website).toContain('<text x="1">1.02.08</text>');
  });

  test('replaces every repeated anchor', () => {
    const result = render({
      readme: `HyperclayLocal-${OLD}.dmg ${OLD} HyperclayLocal-${OLD}.dmg`,
      website: `data-version="${OLD}" data-version="${OLD}"`,
    });
    expect(result.readme).toBe(`HyperclayLocal-${NEW}.dmg ${OLD} HyperclayLocal-${NEW}.dmg`);
    expect(result.website).toBe(`data-version="${NEW}" data-version="${NEW}"`);
  });

  test('leaves text with no matching anchor unchanged', () => {
    const readme = 'Download the app from the website.';
    const website = '<svg><path d="M1.02.08"/></svg>';
    const result = render({ readme, website });
    expect(result.readme).toBe(readme);
    expect(result.website).toBe(website);
  });

  test('leaves the caller input and options objects unchanged', () => {
    const inputObject = input();
    const optionsObject = options();
    const before = { ...inputObject, ...optionsObject };
    const result = renderReleaseVersion(inputObject, optionsObject);
    expect(inputObject).toEqual({
      packageJson: before.packageJson,
      readme: before.readme,
      website: before.website,
    });
    expect(optionsObject).toEqual({ previousVersion: OLD, version: NEW });
    expect(result.packageJson).not.toBe(inputObject.packageJson);
  });

  test('accepts major, minor and patch increases', () => {
    expect(render({}, { version: '2.0.0' }).packageJson).toContain('"version": "2.0.0"');
    expect(render({}, { version: '1.29.0' }).packageJson).toContain('"version": "1.29.0"');
    expect(render({}, { version: '1.28.1' }).packageJson).toContain('"version": "1.28.1"');
  });

  test('refuses equal, lower, invalid and oversized versions', () => {
    expectInvalid(() => render({}, { version: OLD }));
    expectInvalid(() => render({}, { version: '1.27.9' }));
    expectInvalid(() => render({}, { version: '2.0' }));
    expectInvalid(() => render({}, { version: 'v1.29.0' }));
    expectInvalid(() => render({}, { version: '1.29.0-beta' }));
    expectInvalid(() => render({}, { version: '01.29.0' }));
    expectInvalid(() => render({}, { version: '1.29.65536' }));
    expectInvalid(() => render({}, { previousVersion: '1.28' }));
    expectInvalid(() => render({}, { previousVersion: '1.28.65536' }));
  });

  test('refuses a package.json that does not match the previous version', () => {
    expectInvalid(() => render({ packageJson: PKG_BEFORE.replace(OLD, '1.27.0') }));
  });

  test('refuses JSON primitives, arrays, null and malformed JSON', () => {
    expectInvalid(() => render({ packageJson: '123' }));
    expectInvalid(() => render({ packageJson: '"text"' }));
    expectInvalid(() => render({ packageJson: '[]' }));
    expectInvalid(() => render({ packageJson: 'null' }));
    expectInvalid(() => render({ packageJson: '{' }));
  });

  test('refuses input that is not three text files', () => {
    expectInvalid(() => render({ readme: null }));
    expectInvalid(() => render({ website: undefined }));
    expectInvalid(() => renderReleaseVersion(null, options()));
  });

  test('import and render touch no filesystem or command surface', () => {
    const env = { ...process.env, HC_VERSION_RENDER_SENTINEL: '1' };
    delete env.NODE_OPTIONS;
    const result = childProcess.spawnSync(process.execPath, [sentinelPath, RENDERER_PATH], {
      encoding: 'utf8',
      env,
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const entries = JSON.parse(result.stdout);
    const unexpected = entries.filter(entry => entry !== `fs.readFileSync:${RENDERER_PATH}`);
    expect(unexpected).toEqual([]);
  });
});
