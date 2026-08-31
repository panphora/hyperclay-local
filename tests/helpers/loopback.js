// supertest binds the server behind request(app) with a bare listen(0) — a
// WILDCARD bind. macOS will hand that a port another process already holds on
// 127.0.0.1 alone, because those are different addresses and the kernel does
// not call it a conflict; supertest then hardcodes its URL to
// http://127.0.0.1:<port>, and the kernel delivers the connection to the most
// specific matching bind: the neighbour, not the app under test. A normal dev
// machine keeps long-lived loopback listeners in the ephemeral range (htmlclay
// alone holds a dozen), so under parallel load a test's request intermittently
// comes back with a foreign server's answer — a 403 or 405 on a call the app
// would have served with 200.
//
// Binding to 127.0.0.1 here makes the collision impossible: the kernel refuses
// a loopback bind on a port a loopback neighbour already holds (EADDRINUSE),
// so a port this server reports is provably its own. supertest reuses an
// already-listening server instead of binding one per request.
const http = require('http');

const open = new Set();

function listenLoopback(app, port = 0) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      open.add(server);
      resolve(server);
    });
  });
}

// Closes every server this file opened; safe to call from any afterEach.
async function closeLoopback() {
  const servers = [...open];
  open.clear();
  await Promise.all(servers.map((server) => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  }));
}

module.exports = { listenLoopback, closeLoopback };
