const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const afterPack = require('../../build-scripts/linux-after-pack');

const describeUnix = process.platform === 'win32' ? describe.skip : describe;

describeUnix('Linux launcher', () => {
  let dir;
  let launcher;

  beforeEach(async () => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'linux-launcher-')));
    launcher = path.join(dir, 'app');
    fs.writeFileSync(launcher, '#!/bin/bash\nprintf "%s" "${XDG_DATA_DIRS-UNSET}"\n', { mode: 0o755 });
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    await afterPack({ electronPlatformName: 'linux', packager: { executableName: 'app' }, appOutDir: dir });
    log.mockRestore();
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const run = (value) => {
    const env = { ...process.env, DISPLAY: '' };
    if (value === undefined) delete env.XDG_DATA_DIRS;
    else env.XDG_DATA_DIRS = value;
    return execFileSync(launcher, { env, encoding: 'utf8' });
  };

  test('keeps the first copy of each absolute directory that exists', () => {
    const a = path.join(dir, 'a');
    const b = path.join(dir, 'b');
    fs.mkdirSync(a);
    fs.mkdirSync(b);
    expect(run(`./share/:${a}:${a}::${path.join(dir, 'missing')}:${b}:`)).toBe(`${a}:${b}`);
  });

  test('leaves the variable unset when nothing usable remains', () => {
    expect(run('./share/::')).toBe('UNSET');
  });

  test('leaves an unset variable unset', () => {
    expect(run(undefined)).toBe('UNSET');
  });
});
