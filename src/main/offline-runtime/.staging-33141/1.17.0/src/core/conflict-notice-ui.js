import { isEditMode } from "./is-edit-mode.js";
import { rowOf, plain } from "./conflict-presentation.js";
import { downloadRecovery, downloadStored } from "./conflict-download.js";
import { pendingConflicts, listConflicts, dismissConflicts } from "../recovery/conflicts.js";
import { set, make } from "../lib/hostile-css.js";
import { isSaveConflicted } from "./save.js";
import { gateCaptureToken } from "../lib/dirty-gate.js";
import { reloadAfterDiscard } from "./unsaved-warning.js";
import { bevelButton, bevelIconButton, bevelSurface, bevelWell, bevelText, protectIcon, RUNTIME_ONLY } from "../ui/bevel-controls.js";
import { TOKENS, FONT_SANS, FONT_MONO, GLYPHS } from "../ui/bevel.js";

// One notice for everything this tab holds that the page no longer shows: edits
// another save replaced (the ledger, clay.conflicts) and a save the host refused.
// It never decides for the person. Minimize, Escape, a save, a reconnect or a later
// frame leave every loss where it is; only Accept theirs (or Writer's own merge)
// acknowledges one, and only the ids the panel actually drew.
//
// Ledger changes draw on the next frame, not at once: a listener that claims its
// own records inside clay:sync-applied (Writer) must get there before the first
// draw, or the bar flashes a count that is not the person's to deal with.

export const WARN = "light-dark(#D08A1E, #E3A33F)";
const ARM_MS = 5000;
const TOAST_MS = 4000;
const DOUBLE_PRESS_MS = 500;

// The host names what moved the file when it knows. Anything unrecognised falls
// back to the phrase that is true in every case.
const SOURCES = {
  "another-tab": "in another tab",
  "another-person": "by someone else",
  "an-agent": "by an agent",
};

const MINIMIZE_SVG = '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.5 9.5h7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square"/></svg>';

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

const BLOCKED_ROW = "This spot changed again. Review the latest edit or download your copy.";
const DATA_BLOCKED_ROW = "A data value can't be put back from here. Download your copy to keep yours.";

let view = "hidden";
let listOpen = false;
let renderedIds = [];
const seenIds = new Set();
const freshIds = new Set();
let refused = null;
let refusalGeneration = 0;
let upgraded = null;
let armed = null;
let armTimer = null;
let busy = null;
let keepFailed = false;
let downloaded = false;
let downloadFailed = false;
const blockedRows = new Map();
let ledgerRevision = 0;
let frameQueued = false;
let checkRefusal = false;
let toastText = null;
let toastTimer = null;
let pendingFocus = null;
let armedAt = 0;
let armLost = false;
let keepAttempt = 0;
let lastAnnounced = null;
let panelEl = null;
let recovered = [];
let recoveredUndo = [];
let actionFailed = false;
let copiedId = null;
let copiedTimer = null;

let root = null;
let wellEl = null;
let keyed = new Map();

const ledger = () => window.clay?.conflicts || null;
// Conflicts a reload took out of memory. Only the store has them now: a root as the
// bytes a save would have written, and the losing text as plain fields. There is no
// live node and no path worth replaying, so nothing here points at the page.
const storedCount = () => recovered.reduce((sum, record) => sum + record.conflicts.length, 0) + recoveredUndo.length;
// Keep what a refused undo or redo would have written, and what the page kept itself,
// are on the undo plugin's own channel. The panel asks the plugin, never the recovery
// module, so a boot with nothing kept downloads no recovery code beyond this notice.
const undoApi = () => {
  const api = window.clay?.undo;
  return api && typeof api.kept === "function" ? api : null;
};
const losses = () => ledger()?.list().filter((r) => !r.claimedBy && r.kind !== "apply-incomplete") ?? [];
const failures = () => ledger()?.list().filter((r) => !r.claimedBy && r.kind === "apply-incomplete") ?? [];

// A refused save goes first: saving is blocked until it is answered.
function mode() {
  // Nothing else is asked for once the document itself was upgraded: this tab holds
  // a version the host no longer stores, and the only way out is a reload.
  if (upgraded) return "upgraded";
  if (refused) return "refused";
  if (losses().length) return "replaced";
  if (failures().length) return "failed";
  if (recovered.length || recoveredUndo.length) return "recovered";
  return null;
}

function el(tag, rules, text) {
  const node = make(tag, rules, text);
  if (rules[0] === "all:initial") set(node, "color-scheme", "inherit");
  node.setAttribute("clay", RUNTIME_ONLY);
  return node;
}

function key(node, name) {
  keyed.set(name, node);
  return node;
}

function schemeOf() {
  const s = getComputedStyle(document.documentElement).colorScheme;
  return s === "light" || s === "dark" ? s : "light dark";
}

// A phone keyboard shrinks the visual viewport but leaves fixed elements pinned to
// the layout viewport, which parks a bottom-anchored bar behind the keyboard at the
// exact moment somebody is typing. Lift it by the difference instead.
function place() {
  if (!root) return;
  const vv = window.visualViewport;
  const lift = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
  set(root, "bottom", `calc(${16 + lift}px + env(safe-area-inset-bottom,0px))`);
  if (panelEl) set(panelEl, "max-height", `${Math.max(160, (vv?.height || window.innerHeight) - 32)}px`);
}

function build() {
  root = el("div", [
    "all:initial", "position:fixed", "left:50%", "transform:translateX(-50%)",
    "z-index:2147483001", "display:none", "flex-direction:column", "align-items:center",
    "max-width:calc(100vw - 24px)", `font:14px/1.5 ${FONT_SANS}`, `color:${TOKENS.ink}`,
    "text-align:left",
  ]);
  root.setAttribute("data-clay-conflict", "");
  document.body.appendChild(root);
  window.visualViewport?.addEventListener("resize", place);
  window.visualViewport?.addEventListener("scroll", place);
}

export function schedule() {
  if (frameQueued) return;
  frameQueued = true;
  const run = () => { frameQueued = false; render(); };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
  else setTimeout(run, 16);
}

function render() {
  if (checkRefusal) {
    checkRefusal = false;
    if (refused && !isSaveConflicted()) refused = null;
  }
  const m = mode();
  if (!m) {
    view = "hidden";
    listOpen = false;
    seenIds.clear();
    freshIds.clear();
    renderedIds = [];
    disarm();
    lastAnnounced = null;
    armLost = false;
  } else if (view === "hidden") {
    view = "bar";
  }
  if (!root) {
    if (view === "hidden" && !toastText) return;
    if (!document.body) return;
    build();
  }
  // A body replaced wholesale takes the root with it.
  if (!root.isConnected && document.body) document.body.appendChild(root);

  const active = document.activeElement;
  let focusKey = null;
  for (const [name, node] of keyed) if (node === active) focusKey = name;
  const scroll = wellEl ? wellEl.scrollTop : 0;
  keyed = new Map();
  wellEl = null;
  panelEl = null;
  root.replaceChildren();
  set(root, "color-scheme", schemeOf());

  if (toastText) {
    root.append(drawToast(toastText));
  } else if (view === "bar") {
    root.append(drawBar(m));
  } else if (view === "panel") {
    root.append(drawPanel(m));
  }
  set(root, "display", toastText || view !== "hidden" ? "flex" : "none");
  if (wellEl) wellEl.scrollTop = scroll;

  const want = pendingFocus || focusKey;
  if (want && keyed.has(want)) keyed.get(want).focus({ preventScroll: true });
  // A request for a control the toast is standing in for waits until the toast goes.
  if (!toastText) pendingFocus = null;
  place();
}

function dot() {
  return el("span", ["all:initial", "display:inline-block", "flex:none", "width:8px", "height:8px", "border-radius:50%", `background:${WARN}`]);
}

function refusedSource() {
  return SOURCES[refused?.changedBy] || null;
}

function barMessage(m, n) {
  if (m === "upgraded") return upgraded;
  if (m === "refused") {
    const named = refusedSource();
    if (!named && refused.afterTimeout) {
      return "This page changed elsewhere, possibly by your own save that timed out. Your edits here are safe.";
    }
    return `This page changed ${named || "elsewhere"}. Your edits here are safe.`;
  }
  if (m === "failed") return "A sync update did not finish. Your edits here are safe.";
  if (m === "recovered") return `${plural(n, "change")} replaced before this page loaded ${n === 1 ? "is" : "are"} still here.`;
  return `Another edit replaced ${plural(n, "change")}.`;
}

function titleOf(m, n) {
  if (m === "upgraded") return upgraded;
  if (m === "refused") return `This page changed ${refusedSource() || "elsewhere"}`;
  if (m === "failed") return "A sync update did not finish";
  if (m === "recovered") return `${plural(n, "change")} kept from before this page loaded`;
  return `Another edit replaced ${plural(n, "change")}`;
}

function drawToast(text) {
  const t = bevelSurface("div", ["display:block", `border-left:3px solid ${TOKENS.teal}`, "padding:10px 14px", "width:max-content", "max-width:calc(100vw - 24px)"]);
  t.setAttribute("role", "status");
  t.textContent = text;
  return t;
}

function drawBar(m) {
  const n = m === "failed" ? failures().length : m === "recovered" ? storedCount() : losses().length;
  const bar = bevelSurface("div", ["display:flex", "flex-wrap:wrap", "align-items:center", "gap:10px 12px", "padding:8px 8px 8px 14px", "width:max-content", "max-width:calc(100vw - 24px)"]);
  // A redraw rebuilds the bar; only a new message is announced again.
  const message = barMessage(m, n);
  if (message !== lastAnnounced) {
    bar.setAttribute("role", m === "refused" ? "alert" : "status");
    lastAnnounced = message;
  }
  bar.append(dot(), bevelText("span", [], message));
  if (m === "upgraded") {
    bar.append(key(bevelButton("Reload", { variant: "primary", onClick: () => window.location.reload() }), "reload"));
    return bar;
  }
  bar.append(key(bevelButton("Review", { onClick: openPanel }), "review"));
  return bar;
}

function action(label, name, { variant = "default", onClick, push = false } = {}) {
  const phone = window.innerWidth < 480;
  const extra = phone
    ? ["flex:1 1 100%", ...(variant === "primary" ? ["order:-1"] : [])]
    : (push ? ["margin-left:auto"] : []);
  return key(bevelButton(label, { variant, onClick, extra }), name);
}

function lede(text) {
  return bevelText("div", ["display:block", "padding:0 16px 12px", `color:${TOKENS["ink-2"]}`, "font-size:13.5px"], text);
}

function drawPanel(m) {
  const rows = m === "replaced" ? losses() : m === "failed" ? failures() : [];
  const held = m === "refused" ? losses() : rows;
  const count = m === "recovered" ? storedCount() : rows.length;
  if (seenIds.size) for (const r of rows) if (!seenIds.has(r.id)) freshIds.add(r.id);
  for (const id of [...freshIds]) if (!rows.some((r) => r.id === id)) freshIds.delete(id);

  const title = titleOf(m, count);
  const maxHeight = Math.max(160, (window.visualViewport?.height || window.innerHeight) - 32);
  const panel = bevelSurface("div", ["display:flex", "flex-direction:column", "width:520px", "max-width:calc(100vw - 24px)", `max-height:${maxHeight}px`]);
  panelEl = panel;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", title);

  const head = el("div", ["all:initial", "display:flex", "align-items:center", "gap:8px", "padding:12px 12px 8px 16px", `font:14px/1.5 ${FONT_SANS}`, `color:${TOKENS.ink}`]);
  const t = key(bevelText("b", ["font-weight:600", "font-size:14.5px", "outline:none"], title), "title");
  t.setAttribute("tabindex", "-1");
  head.append(dot(), t);
  if (m === "replaced" && freshIds.size) {
    head.append(bevelText("span", [
      `font:600 10.5px/1 ${FONT_MONO}`, "letter-spacing:.12em", "text-transform:uppercase", "padding:3px 6px",
      `color:color-mix(in srgb, ${TOKENS.brass} 80%, ${TOKENS.ink})`, `background:${TOKENS["brass-soft"]}`,
    ], `${freshIds.size} new`));
  }
  const minimizeWrap = el("span", ["all:initial", "display:inline-flex", "margin-left:auto"]);
  const minimize = key(bevelIconButton(MINIMIZE_SVG, { label: "Minimize", onClick: minimizePanel }), "minimize");
  minimize.title = "Minimize to the bar. Nothing is accepted until you choose.";
  minimizeWrap.append(minimize);
  head.append(minimizeWrap);
  panel.append(head);

  if (m === "recovered") {
    drawRecovered(panel);
    return panel;
  }

  if (m === "refused") {
    panel.append(lede("Your edits here are safe and not saved yet; nothing will be overwritten until you choose. Their version is not on this page, so there is no list of edits to compare. Keep yours, which saves over theirs, or accept theirs, which reloads the page and drops your unsaved edits."));
    if (held.length) {
      panel.append(lede(`${plural(held.length, "earlier replaced edit")} ${held.length === 1 ? "is" : "are"} also held in this tab. Download my copy includes them.`));
    }
    if (keepFailed) panel.append(lede("That did not save either. Your edits here are still here."));
    if (armLost) panel.append(lede("Something changed on the page after your first press, so nothing was dropped. Press Accept theirs again if you still want their version."));
    if (armed) {
      const warn = el("div", [
        "all:initial", "display:block", "margin:0 16px 12px", "padding:8px 10px",
        `border-left:3px solid ${WARN}`, `background:color-mix(in srgb, ${WARN} 14%, transparent)`,
        `color:${TOKENS.ink}`, `font:13px/1.5 ${FONT_SANS}`,
      ]);
      warn.append(el("b", ["all:initial", "font:inherit", "font-weight:700", "color:inherit"], "This drops your unsaved edits."), document.createTextNode(" Download your copy first if you might want them. Press again to confirm."));
      panel.append(warn);
    }
  } else if (m === "upgraded") {
    panel.append(lede("Its layout and code changed with it, so this page stops here. Reload to see the new version."));
  } else if (m === "failed") {
    panel.append(lede("Part of an update from elsewhere could not be applied, so this page may be missing some of it. Your edits here are safe. Download a copy of the page as you had it, or accept to keep the page as it is."));
  } else {
    panel.append(lede("The page is showing the other edit. This stays until you choose. You can also save a copy of the page as you had it."));
  }

  const actions = el("div", ["all:initial", "display:flex", "flex-wrap:wrap", "gap:8px", "padding:0 16px 14px"]);
  if (m === "upgraded") {
    actions.append(action("Reload", "reload", { variant: "primary", onClick: () => window.location.reload(), push: true }));
    panel.append(actions);
    renderedIds = [];
    return panel;
  }
  const dl = action(downloadFailed ? "Try again" : downloaded ? "Downloaded" : "Download my copy", "download", { onClick: onDownload });
  actions.append(dl);
  if (m === "refused") {
    const keep = action(busy === "overwrite" ? "Saving…" : keepFailed ? "Try again" : "Keep mine", "keep", { onClick: onKeep });
    keep.setDisabled(busy === "overwrite");
    actions.append(keep, action(armed ? "Yes, drop my edits" : "Accept theirs", "accept", { variant: "primary", onClick: onRefusedAccept, push: true }));
  } else {
    if (m === "replaced") {
      const pending = ledger().hasPendingApply();
      const put = action(pending ? "Finishing the incoming edit…" : busy === "revert" ? "Putting back…" : "Revert to mine", "revert", { onClick: onRevert });
      put.setDisabled(pending || busy === "revert");
      actions.append(put);
    }
    actions.append(action("Accept theirs", "accept", { variant: "primary", onClick: onAccept, push: true }));
  }
  panel.append(actions);

  if (m === "replaced") {
    if (!listOpen) {
      const more = el("div", ["all:initial", "display:flex", "align-items:center", "gap:8px", `border-top:1px solid ${TOKENS.line}`, "padding:8px 10px 8px 16px", `color:${TOKENS.muted}`, `font:13px/1.5 ${FONT_SANS}`]);
      const seeWrap = el("span", ["all:initial", "display:inline-flex", "margin-left:auto"]);
      seeWrap.append(key(bevelButton("See the edits", { small: true, onClick: toggleList }), "list"));
      more.append(el("span", ["all:initial", "font:inherit", "color:inherit"], plural(rows.length, "edit")), seeWrap);
      panel.append(more);
    } else {
      panel.append(drawWell(rows));
    }
  }

  renderedIds = held.map((r) => r.id);
  for (const r of rows) seenIds.add(r.id);
  return panel;
}

function drawWell(rows) {
  // The sunk ground, not the recess: the recess's lighter blue glares against the panel in dark mode.
  const well = bevelWell(["flex:1 1 auto", "margin:0 16px 12px", "min-height:0", "overflow:auto", `background:${TOKENS.sunk}`, `border:1px solid ${TOKENS["line-2"]}`]);
  const head = el("div", ["all:initial", "position:sticky", "top:0", "z-index:1", "display:flex", "align-items:center", "gap:8px", "padding:8px 12px", `background:${TOKENS.sunk}`, `border-bottom:1px solid ${TOKENS["line-2"]}`, `color:${TOKENS.muted}`, `font:600 10.5px/1 ${FONT_MONO}`, "letter-spacing:.12em", "text-transform:uppercase"]);
  const hideWrap = el("span", ["all:initial", "display:inline-flex", "margin-left:auto"]);
  hideWrap.append(key(bevelButton("Hide", { small: true, variant: "quiet", onClick: toggleList }), "list"));
  head.append(el("span", ["all:initial", "font:inherit", "color:inherit", "letter-spacing:inherit", "text-transform:inherit"], "Replaced edits"), hideWrap);
  well.append(head);
  rows.forEach((r, i) => well.append(buildRow(r, i)));
  wellEl = well;
  return well;
}

// A stored conflict's name: the app's own label when it registered one, and the
// generic name the ledger recorded otherwise. Never guessed from today's route.
function storedName(entry) {
  const base = entry.context?.label || entry.name || (entry.context?.kind === "entry" ? "Entry" : "Edit");
  return entry.context?.field ? `${base} \u00b7 ${entry.context.field}` : base;
}

// Why a refused step was not applied, in one phrase per code the engine reports.
const UNDO_REASONS = {
  "content-changed": "the page changed there",
  "structure-changed": "the structure changed there",
  "target-detached": "that part of the page is gone",
  "duplicate-id": "another part of the page now has the same id",
  "protected": "that region keeps its own history",
  "unsupported": "this kind of step cannot be put back",
};

const undoReason = (code) => UNDO_REASONS[code] || "the page changed there";

// The text a refused step would have written, and the spot it would have written it
// into. A text or value step holds both endpoints, so the one for this direction is
// the one a replay would write; an add or a remove holds the markup of its nodes.
function writtenBy(steps, direction) {
  const list = Array.isArray(steps) ? steps : [];
  for (const step of list) {
    if (!step || (step.kind !== "text" && step.kind !== "value")) continue;
    const wrote = direction === "redo" ? step.after : step.before;
    if (typeof wrote === "string" && wrote) return { text: wrote, id: step.target?.id ?? null };
  }
  for (const step of list) {
    if (!step || (step.kind !== "add" && step.kind !== "remove")) continue;
    const node = Array.isArray(step.nodes) ? step.nodes.find((item) => typeof item?.html === "string" && item.html) : null;
    if (node) return { text: plain(node.html).replace(/\s+/g, " ").trim(), id: step.parent?.id ?? null };
  }
  for (const step of list) {
    if (!step) continue;
    const wrote = direction === "redo" ? step.after : step.before;
    if (typeof wrote === "string" && wrote) return { text: wrote, id: step.target?.id ?? null };
  }
  return { text: "", id: null };
}

// The page as it reads there today, when the spot an old step names is still on it.
function liveText(id) {
  if (id == null || typeof document === "undefined") return "";
  const escaped = window.CSS?.escape ? window.CSS.escape(String(id)) : String(id).replace(/["\\]/g, "\\$&");
  let node = null;
  try {
    node = document.querySelector(`[data-id="${escaped}"]`);
  } catch (_) {
    return "";
  }
  if (!node) return "";
  const field = node.matches?.("input, textarea, select") ? node.value : null;
  const text = typeof field === "string" ? field : node.textContent ?? "";
  return text.replace(/\s+/g, " ").trim();
}

// One kept undo record as a row. A refused step says what was not applied and quotes
// both sides; a copy the app kept shows its own name and text. Neither points at a
// live node: an old step's target may be gone, and only its own id survived.
function undoRow(record) {
  const payload = record?.payload && typeof record.payload === "object" ? record.payload : {};
  const key = String(record?.key ?? "");
  const base = { id: record?.id, revision: record?.revision, record, kind: record?.kind ?? "conflict" };
  if (key.startsWith("app:")) {
    return {
      ...base,
      name: typeof payload.label === "string" && payload.label ? payload.label : key.slice(4),
      sentence: "",
      yours: typeof payload.text === "string" ? payload.text : "",
      now: "",
    };
  }
  const direction = payload.direction === "redo" ? "redo" : "undo";
  const contexts = Array.isArray(payload.context) ? payload.context : [];
  const named = contexts.find((item) => typeof item?.label === "string" && item.label) ?? null;
  const name = named?.label || (typeof payload.label === "string" && payload.label) || "Edit";
  const wrote = writtenBy(payload.steps, direction);
  return {
    ...base,
    name,
    sentence: `The ${direction} of "${name}" was not applied because ${undoReason(payload.code)}.`,
    yours: wrote.text,
    now: wrote.id == null ? "" : liveText(wrote.id),
  };
}

// The page's own buttons for one kept record, asked of the undo plugin on every draw.
function undoActionsOf(entry) {
  const api = undoApi();
  if (!entry.record || typeof api?.reviewActionsFor !== "function") return [];
  try {
    return (api.reviewActionsFor(entry.record) || []).filter((item) => item && typeof item.run === "function" && item.label);
  } catch (_) {
    return [];
  }
}

// Stored text is already plain: no markup, no live node, nothing to parse.
const storedSide = (text) => ({ before: "", hit: text, after: "", cutBefore: false, cutAfter: false });

function storedRow(entry) {
  const box = bevelText("div", ["display:block", "padding:8px 12px 10px"]);
  const where = bevelText("div", ["display:flex", "align-items:center", "gap:8px", "font-size:12.5px", "font-weight:600", `color:${TOKENS["ink-2"]}`, "margin-bottom:4px"]);
  // No eye: there is no live element to ring, and an old recovery path may name a
  // place today's page no longer has.
  where.append(bevelText("span", [], storedName(entry)));
  box.append(where);
  if (entry.sentence) box.append(bevelText("div", ["display:block", "font-size:13px", `color:${TOKENS["ink-2"]}`], entry.sentence));
  if (entry.yours) {
    const grid = bevelText("div", ["display:grid", "grid-template-columns:44px 1fr", "gap:3px 10px", "align-items:start", `font:12.5px/1.5 ${FONT_MONO}`, ...(entry.sentence ? ["margin-top:4px"] : [])]);
    grid.append(...valueLine("Yours", storedSide(entry.yours), { mine: true }));
    if (entry.now) grid.append(...valueLine("Now", storedSide(entry.now), { mine: false }));
    box.append(grid);
  }
  const rowActions = el("div", ["all:initial", "display:flex", "flex-wrap:wrap", "gap:8px", "margin-top:8px"]);
  undoActionsOf(entry).forEach((item, at) => {
    const rowAction = action(item.label, `run:${entry.id}:${at}`, { onClick: () => onUndoAction(entry, item, rowAction) });
    rowActions.append(rowAction);
  });
  rowActions.append(action(copiedId === entry.id ? "Copied" : "Copy", `copy:${entry.id}`, { onClick: () => onCopyStored(entry) }));
  rowActions.append(action("Dismiss", `dismiss:${entry.id}`, { onClick: () => onDismissStored(entry) }));
  box.append(rowActions);
  return box;
}

// Review for copies a reload left behind. Every action here reads the stored record;
// none of them touches the tree, and dismissal is the only thing that removes one.
function drawRecovered(panel) {
  panel.append(lede(recovered.length
    ? "These copies were replaced before this page loaded. The page never puts them back on its own. Copy or download the ones you want; dismiss one when you no longer need it."
    : "These copies were kept because an undo could not be put back or the page set them aside. The page never puts them back on its own. Copy or download the ones you want; dismiss one when you no longer need it."));
  if (actionFailed) panel.append(lede("That action did not run. The copy is still here."));
  const well = bevelWell(["flex:1 1 auto", "margin:0 16px 12px", "min-height:0", "overflow:auto", `background:${TOKENS.sunk}`, `border:1px solid ${TOKENS["line-2"]}`]);
  for (const record of recovered) for (const entry of record.conflicts) well.append(storedRow(entry));
  for (const entry of recoveredUndo) well.append(storedRow(entry));
  wellEl = well;
  panel.append(well);
  const actions = el("div", ["all:initial", "display:flex", "flex-wrap:wrap", "gap:8px", "padding:0 16px 14px"]);
  if (recovered.some((record) => record.root) || recoveredUndo.length) actions.append(action(downloaded ? "Downloaded" : "Download my copy", "download", { onClick: onDownloadRecovered }));
  panel.append(actions);
  renderedIds = [];
}

function valueLine(label, value, { mine }) {
  const cells = [bevelText("span", [`color:${TOKENS.faint}`, `font-family:${FONT_SANS}`], label)];
  const box = bevelText("span", [
    "display:-webkit-box", "-webkit-line-clamp:2", "-webkit-box-orient:vertical", "overflow:hidden",
    "overflow-wrap:anywhere",
    ...(mine
      ? [`color:${TOKENS.ink}`]
      : [`color:${TOKENS.muted}`]),
  ]);
  const full = (value.cutBefore ? "…" : "") + value.before + value.hit + value.after + (value.cutAfter ? "…" : "");
  box.title = full;
  if (value.before) box.append(bevelText("span", [`color:${TOKENS.faint}`], (value.cutBefore ? "…" : "") + value.before));
  const hit = bevelText("span", mine
    ? [`background:color-mix(in srgb, ${WARN} 18%, transparent)`, "padding:0 4px"]
    : (value.before || value.after
      ? ["text-decoration:underline", `text-decoration-color:color-mix(in srgb, ${WARN} 70%, transparent)`, "text-underline-offset:3px"]
      : []), value.hit || "(empty)");
  box.append(hit);
  if (value.after) box.append(bevelText("span", [`color:${TOKENS.faint}`], value.after + (value.cutAfter ? "…" : "")));
  cells.push(box);
  return cells;
}

function buildRow(record, index) {
  const row = rowOf(record);
  const box = bevelText("div", ["display:block", "padding:8px 12px 10px", ...(index ? [`border-top:1px solid ${TOKENS.line}`] : [])]);
  const where = bevelText("div", ["display:flex", "align-items:center", "gap:4px", "font-size:12.5px", "font-weight:600", `color:${TOKENS["ink-2"]}`, "margin-bottom:4px"]);
  where.append(bevelText("span", [], row.name));
  if (row.target && row.target.isConnected) where.append(key(eyeButton(row), `eye:${record.id}`));
  box.append(where);
  if (row.sentence) box.append(bevelText("div", ["display:block", "font-size:13px", `color:${TOKENS["ink-2"]}`], row.sentence));
  if (blockedRows.has(record.id)) box.append(bevelText("div", ["display:block", "font-size:13px", "margin-top:4px", `color:${WARN}`], blockedRows.get(record.id)));
  if (row.yours) {
    const grid = bevelText("div", ["display:grid", "grid-template-columns:44px 1fr", "gap:3px 10px", "align-items:start", `font:12.5px/1.5 ${FONT_MONO}`, ...(row.sentence ? ["margin-top:4px"] : [])]);
    grid.append(...valueLine("Yours", row.yours, { mine: true }));
    if (row.now) grid.append(...valueLine("Now", row.now, { mine: false }));
    box.append(grid);
  }
  return box;
}

function eyeButton(row) {
  const base = ["all:initial", "color-scheme:inherit", "box-sizing:border-box", "cursor:pointer", "display:inline-grid", "place-items:center", "width:22px", "height:20px", `color:${TOKENS.ink}`];
  const b = el("button", base);
  b.type = "button";
  b.innerHTML = GLYPHS.conflictEye;
  protectIcon(b.firstElementChild, 16);
  b.setAttribute("aria-label", `Show ${row.name} on page`);
  b.title = "Show on page";
  const paint = (extra) => { b.style.cssText = ""; for (const r of [...base, ...extra]) { const i = r.indexOf(":"); b.style.setProperty(r.slice(0, i), r.slice(i + 1), "important"); } };
  b.addEventListener("pointerenter", () => paint([`background:color-mix(in srgb, ${WARN} 16%, transparent)`]));
  b.addEventListener("pointerleave", () => paint([]));
  b.addEventListener("focus", () => paint([`outline:2px solid ${TOKENS.brass}`, "outline-offset:1px"]));
  b.addEventListener("blur", () => paint([]));
  b.addEventListener("click", () => ring(row.target));
  return b;
}

// The eye: scroll the element into view and draw a ring over it. The ring is ours
// and runtime-only; the page's element gets no attribute, class or style, so the
// dirty gate and the saved bytes see nothing.
let ringEl = null;
let ringTimer = null;
let ringTarget = null;

function dropRing() {
  clearTimeout(ringTimer);
  window.removeEventListener("scroll", placeRing, true);
  window.removeEventListener("resize", placeRing);
  ringEl?.remove();
  ringEl = null;
  ringTarget = null;
}

function placeRing() {
  if (!ringEl || !ringTarget) return;
  const r = ringTarget.getBoundingClientRect();
  set(ringEl, "left", `${r.left}px`);
  set(ringEl, "top", `${r.top}px`);
  set(ringEl, "width", `${r.width}px`);
  set(ringEl, "height", `${r.height}px`);
}

function ring(target) {
  dropRing();
  if (!target || !target.isConnected) return;
  const still = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const behavior = still ? "instant" : "smooth";
  // The notice sits at the bottom of the viewport: centre the target in what is left
  // above it, or the outline lands on the panel instead of the text.
  const top = root?.getBoundingClientRect().top ?? 0;
  const cover = root && top > 0 ? Math.max(0, window.innerHeight - top) : 0;
  if (!cover) {
    target.scrollIntoView?.({ block: "center", behavior });
  } else {
    // Centre first, so a page whose own scroller holds the target still brings it
    // up; then move the window the rest of the way. A target taller than the free
    // space shows its top instead.
    target.scrollIntoView?.({ block: "center", behavior: "instant" });
    const r = target.getBoundingClientRect();
    const free = window.innerHeight - cover;
    const shift = r.height > free - 24 ? r.top - 12 : r.top + r.height / 2 - free / 2;
    window.scrollBy?.({ top: shift, behavior });
  }
  ringTarget = target;
  ringEl = el("div", ["all:initial", "color-scheme:inherit", "position:fixed", "pointer-events:none", "z-index:2147483001", `outline:2px solid ${WARN}`, "outline-offset:3px", `background:color-mix(in srgb, ${WARN} 14%, transparent)`]);
  document.body.appendChild(ringEl);
  placeRing();
  window.addEventListener("scroll", placeRing, true);
  window.addEventListener("resize", placeRing);
  ringTimer = setTimeout(dropRing, 2500);
}

function openPanel() {
  if (upgraded) return;
  view = "panel";
  pendingFocus = "title";
  render();
}

function minimizePanel() {
  dropRing();
  view = "bar";
  disarm();
  pendingFocus = "review";
  render();
}

function toggleList() {
  listOpen = !listOpen;
  if (listOpen) freshIds.clear();
  render();
}

// The ids copied before anything else runs: a record that landed after the draw was never shown, so this choice does not cover it, and a record something claimed since then is its owner's to settle.
function onAccept() {
  const l = ledger();
  const ids = renderedIds.filter((id) => { const r = l?.get(id); return r && !r.claimedBy; });
  if (l && ids.length) l.acknowledge(ids, { reason: "accepted" });
  view = mode() ? "bar" : "hidden";
  pendingFocus = "review";
  schedule();
}

// Revert to mine. The ids are the rendered ones, copied before anything runs, as
// Accept reads them. The module that does the work loads on first use, and only
// here, where the sync plugin has published the ledger. What it could not put back
// keeps its row, with the reason under it, until the ledger moves on.
async function onRevert() {
  const l = ledger();
  if (busy || !l || l.hasPendingApply()) return;
  const ids = renderedIds.filter((id) => { const r = l.get(id); return r && !r.claimedBy; });
  if (!ids.length) return;
  busy = "revert";
  render();
  // Focus that lands outside the notice while the revert and its save run is the
  // person moving on; Review takes focus afterwards only if it stayed here.
  let stayed = true;
  const track = (e) => { stayed = !!root?.contains(e.target); };
  document.addEventListener("focus", track, true);
  let result;
  try {
    const { revertConflicts } = await import("../sync/conflict-revert.js");
    result = await revertConflicts(ids);
  } catch (err) {
    console.error("[clay] Revert to mine did not finish", err);
    result = { revertedIds: [], blockedIds: ids, saveResult: null };
  } finally {
    document.removeEventListener("focus", track, true);
  }
  busy = null;
  for (const id of result.blockedIds) blockedRows.set(id, ledger()?.get(id)?.kind === "json" ? DATA_BLOCKED_ROW : BLOCKED_ROW);
  view = mode() ? "bar" : "hidden";
  pendingFocus = stayed ? "review" : null;
  const saving = result.saveResult && (result.saveResult.ok || result.saveResult.msg === "Save already in progress");
  if (result.revertedIds.length && saving) toast(`Put back ${plural(result.revertedIds.length, "change")}. Saving.`);
  else render();
}

let downloadedTimer = null;

// Download my copy. Nothing here acknowledges or releases a record.
function onDownload() {
  const l = ledger();
  // A refusal ends in a reload that takes every record with it, so its copy carries
  // all of them; a replaced notice covers the rows it drew.
  const records = refused ? (l?.list() ?? []) : renderedIds.map((id) => l?.get(id)).filter(Boolean);
  const ok = downloadRecovery(records, { refused: !!refused });
  downloadFailed = !ok;
  downloaded = ok;
  clearTimeout(downloadedTimer);
  if (ok) downloadedTimer = setTimeout(() => { downloaded = false; schedule(); }, 1200);
  render();
}

// Read what the store holds. Nothing is drawn until a transaction has answered, and
// a failed read leaves whatever was last shown alone.
async function refreshRecovered() {
  let listed = null;
  if (pendingConflicts()) {
    try {
      listed = await listConflicts();
    } catch (_) {
      listed = null;
    }
  }
  const api = undoApi();
  let keptUndo = null;
  if (api) {
    try {
      keptUndo = await api.kept();
    } catch (_) {
      keptUndo = null;
    }
  }
  let moved = false;
  if (listed?.ok) {
    recovered = listed.records;
    moved = true;
  } else if (!pendingConflicts() && recovered.length) {
    recovered = [];
    moved = true;
  }
  if (keptUndo?.ok) {
    const rows = (Array.isArray(keptUndo.records) ? keptUndo.records : [])
      .filter((record) => record && record.supported !== false)
      .map(undoRow);
    const same = rows.length === recoveredUndo.length
      && rows.every((row, at) => row.id === recoveredUndo[at].id && row.revision === recoveredUndo[at].revision);
    if (!same) moved = true;
    recoveredUndo = rows;
  } else if (keptUndo && recoveredUndo.length) {
    // The store answered and holds nothing for us now.
    recoveredUndo = [];
    moved = true;
  }
  if (moved) schedule();
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {}
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("clay", RUNTIME_ONLY);
  field.style.setProperty("position", "fixed", "important");
  field.style.setProperty("opacity", "0", "important");
  document.body?.append(field);
  field.select();
  let ok = false;
  try {
    ok = document.execCommand?.("copy") === true;
  } catch (_) {}
  field.remove();
  return ok;
}

// Copying is not acknowledging: the copy stays until the person dismisses it, and the
// notice stays on screen rather than standing a toast in for itself.
async function onCopyStored(entry) {
  const text = entry.record ? entry.yours : `${storedName(entry)}\n\nYours:\n${entry.yours}\n\nNow:\n${entry.now}`;
  const ok = await copyText(text);
  if (!ok) {
    toast("Could not copy. Select the text instead.");
    return;
  }
  copiedId = entry.id;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => { copiedId = null; schedule(); }, 1200);
  render();
}

// Download my copy, from the stored root: the page as this tab had it, with the
// losing text in it. Nothing here acknowledges or releases a record.
function onDownloadRecovered() {
  const record = recovered.find((item) => item.root);
  const edits = [];
  for (const item of recovered) {
    for (const entry of item.conflicts) edits.push({ id: entry.id, kind: entry.kind, name: storedName(entry), yours: entry.yours, now: entry.now, sentence: entry.sentence });
  }
  for (const entry of recoveredUndo) edits.push({ id: entry.id, kind: entry.kind, name: entry.name, yours: entry.yours, now: entry.now, sentence: entry.sentence });
  const ok = downloadStored({ html: record?.root ?? null, edits });
  downloadFailed = !ok;
  downloaded = ok;
  clearTimeout(downloadedTimer);
  if (ok) downloadedTimer = setTimeout(() => { downloaded = false; schedule(); }, 1200);
  render();
}

async function onDismissStored(entry) {
  let receipt;
  try {
    receipt = entry.record
      ? await undoApi()?.dismissKept(entry.id, { revision: entry.revision })
      : await dismissConflicts([entry.id]);
    receipt ||= { ok: false };
  } catch (_) {
    receipt = { ok: false };
  }
  if (!receipt.ok) toast("That copy could not be dismissed.");
  await refreshRecovered();
  schedule();
}

// One activation per row action: while its run is pending the button is disabled and
// busy, and further activations are ignored, so the page's own action cannot apply
// twice at once. The button is the one that was drawn with this row; a redraw during
// the run leaves it detached and there is nothing to hand back.
const runningActions = new Set();

// An action the page offers for one kept record: Keep as new, on a later step. It may
// be async, and it answers whether the copy was dealt with. Only a run that says both
// ok and dismiss takes the row away, and only at the revision the row was drawn at: a
// throw or a refusal leaves the copy where it is and says so above the list.
async function onUndoAction(entry, item, button = null) {
  if (runningActions.has(item)) return;
  runningActions.add(item);
  if (button) {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
  }
  actionFailed = false;
  try {
    let result = null;
    try {
      result = await item.run(entry.record);
    } catch (_) {
      result = null;
    }
    if (result?.ok === true && result?.dismiss === true) {
      await onDismissStored(entry);
      return;
    }
    actionFailed = result?.ok !== true;
    await refreshRecovered();
    schedule();
  } finally {
    runningActions.delete(item);
    if (button && button.isConnected) {
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  }
}

// A refusal this tab just kept is reviewable the moment the store has it: the same
// bar and Review a stored conflict gets, so no new chrome and no new entry point.
function onUndoKept(e) {
  if (e?.detail?.ok !== true) return;
  actionFailed = false;
  refreshRecovered();
  schedule();
}

function disarm() {
  clearTimeout(armTimer);
  armTimer = null;
  armed = null;
}

async function onKeep() {
  if (busy) return;
  const attempt = ++keepAttempt;
  busy = "overwrite";
  keepFailed = false;
  disarm();
  render();
  let result;
  try {
    result = await window.clay?.save?.overwrite?.();
  } catch {
    result = { ok: false };
  }
  // A newer attempt, a new refusal or a landed save already settled this one.
  if (attempt !== keepAttempt || busy !== "overwrite") return;
  if (!result?.ok && isSaveConflicted()) {
    // Left showing: the save still has not happened.
    busy = null;
    keepFailed = true;
  }
  schedule();
}

// Two presses. The first is a choice, not a confirmation, and this is the one
// control here that throws away work nothing can bring back. The second only
// counts if nothing changed in between: a new refusal, a new loss or new typing
// each disarm it.
function onRefusedAccept() {
  if (!armed) {
    armed = { refusalGeneration, ledgerRevision, dirtyGeneration: gateCaptureToken().gen };
    armedAt = Date.now();
    armLost = false;
    clearTimeout(armTimer);
    armTimer = setTimeout(() => { disarm(); schedule(); }, ARM_MS);
    render();
    return;
  }
  // The second half of a double click is not a second decision.
  if (Date.now() - armedAt < DOUBLE_PRESS_MS) return;
  const token = armed;
  const current = () =>
    armed === token &&
    token.refusalGeneration === refusalGeneration &&
    token.ledgerRevision === ledgerRevision &&
    token.dirtyGeneration === gateCaptureToken().gen;
  if (!reloadAfterDiscard({ isCurrent: current, reload: () => window.location.reload() })) {
    disarm();
    armLost = true;
    render();
  }
}

export function toast(text) {
  toastText = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastText = null; schedule(); }, TOAST_MS);
  render();
}

function onStoreChanged() {
  refreshRecovered();
  schedule();
}

function onLedgerChanged() {
  ledgerRevision++;
  if (armed) disarm();
  for (const id of [...blockedRows.keys()]) if (!ledger()?.get(id)) blockedRows.delete(id);
  refreshRecovered();
  schedule();
}

function onUpgraded(e) {
  upgraded = (e?.detail && e.detail.message) || "This document was upgraded.";
  toastText = null;
  clearTimeout(toastTimer);
  disarm();
  busy = null;
  keepFailed = false;
  armLost = false;
  view = "bar";
  schedule();
}

function onSaveConflict(e) {
  const d = e?.detail || {};
  refused = { generation: ++refusalGeneration, changedBy: d.changedBy, afterTimeout: !!d.afterTimeout, etag: d.etag ?? null };
  // The refusal answers the save a toast may still be announcing; it replaces the
  // toast at once.
  toastText = null;
  clearTimeout(toastTimer);
  disarm();
  busy = null;
  keepFailed = false;
  keepAttempt++;
  armLost = false;
  schedule();
}

// An old save event cannot erase a newer refusal: only a tab that is no longer
// holding one clears it. Losses are untouched; a save never acknowledges.
function onSaveSettled(e) {
  if (isSaveConflicted()) {
    // save.js fires clay:save-saved just before it releases the hold, in the same
    // task; look again once it has.
    if (e.type === "clay:save-saved") queueMicrotask(() => { if (!isSaveConflicted()) onSaveSettled(e); });
    return;
  }
  const keptMine = busy === "overwrite" && e.type === "clay:save-saved";
  if (refused || busy) {
    refused = null;
    busy = null;
    keepFailed = false;
    armLost = false;
    disarm();
  }
  if (keptMine) toast("Saved your version over theirs.");
  else schedule();
}

// On a manual page, conflictResolvedBySync can release the hold without firing
// clay:save-conflict-resolved. Checked a frame later, after the apply finished.
function onSyncApplied() {
  if (!refused) return;
  checkRefusal = true;
  schedule();
}

// conflictResolvedBySync released the hold on a manual page with unsaved work:
// no save happened and no clay:save-conflict-resolved fired, but their version
// is on this page now, so the refusal is over.
function onConflictReleased() {
  if (!refused || isSaveConflicted()) return;
  refused = null;
  busy = null;
  keepFailed = false;
  armLost = false;
  disarm();
  schedule();
}

function onKeydown(e) {
  if (e.key !== "Escape") return;
  if (armed) {
    e.preventDefault();
    disarm();
    render();
    return;
  }
  if (view !== "panel") return;
  const a = document.activeElement;
  if (a && a !== document.body && !root?.contains(a)) return;
  e.preventDefault();
  minimizePanel();
}

function onInput(e) {
  if (!armed || root?.contains(e.target)) return;
  disarm();
  schedule();
}

// Focus that leaves the notice while a toast stands in for it is the person moving
// on: the control the toast replaced does not take focus back afterwards.
function onFocus(e) {
  if (toastText && pendingFocus && !root?.contains(e.target)) pendingFocus = null;
}

function init() {
  listeners = new AbortController();
  const { signal } = listeners;
  // Registered before the edit-mode gate: an upgraded reader has nothing to reconcile
  // and this is still the one notice it can be shown.
  document.addEventListener("clay:document-upgraded", onUpgraded, { signal });
  if (!isEditMode) return;
  document.addEventListener("clay:sync-conflicts-changed", onLedgerChanged, { signal });
  // An apply beginning or ending changes only whether Revert may run.
  document.addEventListener("clay:unsaved-state-changed", schedule, { signal });
  document.addEventListener("clay:save-conflict", onSaveConflict, { signal });
  document.addEventListener("clay:save-saved", onSaveSettled, { signal });
  document.addEventListener("clay:save-conflict-resolved", onSaveSettled, { signal });
  document.addEventListener("clay:sync-applied", onSyncApplied, { signal });
  document.addEventListener("clay:save-conflict-released", onConflictReleased, { signal });
  document.addEventListener("keydown", onKeydown, { signal });
  document.addEventListener("input", onInput, { capture: true, signal });
  document.addEventListener("focus", onFocus, { capture: true, signal });
  document.addEventListener("clay:conflict-store-changed", onStoreChanged, { signal });
  document.addEventListener("clay:undo-kept", onUndoKept, { signal });
  if (ledger()?.size) schedule();
  refreshRecovered();
  // The undo plugin is attached during boot, after this notice can start: ask again once it is.
  Promise.resolve(window.clay?.ready).catch(() => {}).then(() => { if (!signal.aborted) refreshRecovered(); });
}

// The shell (conflict-notice.js) asks for this file only when there is something to
// show, and hands it the event that asked: it is replayed here, after init() has
// registered the listeners, exactly as if it had arrived on a page that already held
// the notice.
const HANDLERS = {
  "clay:sync-conflicts-changed": onLedgerChanged,
  "clay:save-conflict": onSaveConflict,
  "clay:document-upgraded": onUpgraded,
  "clay:undo-kept": onUndoKept,
};

let started = false;
let listeners = null;

export function start(trigger) {
  if (!started) {
    started = true;
    init();
  }
  const handler = trigger && HANDLERS[trigger.type];
  if (handler) handler(trigger);
  // This file is fetched, so the events between the one that asked for it and its
  // evaluation are gone: a refusal answered in that window must not be drawn.
  if (refused) {
    checkRefusal = true;
    schedule();
  }
}

// A committed exit takes the notice with it: every handler above, every timer it owns
// and the node it drew. Nothing here acknowledges a record or releases a refusal — an
// exit that still held one never got this far — and a later `start()` builds the notice
// again from whatever the ledger and the store hold then.
export function stop() {
  if (!started) return;
  started = false;
  listeners?.abort();
  listeners = null;
  disarm();
  clearTimeout(toastTimer);
  toastTimer = null;
  clearTimeout(downloadedTimer);
  downloadedTimer = null;
  clearTimeout(copiedTimer);
  copiedTimer = null;
  clearTimeout(ringTimer);
  ringTimer = null;
  dropRing();
  window.visualViewport?.removeEventListener("resize", place);
  window.visualViewport?.removeEventListener("scroll", place);
  root?.remove();
  root = null;
  keyed = new Map();
  wellEl = null;
  panelEl = null;
  view = "hidden";
  listOpen = false;
  renderedIds = [];
  seenIds.clear();
  freshIds.clear();
  blockedRows.clear();
  toastText = null;
  refused = null;
  upgraded = null;
  busy = null;
  keepFailed = false;
  keepAttempt++;
  armed = null;
  armedAt = 0;
  armLost = false;
  recovered = [];
  recoveredUndo = [];
  actionFailed = false;
  frameQueued = false;
  checkRefusal = false;
  pendingFocus = null;
  lastAnnounced = null;
  downloaded = false;
  downloadFailed = false;
  copiedId = null;
}

export const _test = {
  state: () => ({ view, listOpen, renderedIds: renderedIds.slice(), refused, armed, busy, ledgerRevision, upgraded }),
  render,
  resetUpgrade: () => { upgraded = null; },
};
