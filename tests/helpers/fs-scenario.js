/**
 * The race harness's filesystem half.
 *
 * It builds a real temp root from a `{ tree }` description, seeds the engine's
 * ledger from the real inodes, applies `ops` to that root, and derives the
 * watcher events from a before and after walk of the disk — never by hand.
 * Every descendant `unlink`/`unlinkDir` and `add`/`addDir` an operation produces
 * is emitted, and a file's `add` lands at least 1000 ms of harness time after
 * its folder's `addDir`, the way chokidar's `awaitWriteFinish` delivers it.
 *
 * The delays a run feeds to the engine's async seams are held in `seams`, so a
 * test file's `jest.mock` factories can await them without knowing the seed.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const checksumOf = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex').substring(0, 16);

/** Seeded delays the engine's async seams read. Replaced per run. */
const seams = {
  async wait() {},
  inodeAlias: new Map()
};

/** A small deterministic PRNG (numerical recipes LCG). */
function rng(seed) {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function writeTree(root, tree) {
  for (const [rel, body] of Object.entries(tree)) {
    const abs = path.join(root, rel);
    if (body === null) {
      fs.mkdirSync(abs, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, body);
    }
  }
}

function mkroot(tree, baseDir) {
  const root = fs.mkdtempSync(path.join(baseDir || os.tmpdir(), 'race-root-'));
  writeTree(root, tree);
  return root;
}

function mkoutside(baseDir) {
  return fs.mkdtempSync(path.join(baseDir || os.tmpdir(), 'race-out-'));
}

/** Every path under the root: rel -> { type, inode, bytes } (bytes for files). */
function walk(root) {
  const found = new Map();
  const visit = (dir, rel) => {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names.sort()) {
      const abs = path.join(dir, name);
      const childRel = rel ? `${rel}/${name}` : name;
      const stat = fs.lstatSync(abs);
      if (stat.isDirectory()) {
        found.set(childRel, { type: 'folder', inode: stat.ino });
        visit(abs, childRel);
      } else {
        found.set(childRel, { type: 'file', inode: stat.ino, bytes: fs.readFileSync(abs) });
      }
    }
  };
  visit(root, '');
  return found;
}

const depthOf = (rel) => rel.split('/').length;
const deepestFirst = (a, b) => depthOf(b) - depthOf(a) || (a < b ? -1 : 1);
const shallowestFirst = (a, b) => depthOf(a) - depthOf(b) || (a < b ? -1 : 1);

/**
 * The watcher events one operation produced, from its before and after walk.
 * Unlinks run deepest-first (a folder's children before the folder) and adds
 * shallowest-first (a folder before its children), which is chokidar's order.
 */
function deriveEvents(before, after) {
  const gone = [...before.keys()].filter((rel) => !after.has(rel)).sort(deepestFirst);
  const fresh = [...after.keys()].filter((rel) => !before.has(rel)).sort(shallowestFirst);
  const edited = [...after.keys()].filter((rel) =>
    before.has(rel) && after.get(rel).type === 'file' && !before.get(rel).bytes.equals(after.get(rel).bytes)
  ).sort(shallowestFirst);

  const events = [];
  let at = 0;
  for (const rel of gone) {
    events.push({ event: before.get(rel).type === 'folder' ? 'unlinkDir' : 'unlink', rel, at });
    at += 1;
  }
  for (const rel of edited) {
    events.push({ event: 'change', rel, at });
    at += 1;
  }
  const base = at;
  const folderAt = new Map();
  let dirAt = base;
  for (const rel of fresh) {
    if (after.get(rel).type === 'folder') {
      folderAt.set(rel, dirAt);
      events.push({ event: 'addDir', rel, at: dirAt });
      dirAt += 1;
    }
  }
  let fileAt = dirAt;
  for (const rel of fresh) {
    if (after.get(rel).type !== 'folder') {
      const parent = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      const parentTime = folderAt.has(parent) ? folderAt.get(parent) + 1000 : base;
      const when = Math.max(fileAt, parentTime);
      events.push({ event: 'add', rel, at: when });
      fileAt = when + 1;
    }
  }
  return events;
}

/**
 * Apply one operation to the root. `slow-rm` is the only one that touches the
 * disk while the events are delivered, so it is applied by the caller.
 */
function applyOp(root, outside, op) {
  const abs = (rel) => path.join(root, rel);
  switch (op.op) {
    case 'rename':
    case 'move':
      fs.mkdirSync(path.dirname(abs(op.to)), { recursive: true });
      fs.renameSync(abs(op.from), abs(op.to));
      return;
    case 'mkdir':
      fs.mkdirSync(abs(op.path), { recursive: true });
      return;
    case 'write':
      fs.mkdirSync(path.dirname(abs(op.path)), { recursive: true });
      fs.writeFileSync(abs(op.path), op.body);
      return;
    case 'rm':
      fs.rmSync(abs(op.path), { recursive: true, force: true });
      return;
    case 'trash':
      fs.renameSync(abs(op.path), path.join(outside, path.basename(op.path)));
      return;
    default:
      throw new Error(`fs-scenario: unknown op ${op.op}`);
  }
}

/**
 * The event stream for a scenario: every op applied to the real root, its
 * events derived from the before and after walk, then ordered for the mode.
 *
 * `tree` keeps chokidar's per-operation order and interleaves whole operations
 * at random; `free` shuffles every event, the margin for a platform or an
 * observer that reorders them. Both carry the fake-time offsets that become the
 * delays between deliveries.
 */
function planOps(root, outside, ops, rand, mode) {
  const groups = [];
  const slowOps = [];
  // Operations happen in order; a small seeded gap between their starts keeps
  // each one's own events in order while the two streams still overlap, which
  // is where the races live.
  let cursor = 0;
  for (const [index, op] of ops.entries()) {
    const start = op.at === undefined ? cursor : op.at;
    cursor = start + Math.floor(rand() * 40);
    if (op.op === 'slow-rm') {
      const before = walk(root);
      const subtree = [...before.keys()].filter((rel) => rel === op.path || rel.startsWith(`${op.path}/`));
      const gone = subtree.sort(deepestFirst);
      const events = [];
      const step = op.spanMs ? op.spanMs / Math.max(1, gone.length) : 1;
      gone.forEach((rel, position) => {
        events.push({
          event: before.get(rel).type === 'folder' ? 'unlinkDir' : 'unlink',
          rel,
          at: start + Math.round(position * step),
          remove: true
        });
      });
      for (const event of events) event.group = index;
      groups.push(events);
      slowOps.push(op.path);
      continue;
    }
    const before = walk(root);
    applyOp(root, outside, op);
    const after = walk(root);
    const events = deriveEvents(before, after);
    for (const event of events) {
      event.at += start;
      event.group = index;
    }
    groups.push(events);
  }

  let stream;
  if (mode === 'free') {
    stream = groups.flat();
    for (let i = stream.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [stream[i], stream[j]] = [stream[j], stream[i]];
    }
    for (const event of stream) event.at = 0;
  } else {
    const queues = groups.map((group) => group.slice());
    stream = [];
    while (queues.some((queue) => queue.length)) {
      const live = queues.map((queue, index) => (queue.length ? index : -1)).filter((index) => index >= 0);
      stream.push(queues[live[Math.floor(rand() * live.length)]].shift());
    }
  }

  // Delivery times: monotonic, and a file's add at least 1000 ms after the
  // addDir of the folder it landed in.
  let clock = 0;
  let previous = 0;
  const folderDelivered = new Map();
  for (const event of stream) {
    clock = Math.max(clock, event.at || 0);
    if (event.event === 'add') {
      const parent = event.rel.includes('/') ? event.rel.slice(0, event.rel.lastIndexOf('/')) : '';
      const dirAt = folderDelivered.get(parent);
      if (dirAt !== undefined) clock = Math.max(clock, dirAt + 1000);
    }
    if (event.event === 'addDir') folderDelivered.set(event.rel, clock);
    event.delay = clock - previous;
    previous = clock;
  }

  return { stream, slowOps };
}

/** id -> rel, plus the parentId implied by the tree. */
function ledgerFor(root, ids) {
  const entries = [];
  const byPath = new Map();
  for (const [id, rel] of Object.entries(ids)) byPath.set(rel, String(id));

  const parentOf = (rel) => {
    if (!rel.includes('/')) return 0;
    let dir = rel.slice(0, rel.lastIndexOf('/'));
    while (dir) {
      if (byPath.has(dir)) return Number(byPath.get(dir));
      dir = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '';
    }
    return 0;
  };

  for (const [id, rel] of Object.entries(ids)) {
    const stat = fs.statSync(path.join(root, rel));
    const isFolder = stat.isDirectory();
    const type = isFolder ? 'folder' : /\.(html|htmlclay)$/i.test(rel) ? 'site' : 'upload';
    const entry = { type, path: rel, parentId: parentOf(rel), inode: stat.ino };
    if (!isFolder) {
      const bytes = fs.readFileSync(path.join(root, rel));
      const checksum = checksumOf(bytes);
      entry.checksum = checksum;
      entry.remoteEtag = checksum;
      entry.localChecksum = checksum;
    }
    entries.push([String(id), entry]);
  }
  return entries;
}

/** The server nodes that match a ledger: same ids, paths, parents and bytes. */
function serverNodesFor(root, ids) {
  const byPath = new Map();
  for (const [id, rel] of Object.entries(ids)) byPath.set(rel, String(id));
  const parentOf = (rel) => {
    if (!rel.includes('/')) return 0;
    let dir = rel.slice(0, rel.lastIndexOf('/'));
    while (dir) {
      if (byPath.has(dir)) return Number(byPath.get(dir));
      dir = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '';
    }
    return 0;
  };
  const nodes = [];
  for (const [id, rel] of Object.entries(ids)) {
    const stat = fs.statSync(path.join(root, rel));
    const isFolder = stat.isDirectory();
    nodes.push({
      id: Number(id),
      type: isFolder ? 'folder' : /\.(html|htmlclay)$/i.test(rel) ? 'site' : 'upload',
      name: rel.split('/').pop(),
      parentId: parentOf(rel),
      content: isFolder ? null : fs.readFileSync(path.join(root, rel))
    });
  }
  return nodes;
}

module.exports = {
  seams,
  rng,
  mkroot,
  mkoutside,
  walk,
  planOps,
  ledgerFor,
  serverNodesFor,
  checksumOf
};
