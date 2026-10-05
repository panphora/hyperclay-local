'use strict';

const fs = require('fs');
const path = require('path');
const { createLocalGitReader } = require('./release-local-read');
const { readPublicationEvidence } = require('./release-publication');
const { readCompletedTargetEvidence, readTargetEvidence } = require('./release-target-evidence');
const { readPreparedTarget } = require('./release-docs-plan');

const localReader = createLocalGitReader();

function requireManifestPath(file, root, io) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || path.normalize(file) !== file
    || file.includes('\0') || !file.startsWith(root + path.sep)
    || io.realpathSync(file) !== file) {
    throw new Error('The size manifest is not confined to the release evidence root.');
  }
  const leaf = io.lstatSync(file);
  if (leaf.isSymbolicLink() || !leaf.isFile()) throw new Error('The size manifest is not an ordinary file.');
  let parent = path.dirname(file);
  while (true) {
    const stat = io.lstatSync(parent);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('The size manifest parent is not ordinary.');
    const next = path.dirname(parent);
    if (next === parent) break;
    parent = next;
  }
}

function readSizeEvidence({ state, repoDir }, { run = localReader.run, spawn = localReader.spawn, fs: io = fs } = {}) {
  try {
    if (!state || state.mode !== 'publish' || state.artifacts?.state !== 'complete'
      || state.sizes?.state !== 'complete' || typeof state.sizes.journalFile !== 'string'
      || typeof state.sizes.commit !== 'string' || state.sizes.reason !== null) {
      throw new Error('Complete publication and size evidence are required.');
    }
    const deps = { run, spawn, fs: io };
    const publication = readPublicationEvidence({ state, repoDir }, deps);
    const root = path.join(repoDir, 'records', state.releaseId);
    const completed = readCompletedTargetEvidence({
      journalFile: state.sizes.journalFile,
      evidenceRoot: root,
      repo: 'hyperclay-local',
      version: state.version,
      commit: state.sizes.commit
    }, deps);
    const { journal, application, objectStore } = readTargetEvidence(state.sizes.journalFile, deps);
    for (const key of ['root', 'commonDir', 'key', 'objectFormat']) {
      if (objectStore[key] !== state.repo[key]) throw new Error('Size evidence uses a different object store.');
    }
    if (journal.phase !== 'complete' || journal.state !== 'complete' || journal.reason !== null
      || journal.repo !== completed.repo || journal.version !== completed.version
      || journal.commit !== completed.commit || journal.remoteObservation.head !== completed.observedHead
      || journal.remoteObservation.observedAt !== completed.verifiedAt) {
      throw new Error('Size completion evidence changed during verification.');
    }
    const descriptor = readPreparedTarget(application.preparedFile, {
      repo: 'hyperclay-local', version: state.version
    });
    if (descriptor.sha256 !== application.preparedSha256) {
      throw new Error('The size descriptor differs from the verified application.');
    }
    const binding = descriptor.target.publication;
    if (binding.manifestFile !== state.artifacts.manifestFile
      || binding.manifestSha256 !== state.artifacts.manifestSha256
      || binding.sourceSha !== state.sourceSha || binding.sourceSha !== publication.sourceSha) {
      throw new Error('The size descriptor uses different publication evidence.');
    }
    requireManifestPath(binding.manifestFile, root, io);
    return { commit: state.sizes.commit, verifiedAt: completed.verifiedAt };
  } catch (cause) {
    const error = new Error('The retained size evidence is invalid.', { cause });
    error.code = 'SIZE_EVIDENCE_INVALID';
    throw error;
  }
}

module.exports = { readSizeEvidence };
