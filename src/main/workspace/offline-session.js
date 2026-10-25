const fs = require('fs').promises;
const runtimeAssets = require('../runtime-assets');

const LOCAL_PROTOCOL = 1;
const installed = new WeakSet();

function protocolMismatch(workspaceProtocol = require('@panphora/hyperclay-workspace/local-app/manifest.json').protocol) {
  return workspaceProtocol !== LOCAL_PROTOCOL;
}

// A stylesheet's relative URLs resolve against the URL it was answered from, so an alias answered
// in place would send its fonts to the CDN. They point at the release's own copies instead.
function absoluteURLs(css, base) {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, quote, ref) =>
    /^[a-z][a-z0-9+.-]*:/i.test(ref) ? match : `url(${quote}${new URL(ref, base).href}${quote})`);
}

function offlineSession() {
  const { session, net } = require('electron');
  const dedicated = session.fromPartition('persist:hyperclay-workspace');
  if (!installed.has(dedicated)) {
    dedicated.protocol.handle('https', async request => {
      const hit = runtimeAssets.resolve(request.url);
      const asset = hit?.available && runtimeAssets.assetFor(hit.version, hit.path);
      if (!asset) return net.fetch(request, { bypassCustomProtocolHandlers: true });
      const stylesheetAlias = hit.kind === 'alias' && /^text\/css\b/.test(asset.type);
      const bytes = stylesheetAlias
        ? Buffer.from(absoluteURLs((await fs.readFile(asset.file)).toString('utf8'), `https://clayjs.com/${hit.version}/${hit.path}`))
        : await fs.readFile(asset.file);
      return new Response(bytes, {
        status: 200,
        headers: {
          'Content-Type': asset.type,
          'ETag': stylesheetAlias ? `"${asset.sha256}-absolute"` : `"${asset.sha256}"`,
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
