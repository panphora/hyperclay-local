const fs = require('fs').promises;
const runtimeAssets = require('../runtime-assets');

const LOCAL_PROTOCOL = 1;
const installed = new WeakSet();

function protocolMismatch(workspaceProtocol = require('@panphora/hyperclay-workspace/local-app/manifest.json').protocol) {
  return workspaceProtocol !== LOCAL_PROTOCOL;
}

function offlineSession() {
  const { session, net } = require('electron');
  const dedicated = session.fromPartition('persist:hyperclay-workspace');
  if (!installed.has(dedicated)) {
    dedicated.protocol.handle('https', async request => {
      const hit = runtimeAssets.resolve(request.url);
      const asset = hit?.available && runtimeAssets.assetFor(hit.version, hit.path);
      if (!asset) return net.fetch(request, { bypassCustomProtocolHandlers: true });
      const bytes = await fs.readFile(asset.file);
      return new Response(bytes, {
        status: 200,
        headers: {
          'Content-Type': asset.type,
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
