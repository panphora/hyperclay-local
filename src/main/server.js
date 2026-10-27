const express = require('express');
const fs = require('fs').promises;
const path = require('upath');
const { Eta } = require('eta');
const { createBackup, publishRecoveredCopy } = require('./utils/backup.js');
const {
  PathError,
  RESERVED_ROOT_SEGMENTS,
  isContained,
  getConsentRegistry,
  decodeOnce,
  validateSegments,
  resolveReadPath,
  resolveWritePath,
  realpathNearestParent
} = require('./utils/path-resolver.js');
const { withFileLock, withDocumentWrite, withStructureChange, assertWriteContext, assertStructureContext, atomicWriteFile } = require('./utils/write-queue.js');
const crypto = require('crypto');
const busboy = require('busboy');
const { scopeTailwindLink } = require('./utils/tailwind-scoping.js');
const { stripSaveToken, injectDocumentEtag } = require('./utils/root-attrs.js');
const runtimeAssets = require('./runtime-assets');
const { projectRuntimeHTML, canonicalizeRuntimeHTML } = runtimeAssets;
const { createRootLive } = require('./utils/root-live.js');
const { replayStore } = require('./sync-replay.js');
const { VERSIONS_DIR, RECOVERED_DIR, TAILWIND_DIR } = require('./utils/artifact-paths.js');
const { canonicalizeBase, rebaseOntoCanonical, assertRealDirChain } = require('./utils/real-dir-chain.js');
const { VERSION_NAME, sortKey, collisionSuffix, compareNewestFirst } = require('./utils/prune-versions.js');
const {
  compileTailwind,
  getTailwindCssName
} = require('tailwind-hyperclay');
const { WireHub } = require('./wire-hub');
const { mountWire } = require('./wire-routes');
const { createHelperDispatcher } = require('./helpers/dispatcher');
const errorLogger = require('./error-logger');
const formatHtml = require('./format-html');
const { hasHtmlRoot } = formatHtml;
const { mapApiTagError, serveSiteApiLocal, extractSiteDataLocal, prepareSiteDataWriteLocal, applySiteDataLocal } = require('./utils/data-api');
const { readDataQuery } = require('./utils/data-query');
const { writeApiSidecar } = require('./utils/api-sidecar');
const dataGuard = require('./data-loss-guard');
const { documentEtag, ifMatchSatisfied } = require('./spec-wire');
const { MAX_EXTERNAL_HTML } = require('./root-observer');
const { buildEnvelope } = require('../sync-engine/control-lane-core.cjs');
const { createLocalLiveData } = require('./local-live-data.js');
const { PRESENCE_VERSION } = require('./presence-target');
const { hasPageStore, loadPageModules, authoritativePageHtml } = require('./utils/page-api');
const { logicalDocument, logicalBytes, storePageState, readPageState, readPageRecord } = require('./page-state-store.js');
const { rebaseStaleSave, needsAdoption, newestVersionFiles } = require('./page-rebase.js');
const roomsPackage = () => require('@panphora/clayjs/server/rooms');
const cheerio = require('cheerio');

// Initialize Eta
const eta = new Eta({
  views: path.join(__dirname, 'templates'),
  cache: true
});

// The logical document a write stores and the clean file part that reaches disk.
async function splitWrite(baseDir, name, html, { keepState = true } = {}) {
  const { file, state } = roomsPackage().splitPage(html);
  if (state) return { file, logical: roomsPackage().composePage(file, state) };
  return { file, logical: keepState ? await logicalDocument(baseDir, name, file) : file };
}

// Document 11 §6b: the `page-format-v1` extension is advertised only when both
// halves exist — the shared rooms package can admit a page format, and the offline
// runtime this app serves to documents carries the core that reads the marker.
function pageFormatSupported({ rooms, runtimeDir } = {}) {
  if (!rooms || typeof rooms.checkPageFormatAdmission !== 'function') return false;
  if (!runtimeDir) return false;
  return require('fs').existsSync(path.join(runtimeDir, 'src', 'core', 'page-format.js'));
}

// Spec §3: `/_/save` takes the document as text, so a JSON body is refused
// rather than guessed at. Compares the media type only, ignoring parameters like
// `; charset=utf-8`, and covers the `+json` structured suffix.
function isJsonContentType(contentType) {
  const mediaType = String(contentType || '').split(';')[0].trim().toLowerCase();
  return mediaType === 'application/json' || mediaType.endsWith('+json');
}

// Spec §3: a request names the document it targets with `Document-URL`. `Page-URL` is
// the pre-spec spelling and is read when the new one is absent, because stored
// documents hardcode it in inline fetch() calls that no library update can reach.
// `Document-URL` wins when both are present.
//
// One function, six call sites. /_/meta, /_/upload and the sync relay each grew this
// pair separately, and /_/save never did: it read `Page-URL` alone, so a spec-following
// client got a 400 on the one route the whole protocol is about. Reading the pair in
// one place is what stops a seventh route from drifting the same way.
function uploadFolderHeader(req) {
  const raw = req && req.headers ? req.headers['upload-folder'] : undefined;
  if (typeof raw !== 'string') return null;
  let rel;
  try {
    rel = decodeURIComponent(raw);
  } catch {
    throw new PathError(400, 'Invalid upload folder');
  }
  if (rel === '') return '';
  validateSegments(rel);
  return rel;
}

function documentUrlHeader(req) {
  return (req && req.headers && (req.headers['document-url'] || req.headers['page-url'])) || null;
}

// A person is named only to a page on this root's own origin. A request that says it
// comes from elsewhere (an Origin header naming another origin, or the literal "null",
// or Fetch Metadata saying cross-site or same-site) gets the document facts it always
// got and no person.
function sameOriginDiscovery(req) {
  const site = req.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.get('origin');
  if (!origin) return true;
  return origin === `${req.protocol}://${req.get('host')}`;
}

// What each open file owes the platform on its next sync upload, keyed by filename
// within its own root's store: the same relative path in two roots is two different
// files, and one root's snapshot must never be uploaded as the other's. Two lanes
// fill it: /live-sync/save contributes the unstripped snapshot, /save contributes
// the provenance bit. Either half can arrive without the other, so both are optional
// and neither lane clears the other's.
const rootStores = new Map();

function snapshotStoreFor(rootId) {
  let store = rootStores.get(rootId);
  if (!store) {
    store = { snapshots: new Map(), etags: new Map() };
    rootStores.set(rootId, store);
  }
  return store;
}

// One sweep over every served root's store, run on the pool's interval
// (root-servers.js).
function sweepExpiredSnapshots(now = Date.now()) {
  const fiveMinutesAgo = now - 5 * 60 * 1000;
  for (const store of rootStores.values()) {
    for (const [key, entry] of store.snapshots) {
      if (entry.timestamp < fiveMinutesAgo) store.snapshots.delete(key);
    }
  }
}

// The etag of the last document a browser save wrote through this root, keyed by
// filename. Its only reader is the `changedBy` on a conflict refusal (spec §6), and
// its only job is to keep that attribution honest.
//
// Everything in this folder belongs to the one person running the app, so
// `another-person` is not a state this host can reach. What it CAN distinguish is a
// second tab of their own from anything else that writes the file: a text editor, a
// git checkout, the sync engine pulling a newer copy down from the platform. If the
// bytes now on disk are bytes this process put there from a browser, the other writer
// was another tab. Otherwise the honest answer is to say nothing, which §6 explicitly
// calls the common and fully conforming case. Inferring "another tab" from the file
// merely having changed would name the person's own tab for an edit made in vim while
// the app was closed, and a confident wrong attribution is worse than none.
// §6's receipt cap. The id is remembered per open file, so an unbounded header
// would be free memory to hand away. Overlong is DROPPED rather than truncated:
// a truncated id could collide with a different client's id and hand somebody
// else's proof to the wrong tab.
const MAX_SAVE_ID_LEN = 128;

/**
 * Spec §6: the id of the save whose body produced the bytes currently on disk,
 * or null when this host cannot prove that pairing.
 *
 * The proof is answer-time and needs no invalidation hooks: the id was recorded
 * beside the etag of the bytes that save wrote, so a stamp that no longer equals
 * what is on disk means something else has written since and the pair is
 * worthless. A text editor, a git checkout, or the sync engine pulling a newer
 * copy down all invalidate it by moving the bytes, without any of them knowing
 * this record exists. Unverifiable reads as absent, never as an answer.
 *
 * The claim is deliberately about BYTES and not about a person: "disk holds the
 * stored form of a body that save sent". That is why `mtimeNs`, which `changedBy`
 * needs to survive a B -> C -> B revert, is not consulted here. Naming an actor
 * after a revert names the wrong one; attesting to bytes after a revert is still
 * true, and §6 lets a client adopt a stamp for bytes byte-equivalent to what its
 * own save produced.
 *
 * @param {{etags: Map}} store - the served root's store
 * @param {string} filePath - canonical path, the same key the write queue uses
 * @param {string} currentEtag - stamp of the bytes on disk right now
 * @returns {string|null}
 */
function saveReceiptFor(store, filePath, currentEtag) {
  const ours = store.etags.get(filePath);
  if (!ours || !ours.saveId || ours.etag !== currentEtag) return null;
  return ours.saveId;
}

/**
 * Get and clear what a file owes the platform: the live-sync snapshot, the save's
 * provenance bit, or either one alone. Called by the sync engine before uploading.
 *
 * Returning null when there is no snapshot used to throw the provenance bit away
 * with it, which mattered as soon as the snapshot stopped riding along on the save
 * lane: a document on a preset without live-sync produces no snapshot at all, and
 * its saves would have reached the platform guard as ui-unknown.
 *
 * @param {string} filename - Filename including extension
 * @param {string} rootId - served root whose store to read; the legacy app's by default
 * @returns {{html: (string|null), userDriven: (boolean|undefined)}|null}
 */
function getAndClearSnapshot(filename, rootId = LEGACY_ROOT.id) {
  const snapshots = snapshotStoreFor(rootId).snapshots;
  const entry = snapshots.get(filename);
  snapshots.delete(filename);
  if (!entry) return null;
  if (!entry.html && entry.userDriven === undefined) return null;
  return { html: entry.html || null, userDriven: entry.userDriven };
}

const PORT = 4321;

// The root an app built from the string form serves. Its id is what keeps the
// snapshot store of every `createApp(dir)` call shared, as it was when the two maps
// were module state and a folder switch had to clear them.
const LEGACY_ROOT = Object.freeze({ id: 'legacy', kind: 'personal', port: PORT });

// Local file-serving validation. Deliberately NOT the sync engine's
// validateFileName (sync-engine/validation.js), which enforces a lowercase-ASCII
// *site-name* policy for cloud sync. A file on your own disk may contain spaces,
// `%`, `#` and non-ASCII, and must stay reachable locally even when its name
// could never be a hosted site name.
function validateAndResolvePath(name, baseDir) {
  if (typeof name !== 'string' || !/\.(html|htmlclay)$/.test(name)) {
    return { error: 'Invalid file path' };
  }

  let segments;
  try {
    segments = validateSegments(name);
  } catch {
    return { error: 'Invalid file path' };
  }

  const filePath = path.join(baseDir, name);
  const resolvedPath = path.resolve(filePath);
  const resolvedBase = path.resolve(baseDir);

  if (!resolvedPath.startsWith(resolvedBase + '/')) {
    return { error: 'Path escapes base directory' };
  }

  return { filePath, resolvedPath, baseName: segments[segments.length - 1] };
}

// Name check + phase-4 canonical write resolution. The returned path is both the
// file to write and the write-queue key; every writer must use exactly this.
async function resolveWriteTarget(paths, name) {
  await paths.ready();
  const validated = validateAndResolvePath(name, paths.baseReal);
  if (validated.error) throw new PathError(400, validated.error);
  return await resolveWritePath(paths, name);
}

// Serve the file's ORIGINAL BYTES — with a page editor's merge state put back,
// which is the document a client holds. Reading as utf8 and re-encoding on the way
// out silently rewrites any file that is not valid UTF-8, so a document with no
// such state is served from the bytes exactly as they were read.
//
// The response also carries the stamp of those exact bytes on the root element
// (spec §4 response metadata, `documentetag`), so a tab that loaded this document
// can tell whether the version it is holding is still the one on disk. The stamp
// is computed from the buffer this response was built from — never from the
// injected bytes and never from the DOM — and the buffer is read exactly once, so
// the attribute cannot describe a version other than the one being served. The
// file itself is untouched, and every response gets it, in view and edit mode:
// the repair fetch needs it as much as the navigation that preceded it.
async function serveHtml(req, res, filePath, frame = null, baseDir = null, name = null) {
  // The document served is the logical one: the bytes on disk with the page
  // editor's merge state put back. A document with no such state is served from
  // the bytes exactly as read, so nothing outside a page editor is re-encoded.
  const html = await logicalBytes(baseDir, name, await fs.readFile(filePath));
  const etag = documentEtag(html);
  // ClayJS's source plugin asks for the canonical bytes with this header; it must
  // get them unprojected, or it would save this host's local URLs back to disk.
  const served = req.get('Clay-Source') === '1' ? html : projectServed(req, html);
  res.set('Content-Type', 'text/html');
  res.set('Vary', 'Clay-Source');
  const stamped = injectDocumentEtag(served, etag);
  if (!frame) return res.send(stamped);
  const { injectWorkspaceBridge } = require('@panphora/hyperclay-workspace/server');
  const raw = stamped.toString('latin1');
  const bom = raw.startsWith('\xef\xbb\xbf') ? raw.slice(0, 3) : '';
  const bridged = bom + injectWorkspaceBridge(raw.slice(bom.length), {
    nodeId: frame.wireId, framed: true, origin: frame.shellOrigin, hostSuffix: 'localhost',
  });
  let at = 0;
  while (at < raw.length && raw[at] === bridged[at]) at++;
  const added = bridged.length - raw.length;
  if (added < 0 || bridged.slice(at + added) !== raw.slice(at)) throw new Error('Workspace bridge changed document bytes');
  return res.send(Buffer.concat([
    stamped.subarray(0, at), Buffer.from(bridged.slice(at, at + added), 'utf8'), stamped.subarray(at),
  ]));
}

// A document that names the public runtime (`https://clayjs.com/v1/...`) is served with
// those URLs pointing at this host's own copy of the bundled release, so it starts
// with no network. Only the response changes: the file keeps its bytes, and the
// stamp below still describes the bytes on disk.
const warnedUnavailable = new Set();

function projectServed(req, html) {
  const text = html.toString('utf8');
  // Never re-encode a file that is not valid UTF-8: decoding would replace every
  // bad byte, and the response would no longer be the document that is stored.
  if (!Buffer.from(text, 'utf8').equals(html)) return html;
  const result = projectRuntimeHTML(text, {
    releases: runtimeAssets.releases,
    selectedVersion: runtimeAssets.selectedVersion,
    documentURL: `http://${req.get('host')}${req.originalUrl}`,
  });
  if (result.unavailable) {
    const detail = `${result.unavailable.reason} ${result.unavailable.versions.join(',')}`.trim();
    req.res.set('Clay-Runtime-Unavailable', detail);
    const key = `${req.path}\n${detail}`;
    if (!warnedUnavailable.has(key)) {
      warnedUnavailable.add(key);
      console.warn(`[offline-runtime] ${req.path} is served with public runtime URLs: ${detail}`);
    }
  }
  if (!result.mappings.length) return html;
  return Buffer.from(result.html, 'utf8');
}

// The other direction, for the bytes that become the document. A browser holding a
// projected document saves what it holds, and nothing guarantees the client puts the
// public URLs back: an older ClayJS, a hand-written save, the JSON data API, a restored
// version or an incoming relay frame can all carry `/_/clayjs/` URLs or the descriptor.
// Bytes like that only work on this host, and platform sync would upload them. Every
// authoritative write turns them back into the public URLs and drops the descriptor
// first. One pass, so the descriptor is read once: the document URL is the first loopback
// origin the text names before `/_/clayjs/` (any port, since each root server listens on
// its own), and a root-relative `/_/clayjs/` URL resolves under any origin.
const LOOPBACK_RUNTIME = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?(?=\/_\/clayjs\/)/i;

function canonicalForWrite(html) {
  const origin = html.match(LOOPBACK_RUNTIME);
  const documentURL = origin ? `${origin[0].toLowerCase()}/` : 'http://localhost/';
  const result = canonicalizeRuntimeHTML(html, { releases: runtimeAssets.releases, documentURL });
  return result.changed === 0 && !result.descriptorRemoved ? html : result.html;
}

// Translate a data-api result object ({ status, headers?, json?, raw? }) into a
// response. `raw` is a JSON string sent verbatim (res.json would double-encode it);
// `json` is an object sent via res.json.
function sendApiResult(res, result) {
  if (result.headers) {
    for (const [key, value] of Object.entries(result.headers)) res.setHeader(key, value);
  }
  if (result.raw !== undefined) {
    return res.status(result.status).type('application/json').send(result.raw);
  }
  return res.status(result.status).json(result.json);
}

function resolveResourceFromHref(href) {
  let pathname;
  try {
    pathname = new URL(href).pathname;
  } catch {
    pathname = href;
  }

  // Decode exactly once, for the same reason the static catch-all does: a
  // browser sends `Page-URL: .../50%25%20off.html`, and without this the save
  // would land in a NEW file literally named `50%25%20off.html` while the real
  // one sat untouched. A malformed `%` leaves the value as-is so the caller's
  // own validation rejects it.
  try {
    pathname = decodeURIComponent(pathname);
  } catch {}

  if (pathname === '/') return 'index.html';

  pathname = pathname.replace(/^\//, '');

  // Normalize so downstream liveSync keys (marks, broadcasts, subscriptions)
  // match the watcher's path.normalize(filename) output. Collapses `//`, `./`
  // and folds backslashes via upath.
  const htmlMatch = pathname.match(/^(.*?\.html(?:clay)?)/);
  if (htmlMatch) return path.normalize(htmlMatch[1]);

  return path.normalize(pathname);
}

// ---------------------------------------------------------------- uploads (spec §9)

const SAVE_MAX_BYTES = 20 * 1024 * 1024;
const API_WRITE_MAX_BYTES = 1024 * 1024;
const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
const UPLOAD_ACCESS = 'local';

// Refused by type. A document or a script stored beside a document and served
// from the same origin is stored XSS: the file the person "just uploaded"
// executes with the document's own authority. The enumerated set mirrors
// hyperclay.com's DOCUMENT_UPLOAD_EXTENSIONS (server-lib/upload-safety.js), and
// the type check is the belt for anything it misses. SVG is deliberately
// accepted and served inert instead, see the Content-Disposition on the static
// lane below. A file with no extension or an unknown one is accepted: send types
// it application/octet-stream, which a browser downloads.
const UPLOAD_REFUSED_EXTENSIONS = new Set([
  '.html', '.htm', '.shtml', '.xhtml', '.xht', '.htmlclay',
  '.xml', '.xsl', '.xslt', '.mathml', '.mml', '.rss', '.atom', '.rdf',
  '.js', '.mjs', '.cjs', '.ecma',
]);
const DOCUMENT_TYPE = /^(?:text\/html|application\/xhtml\+xml|text\/xml|application\/xml|[a-z0-9.-]+\/[a-z0-9.+-]*\+xml|text\/mathml|text\/javascript|application\/javascript|application\/x-javascript|application\/ecmascript|text\/ecmascript)$/i;

function refusedUpload(fileName) {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  if (!ext || ext === '.svg' || ext === '.svgz') return false;
  return UPLOAD_REFUSED_EXTENSIONS.has(ext) || DOCUMENT_TYPE.test(express.static.mime.lookup(ext.slice(1)) || '');
}

// The one cleanup a client-supplied filename gets. The refusal and the stored
// name both read this result, so the type that is checked is the type that is
// stored: a NUL or a path stripped later can no longer turn `.ht\0ml` into `.html`.
function normalizeUploadName(fileName) {
  return path.basename(String(fileName || 'file'))
    .replace(/\0/g, '')
    .replace(/[<>:"|?*\x01-\x1f]/g, '')
    .replace(/^\.+/, '');
}

// A file directly inside a document's uploads folder, where every upload is
// stored. Case-insensitive, because the disk usually is.
function inUploadsFolder(realPath) {
  return /^assets-/i.test(path.basename(path.dirname(realPath)));
}

// Split a client-supplied filename into the parts the stored name is built from.
// A leading dot is stripped rather than preserved: validateSegments 404s any
// dot-prefixed segment, so `.avatar.png` would otherwise be refused with a
// message about a missing file.
function splitUploadName(fileName) {
  const base = normalizeUploadName(fileName);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return { stem: base || 'file', ext: '' };
  return { stem: base.slice(0, dot) || 'file', ext: base.slice(dot) };
}

// Every document upload lands in this root's `uploads/assets-<stem>/`, never beside the document, and the
// page links it as `/_/uploads/assets-<stem>/<name>`: the same layout and the same link
// hyperclay.com uses, so a synced folder holds identical bytes on both sides, and renaming or
// moving the document never strands its files. The stem is slugged to hyperclay.com's folder
// alphabet so the folder can sync: `My Board.v2.html` -> `assets-my-board-v2`.
// An upload into a folder with no document (the workspace window) lands in that folder itself.
const UPLOADS_FOLDER = 'uploads';

function assetsFolderName(docRelPath) {
  const stem = path.basename(docRelPath).replace(/\.(html?|htmlclay|xhtml)$/i, '');
  const slug = stem.toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return `assets-${slug || 'document'}`;
}

// Every byte outside the unreserved set escaped, `! ' ( ) *` included, so the link is one unbroken
// run of `[A-Za-z0-9._~%/-]` that the zip exporter reads whole. hyperclay.com encodes the same way.
function strictSegment(segment) {
  return encodeURIComponent(segment).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

// The legacy sibling folder an older upload went into, `blog/assets-app` for `blog/app.html`.
// Still served by the static route, and still read by the zip export.
function assetsDirFor(docRelPath) {
  const dir = path.dirname(docRelPath);
  const stem = path.basename(docRelPath).replace(/\.(html?|htmlclay|xhtml)$/i, '');
  const folder = `assets-${stem}`;
  return dir === '.' || dir === '' ? folder : `${dir}/${folder}`;
}

// Content-hash naming, which is what removes the race rather than a lock. Two
// uploads of DIFFERENT bytes get different names and never contend; two uploads
// of the SAME bytes converge on one file, and whichever loses the exclusive
// create reads back what the winner wrote and agrees with it. The tail lengthens
// only on a genuine hash prefix collision between different content.
async function storeUpload(paths, dirRel, fileName, content, token = null, onCandidate = null) {
  if (token) assertStructureContext(token);
  const { stem, ext } = splitUploadName(fileName);
  const digest = crypto.createHash('sha256').update(content).digest('hex');
  for (let len = 6; len <= 32; len += 2) {
    const name = `${stem}-${digest.slice(0, len)}${ext}`;
    const rel = dirRel ? `${dirRel}/${name}` : name;
    validateSegments(rel);
    const abs = await resolveWritePath(paths, rel);
    const target = onCandidate ? await onCandidate({ rel, abs }) : null;
    let handle = null;
    try {
      // 'wx' is O_EXCL: it creates or it fails, it never truncates. A plain write
      // here would let a second upload silently overwrite the first.
      handle = await fs.open(abs, 'wx', 0o644);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = await fs.readFile(abs);
      if (existing.equals(content)) return { name, bytes: content.length, canonicalPath: abs, wrote: false };
      continue;
    }
    try {
      await handle.writeFile(content);
    } finally {
      await handle.close();
    }
    return { name, bytes: content.length, canonicalPath: abs, wrote: true, ...(target ? { target } : {}) };
  }
  throw new PathError(409, 'Could not find a free name for that file.');
}

// One file part named `file` (spec §9). Anything else in the body is drained and
// ignored rather than refused, so a client that also sends fields still works.
function readUploadPart(req, limit) {
  return new Promise((resolve, reject) => {
    let parser;
    try {
      parser = busboy({ headers: req.headers, limits: { fileSize: limit, files: 1 } });
    } catch {
      return reject(new PathError(400, 'Expected a multipart form upload.'));
    }
    let part = null;
    let failed = null;
    parser.on('file', (field, stream, info) => {
      if (field !== 'file' || part) { stream.resume(); return; }
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      // busboy TRUNCATES at the limit rather than erroring, so without this a file
      // over the cap is stored silently short and reported as a success.
      stream.on('limit', () => {
        failed = new PathError(413, `Files are limited to ${limit} bytes.`);
        stream.resume();
      });
      stream.on('end', () => { if (!failed) part = { filename: info.filename, content: Buffer.concat(chunks) }; });
    });
    parser.on('error', () => reject(new PathError(400, 'Could not read the upload.')));
    parser.on('close', () => (failed ? reject(failed) : resolve(part)));
    req.pipe(parser);
  });
}

// The spec's §3 code for a status, so a client branches on the reason instead of
// pattern-matching the message.
const UPLOAD_CODES = { 400: 'bad-request', 403: 'forbidden', 404: 'not-found', 409: 'conflict', 413: 'too-large', 415: 'unsupported-type' };

// `/_/<action>` system-route marker (mirrors hyperclay's SYSTEM_ROUTE_MARKER = '_').
// Strips a leading `/_/` so `/_/save` → `/save`, `/_/live-sync/stream?x` →
// `/live-sync/stream?x`. Non-marker URLs pass through unchanged. Pure + exported
// for testing (the server binds a hardcoded port, so we don't boot it in unit tests).
function stripSystemRouteMarker(url) {
  if (typeof url === 'string' && url.startsWith('/_/')) {
    return url.slice(2); // drop leading "/_", keep the rest starting at "/"
  }
  return url;
}

// Known `/_/` system routes on this host. Anything else under the marker is reserved
// and 404s, so `/_/foo.html` can never reach the static catch-all and serve a document.
const SYSTEM_ROUTES = new Set(['save', 'live-sync', 'sync', 'wire', 'data-loss', 'api', 'meta', 'upload', 'uploads', 'versions', 'version', 'restore', 'clayjs', 'presence', 'page-state']);

// Spec §3's code registry, keyed by the status this host answers with, so a
// status and its code can never drift apart. A status the registry does not name
// carries no code at all: a client branches on the value, so a name nobody else
// uses is a branch nobody else takes.
const SPEC_ERROR_CODES = {
  403: 'forbidden',
  404: 'not-found',
  413: 'too-large',
  415: 'unsupported-type',
  422: 'invalid-document'
};

// True when a hostname (already parsed out of a URL or a Host header) names this
// machine's loopback interface. The whole 127/8 block counts, as does every
// spelling of IPv6 loopback — `new URL` normalizes `[0:0:0:0:0:0:0:1]` to `[::1]`,
// and the brackets are stripped before comparison.
function isLoopbackHostname(hostname) {
  if (typeof hostname !== 'string' || hostname.length === 0) return false;
  const bare = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  return bare === 'localhost' ||
         bare === '::1' ||
         bare === '0:0:0:0:0:0:0:1' ||
         /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bare);
}

// True when an Origin header value points at this machine's loopback interface.
// Loopbackness alone is not enough to let a request through: every folder is its
// own port, so the port is compared separately below. Remote origins are what
// this blocks.
function isLoopbackOrigin(origin) {
  try {
    return isLoopbackHostname(new URL(origin).hostname);
  } catch {
    return false;
  }
}

// The port an Origin header names, or NaN when it names no parseable one. An
// origin with no port is spelled out (`http://localhost` is port 80) rather than
// read as "no port", so it can never equal a server's own TCP port by accident.
function originPort(origin) {
  try {
    const u = new URL(origin);
    return Number(u.port || (u.protocol === 'https:' ? 443 : 80));
  } catch {
    return NaN;
  }
}

// True when an Origin header names the exact port this app is served on. Two
// ports answer that, because the ctx form is built with the port its root was
// given while the legacy string form is built before anything has listened on it:
// `req.socket.localPort` — the port this connection arrived on — is then the only
// truthful statement of the app's own origin.
function isOwnOrigin(origin, req, ctx) {
  const port = originPort(origin);
  return port === ctx.root.port || port === (req.socket && req.socket.localPort);
}

// True when a Host header addresses this server legitimately. Parsed through
// `new URL` rather than split on ':' — splitting mangles an IPv6 literal like
// `[::1]:4321` into `[` + `:1]:4321`. Userinfo and path tricks (`localhost@evil.com`,
// `localhost/../evil.com`) fall out correctly because URL parsing resolves them
// to the real hostname before the comparison.
function isLoopbackHostHeader(hostHeader) {
  if (typeof hostHeader !== 'string' || hostHeader.length === 0) return false;
  try {
    return isLoopbackHostname(new URL(`http://${hostHeader}`).hostname);
  } catch {
    return false;
  }
}

// ------------------------------------------------- shared stream (spec §10, C5.3)

// The list form is `GET /_/sync?s=lane:since:url&s=...`: one connection carrying
// several subscriptions, each frame named after the entry it belongs to, so a
// SharedWorker can demultiplex one stream into one subscription per page. The
// caps are htmlclay's, because the client that opens this stream is the same one.
const MAX_SHARED_SUBS = 256;
const SSE_KEEPALIVE_MS = 25 * 1000;

// The SharedWorker script, read once. A worker script must be same-origin with
// the page that starts it, so the client library cannot bring its own: every host
// that announces `sync-worker` serves this file.
const SYNC_WORKER_JS = require('fs').readFileSync(path.join(__dirname, 'assets', 'sync-worker.js'));

// One `s` value: lane:since:document-url. Split on the first two colons only, so
// a document URL carrying a colon (a port, most often) survives.
function parseSharedEntry(raw) {
  if (typeof raw !== 'string') return null;
  const first = raw.indexOf(':');
  const second = first < 0 ? -1 : raw.indexOf(':', first + 1);
  if (second < 0) return null;
  const lane = raw.slice(0, first);
  if (lane !== 'live' && lane !== 'saved') return null;
  const sinceText = raw.slice(first + 1, second);
  if (!/^\d+$/.test(sinceText)) return null;
  const since = Number(sinceText);
  if (!Number.isSafeInteger(since)) return null;
  return { lane, since, href: raw.slice(second + 1) };
}

// The client's resume point. EventSource sends the header itself on reconnect;
// both hyperclay clients also accept the query form.
function parseLastEventId(req) {
  const raw = req.headers['last-event-id'] || req.query.lastEventId || '';
  const v = Number(String(raw).trim());
  return Number.isSafeInteger(v) && v > 0 ? v : 0;
}

// The resume baseline as a named event, carrying an id so a native EventSource
// records a position as early as possible. It never reaches onmessage, so it
// never looks like data.
function cursorFrame(seq, resync) {
  const data = resync ? { seq, resync: true } : { seq };
  return `event: cursor\nid: ${seq}\ndata: ${JSON.stringify(data)}\n\n`;
}

// The cursor of one subscription on a shared stream. No id: one id for many
// subscriptions would name a position for none of them.
function sharedCursorFrame(i, seq, resync) {
  const data = resync ? { sub: i, seq, resync: true } : { sub: i, seq };
  return `event: cursor\ndata: ${JSON.stringify(data)}\n\n`;
}

// One entry the host will not serve is answered inside a stream that goes on
// serving the others: refusing the whole connection over one entry would cut
// every open page off because a single one closed its document.
function notFoundCursorFrame(i) {
  return `event: cursor\ndata: ${JSON.stringify({ sub: i, error: 'not-found' })}\n\n`;
}

// The subscriber record of one entry. The library writes `id: N\ndata: ...\n\n`,
// so prefixing the name yields `event: s<i>\nid: N\ndata: ...\n\n` — the exact
// shape htmlclay writes.
function taggedSink(res, i) {
  const tag = `event: s${i}\n`;
  return { write: (message) => res.write(tag + message) };
}

// The list form joins the same gate as htmlclay's stream: a stream is opened by a
// page on this origin, and nothing else has a reason to hold one open.
function sameOriginStream(req) {
  if (req.headers['sec-fetch-site'] !== 'same-origin') return false;
  const origin = req.headers.origin;
  return origin === undefined || origin === `http://${req.headers.host}`;
}

// A path is this host by construction; an absolute URL must name this host, or a
// page could subscribe a stream to somebody else's document.
function hrefIsThisOrigin(req, href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return Boolean(href);
  }
  return url.host === req.headers.host;
}

// The key the rest of the server uses: the relative path, which replay calls then
// run through ctx.live.key so team roots never share a bucket.
async function resolveSharedFile(paths, req, href) {
  if (!hrefIsThisOrigin(req, href)) return null;
  const name = resolveResourceFromHref(href);
  if (!name) return null;
  let realPath;
  try {
    realPath = await resolveReadPath(paths, name);
  } catch {
    return null;
  }
  const stats = await fs.stat(realPath).catch(() => null);
  return stats && stats.isFile() ? name : null;
}

async function handleSharedSyncStream(ctx, paths, req, res, raw) {
  if (!sameOriginStream(req)) return res.status(403).type('text/plain').send('Forbidden');
  if (raw.length === 0 || raw.length > MAX_SHARED_SUBS) return res.status(400).type('text/plain').send('Bad Request');
  const entries = raw.map(parseSharedEntry);
  if (entries.some((e) => e === null)) return res.status(400).type('text/plain').send('Bad Request');

  // Every entry is resolved before a byte is written, and the resume-then-subscribe
  // pairs below run with no await among them: Node runs the rest of this handler to
  // completion, so a frame published while it runs cannot fall between the replay
  // and the subscription.
  const files = await Promise.all(entries.map((e) => resolveSharedFile(paths, req, e.href)));

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const opened = [];
  entries.forEach((e, i) => {
    const file = files[i];
    if (!file) {
      res.write(notFoundCursorFrame(i));
      return;
    }
    const { baseline, replay, resync } = replayStore.resume(ctx.live.key(file), e.lane, e.since);
    const sink = taggedSink(res, i);
    res.write(sharedCursorFrame(i, baseline, resync));
    for (const message of replay) sink.write(message);
    ctx.live.subscribe(file, sink, { lane: e.lane });
    opened.push({ file, sink });
  });

  const keepAlive = setInterval(() => {
    try { res.write(': keepalive\n\n'); } catch { clearInterval(keepAlive); }
  }, SSE_KEEPALIVE_MS);
  req.on('close', () => {
    clearInterval(keepAlive);
    for (const { file, sink } of opened) ctx.live.unsubscribe(file, sink);
  });
}

// ------------------------------------------------- shared stream v2 (spec §10, live-data)

// The v2 list form adds one member per live editor to the same one-connection
// shape: `m=clientId:document-url`. Split on the first colon only, so a document
// URL carrying a colon (a port, most often) survives here exactly as it does in
// `s`. The client id is the same one the data lane mints a proof for.
const MAX_SHARED_MEMBERS = 256;

function parseSharedMember(raw) {
  if (typeof raw !== 'string') return null;
  const at = raw.indexOf(':');
  if (at < 0) return null;
  const clientId = raw.slice(0, at);
  if (!LIVE_CLIENT_ID.test(clientId)) return null;
  const href = raw.slice(at + 1);
  if (!href) return null;
  return { clientId, href };
}

// The logical resource an entry names on THIS request's own origin, or null when
// the href is unusable, names another host, or names nothing at all. Pairing is
// decided with this and nothing else, so it happens before any filesystem read:
// a member pairs with a live entry for the same normalized root/path, never
// merely with another spelling of the same canonical file.
function sharedEntryResource(req, href) {
  let url;
  try {
    url = new URL(String(href));
  } catch {
    return null;
  }
  if (url.origin !== `http://${req.headers.host}`) return null;
  return resolveResourceFromHref(String(href)) || null;
}

// A v2 subscription's cursor. `v:2` is what tells a v2 client this host speaks
// the new wire; a cursor without it means the host rolled back, and the client
// falls back to the direct stream instead of waiting for members that will never
// arrive. No id: one id for many subscriptions would name a position for none.
function sharedCursorFrameV2(i, seq, resync) {
  const data = resync ? { v: 2, sub: i, seq, resync: true } : { v: 2, sub: i, seq };
  return `event: cursor\ndata: ${JSON.stringify(data)}\n\n`;
}

// One entry the host will not serve is answered inside the stream that goes on
// serving the others, and it carries `v:2` too: a v2 client must be able to tell
// "this document is gone" from "this host never spoke v2".
function notFoundCursorFrameV2(i) {
  return `event: cursor\ndata: ${JSON.stringify({ v: 2, sub: i, error: 'not-found' })}\n\n`;
}

// One member's readiness. It names the member's index and carries no proof: a
// conn belongs to the data lane's state read and is never put on a stream, so
// nothing here can be replayed into somebody else's connection.
function memberCursorFrame(j, notFound) {
  const data = notFound ? { v: 2, member: j, error: 'not-found' } : { v: 2, member: j };
  return `event: cursor\ndata: ${JSON.stringify(data)}\n\n`;
}

// The v2 shared stream. It keeps the v1 shape -- one connection per origin, one
// snapshot subscription per `s` entry, frames named `s<i>` -- and adds one member
// per live editor, whose named room events are wrapped per recipient as `m<j>`.
// One writer, one backlog counter and one teardown cover the whole response, so a
// connection that stops reading is dropped once, not once per member.
async function handleSharedSyncStreamV2(ctx, req, res, { resolveTarget, s, m, v }) {
  const refuse = () => res.status(400).type('text/plain').send('Bad Request');
  if (!sameOriginStream(req)) return res.status(403).type('text/plain').send('Forbidden');
  if (v !== '2') return refuse();
  if (s.length === 0 || s.length > MAX_SHARED_SUBS || m.length > MAX_SHARED_MEMBERS) return refuse();

  const entries = s.map(parseSharedEntry);
  if (entries.some((entry) => entry === null)) return refuse();
  const members = m.map(parseSharedMember);
  if (members.some((member) => member === null)) return refuse();

  // Two members for one client on one document would be two proofs for one port.
  const seen = new Set();
  for (const member of members) {
    const key = `${member.clientId}\n${sharedEntryResource(req, member.href) || member.href}`;
    if (seen.has(key)) return refuse();
    seen.add(key);
  }

  // Pairing is logical and origin-exact, and it is settled before any read: a
  // member must name the live entry of the same normalized resource.
  const entryResources = entries.map((entry) => sharedEntryResource(req, entry.href));
  const memberResources = members.map((member) => sharedEntryResource(req, member.href));
  const liveResources = new Set();
  for (const [i, entry] of entries.entries()) {
    if (entry.lane !== 'live') continue;
    const name = entryResources[i];
    if (name) liveResources.add(name);
  }
  for (const name of memberResources) {
    if (!name || !liveResources.has(name)) return refuse();
  }

  // Close tracking is installed before the first awaited resolution and checked
  // after the last one: a connection that left while its documents were being
  // resolved must register nothing at all.
  let closed = false;
  const noteClosed = () => { closed = true; };
  req.on('close', noteClosed);
  res.on('close', noteClosed);

  // A resolver that refuses before it reaches the disk throws synchronously, and
  // one that refuses later rejects. Both are this entry's own not-found cursor
  // and neither is allowed to take the rest of the connection down with it.
  const resolveOne = (href) => {
    let pending;
    try {
      pending = resolveTarget(req, { fresh: true, href });
    } catch {
      return Promise.resolve(null);
    }
    return Promise.resolve(pending).then((target) => target, () => null);
  };
  const resolvedEntries = await Promise.all(entries.map((entry) => resolveOne(entry.href)));
  const resolvedMembers = await Promise.all(members.map((member) => resolveOne(member.href)));
  if (closed) return;

  // An earlier resolution has had time to go stale while a later one was awaited,
  // so every resolved target is rechecked before it can pair or register: one that
  // is no longer current is answered exactly as one that was never found.
  for (let i = 0; i < resolvedEntries.length; i += 1) {
    const target = resolvedEntries[i];
    if (target && !ctx.localAuthority.isCurrentTarget(target)) resolvedEntries[i] = null;
  }
  for (let j = 0; j < resolvedMembers.length; j += 1) {
    const target = resolvedMembers[j];
    if (target && !ctx.localAuthority.isCurrentTarget(target)) resolvedMembers[j] = null;
  }

  const matchedLiveEntries = new Set();
  const admittedMembers = resolvedMembers.map((target, j) => {
    if (!target) return null;
    let matched = false;
    for (const [i, entry] of entries.entries()) {
      const snapshot = resolvedEntries[i];
      if (entry.lane !== 'live' || entryResources[i] !== memberResources[j] || !snapshot) continue;
      if (snapshot.rootId !== target.rootId || snapshot.logicalPath !== target.logicalPath ||
        snapshot.origin !== target.origin || snapshot.canonicalPath !== target.canonicalPath ||
        snapshot.identity !== target.identity) continue;
      matchedLiveEntries.add(i);
      matched = true;
    }
    return matched ? target : null;
  });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let torn = false;
  let keepAlive = null;
  const disposers = [];
  const memberRefs = [];
  const writer = boundedWriter(res, () => teardown());

  // One teardown for the whole connection: every snapshot, every member, the
  // keepalive and the response itself. A refused write, a closed socket and an
  // early return below all land here, and here only once.
  function teardown() {
    if (torn) return;
    torn = true;
    writer.stop();
    if (keepAlive) clearInterval(keepAlive);
    for (const member of memberRefs) member.close();
    for (const dispose of disposers) dispose();
    for (const plan of plans) if (plan) ctx.live.unsubscribe(plan.file, plan.sink);
    res.removeListener('close', teardown);
    req.removeListener('close', teardown);
    res.removeListener('close', noteClosed);
    req.removeListener('close', noteClosed);
    try {
      res.destroy();
    } catch {}
  }

  // Resume before subscribing, then register every surviving snapshot and member
  // in one synchronous section: Node runs it to completion, so no frame can fall
  // between a replay and its subscription, and no named event can reach a member
  // this connection has not admitted yet.
  const plans = entries.map((entry, i) => {
    const target = resolvedEntries[i];
    if (!target) return null;
    return {
      target,
      lane: entry.lane,
      file: target.logicalPath,
      sink: taggedSink(writer, i),
      resume: replayStore.resume(ctx.live.key(target.logicalPath), entry.lane, entry.since),
      // A live entry no member asked for is an editor that has not joined server
      // data. A saved viewer never joins, so it never raises that barrier.
      legacy: entry.lane === 'live' && !matchedLiveEntries.has(i),
    };
  });
  for (const plan of plans) {
    if (!plan) continue;
    ctx.live.subscribe(plan.file, plan.sink, { lane: plan.lane });
    disposers.push(ctx.localAuthority.registerSnapshot(plan.target, { lane: plan.lane, legacy: plan.legacy }));
  }
  members.forEach((member, j) => {
    const target = admittedMembers[j];
    if (!target) return;
    memberRefs.push(ctx.localAuthority.registerEditor(target, {
      clientId: member.clientId,
      send: (name, payload) => writer.write(`event: m${j}\ndata: ${JSON.stringify({ event: name, data: payload })}\n\n`),
    }));
  });

  keepAlive = setInterval(() => writer.write(': keepalive\n\n'), SSE_KEEPALIVE_MS);
  res.on('close', teardown);
  req.on('close', teardown);

  // Readiness first: a port opens once it has both this connection's snapshot
  // cursor and its own member cursor, and a member that appears after this point
  // is already registered, so it cannot miss the frame that wakes it.
  for (let j = 0; j < members.length; j += 1) {
    if (writer.dropped) return;
    writer.write(memberCursorFrame(j, !admittedMembers[j]));
  }
  // Then each entry's cursor and replay, in query order. A named room event never
  // reaches a sink here, so nothing on this stream can move a replay position.
  for (let i = 0; i < plans.length; i += 1) {
    if (writer.dropped) return;
    const plan = plans[i];
    if (!plan) {
      writer.write(notFoundCursorFrameV2(i));
      continue;
    }
    writer.write(sharedCursorFrameV2(i, plan.resume.baseline, plan.resume.resync));
    for (const message of plan.resume.replay) {
      if (writer.dropped) return;
      plan.sink.write(message);
    }
  }
}

// One physical SSE response gets one write budget, shared by every sink that
// writes to it: the replay, the cursor, the named room events and the snapshot
// subscription. A connection that refuses this many frames in a row, or that has
// this much already buffered, is not reading, and the stream is torn down rather
// than buffered without bound. One drain listener resets the count; both go
// away with the stream.
const SSE_FALSE_WRITE_LIMIT = 32;
const SSE_WRITE_BUFFER_LIMIT = 8 * 1024 * 1024;

function boundedWriter(res, onDrop) {
  let refused = 0;
  let dropped = false;
  const onDrain = () => { refused = 0; };
  res.on('drain', onDrain);
  const stop = () => {
    if (dropped) return;
    dropped = true;
    res.removeListener('drain', onDrain);
    if (typeof onDrop === 'function') onDrop();
  };
  return {
    get dropped() {
      return dropped;
    },
    stop,
    write(message) {
      if (dropped) return false;
      let ok;
      try {
        ok = res.write(message);
      } catch {
        stop();
        return false;
      }
      if (ok === false) {
        refused += 1;
      }
      if (refused > SSE_FALSE_WRITE_LIMIT || res.writableLength > SSE_WRITE_BUFFER_LIMIT) stop();
      return ok;
    },
  };
}

// The live lane serves documents. A resource that is not an HTML document has no
// room to open, and a live subscription's proof is the same client id the data
// lane uses.
const LIVE_DOCUMENT_PATH = /\.(?:html|htmlclay)$/i;
const LIVE_CLIENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

// Presence's write half takes exactly two body shapes, and the two are two explicit
// branches so the older one keeps the bytes it always sent. `{ v: 1, session, n, editing }`
// is the extended envelope: the token names THIS tab's admitted stream and `n` orders its
// frames. `{ editing }` alone is the legacy report, which can offer a dotted path or a
// record and never a page target, whose coordinates need the envelope. An unknown key is
// refused rather than ignored, so neither shape can be spelled half one half the other.
const PRESENCE_SESSION_KEYS = new Set(['v', 'session', 'n', 'editing']);
const PRESENCE_BODY_LIMIT = '16kb';

function presenceSessionRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  for (const key of Object.keys(body)) if (!PRESENCE_SESSION_KEYS.has(key)) return null;
  if (body.v !== PRESENCE_VERSION) return null;
  if (typeof body.session !== 'string' || body.session === '') return null;
  if (!Number.isSafeInteger(body.n) || body.n < 0) return null;
  if (!Object.prototype.hasOwnProperty.call(body, 'editing')) return null;
  return { session: body.session, n: body.n, editing: body.editing };
}

function presenceReportRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== 'editing') return null;
  return { editing: body.editing };
}

const presenceRefusal = (res, status, message, code) => res.status(status).json({ msg: message, msgType: 'error', code });

// POST /_/presence: the caret this tab is standing on, accepted only from the stream the
// token was issued to. Identity, document and tab all come from the admitted connection --
// nothing in the body is read as a name, a colour or a person.
async function handleAuthorityPresence(ctx, req, res, { resolveTarget }) {
  const authority = ctx.localAuthority;
  const body = req.body === null || req.body === undefined ? null : req.body;
  const extended = Boolean(body) && typeof body === 'object' && !Array.isArray(body) &&
    Object.prototype.hasOwnProperty.call(body, 'v');
  const clientId = req.query?.['client-id'];
  let request = extended ? presenceSessionRequest(body) : presenceReportRequest(body);
  if (!request) {
    return presenceRefusal(res, 400, extended
      ? 'Send { v: 1, session, n, editing } with a client-id.'
      : 'Send { editing } with a client-id.', 'invalid-request');
  }
  if (typeof clientId !== 'string' || !LIVE_CLIENT_ID.test(clientId)) {
    return presenceRefusal(res, 400, extended
      ? 'Send { v: 1, session, n, editing } with a client-id.'
      : 'Send { editing } with a client-id.', 'invalid-request');
  }
  if (!documentUrlHeader(req)) {
    return presenceRefusal(res, 400, 'Document-URL header required.', 'invalid-request');
  }

  let target;
  try {
    // Not fresh: presence is admitted on the document this tab already opened a stream on,
    // so the warm binding is what proves the file exists and that this origin may have it.
    target = await resolveTarget(req, { fresh: false });
  } catch (err) {
    const status = Number(err && err.status);
    if (status === 403) return presenceRefusal(res, 403, 'Access denied', 'forbidden');
    if (status === 400) return presenceRefusal(res, 400, 'Bad Request', 'invalid-request');
    return presenceRefusal(res, 404, 'File not found', 'not-found');
  }
  if (!target || !authority.isCurrentTarget(target)) {
    return presenceRefusal(res, 409, 'This tab has no open live stream on this document.', 'not-connected');
  }

  const result = extended
    ? authority.presence.setTarget(target.canonicalPath, { clientId, ...request })
    : authority.presence.report(target.canonicalPath, { clientId, ...request });
  if (result.status === 'not-connected') {
    return presenceRefusal(res, 409, 'This tab has no open live stream on this document.', 'not-connected');
  }
  if (result.status === 'forbidden') return presenceRefusal(res, 403, 'That session is not this tab\u2019s.', 'forbidden');
  if (result.status === 'rate-limited') return presenceRefusal(res, 429, 'Too many presence updates.', 'rate-limited');
  if (result.status === 'invalid') return presenceRefusal(res, 400, 'That is not a presence target.', 'invalid-request');
  // `stale` lands here with `ok`: a number at or below the last one accepted changes
  // nothing, and saying so would tell the sender which of its frames this host kept.
  res.set('Cache-Control', 'no-store');
  return res.status(204).end();
}

// The direct stream once a Local room registry exists. The bytes a consumer
// already reads are unchanged -- the same resume, cursor and snapshot frames --
// and a live subscription with a client id additionally carries the room's
// unwrapped named events. The canonical document is resolved before any header
// is written, and a stream that left during that read registers nothing.
async function handleAuthorityLiveStream(ctx, req, res, { file, lane, resolveTarget }) {
  const authority = ctx.localAuthority;
  const clientId = req.query['client-id'];
  if (clientId !== undefined && (typeof clientId !== 'string' || !LIVE_CLIENT_ID.test(clientId))) {
    return res.status(400).type('text/plain').send('invalid client-id');
  }

  let closed = false;
  req.on('close', () => { closed = true; });

  let target;
  try {
    target = await resolveTarget(req, { fresh: true });
  } catch (err) {
    if (res.headersSent) return;
    const status = Number(err && err.status);
    if (status === 403) return res.status(403).type('text/plain').send('Forbidden');
    if (status === 400) return res.status(400).type('text/plain').send('Bad Request');
    return res.status(404).type('text/plain').send('File not found');
  }
  if (closed) return;

  // The resolution proves the document only while its target is still current: a
  // route retired and readmitted while it resolved is refused with the route's
  // existing not-found text before any header, subscription or registration.
  if (!authority.isCurrentTarget(target)) {
    return res.status(404).type('text/plain').send('File not found');
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let torn = false;
  let keepAlive = null;
  let member = null;
  let presence = null;
  let disposeSnapshot = () => {};
  const writer = boundedWriter(res, () => teardown());
  const sink = { write: (message) => writer.write(message) };

  // Resume before subscribing. Node runs the rest of this handler to
  // completion, so no frame can fall between the replay and the subscription.
  const { baseline, replay, resync } = replayStore.resume(ctx.live.key(file), lane, parseLastEventId(req));
  writer.write(cursorFrame(baseline, resync));
  for (const message of replay) {
    if (writer.dropped) return;
    writer.write(message);
  }
  if (writer.dropped) return;

  // One snapshot per subscription: live and saved alike keep their own root
  // channel, and an anonymous live subscriber is what the legacy barrier counts.
  ctx.live.subscribe(file, sink, { lane });
  disposeSnapshot = authority.registerSnapshot(target, { lane, legacy: lane === 'live' && clientId === undefined });
  // Membership is live-only and needs a proof. A saved viewer never joins a room.
  member = lane === 'live' && clientId !== undefined
    ? authority.registerEditor(target, {
      clientId,
      send: (name, payload) => writer.write(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`),
    })
    : null;
  // Presence rides this same stream: every connection is a participant of the document
  // it was admitted for, and a live tab that names itself is the one kind of connection
  // that can hold a session. A saved-lane reader is told the roster and no coordinate.
  presence = authority.presence.connect({
    canonicalPath: target.canonicalPath,
    lane,
    clientId: clientId === undefined ? null : clientId,
    send: (name, payload) => writer.write(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`),
  });

  keepAlive = setInterval(() => writer.write(': ping\n\n'), 30000);

  // One teardown, whichever way the response ends: membership, snapshot,
  // subscription, keepalive, callbacks, then the response itself.
  function teardown() {
    if (torn) return;
    torn = true;
    writer.stop();
    if (keepAlive) clearInterval(keepAlive);
    if (presence) presence.close();
    if (member) member.close();
    disposeSnapshot();
    ctx.live.unsubscribe(file, sink);
    res.removeListener('close', teardown);
    req.removeListener('close', teardown);
    try {
      res.destroy();
    } catch {}
  }
  res.on('close', teardown);
  req.on('close', teardown);

  // Connection established
  writer.write(': connected\n\n');
}

// The observer is shared with the session and createApp has no stop hook to
// unhook from, so the listeners are registered once per observer rather than once
// per app: a second app on the same observer cannot double-reset, and a stopped
// root's observer stays collectable.
const replayResetHooked = new WeakSet();

// Build and return the configured Express app without listening; RootServer in
// root-servers.js wraps it. Tests drive the real route wiring (ordering + the marker
// gate) via supertest against an ephemeral port instead of the hardcoded 4321.
function createApp(ctxOrDir, devHooks = null, isKnownPath = null) {
  // Additive ctx form: { root, devHooks, isKnownPath, live?, observer? }.
  // The string form is the legacy personal app and stays exactly what it was.
  const ctx = typeof ctxOrDir === 'string'
    ? { root: { ...LEGACY_ROOT, path: ctxOrDir }, devHooks, isKnownPath }
    : ctxOrDir;
  const baseDir = ctx.root.path;
  // Both callers can arrive without a live object: the string form here builds a
  // legacy root, and C1's ctx form leaves `ctx.live` to this function. Normalized
  // back onto ctx because the key scheme is what every `ctx.live.*` call site in
  // this file shares, and two of them (replay resume, the observer reset) run
  // outside the request that has the local binding in scope.
  const live = ctx.live || createRootLive(ctx.root);
  ctx.live = live;
  const store = snapshotStoreFor(ctx.root.id);

  // The store describes what the CURRENTLY served folder owes the platform, keyed by
  // a path relative to that folder's root, so it would otherwise outlive a folder
  // switch. Two folders each holding an index.html then share one entry: folder A's
  // snapshot gets uploaded as folder B's, and the platform broadcasts it verbatim
  // into B's edit-mode tabs, where hyper-morph merges A's document into B's page.
  // The five-minute sweep in RootServer (root-servers.js) is not a substitute, since
  // it is not even running while the server is stopped.
  store.snapshots.clear();
  // Cleared for the same reason and with more force: this map answers "was that my
  // own other tab?", and folder B's index.html sharing folder A's entry would answer
  // yes about a tab that was never open on it.
  store.etags.clear();

  // C5.3: a file replaced or removed on disk invalidates every position a client
  // could resume from, so both lanes forget and the next stream is told to resync
  // (CONTRACTS §9a). `kind === 'external'` is what keeps the host's own writes out
  // of it: a save this process made is a new frame, not a new document.
  // An observer without `on` is a stub that answers emptyPending alone (C1.1's
  // tests), and it has no events to hook.
  if (ctx.observer && typeof ctx.observer.on === 'function' && !replayResetHooked.has(ctx.observer)) {
    replayResetHooked.add(ctx.observer);
    ctx.observer.on('change', (e) => e.kind === 'external' && !e.continues && replayStore.reset(ctx.live.key(e.rel)));
    ctx.observer.on('remove', (e) => replayStore.reset(ctx.live.key(e.rel)));
  }

    const app = express();

    // Canonical path resolution + symlink consent for every route below. The
    // open-time walk is kicked off here so a folder that legitimately links out
    // of tree keeps working; links created later are not registered and are
    // refused on both reads and writes.
    const paths = getConsentRegistry(baseDir);
    paths.rescan();

    // Derived artifacts (Tailwind CSS) go through the same phase-2 + phase-4
    // pass as user files, so a crafted site name can't steer a generated file
    // out of the served folder.
    const resolveDerivedWrite = async (relPath) => {
      validateSegments(relPath);
      return await resolveWritePath(paths, relPath);
    };

    // The generated stylesheet lives under the reserved `.hyperclay/` directory,
    // whose leading dot a phase-2 validation would refuse. Only the NAME comes
    // from the document or the URL, so the name is what gets validated; the
    // directory is prepended afterwards.
    const resolveTailwindWrite = async (name) => {
      validateSegments(`${name}.css`);
      return await resolveWritePath(paths, `${TAILWIND_DIR}/${name}.css`);
    };

    // The live lane's admitted document: the exact same-origin Document-URL
    // (Page-URL when the spec spelling is absent), its normalized logical
    // resource, the contained canonical file that exists, and the registry's
    // stable identity for that file. `{ fresh: false }` answers an already-bound
    // logical target without touching the disk, so a warm frame reaches its held
    // room immediately; `{ fresh: true }` always resolves and checks again.
    const resolveLiveTarget = (req, { fresh = false, href: named = undefined, unbound = false } = {}) => {
      const origin = `http://${req.headers.host}`;
      const dataRequest = req.originalUrl.split('?')[0] === '/_/sync/data';
      // A v2 shared entry names its own document; every other caller names the
      // request's Document-URL (Page-URL is the pre-spec fallback), and the data
      // lane requires the header rather than accepting the query spelling alone.
      const href = named !== undefined
        ? named
        : (documentUrlHeader(req) ||
          (!dataRequest && req.query && (req.query['document-url'] || req.query['page-url'])) || null);
      if (!href) throw new PathError(400, 'Document-URL is required');
      let url;
      try {
        url = new URL(String(href));
      } catch {
        throw new PathError(400, 'Document-URL is not a URL');
      }
      if (url.origin !== origin) throw new PathError(403, 'Access denied');
      const name = resolveResourceFromHref(String(href));
      if (!name || !LIVE_DOCUMENT_PATH.test(name)) throw new PathError(404, 'File not found');

      const logical = { rootId: ctx.root.id, logicalPath: name, origin };
      if (!fresh) {
        const bound = ctx.localAuthority.findBoundTarget(logical);
        if (bound) return bound;
      }
      const resolveCandidate = async () => {
        validateSegments(name);
        const real = await resolveReadPath(paths, name);
        const stats = await fs.stat(real).catch(() => null);
        if (!stats || !stats.isFile()) throw new PathError(404, 'File not found');
        return { ...logical, canonicalPath: real, live: ctx.live };
      };
      return (async () => {
        const candidate = await resolveCandidate();
        if (unbound) return candidate;
        const claim = ctx.localAuthority.captureAdmission(candidate);
        return withDocumentWrite(
          () => ({ canonicalPath: candidate.canonicalPath }),
          async (_locked, token) => {
            const current = await resolveCandidate();
            if (current.canonicalPath !== candidate.canonicalPath) throw new PathError(404, 'File not found');
            ctx.localAuthority.validateAdmission(claim, current, token, { allowInitialBind: true });
            return ctx.localAuthority.bindTarget(current);
          },
        );
      })();
    };

    // The one refusal a queued save can still be given: the name it was resolved
    // against no longer resolves to the document the request claimed. The message
    // is the route's existing one, so a client's refresh prompt is unchanged.
    const movedOrDeleted = () => {
      const error = new Error('This file has been moved or deleted. Please refresh the page.');
      error.status = 409;
      error.code = 'moved-or-deleted';
      return error;
    };

    // A write to one served document. Without an authority this is the plain
    // per-file lock this route always took. With one, the request captures a
    // read-only claim on the location it names BEFORE it queues, then re-resolves
    // and rechecks that claim inside the shared boundary: the canonical path, the
    // root's known-path admission, the root incarnation, the identity the path
    // carries now and its admission revision. The staged target is admitted only
    // after all of that, so a stale queued save is refused instead of landing on
    // whatever occupies the path by the time it is admitted, and a refused write
    // leaves no identity and no binding behind.
    const runDocumentWrite = async (req, name, claimedPath, fn, { explicitCreate = false } = {}) => {
      if (!ctx.localAuthority) {
        return withFileLock(claimedPath, () => fn({ canonicalPath: claimedPath }, null));
      }

      const authority = ctx.localAuthority;
      const location = { rootId: ctx.root.id, logicalPath: name, canonicalPath: claimedPath };
      const claim = authority.captureAdmission(location);
      const origin = `${req.protocol}://${req.get('host')}`;

      return withDocumentWrite(async () => ({ canonicalPath: claimedPath }), async (_locked, token) => {
        let freshPath;
        try {
          freshPath = await resolveWriteTarget(paths, name);
        } catch {
          throw movedOrDeleted();
        }
        if (freshPath !== claimedPath) throw movedOrDeleted();
        const known = !ctx.isKnownPath || ctx.isKnownPath(name, freshPath, ctx.root.id);
        if (!known || (explicitCreate && authority.isRetired(location))) {
          const absent = explicitCreate &&
            await fs.stat(freshPath).then(() => false, (error) => error.code === 'ENOENT');
          if (!absent) throw movedOrDeleted();
        }
        let target;
        try {
          target = authority.admitWriteTarget(
            claim,
            { ...location, canonicalPath: freshPath, origin, live },
            token,
            { explicitCreate },
          );
        } catch (error) {
          if (error && error.code === 'moved') throw movedOrDeleted();
          throw error;
        }
        return fn(target, token);
      });
    };

    // DNS-rebinding hardening for the WHOLE origin. Binding to
    // localhost does not help: a rebound hostname resolves to 127.0.0.1 and the
    // request arrives here carrying the attacker's Host header. A loopback Host
    // is the only legitimate way to address this server.
    app.use((req, res, next) => {
      if (!isLoopbackHostHeader(req.headers.host)) {
        return res.status(403).send('Invalid Host header');
      }
      next();
    });

    // Origin validation for the WHOLE mutating surface, not per route. A loopback
    // bind does not help and neither does the Host check above: a page on
    // evil.com can POST to http://localhost:4321, and the browser sends the real
    // Host, so only Origin distinguishes it from the user's own page.
    //
    // /save survives today by accident. It requires the Page-URL header, and a
    // custom header forces a CORS preflight that this server never answers. That
    // protection evaporates the moment a route accepts a request that needs no
    // custom header: a cross-origin multipart form POST is a CORS "simple
    // request" and goes straight through. An upload route is exactly that shape,
    // which is why this lands before one exists rather than beside it.
    //
    // The rules, in order:
    //
    //   - Safe methods pass untouched.
    //   - No Origin at all passes: curl, the sync engine and a shell script send
    //     none, and none of them carry ambient browser authority. Browsers always
    //     send Origin on POST, including form submissions.
    //   - `Origin: null` is refused. It means a sandboxed document, a data: URL
    //     or a redirect chain, it is forgeable, and this host mints no tokens, so
    //     nothing here can carry authority in place of an origin. Local serves no
    //     document sandboxed (it sets no CSP), so no legitimate save is null.
    //   - Any other Origin must be loopback AND on this app's own port. A page
    //     on localhost:5432 posting to localhost:4321 is a different folder's page,
    //     and browsers call it `same-site` (ports are not part of a "site"), so
    //     both signals have to carry the port.
    //   - Sec-Fetch-Site is checked when present, as a second signal that costs
    //     nothing and does not depend on Origin being sent.
    const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
    app.use((req, res, next) => {
      if (!UNSAFE_METHODS.has(req.method)) return next();

      const refuse = () => res.status(403).json({
        msg: 'Cross-origin requests are not allowed.',
        msgType: 'error',
        ...(ctx.localAuthority && req.originalUrl.split('?')[0] === '/_/sync/data' && { code: 'forbidden' }),
      });

      const site = req.headers['sec-fetch-site'];
      if (site !== undefined && site !== 'same-origin' && site !== 'none') return refuse();

      const origin = req.headers.origin;
      if (origin === undefined) return next();
      if (origin === 'null' || !isLoopbackOrigin(origin)) return refuse();
      if (!isOwnOrigin(origin, req, ctx)) return refuse();
      next();
    });

    // Nothing below may run before the open-time walk lands. Until it does,
    // `paths.baseReal` is the lexical resolve of the served folder rather than its
    // realpath, so a folder reached through a symlink, which every macOS folder
    // under /var is, fails its own containment test and every route answers 403
    // "Access denied". The two guards above refuse without consulting a path, so
    // they stay ahead of this and stay cheap.
    app.use((req, res, next) => {
      paths.ready().then(() => next(), next);
    });

    // `/_/<action>` system-route marker: forward `/_/`-prefixed requests to the
    // bare route so URLs emitted by newer hyperclayjs (e.g. `/_/save`,
    // `/_/live-sync/stream`) resolve to the same handlers. Mirrors the hyperclay
    // platform server (SYSTEM_ROUTE_MARKER = '_'). Bare routes stay working, so
    // apps embedding older hyperclayjs are unaffected. Runs before the
    // path-scoped body parsers and routes below. The `/_/` prefix is reserved:
    // an unknown marker path (e.g. `/_/foo.html`) now 404s here rather than
    // falling through to the static catch-all and serving a document.
    app.use((req, res, next) => {
      if (typeof req.url !== 'string' || !req.url.startsWith('/_/')) return next();
      const stripped = stripSystemRouteMarker(req.url);
      const segment = stripped.split(/[/?#]/)[1] || '';
      if (!SYSTEM_ROUTES.has(segment)) {
        return res.status(404).send('File not found');
      }
      req.url = stripped;
      // A known lane still needs an exact route match. Mark the request so that if it falls
      // through every system route to the static catch-all (e.g. `/_/save/foo.html`, whose tail
      // no route handles), the catch-all 404s instead of serving `save/foo.html` as a document.
      req.fromSystemRoute = true;
      next();
    });

    // Cookie options for all local development cookies
    const cookieOptions = {
      httpOnly: false, // Allow JavaScript access
      secure: false,   // Allow over HTTP for local development
      sameSite: 'lax'
    };

    // Set admin and login cookies for all requests since local user owns all files
    app.use((req, res, next) => {
      res.cookie('isAdminOfCurrentResource', 'true', cookieOptions);
      res.cookie('isLoggedIn', 'true', cookieOptions);
      next();
    });

    // Serve favicon (ico → legacy, svg → theme-adaptive, png → fallback)
    const assetsDir = path.join(__dirname, '../../assets');
    app.get('/favicon.ico', (req, res) => {
      res.sendFile(path.join(assetsDir, 'favicon.ico'));
    });
    app.get('/favicon.svg', (req, res) => {
      res.sendFile(path.join(assetsDir, 'favicon.svg'));
    });
    app.get('/favicon.png', (req, res) => {
      res.sendFile(path.join(assetsDir, 'favicon.png'));
    });

    // Serve template CSS files
    app.get('/__templates/:filename', async (req, res) => {
      const filename = req.params.filename;
      if (!filename.endsWith('.css')) {
        return res.status(404).send('Not found');
      }
      const safeName = path.basename(filename);
      const templateDir = path.join(__dirname, 'templates');
      const cssPath = path.join(templateDir, safeName);
      try {
        const css = await fs.readFile(cssPath, 'utf8');
        res.setHeader('Content-Type', 'text/css');
        res.send(css);
      } catch {
        res.status(404).send('Not found');
      }
    });

    // clay.live's Local data lane, installed only when a room registry exists and
    // only on the marked `/_/sync/data` address. Its own 5 MB body cap matches the
    // save lane and is registered here, ahead of the 10 MB live-sync parser below:
    // the fast lane packs small ops under 64 KB and sends one larger op in a
    // request of its own. The marker stripper above has already rewritten the URL
    // to `/sync/data`, so the route is registered bare and gated on the marker.
    if (ctx.localAuthority) {
      const liveData = createLocalLiveData({
        authority: ctx.localAuthority,
        resolveTarget: resolveLiveTarget,
      });
      const liveDataBody = express.json({ limit: '5mb' });
      const parseLiveDataBody = (req, res, next) => liveDataBody(req, res, (err) => {
        if (!err) return next();
        if (err.type === 'entity.too.large') {
          return res.status(413).json({ msg: 'Live update refused: too-large.', msgType: 'error', code: 'too-large' });
        }
        return res.status(400).json({ msg: 'Bad request.', msgType: 'error', code: 'invalid-request' });
      });
      const markedOnly = (req, res, next) => (req.fromSystemRoute ? next() : next('route'));
      app.post('/sync/data', markedOnly, parseLiveDataBody, (req, res) => liveData.post(req, res));
      app.get('/sync/data', markedOnly, (req, res) => liveData.state(req, res));
    }

    // Presence, on the exact `/_/presence` address hyperclay spells. Registered only on
    // the marker, so a user folder named `presence` keeps the static lane to itself, and
    // only when a presence relay is installed: a host without one advertises nothing and
    // answers nothing, which is the rollback a ClayJS client already detects.
    if (ctx.localAuthority && ctx.localAuthority.presence) {
      const presenceBody = express.json({ limit: PRESENCE_BODY_LIMIT });
      const parsePresenceBody = (req, res, next) => presenceBody(req, res, (err) => {
        if (!err) return next();
        if (err.type === 'entity.too.large') {
          return res.status(413).json({ msg: 'Presence update refused: too-large.', msgType: 'error', code: 'too-large' });
        }
        return res.status(400).json({ msg: 'Bad request.', msgType: 'error', code: 'invalid-request' });
      });
      app.post('/presence', (req, res, next) => (req.fromSystemRoute ? next() : next('route')), parsePresenceBody,
        (req, res) => handleAuthorityPresence(ctx, req, res, { resolveTarget: resolveLiveTarget }));
    }

    const apiWriteBody = (req, res, next) => express.text({ type: () => true, limit: API_WRITE_MAX_BYTES })(req, res, (err) => {
      if (!err) return next();
      if (err.type === 'entity.too.large') {
        return res.status(413).json({ error: 'Payload Too Large', message: 'The JSON body is limited to 1 MB.' });
      }
      return res.status(400).json({ error: 'Invalid JSON body', message: 'The request body could not be read.' });
    });

    function plainDataName(req) {
      const requestedPath = req.path.replace(/^\//, '');
      const htmlMatch = requestedPath.match(/^(.*?\.html(?:clay)?)(\/.*)?$/);
      return htmlMatch ? htmlMatch[1] : (req.path === '/' ? 'index.html' : null);
    }

    app.post(/.*/, (req, res, next) => {
      if (req.fromSystemRoute || !readDataQuery(req.originalUrl).present) return next('route');
      const rawName = plainDataName(req);
      if (!rawName) return next('route');
      try {
        req.dataDocumentName = decodeOnce(rawName);
      } catch (error) {
        return res.status(error.status || 400).json({ error: error.message });
      }
      return next();
    }, apiWriteBody, (req, res) => handleApiWrite(req, res, req.dataDocumentName));

    // Middleware to parse JSON body for live-sync endpoint, under both the legacy
    // path and the spec §10 address.
    app.use(['/live-sync', '/sync'], express.json({ limit: '10mb' }));

    // The SharedWorker script of spec §10. Registered before `/sync` and gated on
    // the marker, so a user folder that happens to be called `sync` keeps serving
    // its own worker.js through the static catch-all.
    app.get('/sync/worker.js', (req, res, next) => {
      if (!req.originalUrl.startsWith('/_/sync/worker.js')) return next();
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(SYNC_WORKER_JS);
    });

    // Live-sync SSE stream endpoint. Spec §10 puts both halves on `/_/sync`; the
    // legacy `/live-sync/stream` stays forever because hyperclayjs hardcodes it, and
    // so does the inline script in every Collection dashboard ever minted, neither of
    // which any library update can reach.
    app.get(['/live-sync/stream', '/sync'], async (req, res) => {
      // Spec §10's list form shares the `/_/sync` address with the single-document
      // form and is told apart by `s`. The marker prefix is part of the address:
      // a bare `/sync?s=` is not the list form, so a user document named `sync`
      // keeps this route to itself.
      const markedSync = req.originalUrl.startsWith('/_/sync');
      // A marked stream carrying a version or a member list is the v2 wire, and a
      // version that is not v2 is refused here rather than read as the direct
      // form below. It needs a room registry to have members at all: an app
      // without one answers a v2-shaped request exactly as an older Local does,
      // which is the rollback a v2 client already knows how to detect.
      if (markedSync && ctx.localAuthority && (req.query.v !== undefined || req.query.m !== undefined)) {
        return handleSharedSyncStreamV2(ctx, req, res, {
          resolveTarget: resolveLiveTarget,
          s: req.query.s === undefined ? [] : [].concat(req.query.s),
          m: req.query.m === undefined ? [] : [].concat(req.query.m),
          v: req.query.v,
        });
      }
      if (req.query.s !== undefined && markedSync) {
        return handleSharedSyncStream(ctx, paths, req, res, [].concat(req.query.s));
      }
      // `document-url` is the spec spelling and wins; `page-url` is the pre-spec one.
      const pageUrl = req.query['document-url'] || req.query['page-url'];
      if (!pageUrl) {
        return res.status(400).send('document-url parameter required');
      }
      const file = resolveResourceFromHref(pageUrl);
      if (!file) {
        return res.status(400).send('could not resolve file from document-url');
      }

      // Lane: edit-mode tabs ride 'live' (default) and get pre-strip peer
      // snapshots; view-mode tabs pass ?lane=saved and only ever receive
      // post-strip on-disk HTML broadcast from the save paths. No auth —
      // this server is single-user/localhost.
      const lane = req.query.lane === 'saved' ? 'saved' : 'live';

      // With a room registry this stream is also the membership record: a live
      // subscription with a client id carries the room's named events. Without
      // one the stream below stays exactly what it was.
      if (ctx.localAuthority) {
        return handleAuthorityLiveStream(ctx, req, res, { file, lane, resolveTarget: resolveLiveTarget });
      }

      // SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      // Resume before subscribing. Node runs the rest of this handler to
      // completion, so no frame can fall between the replay and the subscription.
      // The three writes a consumer of this route can see are additive: the cursor
      // is a named event, so it never reaches onmessage, and the ids ride lines the
      // legacy client already ignores.
      const { baseline, replay, resync } = replayStore.resume(ctx.live.key(file), lane, parseLastEventId(req));
      res.write(cursorFrame(baseline, resync));
      for (const message of replay) res.write(message);

      // Register client (channel key = full path with extension, e.g. "blog/post.html")
      live.subscribe(file, res, { lane });
      console.log(`[LiveSync] Client connected: ${file} (lane=${lane})`);

      // Keep-alive ping every 30 seconds
      const keepAlive = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch (e) {
          clearInterval(keepAlive);
        }
      }, 30000);

      // Cleanup on disconnect
      req.on('close', () => {
        clearInterval(keepAlive);
        live.unsubscribe(file, res);
        console.log(`[LiveSync] Client disconnected: ${file}`);
      });

      // Connection established
      res.write(': connected\n\n');
    });

    // Live-sync relay endpoint. Same two addresses as the stream above, and the same
    // reason for keeping the legacy one. §10 names the artifact `snapshot`; `html` is
    // the pre-spec spelling of the same thing.
    app.post(['/live-sync/save', '/sync'], async (req, res) => {
      const body = req.body || {};
      const { sender, identityMap, etag } = body;

      // §10 names two artifacts and the field says which audience each is for. A
      // snapshot is the sending tab's working state, edit controls and all, and
      // goes to the other EDITORS. A document is the durable, stripped one and
      // goes to the VIEWERS. Sending them to the wrong lane is what puts one
      // person's toolbar on a reader's screen, or shows a reader a state the
      // author never chose to keep, so the audience is stated at each call rather
      // than left to the library's default.
      //
      // `html` is the pre-spec spelling of `snapshot` and stays forever: every
      // published hyperclayjs and the inline script in every Collection dashboard
      // send it, and no library update can reach them.
      //
      // PRESENCE is the test, not string-ness, which is the rule hyperclay's relay
      // holds and the reason is the same: a real snapshot paired with a broken
      // document is a confused client, and guessing which half it meant would
      // silently send editor content to viewers or the reverse. An explicit null
      // reads as "not this one", because a client building { snapshot, document }
      // in JS naturally nulls the half it is not using.
      // `html` is read ON THE PRE-SPEC ADDRESS ONLY. Nothing frozen posts it to the
      // spec address, because that address is new: both clients pair the key with the
      // address in one wire profile chosen once for the life of the page, so a client
      // on `/sync` sends `snapshot`. Reading it there anyway would buy nothing and cost
      // the thing this train is for, since hyperclay's spec route recognises only
      // `snapshot` and `document`, and one address answering differently on three hosts
      // is the whole class of bug.
      const legacyAddress = req.path !== '/sync';
      const present = (k) => body[k] !== undefined && body[k] !== null;
      const laneOf = (k) => (k === 'html' ? 'snapshot' : k);

      // One list, one decision. The artifact names this address reads, and the lane
      // each names, are read off `names` and nothing else, so the address rule cannot
      // be enforced in one place and quietly contradicted in another.
      const names = legacyAddress ? ['snapshot', 'html', 'document'] : ['snapshot', 'document'];
      const named = names.filter(present);
      const lanes = new Set(named.map(laneOf));

      const pageUrl = documentUrlHeader(req);
      if (!pageUrl) {
        return res.status(400).json({ error: 'Document-URL header is required' });
      }
      const file = resolveResourceFromHref(pageUrl);

      if (!file) {
        return res.status(400).json({ error: 'could not resolve file from Document-URL' });
      }
      if (lanes.size !== 1) {
        return res.status(400).json({ error: 'Send exactly one of snapshot or document.' });
      }
      const lane = [...lanes][0];
      const html = body[named.find(k => laneOf(k) === lane)];

      if (typeof html !== 'string') {
        return res.status(400).json({ error: 'a snapshot or a document must be a string' });
      }

      // The same bar the save lane holds bytes to: a fragment or a JSON blob would
      // morph every open tab into something that is not a document, and this content
      // reaches the same pages a save does.
      //
      // ON THE SPEC ROUTE ONLY. `/live-sync/save` is the pre-spec address and it has
      // always taken any string, including the body innerHTML that hyperclayjs's
      // exported captureBodyForSync() returns. A document saved against that API goes
      // on running for years and no library update can reach its inline script, so
      // adding a rule here would break it permanently and silently. A new client
      // posting to the spec address is a client that can be told.
      if (!legacyAddress && !hasHtmlRoot(html)) {
        return res.status(422).json({ error: 'Not a complete HTML document.' });
      }

      // Shape-checked, then treated as opaque: this host never parses keys or
      // interprets ids, it only forwards. Same check hyperclay's relay makes, because
      // a client sending an array or a string is confused about the field and a
      // receiver would have no way to say so.
      if (identityMap !== undefined &&
          (typeof identityMap !== 'object' || identityMap === null || Array.isArray(identityMap))) {
        return res.status(400).json({ error: 'identityMap must be a plain object.' });
      }

      // Spec §6: the stamp of what this host stored for the bytes a tab just saved. The SAVING
      // TAB attaches it and this relay only carries it, unread. A wrong one costs a receiver a
      // spurious 412 on its next save, never a wrong write, which is why it needs no more than a
      // shape check here.
      //
      // It rides on a snapshot and never alone. A stamp by itself would tell a tab it is in step
      // with disk without giving it the bytes to be in step with, and its next save would then
      // overwrite a save it had not received.
      if (etag !== undefined && typeof etag !== 'string') {
        return res.status(400).json({ error: 'etag must be a string.' });
      }

      // §9 runs in both directions. A token belongs to one response and one tab, so
      // relaying one hands another tab a credential that is not theirs, and a peer that
      // stores what it received then writes it to disk. HTML Clay strips on this path
      // too, for the same reason.
      const snapshotHtml = lane === 'snapshot' ? canonicalForWrite(stripSaveToken(html)) : null;
      const documentHtml = lane === 'document' ? canonicalForWrite(stripSaveToken(html)) : null;

      const validated = validateAndResolvePath(file, baseDir);
      if (validated.error) {
        return res.status(400).json({ error: validated.error });
      }

      // Doc 11 §6b: the relay hands whole documents between tabs and never writes,
      // but a tab that cannot read a floor-raised document must not receive one.
      // The authority's confirmed bytes are the floor; a file no room has confirmed
      // falls back to the bytes on disk, and an unreadable file is floor 0.
      const { formatCapability, pageFormatFloor, PAGE_FORMAT_UPGRADE } = roomsPackage();
      const confirmed = ctx.localAuthority ? ctx.localAuthority.confirmedDocument(validated.resolvedPath) : null;
      let relayFloor = 0;
      if (typeof confirmed === 'string') relayFloor = pageFormatFloor(confirmed);
      else {
        try { relayFloor = pageFormatFloor(await fs.readFile(validated.resolvedPath, 'utf8')); } catch { relayFloor = 0; }
      }
      if (relayFloor > formatCapability(req.get('X-Clay-Page-Format'))) {
        return res.status(409).json({
          code: PAGE_FORMAT_UPGRADE,
          msg: 'This document uses a newer page format; update the editor to keep writing.',
        });
      }

      try {
        if (documentHtml !== null) {
          // Viewers only, and nothing else happens: this artifact is not a
          // snapshot, so it must not reach the platform-sync cache below, which
          // exists to upload the unstripped working state. §10: /_/sync never
          // writes to disk, whichever field it carries.
          live.broadcast(file, { html: documentHtml, sender }, { lane: 'saved' });
          console.log(`[LiveSync] Relayed a document to viewers: ${file} (from: ${sender})`);
          return res.json({ success: true });
        }

        // Cache snapshot for platform sync (consumed by uploadFile via getAndClearSnapshot).
        // Preserve any userDriven bit a prior /save cached for this file: the peer
        // live-sync body doesn't carry it, so overwriting blindly would drop the
        // human-gesture provenance and make a clean save read as ui-unknown.
        const prevSnap = store.snapshots.get(file);
        store.snapshots.set(file, { html: snapshotHtml, userDriven: prevSnap ? prevSnap.userDriven : undefined, timestamp: Date.now() });

        // Broadcast to other local browsers on the same channel as /live-sync/stream.
        //
        // identityMap and etag both ride along on this lane and only this one. Receivers
        // use the first to pair elements across a morph by stable id instead of by content
        // scoring, which is what keeps focus, scroll position and half-typed input where
        // they were. This host had never forwarded it while hyperclay always has, so live
        // sync in the desktop app lost that state on every frame. The second tells a
        // receiver the version its next save is answering, and it is on this lane because
        // only an editor saves. A viewer has neither working state to preserve nor a save
        // to make, so the document lane above carries neither.
        live.broadcast(file, { html: snapshotHtml, sender, identityMap, etag }, { lane: 'live' });

        console.log(`[LiveSync] Broadcast: ${file} (from: ${sender})`);

        res.json({ success: true });
      } catch (err) {
        console.error('[LiveSync] Save error:', err.message);
        errorLogger.error('LiveSync', `Save error: ${file}`, err);
        res.status(500).json({ error: 'Failed to save file' });
      }
    });

    // `/_/wire` — htmlclay's wire (CONTRACTS §11). A page asks, a process answers
    // with status frames and one terminal frame, and the process edits the FILE;
    // the edit reaches the page through the ordinary external-change path, never
    // over this socket. One hub per app, named on `app.locals` so RootServer can
    // shut it down when its root closes and W2 can put the helper dispatcher on it.
    // Gated on `req.originalUrl` like the data API, so a user folder
    // actually named `wire/` still falls through to the static catch-all.
    const wireHub = new WireHub();
    app.locals.wireHub = wireHub;

    // W2.3: the host answers every named request itself (decision 1), so a
    // file's handler slot keeps serving unnamed ones alone. Built only when the
    // app was given a helpers context, which is what keeps the string form and
    // every app created without one exactly what they were. `backupBaseline` is
    // the same backup the handler-attach path takes, for the same reason: a
    // program about to rewrite the file must leave the version the user was
    // looking at recoverable (helper.go:284-297).
    const helperDispatcher = ctx.helpers
      ? createHelperDispatcher({
        baseDir,
        helpers: ctx.helpers,
        backupBaseline: async (key) => {
          const abs = path.join(paths.baseReal, key);
          let content = null;
          try {
            content = await fs.readFile(abs, 'utf8');
          } catch (err) {
            if (err.code !== 'ENOENT') throw err;
          }
          if (content !== null) await createBackup(paths.baseReal, key, content, () => {}, null);
        },
        logger: console,
      })
      : null;
    if (helperDispatcher) {
      wireHub.setNamedRequestHandler(helperDispatcher.onNamedRequest);
      app.locals.helperDispatcher = helperDispatcher;
    }

    // A page NEVER names a path: its file comes from the page's own URL, through
    // the same funnel /_/save uses, and any supplied file field is discarded.
    // Document-URL first, Page-URL after it, then the two query spellings
    // (wire.go:684-700): the older spellings stay because a document that opened
    // a wire before the rename hardcoded one in its own inline script. An absolute
    // URL must name this host, or a page could drive another origin's wire.
    // The consent check runs too, so a symlink the static route refuses is refused
    // here. A file that does not exist yet is not refused: nothing can be read
    // through it.
    const resolveBrowserTarget = async (req) => {
      const href = req.headers['document-url'] || req.headers['page-url'] ||
        req.query['document-url'] || req.query['page-url'];
      if (!href || !hrefIsThisOrigin(req, String(href))) return null;
      // The same segment rules the process lane and the static route apply: a
      // page cannot name a file outside the served folder, a dotfile or an
      // internal folder.
      const rel = resolveResourceFromHref(String(href));
      try {
        validateSegments(rel);
      } catch {
        return null;
      }
      try {
        await resolveReadPath(paths, rel);
      } catch (err) {
        if (err?.status !== 404) return null;
      }
      return rel;
    };

    // A local process has no page, so it names an absolute path, which is then
    // validated. Containment and hidden/internal refusal happen FIRST, as string
    // and memory work, so an out-of-scope path is refused identically whether or
    // not anything exists at it. The nearest existing parent is realpath'd for the
    // same reason phase 4 does it: a file that is about to be created has no
    // realpath of its own, and an agent rewriting a document no tab has open is
    // exactly the case the wire exists for.
    const resolveProcessTarget = async (raw) => {
      if (typeof raw !== 'string' || raw === '' || raw.includes('\0') || !path.isAbsolute(raw)) return null;
      let rel;
      try {
        const parentReal = await realpathNearestParent(path.dirname(raw));
        rel = path.relative(paths.baseReal, path.join(parentReal, path.basename(raw)));
      } catch {
        return null;
      }
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
      try {
        validateSegments(rel);
      } catch {
        return null;
      }
      if (!/\.html?(clay)?$/i.test(rel)) return null;
      try {
        await resolveWritePath(paths, rel);
      } catch {
        return null;
      }
      return path.normalize(rel);
    };

    // A handler attaching takes a watch lease on the file before it answers
    // anything: an agent editing a document no tab has open must still reach the
    // pages, as an external change, and be versioned. The lease keeps the
    // observer alive for as long as the handler holds the file (CONTRACTS 9a).
    // The baseline backup comes first and is taken from what is on disk NOW, so
    // the version the user was looking at survives the first agent write
    // (wire.go:732-790, :872-887). A file that does not exist yet is admitted
    // with nothing to back up: an agent creating a document is exactly the case
    // the wire exists for.
    const onHandlerAttach = async (key) => {
      const abs = path.join(paths.baseReal, key);
      let content = null;
      try {
        content = await fs.readFile(abs, 'utf8');
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
      if (content !== null) await createBackup(paths.baseReal, key, content, () => {}, null);
      return ctx.observer ? ctx.observer.lease(key) : () => {};
    };

    // A process's terminal frame means the write is on disk, so that one file is
    // stat-and-compared at once rather than after the watcher's debounce.
    const onTerminalFromProcess = (key) => {
      ctx.observer?.poke(key);
    };

    mountWire(app, {
      hub: wireHub,
      resolveBrowserTarget,
      resolveProcessTarget,
      onHandlerAttach,
      onTerminalFromProcess,
    });

    // Note: File watcher for live-sync broadcast has been removed.
    // Live-sync is now browser-to-browser only (via platform SSE relay).
    // If you edit a file locally with a text editor, refresh the browser to see changes.
    // Disk sync is handled by polling + /sync/download (stripped content).
    console.log(`[LiveSync] Ready for browser-to-browser sync (no file watcher broadcast)`);

    // Hosted parity for the page-write refusals (hyperclay's
    // server-lib/page-write-http.js is the source of this table): the shared rooms
    // package refuses an unauthorized page initialization or conversion by
    // throwing one of its two error classes, and both hosts answer with the same
    // status, code and Retry-After. The rooms package stays lazily required, so
    // this only pulls it in on the refusal path of a save.
    const PAGE_WRITE_REFUSALS = {
      'file-changed': [428, 'page-condition-required'],
      'invalid-header': [400, 'page-conversion-refused'],
      'invalid-capture': [422, 'page-conversion-refused'],
      'invalid-source': [409, 'page-conversion-refused'],
      'ambiguous-source': [409, 'page-conversion-refused'],
      'room-page-authority': [409, 'page-conversion-refused'],
      'implicit-conversion': [409, 'page-conversion-required'],
      'seed-lineage': [409, 'page-lineage-stale'],
      'nothing-to-write': [409, 'page-nothing-to-write'],
      'source-changed': [409, 'page-conversion-stale'],
      'room-changed': [409, 'page-conversion-stale'],
      'room-required': [409, 'page-conversion-stale'],
      'page-converting': [503, 'page-converting', 1],
      budget: [503, 'page-capacity', 60],
      'receipt-capacity': [503, 'page-capacity', 60],
    };

    const pageWriteFailure = (error) => {
      if (!error) return null;
      const { PageConversionError, PageFormatError, PAGE_FORMAT_UPGRADE } = require('@panphora/clayjs/server/rooms');
      if (error && error.code === PAGE_FORMAT_UPGRADE) {
        return { statusCode: 409, code: PAGE_FORMAT_UPGRADE, reason: PAGE_FORMAT_UPGRADE, minimum: error.minimum, message: error.message };
      }
      if (error.code === 'invalid-update') {
        return { statusCode: 422, code: 'page-conversion-refused', reason: 'invalid-capture', message: 'The page content could not be read.' };
      }
      if (error instanceof PageFormatError) {
        return { statusCode: 409, code: 'page-format', message: error.message };
      }
      if (!(error instanceof PageConversionError)) return null;
      const [statusCode, code, retryAfter] = PAGE_WRITE_REFUSALS[error.reason] || [500, 'page-write-failed'];
      return {
        statusCode,
        code,
        message: statusCode === 500 ? 'Could not complete the page write.' : error.message,
        reason: error.reason,
        ...(retryAfter === undefined ? {} : { retryAfter }),
      };
    };

    // The second half of a save, shared by POST /save and POST /_/api/<file>:
    // first-save backup, Tailwind link scoping, formatting, version backup,
    // atomic write, etag record, saved-lane broadcast, sidecar, data-loss guard,
    // Tailwind compile and sync provenance. The caller must hold
    // withFileLock(filePath) -- or, for a browser save, the shared document
    // boundary whose admitted target and ownership token it passes in. This
    // helper is already owned and never acquires a gate of its own. Returns the
    // bytes that reached disk.
    async function commitDocument({
      name, filePath, content, dataLossPrev, userDriven, saveId, origin = 'save',
      target = null, token = null, ifMatch = undefined, pageConversion = undefined,
      pageWrite = undefined, pageFormat = undefined,
      persistentToken = null, readIdentity = null, answer = null,
    }) {
      // ANCILLARY DISK CONVENTION: versions dir and backups use baseName without
      // extension (matches platform's versions/{baseName}/ layout).
      // Do NOT reuse `backupName` as a liveSync channel key — liveSync keys must
      // carry the extension (Rule 1).
      const backupName = name.replace(/\.(html|htmlclay)$/, '');

      // Normalized once, and before anything is admitted or backed up: the page
      // admission below has to decide against the exact bytes this call would
      // store, and a refusal must leave no backup and no written byte behind.
      content = canonicalForWrite(formatHtml(scopeTailwindLink(name, content)));

      // The logical document keeps the page editor's merge state and is what every
      // admission, stamp, broadcast and answer below describes. Only the file part
      // reaches disk, with that state kept in its sidecar. Composing the two back
      // together makes `content` exactly what a later read of this save composes,
      // so the stamp returned here is the one the next If-Match is judged against.
      //
      // A client that never held the state — the code editor is sent the clean
      // file — saves the document without it. It is still the same document, so
      // the state its sidecar holds is put back here too. A page conversion is the
      // one save where the absence is the point, so that one is never put back.
      if (!pageConversion) {
        const rebased = await rebaseStaleSave(baseDir, name, content, newestVersionFiles);
        if (rebased) content = rebased.html;
      }
      const write = await splitWrite(baseDir, name, content, { keepState: !pageConversion });
      let fileContent = write.file;
      content = write.logical;
      // A caller that has to hand a client the document it can safely edit asks for
      // the file part here: the composed form above carries merge state that belongs
      // in the sidecar, never in a buffer somebody types into.
      if (answer) answer.html = fileContent;

      const authority = ctx.localAuthority;
      const authorityWrite = Boolean(authority && target && token);
      let pageToken = null;
      try {
        if (authorityWrite) {
          // The shared rooms package owns page authority: an initialization or a
          // conversion is admitted here, before the first backup, and its
          // reservation is held across the backup and the atomic write so no
          // frame can change the room while the disk result is pending.
          const { checkPageWriteAdmission, pageLineageLost, checkPageFormatAdmission, formatCapability, withPageFormatFloor, PAGE_FORMAT, PAGE_FORMAT_UPGRADE } = require('@panphora/clayjs/server/rooms');
          const { createDocument } = require('./page-rebase.js');
          const rooms = authority.rooms;
          const open = rooms.get(filePath);
          const room = open && String(open.nodeId) === String(target.identity) ? open : null;
          const currentHtml = dataLossPrev ?? '';
          const admission = checkPageWriteAdmission({
            currentHtml, html: content, header: pageConversion ?? null, ifMatch, room,
            pageWrite: pageWrite ?? null, createDocument,
          });
          const capability = origin === 'checkpoint' ? PAGE_FORMAT : formatCapability(pageFormat);
          const admitted = authority.admittedFormats(filePath);
          const format = checkPageFormatAdmission({ currentHtml, html: content, capability, admitted });
          content = format.html;
          fileContent = withPageFormatFloor(fileContent, format.floor);
          if (answer) answer.html = fileContent;
          if (admission === 'initial') {
            pageToken = rooms.reservePageInitial(filePath, {
              nodeId: target.identity, currentHtml, html: content, ifMatch,
              pageWrite: pageWrite ?? null, createDocument,
            });
          } else if (admission === 'conversion') {
            pageToken = rooms.reservePage(filePath, {
              nodeId: target.identity, header: pageConversion, currentHtml, html: content, ifMatch,
              pageWrite: pageWrite ?? null, createDocument,
            });
          } else if (admission === 'ordinary' && room && pageLineageLost(room, content)) {
            // The open room still holds the article this save replaces, and the
            // document being written no longer carries the page tag that bound them:
            // an outside edit or a code save replaced the page under it. Restore's
            // pattern, applied here: the room's unsaved edits become a version of
            // their own, and the room restarts on the new document instead of
            // keeping the old page store, which its next checkpoint would render
            // back over the replacement. A room whose edits cannot be kept is
            // refused, so the person can save them rather than lose them.
            if (authority.roomIsDirty(room)) {
              let kept = null;
              try {
                kept = ctx.localCheckpoint
                  ? await ctx.localCheckpoint.safetyBackup(filePath, currentHtml)
                  : null;
              } catch (error) {
                console.error(`Refusing a save of ${name}: the open room cannot be backed up`, error);
              }
              if (kept === null) {
                const error = new Error('Unsaved edits could not be kept. Save them before replacing this page.');
                error.code = 'unsaved-edits';
                throw error;
              }
              if (!(await createBackup(baseDir, backupName, kept))) {
                const error = new Error('Unsaved edits could not be kept. Save them before replacing this page.');
                error.code = 'unsaved-edits';
                throw error;
              }
            }
            pageToken = rooms.reservePageReplacement(filePath, {
              nodeId: target.identity, html: content,
            });
          }
          if (persistentToken) rooms.checkPersistent(persistentToken, { html: content });
          // An outside edit the room keeps (same revision or merged onto an older
          // one) waits for a tab to adopt it, and until then the room's unsaved
          // edits live only in memory: they get a recovered copy, rendered over
          // the document this write replaces.
          if (room && origin !== 'checkpoint' && !pageToken && content.includes('data-page') && needsAdoption(content)) {
            await authority.recoverUnsavedEdits(target, token);
          }
        }

        // Check if this is the first save (no versions exist yet)
        const siteVersionsDir = path.join(baseDir, VERSIONS_DIR, backupName);
        let isFirstSave = false;
        try {
          const versionFiles = await fs.readdir(siteVersionsDir);
          isFirstSave = versionFiles.length === 0;
        } catch (error) {
          // Directory doesn't exist yet, so this is the first save
          isFirstSave = true;
        }

        // The bytes already on disk, read once: the first-save backup stores their
        // file part, and a save that changed only the merge state leaves them alone.
        let existingContent = null;
        try {
          existingContent = await fs.readFile(filePath, 'utf8');
        } catch (error) {
          // File doesn't exist yet, that's OK
        }

        // If first save, backup the existing site content first
        if (isFirstSave && existingContent !== null) {
          try {
            await createBackup(baseDir, backupName, roomsPackage().splitPage(existingContent).file);
            console.log(`Created initial backup of existing ${name}`);
          } catch (error) {
            // File doesn't exist yet, that's OK
          }
        }

        // Create backup of the new content. A save that changed only the merge
        // state leaves the file unchanged, so it writes no new version.
        if (existingContent !== fileContent) await createBackup(baseDir, backupName, fileContent);

        // Write via temp + rename: a crash or a full disk can never leave the
        // served file holding partial bytes.
        const beforeRename = readIdentity ? async () => {
          const current = await fs.stat(filePath, { bigint: true }).catch(error => {
            if (error.code === 'ENOENT') return null;
            throw error;
          });
          if (!current || ['dev', 'ino', 'size', 'mtimeNs'].some(name => current[name] !== readIdentity[name])) {
            const error = new Error('Checkpoint target changed since it was read');
            error.code = 'moved-or-deleted';
            throw error;
          }
        } : null;
        // The sidecar lands before the file, and only the file part reaches disk.
        // A checkpoint is the write ClayJS is told contains a person's edits, so it
        // is the one write that must fail rather than report a rename the disk may
        // not keep.
        const durable = origin === 'checkpoint' ? { durable: true } : undefined;
        const storedContent = await storePageState(baseDir, name, content, durable);
        await atomicWriteFile(filePath, storedContent, 'utf8', beforeRename, durable);

        // Mark as browser save so file watcher doesn't send redundant notification.
        // Key is full path with extension so it matches engine-watcher's wasBrowserSave check.
        live.markBrowserSave(name);

        // Recorded from the bytes actually written, so a later conflict can tell a
        // second tab of this person's from a text editor. Set after the write, since
        // before it this would claim authorship of a save that then failed.
        // Keyed on the canonical filePath, the same key the write queue uses, so two
        // spellings of one file (an in-tree symlink, or a case-insensitive volume) can
        // never keep two separate records of who last wrote it.
        //
        // The mtime rides along with the stamp because the stamp alone cannot answer
        // the question. A file can go B -> C -> B, and once it is back at B the digest
        // matches this host's last write again, so an external editor's undo reads
        // exactly like another of this person's tabs. The mtime moved for both of those
        // writes and does not come back.
        const wroteAt = await fs.stat(filePath, { bigint: true }).catch(() => null);
        store.etags.set(filePath, {
          etag: documentEtag(content),
          mtimeNs: wroteAt ? wroteAt.mtimeNs : null,
          // Who wrote these bytes: 'save' for a tab, 'api' for a write with no tab
          // behind it. /save reads it to decide whether a conflicting stamp is
          // honestly another tab's, because a data API write is nobody's tab.
          writer: origin,
          // §6's receipt, bound here and nowhere else: this is the one moment this
          // host knows both which request's body it stored and what those stored
          // bytes stamp to. An id-less save records '' and so replaces any id
          // remembered from an earlier one, which is what keeps a remembered id from
          // outliving its own bytes when a later save happens to restore them.
          saveId
        });

        // The bytes are on disk: the page reservation commits into the one room,
        // and the authority stamps and publishes exactly what landed, once per
        // registered alias of this canonical file.
        if (pageToken) authority.rooms.commitPage(pageToken);
        if (authorityWrite) {
          await authority.confirmKnownWrite(target, content, token, {
            sender: origin === 'api' ? 'data-api' : 'server-save', persistentToken,
          });
        }

        // Morph view-mode tabs with the persisted on-disk HTML. Edit-mode tabs
        // are untouched — they sync via /live-sync/save on the live lane.
        //
        // A data API write has no tab behind it to relay its snapshot, so it has to
        // reach edit-mode tabs the way an external disk change does: the same
        // `external-change` notify the observer's _notifyExternal sends, so ClayJS
        // runs it through dirty-region protection before morphing. The saved-lane
        // broadcast stays, for the viewers. Same payload as the observer, different
        // sender — the writer here is the data API, not the file system.
        //
        // With an authority the saved lane is already published, once per alias, by
        // the confirmation above; this route is still its own publisher for a
        // no-authority caller, which is every legacy createApp(dir).
        const adopt = origin !== 'checkpoint' && content.includes('data-page') && needsAdoption(content);
        if (adopt) {
          ctx.observer?.publishExternal(
            name,
            Buffer.from(content, 'utf8'),
            `${path.basename(name)} was changed outside the editor`,
            { saved: false, continues: true }
          );
        }
        if (origin === 'api' && !adopt) {
          live.notify(name, {
            msgType: 'warning',
            msg: `${path.basename(name)} was updated through the data API`,
            action: 'reload',
            data: Buffer.byteLength(fileContent, 'utf8') <= MAX_EXTERNAL_HTML
              ? { kind: 'external-change', html: fileContent, sender: 'data-api', etag: documentEtag(content) }
              : { kind: 'external-change', sender: 'data-api' },
          });
        }
        if (!authorityWrite) {
          live.broadcast(name, { html: fileContent, sender: origin === 'api' ? 'data-api' : 'server-save' }, { lane: 'saved' });
        }
        // Refresh the per-site API data sidecar BEFORE the fallible Tailwind compile,
        // so a Tailwind failure can't skip it and leave stale API data on disk
        // (mirrors the platform ordering in node-content.js). Non-fatal: a sidecar
        // error must never fail the save.
        try {
          await writeApiSidecar(baseDir, name, content);
        } catch (e) {
          console.error('writeApiSidecar failed (non-fatal):', e && e.message ? e.message : e);
        }

        // Data-clobber guard (non-blocking, non-fatal). A browser /save is always
        // a UI save, split by the userDriven bit into ui-gestured / ui-background.
        // A data API write has no tab behind it at all, so it is judged as an
        // external edit, exactly like a write the watcher saw on disk.
        {
          const dataLossProv = origin === 'api' ? 'external' : dataGuard.provenanceForLocalSave(userDriven);
          dataGuard.runDataLossGuard({
            baseDir, name, newHtml: content, prevContent: dataLossPrev, prov: dataLossProv, live,
          }).catch(err => console.error('[data-guard] /save guard error:', err && err.message ? err.message : err));
        }

        // Generate Tailwind CSS if site uses it. `tailwindName` from
        // getTailwindCssName includes any path prefix present in the URL
        // (e.g. "blog/post"), so path.join naturally nests the CSS file. After
        // the replaceTailwindLink above, the URL is always scoped to the site's
        // folder, which mirrors the platform's
        // public-assets/tailwindcss/{username}/{path}/{baseName}.css layout.
        // Non-fatal, for the same reason as the sidecar above and the two remote
        // writers: the file is already written, backed up and broadcast by this
        // point, so a compiler error must not report the save as failed, and must
        // not skip the snapshot cache below.
        const tailwindName = getTailwindCssName(content);
        if (tailwindName) {
          try {
            const css = await compileTailwind(content);
            const cssPath = await resolveTailwindWrite(tailwindName);
            await atomicWriteFile(cssPath, css);
            console.log(`Generated Tailwind CSS: ${TAILWIND_DIR}/${tailwindName}.css`);
          } catch (e) {
            console.error('compileTailwind failed (non-fatal):', e && e.message ? e.message : e);
          }
        }

        // Record the provenance bit for platform sync. The sync engine reads it
        // when uploading, so the platform guard can split a UI save from a
        // background-script save. The snapshot beside it comes from
        // /live-sync/save, which is why this merges rather than replaces: the two
        // lanes contribute different halves of the same entry.
        {
          const prev = store.snapshots.get(name);
          store.snapshots.set(name, {
            html: prev ? prev.html : null,
            userDriven,
            timestamp: Date.now()
          });
        }
        return content;
      } finally {
        if (pageToken) authority.rooms.releasePage(pageToken);
      }
    }

    if (ctx.localCheckpoint) {
      ctx.localCheckpoint.registerWriter(ctx.root.id, (write) => commitDocument(write));
    }

    // Spec §3: /_/save takes the document as text, and this route has exactly one
    // body shape. Everything else about the save travels in a header: the
    // provenance bit is `Save-Trigger`, and an unstripped snapshot goes to
    // /live-sync/save, which is the only route allowed to carry one.
    //
    // Every content type is read as text so a JSON body arrives as a string and
    // can be refused with a real message, rather than reaching the handler as an
    // unparsed blank and reporting "invalid request body".
    app.use('/save', express.text({ type: () => true, limit: SAVE_MAX_BYTES }));

    // POST route to save/overwrite HTML files (supports subfolders)
    app.post('/save', async (req, res) => {
      const pageUrl = documentUrlHeader(req);
      if (!pageUrl) {
        return res.status(400).json({
          msg: 'Document-URL header required.',
          msgType: 'error'
        });
      }
      const name = resolveResourceFromHref(pageUrl);

      if (isJsonContentType(req.headers['content-type'])) {
        return res.status(415).json({
          msg: '/_/save takes the document as text, not JSON.',
          msgType: 'error',
          code: 'unsupported-type'
        });
      }

      // Reassigned below by scopeTailwindLink and formatHtml.
      let content = req.body;

      // A save is always a whole document: the browser serializes
      // documentElement.outerHTML. Checking the shape is not belt-and-braces here,
      // it is the only check there is. The route reads EVERY content type as text
      // so a JSON body can be refused with a real message, which means the type
      // matcher no longer rejects anything on the way in, and without this a
      // form-encoded post answered 200 and left `a=%3Chtml%3E...` in the file.
      // hasHtmlRoot scans for a real top-level <html> element rather than the
      // substring '<html', so junk that merely mentions one does not pass.
      if (!hasHtmlRoot(content)) {
        return res.status(422).json({
          msg: 'Not a complete HTML document with a top-level <html> element.',
          msgType: 'error',
          code: 'invalid-document'
        });
      }

      // Spec §9, and it has to happen HERE, before the etag is computed and before
      // anything else reads `content`: the stamp must describe the bytes that reach
      // disk. This host injects no token of its own, but a document that has been
      // served by one that does carries the attribute in what the browser sends back,
      // and nothing else on this path would take it out. See utils/root-attrs.js for
      // what a token on disk costs.
      content = canonicalForWrite(stripSaveToken(content));

      const userDriven = dataGuard.userDrivenFromHeader(req);

      // §6's receipt id. Opaque, never a credential, and never minted here: this host
      // only ever echoes an id a client sent, so a client can trust that seeing its
      // own id back means its own save is what wrote these bytes. Read at route scope
      // rather than inside the write queue below, because the answer this rides home
      // on is built after that queue has released.
      let saveId = req.headers['save-id'];
      if (typeof saveId !== 'string' || saveId.length > MAX_SAVE_ID_LEN) saveId = '';

      // Phase-4 canonical resolution. `filePath` is the real path on disk (an
      // in-tree symlink is followed only when it was consented at open time),
      // and it is also the write-queue key below.
      let filePath;
      try {
        filePath = await resolveWriteTarget(paths, name);
      } catch (error) {
        return res.status(error.status || 400).json({
          msg: error.message,
          msgType: 'error'
        });
      }

      if (ctx.isKnownPath && !ctx.isKnownPath(name, filePath, ctx.root.id)) {
        return res.status(409).json({
          msg: 'This file has been moved or deleted. Please refresh the page.',
          msgType: 'error'
        });
      }

      // Ensure body content is a string
      if (typeof content !== 'string') {
        return res.status(400).json({
          msg: 'Invalid request body. Plain text HTML content expected.',
          msgType: 'error'
        });
      }

      // Set by the conditional check below to carry the refusal out of the lock, so
      // the response is written after the lock is released like every other answer
      // this route gives.
      let conflict = null;

      let refusedStamp = null;

      // Filled by the commit below with the clean file part, which is what a
      // `Prefer: return=representation` caller may be handed.
      const answer = {};

      try {
        // A1: the queue wraps the ENTIRE read-modify-write region — the pre-write
        // read, the first-save check, the backup, the write, and the derived
        // sidecar/Tailwind work. Serializing only the write would still let two
        // concurrent saves read the same stale base and compute from it.
        //
        // With an authority this is the shared document boundary instead, and the
        // path every read, stat and write below uses is the one that boundary
        // admitted: re-resolved, rechecked against the root's known paths and
        // against the identity this request captured before it queued.
        await runDocumentWrite(req, name, filePath, async (target, token) => {
        const canonicalPath = target.canonicalPath;
        // Ensure directory exists for subfolder files
        await fs.mkdir(path.dirname(canonicalPath), { recursive: true });

        // Capture the pre-write body for the data-clobber guard (cold-start seed
        // + whole-file Revert). Read once, before the overwrite below.
        // Read as BYTES, not as decoded text, because §6 stamps the bytes on disk
        // and an etag is a promise made BETWEEN hosts: the same document synced from
        // hyperclay.com has to stamp the same here. Decoding first replaces anything
        // that is not valid UTF-8 with U+FFFD, so a file holding one stray byte hashes
        // to a value no other host computes, and a client carrying a perfectly good
        // stamp is refused a save for a document that never changed.
        //
        // ENOENT is a first save and reads as empty. Any OTHER failure means this host
        // cannot say what the stored bytes are, which is tracked separately rather than
        // flattened into "empty"; see the conditional check below.
        let storedBytes = null;
        let unreadable = null;
        try {
          // The page editor's merge state lives in a sidecar, so the document this
          // save judges is the stored file with that state put back: the If-Match
          // below, the 412 stamp and the data-clobber guard all describe it. A
          // document with no such state keeps its exact bytes.
          storedBytes = await logicalBytes(baseDir, name, await fs.readFile(canonicalPath));
        } catch (e) {
          if (e.code !== 'ENOENT') unreadable = e;
        }
        const dataLossPrev = storedBytes === null ? null : storedBytes.toString('utf8');
        if (storedBytes !== null) refusedStamp = documentEtag(storedBytes);

        // A zero-byte file that something is still emptying is not a document, and
        // writing over it loses what the page is about to be told is there.
        if (storedBytes !== null && storedBytes.length === 0 && ctx.observer && ctx.observer.emptyPending(name)) {
          conflict = {
            status: 409,
            msg: `${path.basename(name)} was just emptied on disk; retry once that change reaches the page.`,
            code: 'truncation-pending',
          };
          return;
        }

        // Spec §6, and the reason the whole check sits INSIDE the lock: a stamp
        // compared against bytes read outside it is a stamp compared against bytes
        // another save may already have replaced, which is the exact race the
        // conditional save exists to close. An absent header is a plain
        // last-write-wins save, which stays the core behaviour; an empty one is a
        // client that computed its stamp wrong and is refused rather than quietly
        // dropped back to overwriting.
        const ifMatch = req.headers['if-match'];
        if (ifMatch !== undefined) {
          // A read that failed for a reason other than "there is no file yet" leaves
          // this host unable to compare anything. Judging the stamp against the empty
          // bytes the failure left behind would turn the failure into an answer: the
          // refusal hands back the empty-content etag as though it described the file,
          // and a client doing the obvious thing, retrying with the stamp it was just
          // given, is let through to replace bytes nobody could read. Nothing backs
          // them up either, because the first-save backup reads the same file. A
          // conditional save is a promise to compare, so a host that cannot read says
          // so instead.
          if (unreadable) {
            conflict = { status: 500, msg: `Could not read ${name} to check it against your copy.` };
            return;
          }
          if (!ifMatchSatisfied(ifMatch, storedBytes)) {
            // §6: name a writer only when this host can honestly say. Both halves have
            // to agree — the bytes on disk are the ones this process last wrote, AND
            // nothing has rewritten the file since — or the field is omitted, because
            // the wrong answer available here is the reassuring one. A stamp this host
            // recorded for a data API write belongs to no tab of this person's, so it
            // never answers `another-tab`: the caller is being told about the API.
            const ours = store.etags.get(canonicalPath);
            const now = await fs.stat(canonicalPath, { bigint: true }).catch(() => null);
            const untouchedSinceOurWrite =
              !!ours && ours.mtimeNs !== null && !!now && now.mtimeNs === ours.mtimeNs;

            const currentEtag = documentEtag(storedBytes);
            conflict = {
              status: 412,
              etag: currentEtag,
              changedBy: ours && ours.writer !== 'api' && ours.etag === currentEtag && untouchedSinceOurWrite
                ? 'another-tab'
                : null,
              // §6's late-duplicate rule. A client that recognises its OWN id here is
              // being told its own earlier save is what moved the document, which is
              // not a conflict with anybody: it adopts this stamp and re-sends rather
              // than alarming somebody about themselves.
              saveId: saveReceiptFor(store, canonicalPath, currentEtag)
            };
            return;
          }
        }

        content = await commitDocument({
          name, filePath: canonicalPath, content, dataLossPrev, userDriven, saveId,
          target, token, ifMatch, pageConversion: req.headers['page-conversion'], answer,
          pageWrite: req.headers['page-write'], pageFormat: req.get('X-Clay-Page-Format'),
        });
        });

        if (conflict && conflict.status === 500) {
          console.error(`Could not judge a conditional save of ${name}: the stored bytes are unreadable`);
          return res.status(500).json({ msg: conflict.msg, msgType: 'error' });
        }

        if (conflict && conflict.status === 409) {
          console.log(`Refused a save of ${name}: ${conflict.code}`);
          return res.status(409).json({ msg: conflict.msg, msgType: 'error', code: conflict.code });
        }

        if (conflict) {
          // 412 and nothing written, which is the half of §6 that matters: a host
          // advertising `conditional` and then overwriting anyway would tell every
          // client it protects them while it does not. The current stamp rides
          // along so a client can recover in one round trip instead of refetching
          // to learn what it should have sent. `changedBy` is omitted rather than
          // guessed when this host cannot honestly say.
          const body = {
            msg: `${name} changed since you last loaded it. Your version was not saved.`,
            msgType: 'error',
            code: 'conflict',
            etag: conflict.etag
          };
          if (conflict.changedBy) body.changedBy = conflict.changedBy;
          if (conflict.saveId) body.saveId = conflict.saveId;
          console.log(`Refused a conditional save of ${name}: the stored bytes have moved on`);
          return res.status(412).json(body);
        }

        res.status(200).json({
          msg: 'Saved',
          msgType: 'success',
          // Spec §6: a host advertising `conditional` returns the stamp with EVERY
          // save response, not only the refusals, or a client has nothing to send
          // as its next If-Match. Taken from `content`, which the closure above
          // reassigned to the formatted bytes that reached disk.
          etag: documentEtag(content),
          // The echo that makes a timed-out save recoverable. A client whose request
          // never returned asks the host later and compares this id with its own; a
          // client whose request DID return has it confirmed in the same breath.
          ...(saveId ? { saveId } : {}),
          ...(req.headers.prefer === 'return=representation' ? { html: answer.html } : {})
        });
        console.log(`Saved: ${name}`);
      } catch (error) {
        // A page initialization or conversion the shared rooms package refused,
        // and a queued save whose document is no longer the one it claimed, are
        // answers rather than server faults: same envelope, same codes and the
        // same Retry-After the hosted host sends.
        const failure = pageWriteFailure(error);
        if (failure) {
          if (failure.retryAfter !== undefined) res.set('Retry-After', String(failure.retryAfter));
          const stamp = failure.code === 'page-lineage-stale' || failure.code === 'page-nothing-to-write'
            ? refusedStamp
            : null;
          if (stamp) res.set('ETag', stamp);
          console.log(`Refused a save of ${name}: ${failure.code}`);
          return res.status(failure.statusCode).json({
            msg: failure.message,
            msgType: 'error',
            code: failure.code,
            ...(failure.reason === undefined ? {} : { reason: failure.reason }),
            ...(failure.minimum === undefined ? {} : { minimum: failure.minimum }),
            ...(stamp ? { etag: stamp } : {}),
          });
        }
        if (error && error.code === 'moved-or-deleted') {
          console.log(`Refused a save of ${name}: ${error.code}`);
          return res.status(409).json({ msg: error.message, msgType: 'error', code: 'moved-or-deleted' });
        }
        if (error && error.code === 'unsaved-edits') {
          console.log(`Refused a save of ${name}: ${error.code}`);
          return res.status(409).json({ msg: error.message, msgType: 'error', code: 'unsaved-edits' });
        }
        console.error(`Error saving file ${name}:`, error);
        errorLogger.error('Server', `Save error: ${name}`, error);
        res.status(500).json({
          msg: `Server error saving file: ${error.message}`,
          msgType: 'error'
        });
      }
    });

    // Data-clobber guard endpoint (parity with hyperclay.com's /_/dataloss).
    // The marker-strip middleware rewrites /_/data-loss -> /data-loss. The site
    // is identified by ?file= (GET) / body.file (POST), falling back to the
    // Page-URL header — the local server hosts many files by name.
    app.use('/data-loss', express.json({ limit: '1mb' }));

    const resolveGuardFile = async (req) => {
      const raw = (req.query && req.query.file) ||
        (req.body && typeof req.body === 'object' && req.body.file) ||
        documentUrlHeader(req) || '';
      if (!raw) return null;
      const name = resolveResourceFromHref(String(raw));
      try {
        return { name, filePath: await resolveWriteTarget(paths, name) };
      } catch {
        return null;
      }
    };

    // The one publish sequence for a write this app makes to a live document — the
    // data-loss guard's writeBack and F1's restore both call it, so the two cannot
    // drift. Format as the save path does, version the new bytes, write atomically,
    // mark the write as ours so the watcher does not re-run the guard on it, morph
    // view-mode tabs, then refresh everything derived from the bytes. Non-fatal on
    // the derived artifacts, for the same reason the save route is: the document is
    // already written, backed up and broadcast by that point.
    // Returns the composed document, which is what the stamp describes.
    const publishHostWrite = async ({ name, filePath, html, target = null, token = null, beforeWrite = null, edit = false }) => {
      // Response-scoped root metadata (a save token, this host's own documentetag)
      // comes back from clients and from a stored version, and none of it belongs in
      // the bytes this writes: stripped here, once, so the data-loss writeBack and the
      // restore route cannot each forget it.
      html = canonicalForWrite(stripSaveToken(html));
      const backupName = name.replace(/\.(html|htmlclay)$/, '');
      const formatted = formatHtml(scopeTailwindLink(name, html));
      const write = await splitWrite(baseDir, name, formatted);
      const content = write.logical;
      // An already owned helper: a caller arrives inside runDocumentWrite's boundary,
      // so this claims nothing and locks nothing of its own. With an authority it
      // proves that boundary and writes the path that boundary admitted.
      const authority = ctx.localAuthority;
      const authorityWrite = Boolean(authority && target && token);
      if (authorityWrite) {
        assertWriteContext(token, target.canonicalPath);
        filePath = target.canonicalPath;
      }
      let pageToken = null;
      try {
        if (authorityWrite && !edit) {
          // Explicit replacement admission, before the first backup, and held across
          // the backup and the atomic write: no frame can change the room while the
          // disk result is pending. An edit of the page (a restore stamped with the
          // record's rev) continues the room instead of replacing it, so it reserves
          // nothing and the open tabs merge the result.
          pageToken = authority.rooms.reservePageReplacement(filePath, {
            nodeId: target.identity,
            html: content,
          });
        }
        if (beforeWrite && await beforeWrite() === false) return null;
        await createBackup(baseDir, backupName, write.file);
        await atomicWriteFile(filePath, await storePageState(baseDir, name, content));
        // A write through this app, not an external editor. Marked so the file
        // watcher doesn't treat it as a fresh change and re-run the guard (which
        // would raise a spurious new event).
        live.markBrowserSave(name);
        if (authorityWrite) {
          // The bytes are on disk: the reservation commits into the one room and the
          // authority stamps and publishes exactly what landed, once per registered
          // alias of this canonical file. That is why the old single-root broadcast
          // below is the no-authority path only.
          if (pageToken) authority.rooms.commitPage(pageToken);
          await authority.confirmKnownWrite(target, content, token, { sender: 'server-save' });
        } else {
          // Morph view-mode tabs with the persisted on-disk HTML.
          live.broadcast(name, { html: require('@panphora/clayjs/server/rooms').splitPage(content).file, sender: 'server-save' }, { lane: 'saved' });
        }
      } finally {
        if (pageToken) authority.rooms.releasePage(pageToken);
      }
      try { await writeApiSidecar(baseDir, name, content); } catch {}
      const tailwindName = getTailwindCssName(content);
      if (tailwindName) {
        try {
          const css = await compileTailwind(content);
          const cssPath = await resolveTailwindWrite(tailwindName);
          await atomicWriteFile(cssPath, css);
        } catch {}
      }
      return content;
    };

    // GET /_/meta — discovery (spec §5). Both lanes require the `/_/` prefix, the
    // same way the other system routes do, so a user folder actually named `meta` or `upload`
    // keeps being served as a folder.
    app.get('/meta', async (req, res, next) => {
      if (!req.originalUrl.startsWith('/_/meta')) return next();
      // `spec` and `extensions` describe the HOST and are the same for every
      // document it serves. `document` describes the one named by Document-URL,
      // and is withheld by OMISSION, so the answer for a document that is not
      // there is byte-identical to the answer for one a caller may not see.
      // `sync` is announced because this host serves both halves of the §10 address.
      // `conditional` because /_/save honours If-Match and returns a stamp with every
      // save; §6 forbids announcing it and then not honouring it, since a client that
      // reads the name stops guarding itself.
      // `format` because the save route runs formatHtml, which is §4's opt-in
      // contract exactly: it reformats only a document whose root carries
      // `formathtml="true"` and stores every other document's bytes as sent. §4 says
      // a host that does NOT declare `format` ignores that attribute entirely, so
      // omitting the name while honouring the attribute told every client its bytes
      // were kept verbatim while this host rewrote them. hyperclay announces it for
      // the same behaviour.
      // `scoped-stylesheet` because the save route runs scopeTailwindLink, which
      // rewrites a document's own Tailwind link so it addresses the stylesheet this
      // host generates for that document. §4 says stored bytes are the bytes sent, so
      // a host doing that while announcing nothing has told every client its documents
      // are stored verbatim when they are not. The opt-in is the link itself: a
      // document carrying none is returned untouched, and one whose link is already
      // correct is rewritten to the value it had, so the visible effect is repairing
      // the link after a rename. It matters most to a client comparing what it sent
      // against what is on disk, which is what a conditional save does.
      // `receipts` because /_/save remembers the Save-ID of the request whose body
      // produced the bytes it stores and reports it from all three §6 surfaces. It
      // is announced only alongside `conditional`, which §9 requires: a receipt can
      // prove an earlier save ran, but only If-Match makes the send that follows a
      // MISSING receipt safe.
      // `sync-worker` because this host serves the SharedWorker script that §10's
      // list form needs. It is the whole invitation: a client that sees it and
      // `sync` opens one stream per origin through the worker, and one that does
      // not keeps the per-tab stream it has always used.
      // `wire` because this host serves §11's two routes, so `clay.wire` pages and
      // the `htmlclay wire` CLI can drive a local process from a document here.
      const body = { spec: 1, extensions: ['conditional', 'data-read', 'data-write', 'format', 'receipts', 'scoped-stylesheet', 'sync', 'sync-worker', 'upload', 'wire'] };
      if (ctx.localAuthority) body.extensions.push('live-data', 'live-provenance', 'page');
      // Presence is announced only by the host that actually runs the relay. `presence`
      // is the legacy editing marker; the two versioned names are what a client needs
      // before it publishes a record or a page target, so they are never advertised
      // beside an implementation that would not accept one.
      if (ctx.localAuthority && ctx.localAuthority.presence) {
        body.extensions.push('presence', 'page-awareness-v1', 'record-awareness-v1');
      }
      // `people` (§9) when the app supplies a person: one app-wide profile, so the
      // answer is the same in every root. Never `members`: a profile is not a directory.
      if (ctx.person) body.extensions.push('people');
      if (pageFormatSupported({
        rooms: roomsPackage(),
        runtimeDir: path.join(__dirname, 'offline-runtime', runtimeAssets.selectedVersion),
      })) body.extensions.push(roomsPackage().PAGE_FORMAT_EXTENSION);
      body.extensions.sort();
      const href = documentUrlHeader(req);
      if (href) {
        try {
          const name = resolveResourceFromHref(href);
          const filePath = await resolveWriteTarget(paths, name);
          const stats = await fs.stat(filePath);
          if (stats.isFile()) {
            // Read before the block is built, so a file that stats but cannot be
            // read takes the same omission path as one that is not there, rather
            // than reporting itself writable with no stamp.
            // The logical document, for the same reason the save route reads it: the
            // stamp announced here is the one a client will send back as If-Match,
            // and the two must be computed over the same thing.
            const stored = await logicalBytes(baseDir, name, await fs.readFile(filePath));
            // Everything under the served folder belongs to the person running
            // this app, so there is no permission to consult: writable is what
            // this host IS.
            body.document = {
              writable: true,
              maxBytes: SAVE_MAX_BYTES,
              // Every save leaves the bytes it replaced in `.hyperclay/versions`, and
              // /_/versions, /_/version and /_/restore put them back, so the version a
              // whole-document save replaces is recoverable. This host has no per-user
              // model: whoever the document block is answered for is the person running
              // the app, so the claim is the same for every caller that gets a block.
              versions: true,
              upload: { allowed: true, maxBytes: UPLOAD_MAX_BYTES, access: UPLOAD_ACCESS },
              // The stamp of what is on disk right now. A client that loaded the page
              // before this host announced `conditional`, or that reloaded from cache,
              // has no stamp of its own; this is where it gets one without a save.
              etag: documentEtag(stored),
              // The conditional read of the page state stored for these exact bytes, so a
              // crash recovery can prove a checkpoint covers its journaled edits.
              pageState: { href: '/_/page-state' }
            };
            // §6: the id of the save that produced exactly these bytes, when this
            // host can still prove the pairing. This is the surface a client asks
            // after a save whose outcome it never learned.
            const receipt = saveReceiptFor(store, filePath, body.document.etag);
            if (receipt) body.document.saveId = receipt;
            // W2.3: the document's own discovery, beside the stamp that
            // describes it (CONTRACTS §11). Every declared name with the state
            // the user's decisions give it, and ai-edit after them.
            if (helperDispatcher) body.document.helpers = await helperDispatcher.describe(filePath);
          }
        } catch { /* omission, never a different answer */ }
      }
      if (body.document && ctx.person && sameOriginDiscovery(req)) {
        const person = ctx.person();
        // Sharing is on but the account's person cannot be named right now. Said inside the
        // People block, never as a failed answer: a failed discovery turns off every
        // capability on the page, and the rest of this answer is still true.
        body.document.people = person.unavailable ? { me: null, unavailable: true } : { me: person.me || null };
        res.set('Cache-Control', 'private, no-store');
      }
      return res.json(body);
    });

    // GET /_/page-state — the page state this host stored for the exact document bytes a
    // client accepted, and the page lineage (generation) it belongs to. That is the whole
    // question a crash recovery asks before it can prove a checkpoint covers its journaled
    // edits and clear them. Document-scoped and conditional exactly as /_/save is: If-Match
    // names the bytes whose state is being asked for, so a stamp that has moved on is a 412
    // and never a state paired with bytes the client does not hold.
    app.get('/page-state', async (req, res, next) => {
      if (!req.originalUrl.startsWith('/_/page-state')) return next();
      res.set('Cache-Control', 'no-store');
      const refuse = (status, code, etag) => {
        if (etag) res.set('ETag', etag);
        res.status(status).json({ error: 'page state unavailable', code, ...(etag && { etag }) });
      };
      const href = documentUrlHeader(req);
      const ifMatch = req.get('if-match');
      if (!href) return refuse(404, 'no-page-state');
      if (!ifMatch || !ifMatch.trim()) return refuse(428, 'precondition-required');
      let name, filePath;
      try {
        name = resolveResourceFromHref(href);
        filePath = await resolveWriteTarget(paths, name);
      } catch {
        return refuse(404, 'no-page-state');
      }
      try {
        // Read, compare and select under the file's own lock, the one the save path takes,
        // so a save landing in between cannot pair one revision's stamp with another's state.
        return await withFileLock(filePath, async () => {
          let raw;
          try {
            const stats = await fs.stat(filePath);
            if (!stats.isFile()) return refuse(404, 'no-page-state');
            raw = await fs.readFile(filePath);
          } catch {
            return refuse(404, 'no-page-state');
          }
          // The same document /_/meta stamps, so the stamp a client read there is the one
          // this route compares, and the one it names back with a 412.
          const logical = await logicalBytes(baseDir, name, raw);
          const etag = documentEtag(logical);
          const field = ifMatch.trim();
          if (field === '*' || field.includes(',') || !ifMatchSatisfied(field, logical)) {
            return refuse(412, 'etag-mismatch', etag);
          }
          // The stored file's own article revision: the state that belongs to THESE bytes,
          // never the newest record in the sidecar. A record written before this host kept
          // generations proves no lineage, so it is not served as proven state.
          const record = await readPageRecord(baseDir, name, roomsPackage().pageRev(raw.toString('utf8')));
          if (!record) return refuse(404, 'no-page-state', etag);
          res.set('ETag', etag);
          return res.status(200).json({
            version: 1,
            // This host mints no document id; the shape is the one HTML Clay answers.
            documentId: null,
            generation: record.generation,
            etag,
            // The digest of the tag a client holds, so proving a checkpoint covers the
            // journal never means shipping the state back.
            stateHash: crypto.createHash('sha256').update(record.tag, 'utf8').digest('hex'),
            tag: record.tag,
          });
        });
      } catch (error) {
        return next(error);
      }
    });

    // POST /_/upload — store a file in this root's uploads folder instead of
    // embedding it (spec §9). No body parser runs on this path: express.json/text are scoped
    // to '/save', so the multipart body arrives intact.
    app.post('/upload', async (req, res, next) => {
      if (!req.originalUrl.startsWith('/_/upload')) return next();
      const href = documentUrlHeader(req);
      let folderRel = null;
      try {
        folderRel = href ? null : uploadFolderHeader(req);
      } catch (error) {
        return res.status(400).json({ msg: error.message, msgType: 'error', code: 'bad-request' });
      }
      if (!href && folderRel === null) {
        return res.status(400).json({ msg: 'Document-URL header required.', msgType: 'error', code: 'bad-request' });
      }
      const docName = href ? resolveResourceFromHref(href) : null;
      try {
        // The upload is authorized by the document existing and being writable,
        // exactly as a save is. A file that is not there cannot be uploaded to.
        // The workspace window names a folder instead when the folder holds no document.
        let docPath = null;
        let folderPath = null;
        if (docName !== null) {
          docPath = await resolveWriteTarget(paths, docName);
          const docStats = await fs.stat(docPath).catch(() => null);
          if (!docStats || !docStats.isFile()) {
            return res.status(404).json({ msg: 'That document does not exist.', msgType: 'error', code: 'not-found' });
          }
        } else {
          await paths.ready();
          folderPath = folderRel ? await resolveWritePath(paths, folderRel) : paths.baseReal;
          const folderStats = await fs.stat(folderPath).catch(() => null);
          if (!folderStats || !folderStats.isDirectory()) {
            return res.status(404).json({ msg: 'That folder does not exist.', msgType: 'error', code: 'not-found' });
          }
        }

        const authority = ctx.localAuthority;
        const origin = `${req.protocol}://${req.get('host')}`;
        const docLocation = docName !== null ? { rootId: ctx.root.id, logicalPath: docName, canonicalPath: docPath } : null;
        const docClaim = authority && docLocation ? authority.captureAdmission(docLocation) : null;

        const part = await readUploadPart(req, UPLOAD_MAX_BYTES);
        if (!part) {
          return res.status(400).json({ msg: 'No file to upload.', msgType: 'error', code: 'bad-request' });
        }
        if (refusedUpload(normalizeUploadName(part.filename))) {
          return res.status(415).json({ msg: 'That kind of file cannot be uploaded.', msgType: 'error', code: 'unsupported-type' });
        }

        const dirRel = docName !== null ? `${UPLOADS_FOLDER}/${assetsFolderName(docName)}` : folderRel;
        const dirPath = authority ? await resolveWritePath(paths, dirRel) : null;
        const dirLocation = authority
          ? { rootId: ctx.root.id, logicalPath: dirRel, canonicalPath: dirPath }
          : null;
        const dirClaim = authority ? authority.captureAdmission(dirLocation) : null;

        let stored;
        if (ctx.localAuthority) {
          stored = await withStructureChange(async (token) => {
            assertStructureContext(token);
            if (docName !== null) {
              let freshPath;
              try {
                freshPath = await resolveWriteTarget(paths, docName);
              } catch {
                throw movedOrDeleted();
              }
              if (freshPath !== docPath) throw movedOrDeleted();
              const freshStats = await fs.stat(freshPath).catch(() => null);
              if (!freshStats || !freshStats.isFile()) throw movedOrDeleted();
              if (ctx.isKnownPath && !ctx.isKnownPath(docName, freshPath, ctx.root.id)) throw movedOrDeleted();
              try {
                authority.validateAdmission(docClaim, { ...docLocation, canonicalPath: freshPath }, token, { allowInitialBind: true });
              } catch (error) {
                if (error && error.code === 'moved') throw movedOrDeleted();
                throw error;
              }
            } else {
              const freshFolder = await fs.stat(folderPath).catch(() => null);
              if (!freshFolder || !freshFolder.isDirectory()) throw movedOrDeleted();
            }

            const dirAbs = await resolveWritePath(paths, dirRel);
            if (dirAbs !== dirPath) throw movedOrDeleted();
            try {
              authority.validateAdmission(dirClaim, dirLocation, token, { allowRetired: true });
            } catch (error) {
              if (error && error.code === 'moved') throw movedOrDeleted();
              throw error;
            }
            const retired = authority.isRetired(dirLocation);
            const before = await fs.stat(dirAbs).then((stat) => stat, (error) => {
              if (error.code === 'ENOENT') return null;
              if (retired) throw movedOrDeleted();
              throw error;
            });
            if (retired && before) throw movedOrDeleted();
            await fs.mkdir(dirAbs, { recursive: true });
            const after = await fs.stat(dirAbs);
            if (!after.isDirectory()) throw movedOrDeleted();
            if (!before) authority.setAdmission(token, { ...dirLocation, active: true, prefix: true });
            const written = await storeUpload(paths, dirRel, part.filename, part.content, token, async ({ rel, abs }) => {
              const location = { rootId: ctx.root.id, logicalPath: rel, canonicalPath: abs };
              if (authority.isRetired(location)) {
                const occupied = await fs.stat(abs).then(() => true, (error) => {
                  if (error.code === 'ENOENT') return false;
                  throw movedOrDeleted();
                });
                if (occupied) throw movedOrDeleted();
              }
              try {
                return authority.admitWriteTarget(
                  authority.captureAdmission(location),
                  { ...location, origin, live },
                  token,
                  { explicitCreate: true }
                );
              } catch (error) {
                if (error && error.code === 'moved') throw movedOrDeleted();
                throw error;
              }
            });
            if (written.wrote) {
              await authority.confirmKnownWrite(written.target, part.content, token, { publish: false });
            }
            return written;
          });
        } else {
          const dirAbs = await resolveWritePath(paths, dirRel);
          await fs.mkdir(dirAbs, { recursive: true });
          stored = await storeUpload(paths, dirRel, part.filename, part.content);
        }

        // A host path, resolved by GET /_/uploads/ on whatever port this root is
        // served from. Percent-encoded per segment, while the stored name keeps its
        // own characters: a raw space breaks srcset, where a space separates candidates.
        // A document upload names its file inside `uploads/`; a folder upload names the
        // file where it sits, which the static route already serves.
        const url = docName !== null
          ? `/_/uploads/${strictSegment(path.basename(dirRel))}/${strictSegment(stored.name)}`
          : `/${folderRel ? `${folderRel.split('/').map(strictSegment).join('/')}/` : ''}${strictSegment(stored.name)}`;
        return res.json({
          msg: 'Uploaded',
          msgType: 'success',
          uploads: [{ name: stored.name, url, bytes: stored.bytes, access: UPLOAD_ACCESS }]
        });
      } catch (error) {
        const status = error.status || error.statusCode;
        if (!status) return next(error);
        return res.status(status).json({
          msg: error.message,
          msgType: 'error',
          code: UPLOAD_CODES[status] || 'error'
        });
      }
    });

    // GET /_/uploads/<folder>/<name>: the host path every upload answers (spec §9).
    // It names a file in this root's `uploads/`, so it resolves on any port this root
    // is served from and survives the document being renamed or moved. Files only,
    // never a listing, and always served as an upload: nosniff, an explicit type,
    // and a download for anything a browser would run.
    app.get(/^\/uploads\/(.+)$/, async (req, res, next) => {
      if (!req.originalUrl.startsWith('/_/uploads/')) return next();
      try {
        await paths.ready();
        const rel = `${UPLOADS_FOLDER}/${decodeOnce(req.path).slice('/uploads/'.length)}`;
        validateSegments(rel);
        const realPath = await resolveReadPath(paths, rel);
        // The root's consented links are honoured elsewhere, but an upload is only ever a
        // file inside the real `uploads/`: a link there may point anywhere the folder's
        // owner consented to, which is not somewhere this route serves from.
        let uploadsReal = null;
        try {
          uploadsReal = path.resolve(await fs.realpath(path.join(paths.baseReal, UPLOADS_FOLDER)));
        } catch { /* no real uploads folder means no file inside it */ }
        if (!uploadsReal || !isContained(uploadsReal, realPath)) throw new PathError(404, 'File not found');
        const stats = await fs.stat(realPath);
        if (!stats.isFile()) throw new PathError(404, 'File not found');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (/\.svgz?$/i.test(realPath) || refusedUpload(realPath)) {
          res.setHeader('Content-Disposition', 'attachment');
        }
        if (!path.extname(realPath)) res.type('application/octet-stream');
        return res.sendFile(realPath);
      } catch (error) {
        return next(error);
      }
    });

    app.get('/data-loss', async (req, res) => {
      const resolved = await resolveGuardFile(req);
      if (!resolved) return res.json({ event: null });
      let currentHtml = '';
      try { currentHtml = await fs.readFile(resolved.filePath, 'utf8'); } catch {}
      const event = await dataGuard.getGuardEvent(baseDir, resolved.name, currentHtml, live);
      return res.json({ event: event || null });
    });

    app.post(/^\/data-loss(?:\/(.+))?$/, async (req, res) => {
      const resolved = await resolveGuardFile(req);
      if (!resolved) return res.status(400).json({ error: 'file required' });
      const id = req.params[0] || (req.body && req.body.id) || null;
      const choice = req.body && req.body.choice;
      if (!['dismiss', 'revert', 'restore'].includes(choice)) {
        return res.status(400).json({ error: 'choice must be dismiss | revert | restore' });
      }

      // A1: the restore region is read-modify-write too — the current body is
      // read, the guard decides against it, and writeBack publishes. All of it
      // holds the same canonical-path queue slot a concurrent /save would need.
      let result;
      try {
        result = await runDocumentWrite(req, resolved.name, resolved.filePath, async (target, token) => {
        const canonicalPath = target.canonicalPath;
        const writeBack = async (html) => {
          await publishHostWrite({
            name: resolved.name, filePath: canonicalPath, html, target, token,
          });
        };
        let currentHtml = '';
        try { currentHtml = await fs.readFile(canonicalPath, 'utf8'); } catch {}
        return await dataGuard.resolveGuard({
          baseDir, name: resolved.name, id, choice, currentHtml, writeBack, live,
        });
        });
      } catch (error) {
        // Express 4 does not consume a rejected async handler's promise, so an
        // escaping failure would hang the request rather than answer it. A path
        // that moved while this write was queued is the one refusal the queue
        // itself gives; everything else keeps the route's existing answer.
        console.error(`Error resolving data-loss for ${resolved.name}:`, error && error.message ? error.message : error);
        if (error && error.code === 'moved-or-deleted') {
          return res.status(error.status || 409).json({ error: error.message });
        }
        return res.status(500).json({ error: 'data-loss resolution failed' });
      }
      if (!result.ok) return res.status(result.statusCode || 400).json({ error: result.error });
      // rider 1: after a local Dismiss, nudge the platform (and thence the owner's
      // other devices) to clear the same incident. nodeId from the node map is an
      // optional rename-resilience accelerator. Fire-and-forget: the local UI has
      // already cleared, so the POST must not delay this response.
      const engine = ctx.syncEngineFor?.();
      if (result.control && engine?.serverUrl && engine.apiKey) {
        const nodeId = engine.repo?.getByPath?.(resolved.name)?.nodeId;
        engine
          .sendControlMessage(buildEnvelope('data-loss/dismiss', 1, {
            ...result.control,
            ...(nodeId ? { nodeId } : {}),
          }))
          .catch(() => {});
      }
      return res.json({ ok: true, choice: result.choice, status: result.status });
    });

    // F1: the three version-history routes htmlclay serves, addressed by the
    // document's path under the served folder. This host mints no tokens, so the
    // path is the identity -- the same way the static route and Document-URL name
    // a document. The store is the one the save path writes,
    // `.hyperclay/versions/<rootRel without extension>/`.
    //
    // Each route answers ONLY through the `/_/` marker, so a user folder actually
    // named `versions` keeps serving normally, and `restore` is covered by the
    // Origin and Sec-Fetch-Site guard on unsafe methods above.
    const DOC_TAIL = /^(.+\.(?:html|htmlclay))$/i;
    const DOC_AND_VERSION = /^(.+\.(?:html|htmlclay))\/([^/]+)$/i;

    // The document's versions directory. The name is the document's path under the
    // folder without its extension, which is what the save path backs up under.
    const versionsDirFor = (rel) =>
      path.join(baseDir, VERSIONS_DIR, rel.replace(/\.(html|htmlclay)$/i, ''));
    const recoveredDirFor = (rel) =>
      path.join(baseDir, RECOVERED_DIR, rel.replace(/\.(html|htmlclay)$/i, ''));
    const recoveredName = (name) => name.startsWith('recovered-');
    const storedVersionName = (name) => recoveredName(name) ? name.slice('recovered-'.length) : name;

    // Exactly one generated filename, and a document: anything else is refused
    // rather than resolved, so no name can address something outside the store.
    const isVersionName = (name) =>
      VERSION_NAME.test(storedVersionName(name)) && storedVersionName(name).toLowerCase().endsWith('.html');

    // The refusal shape: both spellings of the message that clients read, and a
    // code only where the spec's registry names one for the status.
    const versionError = (res, status, message) => {
      res.set('Cache-Control', 'no-store');
      const body = { ok: false, error: message, msg: message, msgType: 'error' };
      if (SPEC_ERROR_CODES[status]) body.code = SPEC_ERROR_CODES[status];
      return res.status(status).json(body);
    };

    // The versions directory as a real directory chain, so a directory symlink
    // planted under `.hyperclay` cannot redirect a restore read out of tree.
    const versionsDirReal = async (rel, recovered = false) => {
      const canonicalBase = await canonicalizeBase(baseDir);
      const dir = rebaseOntoCanonical(canonicalBase, baseDir, recovered ? recoveredDirFor(rel) : versionsDirFor(rel));
      await assertRealDirChain(canonicalBase, dir);
      return dir;
    };

    // The history of one document, newest first, in htmlclay's entry shape. The
    // instant is parsed rather than read off the name (a name carries a zone), so
    // two versions written either side of a DST fall-back still order correctly.
    const listVersionEntries = async (dir, recovered = false) => {
      let names;
      try { names = await fs.readdir(dir); } catch { return []; }
      const entries = [];
      for (const name of names) {
        if (!isVersionName(name)) continue;
        try {
          const st = await fs.stat(path.join(dir, name));
          if (st.isFile()) entries.push({ name, mtimeMs: st.mtimeMs, size: st.size });
        } catch {}
      }
      entries.sort(compareNewestFirst);
      return entries.map((entry) => ({
        name: recovered ? `recovered-${entry.name}` : entry.name,
        time: new Date(sortKey(entry)).toISOString(),
        seq: collisionSuffix(entry.name),
        size: entry.size,
        ...(recovered ? { kind: 'recovered' } : {}),
      }));
    };

    // GET /_/versions/<rootRel> — `{ ok, name, versions: [{ name, time, seq, size }] }`.
    app.get(/^\/versions\/(.+)$/, async (req, res, next) => {
      if (!req.fromSystemRoute) return next();
      const match = DOC_TAIL.exec(req.params[0]);
      if (!match) return versionError(res, 400, 'not an HTML document');
      let filePath;
      try {
        filePath = await resolveWriteTarget(paths, match[1]);
      } catch (error) {
        return versionError(res, error.status || 404, 'document not found');
      }
      const versions = [
        ...await listVersionEntries(versionsDirFor(match[1])),
        ...await listVersionEntries(recoveredDirFor(match[1]), true),
      ].sort((a, b) => (new Date(b.time) - new Date(a.time)) || (b.seq - a.seq));
      res.set('Cache-Control', 'no-store');
      return res.json({ ok: true, name: path.basename(filePath), versions });
    });

    // GET /_/version/<rootRel>/<versionName> — the version's own bytes, as a document.
    app.get(/^\/version\/(.+)$/, async (req, res, next) => {
      if (!req.fromSystemRoute) return next();
      const match = DOC_AND_VERSION.exec(req.params[0]);
      if (!match) return versionError(res, 400, 'not an HTML document');
      if (!isVersionName(match[2])) return versionError(res, 400, 'invalid version name');
      try {
        await resolveWriteTarget(paths, match[1]);
      } catch (error) {
        return versionError(res, error.status || 404, 'document not found');
      }
      let data;
      try {
        data = await fs.readFile(path.join(
          await versionsDirReal(match[1], recoveredName(match[2])), storedVersionName(match[2])
        ));
      } catch {
        return versionError(res, 404, 'version not found');
      }
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.set('Cache-Control', 'no-store');
      return res.send(data);
    });

    // POST /_/restore/<rootRel>/<versionName> — put one version back.
    app.post(/^\/restore\/(.+)$/, async (req, res, next) => {
      if (!req.fromSystemRoute) return next();
      const match = DOC_AND_VERSION.exec(req.params[0]);
      if (!match) return versionError(res, 400, 'not an HTML document');
      if (!isVersionName(match[2])) return versionError(res, 400, 'invalid version name');
      const rel = match[1];
      const versionName = match[2];

      let filePath;
      try {
        filePath = await resolveWriteTarget(paths, rel);
      } catch (error) {
        return versionError(res, error.status || 404, 'document not found');
      }

      // The whole read-decide-write region holds the same canonical-path queue
      // slot a concurrent /save would need (A1).
      let refusal = null;
      let restoredEtag = null;
      try {
        await runDocumentWrite(req, rel, filePath, async (target, token) => {
        const canonicalPath = target.canonicalPath;
        // The safety backup is mandatory, so a live file that exists but cannot be
        // read is a hard refusal rather than a skipped backup: proceeding would
        // destroy the bytes with no recovery copy, which is the one thing a
        // restore must never do. A file that is simply absent has nothing to lose.
        let current = null;
        try {
          current = await logicalBytes(baseDir, rel, await fs.readFile(canonicalPath));
        } catch (error) {
          if (error.code !== 'ENOENT') {
            console.error(`Refusing to restore ${rel}: current file cannot be read`);
            refusal = { status: 500, message: 'current file cannot be read, so no safety backup is possible' };
            return;
          }
        }

        if (req.headers['if-match'] !== undefined && !ifMatchSatisfied(req.headers['if-match'], current)) {
          refusal = { status: 412, message: 'document changed since it was loaded', etag: documentEtag(current) };
          return;
        }

        let data = null;
        try {
          data = await fs.readFile(path.join(
            await versionsDirReal(rel, recoveredName(versionName)), storedVersionName(versionName)
          ));
        } catch {
          refusal = { status: 404, message: 'version not found' };
          return;
        }
        if (data.length > SAVE_MAX_BYTES) {
          refusal = { status: 413, message: 'version is too large to restore' };
          return;
        }
        // Stripped rather than trusted: a restore must never write a save token to
        // disk, wherever the version's bytes came from.
        let html = stripSaveToken(data.toString('utf8'));
        const state = await readPageState(baseDir, rel);
        const { pageFormatFloor, withPageFormatFloor } = roomsPackage();
        // A restore is a person's explicit choice, so it is never refused; it only
        // keeps the floor the document already established.
        const storedFloor = pageFormatFloor(current ? current.toString('utf8') : '');
        const stamped = state && !roomsPackage().splitPage(html).state
          ? roomsPackage().stampPageRev(html, state.rev, Math.max(storedFloor, pageFormatFloor(html)))
          : null;
        const edit = Boolean(stamped);
        if (stamped) html = stamped;
        else html = withPageFormatFloor(html, storedFloor);
        if (!hasHtmlRoot(html)) {
          console.error(`Refusing to restore ${versionName} of ${rel}: not a complete HTML document`);
          refusal = { status: 422, message: 'version is not a complete HTML document' };
          return;
        }

        const authorityWrite = Boolean(ctx.localAuthority && target && token);
        const published = await publishHostWrite({
          name: rel, filePath: canonicalPath, html, target, token, edit,
          beforeWrite: async () => {
            if (current === null) return true;
            const backupName = rel.replace(/\.(html|htmlclay)$/i, '');
            let safetyHtml;
            try {
              // An edit of the page keeps the room: its unsaved edits stay in it and
              // merge the restored article, so the backup is the plain document and
              // the room's own edits are rendered into a recovered copy below.
              safetyHtml = edit || !ctx.localCheckpoint
                ? current.toString('utf8')
                : await ctx.localCheckpoint.safetyBackup(canonicalPath, current.toString('utf8'));
            } catch (error) {
              console.error(`Refusing to restore ${rel}: live room cannot be backed up`, error);
              refusal = { status: 500, message: 'live room cannot be backed up' };
              return false;
            }
            const safety = await createBackup(baseDir, backupName, safetyHtml);
            if (!safety) {
              console.error(`Refusing to restore ${rel}: safety backup failed`);
              refusal = { status: 500, message: 'could not create a safety backup' };
              return false;
            }
            // The room keeps its unsaved edits through an edit-restore, so they are
            // written to a recovered copy too: they survive even if no tab adopts
            // the restored article. A rendering failure never stops the restore.
            if (edit && ctx.localCheckpoint && ctx.localCheckpoint.dirty(ctx.localAuthority?.rooms.get(canonicalPath))) {
              try {
                const unsaved = await ctx.localCheckpoint.safetyBackup(canonicalPath, current.toString('utf8'));
                await publishRecoveredCopy(baseDir, rel, unsaved);
              } catch (error) {
                console.error(`Recovered copy of ${rel} failed (non-fatal):`, error && error.message ? error.message : error);
              }
            }
            return true;
          },
        });
        if (refusal) return;
        restoredEtag = documentEtag(published);
        // publishHostWrite morphs view-mode tabs on the saved lane (once per alias
        // already, when an authority published it), but an edit-mode tab is not
        // listening there, so the restore is announced the way any other host-side
        // write is (CONTRACTS 9a). With an authority the saved lane is already
        // published, so this must not send a second, duplicate one.
        ctx.observer?.publishExternal(
          rel,
          Buffer.from(published, 'utf8'),
          `${path.basename(rel)} was restored from a backup`,
          { saved: !authorityWrite }
        );
        }, { explicitCreate: true });
      } catch (error) {
        // Express 4 does not consume a rejected async handler's promise, so an
        // escaping failure would hang the request rather than answer it. The one
        // refusal the queue itself gives is a path that moved while this restore
        // was queued, and it answers with the 409 clients already branch on.
        console.error(`Error restoring ${rel}:`, error && error.message ? error.message : error);
        if (error && error.code === 'moved-or-deleted') {
          return versionError(res, error.status || 409, error.message);
        }
        return versionError(res, 500, 'write error');
      }

      if (refusal) {
        if (refusal.etag) return res.status(refusal.status).json({ ok: false, error: refusal.message,
          msg: refusal.message, msgType: 'error', code: 'conflict', etag: refusal.etag });
        return versionError(res, refusal.status, refusal.message);
      }
      console.log(`Restored ${rel} from version ${versionName}`);
      res.set('Cache-Control', 'no-store');
      return res.json({ ok: true, msg: `Restored ${versionName}`, msgType: 'success',
        ...(req.headers['if-match'] !== undefined ? { etag: restoredEtag } : {}) });
    });

    // GET /_/clayjs/<version>/<path> — the bundled ClayJS release, so a document
    // served to a plain browser gets its runtime from this host rather than from
    // clayjs.com. Public bytes, read-only: no Origin check, and the Host check above
    // already bounds who can ask.
    app.get(/^\/clayjs\/(.*)$/, async (req, res, next) => {
      if (!req.fromSystemRoute) return next();
      const origin = `http://${req.get('host')}`;
      const hit = runtimeAssets.resolveLocal(req.originalUrl, { documentURL: `${origin}/` });
      const asset = hit?.kind === 'local' && hit.available && runtimeAssets.assetFor(hit.version, hit.path);
      if (!asset) {
        res.set('Cache-Control', 'no-store');
        res.set('Content-Type', 'text/plain; charset=utf-8');
        return res.status(404).send('Not found');
      }
      const etag = `"${asset.sha256}"`;
      // The index's own type, with nothing appended to it.
      res.setHeader('Content-Type', asset.type);
      res.set('ETag', etag);
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      res.set('X-Content-Type-Options', 'nosniff');
      const ifNoneMatch = req.get('If-None-Match');
      if (ifNoneMatch && ifNoneMatch.includes(etag)) return res.status(304).end();
      // Express routes HEAD through this handler and sends it without a body,
      // keeping the same headers.
      return res.status(200).send(await fs.readFile(asset.file));
    });

    // Tailwind CSS — serve from disk or auto-generate on first request.
    // Regex route so the captured name can include slashes (nested paths like
    // "blog/post"). A traditional /tailwindcss/:name.css route only matches a
    // single path segment, which silently broke nested sites.
    app.get(/^\/tailwindcss\/(.+)\.css$/, async (req, res) => {
      res.setHeader('Content-Type', 'text/css');
      // Same canonical pass as every other consumer: this route used to rebuild
      // raw paths and follow symlinks on its own.
      let cssPath;
      let htmlPath;
      let sourceName;
      let name;
      try {
        // Express already decodes regex-route captures (router/layer.js decode_param),
        // so decoding here again would 400 on "50% off" and mis-resolve "a%20b".
        name = req.params[0]; // may contain slashes, e.g. "blog/post"
        cssPath = await resolveTailwindWrite(name);
      } catch (error) {
        return res.status(error.status === 400 ? 400 : 403).send('');
      }

      // Cache hit: a pure read, so it needs no queue slot.
      try {
        const css = await fs.readFile(cssPath, 'utf8');
        return res.send(css);
      } catch {}

      try {
        sourceName = `${name}.html`;
        htmlPath = await resolveDerivedWrite(sourceName);
        try {
          await fs.stat(htmlPath);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          sourceName = `${name}.htmlclay`;
          htmlPath = await resolveDerivedWrite(sourceName);
        }
      } catch (error) {
        return res.status(error.status === 400 ? 400 : 403).send('');
      }

      // Cache miss: this is a read-modify-write of a derived artifact, so it
      // belongs in the SOURCE file's critical section like every other derived
      // write. Unqueued, a compile of H0 that started before a concurrent /save
      // finishes after it and overwrites the H1 stylesheet the save published.
      try {
        const css = await runDocumentWrite(req, sourceName, htmlPath, async (target) => {
          // Re-check inside the boundary: we may have queued behind exactly the
          // save that just published a fresher stylesheet, and recompiling from
          // our own stale read would throw it away.
          const freshCssPath = await resolveTailwindWrite(name);
          try {
            return await fs.readFile(freshCssPath, 'utf8');
          } catch {}
          const html = await fs.readFile(target.canonicalPath, 'utf8');
          const compiled = await compileTailwind(html);
          await atomicWriteFile(freshCssPath, compiled);
          console.log(`Auto-generated Tailwind CSS: ${TAILWIND_DIR}/${name}.css`);
          return compiled;
        });
        return res.send(css);
      } catch {
        return res.send('');
      }
    });

    // `/_/api/<name>.html` — per-site data API (parity with hyperclay.com's
    // serveSiteApi). Gated on req.originalUrl so a BARE `/api/...` request still
    // falls through to a user's real `api/` folder; only the `/_/` marker form is
    // treated as the data API. Must come before the static catch-all. Reads the
    // requested extension, since
    // .htmlclay sites exist locally too.
    const pageFailure = (error) => {
      if (error?.code === 'revision-required') return { status: 428, json: { code: error.code, error: error.message } };
      if (error?.code === 'revision-stale') return { status: 409, json: { code: error.code, error: error.message } };
      if (error?.code === 'invalid-content' || error?.code === 'incomplete-page' ||
          error?.code === 'unknown-page-content' || error?.code === 'unsupported-projection' ||
          error?.code === 'invalid-document' ||
          (error?.name === 'PersistentReservationError' && error.code === 'invalid-target') ||
          ['WriteRejected', 'WriteRefused', 'ShapeMismatch', 'EmptyListInsert', 'RuleTargetReadOnly', 'WriteNotRoundTripped'].includes(error?.name)) {
        return { status: 422, json: { code: 'invalid-content', error: error.message } };
      }
      if (error?.name === 'NoRulesTag') {
        return { status: 400, json: { error: 'No api rules tag', message: 'This page has no rules tag with data-rules-name~="api".' } };
      }
      const mapped = mapApiTagError(error);
      return mapped ? { status: 400, json: mapped } : null;
    };

    async function pageOptions(query) {
      if (!query.present) return { codec: (await loadPageModules()).codec };
      const prepared = await prepareSiteDataWriteLocal({ dataParam: query.text });
      if (prepared.result) return { result: prepared.result };
      return { codec: (await loadPageModules()).codec, rules: prepared.rules };
    }

    async function readPageApi(target, token, name, query) {
      const bytes = await fs.readFile(target.canonicalPath).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (!bytes) return null;
      const stored = await logicalBytes(baseDir, name, bytes);
      const html = stored.toString('utf8');
      if (!hasPageStore(html)) return null;
      const changed = await ctx.localAuthority.reconcileDisk(target, html, token);
      if (changed.kind === 'replacement') throw movedOrDeleted();
      const options = await pageOptions(query);
      if (options.result) return options.result;
      try {
        const authoritative = await authoritativePageHtml(ctx.localAuthority, target, html);
        const { readPageDocument } = await loadPageModules();
        const page = await readPageDocument(cheerio.load, authoritative, options);
        return { status: 200, headers: { ETag: documentEtag(stored), 'Page-Revision': page.revision }, json: page.data };
      } catch (error) {
        const refusal = pageFailure(error);
        if (refusal) return refusal;
        throw error;
      }
    }

    async function readApiDocument(req, res, name, sourcePath) {
      const query = readDataQuery(req.originalUrl);
      if (query.error) return res.status(400).json(query.error);
      if (!ctx.localAuthority) {
        const result = query.present
          ? await extractSiteDataLocal(baseDir, name, query.text, { sourcePath })
          : await serveSiteApiLocal(baseDir, name, { sourcePath });
        return sendApiResult(res, result);
      }
      try {
        const result = await runDocumentWrite(req, name, sourcePath, async (target, token) => {
          const options = { sourcePath: target.canonicalPath, boundary: { target, token } };
          const page = await readPageApi(target, token, name, query);
          if (page) return page;
          return query.present
            ? extractSiteDataLocal(baseDir, name, query.text, options)
            : serveSiteApiLocal(baseDir, name, options);
        });
        return sendApiResult(res, result);
      } catch (error) {
        if (error && error.code === 'moved-or-deleted') {
          return res.status(409).json({ msg: error.message, msgType: 'error', code: 'moved-or-deleted' });
        }
        throw error;
      }
    }

    app.get(/^\/api\/(.+)\.(html|htmlclay)$/, async (req, res, next) => {
      if (!req.originalUrl.startsWith('/_/api/')) return next();
      let name;
      let sourcePath;
      try {
        // Already decoded by Express; see the /tailwindcss route above.
        name = `${req.params[0]}.${req.params[1]}`;
        sourcePath = await resolveWriteTarget(paths, name);
      } catch (error) {
        return res.status(error.status || 400).json({ error: error.message });
      }
      try {
        return await readApiDocument(req, res, name, sourcePath);
      } catch (error) {
        console.error('Site API endpoint error:', error);
        return res.status(500).json({ error: 'Internal server error', message: 'An unexpected error occurred' });
      }
    });

    // POST `/_/api/<name>.html` writes JSON into the document through its own api
    // rules tag, content only (the engine refuses script, handlers and HTML). Same
    // marker gate as the GET, the same loopback-origin gate as every mutating
    // request, and the same commit path as /save. Bare `/_/api` writes index.html,
    // as the bare GET reads it.
    async function handleApiWrite(req, res, name) {
      const query = readDataQuery(req.originalUrl);
      if (query.error) return res.status(400).json(query.error);
      if (!isJsonContentType(req.headers['content-type'])) {
        return res.status(415).json({ error: 'Unsupported Media Type', message: 'JSON writes take Content-Type: application/json.' });
      }
      let data;
      try {
        data = JSON.parse(req.body);
      } catch {
        return res.status(400).json({ error: 'Invalid JSON body', message: 'The request body is not valid JSON.' });
      }
      let sourcePath;
      try {
        sourcePath = await resolveWriteTarget(paths, name);
      } catch (error) {
        return res.status(error.status || 400).json({ error: error.message });
      }
      try {
        const preparedWrite = ctx.localAuthority
          ? await prepareSiteDataWriteLocal(query.present ? { dataParam: query.text } : {})
          : null;
        if (preparedWrite?.result) return sendApiResult(res, preparedWrite.result);
        const result = ctx.localAuthority
          ? await runDocumentWrite(req, name, sourcePath, async (target, token) => {
              const bytes = await fs.readFile(target.canonicalPath).catch((error) => {
                if (error.code === 'ENOENT') return null;
                throw error;
              });
              const stored = bytes && await logicalBytes(baseDir, name, bytes);
              const previous = stored?.toString('utf8');
              if (stored && hasPageStore(previous)) {
                const etag = documentEtag(stored);
                const changed = await ctx.localAuthority.reconcileDisk(target, previous, token);
                if (changed.kind === 'replacement') throw movedOrDeleted();
                if (!req.headers['page-if-match']) {
                  return { status: 428, headers: { ETag: etag }, json: { code: 'revision-required', error: 'Page-If-Match is required' } };
                }
                if (!req.headers['if-match']) {
                  return { status: 428, headers: { ETag: etag }, json: { code: 'etag-required', error: 'If-Match is required' } };
                }
                if (String(req.headers['if-match']).trim() === '*' || !ifMatchSatisfied(req.headers['if-match'], stored)) {
                  return { status: 412, headers: { ETag: etag }, json: { error: 'Precondition Failed', message: `${name} changed since you read it. Nothing was written.` } };
                }
                const room = ctx.localAuthority.rooms.get(target.canonicalPath);
                const held = room && String(room.nodeId) === String(target.identity)
                  ? ctx.localAuthority.rooms.holdPersistent(target.canonicalPath, { nodeId: target.identity, requireClean: false })
                  : null;
                try {
                  const authoritative = await authoritativePageHtml(ctx.localAuthority, target, previous);
                  const options = { codec: (await loadPageModules()).codec,
                    ...(query.present ? { rules: preparedWrite.rules } : {}) };
                  const { readPageDocument, writePageDocument } = await loadPageModules();
                  const current = await readPageDocument(cheerio.load, authoritative, options);
                  if (current.revision !== req.headers['page-if-match']) {
                    return { status: 409, headers: { ETag: etag, 'Page-Revision': current.revision },
                      json: { code: 'revision-stale', error: 'The page revision has changed' } };
                  }
                  const result = await writePageDocument(cheerio.load, authoritative, data, {
                    ...options, expectedRevision: current.revision,
                  });
                  const written = result.html === previous ? previous : await commitDocument({
                    name, filePath: target.canonicalPath, content: result.html, dataLossPrev: previous,
                    userDriven: false, saveId: '', origin: 'api', target, token, persistentToken: held,
                    pageFormat: req.get('X-Clay-Page-Format'),
                  });
                  const fresh = await readPageDocument(cheerio.load, written, options);
                  return { status: 200, headers: { ETag: documentEtag(Buffer.from(written, 'utf8')),
                    'Page-Revision': fresh.revision }, json: fresh.data };
                } catch (error) {
                  const refusal = pageFailure(error);
                  if (refusal) return refusal;
                  throw error;
                } finally {
                  if (held) ctx.localAuthority.rooms.releasePersistent(held);
                }
              }
              return applySiteDataLocal(baseDir, name, data, {
                sourcePath: target.canonicalPath,
                boundary: { target, token },
                preparedWrite,
                ifMatch: req.headers['if-match'],
                ...(query.present ? { dataParam: query.text } : {}),
                commit: (html, previous) => commitDocument({
                  name, filePath: target.canonicalPath, content: html, dataLossPrev: previous,
                  userDriven: false, saveId: '', origin: 'api', target, token,
                  pageFormat: req.get('X-Clay-Page-Format')
                })
              });
            })
          : await applySiteDataLocal(baseDir, name, data, {
              sourcePath,
              ifMatch: req.headers['if-match'],
              ...(query.present ? { dataParam: query.text } : {}),
              commit: (html, previous) => commitDocument({
                name, filePath: sourcePath, content: html, dataLossPrev: previous, userDriven: false, saveId: '', origin: 'api',
                pageFormat: req.get('X-Clay-Page-Format')
              })
            });
        if (result.status === 200) console.log(`Wrote data into ${name}`);
        return sendApiResult(res, result);
      } catch (error) {
        if (error && error.code === 'moved-or-deleted') {
          return res.status(409).json({ msg: error.message, msgType: 'error', code: 'moved-or-deleted' });
        }
        if (error?.name === 'PersistentReservationError') {
          const status = error.code === 'checkpointing' ? 503 : 409;
          return res.status(status).json({ code: error.code, error: error.message });
        }
        const formatFailure = pageWriteFailure(error);
        if (formatFailure) {
          return res.status(formatFailure.statusCode).json({
            code: formatFailure.code,
            reason: formatFailure.reason,
            minimum: formatFailure.minimum,
            msg: formatFailure.message,
          });
        }
        console.error('Site API write error:', error);
        return res.status(500).json({ error: 'Internal server error', message: 'An unexpected error occurred' });
      }
    }

    app.post(
      /^\/api\/(.+)\.(html|htmlclay)$/,
      (req, res, next) => (req.originalUrl.startsWith('/_/api/') ? next() : next('route')),
      apiWriteBody,
      (req, res) => handleApiWrite(req, res, `${req.params[0]}.${req.params[1]}`)
    );
    app.post(
      /^\/api\/?$/,
      (req, res, next) => (req.originalUrl.startsWith('/_/api') ? next() : next('route')),
      apiWriteBody,
      (req, res) => handleApiWrite(req, res, 'index.html')
    );

    // `/_/api` or `/_/api/` with no file → index.html's data (parity nicety).
    app.get(/^\/api\/?$/, async (req, res, next) => {
      if (!req.originalUrl.startsWith('/_/api')) return next();
      try {
        const sourcePath = await resolveWriteTarget(paths, 'index.html');
        return await readApiDocument(req, res, 'index.html', sourcePath);
      } catch (error) {
        console.error('Site API endpoint error:', error);
        return res.status(500).json({ error: 'Internal server error', message: 'An unexpected error occurred' });
      }
    });

    // `<name>.html?data={...}` — query-driven extraction (parity with
    // extractSiteData). Intercepts a GET that carries ?data= before the static
    // catch-all serves the raw HTML; a no-data GET passes straight through.
    app.get(/.*/, async (req, res, next) => {
      // A marker-origin request that reached here (e.g. `/_/save/foo.html?data=`) matched no system
      // route, so its stripped path is reserved: `?data=` must not extract the file, just as the
      // static catch-all must not serve it.
      if (req.fromSystemRoute) return res.status(404).send('File not found');
      const query = readDataQuery(req.originalUrl);
      if (!query.present) return next();
      const rawName = plainDataName(req);
      if (!rawName) return next();
      if (query.error) return res.status(400).json(query.error);
      let name;
      let sourcePath;
      try {
        name = decodeOnce(rawName);
        sourcePath = await resolveWriteTarget(paths, name);
      } catch (error) {
        return res.status(error.status || 400).json({ error: error.message });
      }
      try {
        if (!ctx.localAuthority) {
          return sendApiResult(res, await extractSiteDataLocal(baseDir, name, query.text, { sourcePath }));
        }
        const result = await runDocumentWrite(req, name, sourcePath, async (target, token) =>
          extractSiteDataLocal(baseDir, name, query.text, {
            sourcePath: target.canonicalPath, boundary: { target, token }
          }));
        return sendApiResult(res, result);
      } catch (error) {
        if (error && error.code === 'moved-or-deleted') {
          return res.status(409).json({ msg: error.message, msgType: 'error', code: 'moved-or-deleted' });
        }
        console.error('Data endpoint error:', error);
        return res.status(500).json({ error: 'Internal server error', message: 'An unexpected error occurred' });
      }
    });

    // Dev-only popover control endpoints (only registered when devHooks are passed in)
    // Must be registered BEFORE the catch-all static file middleware below, otherwise
    // the catch-all intercepts every request (including POSTs) and returns 404.
    if (ctx.devHooks) {
      app.post('/__dev/popover/show', (req, res) => {
        try {
          ctx.devHooks.showSticky();
          res.json({ ok: true, sticky: true });
        } catch (err) {
          res.status(500).json({ ok: false, error: err.message });
        }
      });

      app.post('/__dev/popover/hide', (req, res) => {
        try {
          ctx.devHooks.hideAndClear();
          res.json({ ok: true, sticky: false });
        } catch (err) {
          res.status(500).json({ ok: false, error: err.message });
        }
      });
    }

    // Static file serving with SPA routing support
    // URLs with .html/.htmlclay extension: everything after the extension is a SPA route
    // e.g. /blog/app.htmlclay/dashboard → serves blog/app.htmlclay, SPA route: /dashboard
    app.use(async (req, res, next) => {
      try {
        // A request that arrived under the reserved `/_/` marker and reached the static
        // catch-all was not consumed by any system route, so its stripped path (e.g.
        // `save/foo.html`) must not be served as a document. 404 it.
        if (req.fromSystemRoute) {
          return res.status(404).send('File not found');
        }

        await paths.ready();

        // Phase 1: decode exactly once. Express never decodes req.path, so
        // before this a file with a space or any non-ASCII name was unreachable.
        // A malformed `%` throws URIError, which decodeOnce turns into a 400.
        const urlPath = decodeOnce(req.path);

        // The root opens the workspace. The listing stays as the fallback when the
        // workspace cannot start, for every folder below the root, and for anything that
        // is not a top-level page load (HEAD, a framed document's link to `/`, an <img>).
        if (urlPath === '/') {
          const dest = req.get('sec-fetch-dest');
          const navigation = req.method === 'GET' && (!dest || dest === 'document');
          const entry = navigation && ctx.workspaceEntry ? await ctx.workspaceEntry(ctx.root.id) : null;
          if (entry) {
            res.set('Cache-Control', 'no-store');
            return res.redirect(302, entry);
          }
          return await serveDirListing(res, paths.baseReal, paths.baseReal);
        }

        const requestedPath = urlPath.substring(1);

        // Check if URL contains an .html or .htmlclay segment (SPA-aware routing)
        const htmlMatch = requestedPath.match(/^(.*?\.html(?:clay)?)(\/.*)?$/);

        // Phases 2 + 3, resolved once for both branches below. A read error now
        // reaches the error handler with its real status instead of being
        // flattened into a 404 — and `await` matters: Express 4 does not consume
        // a rejected async handler's promise, so an unawaited serveHtml
        // rejection hangs the request.
        validateSegments(htmlMatch ? htmlMatch[1] : requestedPath);
        const realPath = await resolveReadPath(paths, htmlMatch ? htmlMatch[1] : requestedPath);
        const stats = await fs.stat(realPath);
        if (stats.isDirectory()) {
          // An .html segment names a document, never a folder.
          if (htmlMatch) throw new PathError(404, 'File not found');
          return await serveDirListing(res, realPath, paths.baseReal);
        }
        // A page type in an uploads folder is a download on EVERY branch, so the
        // decision is made before the page branch is reached rather than beside
        // the header below. Uploads store directly inside `assets-<stem>/`, so
        // only the immediate parent counts, compared without case: the disk
        // usually is, and `Assets-board/` is the same folder.
        const uploaded = refusedUpload(realPath) && inUploadsFolder(realPath);
        if (htmlMatch && !uploaded) {
          const wireId = Number(req.query['workspace-frame']);
          const frame = Number.isSafeInteger(wireId) && wireId > 0 && ctx.workspaceFrame
            ? ctx.workspaceFrame(ctx.root.id, htmlMatch[1], wireId) : null;
          return await serveHtml(req, res, realPath, frame, baseDir, htmlMatch[1]);
        }
        // An SVG is a document: it can carry <script>, and served inline from
        // this origin it runs with the same authority as the page beside it.
        // Uploads accept SVG precisely BECAUSE serving it inert is possible, so
        // this header is what makes that decision safe. Unconditional, because a
        // file's provenance is not knowable at serve time — one uploaded through
        // /_/upload and one the person dropped in the folder look identical here.
        // `nosniff` stops a browser from second-guessing the type.
        // `nosniff` on everything: the browser takes the type send sets from the
        // extension and never second-guesses it from the bytes.
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (/\.svgz?$/i.test(realPath)) res.setHeader('Content-Disposition', 'attachment');
        // A page type inside an uploads folder arrived as an attachment before
        // this check existed: hand it over as a download.
        else if (uploaded) {
          res.setHeader('Content-Disposition', 'attachment');
        }
        // send types an extensionless file by its bare basename, as if `html` or
        // `svg` were an extension: a file with no extension is bytes, never a page.
        if (!path.extname(realPath)) res.type('application/octet-stream');
        return res.sendFile(realPath);
      } catch (error) {
        return next(error);
      }
    });

    // A4: honor err.status and res.headersSent. This used to force a 500 on
    // every failure, including a client-aborted sendFile, where it then threw
    // again setting headers on an already-sent response.
    app.use((err, req, res, next) => {
      const status = err.status || err.statusCode ||
        (err.code === 'ENOENT' || err.code === 'ENOTDIR' ? 404 : 500);

      // Let Express's default handler destroy the socket; we cannot re-send.
      if (res.headersSent) return next(err);

      if (status >= 500) {
        console.error('[Server] Unhandled error:', err);
        errorLogger.error('Server', `Unhandled error: ${req.method} ${req.path}`, err);
      }

      const body = status === 404 ? 'File not found'
        : status === 403 ? 'Access denied'
        : status === 400 ? 'Bad request'
        : 'Internal server error';
      res.status(status).send(body);
    });

  return app;
}

// A0. The listing emits displayName through Eta's RAW tag (`<%~`) so the <wbr>
// markup below survives, which means the filename must be escaped BEFORE the
// breaks go in. Escaping first is safe for addWordBreaks: no entity produced
// here contains `-`, `_`, `/`, `.`, a lowercase→uppercase pair, or a
// letter-followed-by-digit pair, so no rule can ever split one apart.
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Eta escapes an href for HTML but never percent-encodes it, so `#`, `?` and `%`
// in a name produced broken links — and once the catch-all decodes exactly once,
// `50% off.html` would throw URIError on the way back in. Encode per segment so
// the separating slashes survive.
function encodePathSegments(relPath) {
  return String(relPath).split('/').map(encodeURIComponent).join('/');
}

function addWordBreaks(name) {
  // Rule 1: After separators (-, _, /)
  let result = name.replace(/([-_/])/g, '$1<wbr>');

  // Rule 4: CamelCase (lowercase → uppercase)
  result = result.replace(/([a-z])([A-Z])/g, '$1<wbr>$2');

  // Rule 5: Letter → Number transition
  result = result.replace(/([a-zA-Z])(\d)/g, '$1<wbr>$2');

  // Rule 2 & 3: Handle dots - before last dot, after intermediate dots
  const lastDotIndex = result.lastIndexOf('.');
  if (lastDotIndex > 0) {
    // Add break after intermediate dots (not the last one)
    const beforeLastDot = result.slice(0, lastDotIndex).replace(/\./g, '.<wbr>');
    const lastDotAndAfter = result.slice(lastDotIndex);
    result = beforeLastDot + '<wbr>' + lastDotAndAfter;
  }

  return result;
}

async function serveDirListing(res, dirPath, baseDir) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    // Get relative path for display
    const relPath = path.relative(baseDir, dirPath);
    const displayPath = relPath === '' ? '' : relPath;

    // Sort entries: directories first, then files. `sites-versions` is an
    // internal backup store, not user content — the listing must not advertise
    // it any more than the catch-all will serve it.
    const isVisible = (entry) =>
      !entry.name.startsWith('.') &&
      !(displayPath === '' && RESERVED_ROOT_SEGMENTS.has(entry.name));

    const dirs = entries
      .filter(entry => entry.isDirectory() && isVisible(entry))
      .map(entry => ({
        name: entry.name,
        displayName: addWordBreaks(escapeHtml(entry.name)),
        path: displayPath ? `${displayPath}/${entry.name}` : entry.name,
        url: encodePathSegments(displayPath ? `${displayPath}/${entry.name}` : entry.name)
      }));

    const files = entries
      .filter(entry => entry.isFile() && isVisible(entry))
      .map(entry => ({
        name: entry.name,
        displayName: addWordBreaks(escapeHtml(entry.name)),
        path: displayPath ? `${displayPath}/${entry.name}` : entry.name,
        url: encodePathSegments(displayPath ? `${displayPath}/${entry.name}` : entry.name),
        isHtml: entry.name.endsWith('.html') || entry.name.endsWith('.htmlclay')
      }));

    // Build breadcrumbs array
    const breadcrumbs = [];
    if (displayPath) {
      const parts = displayPath.split('/');
      let currentPath = '';
      for (const part of parts) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        breadcrumbs.push({
          name: part,
          path: '/' + currentPath,
          url: '/' + encodePathSegments(currentPath)
        });
      }
    }

    const html = eta.render('directory-listing', {
      displayPath,
      dirs,
      files,
      breadcrumbs
    });

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    console.error('Error rendering directory listing:', error);
    errorLogger.error('Server', 'Directory listing error', error);
    res.status(500).send('Error reading directory');
  }
}

module.exports = {
  getAndClearSnapshot,  // For sync engine to get cached snapshot HTML for platform sync
  sweepExpiredSnapshots,
  // Exported for testing
  createApp,
  pageFormatSupported,
  boundedWriter,
  handleSharedSyncStreamV2,
  handleAuthorityLiveStream,
  resolveResourceFromHref,
  validateAndResolvePath,
  stripSystemRouteMarker,
  SYSTEM_ROUTES,
  isLoopbackOrigin,
  isLoopbackHostHeader,
  isLoopbackHostname,
  canonicalForWrite,
  escapeHtml,
  encodePathSegments,
  addWordBreaks,
  assetsDirFor,
  assetsFolderName,
  UPLOADS_FOLDER,
  refusedUpload
};
