/**
 * ai-edit — comment-to-edit AI editing over clay.wire.
 *
 * Direct editing stays primary: text units carry editmode:contenteditable, so a
 * click places the caret and a figure keeps its own interactivity. This adds the
 * comment box on demand: Cmd+J (Ctrl+J elsewhere) or the small chip at the end of a
 * selection, for the block around it; on pages built from [data-edit-id] sections,
 * also a hover chip near the unit, a click on bare section padding, and the fixed
 * bottom-right bubble for the whole document.
 *
 * The request leaves as a named helper request on the wire
 * (`clay.wire.send(payload, { helper: "ai-edit" })`) and comes back as the edited
 * element's own HTML. A named request defaults to `document: "none"`, so the host
 * writes nothing: this page morphs the result in and Keep saves it through
 * `clay.save()`, exactly as before.
 *
 * Dormant unless the host lists an `ai-edit` helper: then nothing is built and the
 * page is just a page. Listed as unavailable (the host's toggle is off), the
 * shortcut opens the panel with a note and no Send, and the state is checked again
 * each time the panel opens.
 *
 * The bus version previewed the reply as it streamed. The wire carries status lines
 * only — replaceable progress, capped and droppable — so the page shows throttled
 * status lines ("Writing, 1.8 KB") and then the result once, with Keep/Revert as
 * before. `@page` reads the saved file from disk rather than a copy in the payload:
 * the plugin saves first and then sends `{ page: true }`, because a whole page never
 * fits the envelope.
 *
 * The comment box is compose only: a click anywhere outside it closes it, keeping the
 * text as a draft for that target, and Send moves the whole live state to one compact
 * bar at the bottom of the viewport. The bar carries the host's progress and Stop, the
 * reply's warnings and Keep/Revert, and then the save, so no part of a running edit
 * depends on a popover the person may want out of the way.
 *
 * Undo integration: observers pause at request start. On Keep the element is rewound
 * to the snapshot while still paused, observers resume, then one final morph lands
 * the whole AI edit as a single undoable step. On Revert the rewind happens under
 * pause, so history never sees the edit at all.
 *
 * All injected chrome is runtime-only (`no-save no-watch no-snapshot`): never saved,
 * invisible to the mutation system (its status text changes constantly), absent from
 * every snapshot and from what peers receive.
 */
import { HyperMorph } from "../vendor/hyper-morph.vendor.js";
import { mergeTagRecognizers } from "../sync/merge-tags.js";
import Mutation from "../lib/mutation.js";
import { isEditMode } from "../core/is-edit-mode.js";
import { holdAllSaves, releaseAllSaves } from "../core/save.js";
import { STRIP_FROM_SAVE, SNAPSHOT_REMOVE_SELECTOR } from "../lib/region-policy.js";
import { enableContentEditable } from "../core/admin-contenteditable.js";
import onDomReady from "../lib/dom-ready.js";
import wire from "./wire.js";
import { set } from "../lib/hostile-css.js";
import { bevelBox, bevelButton, bevelSurface, bevelText, bevelInput, bevelIconButton, pageScheme, setShown, RUNTIME_ONLY } from "../ui/bevel-controls.js";
import { TOKENS, GLYPHS, FONT_SANS, FONT_MONO, SHADOW } from "../ui/bevel.js";

const HELPER = "ai-edit";
const UNIT_SELECTOR = "h1,h2,h3,h4,h5,h6,p,figure";
// Outside [data-edit-id] sections: the nearest text block that holds the whole
// selection, else the nearest container that does. A selection across top-level blocks
// edits the whole page.
const BLOCK_SELECTOR = "p,h1,h2,h3,h4,h5,h6,li,dt,dd,blockquote,pre,figcaption,td,th";
const CONTAINER_SELECTOR = "section,article,aside,header,footer,nav,main,div,ul,ol,dl,table,figure,form";
const NOT_TEXT = "script,style,template,textarea,input,select,button,iframe,svg,math";
// The request ceiling, kept below the host's 1 MiB envelope so the refusal happens
// here, where the message can say what to do about it.
const MAX_PAYLOAD_BYTES = 900 * 1024;
const TOO_LARGE = "This section is too large for AI editing; select a smaller part.";
const SAVE_FAILED = "The save did not finish; the edit is still on the page.";

let requestCounter = 0;
let session = null; // one edit at a time
let panel, ring, textarea, statusEl, pointer, chip, docBubble;
let bar, barStatus, barStop, barKeep, barRevert, barClose;
let buttons = {};
// A visible bar is chrome in its own right, so its mode is tracked explicitly rather
// than inferred from the session: Error and Saving outlive the session.
let barMode = null;  // "working", "ready", "saving" or "error"
// One request's whole life on the bar, Working through Ready or Error to Saving. A save
// continuation or a close timer from an older lifecycle must never touch a newer bar.
let barLifecycle = null;
let barCloseTimer = null;
let panelPointerDown = false; // the last pointerdown began in the panel: its click is not a page click
const drafts = new WeakMap();  // compose text a target keeps while the panel is shut
let anchorEl = null;    // element the panel is currently anchored to
let chipTarget = null;  // unit the hover chip currently points at
let chipHideTimer = null;
let pendingSelection; // { text, start, end } for the open panel, or undefined

let chipSelection;       // the selection the chip was raised for; undefined for the hover chip
let selectionTimer = null;
let anchorRange = null;  // the selection the open panel was raised for
let returnFocus = null;  // where focus goes back to when the panel closes
let helperState = null;  // "ready" or "unavailable"

const HIGHLIGHT = 'clay-ai-edit';
const OFF_MESSAGE = 'AI editing is turned off. Turn it on from the app’s menu.';

// ---------------------------------------------------------------- transport

// The helper's state as this host lists it: "ready", "unavailable" (listed, but the
// host's toggle is off), or null when there is no ai-edit helper to talk to.
async function helperStateNow() {
  const list = await wire.helpers();
  const helper = list.find(h => h.name === HELPER);
  return helper && (helper.state === 'ready' || helper.state === 'unavailable') ? helper.state : null;
}

// ---------------------------------------------------------------- observers (undo/autosave)

function pauseObservers() {
  Mutation.pause();
}

function resumeObservers() {
  Mutation.resume();
}

// ---------------------------------------------------------------- units

// The editable unit for an interaction: nearest heading/paragraph/figure inside a
// [data-edit-id] section, else the section itself.
function unitFrom(target) {
  if (!(target instanceof Element)) return null;
  const section = target.closest('[data-edit-id]');
  if (!section) return null;
  const unit = target.closest(UNIT_SELECTOR);
  return unit && section.contains(unit) ? unit : section;
}

function editLabel(el) {
  if (el === document.body) return 'document';
  const own = el.getAttribute('data-edit-id');
  if (own) return own;
  const section = el.closest('[data-edit-id]');
  if (!section) return el.id ? '#' + el.id : el.tagName.toLowerCase();
  return section.getAttribute('data-edit-id') + ' \u203a ' + el.tagName.toLowerCase();
}

function liveRange() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  return selection.getRangeAt(0);
}

// The element a selection edits. Section pages keep their unit rules; everywhere
// else it is the block around the whole selection, so a backward selection and a
// forward one land on the same element.
function targetFromRange(range) {
  let node = range.commonAncestorContainer;
  if (node.nodeType !== 1) node = node.parentElement;
  if (!node || !document.body.contains(node)) return null;
  // A selection across top-level blocks has only the page around it.
  if (node === document.body) return document.body;
  if (node.closest('[data-clay-ai-edit]') || node.closest(STRIP_FROM_SAVE) || node.closest(NOT_TEXT)) return null;
  if (node.closest('[data-edit-id]')) return unitFrom(node);
  const target = node.closest(BLOCK_SELECTOR) || node.closest(CONTAINER_SELECTOR);
  return target && target !== document.body ? target : null;
}

// The selected text, whole, with its character offsets inside the target's text,
// so a phrase that appears twice is unambiguous.
function selectionIn(range, target) {
  if (!range || !target || !target.contains(range.commonAncestorContainer)) return undefined;
  const text = range.toString();
  if (!text.trim()) return undefined;
  const before = document.createRange();
  before.selectNodeContents(target);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  return { text, start, end: start + text.length };
}

function quoteFromSelection(scope) {
  const range = liveRange();
  if (!range) return undefined;
  if (scope === document.body) {
    const text = range.toString();
    return text.trim() ? { text, start: undefined, end: undefined } : undefined;
  }
  return selectionIn(range, scope);
}

function strippedBodyHTML() {
  const clone = document.body.cloneNode(true);
  clone.querySelectorAll(STRIP_FROM_SAVE).forEach(node => node.remove());
  return clone.outerHTML;
}

// ---------------------------------------------------------------- morphing

function morphTo(el, content, scripts) {
  return HyperMorph.morph(el, content, { morphStyle: 'outerHTML', restoreFocus: true, scripts });
}

// Session-aware morph. Document mode morphs the whole body but vetoes removal of the
// chrome this plugin injected (the model never saw it, so a plain morph would delete
// the panel mid-flight). Either way, re-run the contenteditable pass afterwards: a
// reply may drop the runtime attribute.
// Forward morphs three-way merge mergeable script tags ([merge] + rules tags)
// against the snapshot the model saw, so data the user changed mid-flight survives
// the reply. Rewinds must restore the snapshot exactly, so they disable merging.
function sessionMorph(s, content, { rewind = false } = {}) {
  // handle:false: a reply's scripts never run, so the preview cannot execute code
  // before Keep, and neither can a rewind.
  const scripts = rewind
    ? { merge: false, handle: false }
    : { mergeBase: s.snapshot, mergeTags: mergeTagRecognizers, handle: false };
  if (s.docMode) {
    if (typeof content === 'string') {
      // Parse to an element ourselves: hyper-morph parses a body string into a
      // full document and would insert DOMParser's synthesized empty <head>
      // alongside the morphed body. An element gets sibling-free treatment.
      content = new DOMParser().parseFromString(content, 'text/html').body;
    }
    HyperMorph.morph(document.body, content, {
      morphStyle: 'outerHTML',
      restoreFocus: true,
      scripts,
      callbacks: {
        beforeNodeRemoved: node => !(node.nodeType === 1 && node.matches(STRIP_FROM_SAVE))
      }
    });
  } else {
    morphTo(s.el, content, scripts);
  }
  enableContentEditable();
}

// Extract a morphable single-root candidate from a (possibly partial, possibly
// fenced) reply. Returns an inert element or null. Template parsing auto-closes
// half-open tags and never executes scripts — but silently strips <body> tags, so a
// body candidate parses via DOMParser (equally inert).
function candidateFrom(html, tag) {
  const start = html.search(new RegExp('<' + tag + '(\\s|>)', 'i'));
  if (start === -1) return null;
  const cleaned = html.slice(start).replace(/\s*`{1,3}\s*$/, '');
  if (tag.toLowerCase() === 'body') {
    return new DOMParser().parseFromString(cleaned, 'text/html').body;
  }
  const template = document.createElement('template');
  template.innerHTML = cleaned;
  const candidate = template.content.firstElementChild;
  if (!candidate || candidate.tagName.toLowerCase() !== tag.toLowerCase()) return null;
  return candidate;
}

// ---------------------------------------------------------------- session lifecycle

function newSession(el, comment, quote) {
  const docMode = el === document.body;
  // Context refs are @tokens containing a dot or slash (@notes.md, @src/x.js). Bare
  // @words are not refs: a leading one is an engine token (@fable, @codex — routed
  // helper-side), and mid-text ones are prose.
  // The @ has to start a word, so an email address or a URL is prose too.
  const contextRefs = [...comment.matchAll(/(?<![\w\u00C0-\u024F.@\/:-])@([\w.-]*[/.][\w./-]*)/g)]
    .map(m => m[1].replace(/\.+$/, '')) // a sentence's full stop is not part of the name
    .filter(ref => ref !== 'page')
    .filter(ref => /[/.]/.test(ref));
  const elementHTML = docMode ? strippedBodyHTML() : el.outerHTML;
  const payload = {
    id: 'req-' + Date.now().toString(36) + '-' + (++requestCounter),
    editId: editLabel(el),
    tag: el.tagName.toLowerCase(),
    elementHTML,
    comment,
    contextRefs
  };
  if (quote) {
    payload.quote = quote.text;
    if (Number.isInteger(quote.start)) payload.selection = { start: quote.start, end: quote.end };
  }
  // Document mode reads the live page itself, and every other @page request reads
  // the file from disk: the plugin saves first, then asks for it by flag.
  if (!docMode && /(?<![\w\u00C0-\u024F.@\/:-])@page(?![\w\/-]|\.\w)/.test(comment)) payload.page = true;
  return {
    id: payload.id,
    el,
    docMode,
    tag: payload.tag,
    reassertId: docMode ? null : el.getAttribute('data-edit-id'),
    snapshot: elementHTML,
    payload,
    state: 'requesting',
    paused: false,
    handle: null,
    finalCandidate: null
  };
}

async function sendRequest(el, comment, quote) {
  session = newSession(el, comment, quote);
  // Refused here, before anything is sent or paused: the envelope would refuse it
  // anyway, and a refusal the page cannot explain is worse than one it can.
  if (new Blob([JSON.stringify(session.payload)]).size > MAX_PAYLOAD_BYTES) {
    // Not a Send: the box stays open with its text, draft included.
    session = null;
    setStatus(TOO_LARGE, 'warn');
    return;
  }
  // The sent comment is this target's draft until the reply is ready: Error, Stop, a
  // refused reply, a morph failure and a host cancellation all leave it in place.
  drafts.set(el, comment);
  closePanelForSend();
  session.paused = true;
  pauseObservers();
  barLifecycle = {};
  showBar('working');
  setBarStatus('Sending\u2026');
  // @page reads the file the host has on disk, so the page has to be on disk first.
  if (session.payload.page) await window.clay.save();
  if (!session) return; // cancelled while saving
  // The host owns the deadline; this side only renders. A named request defaults to
  // `document: "none"`, so nothing here asks anyone to write the file.
  // Only the live session's statuses land: a line from a request the user already
  // cancelled or replaced must not repaint the bar.
  const handle = wire.send(session.payload, {
    helper: HELPER,
    onStatus: ({ text }) => { if (session?.handle === handle) setBarStatus(text); }
  });
  session.handle = handle;
  const outcome = await handle.done;
  if (!session || session.handle !== handle) return;
  if (outcome.state === 'done') onDone(outcome.result || {});
  else if (outcome.state === 'cancelled') onError('HTML Clay stopped this edit.');
  else onError(outcome.error || 'the helper reported an error');
}

// What a reply may not add: anything that runs code. Each part is counted, and the
// reply is refused when it holds more of any part than the element the model was
// given, so a page's own scripts and handlers are not a reason to refuse an edit
// near them, while a copied handler or a changed script is.
const ACTIVE_ATTR = /^(on|hx-on|x-|@|:|v-on:|v-bind:|data-on[-:])/;
const ACTIVE_TAGS = new Set(['iframe', 'frame', 'object', 'embed', 'base', 'link']);

// URL parsing removes tab, CR and LF anywhere and controls and spaces at the start,
// so "java&#9;script:" is still a javascript: URL.
function isScriptURL(value) {
  const url = value.replace(/[\t\n\r]/g, '').replace(/^[\u0000- ]+/, '').toLowerCase();
  return url.startsWith('javascript:') || url.startsWith('vbscript:');
}

// A script whose type the browser does not run (JSON, a template) is data.
function runsAsCode(script) {
  const type = (script.getAttribute('type') || '').trim().toLowerCase();
  return !type || /javascript|ecmascript/.test(type) || ['module', 'importmap', 'speculationrules'].includes(type);
}

function attrsOf(el) {
  return [...el.attributes].map(a => a.name.toLowerCase() + '=' + a.value).sort().join(' ');
}

function activeParts(root) {
  const parts = new Map();
  const add = (part) => parts.set(part, (parts.get(part) || 0) + 1);
  for (const el of [root, ...root.querySelectorAll('*')]) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'script') {
      if (runsAsCode(el)) add('script ' + attrsOf(el) + '|' + el.textContent.trim());
    } else if (ACTIVE_TAGS.has(tag) || (tag === 'meta' && el.hasAttribute('http-equiv'))) {
      add(tag + ' ' + attrsOf(el));
    } else if ((tag === 'animate' || tag === 'set') && /href/i.test(el.getAttribute('attributeName') || '')) {
      add(tag + ' ' + attrsOf(el));
    }
    for (const attr of el.attributes) {
      const name = attr.name.toLowerCase();
      if (ACTIVE_ATTR.test(name)) add(tag + ' ' + name + '=' + attr.value.trim());
      else if (name === 'srcdoc') add(tag + ' srcdoc=' + attr.value);
      else if (isScriptURL(attr.value)) add(tag + ' ' + name + '=' + attr.value);
    }
  }
  return parts;
}

function addsActiveContent(candidate, snapshot, docMode) {
  const original = docMode
    ? new DOMParser().parseFromString(snapshot, 'text/html').body
    : (() => { const t = document.createElement('template'); t.innerHTML = snapshot; return t.content.firstElementChild; })();
  const before = original ? activeParts(original) : new Map();
  for (const [part, count] of activeParts(candidate)) if (count > (before.get(part) || 0)) return true;
  return false;
}

const ACTIVE_REFUSED = 'The reply adds a script or event handler, so it was not applied. AI editing changes content, not code.';

function onDone(payload) {
  if (!session || session.state !== 'requesting') return;
  session.state = 'deciding';

  const warnings = [];
  let candidate = candidateFrom(payload.html || '', session.tag);
  if (!candidate) {
    onError(`reply is not a single <${session.tag}> element`);
    return;
  }
  if (!session.docMode) { // template parsing strips <body>, making this check meaningless there
    const template = document.createElement('template');
    template.innerHTML = payload.html || '';
    if (template.content.children.length > 1) {
      warnings.push('reply had extra root elements \u2014 kept the first');
    }
  }
  if (session.reassertId) candidate.setAttribute('data-edit-id', session.reassertId);
  if (addsActiveContent(candidate, session.snapshot, session.docMode)) {
    onError(ACTIVE_REFUSED);
    return;
  }

  holdAllSaves();
  session.held = true;

  session.finalCandidate = candidate;
  try {
    sessionMorph(session, candidate); // authoritative morph from the full final HTML
  } catch (error) {
    onError('the reply could not be applied: ' + (error?.message || error));
    return;
  }
  positionChrome();
  drafts.delete(session.el); // delivered: the comment is no longer this target's draft
  showBar('ready');
  setBarStatus(readyText(warnings, payload.model), warnings.length ? 'warn' : '');
}

// The reply's own caveats ride with the invitation to keep it, and the model that
// wrote it is named when the host said which one it was.
function readyText(warnings, model) {
  const parts = ['Edit ready.', ...warnings.map(w => '\u26a0 ' + w)];
  if (model) parts.push(`(${model})`);
  return parts.join(' ');
}

function onError(message) {
  if (!session) return;
  revertSession();
  showBar('error');
  setBarStatus(message, 'warn');
}

// Rewind to the pre-edit snapshot and release observers. The paused rewind means
// undo history never sees the abandoned edit.
function revertSession() {
  const s = session;
  session = null;
  if (!s) return;
  try {
    if (s.state === 'requesting' || s.state === 'deciding') {
      sessionMorph(s, s.snapshot, { rewind: true });
    }
  } finally {
    if (s.paused) resumeObservers();
    if (s.held) releaseAllSaves();
    positionChrome();
  }
}

async function keepSession() {
  const s = session;
  if (!s) return;
  session = null;
  // What is on screen is what Keep keeps: the preview may have been edited by hand.
  const liveResult = s.docMode ? strippedBodyHTML() : s.el.outerHTML;
  try {
    sessionMorph(s, s.snapshot, { rewind: true }); // rewind while observers are still paused
  } finally {
    if (s.paused) resumeObservers();    // boundary drain discards the rewind
    if (s.held) releaseAllSaves({ replay: false });
  }
  sessionMorph(s, liveResult);  // recorded: the whole edit = one undo step
  positionChrome();
  showBar('saving');
  setBarStatus('Saving\u2026');
  const lifecycle = barLifecycle;
  const result = await window.clay.save();
  // An older lifecycle's save answers an older bar, and has nothing to say to this one.
  if (lifecycle !== barLifecycle) return;
  if (result && result.ok === false) {
    showBar('error'); // a failed or conflicting save stays on screen until it is dismissed
    setBarStatus(result.msg || SAVE_FAILED, 'warn');
    return;
  }
  setBarStatus((result && result.msg) || 'Saved', result && result.msgType === 'error' ? 'warn' : '');
  scheduleBarClose();
}

// Stop is live from the moment the request starts, which includes the window where an
// @page save is still in flight and there is no handle yet. Nothing is left on screen:
// the edit is rewound and the bar goes with it.
function stopSession() {
  session?.handle?.cancel();
  revertSession();
  closeBar();
}

// ---------------------------------------------------------------- chrome

// Everything below is drawn on somebody else's page, so it follows the hostile-CSS
// contract: runtime-only, no ids or classes, every declaration inline and !important
// from all:initial, in Bevel material from the generated subset. Show and hide go
// through setShown and positions through set(), both !important, so no page rule can
// reveal a hidden part or move a placed one.
const FLOATING = ['z-index:99999', 'padding:0', 'display:inline-grid', 'place-items:center', 'line-height:1', `box-shadow:${SHADOW}`];

function marked(el, name, value) {
  el.setAttribute(name, value);
  return el;
}

function buildChrome() {
  const style = document.createElement('style');
  style.setAttribute('clay', RUNTIME_ONLY);
  style.textContent = `
    [editmode\\:contenteditable][contenteditable]:focus {
      outline: 1px solid #4a4a6a; outline-offset: 4px; border-radius: 2px;
    }
    ::highlight(clay-ai-edit) { background-color: ${TOKENS['brass-soft']} !important; }
  `;
  document.head.appendChild(style);

  const scheme = `color-scheme:${pageScheme()}`;

  ring = marked(bevelBox('div', [
    'box-sizing:content-box', 'position:fixed', 'z-index:99998', 'pointer-events:none',
    `border:2px solid ${TOKENS.brass}`, 'border-radius:0', scheme,
  ]), 'data-clay-ai-edit', 'ring');
  setShown(ring, false);

  panel = marked(bevelSurface('div', [
    'position:fixed', 'z-index:99999', 'width:min(28rem, calc(100vw - 32px))',
    'padding:12px', 'border-radius:12px', `box-shadow:${SHADOW}`, `font:13px/1.5 ${FONT_SANS}`, scheme,
  ]), 'data-clay-ai-edit', 'panel');
  setShown(panel, false);
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'AI edit');

  const part = (el, name) => marked(el, 'data-clay-ai-edit-part', name);

  // The notch on the panel's edge that points at the selected words.
  pointer = part(bevelBox('div', [
    'position:absolute', 'width:12px', 'height:12px', 'pointer-events:none',
    `background:${TOKENS.surface}`, `border-left:1px solid ${TOKENS['line-2']}`, `border-top:1px solid ${TOKENS['line-2']}`,
  ]), 'pointer');
  setShown(pointer, false);

  textarea = part(bevelInput('textarea', {
    rules: ['flex:1', 'min-width:0', 'min-height:40px', 'max-height:9.5em', 'resize:none', 'overflow-y:auto',
      'padding:8px 12px', `font:15px/1.45 ${FONT_SANS}`],
  }), 'input');
  textarea.rows = 1;
  textarea.placeholder = 'Describe the change';
  textarea.setAttribute('aria-label', 'Describe the change');
  textarea.title = 'Enter sends · Shift+Enter adds a line · @fable or @codex picks another agent · @file.ext adds context';

  statusEl = part(bevelText('div', [
    'display:block', 'margin-top:0', `color:${TOKENS.muted}`, `font:12.5px/1.5 ${FONT_MONO}`,
  ]), 'status');
  statusEl.setAttribute('role', 'status');
  statusEl.setAttribute('aria-live', 'polite');

  buttons.send = part(bevelButton('Send', { variant: 'primary', extra: ['min-height:40px', 'flex:none'] }), 'send');
  setShown(buttons.send, true, 'inline-flex');

  const row = bevelBox('div', ['display:flex', 'align-items:flex-start', 'gap:8px']);
  row.append(textarea, buttons.send);

  panel.append(pointer, row, statusEl);

  // One line, bottom centre, never wider than the viewport it is centred in: the live
  // state of an edit that no longer has a popover. The text takes what the controls
  // leave and ellipsises there, so a long host line cannot push a button off a 375px
  // screen; its full wording stays in the DOM and in the accessible name.
  bar = marked(bevelSurface('div', [
    'position:fixed', 'left:50%', 'bottom:16px', 'transform:translateX(-50%)',
    'z-index:99999', 'width:min(35rem, calc(100vw - 32px))',
    'padding:8px 10px', 'border-radius:12px', 'gap:8px', 'align-items:center',
    `box-shadow:${SHADOW}`, `font:13px/1.5 ${FONT_SANS}`, scheme,
  ]), 'data-clay-ai-edit', 'status-bar');
  setShown(bar, false, 'flex');

  barStatus = part(bevelText('div', [
    'display:block', 'flex:1', 'min-width:0', 'overflow:hidden', 'text-overflow:ellipsis',
    'white-space:nowrap', `color:${TOKENS.muted}`, `font:12.5px/1.5 ${FONT_MONO}`,
  ]), 'bar-status');
  barStatus.setAttribute('role', 'status');
  barStatus.setAttribute('aria-live', 'polite');

  barStop = part(bevelButton('Stop', { extra: ['flex:none'] }), 'bar-stop');
  barKeep = part(bevelButton('Keep', { variant: 'primary', extra: ['flex:none'] }), 'bar-keep');
  barRevert = part(bevelButton('Revert', { variant: 'quiet', extra: ['flex:none'] }), 'bar-revert');
  barClose = part(bevelIconButton(GLYPHS.toastClose, { label: 'Dismiss error' }), 'bar-close');
  barClose.pin({ flex: 'none' });
  for (const control of [barStop, barKeep, barRevert, barClose]) setShown(control, false, 'inline-flex');
  bar.append(barStatus, barStop, barKeep, barRevert, barClose);

  chip = marked(bevelButton('AI', {
    small: true,
    extra: ['position:fixed', 'width:26px', 'height:26px', `font:600 11px/1 ${FONT_SANS}`, ...FLOATING, scheme],
  }), 'data-clay-ai-edit', 'chip');
  chip.title = 'Comment on this (\u2318J)';
  setShown(chip, false, 'inline-grid');

  docBubble = marked(bevelButton('AI', {
    extra: ['position:fixed', 'width:40px', 'height:40px', `font:600 14px/1 ${FONT_SANS}`, ...FLOATING, scheme],
  }), 'data-clay-ai-edit', 'bubble');
  docBubble.title = 'Comment on the whole page';
  placeBubble();

  document.body.append(ring, panel, bar, chip, docBubble);
  syncBubble();

  buttons.send.addEventListener('click', submit);
  barStop.addEventListener('click', stopSession);
  barKeep.addEventListener('click', keepSession);
  barRevert.addEventListener('click', () => { revertSession(); closeBar(); });
  barClose.addEventListener('click', () => { if (barMode === 'error') closeBar(); });
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!buttons.send.hidden) submit();
    }
  });

  // One line to start, growing with the request up to the max-height.
  textarea.addEventListener('input', fitTextarea);

  chip.addEventListener('mousedown', (event) => event.preventDefault()); // keeps the page's selection alive
  chip.addEventListener('click', () => {
    const target = chipTarget;
    const selection = chipSelection;
    hideChip();
    if (target && !session && !barMode) openPanel(target, selection || quoteFromSelection(target));
  });
  docBubble.addEventListener('click', () => {
    if (session || barMode) return;
    // Like a click outside, a second click keeps a typed comment: it closes an empty panel only.
    if (!panel.hidden && anchorEl === document.body) {
      if (textarea.value.trim()) textarea.focus();
      else closePanel();
      return;
    }
    openPanel(document.body, quoteFromSelection(document.body));
  });

  window.addEventListener('scroll', () => { positionChrome(); hideChip(); }, { passive: true });
  window.addEventListener('resize', () => { placeBubble(); if (panel && !panel.hidden) fitTextarea(); positionChrome(); }, { passive: true });
  // The CMS toggle can arrive after this chrome, and a docked sidebar slides it left.
  const replace = () => { placeBubble(); positionChrome(); };
  document.addEventListener('hcms:open', () => { replace(); setTimeout(replace, 350); });
  document.addEventListener('hcms:close', () => { replace(); setTimeout(replace, 350); });
  new MutationObserver((records) => {
    syncBubble();
    const touched = (nodes) => [...nodes].some((n) => n.nodeType === 1 && n.hasAttribute('data-hcms-toggle-host'));
    if (records.some((r) => touched(r.addedNodes) || touched(r.removedNodes))) replace();
  }).observe(document.body, { childList: true });

  // A target removed from the page ends its edit, so the save hold and the paused
  // observers never outlive it. A running bar is no exception: it is torn down with
  // the target it was describing.
  new MutationObserver(() => {
    if (anchorEl && !anchorEl.isConnected) abandonTarget();
  }).observe(document.body, { childList: true, subtree: true });
}

// The panel's height changes as the box grows and the status line fills, so it is
// placed again after each change.
function placePanelAgain() {
  if (anchorEl?.isConnected) positionChrome();
}

function fitTextarea() {
  set(textarea, 'height', 'auto');
  if (textarea.value) set(textarea, 'height', textarea.scrollHeight + 2 + 'px');
  placePanelAgain();
}

// The whole-page bubble belongs to pages built from [data-edit-id] sections, and it
// stands down while the bar holds the screen. A plain page gets the selection chip and
// the shortcut instead.
function syncBubble() {
  const doc = docBubble?.ownerDocument;
  if (!doc) return;
  const wanted = !barMode && helperState === 'ready' && !!doc.querySelector('[data-edit-id]');
  setShown(docBubble, wanted, 'inline-grid');
}

// The selected words stay marked while the person types, through the CSS Custom
// Highlight API, so the page's DOM never changes.
function highlight(range) {
  if (!range || typeof window.Highlight !== 'function' || !window.CSS?.highlights) return;
  window.CSS.highlights.set(HIGHLIGHT, new window.Highlight(range));
}

function clearHighlight() {
  window.CSS?.highlights?.delete(HIGHLIGHT);
}

function applyHelperState() {
  const on = helperState === 'ready';
  textarea.disabled = !on;
  if (on) {
    if (statusEl.textContent === OFF_MESSAGE) setStatus('');
  } else {
    setStatus(OFF_MESSAGE, 'warn');
  }
  setShown(buttons.send, on, 'inline-flex');
  syncBubble();
}

// The host's toggle can change while the page is open, so each opening asks again.
function refreshHelperState() {
  helperStateNow().then((state) => {
    helperState = state || 'unavailable';
    if (!panel.hidden && !session) applyHelperState();
    else syncBubble();
  }).catch(() => {});
}

// The bubble sits in the bottom-right corner, or just left of the CMS's "Edit content"
// toggle when the page has one, bottoms aligned, so the two never overlap.
function placeBubble() {
  if (!docBubble) return;
  const host = document.querySelector('[data-hcms-toggle-host]');
  const rect = host && host.getBoundingClientRect();
  const beside = !!rect && rect.width > 0 && rect.height > 0;
  docBubble.pin({
    right: beside ? `${Math.round((document.documentElement.clientWidth || window.innerWidth) - rect.left + 8)}px` : '16px',
    bottom: beside ? `${Math.round((document.documentElement.clientHeight || window.innerHeight) - rect.bottom)}px` : '16px',
  });
}

// ---------------------------------------------------------------- hover chip

function showChipFor(unit) {
  clearTimeout(chipHideTimer);
  chipHideTimer = null;
  chipTarget = unit;
  chipSelection = undefined;
  const rect = unit.getBoundingClientRect();
  chip.pin({
    left: Math.min(rect.right + 8, window.innerWidth - 34) + 'px',
    top: Math.max(8, rect.top) + 'px',
    'color-scheme': pageScheme(),
  });
  setShown(chip, true, 'inline-grid');
}

function hideChip() {
  clearTimeout(chipHideTimer);
  chipHideTimer = null;
  setShown(chip, false, 'inline-grid');
  chipTarget = null;
  chipSelection = undefined;
}

function scheduleChipHide() {
  if (chip.hidden || chipHideTimer) return;
  chipHideTimer = setTimeout(hideChip, 400);
}

// The chip at the end of a selection: for people who do not know the shortcut, and
// for browsers that keep Ctrl+J for themselves.
function showChipForSelection() {
  if (session || barMode || !panel.hidden || helperState !== 'ready' || pageOwnsFocus()) return;
  const range = liveRange();
  const target = range && targetFromRange(range);
  const selection = target && selectionIn(range, target);
  if (!selection) {
    if (chipSelection) hideChip();
    return;
  }
  const rects = typeof range.getClientRects === 'function' ? range.getClientRects() : [];
  const end = rects.length ? rects[rects.length - 1] : target.getBoundingClientRect();
  clearTimeout(chipHideTimer);
  chipHideTimer = null;
  chipTarget = target;
  chipSelection = selection;
  chip.pin({
    left: Math.min(end.right + 6, window.innerWidth - 34) + 'px',
    top: Math.max(8, end.top + end.height / 2 - 13) + 'px',
    'color-scheme': pageScheme(),
  });
  setShown(chip, true, 'inline-grid');
}

// Compose-only messages: the host's switch being off and a request too large to send
// both belong to the box the person is typing in, because the box stays open for them.
function setStatus(text, tone) {
  set(statusEl, 'margin-top', text ? '8px' : '0');
  statusEl.textContent = text || '';
  if (tone === 'warn') statusEl.setAttribute('data-tone', 'warn');
  else statusEl.removeAttribute('data-tone');
  set(statusEl, 'color', tone === 'warn' ? TOKENS.ox : TOKENS.muted);
  placePanelAgain();
}

function setBarStatus(text, tone) {
  barStatus.textContent = text || '';
  if (tone === 'warn') barStatus.setAttribute('data-tone', 'warn');
  else barStatus.removeAttribute('data-tone');
  set(barStatus, 'color', tone === 'warn' ? TOKENS.ox : TOKENS.muted);
}

// One place decides what a bar state looks like, so the bubble and the ring can never
// disagree with it. A pending delayed close belongs to the state that scheduled it.
function showBar(mode) {
  clearTimeout(barCloseTimer);
  barCloseTimer = null;
  const wasOpen = !!barMode;
  const focused = document.activeElement;
  barMode = mode;
  const controls = {
    working: [barStop],
    ready: [barKeep, barRevert],
    error: [barClose],
    saving: [],
  }[mode] || [];
  const all = [barStop, barKeep, barRevert, barClose];
  for (const control of all) {
    setShown(control, controls.includes(control), 'inline-flex');
  }
  hideChip();
  set(bar, 'color-scheme', pageScheme());
  setShown(bar, true, 'flex');
  syncBubble();
  positionChrome();
  // The bar opens on the control that belongs to its state, and a state change moves
  // focus only when the button holding it has just gone away.
  const first = controls[0];
  if (first && (!wasOpen || (all.includes(focused) && !controls.includes(focused)))) {
    first.focus({ preventScroll: true });
  }
}

function scheduleBarClose() {
  clearTimeout(barCloseTimer);
  const lifecycle = barLifecycle;
  barCloseTimer = setTimeout(() => {
    if (lifecycle && lifecycle === barLifecycle) closeBar();
  }, 1500);
}

// The bar is over: the edit it described is finished, so the target goes with it.
function closeBar(lifecycle) {
  if (lifecycle !== undefined && lifecycle !== barLifecycle) return; // a stale teardown
  clearTimeout(barCloseTimer);
  barCloseTimer = null;
  barLifecycle = null;
  if (!panel.hidden) storeDraft(); // an open composer keeps its text through a teardown
  barMode = null;
  setShown(bar, false, 'flex');
  setBarStatus('');
  anchorEl = null;
  anchorRange = null;
  returnFocus = null;
  pendingSelection = undefined;
  clearHighlight();
  setShown(panel, false);
  textarea.value = '';
  setShown(ring, false);
  setShown(pointer, false);
  syncBubble();
}

// The ring follows the target while anything is on screen for it, which includes every
// bar mode; the panel is placed only while it is the thing on screen.
function positionChrome() {
  if (!anchorEl) return;
  if (!anchorEl.isConnected) { abandonTarget(); return; }
  if (anchorEl === document.body) {
    // document mode: no ring, panel pinned above the bubble
    setShown(ring, false);
    setShown(pointer, false);
    if (panel.hidden) return;
    const bubble = docBubble.getBoundingClientRect();
    const width = panel.offsetWidth || 480;
    set(panel, 'left', Math.max(16, Math.min((bubble.right || window.innerWidth - 16) - width, window.innerWidth - width - 16)) + 'px');
    set(panel, 'top', Math.max(16, (bubble.top || window.innerHeight - 56) - (panel.offsetHeight || 120) - 12) + 'px');
    return;
  }
  const rect = anchorEl.getBoundingClientRect();
  // With selected words the highlight marks them until Send; the ring is for a whole element and for a running edit.
  setShown(ring, !!barMode || !pendingSelection || !!session);
  set(ring, 'left', rect.left - 5 + 'px');
  set(ring, 'top', rect.top - 5 + 'px');
  set(ring, 'width', rect.width + 6 + 'px');
  set(ring, 'height', rect.height + 6 + 'px');
  if (panel.hidden) return;
  // Under the selection while it is still in the page, else under the element.
  const at = anchorRange && anchorRange.startContainer.isConnected && typeof anchorRange.getBoundingClientRect === 'function'
    ? anchorRange.getBoundingClientRect() : null;
  const place = at && (at.width || at.height) ? at : rect;
  const panelWidth = panel.offsetWidth || 480;
  const left = Math.max(16, Math.min(place.left, window.innerWidth - panelWidth - 16));
  let top = place.bottom + 10;
  const panelHeight = panel.offsetHeight || 120;
  if (top + panelHeight > window.innerHeight - 16) {
    top = Math.max(16, place.top - panelHeight - 10);
  }
  set(panel, 'left', left + 'px');
  set(panel, 'top', top + 'px');

  // The pointer sits above the start of the selection, on the top edge, or on the
  // bottom edge when the panel had to open above it.
  const below = top >= place.bottom;
  const tip = Math.max(14, Math.min(place.left + 10 - left, panelWidth - 28));
  setShown(pointer, true);
  set(pointer, 'left', tip + 'px');
  set(pointer, 'top', below ? '-7px' : (panelHeight - 6) + 'px');
  set(pointer, 'transform', below ? 'rotate(45deg)' : 'rotate(225deg)');
}

function openPanel(el, quote) {
  // A composer already open on another target hands its text over as that target's draft
  // before anything here replaces the target or the box.
  if (!panel.hidden && anchorEl && anchorEl !== el) storeDraft();
  const range = quote ? liveRange() : null; // read before focus moves into the panel
  const active = document.activeElement;
  returnFocus = active && active !== document.body && !panel.contains(active) ? active : null;
  anchorEl = el;
  anchorRange = range ? range.cloneRange() : null;
  hideChip();
  set(panel, 'color-scheme', pageScheme());
  set(ring, 'color-scheme', pageScheme());
  setShown(panel, true);
  pendingSelection = quote;
  const shown = quote ? (quote.text.trim().length > 400 ? quote.text.trim().slice(0, 400) + '\u2026' : quote.text.trim()) : '';
  panel.dataset.quote = shown;
  setStatus('');
  textarea.value = drafts.get(el) || '';
  highlight(anchorRange);
  applyHelperState();
  positionChrome();
  fitTextarea();
  textarea.focus();
  refreshHelperState();
}

// Typing that was not sent is not thrown away: it is the target's draft until the
// panel is opened on that target again.
function storeDraft() {
  if (!anchorEl) return;
  if (textarea.value) drafts.set(anchorEl, textarea.value);
  else drafts.delete(anchorEl);
}

function closePanel() {
  if (session) { session.handle?.cancel(); revertSession(); }
  const back = returnFocus;
  const hadFocus = panel.contains(document.activeElement);
  storeDraft();
  anchorEl = null;
  anchorRange = null;
  returnFocus = null;
  pendingSelection = undefined;
  clearHighlight();
  setShown(panel, false);
  setShown(ring, false);
  textarea.value = '';
  fitTextarea();
  if (hadFocus && back && back.isConnected) back.focus({ preventScroll: true });
}

// The send path closes the box without cancelling anything and without letting the
// target go: the request is now about that element, and the ring stays on it.
function closePanelForSend() {
  anchorRange = null;
  returnFocus = null;
  pendingSelection = undefined;
  clearHighlight();
  setShown(panel, false);
  textarea.value = '';
  fitTextarea();
  positionChrome();
}

// The target is gone from the page: whatever was live for it ends, and no observer,
// save hold or piece of chrome is left behind.
function abandonTarget() {
  const s = session;
  if (s) { s.handle?.cancel(); revertSession(); }
  closeBar();
}

function submit() {
  const comment = textarea.value.trim();
  if (!comment || !anchorEl || session || helperState !== 'ready') return;
  sendRequest(anchorEl, comment, pendingSelection);
}

// ---------------------------------------------------------------- interactions

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

// Cmd+J on a Mac, Ctrl+J elsewhere. event.code covers keyboard layouts where the
// J key types another letter.
function isShortcut(event) {
  const modifier = IS_MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!modifier || event.shiftKey || event.altKey || event.repeat || event.isComposing) return false;
  return event.code === 'KeyJ' || (event.key || '').toLowerCase() === 'j';
}

// A field the page owns keeps its own Ctrl+J, and so does the panel's own box.
function pageOwnsFocus() {
  const el = document.activeElement;
  if (!el || el === document.body) return false;
  if (panel && panel.contains(el)) return !panel.hidden;
  return el.matches('input,textarea,select');
}

// An Escape the page owns stays the page's: it was already handled, a modal is up, or the
// caret is in a field the page owns. Nothing this plugin drew counts as somebody else's.
const MODAL_SELECTOR = '[data-clay-modal], dialog[open], [aria-modal="true"]';
const PAGE_FIELD = 'input,textarea,select,[contenteditable=""],[contenteditable="true"]';

function escapeIsMine(event) {
  if (event.defaultPrevented) return false;
  if (document.querySelector(MODAL_SELECTOR)) return false;
  const el = document.activeElement;
  if (!el || el === document.body) return true;
  if (panel.contains(el) || bar.contains(el)) return true;
  if (el.isContentEditable === true) return false;
  return !el.matches(PAGE_FIELD);
}

function wireInteractions() {
  // Clicks: text units are contenteditable (caret) and figures keep their own
  // interactivity, so neither is intercepted, and nothing here prevents the click from
  // landing. Any click on the page away from ClayJS chrome closes the box, a click
  // inside the anchored element included: the caret goes where the person clicked and
  // what they had typed waits as that target's draft. Bare section padding still opens
  // the box, and clicking another section moves it there.
  // Where the pointer went down decides whose click this is: a drag that starts in the
  // box and ends on the page is still the box's, not a click away from it.
  document.addEventListener('pointerdown', (event) => {
    panelPointerDown = panel.contains(event.target);
  }, { capture: true });

  document.addEventListener('click', (event) => {
    const startedInPanel = panelPointerDown;
    panelPointerDown = false;
    if (startedInPanel) return;
    if (panel.contains(event.target) || bar.contains(event.target) || chip.contains(event.target) || docBubble.contains(event.target)) return;
    if (session || barMode) return; // one edit at a time, and the bar owns the screen
    const section = event.target.closest?.('[data-edit-id]');
    const unit = section ? unitFrom(event.target) : null;
    if (section && unit === section) {
      const same = !panel.hidden && section === anchorEl;
      if (!panel.hidden) closePanel();
      if (!same) openPanel(section, quoteFromSelection(section));
    } else if (!panel.hidden) {
      closePanel();
    }
  });

  // Hover chip: follows the unit under the cursor while no panel is open.
  let lastMove = 0;
  document.addEventListener('mousemove', (event) => {
    const now = Date.now();
    if (now - lastMove < 80) return;
    lastMove = now;
    if (session || barMode || !panel.hidden) { scheduleChipHide(); return; }
    if (helperState !== 'ready' || chipSelection) return;
    if (chip.contains(event.target)) { clearTimeout(chipHideTimer); chipHideTimer = null; return; }
    const unit = unitFrom(event.target);
    if (unit) showChipFor(unit);
    else scheduleChipHide();
  });

  document.addEventListener('keydown', (event) => {
    if (isShortcut(event)) {
      if (barMode || session || pageOwnsFocus()) return;
      if (anchorEl && !anchorEl.isConnected) closePanel();
      const range = liveRange();
      let target = range ? targetFromRange(range) : null;
      if (!target) {
        // Section pages: a caret inside a unit, or the unit under the hover chip.
        const selection = window.getSelection();
        let node = selection && selection.anchorNode;
        if (node && node.nodeType !== 1) node = node.parentElement;
        target = (node && unitFrom(node)) || chipTarget;
      }
      // Nothing to open: leave the key to the browser.
      if (!target) return;
      event.preventDefault();
      openPanel(target, quoteFromSelection(target));
      return;
    }
    if (event.key !== 'Escape') return;
    if (!escapeIsMine(event)) return;
    // The bar answers before the box: Working stops, Ready keeps (the edit is one undo
    // step, so keeping is the safe answer), Error and Saving have nothing to do.
    if (barMode === 'working') { stopSession(); return; }
    if (barMode === 'ready') { keepSession(); return; }
    if (barMode === 'error') { closeBar(); return; }
    if (barMode) return;
    if (!panel.hidden) closePanel();
  });

  document.addEventListener('selectionchange', () => {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(showChipForSelection, 150);
  });
}

// ---------------------------------------------------------------- boot

async function init() {
  if (!isEditMode || panel) return;  // an owner/editor feature, built once
  helperState = await helperStateNow();
  // No ai-edit helper on this host: stay dormant. A concurrent open() that got here
  // first may also have built the chrome already.
  if (!helperState || panel) return;
  buildChrome();
  wireInteractions();
}

// A target the composer can be opened on: a connected content element of this
// document. ClayJS chrome, transient UI, everything the save strips and everything
// that holds no text are not targets.
function canOpenTarget(el) {
  return el instanceof Element && el.ownerDocument === document &&
    document.body.contains(el) && !el.closest('[data-clay-ai-edit]') &&
    !el.closest(STRIP_FROM_SAVE) && !el.closest(SNAPSHOT_REMOVE_SELECTOR) && !el.closest(NOT_TEXT);
}

// `await clay.aiEdit.open(element, { prompt: 'Add a bar chart above the table. Keep the table.' })`
// opens the existing composer and returns true when opened, false when unavailable,
// busy or the target cannot be edited. It does not send automatically. The prompt
// seeds an empty per-target draft; previously typed text is preserved. The target
// must be a connected content element in this document. Controls and transient UI
// are not valid targets. A listed but disabled helper opens the existing setup
// explanation with Send unavailable, just like the keyboard shortcut.
async function open(el, { prompt } = {}) {
  if (!canOpenTarget(el)) return false;
  await init();
  // A click listener that calls this runs its microtasks before the same click reaches
  // the click-away handler, so the opening has to wait for that event to finish.
  await new Promise(resolve => setTimeout(resolve, 0));
  if (!panel || session || barMode || !canOpenTarget(el)) return false;
  if (!panel.hidden && anchorEl === el) {
    textarea.focus();
    return true;
  }
  if (typeof prompt === 'string' && !drafts.has(el)) drafts.set(el, prompt);
  openPanel(el, null);
  return true;
}

onDomReady(() => { init().catch(() => {}); });

export const aiEdit = { init, open };
