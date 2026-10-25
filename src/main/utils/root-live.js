const { liveSync } = require('livesync-hyperclay');
const runtimeAssets = require('../runtime-assets');

// A frame goes to browsers, and a browser that receives `https://clayjs.com/...` stylesheet
// hrefs morphs them in and then fetches them, which fails offline. Every payload is
// projected the way a served document is, so what a viewer receives names this host's own
// copy of the bundled release. A payload with no runtime URL is passed through unchanged.
function projectPayload(payload) {
  if (!payload || typeof payload.html !== 'string') return payload;
  const result = runtimeAssets.projectRuntimeHTML(payload.html, {
    releases: runtimeAssets.releases,
    selectedVersion: runtimeAssets.selectedVersion,
  });
  if (!result.mappings.length) return payload;
  return { ...payload, html: result.html };
}

function liveKeyFor(root) {
  if (!root || root.kind === 'personal') return (rel) => rel;
  return (rel) => `${root.id}:${rel}`;
}

function createRootLive(root) {
  const key = liveKeyFor(root);
  return {
    key,
    subscribe: (rel, res, opts) => liveSync.subscribe(key(rel), res, opts),
    unsubscribe: (rel, res) => liveSync.unsubscribe(key(rel), res),
    broadcast: (rel, payload, opts) => liveSync.broadcast(key(rel), projectPayload(payload), opts),
    notify: (rel, payload, opts) => liveSync.notify(key(rel), payload, opts),
    markBrowserSave: (rel) => liveSync.markBrowserSave(key(rel)),
    wasBrowserSave: (rel) => liveSync.wasBrowserSave(key(rel)),
  };
}

function configureLiveSync(opts) {
  return liveSync.configure(opts);
}

function onLiveFrame(handler) {
  return liveSync.onFrame(handler);
}

module.exports = { createRootLive, liveKeyFor, configureLiveSync, onLiveFrame };
