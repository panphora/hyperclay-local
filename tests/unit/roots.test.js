const net = require('net');

const {
  PERSONAL_PORT,
  TEAM_PORT_LADDER,
  CASE_INSENSITIVE,
  contains,
  overlaps,
  validateRootPath,
  defaultTeamFolder,
  probePort,
  allocateTeamPort,
  personalRoot,
} = require('../../src/main/roots');

const HOME = '/Users/alex';
// The module folds case itself; identity realPathOf keeps each case's own spelling visible.
const identityRealPath = async (p) => p;

describe('validateRootPath', () => {
  test('refuses the home folder itself', async () => {
    const result = await validateRootPath(HOME, [], { realPathOf: identityRealPath, home: HOME });
    expect(result).toEqual({ ok: false, reason: 'home-itself' });
  });

  test('refuses a folder outside home', async () => {
    const outside = await validateRootPath('/Volumes/External/Sites', [], { realPathOf: identityRealPath, home: HOME });
    expect(outside).toEqual({ ok: false, reason: 'outside-home' });

    const sibling = await validateRootPath('/Users/bob/Sites', [], { realPathOf: identityRealPath, home: HOME });
    expect(sibling).toEqual({ ok: false, reason: 'outside-home' });
  });

  test('accepts a folder inside home and returns its real path', async () => {
    const result = await validateRootPath(`${HOME}/Sites`, [], { realPathOf: identityRealPath, home: HOME });
    expect(result).toEqual({ ok: true, path: `${HOME}/Sites` });
  });

  test('refuses another root at the same path', async () => {
    const roots = [{ id: 'r1', kind: 'team', path: `${HOME}/Sites` }];
    const result = await validateRootPath(`${HOME}/Sites`, roots, { realPathOf: identityRealPath, home: HOME });
    expect(result).toEqual({ ok: false, reason: 'overlaps', rootId: 'r1' });
  });

  test('refuses a folder nested inside another root', async () => {
    const roots = [{ id: 'r1', kind: 'personal', path: `${HOME}/Sites` }];
    const result = await validateRootPath(`${HOME}/Sites/acme`, roots, { realPathOf: identityRealPath, home: HOME });
    expect(result).toEqual({ ok: false, reason: 'overlaps', rootId: 'r1' });
  });

  test('refuses a folder that contains another root', async () => {
    const roots = [{ id: 'r1', kind: 'team', path: `${HOME}/Sites/acme` }];
    const result = await validateRootPath(`${HOME}/Sites`, roots, { realPathOf: identityRealPath, home: HOME });
    expect(result).toEqual({ ok: false, reason: 'overlaps', rootId: 'r1' });
  });

  test('refuses paths that resolve onto another root through a symlink', async () => {
    const realPathOf = async (p) => (p === `${HOME}/link` ? `${HOME}/Sites` : p);
    const roots = [{ id: 'r1', kind: 'personal', path: `${HOME}/Sites` }];
    const result = await validateRootPath(`${HOME}/link`, roots, { realPathOf, home: HOME });
    expect(result).toEqual({ ok: false, reason: 'overlaps', rootId: 'r1' });
  });

  test('refuses a path whose real form is outside home', async () => {
    const realPathOf = async (p) => (p === `${HOME}/link` ? '/Volumes/External/Sites' : p);
    const result = await validateRootPath(`${HOME}/link`, [], { realPathOf, home: HOME });
    expect(result).toEqual({ ok: false, reason: 'outside-home' });
  });

  test('ignores the excluded root id', async () => {
    const roots = [
      { id: 'r1', kind: 'personal', path: `${HOME}/Sites` },
      { id: 'r2', kind: 'team', path: `${HOME}/Sites/acme` },
    ];
    const result = await validateRootPath(`${HOME}/Sites`, roots, {
      realPathOf: identityRealPath,
      home: HOME,
      ignoreRootId: 'r1',
    });
    expect(result).toEqual({ ok: false, reason: 'overlaps', rootId: 'r2' });

    const rePicked = await validateRootPath(`${HOME}/Sites`, [roots[0]], {
      realPathOf: identityRealPath,
      home: HOME,
      ignoreRootId: 'r1',
    });
    expect(rePicked).toEqual({ ok: true, path: `${HOME}/Sites` });
  });

  test('the ignore id does not weaken the home and outside-home rules', async () => {
    const result = await validateRootPath(HOME, [{ id: 'r1', path: HOME }], {
      realPathOf: identityRealPath,
      home: HOME,
      ignoreRootId: 'r1',
    });
    expect(result).toEqual({ ok: false, reason: 'home-itself' });
  });

  (CASE_INSENSITIVE ? test : test.skip)('refuses a case variant of another root', async () => {
    const roots = [{ id: 'r1', kind: 'personal', path: `${HOME}/Sites` }];
    const result = await validateRootPath('/users/alex/sites/acme', roots, { realPathOf: identityRealPath, home: HOME });
    expect(result).toEqual({ ok: false, reason: 'overlaps', rootId: 'r1' });
  });

  (CASE_INSENSITIVE ? test : test.skip)('refuses a case variant of home', async () => {
    const result = await validateRootPath('/Users/Alex', [], { realPathOf: identityRealPath, home: HOME });
    expect(result).toEqual({ ok: false, reason: 'home-itself' });
  });
});

describe('defaultTeamFolder', () => {
  const emptyFs = { exists: async () => false, isEmptyDir: async () => false };

  test('uses ~/hyperclay/<team> when free', async () => {
    const roots = [{ id: 'p', kind: 'personal', path: `${HOME}/Sites`, port: PERSONAL_PORT }];
    const dir = await defaultTeamFolder('acme', roots, {
      realPathOf: identityRealPath,
      home: HOME,
      ...emptyFs,
    });
    expect(dir).toBe(`${HOME}/hyperclay/acme`);
  });

  test('skips an existing non-empty folder to -2', async () => {
    const taken = `${HOME}/hyperclay/acme`;
    const dir = await defaultTeamFolder('acme', [], {
      realPathOf: identityRealPath,
      home: HOME,
      exists: async (p) => p === taken,
      isEmptyDir: async () => false,
    });
    expect(dir).toBe(`${HOME}/hyperclay/acme-2`);
  });

  test('reuses an existing empty folder', async () => {
    const taken = `${HOME}/hyperclay/acme`;
    const dir = await defaultTeamFolder('acme', [], {
      realPathOf: identityRealPath,
      home: HOME,
      exists: async (p) => p === taken,
      isEmptyDir: async () => true,
    });
    expect(dir).toBe(taken);
  });

  test('falls back to ~/hyperclay-teams/<team> when the personal root is ~/hyperclay', async () => {
    const roots = [{ id: 'p', kind: 'personal', path: `${HOME}/hyperclay`, port: PERSONAL_PORT }];
    const dir = await defaultTeamFolder('acme', roots, {
      realPathOf: identityRealPath,
      home: HOME,
      ...emptyFs,
    });
    expect(dir).toBe(`${HOME}/hyperclay-teams/acme`);
  });

  test('returns null when every candidate overlaps a root', async () => {
    const roots = [
      { id: 'p', kind: 'personal', path: `${HOME}/hyperclay`, port: PERSONAL_PORT },
      { id: 't', kind: 'team', path: `${HOME}/hyperclay-teams`, port: 5432 },
    ];
    const dir = await defaultTeamFolder('acme', roots, {
      realPathOf: identityRealPath,
      home: HOME,
      ...emptyFs,
    });
    expect(dir).toBeNull();
  });
});

describe('allocateTeamPort', () => {
  test('takes the first free ladder port', async () => {
    const port = await allocateTeamPort([], { isFree: async () => true });
    expect(port).toBe(TEAM_PORT_LADDER[0]);
    expect(port).toBe(5432);
  });

  test('skips ports already saved on another root', async () => {
    const roots = [{ id: 'p', port: PERSONAL_PORT }, { id: 't', port: TEAM_PORT_LADDER[0] }];
    const probed = [];
    const port = await allocateTeamPort(roots, {
      isFree: async (p) => {
        probed.push(p);
        return true;
      },
    });
    expect(port).toBe(TEAM_PORT_LADDER[1]);
    expect(probed).toEqual([TEAM_PORT_LADDER[1]]);
  });

  test('skips a ladder port that is busy at setup time', async () => {
    const busy = new Set([TEAM_PORT_LADDER[0], TEAM_PORT_LADDER[1]]);
    const port = await allocateTeamPort([], { isFree: async (p) => !busy.has(p) });
    expect(port).toBe(TEAM_PORT_LADDER[2]);
  });

  test('falls back to a random port in 49152 to 65535', async () => {
    const assigned = [{ id: 'x', port: 49152 }];
    const randoms = [0, 0.5];
    let i = 0;
    const port = await allocateTeamPort(assigned, {
      isFree: async (p) => !TEAM_PORT_LADDER.includes(p) && p !== 49152,
      random: () => (i < randoms.length ? randoms[i++] : randoms[randoms.length - 1]),
    });
    expect(port).toBe(49152 + Math.floor(0.5 * (65535 - 49152 + 1)));
    expect(port).toBeGreaterThanOrEqual(49152);
    expect(port).toBeLessThanOrEqual(65535);
  });

  test('throws after 64 misses', async () => {
    const calls = [];
    await expect(
      allocateTeamPort([], {
        isFree: async (p) => {
          calls.push(p);
          return false;
        },
        random: () => 0,
      }),
    ).rejects.toThrow('No free local port found');
    expect(calls).toHaveLength(TEAM_PORT_LADDER.length + 64);
  });
});

describe('probePort', () => {
  test('reports a bound port as busy and a free port as free', async () => {
    const blocker = net.createServer();
    await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const busyPort = blocker.address().port;
    expect(await probePort(busyPort)).toBe(false);
    await new Promise((resolve) => blocker.close(resolve));
    expect(await probePort(busyPort)).toBe(true);
  });
});

describe('personalRoot', () => {
  test('finds the personal root by kind and returns null when absent', () => {
    const personal = { id: 'p', kind: 'personal', path: `${HOME}/Sites` };
    const team = { id: 't', kind: 'team', path: `${HOME}/hyperclay/acme` };
    expect(personalRoot([team, personal])).toBe(personal);
    expect(personalRoot([team])).toBeNull();
    expect(personalRoot([])).toBeNull();
  });
});

describe('helpers', () => {
  test('contains and overlaps treat a folder as inside itself', () => {
    expect(contains(`${HOME}/Sites`, `${HOME}/Sites`)).toBe(true);
    expect(contains(`${HOME}/Sites`, `${HOME}/Sites/acme`)).toBe(true);
    expect(contains(`${HOME}/Sites`, `${HOME}/Sites-other`)).toBe(false);
    expect(overlaps(`${HOME}/Sites`, `${HOME}/Sites/acme`)).toBe(true);
    expect(overlaps(`${HOME}/Sites/acme`, `${HOME}/Sites`)).toBe(true);
    expect(overlaps(`${HOME}/Sites`, `${HOME}/Other`)).toBe(false);
  });

  test('exposes the documented port ladder', () => {
    expect(PERSONAL_PORT).toBe(4321);
    expect(TEAM_PORT_LADDER).toEqual([5432, 6543, 7654, 8765, 9876]);
  });
});
