// View mode: readers see the saved article, and each newer file the host sends on
// the saved lane is projected onto it by key. One owner at a time: a reader claims
// the article before it attaches listeners and gives it back only on stop, so an
// editor never mounts underneath a live reader and a late frame never lands over a
// mounted tool. No ProseMirror, no projection code and no merge engine: the saved
// file is already the rendered form of the writer's model.
import { createSavedStream } from "../sync/saved-stream.js";
import { stopForUpgrade, upgradeReplaces, upgradeReplacesDocument } from "../sync/version-guard.js";
import { applyPreparedArticle, keepToolVersion, prepareSavedArticle, toolInfoOf, toolsOf, toolStateOf } from "./reader-patch.js";
import { claim } from "./runtime-owner.js";

const ARTICLE = "article[data-page]";
const TOOL = 'section[data-type="tool"][data-id]';

export { applyPreparedArticle, prepareSavedArticle };

// The stamp of the file this reader accepted, recorded where a save reads it. The
// stamp module is the write path's own lazy chunk: a reader paints without it, and
// a save loads the one copy both paths then share.
const rememberStamp = (etag) => {
  import("../core/etag.js").then(({ recordEtag }) => recordEtag(etag)).catch(() => {});
};

const freezeReceipt = (value) => Object.freeze({
  bytes: typeof value?.bytes === "string" ? value.bytes : null,
  etag: typeof value?.etag === "string" && value.etag ? value.etag : null,
  seq: Number.isSafeInteger(value?.seq) ? value.seq : null,
});

// The compatibility entry: apply one saved file to the article already on screen.
// Newer callers start a reader, which owns the stream and reports its receipt.
export function applySavedArticle(html, doc = document, readerOpen = new Map(), savedOpen = new Map(), preserveTools = new Set()) {
  const live = doc.querySelector(ARTICLE);
  if (!live) return false;
  const prepared = prepareSavedArticle(html, doc);
  if (!prepared.ok) return false;
  const keepTool = (root, incoming) => preserveTools.has(root.getAttribute("data-id")) || keepToolVersion(root, incoming);
  const result = applyPreparedArticle(prepared, { article: live, readerOpen, savedOpen, keepTool });
  let changed = result.changed;
  if (prepared.rev !== live.getAttribute("data-rev")) {
    if (prepared.rev === null) live.removeAttribute("data-rev");
    else live.setAttribute("data-rev", prepared.rev);
    changed = true;
  }
  if (prepared.title && prepared.title !== doc.title) {
    doc.title = prepared.title;
    changed = true;
  }
  return changed;
}

function createReader({ doc, article, represented = null, feed = null, documentURL, servedEtag = null, stream: adopted = null, release = () => {} }) {
  const readerOpen = new Map();
  const savedOpen = new Map();
  const mounted = new Map();
  const toolStore = { data: {} };
  const listeners = [];
  let host = null;
  let hostLoading = null;
  let mountTurn = 0;
  let stopped = false;
  let stream = adopted;
  let final = null;
  let receipt = freezeReceipt(represented);

  const dispatch = (type, detail) => {
    const win = doc.defaultView ?? globalThis;
    doc.dispatchEvent(new win.CustomEvent(type, { detail }));
  };

  const disposeMounts = () => {
    for (const item of mounted.values()) {
      try { item.instance?.dispose?.(); } catch {}
    }
    mounted.clear();
  };

  const hostReady = () => {
    if (host) return Promise.resolve(host);
    if (!hostLoading) {
      hostLoading = import("./tools.js").then(({ createToolHost }) => {
        if (stopped) return null;
        host = createToolHost({ store: toolStore, mode: "view" });
        return host;
      }).catch((error) => {
        hostLoading = null;
        console.warn("clayjs: could not load the reader tool host", error);
        return null;
      });
    }
    return hostLoading;
  };

  const pruneTools = (tools) => {
    for (const [id, item] of mounted) {
      const next = tools.get(id);
      if (!next || next.invalid || next.rev !== item.rev || next.signature !== item.signature) {
        try { item.instance?.dispose?.(); } catch {}
        mounted.delete(id);
      }
    }
  };

  // Only a document with a tool pays for the tool host. A failed import leaves the
  // saved fallback markup in place and the saved file still applies.
  const mountTools = (tools, state) => {
    const wanted = [];
    for (const [id, block] of tools) {
      if (block.invalid) console.warn("clayjs: could not decode saved tools", block.error);
      else wanted.push([id, block]);
    }
    if (!wanted.length) return;
    toolStore.data = state ?? {};
    const turn = ++mountTurn;
    hostReady().then((created) => {
      if (stopped || !created || turn !== mountTurn) return;
      for (const [id, block] of wanted) {
        if (mounted.has(id)) continue;
        const root = [...article.querySelectorAll(TOOL)].find((el) => el.getAttribute("data-id") === id);
        if (!root) continue;
        try {
          const instance = created.mount(root, {
            id, artifact: block.artifact, rev: block.rev, seed: block.state ?? {},
          });
          mounted.set(id, { rev: block.rev, signature: block.signature, instance });
        } catch (error) {
          console.warn(`clayjs: tool ${id} could not mount`, error);
        }
      }
    });
  };

  // A mounted tool has no data-tool script left to read: the host owns that root
  // now, so identity comes from the version the mount recorded.
  const keepTool = (live, incoming) => {
    const item = mounted.get(live.getAttribute("data-id"));
    if (!item) return keepToolVersion(live, incoming);
    const next = toolInfoOf(incoming);
    return !next.invalid && next.rev === item.rev && next.signature === item.signature;
  };

  const onStreamStatus = (status) => {
    if (status?.state && status.state !== "applied") dispatch("clay:reader-status", status);
  };

  const paint = (prepared) => {
    applyPreparedArticle(prepared, { article, readerOpen, savedOpen, keepTool });
    if (prepared.rev === null) article.removeAttribute("data-rev");
    else article.setAttribute("data-rev", prepared.rev);
    if (prepared.title) doc.title = prepared.title;
  };

  // A native apply can throw on markup the parser accepted and the DOM refuses.
  // The receipt stays at the last accepted file, the article goes back to those
  // bytes and the reader reports blocked instead of showing a half-applied tree.
  const restore = (error) => {
    console.warn("clayjs: the reader could not apply a saved file", error);
    stream?.stop();
    stream = null;
    disposeMounts();
    const previous = receipt.bytes ? prepareSavedArticle(receipt.bytes, doc) : null;
    if (previous?.ok) {
      try { paint(previous); } catch (again) { console.warn("clayjs: the reader could not restore the previous file", again); }
    }
    dispatch("clay:reader-status", { state: "blocked" });
  };

  function commit(candidate) {
    if (stopped) return false;
    const prepared = prepareSavedArticle(candidate.bytes, doc);
    if (!prepared.ok) return false;
    if (article.querySelector(".page-editor")) return false;
    // A file published at another version of this document is not this reader's to
    // show: the stream stops, this file and every later one are refused, and the
    // notice offers a reload. Nothing of it reaches the article.
    if (upgradeReplaces(candidate.bytes)) {
      stream?.stop();
      stream = null;
      stopForUpgrade();
      dispatch("clay:reader-status", { state: "blocked", reason: "upgraded" });
      return false;
    }
    pruneTools(prepared.tools);
    try {
      paint(prepared);
    } catch (error) {
      restore(error);
      return false;
    }
    receipt = freezeReceipt(candidate);
    // The article now holds the version this file was, so a save this page makes
    // afterwards has to carry that version's stamp instead of an older one.
    if (receipt.etag) rememberStamp(receipt.etag);
    mountTools(prepared.tools, prepared.toolState);
    dispatch("clay:reader-status", { state: "applied", etag: receipt.etag, seq: receipt.seq });
    return true;
  }

  const onToggle = (event) => {
    const details = event.target;
    if (details.tagName !== "DETAILS" || !article.contains(details)) return;
    const id = details.getAttribute("data-id");
    if (!id) return;
    if (details.open === savedOpen.get(id)) readerOpen.delete(id);
    else readerOpen.set(id, details.open);
  };
  doc.addEventListener("toggle", onToggle, true);
  listeners.push(["toggle", onToggle]);

  if (represented) {
    const prepared = prepareSavedArticle(represented.bytes, doc);
    if (!prepared.ok) throw new Error(`clayjs: the saved file is not a readable page (${prepared.reason})`);
    paint(prepared);
    mountTools(prepared.tools, prepared.toolState);
  } else {
    for (const details of article.querySelectorAll("details[data-id]")) savedOpen.set(details.getAttribute("data-id"), details.hasAttribute("open"));
    mountTools(toolsOf(article), toolStateOf(doc));
  }

  const reader = {
    ready: null,
    get represented() {
      return receipt;
    },
    stop() {
      if (stopped) return final;
      stopped = true;
      mountTurn++;
      stream?.stop();
      stream = null;
      for (const [type, handler] of listeners) doc.removeEventListener(type, handler);
      listeners.length = 0;
      disposeMounts();
      try { host?.dispose(); } catch {}
      host = null;
      release();
      final = Object.freeze({ ...receipt });
      return final;
    },
  };
  reader.ready = Promise.resolve(reader);

  if (feed) {
    const onFrame = (event) => {
      const detail = event.detail;
      if (typeof detail?.html !== "string") return;
      // A live-lane frame is a preview of keystrokes nobody saved; a saved-lane
      // frame is a file, whatever tag a sync implementation put on it. An event
      // naming neither is taken as the saved one.
      if (detail.source && detail.source !== "disk" && detail.lane !== "saved") return;
      commit({ bytes: detail.html, etag: detail.etag ?? null, seq: detail.seq ?? null });
    };
    feed.addEventListener("clay:sync-applied", onFrame);
    listeners.push(["clay:sync-applied", onFrame]);
  } else if (stream) {
    // Adopted from the caller's acquisition: this reader takes the stream over
    // rather than opening a second one, so no save falls between the two.
    stream.adopt({ onSnapshot: commit, onStatus: onStreamStatus });
  } else {
    // No file yet: the article on screen is what this reader holds, and the
    // transport asks the host for the saved one as soon as it opens.
    stream = createSavedStream({
      documentURL,
      servedEtag,
      represented: receipt.bytes ? receipt : null,
      onSnapshot: commit,
      onStatus: onStreamStatus,
    });
    stream.start();
  }
  return reader;
}

/**
 * Start a reader from the exact bytes one accepted saved file carried. Validation
 * and the first apply happen before anything is replaced or received, so a caller
 * that already holds a receipt needs no acquisition GET. `stop()` returns that
 * receipt, or the last one a complete apply recorded, frozen and idempotent.
 *
 * `feed` starts over the page already on screen and takes its saved files from
 * that event target's `clay:sync-applied` events, for a page whose saved lane
 * somebody else already owns: its first receipt is the first frame it applies.
 * `stream` adopts a saved transport the caller already opened, so acquisition and
 * steady state share one connection.
 */
export function start({ represented = null, documentURL, servedEtag = null, stream = null, feed = null, doc = document } = {}) {
  if (represented && (typeof represented.bytes !== "string" || represented.bytes === "")) {
    throw new TypeError("clayjs: the reader needs the full saved bytes to start");
  }
  if (!feed && !stream && !represented && !documentURL) {
    throw new TypeError("clayjs: the reader needs a file, a stream or a page to follow");
  }
  const articles = doc.querySelectorAll(ARTICLE);
  if (articles.length !== 1) throw new Error("clayjs: the reader needs exactly one article[data-page]");
  const article = articles[0];
  if (article.querySelector(".page-editor")) throw new Error("clayjs: the reader will not start over a mounted editor");
  if (represented) {
    const prepared = prepareSavedArticle(represented.bytes, doc);
    if (!prepared.ok) throw new Error("clayjs: the saved file is not a readable page");
    // The version is read from the file's own head before anything is claimed or
    // painted: a file another version wrote replaces this page whole, so a reader
    // showing the old one refuses it and asks for a reload instead.
    if (upgradeReplacesDocument(prepared.source)) {
      stopForUpgrade();
      throw new Error("clayjs: the saved file was published at another version of this document");
    }
  }
  const release = claim(article, "reader");
  try {
    return createReader({ doc, article, represented, feed, documentURL, servedEtag, stream, release });
  } catch (error) {
    release();
    throw error;
  }
}

// The legacy entry: a reader fed by the generic sync lane's `clay:sync-applied`
// events. It owns no stream, so its first receipt is the first applied frame.
export function startPageView(doc = document) {
  const articles = doc.querySelectorAll(ARTICLE);
  if (articles.length !== 1) return () => null;
  return createReader({ doc, article: articles[0], represented: null, feed: doc }).stop;
}

