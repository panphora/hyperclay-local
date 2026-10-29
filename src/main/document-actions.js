const { app, shell } = require('electron');
const fs = require('fs').promises;
const path = require('upath');
const { exportDocumentZip } = require('./export-zip');
const { VERSIONS_DIR } = require('./utils/artifact-paths');
const { freeZipName } = require('./utils/free-name');

const MESSAGES = {
  reveal: "Couldn't show the file.",
  versions: "Couldn't open the versions folder.",
  export: "Couldn't export the document.",
  codeEditor: "Couldn't open the code editor.",
  duplicate: "Couldn't duplicate the document.",
};

function createDocumentActions({ roots, shellServer, workspaceWindow }) {
  const rootFor = (rootId) => (roots() || []).find((root) => root.id === rootId) || null;

  return {
    reveal: async (rootId, absPath) => {
      if (!rootFor(rootId)) return { ok: false, message: MESSAGES.reveal };
      try {
        shell.showItemInFolder(absPath);
        return { ok: true };
      } catch {
        return { ok: false, message: MESSAGES.reveal };
      }
    },

    versions: async (rootId, rel) => {
      const root = rootFor(rootId);
      if (!root) return { ok: false, message: MESSAGES.versions };
      const dir = path.join(root.path, VERSIONS_DIR, rel.replace(/\.(html|htmlclay)$/i, ''));
      try {
        await fs.mkdir(dir, { recursive: true });
        const failure = await shell.openPath(dir);
        return failure ? { ok: false, message: MESSAGES.versions } : { ok: true };
      } catch {
        return { ok: false, message: MESSAGES.versions };
      }
    },

    export: async (rootId, absPath) => {
      const root = rootFor(rootId);
      if (!root) return { ok: false, message: MESSAGES.export };
      try {
        const downloads = app.getPath('downloads');
        const stem = path.basename(absPath).replace(/\.(html?|htmlclay|xhtml)$/i, '');
        const outPath = path.join(downloads, await freeZipName(downloads, stem));
        const written = await exportDocumentZip(absPath, outPath, { uploadsDir: path.join(root.path, 'uploads') });
        shell.showItemInFolder(written);
        return { ok: true };
      } catch {
        return { ok: false, message: MESSAGES.export };
      }
    },

    codeEditor: async (rootId, rel) => {
      if (!rootFor(rootId)) return { ok: false, message: MESSAGES.codeEditor };
      try {
        await workspaceWindow().openWorkspace({
          path: `/roots/${encodeURIComponent(rootId)}/document?path=${encodeURIComponent(rel)}&panel=code`,
        });
        return { ok: true };
      } catch {
        return { ok: false, message: MESSAGES.codeEditor };
      }
    },

    duplicate: async (rootId, rel) => {
      const root = rootFor(rootId);
      if (!root) return { ok: false, message: MESSAGES.duplicate };
      try {
        const copy = await shellServer().duplicate(rootId, rel);
        const address = copy.path.split('/').map(encodeURIComponent).join('/');
        return { ok: true, href: `http://localhost:${root.port}/${address}` };
      } catch {
        return { ok: false, message: MESSAGES.duplicate };
      }
    },
  };
}

module.exports = { createDocumentActions };
