const fsModule = require('fs');
const fs = fsModule.promises;
const path = require('upath');
const { getConsentRegistry, resolveReadPath, resolveWritePath, validateSegments } = require('../utils/path-resolver');
const { withDocumentWrite, withStructureChange, atomicWriteFile } = require('../utils/write-queue');
const { storePageState, movePageState, movePageStateDir } = require('../page-state-store');
const templateManifest = require('../document-templates/manifest.json');

function refusal(reason, message, status = 400) {
  return Object.assign(new Error(message), { reason, status });
}

function safePath(value, { trash = false } = {}) {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.endsWith('/') ||
      value.includes('\\') || value.includes('\0') || value.split('/').some(part => !part || part === '.' || part === '..')) {
    throw refusal('forbidden', 'Invalid path', 403);
  }
  if (trash) {
    if (!value.startsWith('.trash/') || value.split('/').slice(1).some(part => part.startsWith('.'))) {
      throw refusal('forbidden', 'Invalid Trash path', 403);
    }
  } else {
    try { validateSegments(value); } catch { throw refusal('forbidden', 'Invalid path', 403); }
    if (value.split('/').some(part => part === '.trash' || part === '.hyperclay')) {
      throw refusal('forbidden', 'Invalid path', 403);
    }
  }
  return value;
}

function safeName(value) {
  if (typeof value !== 'string' || !value || value.includes('/')) throw refusal('forbidden', 'Invalid name', 403);
  safePath(value);
  return value;
}

async function exists(file) {
  try { await fs.lstat(file); return true; } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function assertTrashDirectory(root) {
  const trash = path.join(root.path, '.trash');
  const stat = await fs.lstat(trash).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (stat && !stat.isDirectory()) throw refusal('forbidden', 'Trash is not a directory', 403);
  return trash;
}

function restoredName(original, index) {
  const extension = path.extname(original);
  const stem = extension ? original.slice(0, -extension.length) : original;
  return `${stem} (restored${index ? ` ${index}` : ''})${extension}`;
}

async function executeCommand({ root, authority, engine, request, tree, moved, changed }) {
  if (!request || typeof request !== 'object') throw refusal('forbidden', 'Invalid command');
  if (request.command === 'create') {
    const template = templateManifest.find(item => item.id === request.template);
    if (!template) throw refusal('unsupported', 'Unknown document template', 501);
    const parent = request.parent == null || request.parent === '' ? '' : safePath(request.parent);
    const name = safeName(request.name);
    const rel = parent ? `${parent}/${name}` : name;
    const registry = getConsentRegistry(root.path);
    const bytes = await fs.readFile(path.join(__dirname, '../document-templates', template.file));
    const html = bytes.toString('utf8');
    const runCreate = () => withDocumentWrite(async () => {
      const destination = await resolveWritePath(registry, rel);
      return { canonicalPath: destination };
    }, async ({ canonicalPath }, token) => {
      const parentPath = parent ? await resolveReadPath(registry, parent) : await fs.realpath(root.path);
      if (!(await fs.stat(parentPath)).isDirectory()) throw refusal('forbidden', 'Parent is not a folder', 403);
      if (await exists(canonicalPath)) throw refusal('conflict', 'Destination exists', 409);
      const claim = authority?.captureAdmission({ rootId: root.id, logicalPath: rel, canonicalPath });
      const target = authority?.admitWriteTarget(claim, {
        rootId: root.id, logicalPath: rel, canonicalPath, origin: null, live: null,
      }, token, { explicitCreate: true });
      await atomicWriteFile(canonicalPath, await storePageState(root.path, rel, html), null);
      if (target) await authority.confirmKnownWrite(target, html, token);
      await tree.scan(rel);
      changed(root.id, [rel]);
      return { path: rel };
    });
    return engine?.serial ? engine.serial(runCreate) : runCreate();
  }
  const run = async () => withStructureChange(async token => {
    const registry = getConsentRegistry(root.path);
    const parentOf = value => value == null || value === '' ? '' : safePath(value);
    const targetFor = async rel => resolveWritePath(registry, rel);
    const readFor = async rel => resolveReadPath(registry, rel);

    if (request.command === 'folder') {
      const parent = parentOf(request.parent);
      const name = safeName(request.name);
      const rel = parent ? `${parent}/${name}` : name;
      const destination = await targetFor(rel);
      if (await exists(destination)) throw refusal('conflict', 'Destination exists', 409);
      const parentPath = parent ? await readFor(parent) : await fs.realpath(root.path);
      if (!(await fs.stat(parentPath)).isDirectory()) throw refusal('forbidden', 'Parent is not a folder', 403);
      await fs.mkdir(destination);
      authority?.setAdmission(token, { rootId: root.id, logicalPath: rel, canonicalPath: destination, active: true, prefix: true });
      await tree.refresh([rel]);
      changed(root.id, [rel]);
      return { path: rel };
    }

    if (request.command === 'empty-trash') {
      const trash = await assertTrashDirectory(root);
      if (await exists(trash)) {
        for (const name of await fs.readdir(trash)) await fs.rm(path.join(trash, name), { recursive: true, force: true });
      }
      changed(root.id, []);
      return { path: null };
    }

    const restoring = request.command === 'restore-trash';
    if (restoring || request.command === 'trash') await assertTrashDirectory(root);
    const fromRel = restoring ? safePath(request.trashPath, { trash: true }) : safePath(request.path);
    const fromLocation = path.join(root.path, fromRel);
    const fromStat = await fs.lstat(fromLocation).catch(error => {
      if (error.code === 'ENOENT') throw refusal('missing', 'Source is missing', 404);
      throw error;
    });
    if (fromStat.isSymbolicLink()) throw refusal('forbidden', 'Links cannot be moved from the workspace', 403);
    const fromCanonical = await readFor(fromRel);
    let toRel = null;
    if (request.command === 'rename' || request.command === 'duplicate') {
      toRel = path.join(path.dirname(fromRel), safeName(request.name));
    } else if (request.command === 'move') {
      const parent = parentOf(request.parent);
      toRel = parent ? `${parent}/${path.basename(fromRel)}` : path.basename(fromRel);
    } else if (request.command === 'trash') {
      toRel = `.trash/${fromRel}`;
    } else if (restoring) {
      toRel = safePath(fromRel.slice('.trash/'.length));
    } else {
      throw refusal('unsupported', 'Unknown command', 501);
    }
    if (request.command !== 'trash') safePath(toRel);
    if (fromRel === toRel) return { path: toRel };
    if (fromStat.isDirectory() && toRel.startsWith(`${fromRel}/`)) throw refusal('forbidden', 'A folder cannot move into itself', 403);
    let destination = await targetFor(toRel);
    if (restoring) {
      let index = 0;
      while (await exists(destination)) {
        toRel = path.join(path.dirname(toRel), restoredName(path.basename(fromRel), index++));
        destination = await targetFor(toRel);
      }
    } else if (request.command === 'trash') {
      const extension = path.extname(toRel);
      const stem = extension ? toRel.slice(0, -extension.length) : toRel;
      let index = 0;
      while (await exists(destination)) {
        toRel = `${stem}-${++index}${extension}`;
        destination = await targetFor(toRel);
      }
    } else if (await exists(destination)) {
      const targetStat = await fs.lstat(destination);
      if (request.command !== 'rename' || targetStat.dev !== fromStat.dev || targetStat.ino !== fromStat.ino) {
        throw refusal('conflict', 'Destination exists', 409);
      }
    }
    if (request.command === 'move') {
      const parent = parentOf(request.parent);
      const parentPath = parent ? await readFor(parent) : await fs.realpath(root.path);
      if (!(await fs.stat(parentPath)).isDirectory()) throw refusal('forbidden', 'Parent is not a folder', 403);
    }

    const structural = request.command !== 'duplicate';
    const step = {
      from: { location: fromLocation, canonical: fromCanonical, isDir: fromStat.isDirectory(), isSymlink: false },
      to: request.command === 'trash' ? null : { location: path.join(root.path, toRel), canonical: destination },
      fromRel,
      toRel: request.command === 'trash' ? null : toRel,
    };
    const plan = structural && authority ? authority.prepareStructure(token, { rootId: root.id, steps: [step] }) : null;
    let completed = 0;
    try {
      await fs.mkdir(path.dirname(destination), { recursive: true });
      if (request.command === 'duplicate') {
        if (fromStat.isDirectory()) await fs.cp(fromCanonical, destination, { recursive: true, errorOnExist: true, force: false });
        else await fs.copyFile(fromCanonical, destination, fsModule.constants.COPYFILE_EXCL);
        authority?.setAdmission(token, { rootId: root.id, logicalPath: toRel, canonicalPath: destination,
          active: true, prefix: fromStat.isDirectory() });
      } else {
        await fs.rename(fromLocation, destination);
        completed = 1;
        if (request.command === 'rename' || request.command === 'move') {
          if (fromStat.isDirectory()) await movePageStateDir(root.path, fromRel, toRel);
          else await movePageState(root.path, fromRel, toRel);
        }
      }
    } finally {
      if (plan) {
        if (completed) authority.commitStructure(plan, completed, token);
        authority.releaseStructure(plan, token);
      }
    }
    if (structural) {
      tree.moved(fromRel, toRel);
      if (restoring) await tree.scan(toRel);
      moved(root.id, fromRel, toRel);
    } else {
      await tree.scan(toRel);
      changed(root.id, [toRel]);
    }
    return { path: toRel };
  });
  return engine?.serial ? engine.serial(run) : run();
}

module.exports = { executeCommand, safePath, refusal };
