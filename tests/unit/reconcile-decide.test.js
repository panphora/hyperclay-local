/**
 * C3.2: decide is the one decision function. It compares the last verified baseline,
 * the local file and the remote inventory entry by checksum, never by mtime, and
 * decidePath says where a node lives. The rows mirror section 5.4 of the C3 stage.
 */

const { decide, decidePath, A } = require('../../src/sync-engine/reconcile/decide');

const BASE = { remoteEtag: 'etag-1', localChecksum: 'sum-1' };
const BLOCKED = { ...BASE, uploadBlocked: true };

const local = (checksum) => ({ checksum });
const remote = (etag) => ({ etag });

const DECIDE_ROWS = [
  [
    'an incomplete inventory with no remote entry defers, whatever the baseline and the file say',
    { baseline: BASE, local: local('sum-1'), remote: null, complete: false },
    { action: A.DEFER },
  ],
  [
    'known, unchanged on both sides: noop',
    { baseline: BASE, local: local('sum-1'), remote: remote('etag-1'), complete: true },
    { action: A.NOOP },
  ],
  [
    'known, the local file changed, the remote did not: upload',
    { baseline: BASE, local: local('sum-2'), remote: remote('etag-1'), complete: true },
    { action: A.UPLOAD },
  ],
  [
    'known and uploadBlocked, the local file changed, the remote did not: noop',
    { baseline: BLOCKED, local: local('sum-2'), remote: remote('etag-1'), complete: true },
    { action: A.NOOP },
  ],
  [
    'known, the local file is unchanged, the remote changed: download',
    { baseline: BASE, local: local('sum-1'), remote: remote('etag-2'), complete: true },
    { action: A.DOWNLOAD },
  ],
  [
    'known, changed on both sides, with equal bytes: adopt',
    { baseline: BASE, local: local('sum-9'), remote: remote('sum-9'), complete: true },
    { action: A.ADOPT },
  ],
  [
    'known, changed on both sides, with different bytes: conflict both-edited',
    { baseline: BASE, local: local('sum-2'), remote: remote('etag-2'), complete: true },
    { action: A.CONFLICT, conflictKind: 'both-edited' },
  ],
  [
    'known, the local file is unchanged, the remote is gone and the inventory is complete: trash-local',
    { baseline: BASE, local: local('sum-1'), remote: null, complete: true },
    { action: A.TRASH_LOCAL },
  ],
  [
    'known, the local file changed, the remote is gone: conflict remote-deleted',
    { baseline: BASE, local: local('sum-2'), remote: null, complete: true },
    { action: A.CONFLICT, conflictKind: 'remote-deleted' },
  ],
  [
    'known, the local file is gone, the remote is unchanged: delete-remote',
    { baseline: BASE, local: null, remote: remote('etag-1'), complete: true },
    { action: A.DELETE_REMOTE },
  ],
  [
    'known, the local file is gone, the remote changed: download',
    { baseline: BASE, local: null, remote: remote('etag-2'), complete: true },
    { action: A.DOWNLOAD },
  ],
  [
    'known, bootstrap, the local file is gone and the remote is unchanged: download',
    { baseline: BASE, local: null, remote: remote('etag-1'), complete: true, bootstrap: true },
    { action: A.DOWNLOAD },
  ],
  [
    'known, gone on both sides: forget',
    { baseline: BASE, local: null, remote: null, complete: true },
    { action: A.FORGET },
  ],
  [
    'unknown, the local bytes equal the remote: adopt',
    { baseline: null, local: local('sum-1'), remote: remote('sum-1'), complete: true },
    { action: A.ADOPT },
  ],
  [
    'unknown, the local bytes differ from the remote: conflict unbound',
    { baseline: null, local: local('sum-1'), remote: remote('etag-1'), complete: true },
    { action: A.CONFLICT, conflictKind: 'unbound' },
  ],
  [
    'unknown, present locally, absent from a complete inventory: create-remote',
    { baseline: null, local: local('sum-1'), remote: null, complete: true },
    { action: A.CREATE_REMOTE },
  ],
  [
    'unknown, absent locally, present remotely: download',
    { baseline: null, local: null, remote: remote('etag-1'), complete: true },
    { action: A.DOWNLOAD },
  ],
];

const PATH_ROWS = [
  [
    'the paths already agree: adopt-path',
    { basePath: 'board.html', localPath: 'board.html', remotePath: 'board.html' },
    { action: 'adopt-path' },
  ],
  [
    'only the local file moved: move-remote',
    { basePath: 'board.html', localPath: 'notes.html', remotePath: 'board.html' },
    { action: 'move-remote' },
  ],
  [
    'only the remote moved: move-local',
    { basePath: 'board.html', localPath: 'board.html', remotePath: 'notes.html' },
    { action: 'move-local' },
  ],
  [
    'both moved differently: the remote path wins with a notice',
    { basePath: 'board.html', localPath: 'notes.html', remotePath: 'archive.html' },
    { action: 'move-local', notice: 'path-conflict' },
  ],
];

describe('decide', () => {
  it.each(DECIDE_ROWS)('%s', (name, input, expected) => {
    expect(decide(input)).toEqual(expected);
  });

  it('bootstrap turns delete-remote into download', () => {
    expect(decide({ baseline: BASE, local: null, remote: remote('etag-1'), complete: true }))
      .toEqual({ action: A.DELETE_REMOTE });
    expect(decide({ baseline: BASE, local: null, remote: remote('etag-1'), complete: true, bootstrap: true }))
      .toEqual({ action: A.DOWNLOAD });
  });

  it('uploadBlocked suppresses upload but not download', () => {
    expect(decide({ baseline: BLOCKED, local: local('sum-2'), remote: remote('etag-1'), complete: true }))
      .toEqual({ action: A.NOOP });
    expect(decide({ baseline: BLOCKED, local: local('sum-1'), remote: remote('etag-2'), complete: true }))
      .toEqual({ action: A.DOWNLOAD });
  });

  it('incomplete inventory defers even when the baseline says the file was deleted locally', () => {
    expect(decide({ baseline: BASE, local: null, remote: null, complete: false }))
      .toEqual({ action: A.DEFER });
  });

  it('the table has one row per distinct shape in 5.4, so no row can be dropped silently', () => {
    const shapes = DECIDE_ROWS.map(([, { baseline, local, remote, complete, bootstrap }]) => JSON.stringify({
      baseline: baseline || null,
      local: local || null,
      remote: remote || null,
      complete: !!complete,
      bootstrap: !!bootstrap,
    }));

    expect(new Set(shapes).size).toBe(DECIDE_ROWS.length);
    expect(DECIDE_ROWS).toHaveLength(17);
  });
});

describe('decidePath', () => {
  it.each(PATH_ROWS)('%s', (name, input, expected) => {
    expect(decidePath(input)).toEqual(expected);
  });
});
