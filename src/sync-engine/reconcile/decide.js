const A = Object.freeze({
  NOOP: 'noop',
  UPLOAD: 'upload',
  DOWNLOAD: 'download',
  ADOPT: 'adopt',
  CONFLICT: 'conflict',
  TRASH_LOCAL: 'trash-local',
  DELETE_REMOTE: 'delete-remote',
  CREATE_REMOTE: 'create-remote',
  FORGET: 'forget',
  DEFER: 'defer',
});

/**
 * @param {object} input
 * @param {null|{remoteEtag:string|null, localChecksum:string|null, uploadBlocked?:boolean}} input.baseline
 * @param {null|{checksum:string}} input.local    null = no file on disk
 * @param {null|{etag:string}} input.remote       null = absent from the inventory
 * @param {boolean} input.complete                the inventory said complete: true
 * @param {boolean} input.bootstrap               first pass after a legacy import or lost map
 * @returns {{action:string, conflictKind?:string}}
 */
function decide({ baseline, local, remote, complete, bootstrap = false }) {
  if (!remote && !complete) return { action: A.DEFER };

  const known = baseline && baseline.remoteEtag && baseline.localChecksum;

  if (!known) {
    if (local && remote) {
      return local.checksum === remote.etag
        ? { action: A.ADOPT }
        : { action: A.CONFLICT, conflictKind: 'unbound' };
    }
    if (local) return { action: A.CREATE_REMOTE };
    if (remote) return { action: A.DOWNLOAD };
    return { action: A.FORGET };
  }

  const localChanged = local ? local.checksum !== baseline.localChecksum : true;
  const remoteChanged = remote ? remote.etag !== baseline.remoteEtag : true;

  if (local && remote) {
    if (!localChanged && !remoteChanged) return { action: A.NOOP };
    if (localChanged && !remoteChanged) {
      return baseline.uploadBlocked ? { action: A.NOOP } : { action: A.UPLOAD };
    }
    if (!localChanged && remoteChanged) return { action: A.DOWNLOAD };
    return local.checksum === remote.etag
      ? { action: A.ADOPT }
      : { action: A.CONFLICT, conflictKind: 'both-edited' };
  }

  if (local && !remote) {
    return localChanged
      ? { action: A.CONFLICT, conflictKind: 'remote-deleted' }
      : { action: A.TRASH_LOCAL };
  }

  if (!local && remote) {
    if (remoteChanged || bootstrap) return { action: A.DOWNLOAD };
    return { action: A.DELETE_REMOTE };
  }

  return { action: A.FORGET };
}

function decidePath({ basePath, localPath, remotePath }) {
  if (localPath === remotePath) return { action: 'adopt-path' };
  const localMoved = localPath !== basePath;
  const remoteMoved = remotePath !== basePath;
  if (localMoved && !remoteMoved) return { action: 'move-remote' };
  if (!localMoved && remoteMoved) return { action: 'move-local' };
  return { action: 'move-local', notice: 'path-conflict' };
}

module.exports = { decide, decidePath, A };
