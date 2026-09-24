const os = require('os');
const net = require('net');
const path = require('upath');

const PERSONAL_PORT = 4321;
const TEAM_PORT_LADDER = [5432, 6543, 7654, 8765, 9876];
const RANDOM_PORT_MIN = 49152;
const RANDOM_PORT_MAX = 65535;
const CASE_INSENSITIVE = process.platform === 'darwin' || process.platform === 'win32';

function fold(p) {
  const n = path.normalize(p).replace(/\/+$/, '');
  return CASE_INSENSITIVE ? n.toLowerCase() : n;
}

function contains(parent, child) {
  const a = fold(parent);
  const b = fold(child);
  return b === a || b.startsWith(a + '/');
}

function overlaps(a, b) {
  return contains(a, b) || contains(b, a);
}

// realPathOf resolves the nearest existing ancestor with fs.realpath and re-appends the
// missing tail (same idea as path-resolver's realpathNearestParent). Injected for tests.
async function validateRootPath(dir, roots, { realPathOf, home = os.homedir(), ignoreRootId = null }) {
  const real = await realPathOf(dir);
  const homeReal = await realPathOf(home);
  if (fold(real) === fold(homeReal)) return { ok: false, reason: 'home-itself' };
  if (!contains(homeReal, real)) return { ok: false, reason: 'outside-home' };
  for (const root of roots) {
    if (root.id === ignoreRootId) continue;
    if (overlaps(real, await realPathOf(root.path))) return { ok: false, reason: 'overlaps', rootId: root.id };
  }
  return { ok: true, path: real };
}

async function defaultTeamFolder(teamUsername, roots, { realPathOf, exists, isEmptyDir, home = os.homedir() }) {
  const bases = [path.join(home, 'hyperclay', teamUsername), path.join(home, 'hyperclay-teams', teamUsername)];
  for (const base of bases) {
    for (let n = 1; n < 100; n++) {
      const dir = n === 1 ? base : `${base}-${n}`;
      const check = await validateRootPath(dir, roots, { realPathOf, home });
      if (!check.ok) break;
      if (!(await exists(dir)) || (await isEmptyDir(dir))) return dir;
    }
  }
  return null;
}

function probePort(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

async function allocateTeamPort(roots, { isFree = probePort, random = Math.random } = {}) {
  const assigned = new Set(roots.map((r) => r.port));
  assigned.add(PERSONAL_PORT);
  for (const port of TEAM_PORT_LADDER) {
    if (!assigned.has(port) && await isFree(port)) return port;
  }
  for (let i = 0; i < 64; i++) {
    const port = RANDOM_PORT_MIN + Math.floor(random() * (RANDOM_PORT_MAX - RANDOM_PORT_MIN + 1));
    if (!assigned.has(port) && await isFree(port)) return port;
  }
  throw new Error('No free local port found');
}

function personalRoot(roots) {
  return roots.find((r) => r.kind === 'personal') || null;
}

module.exports = {
  PERSONAL_PORT, TEAM_PORT_LADDER, CASE_INSENSITIVE,
  contains, overlaps, validateRootPath, defaultTeamFolder,
  probePort, allocateTeamPort, personalRoot,
};
