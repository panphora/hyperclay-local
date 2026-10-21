const fs = require('fs').promises;
const path = require('upath');
const cheerio = require('cheerio');
const { atomicWriteFile } = require('../utils/write-queue');

const UNTITLED = /^untitled(?:-\d+)?\.html$/i;

function tidyName(raw) {
  const base = raw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
  return base;
}

function nameFor(base, number) {
  const suffix = number === 1 ? '' : `-${number}`;
  const limit = 60 - '.html'.length - suffix.length;
  const short = base.length <= limit ? base : base.slice(0, limit).replace(/-[^-]*$/u, '') || base.slice(0, limit);
  return `${short}${suffix}.html`;
}

function headingOf(html) {
  const heading = cheerio.load(html)('article[data-page] h1').first().clone();
  heading.find('script, style').remove();
  return heading.text().replace(/\s+/gu, ' ').trim();
}

function createAutoNamer({ appDataPath, authority, checkpoint, rootFor, rename, logError = console.error }) {
  const file = path.join(appDataPath, 'auto-named.json');
  const entries = new Map();
  const active = new Map();
  const scheduled = new Set();
  const removed = new Map();
  const keyFor = (rootId, rel) => `${rootId}\n${rel}`;
  let mutation = Promise.resolve();
  const ready = fs.readFile(file, 'utf8').then(text => {
    const stored = JSON.parse(text);
    if (stored.version !== 2 || !Array.isArray(stored.entries)) return;
    for (const item of stored.entries) {
      if (typeof item.rootId === 'string' && typeof item.path === 'string' &&
          item.fileIdentity && typeof item.fileIdentity.ino === 'string') entries.set(keyFor(item.rootId, item.path), item);
    }
  }).catch(error => {
    if (error.code !== 'ENOENT') logError(`[auto-name] discarded record: ${error.message}`);
  });

  const change = fn => {
    const work = mutation.then(async () => {
      await ready;
      const result = await fn();
      if (result === false) return result;
      await fs.mkdir(appDataPath, { recursive: true });
      await atomicWriteFile(file, JSON.stringify({ version: 2, entries: [...entries.values()] }, null, 2) + '\n');
      return result;
    });
    mutation = work.catch(() => {});
    return work;
  };

  const identity = stat => ({
    dev: String(stat.dev), ino: String(stat.ino), size: String(stat.size),
    mtimeNs: String(stat.mtimeNs),
  });
  const sameFile = (a, b) => a && b && a.ino !== '0' && b.ino !== '0' &&
    a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs;
  const statFor = (root, rel) => fs.lstat(path.join(root.path, rel), { bigint: true });

  async function record(root, rel, template) {
    if (template !== 'page' || !UNTITLED.test(path.basename(rel))) return;
    const stat = await statFor(root, rel);
    const canonical = await fs.realpath(path.join(root.path, rel));
    const authorityIdentity = authority?.identityAt(canonical);
    await change(() => {
      const key = keyFor(root.id, rel);
      entries.set(key, { rootId: root.id, path: rel, recordIdentity: authorityIdentity ?? null,
        fileIdentity: identity(stat) });
      if (authorityIdentity) active.set(key, authorityIdentity);
    });
  }

  async function command(root, request, to) {
    if (!['rename', 'move', 'trash'].includes(request.command)) return;
    const from = request.path;
    await change(() => {
      for (const [key, entry] of [...entries]) {
        if (entry.rootId !== root.id || (entry.path !== from && !entry.path.startsWith(`${from}/`))) continue;
        entries.delete(key);
        if (removed.has(key)) { clearTimeout(removed.get(key)); removed.delete(key); }
        const identityInRoom = active.get(key);
        active.delete(key);
        if (request.command === 'trash' || (request.command === 'rename' && entry.path === from)) continue;
        const next = { ...entry, path: to + entry.path.slice(from.length) };
        const nextKey = keyFor(root.id, next.path);
        entries.set(nextKey, next);
        if (identityInRoom) active.set(nextKey, identityInRoom);
      }
    });
  }

  async function observe(root, event, rel) {
    if (!['add', 'change', 'unlink'].includes(event)) return;
    await ready;
    const key = keyFor(root.id, rel);
    if (event === 'unlink') {
      if (!entries.has(key) || removed.has(key)) return;
      const timer = setTimeout(() => {
        removed.delete(key);
        change(() => { entries.delete(key); active.delete(key); }).catch(error =>
          logError(`[auto-name] deleted record: ${error.message}`));
      }, 1500);
      timer.unref?.();
      removed.set(key, timer);
      return;
    }
    await change(async () => {
      let stat;
      try { stat = await statFor(root, rel); }
      catch (error) { if (error.code === 'ENOENT') return false; throw error; }
      if (!stat.isFile()) return false;
      const stamp = identity(stat);
      if (entries.has(key)) {
        if (removed.has(key)) { clearTimeout(removed.get(key)); removed.delete(key); }
        const currentIdentity = authority?.identityAt(await fs.realpath(path.join(root.path, rel)));
        if (!sameFile(entries.get(key).fileIdentity, stamp) ||
            (active.has(key) && currentIdentity && String(active.get(key)) !== String(currentIdentity))) {
          entries.delete(key);
          active.delete(key);
          return true;
        }
        if (currentIdentity && !active.has(key)) {
          active.set(key, currentIdentity);
          entries.get(key).recordIdentity = currentIdentity;
          return true;
        }
        return false;
      }
      let prior = null;
      for (const candidate of entries) {
        const entry = candidate[1];
        if (entry.rootId !== root.id || !sameFile(entry.fileIdentity, stamp)) continue;
        const oldPath = path.join(root.path, entry.path);
        if (removed.has(candidate[0]) || !(await fs.stat(oldPath).catch(error => {
          if (error.code === 'ENOENT') return null;
          throw error;
        }))) { prior = candidate; break; }
      }
      if (!prior) return false;
      if (removed.has(prior[0])) { clearTimeout(removed.get(prior[0])); removed.delete(prior[0]); }
      entries.delete(prior[0]);
      const identityInRoom = active.get(prior[0]);
      active.delete(prior[0]);
      if (path.basename(prior[1].path) === path.basename(rel)) {
        const currentIdentity = authority?.identityAt(await fs.realpath(path.join(root.path, rel)));
        entries.set(key, { ...prior[1], path: rel,
          recordIdentity: currentIdentity ?? prior[1].recordIdentity });
        if (currentIdentity || identityInRoom) active.set(key, currentIdentity ?? identityInRoom);
      }
      return true;
    });
  }

  async function confirmedWrite(canonicalPath, stamp) {
    const targets = authority?.checkpointTargets(canonicalPath) ?? [];
    await change(() => {
      let changed = false;
      for (const target of targets) {
        const key = keyFor(target.rootId, target.logicalPath);
        const entry = entries.get(key);
        if (!entry || (active.has(key) && String(active.get(key)) !== String(stamp.identity))) continue;
        if (!active.has(key) && !sameFile(entry.fileIdentity, identity(stamp))) continue;
        entry.recordIdentity = stamp.identity;
        entry.fileIdentity = identity(stamp);
        active.set(key, stamp.identity);
        changed = true;
      }
      return changed;
    });
  }

  async function settle(key) {
    await ready;
    const room = authority?.rooms.get(key);
    if (!room || room.emptySince === null || authority.hasParticipatingEditors(key) || checkpoint?.dirty(room)) return;
    const target = authority.checkpointTargets(key).find(item => entries.has(keyFor(item.rootId, item.logicalPath)));
    if (!target) return;
    const recordKey = keyFor(target.rootId, target.logicalPath);
    const entry = entries.get(recordKey);
    if (active.has(recordKey) && String(active.get(recordKey)) !== String(room.nodeId)) return;
    const root = rootFor(entry.rootId);
    if (!root) return;
    try {
      const stat = await statFor(root, entry.path);
      if (!sameFile(entry.fileIdentity, identity(stat))) {
        await change(() => { entries.delete(recordKey); active.delete(recordKey); });
        return;
      }
      const html = await fs.readFile(key, 'utf8');
      const heading = headingOf(html);
      if (!heading) return;
      const base = tidyName(heading);
      if (!base) return;
      for (let number = 1; number <= 20; number++) {
        const name = nameFor(base, number);
        if (name === path.basename(entry.path)) return;
        if (authority.hasParticipatingEditors(key) || checkpoint?.dirty(authority.rooms.get(key))) return;
        try {
          await rename(root, entry.path, name);
          await change(() => { entries.delete(recordKey); active.delete(recordKey); });
          return;
        } catch (error) {
          if (error.reason === 'conflict') continue;
          throw error;
        }
      }
      throw new Error('No free document name');
    } catch (error) {
      logError(`[auto-name] ${entry.rootId}:${entry.path}: ${error.message}`);
    }
  }

  function departed(room) {
    if (!room || scheduled.has(room.key)) return false;
    scheduled.add(room.key);
    setImmediate(async () => {
      try {
        await checkpoint?.pending(room.key)?.catch(() => {});
        await settle(room.key);
      } finally { scheduled.delete(room.key); }
    });
    return true;
  }

  async function removeRoot(rootId) {
    await change(() => {
      for (const [key, entry] of entries) if (entry.rootId === rootId) {
        if (removed.has(key)) { clearTimeout(removed.get(key)); removed.delete(key); }
        entries.delete(key); active.delete(key);
      }
    });
  }

  function close() {
    for (const timer of removed.values()) clearTimeout(timer);
    removed.clear();
  }

  return { record, command, observe, confirmedWrite, settle, departed, removeRoot, close, entries };
}

module.exports = { createAutoNamer, headingOf, nameFor, tidyName, UNTITLED };
