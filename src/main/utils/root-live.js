const { liveSync } = require('livesync-hyperclay');

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
    broadcast: (rel, payload, opts) => liveSync.broadcast(key(rel), payload, opts),
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
