const fs = require('fs/promises');
const path = require('path');
const { VERSIONS_DIR } = require('./utils/artifact-paths');
const { readPageState } = require('./page-state-store.js');
const { canonicalizeBase, rebaseOntoCanonical, assertRealDirChain } = require('./utils/real-dir-chain');
const { VERSION_NAME, compareNewestFirst } = require('./utils/prune-versions.js');

const rooms = () => require('@panphora/clayjs/server/rooms');
const createDocument = () => {
  const { JSDOM } = require('jsdom');
  return new JSDOM('<!doctype html><html><body></body></html>', { runScripts: undefined, resources: undefined }).window.document;
};

// A page save based on an older version, merged onto the stored page; null when
// the save is not that (it carries the page tag, it already has the stored rev,
// there is no record, or no version of the last 50 has its rev).
//
// The stored page is a page known to have landed: the file on disk with its own
// record, or, where the disk already holds the older copy (what the observer sees),
// the document the local authority last confirmed. The newest record alone is not
// that: it may be for a write that never landed.
//
// A rebase is a merge input, never a reason a write fails: a history that cannot
// be read, or a merge that throws, leaves the caller writing as it would have.
async function rebaseStaleSave(baseDir, name, content, newestFirst, { stored = null } = {}) {
  try {
    const { splitPage, pageRev, rebasePage, closestBase } = rooms();
    if (splitPage(content).state) return null;
    const rev = pageRev(content);
    if (!rev) return null;
    let storedHtml;
    let state;
    if (stored) {
      const parts = splitPage(stored);
      storedHtml = parts.file;
      state = parts.state ?? await readPageState(baseDir, name, { rev: pageRev(stored), exact: true });
    } else {
      try { storedHtml = await fs.readFile(path.join(baseDir, name), 'utf8'); } catch { return null; }
      state = await readPageState(baseDir, name, { rev: pageRev(storedHtml), exact: true });
    }
    if (!state || state.rev === rev) return null;
    const dir = path.join(baseDir, VERSIONS_DIR, name.replace(/\.(html|htmlclay)$/i, ''));
    const files = (await newestFirst(dir, baseDir)).slice(0, 50);
    const versionsWith = async (wanted) => {
      const found = [];
      for (const file of files) {
        let html;
        try { html = await fs.readFile(path.join(dir, file), 'utf8'); } catch { continue; }
        if (html.includes(wanted) && pageRev(html) === wanted) found.push(html);
      }
      return found;
    };
    const baseHtml = closestBase(await versionsWith(rev), content, createDocument);
    if (!baseHtml) return null;
    return rebasePage({ storedHtml, state, incomingHtml: content, baseHtml, createDocument });
  } catch (error) {
    console.error('[page-rebase] rebase failed, writing as before', error && error.message ? error.message : error);
    return null;
  }
}

// The version files of one page, newest first, as the save path lists them: the
// base a stale save is rebased onto is the version carrying its rev that it shares the most blocks with.
// History is read only from inside the served folder: a versions directory
// reached through a symlink yields nothing, and a symlinked entry is never read.
async function newestVersionFiles(dir, baseDir = null) {
  if (baseDir) {
    try {
      const canonicalBase = await canonicalizeBase(baseDir);
      await assertRealDirChain(canonicalBase, rebaseOntoCanonical(canonicalBase, baseDir, dir));
    } catch { return []; }
  }
  let names;
  try { names = await fs.readdir(dir); } catch { return []; }
  const entries = [];
  for (const name of names) {
    if (!VERSION_NAME.test(name) || !name.toLowerCase().endsWith('.html')) continue;
    try {
      const stat = await fs.lstat(path.join(dir, name));
      if (stat.isFile()) entries.push({ name, mtimeMs: stat.mtimeMs });
    } catch {}
  }
  entries.sort(compareNewestFirst);
  return entries.map((entry) => entry.name);
}

function needsAdoption(html) {
  try { return require('@panphora/clayjs/server/checkpoint').needsAdoption(html, { createDocument }); } catch { return false; }
}

module.exports = { rebaseStaleSave, needsAdoption, createDocument, newestVersionFiles };
