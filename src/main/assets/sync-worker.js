// HTML Clay's shared live-sync worker: Malleable HTML File spec, section 10.
//
// One instance per origin (a SharedWorker named "clay-sync") holds the origin's
// single /_/sync stream and fans its frames out to every page over MessagePorts.
// The stream lists every subscription in its URL, so a change to the set closes
// the stream and reopens it from a new URL, with each surviving subscription
// resuming from the last id it saw. The page contract (every message carries
// v: 1) is the spec's, not this file's.
"use strict";

const timing = Object.assign(
  { debounce: 50, portTTL: 60000, sweep: 30000, backoffMin: 1000, backoffMax: 30000 },
  self.claySyncTiming
);

// The host's cap on subscriptions per stream (livesync.go maxSharedSubs). Checked
// here so the page past it is answered on its own port, instead of the host
// refusing the whole list and every other page with it.
const maxSubs = 256;

// key -> { document, lane, since, opened, latest: {id, data} | null, ports: Set, index }
const subs = new Map();
// port -> { key, visible, seen, since, lastSeen }
const ports = new Map();

let stream = null;
let state = "closed";
let rebuildTimer = null;
let reconnectTimer = null;
let backoff = timing.backoffMin;

function keyOf(document, lane) {
  return lane + "\n" + document;
}

function send(port, msg) {
  try {
    port.postMessage(Object.assign({ v: 1 }, msg));
  } catch (_) {
    drop(port);
  }
}

function setState(next) {
  if (next === state) return;
  state = next;
  for (const port of ports.keys()) send(port, { type: "status", state });
}

self.onconnect = (event) => {
  const port = event.ports[0];
  ports.set(port, { key: null, visible: true, seen: 0, since: 0, lastSeen: Date.now() });
  port.onmessage = (e) => handle(port, e.data);
  port.onmessageerror = () => drop(port);
  if (typeof port.addEventListener === "function") port.addEventListener("close", () => drop(port));
  send(port, { type: "status", state });
};

function handle(port, msg) {
  const meta = ports.get(port);
  if (!meta || !msg || msg.v !== 1) return;
  meta.lastSeen = Date.now();
  switch (msg.type) {
    case "subscribe":
      subscribe(port, meta, msg);
      break;
    case "unsubscribe":
      unsubscribe(port, meta);
      break;
    case "visible":
      meta.visible = true;
      deliverLatest(port, meta);
      break;
    case "hidden":
      meta.visible = false;
      break;
    case "ping":
      send(port, { type: "pong" });
      break;
  }
}

function subscribe(port, meta, msg) {
  const since = msg.since === undefined ? 0 : msg.since;
  // Checked as the host checks an entry, and answered on this port alone. Sent
  // as it came, one bad entry would make the host refuse the whole list, and
  // every other page's stream with it.
  if (typeof msg.document !== "string" || msg.document === "" ||
      (msg.lane !== "live" && msg.lane !== "saved") ||
      !Number.isSafeInteger(since) || since < 0) {
    send(port, { type: "gone" });
    return;
  }
  unsubscribe(port, meta);
  const key = keyOf(msg.document, msg.lane);
  let sub = subs.get(key);
  if (!sub) {
    if (subs.size >= maxSubs) {
      send(port, { type: "gone" });
      return;
    }
    sub = { document: msg.document, lane: msg.lane, since, opened: false, latest: null, content: new Map(), needsResync: false, ports: new Set(), index: -1 };
    subs.set(key, sub);
    scheduleRebuild();
  } else if (!sub.opened && since > 0 && (sub.since === 0 || since < sub.since)) {
    // Two pages asking for one document before its stream is open: resume from
    // the lower position, and let each page's own staleness check drop what it
    // has already applied. Zero is the absence of a position, not a low one: the
    // host reads it as "no past" and replays nothing, so it never lowers a real one.
    sub.since = since;
  }
  sub.ports.add(port);
  meta.key = key;
  meta.seen = 0;
  meta.since = since;
  meta.cursored = false;
  if (sub.opened) {
    sendCursor(port, meta, sub, sub.needsResync);
    deliverLatest(port, meta);
  }
}

function sendCursor(port, meta, sub, resync) {
  const behind = !meta.cursored && meta.since > 0 && meta.since < sub.since && sub.content.size === 0;
  meta.cursored = true;
  send(port, { type: "cursor", seq: sub.since, resync: resync || behind });
}

function unsubscribe(port, meta) {
  const key = meta.key;
  if (key === null) return;
  meta.key = null;
  const sub = subs.get(key);
  if (!sub) return;
  sub.ports.delete(port);
  if (sub.ports.size === 0) {
    subs.delete(key);
    scheduleRebuild();
  }
}

function drop(port) {
  const meta = ports.get(port);
  if (!meta) return;
  unsubscribe(port, meta);
  ports.delete(port);
  try {
    port.close();
  } catch (_) {}
}

function deliverLatest(port, meta) {
  if (meta.key === null || !meta.visible) return;
  const sub = subs.get(meta.key);
  if (!sub || sub.latest === null || sub.latest.id === meta.seen) return;
  const frames = [...sub.content.values(), sub.latest].sort((a, b) => a.id - b.id);
  for (const frame of frames) {
    if (frame.id <= meta.seen) continue;
    meta.seen = frame.id;
    send(port, { type: "frame", data: frame.data });
  }
}

function scheduleRebuild() {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(rebuild, timing.debounce);
}

function rebuild() {
  clearTimeout(rebuildTimer);
  rebuildTimer = null;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (stream !== null) {
    stream.close();
    stream = null;
  }
  const order = Array.from(subs.values());
  if (order.length === 0) {
    setState("closed");
    return;
  }
  const query = order.map((sub, i) => {
    sub.index = i;
    return "s=" + encodeURIComponent(sub.lane + ":" + sub.since + ":" + sub.document);
  });
  const es = new EventSource(self.location.origin + "/_/sync?" + query.join("&"));
  stream = es;
  setState("connecting");
  es.onopen = () => {
    if (stream !== es) return;
    backoff = timing.backoffMin;
    setState("open");
  };
  es.addEventListener("cursor", (e) => onCursor(order, e));
  order.forEach((sub, i) => es.addEventListener("s" + i, (e) => onFrame(sub, e)));
  es.onerror = () => {
    if (stream !== es) return;
    // The browser's own reconnect would reuse this URL and every position in it.
    // Rebuilding instead resumes each subscription from where it is now.
    es.close();
    stream = null;
    setState("connecting");
    reconnectTimer = setTimeout(rebuild, backoff);
    backoff = Math.min(backoff * 2, timing.backoffMax);
  };
}

function onCursor(order, e) {
  let cursor;
  try {
    cursor = JSON.parse(e.data);
  } catch (_) {
    return;
  }
  const sub = order[cursor.sub];
  if (!sub || subs.get(keyOf(sub.document, sub.lane)) !== sub) return;
  if (cursor.error) {
    for (const port of sub.ports) {
      const meta = ports.get(port);
      if (meta) meta.key = null;
      send(port, { type: "gone" });
    }
    sub.ports.clear();
    // The stream still lists it: rebuild without it, and with nothing left, close.
    subs.delete(keyOf(sub.document, sub.lane));
    scheduleRebuild();
    return;
  }
  sub.opened = true;
  if (cursor.resync === true) {
    sub.latest = null;
    sub.content.clear();
    // A cursor cannot prove that a later frame repairs both peer and disk state.
    sub.needsResync = true;
  }
  if (typeof cursor.seq === "number") sub.since = cursor.seq;
  for (const port of sub.ports) {
    const meta = ports.get(port);
    if (meta) sendCursor(port, meta, sub, cursor.resync === true);
  }
}

function onFrame(sub, e) {
  const id = Number(e.lastEventId);
  if (Number.isFinite(id) && id > sub.since) sub.since = id;
  sub.latest = { id: sub.since, data: e.data };
  try {
    const data = JSON.parse(e.data);
    if (data.type === "notification" && (data.data?.kind === "external-change" ||
        (typeof data.msg === "string" && data.msg.endsWith("changed on disk outside this tab")))) {
      sub.content.set("disk", sub.latest);
    } else if (typeof data.html === "string") {
      sub.content.set("peer", sub.latest);
    }
  } catch (_) {}
  for (const port of sub.ports) {
    const meta = ports.get(port);
    if (!meta || !meta.visible) continue;
    meta.seen = sub.latest.id;
    send(port, { type: "frame", data: e.data });
  }
}

// A page that closed without saying so stops pinging; its port is dropped on the
// next sweep, and its subscription with it once no other page holds it.
setInterval(() => {
  const cutoff = Date.now() - timing.portTTL;
  for (const [port, meta] of Array.from(ports)) {
    if (meta.lastSeen < cutoff) drop(port);
  }
}, timing.sweep);
