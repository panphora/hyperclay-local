const { liveSync } = require('livesync-hyperclay');
const runtimeAssets = require('../runtime-assets');

// A frame or an external-change notice goes to browsers, and a browser that receives
// `https://clayjs.com/...` stylesheet hrefs morphs them in and then fetches them, which
// fails offline. Both are projected the way a served document is, but without the
// descriptor: the receiving tab already holds one, and an inserted element would shift
// live sync's identity map. A payload with no runtime URL is passed through unchanged.
function project(html) {
  const result = runtimeAssets.projectRuntimeHTML(html, {
    releases: runtimeAssets.releases,
    selectedVersion: runtimeAssets.selectedVersion,
    descriptor: false,
  });
  return result.mappings.length ? result.html : html;
}

function projectPayload(payload) {
  if (!payload || typeof payload.html !== 'string') return payload;
  const html = project(payload.html);
  return html === payload.html ? payload : { ...payload, html };
}

function projectNotice(payload) {
  const data = payload && payload.data;
  if (!data || data.kind !== 'external-change' || typeof data.html !== 'string') return payload;
  const html = project(data.html);
  return html === data.html ? payload : { ...payload, data: { ...data, html } };
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
    notify: (rel, payload, opts) => liveSync.notify(key(rel), projectNotice(payload), opts),
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
