// C1.5: one Express app per root, on that root's saved port. A taken port is
// reported and never quietly moved; the pool makes the running set match the
// saved roots.
const fs = require('fs').promises;
const http = require('http');
const net = require('net');
const path = require('path');
const os = require('os');

jest.mock('../../src/main/utils/data-extractor', () => ({
  extractData: jest.fn(),
  extractViaTag: jest.fn().mockResolvedValue(null),
  parseExtractionRules: jest.fn()
}));

const { RootServer, RootServerPool } = require('../../src/main/root-servers.js');

const PERSONAL_BODY = '<html><body>personal</body></html>';
const TEAM_BODY = '<html><body>team</body></html>';
const BLOCKER_BODY = 'someone else holds this port';

function listenOn(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server.address().port));
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

// Every port is bound at the same time, so the kernel cannot hand one of them out twice.
async function freePorts(count) {
  const servers = Array.from({ length: count }, () => net.createServer());
  const ports = [];
  for (const server of servers) ports.push(await listenOn(server, 0));
  await Promise.all(servers.map(closeServer));
  return ports;
}

const get = (port, file = 'index.html') => fetch(`http://127.0.0.1:${port}/${file}`);

describe('C1.5: one root, one server, one saved port', () => {
  let personalDir;
  let teamDir;
  let pool;

  beforeEach(async () => {
    personalDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'root-servers-personal-')));
    teamDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'root-servers-team-')));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await fs.writeFile(path.join(personalDir, 'index.html'), PERSONAL_BODY);
    await fs.writeFile(path.join(teamDir, 'index.html'), TEAM_BODY);
    pool = new RootServerPool({ devHooks: null, isKnownPath: null });
  });

  afterEach(async () => {
    await pool.stopAll();
    await fs.rm(personalDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    await fs.rm(teamDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    jest.restoreAllMocks();
  });

  const personalRoot = (port) => ({ id: 'personal-root', kind: 'personal', path: personalDir, port });
  const teamRoot = (port) => ({ id: 'team-root', kind: 'team', path: teamDir, port });

  test('start on a free port reports running and serves that root', async () => {
    const [port] = await freePorts(1);
    const server = new RootServer(personalRoot(port), {});

    try {
      const res = await server.start();

      expect(res).toEqual({ ok: true });
      expect(server.state).toBe('running');
      expect(server.error).toBeNull();
      expect(server.server.address().port).toBe(port);
      expect(await (await get(port)).text()).toBe(PERSONAL_BODY);

      await server.stop();
      expect(server.state).toBe('stopped');
      expect(server.server).toBeNull();
    } finally {
      await server.stop();
    }
  });

  test('a second server on a taken port reports port-taken and listens nowhere', async () => {
    const blocker = http.createServer((req, res) => res.end(BLOCKER_BODY));
    const port = await listenOn(blocker, 0);
    try {
      const states = await pool.sync([teamRoot(port)], { enabled: true });

      expect(states).toEqual([{ rootId: 'team-root', port, state: 'port-taken', error: expect.any(String) }]);
      expect(pool.get('team-root').server).toBeNull();
      expect(await (await get(port)).text()).toBe(BLOCKER_BODY);
    } finally {
      await closeServer(blocker);
    }
  });

  test('retry after the port is free starts that root on the same port', async () => {
    const blocker = http.createServer((req, res) => res.end(BLOCKER_BODY));
    const port = await listenOn(blocker, 0);
    await pool.sync([teamRoot(port)], { enabled: true });
    expect(pool.states()[0].state).toBe('port-taken');

    await closeServer(blocker);
    const res = await pool.retry('team-root');

    expect(res).toEqual({ ok: true });
    expect(pool.states()).toEqual([{ rootId: 'team-root', port, state: 'running', error: null }]);
    expect(await (await get(port)).text()).toBe(TEAM_BODY);
  });

  test('the removed bus route is 404 on both a personal and a team root', async () => {
    const [personalPort, teamPort] = await freePorts(2);
    await pool.sync([personalRoot(personalPort), teamRoot(teamPort)], { enabled: true });

    const bus = (port) => fetch(`http://127.0.0.1:${port}/_/bus/subscribe?channel=ok`);

    expect((await bus(personalPort)).status).toBe(404);
    expect((await bus(teamPort)).status).toBe(404);
  });

  test('a missing folder is an error with nothing listening', async () => {
    const [port] = await freePorts(1);
    const missing = path.join(personalDir, 'gone');

    const states = await pool.sync([{ id: 'team-root', kind: 'team', path: missing, port }], { enabled: true });

    expect(states).toEqual([{ rootId: 'team-root', port, state: 'error', error: 'Folder not found' }]);
    expect(pool.get('team-root').server).toBeNull();
    await expect(get(port)).rejects.toThrow();
  });

  test('the switch off stops every server and frees every port', async () => {
    const [personalPort, teamPort] = await freePorts(2);
    await pool.sync([personalRoot(personalPort), teamRoot(teamPort)], { enabled: true });
    expect(pool.states()).toEqual([
      { rootId: 'personal-root', port: personalPort, state: 'running', error: null },
      { rootId: 'team-root', port: teamPort, state: 'running', error: null },
    ]);
    expect(await (await get(teamPort)).text()).toBe(TEAM_BODY);

    const states = await pool.sync([personalRoot(personalPort), teamRoot(teamPort)], { enabled: false });

    expect(states).toEqual([]);
    expect(pool.get('personal-root')).toBeNull();
    expect(pool.get('team-root')).toBeNull();
    await expect(get(personalPort)).rejects.toThrow();
    await expect(get(teamPort)).rejects.toThrow();
  });

  test('a changed port restarts that root alone', async () => {
    const [personalPort, teamPort, nextPort] = await freePorts(3);
    await pool.sync([personalRoot(personalPort), teamRoot(teamPort)], { enabled: true });
    const stale = pool.get('personal-root');
    const untouched = pool.get('team-root');

    const states = await pool.sync([personalRoot(nextPort), teamRoot(teamPort)], { enabled: true });

    expect(states.find((s) => s.rootId === 'personal-root'))
      .toEqual({ rootId: 'personal-root', port: nextPort, state: 'running', error: null });
    expect(pool.get('personal-root')).not.toBe(stale);
    expect(pool.get('team-root')).toBe(untouched);
    expect(untouched.state).toBe('running');
    expect(await (await get(nextPort)).text()).toBe(PERSONAL_BODY);
    expect(await (await get(teamPort)).text()).toBe(TEAM_BODY);
    await expect(get(personalPort)).rejects.toThrow();
  });
});
