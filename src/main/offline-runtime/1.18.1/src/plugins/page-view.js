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
// the stream stays open for the next file. So does a stream that cannot open: a switch
// asked before any file arrives reloads instead of waiting out its deadline.
function listen() {
  onStatus = (event) => {
    if (cancelled) return;
    const status = event.detail;
    if (status?.state === "applied") settle?.(reader);
    else if (status?.state === "blocked" || status?.state === "recoverable" || status?.state === "reconnecting") settle?.(null);
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
// commits into that same reader. A caller that already holds the receipt a switch
// accepted passes it here: the article is painted from those bytes at once, with
// no acquisition request, so an exit shows the file it left on.
function acquire(represented = null) {
  if (!oneArticle()) return Promise.resolve(null);
  try {
    reader = represented
      ? startReader({ represented })
      : startReader({ documentURL: window.location.href, servedEtag: servedDocumentEtag });
  } catch (error) {
    console.warn("clayjs: the reader could not start over the served article", error);
    return Promise.resolve(null);
  }
  if (represented) return Promise.resolve(reader.represented);
  return new Promise((resolve) => { settle = resolve; });
}

// Generic sync owns the saved lane here, so the reader takes its frames from that
// lane's accepted disk applies and keeps no stream of its own. A receipt the caller
// already holds is painted at once, so the tag on screen is the file's even before a
// frame arrives.
function followSync(represented = null) {
  if (!oneArticle()) return Promise.resolve(null);
  try {
    reader = startReader({ feed: document, represented, documentURL: window.location.href });
  } catch (error) {
    console.warn("clayjs: the reader could not start over the page sync projects", error);
    return Promise.resolve(null);
  }
  return Promise.resolve(reader);
}

/**
 * Start the reader for the page in front of it. `sync` reports whether the plan
 * the loader resolved carries generic sync, and therefore whether the saved lane
 * already has an owner. `represented` is the receipt a switch accepted: with it
 * the reader paints that file at once and asks the host for nothing, which is how
 * an exit restarts the reader without waiting for a frame.
 */
export function start({ sync = false, represented = null } = {}) {
  if (ready) return ready;
  cancelled = false;
  following = sync;
  listen();
  acquired = sync ? followSync(represented) : acquire(represented);
  // With generic sync the reader starts before this returns, so both promises
  // settle together; otherwise only the transport starts here and the first
  // file arrives later, from the stream.
  ready = sync ? acquired : Promise.resolve(null);
  return ready;
}

// Start the reader again after a switch retired the one this page booted: `start` keeps
// the promise its own boot returns, so the reader an exit replaces has to be taken down
// first. The receipt it is handed is painted at once, so no fetch is made for it.
export function restart(options = {}) {
  stop();
  return start(options);
}

// The reader's half of a live switch: the lane keeps its pending files, and the
// switch is answered with the receipt they will be built from.
export function prepareHandoff(options) {
  if (!reader) return Promise.reject(new Error("clayjs: the reader has not started"));
  return reader.prepareHandoff(options);
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
