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
    if (stored.version !== 1 || !Array.isArray(stored.entries)) return;
    for (const item of stored.entries) {
      if (typeof item.rootId === 'string' && typeof item.path === 'string' &&
          typeof item.nodeIdentity === 'string') entries.set(keyFor(item.rootId, item.path), item);
    }
  }).catch(error => {
    if (error.code !== 'ENOENT') logError(`[auto-name] discarded record: ${error.message}`);
  });

  const change = fn => {
    const work = mutation.then(async () => {
      await ready;
      const result = await fn();
      await fs.mkdir(appDataPath, { recursive: true });
      await atomicWriteFile(file, JSON.stringify({ version: 1, entries: [...entries.values()] }, null, 2) + '\n');
      return result;
    });
    mutation = work.catch(() => {});
    return work;
  };

  const identity = stat => `${stat.dev}:${stat.ino}`;
  const statFor = (root, rel) => fs.stat(path.join(root.path, rel));

  async function record(root, rel, template) {
    if (template !== 'page' || !UNTITLED.test(path.basename(rel))) return;
    const stat = await statFor(root, rel);
    const canonical = await fs.realpath(path.join(root.path, rel));
    const authorityIdentity = authority?.identityAt(canonical);
    await change(() => {
      const key = keyFor(root.id, rel);
      entries.set(key, { rootId: root.id, path: rel, nodeIdentity: identity(stat) });
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
    let stat;
    try { stat = await statFor(root, rel); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (!stat.isFile()) return;
    const stamp = identity(stat);
    if (entries.has(key)) {
      if (removed.has(key)) { clearTimeout(removed.get(key)); removed.delete(key); }
      if (entries.get(key).nodeIdentity !== stamp) {
        await change(() => { entries.get(key).nodeIdentity = stamp; });
      }
      return;
    }
    const prior = [...entries].find(([, entry]) => entry.rootId === root.id && entry.nodeIdentity === stamp);
    if (!prior) return;
    if (removed.has(prior[0])) { clearTimeout(removed.get(prior[0])); removed.delete(prior[0]); }
    await change(() => {
      entries.delete(prior[0]);
      active.delete(prior[0]);
      if (path.basename(prior[1].path) === path.basename(rel)) entries.set(key, { ...prior[1], path: rel });
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

  return { record, command, observe, settle, departed, removeRoot, close, entries };
}

module.exports = { createAutoNamer, headingOf, nameFor, tidyName, UNTITLED };
