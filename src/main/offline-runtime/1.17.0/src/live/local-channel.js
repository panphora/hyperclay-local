// The one BroadcastChannel a document's same-browser tabs share: the durable lane
// carries the room's frames over it, and the local presence service carries
// `presence-v1` session frames beside them. This module owns opening the channel,
// routing a message to the subscribers that asked for its kind, and closing it
// when the last of them lets go, so neither service opens or closes the other's.
//
// The wire version stays the durable lane's 4, and `presence-v1` is an optional
// message family beside the durable types: a client that does not know it already
// ignores every type it does not handle.

const VERSION = 4;
export const PRESENCE_TYPE = "presence-v1";

export function localChannelSupported() {
  return typeof BroadcastChannel === "function";
}

/**
 * A channel handle for one document's tabs. `post` adds the wire version;
 * `subscribe` reports the messages of one kind ("durable" or "presence") and
 * returns the release, which closes the channel once it is the last one out.
 *
 * @param {string} key
 */
export function localChannel(key) {
  const channel = new BroadcastChannel(key);
  const listeners = { durable: new Set(), presence: new Set() };
  let refs = 0;

  channel.onmessage = ({ data }) => {
    if (!data || data.v !== VERSION || typeof data.type !== "string") return;
    const set = data.type === PRESENCE_TYPE ? listeners.presence : listeners.durable;
    for (const listener of [...set]) listener(data);
  };

  return {
    key,
    get open() {
      return refs > 0;
    },
    post(message) {
      if (!refs) return;
      channel.postMessage({ v: VERSION, ...message });
    },
    subscribe(kind, listener) {
      const set = kind === "presence" ? listeners.presence : listeners.durable;
      set.add(listener);
      refs += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        set.delete(listener);
        refs -= 1;
        if (refs > 0) return;
        channel.onmessage = null;
        channel.close();
      };
    },
  };
}
