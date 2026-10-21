// A real Local app serving one folder, with a room registry behind it: the same
// createApp the pool builds, the same loopback bind tests/helpers/loopback.js
// uses, and the same root live channel a root server would pass.
//
// The server and its sockets belong to this fixture, so close() tears down only
// its own connections and unregisters its own root -- two fixtures can share one
// authority (and one canonical file) while each keeps its own origin, which is
// what an aliased-root test needs. The caller owns the files and the authority.

const http = require('http');
const { createApp } = require('../../src/main/server');
const { createRootLive } = require('../../src/main/utils/root-live');

async function startLiveDataFixture({ authority, rootDir, rootId = 'fixture' } = {}) {
  const root = { id: rootId, kind: 'team', path: rootDir, port: 0 };
  const ctx = {
    root,
    live: createRootLive(root),
    devHooks: null,
    isKnownPath: null,
    observer: null,
    helpers: null,
    syncEngineFor: null,
    person: null,
    localAuthority: authority || null,
  };
  const app = createApp(ctx);
  const server = http.createServer(app);
  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  root.port = server.address().port;

  return {
    origin: `http://127.0.0.1:${root.port}`,
    root,
    app,
    async close() {
      authority?.closeRoot(rootId);
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

module.exports = { startLiveDataFixture };
