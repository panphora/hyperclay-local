const fs = require('fs').promises;
const path = require('upath');
const manifest = require('../offline-runtime/manifest.json');

const LOCAL_PROTOCOL = 1;
const installed = new WeakSet();
const assets = new Map(manifest.files.map(file => [file.url, file]));

function protocolMismatch(workspaceProtocol = require('@panphora/hyperclay-workspace/local-app/manifest.json').protocol) {
  return workspaceProtocol !== LOCAL_PROTOCOL;
}

function offlineSession() {
  const { session, net } = require('electron');
  const dedicated = session.fromPartition('persist:hyperclay-workspace');
  if (!installed.has(dedicated)) {
    dedicated.protocol.handle('https', async request => {
      const asset = assets.get(request.url);
      if (!asset) return net.fetch(request, { bypassCustomProtocolHandlers: true });
      const bytes = await fs.readFile(path.join(__dirname, '../offline-runtime', asset.path));
      return new Response(bytes, {
        status: 200,
        headers: {
          'Content-Type': asset.contentType,
          'ETag': `"${asset.sha256}"`,
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    });
    installed.add(dedicated);
  }
  return dedicated;
}

module.exports = { offlineSession, protocolMismatch, LOCAL_PROTOCOL };
