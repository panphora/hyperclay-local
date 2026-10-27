// Live sync owns the document's stream. clay.live's fast lane needs to know when
// that stream opens (and as which client), when it drops, and three of its named
// events. This module carries them across, so neither side imports the other and
// a page without the live plugin pays for one small module.

export const LIVE_EVENTS = Object.freeze(["data", "data-state", "data-writer"]);

const handlers = new Set();
let current = null;

function each(method, ...args) {
  for (const handler of handlers) {
    try {
      handler[method]?.(...args);
    } catch (err) {
      console.error("clay.live: stream handler failed:", err);
    }
  }
}

/** Live sync: the stream is open as this client on this lane. Every (re)open. */
export function streamOpened({ clientId, lane }) {
  current = { clientId, lane };
  each("open", current);
}

/** Live sync: the stream dropped or stopped. */
export function streamClosed() {
  if (!current) return;
  current = null;
  each("close");
}

/** Live sync: one of LIVE_EVENTS arrived, its data already parsed. */
export function streamEvent(type, data) {
  if (!LIVE_EVENTS.includes(type)) return;
  each("event", type, data);
}

/**
 * Listen: { open(info), close(), event(type, data) }, each optional. A stream
 * that is already open is reported to the new handler at once. Returns an
 * unsubscribe function.
 */
export function onStream(handler) {
  handlers.add(handler);
  if (current) {
    try {
      handler.open?.(current);
    } catch (err) {
      console.error("clay.live: stream handler failed:", err);
    }
  }
  return () => handlers.delete(handler);
}

/** The open stream's { clientId, lane }, or null. */
export function currentStream() {
  return current;
}
