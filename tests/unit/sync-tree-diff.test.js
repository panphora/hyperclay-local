const { diffTree, HOLD_MS, MASS_FILES } = require('../../src/sync-engine/reconcile/tree-diff');

const led = (id, type, path, inode, checksum = null) => [id, { type, path, inode, checksum }];
const dsk = (path, type, inode) => [path, { type, inode }];

const opsOf = (fx) => diffTree({
  mode: fx.mode || 'catchup',
  unreadable: fx.unreadable,
  ledger: new Map(fx.ledger),
  disk: new Map(fx.disk)
}).ops;

function liveRun(fx) {
  const first = diffTree({ ledger: new Map(fx.ledger), disk: new Map(fx.disk), mode: 'live', now: 0 });
  const second = diffTree({
    ledger: new Map(fx.ledger),
    disk: new Map(fx.disk),
    mode: 'live',
    now: HOLD_MS,
    held: first.held
  });
  return { first, second };
}

function attachmentTree({ folderName, count, missing = new Set(), folderGone = false }) {
  const folderPath = `uploads/${folderName}`;
  const ledger = [
    led('uploads', 'folder', 'uploads', '400:1'),
    led(folderName, 'folder', folderPath, '201:1')
  ];
  const disk = [dsk('uploads', 'folder', '400:1')];
  if (!folderGone) disk.push(dsk(folderPath, 'folder', '201:1'));
  for (let i = 0; i < count; i += 1) {
    const name = `f${String(i).padStart(2, '0')}.png`;
    ledger.push(led(`${folderName}-${i}`, 'upload', `${folderPath}/${name}`, `30${i}:5`));
    if (!folderGone && !missing.has(i)) disk.push(dsk(`${folderPath}/${name}`, 'file', `30${i}:5`));
  }
  return {
    ledger,
    disk,
    folderPath,
    removedIds: [...missing].sort((a, b) => a - b).map((i) => `${folderName}-${i}`),
    removedPaths: [...missing].sort((a, b) => a - b)
      .map((i) => `${folderPath}/f${String(i).padStart(2, '0')}.png`)
  };
}

function mulberry32(seed) {
  let state = seed;
  return function next() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, rand) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const row4Fixture = () => ({
  ledger: [
    led('1', 'folder', 'projects', '200:1'),
    led('2', 'site', 'projects/a.html', '101:5'),
    led('3', 'site', 'projects/b.html', '102:5'),
    led('4', 'site', 'projects/c.html', '103:5')
  ],
  disk: [
    dsk('articles', 'folder', '200:1'),
    dsk('articles/a.html', 'file', '101:5'),
    dsk('articles/b.html', 'file', '102:5'),
    dsk('articles/c.html', 'file', '103:5')
  ]
});

const row8Fixture = () => ({
  ledger: [led('1', 'site', 'a.html', '101:5', 'h1')],
  disk: [
    dsk('a.html', 'file', '555:5'),
    dsk('b.html', 'file', '101:5')
  ]
});

const row18Fixture = () => ({ ...attachmentTree({ folderName: 'assets-m', count: 25, folderGone: true }), mode: 'live' });

describe('diffTree', () => {
  it('1: nothing changed produces no ops', () => {
    const result = diffTree({
      ledger: new Map([led('1', 'site', 'work/a.html', '101:5', 'h1')]),
      disk: new Map([dsk('work/a.html', 'file', '101:5')]),
      mode: 'catchup'
    });

    expect(result.ops).toEqual([]);
    expect(result.held.size).toBe(0);
    expect(result.wakeAt).toBeNull();
  });

  it('2: file rename in a folder is one relocate with shape rename', () => {
    expect(opsOf({
      ledger: [led('1', 'site', 'work/a.html', '101:5', 'h1')],
      disk: [dsk('work/b.html', 'file', '101:5')]
    })).toEqual([
      { op: 'relocate', id: '1', kind: 'file', from: 'work/a.html', to: 'work/b.html', shape: 'rename' }
    ]);
  });

  it('3: file move has shape move and move plus rename has shape move+rename', () => {
    expect(opsOf({
      ledger: [led('1', 'site', 'work/a.html', '101:5', 'h1')],
      disk: [dsk('other/a.html', 'file', '101:5')]
    })).toEqual([
      { op: 'relocate', id: '1', kind: 'file', from: 'work/a.html', to: 'other/a.html', shape: 'move' }
    ]);

    expect(opsOf({
      ledger: [led('1', 'site', 'work/a.html', '101:5', 'h1')],
      disk: [dsk('other/b.html', 'file', '101:5')]
    })).toEqual([
      { op: 'relocate', id: '1', kind: 'file', from: 'work/a.html', to: 'other/b.html', shape: 'move+rename' }
    ]);
  });

  it('4: folder rename with tracked children at the same relative paths is one folder relocate', () => {
    expect(opsOf(row4Fixture())).toEqual([
      { op: 'relocate', id: '1', kind: 'folder', from: 'projects', to: 'articles', shape: 'rename' }
    ]);
  });

  it('5: folder rename with a child renamed inside it gives a child relocate from the projected path', () => {
    expect(opsOf({
      ledger: [
        led('1', 'folder', 'projects', '200:1'),
        led('2', 'site', 'projects/a.html', '101:5'),
        led('3', 'site', 'projects/b.html', '102:5')
      ],
      disk: [
        dsk('articles', 'folder', '200:1'),
        dsk('articles/a.html', 'file', '101:5'),
        dsk('articles/bb.html', 'file', '102:5')
      ]
    })).toEqual([
      { op: 'relocate', id: '1', kind: 'folder', from: 'projects', to: 'articles', shape: 'rename' },
      { op: 'relocate', id: '3', kind: 'file', from: 'articles/b.html', to: 'articles/bb.html', shape: 'rename' }
    ]);
  });

  it('6: folder rename with a child gone gives a missing at the projected path after the hold', () => {
    const fx = {
      ledger: [
        led('1', 'folder', 'projects', '200:1'),
        led('2', 'site', 'projects/a.html', '101:5'),
        led('3', 'site', 'projects/gone.html', '102:5')
      ],
      disk: [
        dsk('articles', 'folder', '200:1'),
        dsk('articles/a.html', 'file', '101:5')
      ]
    };
    const { first, second } = liveRun(fx);

    expect(first.ops).toEqual([
      { op: 'relocate', id: '1', kind: 'folder', from: 'projects', to: 'articles', shape: 'rename' }
    ]);
    expect(second.ops).toEqual([
      { op: 'relocate', id: '1', kind: 'folder', from: 'projects', to: 'articles', shape: 'rename' },
      { op: 'missing', id: '3', kind: 'file', path: 'articles/gone.html' }
    ]);
  });

  it('7: an atomic save with no old identity anywhere on disk is no ops', () => {
    expect(opsOf({
      ledger: [led('1', 'site', 'work/a.html', '101:5', 'h1')],
      disk: [dsk('work/a.html', 'file', '999:5')]
    })).toEqual([]);
  });

  it('8: replaced and moved gives a relocate plus a new at the old path', () => {
    expect(opsOf(row8Fixture())).toEqual([
      { op: 'relocate', id: '1', kind: 'file', from: 'a.html', to: 'b.html', shape: 'rename' },
      { op: 'new', kind: 'file', path: 'a.html' }
    ]);
  });

  it('9: a weak identity never relocates', () => {
    expect(opsOf({
      ledger: [led('1', 'site', 'work/a.html', 101, 'h1')],
      disk: [dsk('work/b.html', 'file', 101)]
    })).toEqual([
      { op: 'new', kind: 'file', path: 'work/b.html' },
      { op: 'missing', id: '1', kind: 'file', path: 'work/a.html' }
    ]);

    expect(opsOf({
      ledger: [led('1', 'site', 'work/a.html', '101:0', 'h1')],
      disk: [dsk('work/b.html', 'file', '101:0')]
    })).toEqual([
      { op: 'new', kind: 'file', path: 'work/b.html' },
      { op: 'missing', id: '1', kind: 'file', path: 'work/a.html' }
    ]);
  });

  it('10: a recycled inode is never a relocate', () => {
    const fx = {
      ledger: [
        led('1', 'folder', 'uploads', '400:1'),
        led('2', 'folder', 'uploads/assets-a', '200:1'),
        led('3', 'upload', 'uploads/assets-a/x.png', '300:1')
      ],
      disk: [
        dsk('uploads', 'folder', '400:1'),
        dsk('photos', 'folder', '200:9'),
        dsk('photos/x.png', 'file', '300:9')
      ]
    };
    const { second } = liveRun(fx);

    expect(second.ops).toEqual([
      { op: 'new', kind: 'folder', path: 'photos' },
      { op: 'new', kind: 'file', path: 'photos/x.png' },
      { op: 'missing', id: '2', kind: 'folder', path: 'uploads/assets-a' }
    ]);
    expect(second.ops.some((op) => op.op === 'relocate')).toBe(false);
  });

  it('11: a live delete outside uploads waits out the hold', () => {
    const fx = { ledger: [led('1', 'site', 'work/a.html', '101:5', 'h1')], disk: [] };
    const { first, second } = liveRun(fx);

    expect(first.ops).toEqual([]);
    expect([...first.held]).toEqual([['missing:work/a.html', 0]]);
    expect(first.wakeAt).toBe(HOLD_MS);
    expect(second.ops).toEqual([{ op: 'missing', id: '1', kind: 'file', path: 'work/a.html' }]);
  });

  it('12: a live delete that comes back is no ops and clears held', () => {
    const fx = { ledger: [led('1', 'site', 'work/a.html', '101:5', 'h1')], disk: [] };
    const first = diffTree({ ledger: new Map(fx.ledger), disk: new Map(fx.disk), mode: 'live', now: 0 });

    expect(first.ops).toEqual([]);

    const second = diffTree({
      ledger: new Map(fx.ledger),
      disk: new Map([dsk('work/a.html', 'file', '101:5')]),
      mode: 'live',
      now: HOLD_MS,
      held: first.held
    });

    expect(second.ops).toEqual([]);
    expect(second.held.size).toBe(0);
  });

  it('13: a live delete of one attachment out of 30 syncs after the hold', () => {
    const fx = attachmentTree({ folderName: 'assets-a', count: 30, missing: new Set([0]) });
    const { first, second } = liveRun(fx);

    expect(first.ops).toEqual([]);
    expect([...first.held.keys()]).toEqual(['missing:uploads/assets-a/f00.png']);
    expect(second.ops).toEqual([
      { op: 'missing', id: 'assets-a-0', kind: 'file', path: 'uploads/assets-a/f00.png' }
    ]);
  });

  it('14: a catch-up delete under uploads is a restore with no hold', () => {
    const fx = attachmentTree({ folderName: 'assets-a', count: 30, missing: new Set([0]) });
    const result = diffTree({
      ledger: new Map(fx.ledger),
      disk: new Map(fx.disk),
      mode: 'catchup'
    });

    expect(result.ops).toEqual([
      { op: 'restore', id: 'assets-a-0', kind: 'file', path: 'uploads/assets-a/f00.png' }
    ]);
    expect(result.held.size).toBe(0);
    expect(result.wakeAt).toBeNull();
  });

  it('15: uploads renamed to uploads-old is a restoreLocked with from set', () => {
    expect(opsOf({
      ledger: [
        led('1', 'folder', 'uploads', '400:1'),
        led('2', 'upload', 'uploads/x.png', '301:5')
      ],
      disk: [
        dsk('uploads-old', 'folder', '400:1'),
        dsk('uploads-old/x.png', 'file', '301:5')
      ]
    })).toEqual([
      { op: 'restoreLocked', from: 'uploads-old' }
    ]);
  });

  it('16: uploads gone entirely is a restoreLocked with from null after the hold', () => {
    const fx = {
      ledger: [
        led('1', 'folder', 'uploads', '400:1'),
        led('2', 'upload', 'uploads/x.png', '301:5')
      ],
      disk: []
    };
    const { first, second } = liveRun(fx);

    expect(first.ops).toEqual([]);
    expect([...first.held]).toEqual([['restoreLocked', 0]]);
    expect(second.ops).toEqual([{ op: 'restoreLocked', from: null }]);
  });

  it('17: an attachment moved out of uploads and a file moved into uploads both relocate', () => {
    expect(opsOf({
      ledger: [
        led('u', 'folder', 'uploads', '400:1'),
        led('a', 'folder', 'uploads/assets-a', '201:1'),
        led('x', 'upload', 'uploads/assets-a/x.png', '301:5'),
        led('w', 'folder', 'work', '500:1')
      ],
      disk: [
        dsk('uploads', 'folder', '400:1'),
        dsk('uploads/assets-a', 'folder', '201:1'),
        dsk('work', 'folder', '500:1'),
        dsk('work/x.png', 'file', '301:5')
      ]
    })).toEqual([
      { op: 'relocate', id: 'x', kind: 'file', from: 'uploads/assets-a/x.png', to: 'work/x.png', shape: 'move' }
    ]);

    expect(opsOf({
      ledger: [
        led('u', 'folder', 'uploads', '400:1'),
        led('a', 'folder', 'uploads/assets-a', '201:1'),
        led('w', 'folder', 'work', '500:1'),
        led('x', 'upload', 'work/x.png', '301:5')
      ],
      disk: [
        dsk('uploads', 'folder', '400:1'),
        dsk('uploads/assets-a', 'folder', '201:1'),
        dsk('work', 'folder', '500:1'),
        dsk('uploads/assets-a/x.png', 'file', '301:5')
      ]
    })).toEqual([
      { op: 'relocate', id: 'x', kind: 'file', from: 'work/x.png', to: 'uploads/assets-a/x.png', shape: 'move' }
    ]);
  });

  it('18: a mass delete replaces the deletes it holds', () => {
    const gone = attachmentTree({ folderName: 'assets-m', count: 25, folderGone: true });
    const { first, second } = liveRun(gone);

    expect(first.ops).toEqual([]);
    expect([...first.held]).toEqual([['massDelete', 0]]);
    expect(second.ops).toEqual([
      { op: 'massDelete', files: 25, ids: ['assets-m'], paths: ['uploads/assets-m'] }
    ]);

    const six = attachmentTree({ folderName: 'assets-a', count: 40, missing: new Set([0, 1, 2, 3, 4, 5]) });
    const sixRun = liveRun(six);
    expect(sixRun.first.ops).toEqual([]);
    expect(sixRun.second.ops).toEqual([
      { op: 'massDelete', files: 6, ids: six.removedIds, paths: six.removedPaths }
    ]);

    const two = attachmentTree({ folderName: 'assets-a', count: 40, missing: new Set([0, 1]) });
    const twoRun = liveRun(two);
    expect(twoRun.first.ops).toEqual([]);
    expect(twoRun.second.ops).toEqual([
      { op: 'missing', id: 'assets-a-0', kind: 'file', path: 'uploads/assets-a/f00.png' },
      { op: 'missing', id: 'assets-a-1', kind: 'file', path: 'uploads/assets-a/f01.png' }
    ]);
  });

  it('19: an unreadable subtree produces no ops', () => {
    expect(opsOf({
      ledger: [led('1', 'site', 'work/a.html', '101:5', 'h1')],
      disk: [],
      unreadable: new Set(['work'])
    })).toEqual([]);

    expect(opsOf({
      ledger: [
        led('1', 'site', 'work/a.html', '101:5', 'h1'),
        led('2', 'site', 'other/b.html', '102:5', 'h2')
      ],
      disk: [],
      unreadable: new Set([''])
    })).toEqual([]);
  });

  it('20: a missing folder covers its children with one cascade delete after the hold', () => {
    const fx = {
      ledger: [
        led('1', 'folder', 'projects', '200:1'),
        led('2', 'site', 'projects/a.html', '101:5'),
        led('3', 'site', 'projects/b.html', '102:5')
      ],
      disk: []
    };
    const { first, second } = liveRun(fx);

    expect(first.ops).toEqual([]);
    expect(second.ops).toEqual([
      { op: 'missing', id: '1', kind: 'folder', path: 'projects' }
    ]);
  });

  describe('21: canonical output under shuffled input', () => {
    const cases = { 'row 4': row4Fixture, 'row 8': row8Fixture, 'row 18': row18Fixture };

    for (const [name, fixture] of Object.entries(cases)) {
      it(`${name} is deep-equal every time`, () => {
        const fx = fixture();
        const rand = mulberry32(7);
        const expected = fx.mode === 'live' ? liveRun(fx).second.ops : opsOf(fx);

        for (let i = 0; i < 20; i += 1) {
          const shuffled = { ledger: shuffle(fx.ledger, rand), disk: shuffle(fx.disk, rand) };
          const ops = fx.mode === 'live' ? liveRun(shuffled).second.ops : opsOf(shuffled);
          expect(ops).toEqual(expected);
        }
      });
    }
  });

  describe('22: the folder identity cases as rows', () => {
    it('an inode match relocates the folder', () => {
      expect(opsOf({
        ledger: [
          led('1', 'folder', 'projects', '200:1'),
          led('2', 'site', 'projects/a.html', '101:5')
        ],
        disk: [
          dsk('articles', 'folder', '200:1'),
          dsk('articles/a.html', 'file', '101:5')
        ]
      })).toEqual([
        { op: 'relocate', id: '1', kind: 'folder', from: 'projects', to: 'articles', shape: 'rename' }
      ]);
    });

    it('an empty folder with no identity is missing plus new', () => {
      expect(opsOf({
        ledger: [led('1', 'folder', 'projects', null)],
        disk: [dsk('articles', 'folder', '999:5')]
      })).toEqual([
        { op: 'new', kind: 'folder', path: 'articles' },
        { op: 'missing', id: '1', kind: 'folder', path: 'projects' }
      ]);
    });

    it('a content-hash match is missing plus new', () => {
      expect(opsOf({
        ledger: [
          led('1', 'folder', 'projects', null),
          led('2', 'site', 'projects/a.html', null, 'hash-content-')
        ],
        disk: [
          dsk('articles', 'folder', '999:5'),
          dsk('articles/a.html', 'file', '888:5')
        ]
      })).toEqual([
        { op: 'new', kind: 'folder', path: 'articles' },
        { op: 'new', kind: 'file', path: 'articles/a.html' },
        { op: 'missing', id: '1', kind: 'folder', path: 'projects' }
      ]);
    });

    it('a basename majority is missing plus new', () => {
      expect(opsOf({
        ledger: [
          led('1', 'folder', 'projects', null),
          led('2', 'site', 'projects/a.html', null, 'nope-a'),
          led('3', 'site', 'projects/b.html', null, 'nope-b'),
          led('4', 'site', 'projects/c.html', null, 'nope-c')
        ],
        disk: [
          dsk('articles', 'folder', '999:5'),
          dsk('articles/a.html', 'file', '888:1'),
          dsk('articles/b.html', 'file', '888:2'),
          dsk('articles/c.html', 'file', '888:3')
        ]
      })).toEqual([
        { op: 'new', kind: 'folder', path: 'articles' },
        { op: 'new', kind: 'file', path: 'articles/a.html' },
        { op: 'new', kind: 'file', path: 'articles/b.html' },
        { op: 'new', kind: 'file', path: 'articles/c.html' },
        { op: 'missing', id: '1', kind: 'folder', path: 'projects' }
      ]);
    });

    it('a failed scan is an unreadable row with no ops', () => {
      expect(opsOf({
        ledger: [
          led('1', 'folder', 'projects', null),
          led('2', 'site', 'projects/a.html', null, 'ha')
        ],
        disk: [],
        unreadable: new Set(['projects'])
      })).toEqual([]);
    });
  });

  it('23: a reused folder identity is not a relocate', () => {
    const ops = opsOf({
      ledger: [
        led('1', 'folder', 'uploads', '7:100'),
        led('2', 'upload', 'uploads/a.png', '8:100')
      ],
      disk: [
        dsk('new-project', 'folder', '7:100'),
        dsk('new-project/notes.txt', 'file', '9:100')
      ]
    });

    expect(ops.some((op) => op.op === 'restoreLocked' && op.from)).toBe(false);
    expect(ops).toContainEqual({ op: 'restoreLocked', from: null });
  });

  it('24: a real folder rename with its children still relocates', () => {
    const ops = opsOf({
      ledger: [
        led('1', 'folder', 'docs', '7:100'),
        led('2', 'site', 'docs/a.html', '8:100')
      ],
      disk: [
        dsk('renamed', 'folder', '7:100'),
        dsk('renamed/a.html', 'file', '8:100')
      ]
    });

    expect(ops.filter((op) => op.op === 'relocate')).toEqual([
      { op: 'relocate', id: '1', kind: 'folder', from: 'docs', to: 'renamed', shape: 'rename' }
    ]);
    expect(ops.filter((op) => op.op === 'new' || op.op === 'missing')).toEqual([]);
  });
});
