// F2: OS "Open with" for `.html` and `.htmlclay`. Nothing here touches Electron:
// every dependency of handleOpenPath is injected, and htmlClayLauncher takes its
// execFile/spawn/exists/env so each platform branch is exercised with fakes.
const fsSync = require('fs');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const upath = require('upath');

const { extractOpenPaths, handleOpenPath, rootForAbsPath, htmlClayLauncher } = require('../../src/main/open-path');

// macOS resolves /var to /private/var, so roots must be built from the real tmpdir.
const TMP = fsSync.realpathSync.native(os.tmpdir());

async function makeDir(name) {
  return fsSync.realpathSync.native(await fs.mkdtemp(path.join(TMP, `open-path-${name}-`)));
}

async function writeFile(dir, name, body = '<html><body>page</body></html>') {
  const file = path.join(dir, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body);
  return file;
}

function makeDeps(overrides = {}) {
  return {
    roots: () => [],
    startServer: jest.fn().mockResolvedValue(undefined),
    isServerRunning: () => true,
    openExternal: jest.fn().mockResolvedValue(undefined),
    showMessage: jest.fn().mockResolvedValue({ response: 0 }),
    revealFolder: jest.fn().mockResolvedValue(undefined),
    personalRoot: () => null,
    htmlClay: null,
    ...overrides,
  };
}

describe('extractOpenPaths', () => {
  test('keeps existing .html and .htmlclay arguments and drops flags and other files', async () => {
    const dir = await makeDir('argv');
    const page = await writeFile(dir, 'page.html');
    const clay = await writeFile(dir, 'page.htmlclay');
    const png = await writeFile(dir, 'image.png');
    const exists = (p) => [page, clay, png].includes(p);
    const argv = [
      '/Applications/HyperclayLocal.app/Contents/MacOS/HyperclayLocal',
      '--flag',
      page,
      png,
      clay,
      '--ext',
      path.join(dir, 'missing.html'),
    ];
    expect(extractOpenPaths(argv, { exists })).toEqual([page, clay]);
  });

  test('matches the extension case-insensitively', () => {
    const exists = () => true;
    expect(extractOpenPaths(['bin', '/tmp/A.HTML', '/tmp/B.HtmlClay'], { exists }))
      .toEqual(['/tmp/A.HTML', '/tmp/B.HtmlClay']);
  });

  test('uses the real filesystem by default', async () => {
    const dir = await makeDir('real');
    const page = await writeFile(dir, 'page.html');
    expect(extractOpenPaths(['bin', page, path.join(dir, 'gone.html')])).toEqual([page]);
  });
});

describe('rootForAbsPath', () => {
  test('finds the root that contains the file', () => {
    const roots = [{ id: 'p', path: '/Users/me/hyperclay' }];
    expect(rootForAbsPath(roots, '/Users/me/hyperclay/site/index.html')).toBe(roots[0]);
  });

  test('does not match a sibling with the same prefix', () => {
    const roots = [{ id: 'p', path: '/Users/me/site' }];
    expect(rootForAbsPath(roots, '/Users/me/site-2/index.html')).toBeNull();
  });
});

describe('handleOpenPath', () => {
  let personalDir;
  let teamDir;

  beforeEach(async () => {
    personalDir = await makeDir('personal');
    teamDir = await makeDir('team');
  });

  const personalState = (overrides = {}) => ({
    id: 'personal', kind: 'personal', path: personalDir, port: 4321, state: 'running', ...overrides,
  });

  test('opens a file in the personal root on 4321', async () => {
    const file = await writeFile(personalDir, 'index.html');
    const deps = makeDeps({ roots: () => [personalState()] });
    const result = await handleOpenPath(file, deps);
    expect(result).toEqual({ outcome: 'opened', rootId: 'personal' });
    expect(deps.openExternal).toHaveBeenCalledWith('http://localhost:4321/index.html');
    expect(deps.startServer).not.toHaveBeenCalled();
    expect(deps.showMessage).not.toHaveBeenCalled();
  });

  test('opens a file in a team root on that root\'s port', async () => {
    const file = await writeFile(path.join(teamDir, 'site'), 'index.html');
    const deps = makeDeps({
      roots: () => [personalState(), { id: 'team', kind: 'team', path: teamDir, port: 6543, state: 'running' }],
    });
    const result = await handleOpenPath(file, deps);
    expect(result).toEqual({ outcome: 'opened', rootId: 'team' });
    expect(deps.openExternal).toHaveBeenCalledWith('http://localhost:6543/site/index.html');
  });

  test('encodes every path segment', async () => {
    const file = await writeFile(path.join(personalDir, 'my pages'), 'hello world.html');
    const deps = makeDeps({ roots: () => [personalState()] });
    await handleOpenPath(file, deps);
    expect(deps.openExternal).toHaveBeenCalledWith('http://localhost:4321/my%20pages/hello%20world.html');
  });

  test('starts the server first when it is off', async () => {
    const file = await writeFile(personalDir, 'index.html');
    const order = [];
    const deps = makeDeps({
      roots: () => [personalState()],
      isServerRunning: () => false,
      startServer: jest.fn(async () => { order.push('start'); }),
      openExternal: jest.fn(async () => { order.push('open'); }),
    });
    const result = await handleOpenPath(file, deps);
    expect(order).toEqual(['start', 'open']);
    expect(result).toEqual({ outcome: 'opened', rootId: 'personal' });
  });

  test('takes the root from the refreshed state after the start', async () => {
    const file = await writeFile(path.join(teamDir, 'site'), 'index.html');
    let started = false;
    const deps = makeDeps({
      roots: () => [
        personalState({ state: started ? 'running' : 'stopped' }),
        { id: 'team', kind: 'team', path: teamDir, port: 5432, state: started ? 'running' : 'stopped' },
      ],
      isServerRunning: () => started,
      startServer: jest.fn(async () => { started = true; }),
    });
    const result = await handleOpenPath(file, deps);
    expect(result).toEqual({ outcome: 'opened', rootId: 'team' });
    expect(deps.openExternal).toHaveBeenCalledWith('http://localhost:5432/site/index.html');
  });

  test('reports a root whose port is already taken', async () => {
    const file = await writeFile(personalDir, 'index.html');
    const deps = makeDeps({ roots: () => [personalState({ state: 'port-taken' })] });
    const result = await handleOpenPath(file, deps);
    expect(result).toEqual({ outcome: 'port-taken' });
    expect(deps.startServer).not.toHaveBeenCalled();
    expect(deps.openExternal).not.toHaveBeenCalled();
    expect(deps.showMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'warning',
      message: 'Port 4321 is in use by another program.',
      buttons: ['OK'],
    }));
  });

  test('reports a port taken by the start it triggered', async () => {
    const file = await writeFile(personalDir, 'index.html');
    let state = 'stopped';
    const deps = makeDeps({
      roots: () => [personalState({ state })],
      isServerRunning: () => state === 'running',
      startServer: jest.fn(async () => { state = 'port-taken'; }),
    });
    const result = await handleOpenPath(file, deps);
    expect(result).toEqual({ outcome: 'port-taken' });
    expect(deps.openExternal).not.toHaveBeenCalled();
    expect(deps.showMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'warning',
      message: 'Port 4321 is in use by another program.',
    }));
  });

  test('refuses a file inside a hidden folder', async () => {
    const file = await writeFile(path.join(personalDir, '.hyperclay', 'versions'), 'v1.html');
    const deps = makeDeps({ roots: () => [personalState()] });
    const result = await handleOpenPath(file, deps);
    expect(result).toEqual({ outcome: 'hidden' });
    expect(deps.openExternal).not.toHaveBeenCalled();
    expect(deps.showMessage).toHaveBeenCalledWith({
      type: 'info', message: 'Files inside hidden folders are not served.', buttons: ['OK'],
    });
  });

  test('explains a file outside every root and serves nothing', async () => {
    const outsideDir = await makeDir('outside');
    const file = await writeFile(outsideDir, 'loose.html');
    const deps = makeDeps({ roots: () => [personalState()] });
    const result = await handleOpenPath(file, deps);
    expect(result).toEqual({ outcome: 'outside' });
    expect(deps.startServer).not.toHaveBeenCalled();
    expect(deps.openExternal).not.toHaveBeenCalled();
    expect(deps.showMessage).toHaveBeenCalledTimes(1);
    const options = deps.showMessage.mock.calls[0][0];
    expect(options.message).toContain('loose.html');
    expect(options.buttons).toEqual(['OK']);
  });

  test('reveals the personal folder when that button is chosen', async () => {
    const outsideDir = await makeDir('reveal');
    const file = await writeFile(outsideDir, 'loose.html');
    const deps = makeDeps({
      roots: () => [personalState()],
      personalRoot: () => personalState(),
      showMessage: jest.fn().mockResolvedValue({ response: 0 }),
    });
    const result = await handleOpenPath(file, deps);
    expect(result).toEqual({ outcome: 'outside' });
    expect(deps.showMessage.mock.calls[0][0].buttons).toEqual(['Show Personal Folder', 'OK']);
    expect(deps.revealFolder).toHaveBeenCalledWith(personalDir);
    expect(deps.openExternal).not.toHaveBeenCalled();
  });

  test('offers HTML Clay first and opens the file there when chosen', async () => {
    const outsideDir = await makeDir('htmlclay');
    const file = await writeFile(outsideDir, 'loose.html');
    const htmlClay = { available: jest.fn().mockResolvedValue(true), open: jest.fn().mockResolvedValue(undefined) };
    const deps = makeDeps({
      roots: () => [personalState()],
      personalRoot: () => personalState(),
      htmlClay,
      showMessage: jest.fn().mockResolvedValue({ response: 0 }),
    });
    const result = await handleOpenPath(file, deps);
    expect(result).toEqual({ outcome: 'htmlclay' });
    expect(deps.showMessage.mock.calls[0][0].buttons[0]).toBe('Open in HTML Clay');
    expect(htmlClay.open).toHaveBeenCalledTimes(1);
    expect(htmlClay.open).toHaveBeenCalledWith(upath.normalize(file));
    expect(deps.startServer).not.toHaveBeenCalled();
    expect(deps.openExternal).not.toHaveBeenCalled();
    expect(deps.revealFolder).not.toHaveBeenCalled();
  });

  test('leaves the HTML Clay button out when it is not installed', async () => {
    const outsideDir = await makeDir('no-htmlclay');
    const file = await writeFile(outsideDir, 'loose.html');
    const htmlClay = { available: jest.fn().mockResolvedValue(false), open: jest.fn() };
    const deps = makeDeps({
      roots: () => [personalState()],
      personalRoot: () => personalState(),
      htmlClay,
    });
    await handleOpenPath(file, deps);
    expect(deps.showMessage.mock.calls[0][0].buttons).not.toContain('Open in HTML Clay');
    expect(htmlClay.open).not.toHaveBeenCalled();
  });

  test('leaves the HTML Clay button out when no launcher is injected', async () => {
    const outsideDir = await makeDir('no-launcher');
    const file = await writeFile(outsideDir, 'loose.html');
    const deps = makeDeps({
      roots: () => [personalState()],
      personalRoot: () => personalState(),
      htmlClay: null,
    });
    await handleOpenPath(file, deps);
    expect(deps.showMessage.mock.calls[0][0].buttons).toEqual(['Show Personal Folder', 'OK']);
  });

  test('reports a path that does not exist', async () => {
    const deps = makeDeps({ roots: () => [personalState()] });
    const result = await handleOpenPath(path.join(personalDir, 'gone.html'), deps);
    expect(result).toEqual({ outcome: 'missing' });
    expect(deps.showMessage).not.toHaveBeenCalled();
    expect(deps.openExternal).not.toHaveBeenCalled();
  });

  test('ignores a file that is neither .html nor .htmlclay', async () => {
    const file = await writeFile(personalDir, 'notes.txt');
    const deps = makeDeps({ roots: () => [personalState()] });
    const result = await handleOpenPath(file, deps);
    expect(result).toEqual({ outcome: 'ignored' });
    expect(deps.openExternal).not.toHaveBeenCalled();
  });
});

describe('htmlClayLauncher', () => {
  const BUNDLE_ID = 'com.htmlclay.HTMLClay';

  test('builds with the real dependencies when nothing is injected', () => {
    const launcher = htmlClayLauncher();
    expect(typeof launcher.available).toBe('function');
    expect(typeof launcher.open).toBe('function');
  });

  test('darwin: available when mdfind prints a bundle path', async () => {
    const execFile = jest.fn((file, args, options, callback) => callback(null, '/Applications/HTMLClay.app\n'));
    const launcher = htmlClayLauncher({ platform: 'darwin', execFile, spawn: jest.fn(), exists: () => false, env: {} });
    await expect(launcher.available()).resolves.toBe(true);
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(execFile.mock.calls[0][0]).toBe('mdfind');
    expect(execFile.mock.calls[0][1]).toEqual([`kMDItemCFBundleIdentifier == '${BUNDLE_ID}'`]);
    expect(execFile.mock.calls[0][2]).toEqual({ timeout: 5000 });
  });

  test('darwin: unavailable when mdfind prints nothing', async () => {
    const execFile = jest.fn((file, args, options, callback) => callback(null, '\n'));
    const launcher = htmlClayLauncher({ platform: 'darwin', execFile, spawn: jest.fn(), exists: () => false, env: {} });
    await expect(launcher.available()).resolves.toBe(false);
  });

  test('darwin: unavailable when mdfind errors or throws', async () => {
    const failing = jest.fn((file, args, options, callback) => callback(new Error('mdfind: not found'), ''));
    await expect(htmlClayLauncher({ platform: 'darwin', execFile: failing, spawn: jest.fn(), exists: () => false, env: {} }).available())
      .resolves.toBe(false);

    const throwing = jest.fn(() => { throw new Error('spawn ENOENT'); });
    await expect(htmlClayLauncher({ platform: 'darwin', execFile: throwing, spawn: jest.fn(), exists: () => false, env: {} }).available())
      .resolves.toBe(false);
  });

  test('darwin: open runs the bundle id through /usr/bin/open', async () => {
    const execFile = jest.fn((file, args, options, callback) => callback(null, ''));
    const launcher = htmlClayLauncher({ platform: 'darwin', execFile, spawn: jest.fn(), exists: () => false, env: {} });
    await launcher.open('/Users/me/hyperclay/loose.html');
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(execFile.mock.calls[0][0]).toBe('open');
    expect(execFile.mock.calls[0][1]).toEqual(['-b', BUNDLE_ID, '/Users/me/hyperclay/loose.html']);
  });

  test('win32: uses the exe under LOCALAPPDATA', async () => {
    const env = { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' };
    const exe = upath.join(env.LOCALAPPDATA, 'Programs', 'HTMLClay', 'htmlclay.exe');
    const exists = jest.fn((p) => p === exe);
    const child = { unref: jest.fn() };
    const spawn = jest.fn(() => child);
    const launcher = htmlClayLauncher({ platform: 'win32', execFile: jest.fn(), spawn, exists, env });

    await expect(launcher.available()).resolves.toBe(true);
    expect(exists).toHaveBeenCalledWith(exe);

    await launcher.open('C:\\Users\\me\\hyperclay\\loose.html');
    expect(spawn).toHaveBeenCalledWith(exe, ['C:\\Users\\me\\hyperclay\\loose.html'], { detached: true, stdio: 'ignore' });
    expect(child.unref).toHaveBeenCalledTimes(1);
  });

  test('win32: unavailable without LOCALAPPDATA or without the exe', async () => {
    const missingEnv = htmlClayLauncher({ platform: 'win32', execFile: jest.fn(), spawn: jest.fn(), exists: () => true, env: {} });
    await expect(missingEnv.available()).resolves.toBe(false);

    const missingExe = htmlClayLauncher({
      platform: 'win32', execFile: jest.fn(), spawn: jest.fn(), exists: () => false,
      env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' },
    });
    await expect(missingExe.available()).resolves.toBe(false);
  });

  (process.platform === 'win32' ? test.skip : test)('linux: finds htmlclay on PATH and spawns it detached', async () => {
    const exe = '/usr/local/bin/htmlclay';
    const exists = jest.fn((p) => p === exe);
    const child = { unref: jest.fn() };
    const spawn = jest.fn(() => child);
    const launcher = htmlClayLauncher({
      platform: 'linux', execFile: jest.fn(), spawn, exists,
      env: { PATH: '/nope/bin:/usr/local/bin:/usr/bin' },
    });

    await expect(launcher.available()).resolves.toBe(true);
    expect(exists).toHaveBeenCalledWith('/nope/bin/htmlclay');

    await launcher.open('/home/me/hyperclay/loose.html');
    expect(spawn).toHaveBeenCalledWith(exe, ['/home/me/hyperclay/loose.html'], { detached: true, stdio: 'ignore' });
    expect(child.unref).toHaveBeenCalledTimes(1);
  });

  test('linux: unavailable when no PATH entry holds htmlclay', async () => {
    const none = htmlClayLauncher({
      platform: 'linux', execFile: jest.fn(), spawn: jest.fn(), exists: () => false,
      env: { PATH: '/usr/bin:/bin' },
    });
    await expect(none.available()).resolves.toBe(false);

    const noPath = htmlClayLauncher({ platform: 'linux', execFile: jest.fn(), spawn: jest.fn(), exists: () => true, env: {} });
    await expect(noPath.available()).resolves.toBe(false);
  });
});
