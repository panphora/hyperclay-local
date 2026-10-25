import http from 'node:http';
import path from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/main/server.js');
const runtimeAssets = require('../src/main/runtime-assets.js');

function fail(message) {
  console.error(`offline-fixture-server: ${message}`);
  process.exit(1);
}

function parseRoot(argv) {
  let root = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg !== '--root') fail(`unknown argument ${arg}`);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) fail('--root needs a directory');
    root = path.resolve(value);
    i += 1;
  }
  if (!root) fail('--root <dir> is required');
  return root;
}

async function htmlFiles(root, rel = '') {
  const found = [];
  const entries = await readdir(path.join(root, rel), { withFileTypes: true });
  for (const entry of entries) {
    const child = rel ? path.posix.join(rel, entry.name) : entry.name;
    if (entry.isDirectory()) found.push(...await htmlFiles(root, child));
    else if (entry.isFile() && entry.name.endsWith('.html')) found.push(child);
  }
  return found;
}

const root = parseRoot(process.argv.slice(2));
const info = await stat(root).catch(() => null);
if (!info || !info.isDirectory()) fail(`${root} is not a directory`);

// stdout carries the READY line and nothing else; everything the server logs goes to
// stderr, since src/main/server.js logs ordinary requests there.
const writeStdout = process.stdout.write.bind(process.stdout);
console.log = (...args) => console.error(...args);
process.stdout.write = (...args) => process.stderr.write(...args);

const app = createApp(root);
const server = http.createServer(app);

// Explicit loopback bind for the reason tests/helpers/loopback.js gives: a wildcard
// bind can be handed a port another process already holds on 127.0.0.1 alone.
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
}).catch((error) => fail(`could not listen on 127.0.0.1: ${error.message}`));

const { port } = server.address();
const baseURL = `http://127.0.0.1:${port}`;
const runtime = `/_/clayjs/${runtimeAssets.selectedVersion}/`;

const documents = {};
for (const rel of await htmlFiles(root)) {
  const url = `${baseURL}/${rel.split('/').map(encodeURIComponent).join('/')}`;
  documents[rel] = {
    url,
    save: {
      method: 'POST',
      url: `${baseURL}/_/save`,
      headers: {
        'Document-URL': url,
        'Content-Type': 'text/plain;charset=UTF-8',
        'Sec-Fetch-Site': 'same-origin',
        Origin: baseURL,
      },
    },
  };
}

writeStdout(`READY ${JSON.stringify({ host: 'hyperclay-local', baseURL, runtime, documents })}\n`);

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on('SIGTERM', stop);
process.stdin.resume();
process.stdin.on('end', stop);
