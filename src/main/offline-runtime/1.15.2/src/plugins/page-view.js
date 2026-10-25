// The reader half of plugins=page. A Document opened in view mode follows saved
// files through the receive-only saved transport (sync/saved-stream.js): the reader
// opens that transport itself and mounts the article's tools from what the host
// served before the stream says anything, so a host that cannot stream (static,
// offline, file://) still shows a working article. The first full body the
// transport accepts is projected onto that same article. The editor half,
// plugins/page.js, is edit-only. resolveModules adds this module; no URL names it.
//
// When the resolved plan also carries generic sync, sync already streams the saved
// lane: this module opens no stream of its own and takes the frames that lane
// applied instead. The loader passes that choice from the plan it resolved, so the
// reader never reparses the script URL to guess what else is loaded.
import { servedDocumentEtag } from "../core/host-attrs.js";
import { start as startReader } from "../page/view.js";

let reader = null;
let settle = null;
let cancelled = false;
let following = false;
let onStatus = null;

// The promise the loader holds clay:ready for: it settles once the reader has
// started its saved transport, or null with no single article, so clay:ready
// never waits on the network and fires even if the stream never opens.
export let ready = null;

// The first saved file's outcome: the started reader, or null on a blocked or
// recoverable status. The stream keeps running after that null, so a later
// accepted file still reaches the article through the same reader. Await this,
// not `ready`, for the file.
export let acquired = null;

const oneArticle = () => document.querySelectorAll("article[data-page]").length === 1;

// The reader reports what it applied on `clay:reader-status`; the first file is the
// first applied one, and a blocked or recoverable first read settles with null while
// the stream stays open for the next file.
function listen() {
  onStatus = (event) => {
    if (cancelled) return;
    const status = event.detail;
    if (status?.state === "applied") settle?.(reader);
    else if (status?.state === "blocked" || status?.state === "recoverable") settle?.(null);
  };
  document.addEventListener("clay:reader-status", onStatus);
}

function silence() {
  if (onStatus) document.removeEventListener("clay:reader-status", onStatus);
  onStatus = null;
  settle = null;
}

// The reader opens the saved transport and mounts the served article's tools at
// once, so the article works before any file arrives; the first accepted file
// commits into that same reader.
function acquire() {
  if (!oneArticle()) return Promise.resolve(null);
  try {
    reader = startReader({ documentURL: window.location.href, servedEtag: servedDocumentEtag });
  } catch (error) {
    console.warn("clayjs: the reader could not start over the served article", error);
    return Promise.resolve(null);
  }
  return new Promise((resolve) => { settle = resolve; });
}

// Generic sync owns the saved lane here, so the reader takes its frames from that
// lane's accepted disk applies and keeps no stream of its own.
function followSync() {
  if (!oneArticle()) return Promise.resolve(null);
  try {
    reader = startReader({ feed: document, documentURL: window.location.href });
  } catch (error) {
    console.warn("clayjs: the reader could not start over the page sync projects", error);
    return Promise.resolve(null);
  }
  return Promise.resolve(reader);
}

/**
 * Start the reader for the page in front of it. `sync` reports whether the plan
 * the loader resolved carries generic sync, and therefore whether the saved lane
 * already has an owner.
 */
export function start({ sync = false } = {}) {
  if (ready) return ready;
  cancelled = false;
  following = sync;
  listen();
  acquired = sync ? followSync() : acquire();
  // With generic sync the reader starts before this returns, so both promises
  // settle together; otherwise only the transport starts here and the first
  // file arrives later, from the stream.
  ready = sync ? acquired : Promise.resolve(null);
  return ready;
}

export function stop() {
  cancelled = true;
  if (!following) settle?.(null);
  silence();
  reader?.stop();
  reader = null;
  acquired = null;
  ready = null;
}
