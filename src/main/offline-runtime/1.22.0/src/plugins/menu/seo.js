// The SEO sheet: a panel that slides down from the top and edits the document's
// head fields. Everything it draws is `clay="editor-ui"`, so none of it reaches
// the saved file, a sync frame, the dirty check or undo. Nothing is written until
// Apply: opening and cancelling change only the sheet.
import { applyHead, FIELDS, readHead } from "./seo-head.js";
import { lookAt } from "../../ui/page-colour.js";
import MENU_CSS, { MENU_SURFACE } from "./style.js";
import { mountEditorUI } from "../../ui/editor-ui.js";
import { deepActiveElement } from "../../dom/active-element.js";
import { hostMeta } from "../../core/host-meta.js";
import { documentTitle } from "../../page/document-title.js";
import { registerUnsavedState } from "../../lib/unsaved-state.js";
import { modeRefusalText } from "../../core/mode-refusal.js";
import { dismissPersistent, toastPersistent } from "../../ui/toast-lazy.js";

const REOPEN_KEY = "reopen-seo";
const LABEL = "SEO and social sharing";
const UNDO_LABEL = "SEO settings";
const APPLIED_TEXT = "SEO settings applied";
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const ROBOTS_NOTE =
  "This site is hidden from search engines in your account settings, so this page stays hidden whatever you choose here.";
const PUBLIC_NOTE = "Uploaded images are public to anyone with the link.";
const PASTE_NOTE = "Paste the address of an image on the web.";

const FIELD = {
  title: { label: "Title", kind: "text", full: true, count: 60 },
  description: { label: "Description", kind: "textarea", full: true, count: 160 },
  ogTitle: { label: "Preview title", note: "Open Graph", kind: "text" },
  ogDescription: { label: "Preview description", note: "Open Graph", kind: "textarea", short: true },
  ogImage: { label: "Preview image", note: "Open Graph", kind: "text", full: true },
  canonical: { label: "Canonical URL", kind: "text" },
  lang: { label: "Language", kind: "text" },
  ogImageAlt: { label: "Image alt text", kind: "text" },
  siteName: { label: "Site name", kind: "text" },
  twitterSite: { label: "Social handle", kind: "text", placeholder: "@yourname" },
  index: { label: "Show in search results", kind: "checkbox" },
  follow: { label: "Let search engines follow links", kind: "checkbox" },
};

const BASE_KEYS = ["title", "description", "ogTitle", "ogDescription", "ogImage"];
const MORE_KEYS = ["canonical", "lang", "ogImageAlt", "siteName", "twitterSite"];
const CHECK_KEYS = ["index", "follow"];

const SHEET_CSS = `.clay-seo { box-sizing: border-box; width: 100%; border-bottom: 1px solid var(--bevel-line-3); background: var(--bevel-surface); box-shadow: var(--clay-sheet-shadow); font-size: 13px; line-height: 1.45; container-type: inline-size; animation: clay-seo-in .2s ease-out; position: relative; z-index: 2147482001; grid-column: 1 / -1; flex: 0 0 100%; max-height: 85vh; max-height: 85dvh; overflow-y: auto; overscroll-behavior: contain; }
@keyframes clay-seo-in { from { margin-top: -40px; opacity: 0; } to { margin-top: 0; opacity: 1; } }
.clay-seo-inner { max-width: 1120px; margin: 0 auto; padding: 14px 20px 18px; }
.clay-seo-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 10px; margin-bottom: 12px; border-bottom: 1px solid var(--bevel-line-2); }
.clay-seo-heading { margin: 0; font: 500 19px/1.15 var(--bevel-font-serif); letter-spacing: -.01em; }
.clay-seo-actions { display: flex; gap: 8px; }
.clay-seo-grid { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(260px, .9fr); gap: 22px; align-items: start; }
.clay-seo-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 12px; }
.clay-seo-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.clay-seo-field.is-full { grid-column: 1 / -1; }
.clay-seo-label-row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-size: 12.5px; font-weight: 500; color: var(--bevel-ink-2); }
.clay-seo-label-row label span { font-weight: 400; color: var(--bevel-muted); }
.clay-seo-field:has([aria-invalid="true"]) .clay-seo-label-row { color: var(--bevel-ox); }
.clay-seo-aside { display: inline-flex; align-items: baseline; gap: 10px; }
.clay-seo-count { font: 500 11px/1 var(--bevel-font-mono); color: var(--bevel-muted); font-variant-numeric: tabular-nums; }
.clay-seo-count[data-over] { color: var(--bevel-ox); }
.clay-seo-derived { padding: 0; border: 0; background: none; color: var(--bevel-brass); font: 500 12px/1.3 var(--bevel-font-sans); text-decoration: underline; text-decoration-color: var(--bevel-line-3); text-underline-offset: 2px; cursor: pointer; }
.clay-seo-input { box-sizing: border-box; width: 100%; min-height: 32px; padding: 6px 9px; border: 1px solid var(--bevel-line-2); background: var(--bevel-ground); color: var(--bevel-ink); font: 400 13px/1.45 var(--bevel-font-sans); }
textarea.clay-seo-input { min-height: 52px; resize: vertical; }
textarea.clay-seo-input.is-short { min-height: 32px; }
.clay-seo-input::placeholder { color: var(--bevel-faint); opacity: 1; }
.clay-seo-input:hover { border-color: var(--bevel-faint); }
.clay-seo-input:focus-visible { outline: 2px solid var(--bevel-brass); outline-offset: 1px; border-color: var(--bevel-brass); }
.clay-seo-input[aria-invalid="true"] { border-color: var(--bevel-ox); background: color-mix(in srgb, var(--bevel-ox-soft) 40%, var(--bevel-ground)); }
.clay-seo-error { margin: 0; font-size: 12px; font-weight: 500; color: var(--bevel-ox); }
.clay-seo-upload { display: flex; gap: 8px; }
.clay-seo-upload .clay-seo-input { flex: 1; min-width: 0; }
.clay-seo-note { margin: 0; font-size: 12px; color: var(--bevel-muted); }
.clay-seo-more { grid-column: 1 / -1; border: 1px solid var(--bevel-line-2); background: var(--bevel-surface); }
.clay-seo-more > summary { position: relative; display: flex; align-items: center; gap: 9px; padding: 6px 10px 6px 8px; list-style: none; font-size: 12.5px; font-weight: 500; cursor: pointer; user-select: none; }
.clay-seo-more > summary::-webkit-details-marker { display: none; }
.clay-seo-more > summary::before { content: ""; box-sizing: border-box; width: 20px; height: 20px; border: 2px solid; border-color: var(--bevel-edge-hi) var(--bevel-edge-lo) var(--bevel-edge-lo) var(--bevel-edge-hi); background: var(--bevel-face); }
.clay-seo-more > summary::after { content: ""; position: absolute; left: 15px; top: 50%; width: 5px; height: 5px; border-right: 1.5px solid var(--bevel-ink); border-bottom: 1.5px solid var(--bevel-ink); transform: translateY(-50%) rotate(-45deg); }
.clay-seo-more[open] > summary { border-bottom: 1px solid var(--bevel-line); }
.clay-seo-more[open] > summary::before { background: var(--bevel-face-in); border-color: var(--bevel-edge-in) var(--bevel-edge-in-hi) var(--bevel-edge-in-hi) var(--bevel-edge-in); }
.clay-seo-more[open] > summary::after { transform: translate(1px, -65%) rotate(45deg); }
.clay-seo-more-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 12px; padding: 10px; background: var(--bevel-sunk); }
.clay-seo-checks { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 8px 18px; }
.clay-seo-check { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; }
.clay-seo-check input { appearance: none; -webkit-appearance: none; position: relative; box-sizing: border-box; flex: none; width: 16px; height: 16px; margin: 0; border: 2px solid; border-color: var(--bevel-edge-hi) var(--bevel-edge-lo) var(--bevel-edge-lo) var(--bevel-edge-hi); background: var(--bevel-face); cursor: pointer; }
.clay-seo-check input:checked { background: var(--bevel-face-in); border-color: var(--bevel-edge-in) var(--bevel-edge-in-hi) var(--bevel-edge-in-hi) var(--bevel-edge-in); }
.clay-seo-check input:checked::after { content: ""; position: absolute; left: 3px; top: 0; width: 4px; height: 8px; border-right: 1.8px solid var(--bevel-ink); border-bottom: 1.8px solid var(--bevel-ink); transform: rotate(42deg); }
.clay-seo-check input:focus-visible { outline: 2px solid var(--bevel-brass); outline-offset: 2px; }
.clay-seo-preview { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.clay-seo-preview-head { display: flex; justify-content: space-between; align-items: baseline; font-size: 12.5px; font-weight: 500; color: var(--bevel-ink-2); }
.clay-seo-preview-head span { font: 400 11px/1 var(--bevel-font-mono); color: var(--bevel-muted); }
.clay-og { border: 1px solid var(--bevel-line-2); background: var(--bevel-ground); overflow: hidden; }
.clay-og-image { position: relative; display: flex; align-items: flex-end; aspect-ratio: 1.91 / 1; max-height: 160px; width: 100%; padding: 10px 12px; box-sizing: border-box; overflow: hidden; background: var(--og-image, var(--bevel-brass-soft)); border-bottom: 1px solid var(--bevel-line-2); }
.clay-og-image[hidden] { display: none; }
.clay-og-image span { position: relative; font: 500 10.5px/1.3 var(--bevel-font-mono); padding: 2px 7px; border: 1px solid var(--bevel-line-2); background: var(--bevel-surface); color: var(--bevel-ink); }
.clay-og-body { display: flex; flex-direction: column; gap: 2px; padding: 9px 12px 11px; }
.clay-og-host { font: 400 11px/1.3 var(--bevel-font-mono); color: var(--bevel-muted); }
.clay-og-title { font: 600 14px/1.3 var(--bevel-font-sans); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.clay-og-desc { font-size: 12.5px; line-height: 1.4; color: var(--bevel-ink-2); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.clay-seo-cardsize { margin: 0; font: 400 11px/1.3 var(--bevel-font-mono); color: var(--bevel-muted); }

@container (max-width: 680px) {
  .clay-seo-inner { padding: 12px 14px 16px; }
  .clay-seo-grid, .clay-seo-fields, .clay-seo-more-grid { grid-template-columns: 1fr; }
  .clay-seo-input { font-size: 16px; min-height: 40px; }
  textarea.clay-seo-input { min-height: 96px; }
  textarea.clay-seo-input.is-short { min-height: 40px; }
  .clay-seo-check { font-size: 15px; }
}
.clay-og-image img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.clay-seo-check > .clay-seo-check { display: inline-block; }
.clay-seo-conflict { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12px; color: var(--bevel-muted); }
.clay-seo-conflict[hidden] { display: none; }
.clay-seo-conflict p { margin: 0; flex-basis: 100%; }
.clay-seo-title-mode { margin: 0; font-size: 12px; color: var(--bevel-muted); }
@media (pointer: coarse), (max-width: 680px) { .clay-seo .clay-menu-btn { min-height: 40px; } .clay-seo :is(input, textarea, select) { font-size: 16px; } }
@media (prefers-reduced-motion: reduce) { .clay-seo { animation: none; transition: none; } }`;

const text = (value) => (value == null ? "" : String(value));

function element(tag, className, content) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (content != null) el.textContent = content;
  return el;
}

const parseUrl = (value) => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const isWebUrl = (url) => !!url && (url.protocol === "http:" || url.protocol === "https:");

const isLocalHostname = (url) => {
  const host = url.hostname.toLowerCase();
  return host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1";
};

function canonicalProblem(value) {
  const raw = text(value).trim();
  if (!raw) return "";
  const url = parseUrl(raw);
  if (!url || !isWebUrl(url)) return "Enter a full http: or https: address.";
  if (isLocalHostname(url)) return "A localhost address cannot be a canonical URL.";
  return "";
}

function imageProblem(value, base) {
  const raw = text(value).trim();
  if (!raw) return "";
  if (SCHEME.test(raw)) {
    const url = parseUrl(raw);
    if (!url || !isWebUrl(url)) return "Use an http: or https: image address.";
    return "";
  }
  if (base) {
    try {
      new URL(raw, base);
    } catch {
      return "Use an http: or https: image address.";
    }
  }
  return "";
}

function pageBase() {
  try {
    const url = new URL(location.href);
    return url.origin + url.pathname;
  } catch {
    return "";
  }
}

function isDocumentPage() {
  return document.querySelectorAll("article[data-page]").length === 1;
}

const ATOM = "\uFFFC";

const rootHeading = (c) => [{ t: "heading", level: 1, parent: null, c }];

// The first root H1's items as the projection orders them: a heading that names a
// parent is nested and is not a title, marks flatten away and a hard break is one
// character. A mounted editor keeps its blocks flat, so its model holds the parents;
// a saved article nests them inside the container that holds them.
function titleItems(view) {
  if (view && !view.isDestroyed) {
    const doc = view.state.doc;
    for (let i = 0; i < doc.childCount; i++) {
      const node = doc.child(i);
      if (node.type.name !== "heading" || node.attrs.level !== 1 || (node.attrs.parent ?? null) !== null) continue;
      let c = "";
      node.forEach((child) => { c += child.isText ? child.text : child.type.name === "hard_break" ? ATOM : ""; });
      return rootHeading(c);
    }
    return [];
  }
  const article = document.querySelector("article[data-page]");
  const heading = article && [...article.children].find((node) => node.tagName === "H1");
  if (!heading) return [];
  let c = "";
  const walk = (parent) => {
    for (const child of parent.childNodes) {
      if (child.nodeType === 3) c += child.data;
      else if (child.tagName === "BR") c += ATOM;
      else walk(child);
    }
  };
  walk(heading);
  return rootHeading(c);
}

// The same rule the runtime and the checkpoint use: the first root H1, and Untitled
// when it is empty or missing.
function firstHeadingText() {
  const view = window.clay && window.clay.page && window.clay.page.view;
  return documentTitle(titleItems(view));
}

function hostOf(value) {
  const url = parseUrl(text(value).trim());
  return url ? url.hostname : "";
}

function showValue(key, value) {
  if (typeof value === "boolean") {
    if (key === "index") return value ? "Shown in search" : "Hidden from search";
    if (key === "follow") return value ? "Links followed" : "Links not followed";
    return value ? "Yes" : "No";
  }
  const raw = text(value).trim();
  return raw || "(empty)";
}

function save() {
  if (!document.documentElement.hasAttribute("autosave") && typeof window.clay?.save === "function") window.clay.save();
}

// `readHead` hands back what `applyHead` takes: a field's read and its write speak the
// same shape, booleans for index and follow and "custom"/"derived" for the title mode.
const restoreOf = (before) => ({ ...before });

function offerUndo(before) {
  toastPersistent(APPLIED_TEXT, "success", {
    actions: [
      {
        label: "Undo",
        onClick: () => {
          dismissPersistent(APPLIED_TEXT);
          applyHead(document, restoreOf(before));
          save();
        },
      },
    ],
  });
}

export function open({ returnFocus } = {}) {
  if (document.querySelector('clay-editor-ui[data-clay-ui="seo"]')) return;

  const opened = readHead(document).values;
  const restoreTo = returnFocus ?? deepActiveElement();
  const inputs = new Map();
  const errors = new Map();
  const conflicts = new Map();
  const chosen = new Set();
  let closed = false;
  let ui = null;
  let uploadAvailable = false;
  let pendingTitleMode = "";

  // Fields typed and not applied are work this page holds that its saved bytes cannot
  // show. The registry is the edit boot's own, so the sheet is pending whether or not
  // the page asked for the optional `unsent` plugin, and a refused exit leaves every
  // value on screen rather than closing over them.
  const pending = registerUnsavedState({
    id: "seo",
    isPending: () => !closed && Object.keys(changes()).length > 0,
  });

  const root = element("div", "clay-seo");
  root.setAttribute("clay", "editor-ui");
  root.setAttribute("role", "region");
  root.setAttribute("aria-labelledby", "clay-seo-heading");

  const derivedButton = element("button", "clay-seo-derived", "Use the first heading");
  derivedButton.type = "button";
  derivedButton.hidden = true;

  const uploadButton = element("button", "clay-seo-upload-button clay-menu-btn", "Upload image");
  uploadButton.type = "button";
  const fileInput = element("input", "clay-seo-file");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.hidden = true;
  fileInput.tabIndex = -1;
  const publicNote = element("p", "clay-seo-note", PUBLIC_NOTE);
  publicNote.hidden = true;
  const pasteNote = element("p", "clay-seo-note", PASTE_NOTE);
  const uploadRow = element("div", "clay-seo-upload");

  const robotNote = element("p", "clay-seo-note");
  robotNote.hidden = true;
  const cardSize = element("p", "clay-seo-cardsize clay-seo-note");

  const previewImage = element("img");
  previewImage.alt = "";
  const previewImageBox = element("div", "clay-og-image");
  previewImageBox.hidden = true;
  previewImageBox.append(previewImage);
  const previewHost = element("span", "clay-og-host");
  const previewTitle = element("span", "clay-og-title");
  const previewDescription = element("span", "clay-og-desc");
  const ogBody = element("div", "clay-og-body");
  ogBody.append(previewHost, previewTitle, previewDescription);
  const ogCard = element("div", "clay-og");
  ogCard.append(previewImageBox, ogBody);
  const previewState = element("span");
  const previewHead = element("div", "clay-seo-preview-head");
  previewHead.append("Link preview", previewState);
  const preview = element("div", "clay-seo-preview");
  preview.append(previewHead, ogCard, cardSize);

  const form = element("div", "clay-seo-fields");
  const counters = new Map();

  function buildField(key) {
    const spec = FIELD[key];
    const id = `clay-seo-${key}`;
    const wrap = element("div", "clay-seo-field");
    if (spec.full) wrap.classList.add("is-full");

    const input = element(
      spec.kind === "checkbox" ? "input" : spec.kind === "textarea" ? "textarea" : "input",
      spec.kind === "checkbox" ? "clay-seo-check" : "clay-seo-input",
    );
    if (spec.kind === "checkbox") {
      input.type = "checkbox";
      input.checked = opened[key] !== false;
    } else {
      if (spec.kind !== "textarea") input.type = "text";
      if (spec.short) {
        input.rows = 1;
        input.classList.add("is-short");
      }
      input.value = text(opened[key]);
    }
    if (spec.placeholder) input.placeholder = spec.placeholder;
    input.id = id;
    input.dataset.key = key;
    if (window.clay && window.clay.unsent) input.setAttribute("unsent", `seo-${key}`);
    inputs.set(key, input);

    const error = element("p", "clay-seo-error");
    error.hidden = true;
    errors.set(key, error);

    const conflict = element("div", "clay-seo-conflict");
    conflict.hidden = true;
    const theirsLine = element("p");
    const theirs = element("span", "clay-seo-theirs");
    theirsLine.append("Changed elsewhere: ", theirs);
    const theirsButton = element("button", "clay-menu-btn clay-menu-btn-small clay-seo-theirs-button", "Use theirs");
    theirsButton.type = "button";
    const mineButton = element("button", "clay-menu-btn clay-menu-btn-small clay-seo-mine-button", "Keep mine");
    mineButton.type = "button";
    conflict.append(theirsLine, theirsButton, mineButton);
    conflicts.set(key, { row: conflict, theirs });

    theirsButton.addEventListener("click", () => {
      const value = readHead(document).values[key];
      if (spec.kind === "checkbox") input.checked = value !== false;
      else input.value = text(value);
      chosen.add(key);
      conflict.hidden = true;
      refresh();
    });
    mineButton.addEventListener("click", () => {
      chosen.add(key);
      conflict.hidden = true;
    });

    if (spec.kind === "checkbox") {
      const label = element("label", "clay-seo-check");
      label.append(input, spec.label);
      wrap.append(label, error, conflict);
      return wrap;
    }

    const row = element("div", "clay-seo-label-row");
    const label = element("label");
    label.htmlFor = id;
    label.append(spec.label);
    if (spec.note) label.append(" ", element("span", null, `(${spec.note})`));
    row.append(label);
    if (spec.count) {
      const count = element("span", "clay-seo-count");
      counters.set(key, { el: count, max: spec.count });
      const aside = element("span", "clay-seo-aside");
      if (key === "title") aside.append(derivedButton);
      aside.append(count);
      row.append(aside);
    }
    wrap.append(row);
    if (key === "ogImage") {
      uploadRow.append(input, uploadButton, fileInput);
      wrap.append(uploadRow, pasteNote, publicNote);
    } else {
      wrap.append(input);
    }
    wrap.append(error, conflict);
    return wrap;
  }

  for (const key of BASE_KEYS) form.append(buildField(key));

  const more = element("details", "clay-seo-more");
  more.append(element("summary", null, "More search and social fields"));
  const moreGrid = element("div", "clay-seo-more-grid");
  for (const key of MORE_KEYS) moreGrid.append(buildField(key));
  const checks = element("div", "clay-seo-checks");
  for (const key of CHECK_KEYS) checks.append(buildField(key));
  checks.append(robotNote);
  moreGrid.append(checks);
  more.append(moreGrid);
  form.append(more);

  const editButton = element("button", "clay-seo-edit clay-menu-btn", "Edit these settings");
  editButton.type = "button";
  const cancelButton = element("button", "clay-seo-cancel clay-menu-btn", "Cancel");
  cancelButton.type = "button";
  const applyButton = element("button", "clay-seo-apply clay-menu-btn clay-menu-btn-primary", "Done");
  applyButton.type = "button";
  const actions = element("div", "clay-seo-actions");
  actions.append(editButton, cancelButton, applyButton);

  const heading = element("h2", "clay-seo-heading", LABEL);
  heading.id = "clay-seo-heading";
  const bar = element("div", "clay-seo-bar");
  bar.append(heading, actions);

  const grid = element("div", "clay-seo-grid");
  grid.append(form, preview);
  const inner = element("div", "clay-seo-inner");
  inner.append(bar, grid);
  root.append(inner);

  const readField = (key) => {
    const input = inputs.get(key);
    return input.type === "checkbox" ? input.checked : input.value;
  };

  function imageBase() {
    const canonical = text(readField("canonical")).trim();
    if (canonical && !canonicalProblem(canonical)) return canonical;
    return pageBase();
  }

  function imageSrc() {
    const raw = text(readField("ogImage")).trim();
    if (!raw || imageProblem(raw, imageBase())) return "";
    if (SCHEME.test(raw)) return raw;
    try {
      return new URL(raw, imageBase() || location.href).href;
    } catch {
      return "";
    }
  }

  function refresh() {
    const titleValue = text(readField("title")).trim();
    const descriptionValue = text(readField("description")).trim();
    inputs.get("ogTitle").placeholder = titleValue;
    inputs.get("ogDescription").placeholder = descriptionValue;

    for (const [key, entry] of counters) {
      const length = text(readField(key)).trim().length;
      entry.el.textContent = `${length} / ${entry.max}`;
      if (length > entry.max) entry.el.dataset.over = "";
      else delete entry.el.dataset.over;
    }

    const image = imageSrc();
    if (image) {
      previewImage.src = image;
      previewImage.hidden = false;
    } else {
      previewImage.removeAttribute("src");
      previewImage.hidden = true;
    }
    previewImageBox.hidden = previewImage.hidden;
    previewTitle.textContent = text(readField("ogTitle")).trim() || titleValue || "Untitled page";
    const description = text(readField("ogDescription")).trim() || descriptionValue;
    previewDescription.textContent = description;
    previewDescription.hidden = !description;
    previewHost.textContent = hostOf(readField("canonical")) || location.host || "";
    previewState.textContent = image ? "Large image card \u00b7 1.91:1" : "Summary card";
    cardSize.textContent = image ? "Shared links show the large image." : "Add an image for the large card.";
    derivedButton.hidden = !(isDocumentPage() && FIELDS.titleMode.read(document) === "custom");
  }

  function changes() {
    const out = {};
    for (const [key, input] of inputs) {
      const now = input.type === "checkbox" ? input.checked : input.value;
      if (now !== opened[key]) out[key] = now;
    }
    return out;
  }

  function problemsFor(wanted) {
    const found = {};
    if ("canonical" in wanted) {
      const problem = canonicalProblem(wanted.canonical);
      if (problem) found.canonical = problem;
    }
    if ("ogImage" in wanted) {
      const problem = imageProblem(wanted.ogImage, imageBase());
      if (problem) found.ogImage = problem;
    }
    return found;
  }

  function conflictsFor(wanted) {
    const current = readHead(document).values;
    const found = {};
    for (const key of Object.keys(wanted)) {
      if (chosen.has(key)) continue;
      if (current[key] === opened[key]) continue;
      if (current[key] === wanted[key]) continue;
      found[key] = current[key];
    }
    return found;
  }

  function revealMore(found) {
    for (const key of Object.keys(found)) {
      const input = inputs.get(key);
      if (input && more.contains(input)) {
        more.open = true;
        return;
      }
    }
  }

  function showProblems(found) {
    revealMore(found);
    for (const [key, el] of errors) {
      const message = found[key] || "";
      el.textContent = message;
      el.hidden = !message;
      if (message) inputs.get(key)?.setAttribute("aria-invalid", "true");
      else inputs.get(key)?.removeAttribute("aria-invalid");
    }
  }

  function showConflicts(found) {
    revealMore(found);
    for (const [key, entry] of conflicts) {
      const current = found[key];
      const visible = current !== undefined;
      entry.row.hidden = !visible;
      entry.theirs.textContent = visible ? showValue(key, current) : "";
    }
  }

  function apply() {
    if (!(window.clay && window.clay.mode === "edit")) {
      close();
      return;
    }
    const wanted = changes();
    const documentPage = isDocumentPage();
    const marker = documentPage ? pendingTitleMode || ("title" in wanted ? "custom" : "") : "";
    for (const entry of conflicts.values()) entry.row.hidden = true;
    showProblems({});
    if (!Object.keys(wanted).length && !marker) {
      close();
      return;
    }
    const problems = problemsFor(wanted);
    if (Object.keys(problems).length) {
      showProblems(problems);
      return;
    }
    const found = conflictsFor(wanted);
    if (Object.keys(found).length) {
      showConflicts(found);
      return;
    }
    const next = marker ? { ...wanted, titleMode: marker } : wanted;
    const undo = window.clay && window.clay.undo;
    if (undo && typeof undo.commit === "function") {
      undo.commit(UNDO_LABEL, () => applyHead(document, next));
    } else {
      const before = readHead(document).values;
      applyHead(document, next);
      offerUndo(before);
    }
    close();
    // Apply is an explicit save of these settings: a page that does not autosave its markup
    // (the page editor saves only its own stores) would otherwise keep them until edit ends.
    save();
  }

  function applyUploadVisibility() {
    const editing = !!(window.clay && window.clay.mode === "edit");
    uploadButton.hidden = !uploadAvailable || !editing;
    pasteNote.hidden = uploadAvailable || !editing;
    publicNote.hidden = !uploadAvailable || !editing || !/(^|\.)hyperclay\.com$/i.test(location.hostname);
  }

  function layout() {
    const editing = !!(window.clay && window.clay.mode === "edit");
    for (const input of inputs.values()) {
      if (input.type === "checkbox") input.disabled = !editing;
      else input.readOnly = !editing;
    }
    editButton.hidden = editing;
    cancelButton.hidden = !editing;
    applyUploadVisibility();
  }

  // A live entry commits edit without this page going anywhere, so the sheet's own
  // read-only layout has to follow the mode rather than the mode it opened in.
  function followMode() {
    if (closed) return;
    layout();
    // Uploads load with edit, so a sheet opened in view asks again once edit is live.
    if (!uploadAvailable) checkUploads();
  }

  function close() {
    if (closed) return;
    closed = true;
    pending.dispose();
    document.removeEventListener("clay:modechange", followMode);
    if (heightObserver) heightObserver.disconnect();
    heightVars.remove();
    ui?.remove();
    if (restoreTo && restoreTo.isConnected && typeof restoreTo.focus === "function") restoreTo.focus();
  }

  async function checkHostedRobots() {
    let response;
    try {
      response = await fetch(location.href, { method: "HEAD" });
    } catch {
      return;
    }
    if (closed || !root.isConnected) return;
    const tag = response && response.headers && typeof response.headers.get === "function" ? response.headers.get("x-robots-tag") : "";
    if (!tag || !/noindex/i.test(tag)) return;
    robotNote.textContent = ROBOTS_NOTE;
    robotNote.hidden = false;
  }

  async function checkUploads() {
    const call = window.clay && window.clay.upload;
    if (typeof call !== "function") return;
    let meta = null;
    try {
      meta = await hostMeta();
    } catch {
      meta = null;
    }
    if (closed || !root.isConnected) return;
    uploadAvailable = !!(meta && Array.isArray(meta.extensions) && meta.extensions.includes("upload"));
    layout();
  }

  form.addEventListener("input", () => {
    refresh();
    pending.changed();
  });

  inputs.get("title").addEventListener("input", () => {
    pendingTitleMode = "";
  });

  derivedButton.addEventListener("click", () => {
    pendingTitleMode = "derived";
    inputs.get("title").value = firstHeadingText();
    refresh();
  });

  uploadButton.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const call = window.clay && window.clay.upload;
    if (typeof call !== "function") return;
    uploadButton.disabled = true;
    let result;
    try {
      result = await call(file);
    } catch {
      result = null;
    }
    uploadButton.disabled = false;
    if (closed || !root.isConnected) return;
    const upload = result && result.ok && Array.isArray(result.uploads) ? result.uploads[0] : null;
    if (!upload || !upload.url) return;
    inputs.get("ogImage").value = upload.url;
    refresh();
  });

  applyButton.addEventListener("click", apply);
  cancelButton.addEventListener("click", close);

  editButton.addEventListener("click", async () => {
    const clay = window.clay;
    if (!clay || typeof clay.setMode !== "function") return;
    const storage = clay.storage && clay.storage.session;
    // The flag is the reload path's receipt: the page comes back in edit and this sheet
    // comes back with it. A live entry never leaves the page, so the sheet is still here
    // and the flag would outlive the reason it was set.
    if (storage) storage.set(REOPEN_KEY, true);
    let result;
    try {
      result = await clay.setMode("edit");
    } catch {
      result = null;
    }
    if (closed) return;
    const reloading = !!result && result.ok !== false && !!result.reloading;
    if (reloading) return;
    if (storage) storage.remove(REOPEN_KEY);
    const refusal = modeRefusalText(result);
    if (refusal) (window.clay?.menu?.note || window.clay?.toast)?.(refusal, "error");
    if (result && result.ok !== false) layout();
  });

  const heightVars = document.createElement("style");
  heightVars.id = "clay-seo-vars";
  heightVars.setAttribute("clay", "editor-ui");
  document.head.append(heightVars);
  let heightObserver = null;

  function writeHeight() {
    heightVars.textContent = `:root { --clay-seo-height: ${Math.ceil(root.getBoundingClientRect().height)}px; }`;
  }

  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    close();
  });

  document.addEventListener("clay:modechange", followMode);
  lookAt(root, { x: 0, y: 0, width: innerWidth, height: Math.min(200, innerHeight) }, MENU_SURFACE);
  ui = mountEditorUI({ name: "seo", content: root, css: [MENU_CSS, SHEET_CSS], before: document.body.firstChild });
  writeHeight();
  if (typeof ResizeObserver === "function") {
    heightObserver = new ResizeObserver(writeHeight);
    heightObserver.observe(root);
  }
  refresh();
  layout();
  inputs.get("title").focus();
  checkHostedRobots();
  checkUploads();
}
