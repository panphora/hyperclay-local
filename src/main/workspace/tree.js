const fs = require('fs').promises;
const path = require('upath');
const { documentEtag } = require('../spec-wire');

const PAGE_LIMIT = 50;
const DOCUMENT = /\.(?:html|htmlclay)$/i;
const HIDDEN = new Set(['node_modules', 'sites-versions', 'tailwindcss', '.trash', '.hyperclay']);

function visible(rel) {
  return rel.split('/').every(part => part && !part.startsWith('.') && !HIDDEN.has(part));
}

function kindOf(name, stat) {
  return stat.isDirectory() ? 'folder' : DOCUMENT.test(name) ? 'document' : 'upload';
}

async function entryFor(root, rel) {
  if (!visible(rel)) return null;
  const file = path.join(root.path, rel);
  const stat = await fs.lstat(file).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!stat || stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) return null;
  const kind = kindOf(rel, stat);
  const bytes = kind === 'document' ? await fs.readFile(file).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  }) : null;
  if (kind === 'document' && !bytes) return null;
  const etag = bytes ? documentEtag(bytes) : null;
  return {
    path: rel, kind, name: path.basename(rel), updatedAt: stat.mtime.toISOString(),
    size: stat.isFile() ? stat.size : null, etag, replication: 'local-only', nodeId: null,
  };
}

class RootTree {
  constructor(root, observer, changed) {
    this.root = root;
    this.observer = observer;
    this.changed = changed;
    this.entries = new Map();
    this.generation = 0;
    this.pending = [];
    this.ready = null;
    this.closed = false;
    this.ignore = new Map();
    this.updateChain = Promise.resolve();
  }

  start() {
    if (this.ready) return this.ready;
    this.unsubscribe = this.observer?.subscribe(({ event, rel }) => {
      if (!visible(rel)) return;
      const ignoredUntil = this.ignore.get(rel);
      if (ignoredUntil && ignoredUntil > Date.now() && event !== 'change') return;
      if (this.scanning) this.pending.push({ event, rel });
      else this.updateChain = this.updateChain.then(() => this.apply(event, rel)).catch(() => {});
    });
    this.scanning = true;
    this.observer?.start?.();
    this.ready = (async () => {
      try {
        await this.walk('');
        while (this.pending.length) {
          const batch = this.pending.splice(0);
          for (const { event, rel } of batch) await this.apply(event, rel);
        }
        this.scanning = false;
        return this;
      } catch (error) {
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.ready = null;
        this.scanning = false;
        throw error;
      }
    })();
    return this.ready;
  }

  async walk(parent) {
    const dir = path.join(this.root.path, parent);
    const children = await fs.readdir(dir, { withFileTypes: true }).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    for (const child of children) {
      const rel = parent ? `${parent}/${child.name}` : child.name;
      if (!visible(rel) || child.isSymbolicLink()) continue;
      const entry = await entryFor(this.root, rel);
      if (entry) this.entries.set(rel, entry);
      if (child.isDirectory()) await this.walk(rel);
    }
  }

  async apply(event, rel) {
    if (this.closed) return;
    if (event === 'unlink' || event === 'unlinkDir') {
      for (const key of this.entries.keys()) {
        if (key === rel || key.startsWith(`${rel}/`)) this.entries.delete(key);
      }
    } else {
      const entry = await entryFor(this.root, rel);
      if (entry) this.entries.set(rel, entry);
      else this.entries.delete(rel);
    }
    this.generation++;
    this.changed(this.root.id, rel);
  }

  async refresh(paths) {
    for (const rel of paths) await this.apply('change', rel);
  }

  async scan(rel) {
    const entry = await entryFor(this.root, rel);
    if (!entry) return;
    this.entries.set(rel, entry);
    if (entry.kind === 'folder') await this.walk(rel);
    this.generation++;
  }

  moved(from, to) {
    this.ignore.set(from, Date.now() + 1500);
    this.ignore.set(to, Date.now() + 1500);
    const moved = [...this.entries].filter(([key]) => key === from || key.startsWith(`${from}/`));
    for (const [key] of moved) this.entries.delete(key);
    for (const [key, entry] of moved) {
      const newPath = to + key.slice(from.length);
      if (visible(newPath)) this.entries.set(newPath, { ...entry, path: newPath, name: path.basename(newPath) });
    }
    this.generation++;
  }

  all() { return [...this.entries.values()]; }

  page(items, cursor, key) {
    let offset = 0;
    if (cursor) {
      let decoded;
      try { decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch {}
      if (!decoded || decoded.g !== this.generation || decoded.k !== key || !Number.isInteger(decoded.o) || decoded.o < 0) {
        const error = new Error('Listing changed. Refresh and try again.');
        error.status = 409;
        error.reason = 'conflict';
        throw error;
      }
      offset = decoded.o;
    }
    const end = offset + PAGE_LIMIT;
    return { items: items.slice(offset, end), nextCursor: end < items.length
      ? Buffer.from(JSON.stringify({ g: this.generation, k: key, o: end })).toString('base64url') : null };
  }

  close() { this.closed = true; this.unsubscribe?.(); }
}

module.exports = { RootTree, PAGE_LIMIT, entryFor, visible };
