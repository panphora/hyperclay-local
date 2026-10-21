const fs = require('fs').promises;
const path = require('upath');
const {
  withFileLock,
  withDocumentWrite,
  withStructureChange,
  assertStructureContext,
} = require('../main/utils/write-queue');
const { getConsentRegistry, resolveWritePath, realpathNearestParent } = require('../main/utils/path-resolver');
const { LocalAuthorityError } = require('../main/local-authority');

class StaleLocalWriteError extends Error {}

async function canonicalPathFor(engine, rel) {
  engine.resolveContainedPath(rel);
  return resolveWritePath(getConsentRegistry(engine.syncFolder), rel);
}

async function structureEntryFor(engine, rel) {
  const registry = getConsentRegistry(engine.syncFolder);
  await registry.ready();
  engine.resolveContainedPath(rel);
  const lexical = path.resolve(path.join(engine.syncFolder, rel));
  const parent = await realpathNearestParent(path.dirname(lexical));
  const location = path.join(parent, path.basename(lexical));
  const stat = await fs.lstat(location).catch((error) => {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  });
  if (!stat) return { location, canonical: location, exists: false };
  return {
    location,
    canonical: stat.isSymbolicLink() ? await resolveWritePath(registry, rel) : location,
    isDir: stat.isDirectory(),
    isSymlink: stat.isSymbolicLink(),
    exists: true,
  };
}

async function claimLocalDocumentTarget(engine, rel) {
  const canonicalPath = await canonicalPathFor(engine, rel);
  const authority = engine.localAuthority;
  const admissionClaim = authority ? authority.captureAdmission({
    rootId: engine.rootId, logicalPath: rel, canonicalPath,
  }) : null;
  return Object.freeze({ canonicalPath, admissionClaim, target: null });
}

async function withLocalDocumentWrite(engine, rel, fn, { generation = engine.generation, claim = null, explicitCreate = false } = {}) {
  const admitted = claim ?? await claimLocalDocumentTarget(engine, rel);
  const claimedPath = admitted.canonicalPath;
  const authority = engine.localAuthority;
  if (!authority) {
    return withFileLock(claimedPath, () => fn({ canonicalPath: claimedPath }, null));
  }

  try {
    return await withDocumentWrite(
      async () => ({ canonicalPath: claimedPath }),
      async (_locked, token) => {
        if (generation !== engine.generation) throw new StaleLocalWriteError();
        const currentPath = await canonicalPathFor(engine, rel);
        if (currentPath !== claimedPath) throw new StaleLocalWriteError();
        const location = { rootId: engine.rootId, logicalPath: rel, canonicalPath: currentPath };
        const absent = explicitCreate &&
          await fs.stat(currentPath).then(() => false, (error) => error.code === 'ENOENT');
        if (explicitCreate && authority.isRetired(location) && !absent) throw new StaleLocalWriteError();
        let target;
        try {
          target = authority.admitWriteTarget(admitted.admissionClaim, {
            ...location, origin: null, live: engine.live,
          }, token, { explicitCreate: absent });
        } catch (error) {
          if (error instanceof LocalAuthorityError && error.code === 'moved') throw new StaleLocalWriteError();
          throw error;
        }
        return fn(target, token);
      },
    );
  } catch (error) {
    if (error instanceof StaleLocalWriteError) return { stale: true };
    throw error;
  }
}

async function withLocalDirectoryChange(engine, rel, fn, { generation = engine.generation } = {}) {
  const claimedPath = await canonicalPathFor(engine, rel);
  const authority = engine.localAuthority;
  if (!authority) return fn({ canonicalPath: claimedPath }, null);

  const location = { rootId: engine.rootId, logicalPath: rel, canonicalPath: claimedPath };
  const claim = authority.captureAdmission(location);
  try {
    return await withStructureChange(async (token) => {
      assertStructureContext(token);
      if (generation !== engine.generation) throw new StaleLocalWriteError();
      const currentPath = await canonicalPathFor(engine, rel);
      if (currentPath !== claimedPath) throw new StaleLocalWriteError();
      try {
        authority.validateAdmission(claim, location, token, { allowRetired: true });
      } catch (error) {
        if (error instanceof LocalAuthorityError && error.code === 'moved') throw new StaleLocalWriteError();
        throw error;
      }
      const retired = authority.isRetired(location);
      const before = await fs.stat(currentPath).then((stat) => stat, (error) => {
        if (error.code === 'ENOENT') return null;
        if (retired) throw new StaleLocalWriteError();
        throw error;
      });
      if (retired && before) throw new StaleLocalWriteError();
      const result = await fn({ canonicalPath: currentPath }, token);
      const after = await fs.stat(currentPath).then((stat) => stat, (error) => {
        if (error.code === 'ENOENT') throw new StaleLocalWriteError();
        throw error;
      });
      if (!after.isDirectory()) throw new StaleLocalWriteError();
      if (!before) authority.setAdmission(token, { ...location, active: true, prefix: true });
      return result;
    });
  } catch (error) {
    if (error instanceof StaleLocalWriteError) return { stale: true };
    throw error;
  }
}

async function withLocalStructureDelete(engine, rel, move, { generation = engine.generation, isDir = false } = {}) {
  const authority = engine.localAuthority;
  if (!authority) return { legacy: true };
  return withStructureChange(async (token) => {
    assertStructureContext(token);
    if (generation !== engine.generation) return { stale: true };
    const source = await structureEntryFor(engine, rel);
    if (!source.exists) {
      authority.setAdmission(token, {
        rootId: engine.rootId,
        logicalPath: rel,
        canonicalPath: source.canonical,
        active: false,
        prefix: isDir,
      });
      return { missing: true };
    }
    const plan = authority.prepareStructure(token, {
      rootId: engine.rootId,
      steps: [{ from: source, fromRel: rel, to: null }],
    });
    try {
      await move(source.location);
      authority.commitStructure(plan, 1, token);
      return { moved: true };
    } finally {
      authority.releaseStructure(plan, token);
    }
  });
}

module.exports = { withLocalDocumentWrite, withLocalDirectoryChange, withLocalStructureDelete, claimLocalDocumentTarget, structureEntryFor };
