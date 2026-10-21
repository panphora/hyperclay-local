// The rooms package stays optional for Local: the server boots and serves every
// existing route without it, and only constructing the shared authority pulls it
// in. Jest's own module cache would hide whether a boot module loaded it, so each
// check runs in a fresh Node process and reports what its require cache holds.

const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

const probe = (body) => {
  const script = `
    const path = require('path');
    const root = ${JSON.stringify(ROOT)};
    const roomsPath = require.resolve('@panphora/clayjs/server/rooms');
    ${body}
  `;
  const out = execFileSync(process.execPath, ['-e', script], { cwd: ROOT, encoding: 'utf8' });
  const line = out.split('\n').filter((line) => line.startsWith('PROBE ')).pop();
  if (!line) throw new Error(`the probe printed nothing: ${out}`);
  return JSON.parse(line.slice('PROBE '.length));
};

describe('the rooms package is loaded lazily', () => {
  test('the boot modules do not load it, and constructing an authority does', () => {
    const result = probe(`
      require(path.join(root, 'src/main/server.js'));
      require(path.join(root, 'src/main/root-servers.js'));
      const loadedAtBoot = Boolean(require.cache[roomsPath]);
      const { createLocalAuthority } = require(path.join(root, 'src/main/local-authority.js'));
      const authority = createLocalAuthority({ withDocument: async (resolve, fn) => fn(await resolve()) });
      process.stdout.write('PROBE ' + JSON.stringify({
        loadedAtBoot,
        loadedAfterConstruction: Boolean(require.cache[roomsPath]),
        roomsReady: typeof authority.rooms.open === 'function' && typeof authority.rooms.apply === 'function',
        roomsEmpty: authority.rooms.size() === 0,
      }) + '\\n');
    `);

    expect(result.loadedAtBoot).toBe(false);
    expect(result.loadedAfterConstruction).toBe(true);
    expect(result.roomsReady).toBe(true);
    expect(result.roomsEmpty).toBe(true);
  });

  test('the authority module does not load it, even when a construction is refused', () => {
    const result = probe(`
      const { createLocalAuthority } = require(path.join(root, 'src/main/local-authority.js'));
      const loadedAtRequire = Boolean(require.cache[roomsPath]);
      let refused = '';
      try {
        createLocalAuthority({});
      } catch (error) {
        refused = error.message;
      }
      process.stdout.write('PROBE ' + JSON.stringify({
        loadedAtRequire,
        refused,
        loadedAfterRefusal: Boolean(require.cache[roomsPath]),
      }) + '\\n');
    `);

    expect(result.loadedAtRequire).toBe(false);
    expect(result.refused).toBe('createLocalAuthority requires withDocument');
    expect(result.loadedAfterRefusal).toBe(false);
  });
});
