import { onStream } from "./stream-bridge.js";
import { PAGE_FORMAT, PAGE_FORMAT_HEADER } from "../core/page-format.js";

// The host side of clay.live's fast lane on a host that advertises `live-data`:
// one POST per frame of ops, one GET for the room's whole state. Both name the
// document with Document-URL, as the sync relay and presence do, and both declare
// the page format this client writes: registration, operation and checkpoint are
// page-writing paths, so each one carries the capability the floor decides on.

const DATA_PATH = "/_/sync/data";

function dataUrl() {
  return new URL(DATA_PATH, window.location.origin);
}

/**
 * Send one frame ({ name, n, ops }). Resolves { status, body, retryAfter }:
 * status 0 when the request never got an answer.
 */
export async function relayData(clientId, frame) {
  const url = dataUrl();
  url.searchParams.set("client-id", clientId);
  try {
    const response = await fetch(url.href, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "Document-URL": window.location.href, [PAGE_FORMAT_HEADER]: String(PAGE_FORMAT) },
      body: JSON.stringify(frame),
    });
    let body = null;
    try {
      body = await response.json();
    } catch {}
    const retryAfter = Number(response.headers?.get?.("Retry-After")) || 0;
    return { status: response.status, body, retryAfter };
  } catch {
    return { status: 0, body: null, retryAfter: 0 };
  }
}

/**
 * The room's { epoch, seq, writer, stores }; { status } when the host refused;
 * null when the request never got an answer. clientId marks this tab as taking part.
 */
export async function fetchLiveState(clientId, since = null, { signal } = {}) {
  const url = dataUrl();
  if (clientId) url.searchParams.set("client-id", clientId);
  if (since && typeof since.epoch === "string" && Number.isInteger(since.seq)) url.searchParams.set("since", `${since.epoch}:${since.seq}`);
  url.searchParams.set("compaction", "1");
  try {
    const response = await fetch(url.href, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Document-URL": window.location.href, [PAGE_FORMAT_HEADER]: String(PAGE_FORMAT) },
      signal,
    });
    if (!response.ok) {
      let body = null;
      try {
        body = await response.json();
      } catch {}
      return { status: response.status, code: body?.code ?? null, retryAfter: Number(response.headers?.get?.("Retry-After")) || 0 };
    }
    const state = await response.json();
    // The stream is open but the host has not seen its subscription yet: not
    // ready, and the lane reads again.
    if (state && typeof state.epoch === "string" && state.conn === null) return null;
    return state;
  } catch {
    return null;
  }
}

/**
 * The fast-lane transport (fast-lane.js) for a host that advertises live-data:
 * frames go up by POST, and come down as named events on the live-lane stream.
 */
export function serverTransport() {
  return {
    start(handlers) {
      return onStream({
        open(info) {
          if (info.lane === "live") handlers.open(info);
        },
        close: () => handlers.close(),
        event(type, data) {
          if (type === "data") handlers.frame(data);
          else if (type === "data-state") handlers.state(data);
          else if (type === "data-writer") handlers.writer(data);
        },
      });
    },
    send: relayData,
    fetchState: fetchLiveState,
  };
}
