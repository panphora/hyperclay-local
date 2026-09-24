// Drives internal/server/sync-worker.js outside a browser: a fake SharedWorker
// scope, fake ports and a fake EventSource, with the worker's timers shortened
// through self.claySyncTiming. Exits non-zero on the first failed assertion.
// Run by TestSyncWorkerScript with the script's path as the one argument.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const script = fs.readFileSync(process.argv[2], "utf8");

class FakeEventSource {
  static all = [];
  constructor(url) {
    this.url = String(url);
    this.listeners = new Map();
    this.closed = false;
    this.onopen = null;
    this.onerror = null;
    FakeEventSource.all.push(this);
  }
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  close() { this.closed = true; }
  emit(name, data, lastEventId = "") {
    const fn = this.listeners.get(name);
    if (fn) fn({ data, lastEventId });
  }
  static latest() { return FakeEventSource.all[FakeEventSource.all.length - 1]; }
  static live() { return FakeEventSource.all.filter((e) => !e.closed); }
}

class FakePort {
  constructor() { this.sent = []; this.onmessage = null; this.onmessageerror = null; this.closed = false; }
  // Copied across realms the way a real postMessage copies it, so assertions
  // compare plain objects of this realm rather than the vm context's prototypes.
  postMessage(msg) { this.sent.push(JSON.parse(JSON.stringify(msg))); }
  addEventListener() {}
  start() {}
  close() { this.closed = true; }
  push(msg) { this.onmessage({ data: msg }); }
  take(type) {
    const i = this.sent.findIndex((m) => m.type === type);
    return i < 0 ? null : this.sent.splice(i, 1)[0];
  }
  drain() { const all = this.sent; this.sent = []; return all; }
}

const ORIGIN = "http://127.0.0.1:1";
const sandbox = {
  self: { location: { origin: ORIGIN }, claySyncTiming: { debounce: 5, portTTL: 400, sweep: 50, backoffMin: 1, backoffMax: 10 } },
  EventSource: FakeEventSource,
  setTimeout, clearTimeout, setInterval, clearInterval, console,
};
vm.createContext(sandbox);
vm.runInContext(script, sandbox, { filename: "sync-worker.js" });
const worker = sandbox.self;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const connect = () => { const port = new FakePort(); worker.onconnect({ ports: [port] }); return port; };
const entries = (url) => new URL(url).searchParams.getAll("s");
const A = ORIGIN + "/a.htmlclay";
const B = ORIGIN + "/b.htmlclay";
const oneStream = (what) => assert.equal(FakeEventSource.live().length, 1, "exactly one open stream " + what);

// 1. Two pages, two documents: one stream listing both, in subscribe order.
const p1 = connect();
assert.equal(p1.take("status").state, "closed");
p1.push({ v: 1, type: "subscribe", document: A, lane: "live", since: 0 });
const p2 = connect();
p2.push({ v: 1, type: "subscribe", document: B, lane: "saved", since: 0 });
await sleep(20);
const es = FakeEventSource.latest();
assert.deepEqual(entries(es.url), ["live:0:" + A, "saved:0:" + B]);
oneStream("after two subscribes");
assert.ok(es.url.startsWith(ORIGIN + "/_/sync?"), "stream is opened on the worker's own origin");
es.onopen();
assert.deepEqual(p1.drain().filter((m) => m.type === "status").map((m) => m.state), ["connecting", "open"]);

// 2. Cursors are forwarded to the subscription they name, resync included.
es.emit("cursor", JSON.stringify({ sub: 0, seq: 41 }));
es.emit("cursor", JSON.stringify({ sub: 1, seq: 7, resync: true }));
assert.deepEqual(p1.take("cursor"), { v: 1, type: "cursor", seq: 41, resync: false });
assert.deepEqual(p2.take("cursor"), { v: 1, type: "cursor", seq: 7, resync: true });
assert.equal(p2.take("cursor"), null);

// 3. Frames go to their own page only; the data string is passed through untouched.
const frame42 = '{"html":"<html>x</html>","sender":"z","seq":42}';
es.emit("s0", frame42, "42");
assert.deepEqual(p1.take("frame"), { v: 1, type: "frame", data: frame42 });
assert.equal(p2.take("frame"), null);

// 4. A hidden page gets nothing until it is visible, then only the latest frame.
p1.push({ v: 1, type: "hidden" });
es.emit("s0", '{"seq":43,"html":"older"}', "43");
es.emit("s0", '{"seq":44,"html":"latest"}', "44");
assert.equal(p1.take("frame"), null);
p1.push({ v: 1, type: "visible" });
assert.deepEqual(p1.drain().filter((m) => m.type === "frame").map((m) => m.data), ['{"seq":44,"html":"latest"}']);
p1.push({ v: 1, type: "visible" });
assert.equal(p1.take("frame"), null, "a frame already delivered is not delivered again");

// 5. A page joining a subscription other pages hold gets its cursor and the latest
//    frame, and the stream is not rebuilt.
const p3 = connect();
p3.take("status");
p3.push({ v: 1, type: "subscribe", document: A, lane: "live", since: 0 });
assert.deepEqual(p3.take("cursor"), { v: 1, type: "cursor", seq: 44, resync: false });
assert.equal(p3.take("frame").data, '{"seq":44,"html":"latest"}');
await sleep(20);
assert.equal(FakeEventSource.latest(), es, "joining an existing subscription does not rebuild");

// 6. Dropping a subscription rebuilds the stream, each survivor resuming from its
//    own position.
p2.push({ v: 1, type: "unsubscribe" });
await sleep(20);
const es2 = FakeEventSource.latest();
assert.notEqual(es2, es);
assert.equal(es.closed, true, "the old stream is closed on rebuild");
assert.deepEqual(entries(es2.url), ["live:44:" + A]);
oneStream("after a rebuild");

// 7. A dropped stream is rebuilt by the worker from current positions, never left
//    to the browser's reconnect, which would replay the old URL.
p1.drain();
es2.onerror();
assert.equal(es2.closed, true);
await sleep(30);
const es3 = FakeEventSource.latest();
assert.notEqual(es3, es2);
assert.deepEqual(entries(es3.url), ["live:44:" + A]);
oneStream("after a reconnect");

// 8. not-found ends that subscription for its pages and no other, and the stream
//    is rebuilt without it.
const p4 = connect();
p4.take("status");
p4.push({ v: 1, type: "subscribe", document: ORIGIN + "/gone.htmlclay", lane: "live", since: 0 });
await sleep(20);
const es4 = FakeEventSource.latest();
assert.deepEqual(entries(es4.url), ["live:44:" + A, "live:0:" + ORIGIN + "/gone.htmlclay"]);
es4.emit("cursor", JSON.stringify({ sub: 1, error: "not-found" }));
assert.deepEqual(p4.take("gone"), { v: 1, type: "gone" });
assert.equal(p1.take("gone"), null);
assert.equal(p3.take("gone"), null);
await sleep(20);
const es5 = FakeEventSource.latest();
assert.notEqual(es5, es4, "a subscription the host refused is dropped from the stream");
assert.deepEqual(entries(es5.url), ["live:44:" + A]);
oneStream("after a not-found");

// 9. ping answers pong; a message without v:1 changes nothing.
p1.push({ v: 1, type: "ping" });
assert.deepEqual(p1.take("pong"), { v: 1, type: "pong" });
p1.push({ type: "unsubscribe" });
p3.push({ v: 2, type: "unsubscribe" });
await sleep(20);
assert.equal(FakeEventSource.latest(), es5, "unversioned messages are ignored");

// 10. A subscription the worker cannot carry is answered on its own port and
//     never reaches the host, so it cannot make the host refuse everyone's list.
p1.drain();
const p5 = connect();
p5.take("status");
for (const bad of [
  { v: 1, type: "subscribe", document: A, lane: "live", since: 1e21 },
  { v: 1, type: "subscribe", document: A, lane: "live", since: -1 },
  { v: 1, type: "subscribe", document: A, lane: "live", since: "44" },
  { v: 1, type: "subscribe", document: A, lane: "both", since: 0 },
  { v: 1, type: "subscribe", document: "", lane: "live", since: 0 },
]) {
  p5.push(bad);
  assert.deepEqual(p5.take("gone"), { v: 1, type: "gone" }, "refused: " + JSON.stringify(bad));
}
await sleep(20);
assert.equal(FakeEventSource.latest(), es5, "a refused subscription does not touch the stream");

// 11. The host's cap is the worker's cap. The page past it is answered on its
//     own port, while joining a subscription already held is never a new one.
const crowd = [];
for (let i = 0; i < 255; i++) {
  const p = connect();
  p.take("status");
  p.push({ v: 1, type: "subscribe", document: ORIGIN + "/n" + i + ".htmlclay", lane: "live", since: 0 });
  crowd.push(p);
}
await sleep(20);
assert.equal(entries(FakeEventSource.latest().url).length, 256, "the stream lists every subscription up to the cap");
const p7 = connect();
p7.take("status");
p7.push({ v: 1, type: "subscribe", document: ORIGIN + "/one-too-many.htmlclay", lane: "live", since: 0 });
assert.deepEqual(p7.take("gone"), { v: 1, type: "gone" }, "the page past the cap is refused on its own port");
const p8 = connect();
p8.take("status");
p8.push({ v: 1, type: "subscribe", document: A, lane: "live", since: 0 });
assert.equal(p8.take("gone"), null, "joining a subscription already held is not a new one");
for (const p of crowd) p.push({ v: 1, type: "unsubscribe" });
await sleep(20);
assert.deepEqual(entries(FakeEventSource.latest().url), ["live:44:" + A]);

// 12. A reconnect that fires while a rebuild is pending opens one stream, not
//     two: the rebuild it runs takes the pending debounce with it.
const settled = FakeEventSource.latest();
settled.onopen();
const opened = FakeEventSource.all.length;
settled.onerror();
const p9 = connect();
p9.take("status");
p9.push({ v: 1, type: "subscribe", document: B, lane: "live", since: 0 });
await sleep(40);
assert.equal(FakeEventSource.all.length, opened + 1, "the reconnect and the pending rebuild opened one stream between them");
assert.deepEqual(entries(FakeEventSource.latest().url), ["live:44:" + A, "live:0:" + B]);
oneStream("after a reconnect overtook a rebuild");
p9.push({ v: 1, type: "unsubscribe" });
await sleep(20);

// 13. Positions. A page with none (since 0) never lowers the position of one that
//     has one: the host reads 0 as "no past" and replays nothing. A page that
//     joins from behind the position the stream resumed from, with no frame in
//     hand to close the gap, is told to resync; a page with no position is not,
//     and once a frame has arrived the frame closes the gap.
const C = ORIGIN + "/c.htmlclay";
const pc1 = connect(); pc1.take("status");
const pc2 = connect(); pc2.take("status");
pc1.push({ v: 1, type: "subscribe", document: C, lane: "live", since: 5000 });
pc2.push({ v: 1, type: "subscribe", document: C, lane: "live", since: 0 });
await sleep(20);
const esC = FakeEventSource.latest();
assert.deepEqual(entries(esC.url), ["live:44:" + A, "live:5000:" + C]);
const pc3 = connect(); pc3.take("status");
pc3.push({ v: 1, type: "subscribe", document: C, lane: "live", since: 3000 });
esC.emit("cursor", JSON.stringify({ sub: 1, seq: 5000 }));
assert.deepEqual(pc1.take("cursor"), { v: 1, type: "cursor", seq: 5000, resync: false }, "the page the stream resumed for is in step");
assert.deepEqual(pc2.take("cursor"), { v: 1, type: "cursor", seq: 5000, resync: false }, "a page with no position has no gap");
assert.deepEqual(pc3.take("cursor"), { v: 1, type: "cursor", seq: 5000, resync: true }, "a page behind the resumed position, with no frame to close the gap, resyncs");
const pc4 = connect(); pc4.take("status");
pc4.push({ v: 1, type: "subscribe", document: C, lane: "live", since: 4000 });
assert.deepEqual(pc4.take("cursor"), { v: 1, type: "cursor", seq: 5000, resync: true }, "joining an open stream from behind resyncs too");
esC.emit("s1", '{"seq":5001,"html":"current"}', "5001");
const pc5 = connect(); pc5.take("status");
pc5.push({ v: 1, type: "subscribe", document: C, lane: "live", since: 4000 });
assert.deepEqual(pc5.take("cursor"), { v: 1, type: "cursor", seq: 5001, resync: false }, "with a frame in hand the gap is closed by the frame");
assert.equal(pc5.take("frame").data, '{"seq":5001,"html":"current"}');
for (const p of [pc1, pc2, pc3, pc4, pc5]) p.push({ v: 1, type: "unsubscribe" });
await sleep(20);

// 14. Peer and disk state survive a later notification while a page is hidden.
const D = ORIGIN + "/d.htmlclay";
const pd1 = connect(); pd1.take("status");
pd1.push({ v: 1, type: "subscribe", document: D, lane: "live", since: 0 });
await sleep(20);
const esD = FakeEventSource.latest();
const di = entries(esD.url).findIndex(entry => entry.endsWith(":" + D));
esD.emit("cursor", JSON.stringify({ sub: di, seq: 0 }));
pd1.push({ v: 1, type: "hidden" });
const peer = JSON.stringify({ seq: 10, html: "peer state", sender: "peer" });
const disk = JSON.stringify({ seq: 11, type: "notification", data: { kind: "external-change", html: "disk state", sender: "file-system", etag: "disk11" } });
const notice = JSON.stringify({ seq: 12, type: "notification", msg: "warning" });
esD.emit("s" + di, peer, "10");
esD.emit("s" + di, disk, "11");
esD.emit("s" + di, notice, "12");
pd1.push({ v: 1, type: "visible" });
assert.deepEqual(pd1.drain().filter(m => m.type === "frame").map(m => m.data), [peer, disk, notice]);

pd1.push({ v: 1, type: "hidden" });
const largeDisk = JSON.stringify({ seq: 13, type: "notification", msgType: "warning", msg: "d.htmlclay changed on disk outside this tab" });
const laterNotice = JSON.stringify({ seq: 14, type: "notification", msg: "warning" });
esD.emit("s" + di, largeDisk, "13");
esD.emit("s" + di, laterNotice, "14");
pd1.push({ v: 1, type: "visible" });
assert.deepEqual(pd1.drain().filter(m => m.type === "frame").map(m => m.data), [largeDisk, laterNotice]);
const largeJoin = connect(); largeJoin.take("status");
largeJoin.push({ v: 1, type: "subscribe", document: D, lane: "live", since: 0 });
assert.deepEqual(largeJoin.drain().filter(m => m.type === "frame").map(m => m.data), [peer, largeDisk, laterNotice]);
largeJoin.push({ v: 1, type: "unsubscribe" });

// 15. A replay gap invalidates cached content and remains visible to later joins.
esD.emit("cursor", JSON.stringify({ sub: di, seq: 14, resync: true }));
const pd2 = connect(); pd2.take("status");
pd2.push({ v: 1, type: "subscribe", document: D, lane: "live", since: 9 });
assert.equal(pd2.take("cursor").resync, true);
assert.equal(pd2.take("frame"), null, "the pre-gap cache must not replay after repair");
pd1.drain();
esD.emit("cursor", JSON.stringify({ sub: di, seq: 14 }));
assert.equal(pd1.take("cursor").resync, false, "an existing port is not repaired again on a clean cursor");
assert.equal(pd2.take("cursor").resync, false);
esD.emit("s" + di, JSON.stringify({ seq: 15, type: "notification", msg: "another warning" }), "15");
const pd3 = connect(); pd3.take("status");
pd3.push({ v: 1, type: "subscribe", document: D, lane: "live", since: 0 });
assert.equal(pd3.take("cursor").resync, true, "a notification does not repair a gap for a new tab");
assert.equal(JSON.parse(pd3.take("frame").data).html, undefined);
for (const p of [pd1, pd2, pd3]) p.push({ v: 1, type: "unsubscribe" });

// 16. Silent pages are dropped on the sweep, and with the last of them the stream.
await sleep(600);
assert.equal(FakeEventSource.live().length, 0, "no stream once every page has gone silent");
assert.equal(p1.closed && p3.closed && p4.closed, true, "silent ports are closed");

console.log("sync-worker harness: ok");
process.exit(0);
