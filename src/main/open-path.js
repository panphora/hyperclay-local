const fs = require('fs/promises');
const path = require('upath');
const { contains } = require('./roots');

const OPENABLE = /\.(html|htmlclay)$/i;

function rootForAbsPath(roots, abs) {
  return roots.find((root) => contains(root.path, abs)) || null;
}

function extractOpenPaths(argv, { exists = require('fs').existsSync } = {}) {
  return argv.slice(1).filter((arg) => !arg.startsWith('-') && OPENABLE.test(arg) && exists(arg));
}

async function handleOpenPath(rawPath, { roots, startServer, isServerRunning, openExternal, showMessage, revealFolder, personalRoot, htmlClay }) {
  let abs;
  try { abs = path.normalize(await fs.realpath(rawPath)); } catch { return { outcome: 'missing' }; }
  if (!OPENABLE.test(abs)) return { outcome: 'ignored' };
  let root = rootForAbsPath(roots(), abs);
  if (!root) {
    const target = personalRoot();
    const canHtmlClay = htmlClay ? await htmlClay.available() : false;
    const buttons = [
      ...(canHtmlClay ? ['Open in HTML Clay'] : []),
      ...(target ? ['Show Personal Folder'] : []),
      'OK',
    ];
    const { response } = await showMessage({
      type: 'info',
      message: `${path.basename(abs)} is outside your Hyperclay Local folders.`,
      detail: 'Hyperclay Local serves your personal folder and your team folders. Move the file into one of them to open it here.',
      buttons, defaultId: buttons.length - 1, cancelId: buttons.length - 1,
    });
    const choice = buttons[response];
    if (choice === 'Open in HTML Clay') {
      await htmlClay.open(abs);
      return { outcome: 'htmlclay' };
    }
    if (choice === 'Show Personal Folder') await revealFolder(target.path);
    return { outcome: 'outside' };
  }
  const rel = path.relative(root.path, abs).split('/');
  if (rel.some((seg) => seg.startsWith('.'))) {
    await showMessage({ type: 'info', message: 'Files inside hidden folders are not served.', buttons: ['OK'] });
    return { outcome: 'hidden' };
  }
  if (!isServerRunning()) {
    await startServer();
    root = rootForAbsPath(roots(), abs) || root;
  }
  if (root.state === 'port-taken') {
    await showMessage({ type: 'warning', message: `Port ${root.port} is in use by another program.`, detail: 'Fix it from the folder\'s card, then open the file again.', buttons: ['OK'] });
    return { outcome: 'port-taken' };
  }
  await openExternal(`http://localhost:${root.port}/${rel.map(encodeURIComponent).join('/')}`);
  return { outcome: 'opened', rootId: root.id };
}

function htmlClayLauncher({ platform = process.platform, execFile = require('child_process').execFile, spawn = require('child_process').spawn, exists = require('fs').existsSync, env = process.env } = {}) {
  const bundleId = 'com.htmlclay.HTMLClay';

  function run(file, args, options) {
    return new Promise((resolve, reject) => {
      execFile(file, args, options, (error, stdout) => (error ? reject(error) : resolve(stdout)));
    });
  }

  function existsQuiet(target) {
    try { return target ? !!exists(target) : false; } catch { return false; }
  }

  function spawnDetached(exe, abs) {
    return new Promise((resolve, reject) => {
      try {
        spawn(exe, [abs], { detached: true, stdio: 'ignore' }).unref();
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  if (platform === 'darwin') {
    return {
      available: async () => {
        try {
          const stdout = await run('mdfind', [`kMDItemCFBundleIdentifier == '${bundleId}'`], { timeout: 5000 });
          return String(stdout || '').split('\n').some((line) => line.trim() !== '');
        } catch {
          return false;
        }
      },
      open: (abs) => run('open', ['-b', bundleId, abs], {}),
    };
  }

  if (platform === 'win32') {
    const exe = env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Programs', 'HTMLClay', 'htmlclay.exe') : null;
    return {
      available: () => Promise.resolve(existsQuiet(exe)),
      open: (abs) => (exe ? spawnDetached(exe, abs) : Promise.reject(new Error('HTML Clay is not installed'))),
    };
  }

  function pathExe() {
    const dirs = String(env.PATH || '').split(path.delimiter);
    for (const dir of dirs) {
      if (!dir) continue;
      const candidate = path.join(dir, 'htmlclay');
      if (existsQuiet(candidate)) return candidate;
    }
    return null;
  }

  return {
    available: () => Promise.resolve(!!pathExe()),
    open: (abs) => {
      const exe = pathExe();
      return exe ? spawnDetached(exe, abs) : Promise.reject(new Error('HTML Clay is not installed'));
    },
  };
}

module.exports = { extractOpenPaths, handleOpenPath, rootForAbsPath, htmlClayLauncher };
