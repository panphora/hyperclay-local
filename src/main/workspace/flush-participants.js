// The lifecycle flushes one workspace. This joins the Electron window and every browser tab into
// that one workspace: a flush request goes to all of them, and their answers come back as a single
// result once each has replied or gone away. Participant ids are prefixed by their source, so two
// tabs holding the same document stay two participants.
function createFlushParticipants({ window: windowWorkspace, shell, deliver }) {
  let pending = null;

  const windowListening = () => windowWorkspace.hasWindow() && !!windowWorkspace.hasFlushListener?.();

  function settle() {
    if (!pending || pending.waiting.size) return;
    const { requestId, participants } = pending;
    pending = null;
    deliver({ requestId, participants });
  }

  function receive(source, value) {
    if (!pending || value?.requestId !== pending.requestId || !pending.waiting.has(source) ||
      !Array.isArray(value.participants)) return false;
    pending.waiting.delete(source);
    for (const item of value.participants) {
      pending.participants.push(item && typeof item === 'object' && typeof item.id === 'string' && item.id
        ? { ...item, id: `${source}:${item.id}` } : item);
    }
    settle();
    return true;
  }

  return {
    hasWindow: () => windowWorkspace.hasWindow() || shell.flushClients().length > 0,
    hasFlushListener: () => windowListening() || shell.flushClients().length > 0,
    show: () => windowWorkspace.show(),
    requestFlush(requestId) {
      const clients = shell.flushClients();
      pending = { requestId, participants: [],
        waiting: new Set([...(windowListening() ? ['window'] : []), ...clients.map(id => `tab-${id}`)]) };
      if (windowListening()) windowWorkspace.requestFlush(requestId);
      if (clients.length) shell.requestFlush(requestId);
      settle();
    },
    fromWindow: value => receive('window', value),
    fromTab: (client, value) => receive(`tab-${client}`, value),
    tabGone(client) {
      if (pending?.waiting.delete(`tab-${client}`)) settle();
    },
  };
}

module.exports = { createFlushParticipants };
