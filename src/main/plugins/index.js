/**
 * Plugin host — serves built-in bus plugins over the in-process bus.
 *
 * A plugin is { name, channel, onRequest(payload, reply, signal) }; the
 * streamed request/reply protocol (ack, batched deltas, one terminal frame,
 * cancel, timeout, concurrency cap) is hyper-wire's serve(). The same shape
 * works OUTSIDE the app as a standalone process over httpBus — see
 * hyperclay-pages/agent/handler.js for the reference custom handler — so
 * plugins here are just the zero-setup defaults.
 *
 * Lifecycle: main.js starts plugins after the server starts and stops them
 * with it (the served folder is a per-run constant).
 */
const { messageBus, serve, localBus } = require('hyper-wire');
const { aiEditPlugin } = require('./ai-edit');

let handles = [];

function startPlugins({ baseDir, settings }) {
  stopPlugins();
  const aiEdit = (settings && settings.aiEdit) || {};
  const plugins = [];
  if (aiEdit.enabled !== false) {
    plugins.push(aiEditPlugin({ baseDir, settings }));
  }
  handles = plugins.map(plugin => serve(
    localBus(messageBus, `plugin-${plugin.name}`),
    plugin.channel,
    plugin.onRequest,
    { maxConcurrent: 2 }
  ));
  if (plugins.length) {
    console.log(`[Plugins] Serving: ${plugins.map(p => p.name).join(', ')}`);
  }
  return plugins.map(p => p.name);
}

function stopPlugins() {
  handles.forEach(handle => handle.close());
  handles = [];
}

module.exports = { startPlugins, stopPlugins };
