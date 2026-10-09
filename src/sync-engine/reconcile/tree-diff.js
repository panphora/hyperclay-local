const LOCKED = 'uploads';
const HOLD_MS = 3000;
const MASS_FILES = 20;
const MASS_SHARE = 0.1;
const MASS_SHARE_MIN = 5;
const RANK = { restoreLocked: 0, relocate: 1, new: 2, missing: 3, restore: 4, massDelete: 5 };

const under = (p, parent) => parent === '' ? p !== '' : p.startsWith(`${parent}/`);
const underLocked = (p) => p === LOCKED || under(p, LOCKED);
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1);
const depthOf = (p) => (p ? p.split('/').length : 0);
const kindOf = (type) => (type === 'folder' ? 'folder' : 'file');
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const strongIdentity = (inode) => typeof inode === 'string' && /^\d+:\d+$/.test(inode) && !inode.endsWith(':0');
const shapeOf = (from, to) => {
  if (dirOf(from) === dirOf(to)) return 'rename';
  return baseOf(from) === baseOf(to) ? 'move' : 'move+rename';
};
const isHidden = (p, unreadable) => {
  for (const u of unreadable) if (p === u || under(p, u)) return true;
  return false;
};
const opPath = (op) => op.path ?? op.from ?? op.to ?? '';
const sortPath = (op) => (op.op === 'relocate' ? op.to : opPath(op));

function diffTree({ ledger, disk, unreadable = new Set(), mode, held = new Map(), now = 0 }) {
  const entries = [...ledger]
    .map(([id, e]) => ({ ...e, id: String(id), kind: kindOf(e.type), at: e.path }))
    .sort((a, b) => cmp(a.path, b.path) || cmp(a.id, b.id));
  const tracked = new Map(entries.map((e) => [e.path, e]));
  const diskList = [...disk]
    .map(([p, d]) => ({ ...d, path: p, kind: kindOf(d.type) }))
    .sort((a, b) => cmp(a.path, b.path));
  const pathsByInode = new Map();
  for (const d of diskList) {
    if (!strongIdentity(d.inode)) continue;
    if (!pathsByInode.has(d.inode)) pathsByInode.set(d.inode, []);
    pathsByInode.get(d.inode).push(d.path);
  }
  const inodeElsewhere = (e) => strongIdentity(e.inode)
    && (pathsByInode.get(e.inode) || []).some((p) => p !== e.path && tracked.get(p)?.inode !== e.inode);

  const missing = [];
  for (const e of entries) {
    if (isHidden(e.path, unreadable)) continue;
    const d = disk.get(e.path);
    if (d && kindOf(d.type) === e.kind && !(d.inode !== e.inode && inodeElsewhere(e))) continue;
    missing.push(e);
  }
  const missingIds = new Set(missing.map((m) => m.id));
  const untracked = diskList.filter((d) => {
    const t = tracked.get(d.path);
    return !t || t.kind !== d.kind || missingIds.has(t.id);
  });

  const claimed = new Set();
  const settled = new Set();
  const relocated = new Map();
  const candidateFor = (m) => {
    if (!strongIdentity(m.inode)) return undefined;
    const matches = untracked.filter((u) => u.kind === m.kind && u.inode === m.inode && !claimed.has(u.path));
    return matches.length === 1 ? matches[0] : undefined;
  };

  const folders = missing
    .filter((m) => m.kind === 'folder')
    .sort((a, b) => depthOf(a.path) - depthOf(b.path) || cmp(a.path, b.path));
  for (const m of folders) {
    if (settled.has(m.id) || relocated.has(m.id)) continue;
    const cand = candidateFor(m);
    if (!cand) continue;
    const kids = missing.filter((c) => c !== m && under(c.at, m.at) && strongIdentity(c.inode));
    const atProjected = (c) => disk.get(cand.path + c.at.slice(m.at.length))?.inode === c.inode;
    const inside = (c) => (pathsByInode.get(c.inode) || []).some((p) => under(p, cand.path));
    // A coarse clock can hand a freed folder's inode and birth time to a new folder, so a child must vouch for it.
    // The uploads root takes only a child at its own relative path: a false match would move the user's folder into it.
    const vouches = m.at === LOCKED ? atProjected : (c) => atProjected(c) || inside(c);
    if (kids.length && !kids.some(vouches)) continue;
    relocated.set(m.id, cand.path);
    claimed.add(cand.path);
    for (const child of missing) {
      if (child === m || settled.has(child.id) || relocated.has(child.id) || !under(child.at, m.at)) continue;
      const projected = cand.path + child.at.slice(m.at.length);
      const there = disk.get(projected);
      if (there && kindOf(there.type) === child.kind && (there.inode === child.inode || !strongIdentity(child.inode))) {
        settled.add(child.id);
        claimed.add(projected);
      } else {
        child.at = projected;
      }
    }
  }
  for (const m of missing) {
    if (m.kind !== 'file' || settled.has(m.id) || relocated.has(m.id)) continue;
    const cand = candidateFor(m);
    if (!cand) continue;
    relocated.set(m.id, cand.path);
    claimed.add(cand.path);
  }

  const raw = [];
  for (const m of missing) {
    if (settled.has(m.id)) continue;
    const to = relocated.get(m.id);
    if (to) raw.push({ op: 'relocate', id: m.id, kind: m.kind, from: m.at, to, shape: shapeOf(m.at, to) });
    else raw.push({ op: 'missing', id: m.id, kind: m.kind, path: m.at });
  }
  for (const u of untracked) {
    if (!claimed.has(u.path)) raw.push({ op: 'new', kind: u.kind, path: u.path });
  }

  let ops = [];
  for (const r of raw) {
    if (r.op === 'relocate' && r.from === LOCKED) ops.push({ op: 'restoreLocked', from: r.to });
    else if (r.op === 'missing' && r.path === LOCKED) ops.push({ op: 'restoreLocked', from: null });
    else if (r.op === 'missing' && underLocked(r.path) && mode === 'catchup') ops.push({ ...r, op: 'restore' });
    else ops.push(r);
  }

  const missingFolders = ops.filter((o) => o.op === 'missing' && o.kind === 'folder').map((o) => o.path);
  const lockedRootGone = ops.some((o) => o.op === 'restoreLocked' && o.from === null);
  ops = ops.filter((o) => {
    if (o.op !== 'missing' && o.op !== 'restore') return true;
    if (lockedRootGone && under(o.path, LOCKED)) return false;
    return !missingFolders.some((f) => under(o.path, f));
  });

  if (mode === 'live') {
    const lockedFiles = entries.filter((e) => e.kind === 'file' && under(e.path, LOCKED)).length;
    const lockedDeletes = ops.filter((o) => o.op === 'missing' && under(o.path, LOCKED));
    const files = lockedDeletes.reduce((sum, o) => sum + (o.kind === 'file'
      ? 1
      : entries.filter((e) => e.kind === 'file' && under(e.path, o.path)).length), 0);
    if (files >= MASS_FILES || (files >= MASS_SHARE_MIN && files >= MASS_SHARE * lockedFiles)) {
      ops = ops.filter((o) => !lockedDeletes.includes(o));
      ops.push({ op: 'massDelete', files, ids: lockedDeletes.map((o) => o.id), paths: lockedDeletes.map((o) => o.path) });
    }
  }

  const nextHeld = new Map();
  let wakeAt = null;
  if (mode === 'live') {
    ops = ops.filter((o) => {
      const absence = o.op === 'missing' || o.op === 'massDelete' || (o.op === 'restoreLocked' && o.from === null);
      if (!absence) return true;
      const key = o.op === 'missing' ? `missing:${o.path}` : o.op;
      const firstSeen = held.has(key) ? held.get(key) : now;
      nextHeld.set(key, firstSeen);
      if (now - firstSeen >= HOLD_MS) return true;
      const due = firstSeen + HOLD_MS;
      wakeAt = wakeAt === null ? due : Math.min(wakeAt, due);
      return false;
    });
  }

  ops.sort((a, b) => RANK[a.op] - RANK[b.op]
    || depthOf(sortPath(a)) - depthOf(sortPath(b))
    || cmp(sortPath(a), sortPath(b)));
  return { ops, held: nextHeld, wakeAt };
}

module.exports = { diffTree, strongIdentity, HOLD_MS, MASS_FILES, LOCKED };
