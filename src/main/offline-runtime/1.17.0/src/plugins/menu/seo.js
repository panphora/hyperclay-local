// The SEO sheet: a panel that slides down from the top and edits the document's
// head fields. Everything it draws is `clay="editor-ui"`, so none of it reaches
// the saved file, a sync frame, the dirty check or undo. Nothing is written until
// Apply: opening and cancelling change only the sheet.
import { applyHead, FIELDS, readHead } from "./seo-head.js";
import { hostMeta } from "../../core/host-meta.js";
import { documentTitle } from "../../page/document-title.js";
import { registerUnsavedState } from "../../lib/unsaved-state.js";
import { modeRefusalText } from "../../core/mode-refusal.js";

const STYLE_ID = "clay-seo-style";
const REOPEN_KEY = "reopen-seo";
const LABEL = "SEO settings";
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const ROBOTS_NOTE =
  "This site is hidden from search engines in your account settings, so this page stays hidden whatever you choose here.";
const PUBLIC_NOTE = "Uploaded images are public to anyone with the link.";
const PASTE_NOTE = "Paste the address of an image on the web.";

const GROUPS = [
  {
    legend: "Basics",
    fields: [
      { key: "title", label: "Title", kind: "text" },
      { key: "description", label: "Description", kind: "textarea" },
      { key: "lang", label: "Language", kind: "text" },
      { key: "canonical", label: "Canonical URL", kind: "text" },
    ],
  },
  {
    legend: "Search",
    fields: [
      { key: "index", label: "Show in search results", kind: "checkbox" },
      { key: "follow", label: "Let search engines follow links", kind: "checkbox" },
    ],
  },
  {
    legend: "Link preview",
    fields: [
      { key: "ogTitle", label: "Preview title", kind: "text" },
      { key: "ogDescription", label: "Preview description", kind: "textarea" },
      { key: "ogImage", label: "Preview image", kind: "text" },
      { key: "ogImageAlt", label: "Image alt text", kind: "text" },
      { key: "siteName", label: "Site name", kind: "text" },
    ],
  },
  {
    legend: "Social card",
    fields: [{ key: "twitterSite", label: "Handle", kind: "text" }],
  },
];

const SHEET_CSS = `.clay-seo {
  position: fixed;
  top: 0;
  right: 0;
  left: 0;
  z-index: 2147482100;
  box-sizing: border-box;
  width: 100%;
  max-height: 100vh;
  margin: 0;
  padding: 16px;
  overflow-y: auto;
  border-bottom: 1px solid rgba(23, 28, 36, .16);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 14px;
  line-height: 1.4;
  color: var(--clay-ui-fg, #1F2328);
  background: var(--clay-ui-bg, #F4F4F5);
  box-shadow: 0 18px 40px -24px rgba(23, 28, 36, .55);
  animation: clay-seo-slide 200ms ease-out;
}
@keyframes clay-seo-slide {
  from { transform: translateY(-100%); }
  to { transform: translateY(0); }
}
.clay-seo-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.clay-seo-heading {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.2;
}
.clay-seo-x {
  width: 32px;
  height: 32px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  font: inherit;
  font-size: 18px;
  line-height: 1;
  color: inherit;
  background: none;
  cursor: pointer;
}
.clay-seo-x:hover,
.clay-seo-x:focus-visible { background: rgba(23, 28, 36, .08); outline: none; }
.clay-seo-preview {
  display: flex;
  gap: 12px;
  margin: 12px 0;
  padding: 10px;
  border: 1px solid rgba(23, 28, 36, .16);
  border-radius: 8px;
}
.clay-seo-preview-image {
  flex: none;
  width: 88px;
  height: 62px;
  border-radius: 6px;
  object-fit: cover;
}
.clay-seo-preview-text { min-width: 0; }
.clay-seo-preview-title {
  margin: 0;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.clay-seo-preview-description,
.clay-seo-preview-host {
  margin: 2px 0 0;
  font-size: 12px;
  opacity: .8;
}
.clay-seo-group {
  margin: 0 0 14px;
  padding: 0;
  border: 0;
}
.clay-seo-legend {
  padding: 0;
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .04em;
  text-transform: uppercase;
  opacity: .7;
}
.clay-seo-row {
  display: block;
  margin-bottom: 8px;
}
.clay-seo-caption {
  display: block;
  margin-bottom: 4px;
  font-size: 12px;
  opacity: .8;
}
.clay-seo-row-check {
  display: flex;
  align-items: center;
  gap: 8px;
}
.clay-seo-row-check .clay-seo-caption { margin-bottom: 0; }
.clay-seo-input {
  box-sizing: border-box;
  width: 100%;
  margin: 0;
  padding: 7px 9px;
  border: 1px solid rgba(23, 28, 36, .24);
  border-radius: 6px;
  font: inherit;
  color: inherit;
  background: rgba(250, 251, 252, .7);
}
.clay-seo-input:focus-visible { outline: 2px solid var(--clay-ui-accent, #2F6FEB); outline-offset: 1px; }
textarea.clay-seo-input { min-height: 64px; resize: vertical; }
.clay-seo-note {
  margin: 4px 0 0;
  font-size: 12px;
  opacity: .8;
}
.clay-seo-error {
  margin: 4px 0 0;
  font-size: 12px;
  color: #A63A2B;
}
.clay-seo-derived {
  margin: 4px 0 0;
  padding: 0;
  border: 0;
  font: inherit;
  font-size: 12px;
  color: var(--clay-ui-accent, #2F6FEB);
  background: none;
  text-decoration: underline;
  cursor: pointer;
}
.clay-seo-conflict {
  margin: 6px 0 0;
  padding: 8px;
  border: 1px solid rgba(23, 28, 36, .16);
  border-radius: 6px;
  font-size: 12px;
}
.clay-seo-conflict p { margin: 0 0 6px; }
.clay-seo-upload {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 4px 0 8px;
}
.clay-seo-upload .clay-seo-note { flex: 1 1 100%; margin: 0; }
.clay-seo-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
.clay-seo-actions button {
  padding: 8px 14px;
  border: 1px solid rgba(23, 28, 36, .24);
  border-radius: 6px;
  font: inherit;
  color: inherit;
  background: none;
  cursor: pointer;
}
.clay-seo-actions button:hover,
.clay-seo-actions button:focus-visible { outline: none; background: rgba(23, 28, 36, .08); }
.clay-seo-apply,
.clay-seo-edit {
  border-color: transparent;
  color: #F7F8FA;
  background: var(--clay-ui-accent, #2F6FEB);
}
.clay-seo-actions .clay-seo-apply:hover,
.clay-seo-actions .clay-seo-apply:focus-visible,
.clay-seo-actions .clay-seo-edit:hover,
.clay-seo-actions .clay-seo-edit:focus-visible { background: var(--clay-ui-accent, #2F6FEB); opacity: .9; }
.clay-seo-upload-button {
  padding: 6px 10px;
  border: 1px solid rgba(23, 28, 36, .24);
  border-radius: 6px;
  font: inherit;
  font-size: 12px;
  color: inherit;
  background: none;
  cursor: pointer;
}
@media (min-width: 600px) {
  .clay-seo {
    width: 560px;
    margin: 0 auto;
    padding: 16px;
    border: 1px solid rgba(23, 28, 36, .16);
    border-top: 0;
    border-radius: 0 0 12px 12px;
  }
}
@media (pointer: coarse) {
  .clay-seo-actions button,
  .clay-seo-upload-button { min-height: 44px; }
}
@media (prefers-color-scheme: dark) {
  .clay-seo {
    color: var(--clay-ui-fg, #E9E9EC);
    background: var(--clay-ui-bg, #26282C);
    border-color: rgba(233, 233, 236, .16);
  }
  .clay-seo-preview { border-color: rgba(233, 233, 236, .16); }
  .clay-seo-input {
    border-color: rgba(233, 233, 236, .16);
    background: rgba(233, 233, 236, .08);
  }
  .clay-seo-x:hover,
  .clay-seo-x:focus-visible,
  .clay-seo-actions button:hover,
  .clay-seo-actions button:focus-visible { background: rgba(233, 233, 236, .12); }
  .clay-seo-actions button { border-color: rgba(233, 233, 236, .24); }
  .clay-seo-conflict { border-color: rgba(233, 233, 236, .16); }
  .clay-seo-error { color: #F0A192; }
}
@media (prefers-reduced-motion: reduce) {
  .clay-seo { animation: none; }
}`;

const text = (value) => (value == null ? "" : String(value));

function element(tag, className, content) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (content != null) el.textContent = content;
  return el;
}

function stylesOnce() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.setAttribute("clay", "editor-ui");
  style.textContent = SHEET_CSS;
  document.head.append(style);
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

function run(label, fn) {
  const undo = window.clay && window.clay.undo;
  if (undo && typeof undo.commit === "function") return undo.commit(label, fn);
  return fn();
}

export function open() {
  if (document.querySelector(".clay-seo")) return;
  stylesOnce();

  const opened = readHead(document).values;
  const restoreTo = document.activeElement;
  const inputs = new Map();
  const errors = new Map();
  const conflicts = new Map();
  const chosen = new Set();
  let closed = false;
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
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "clay-seo-heading");

  const title = element("h2", "clay-seo-heading", LABEL);
  title.id = "clay-seo-heading";
  const closeButton = element("button", "clay-seo-x", "\u00d7");
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Close");
  const top = element("div", "clay-seo-top");
  top.append(title, closeButton);

  const previewImage = element("img", "clay-seo-preview-image");
  previewImage.alt = "";
  const previewTitle = element("p", "clay-seo-preview-title");
  const previewDescription = element("p", "clay-seo-preview-description");
  const previewHost = element("p", "clay-seo-preview-host");
  const previewText = element("div", "clay-seo-preview-text");
  previewText.append(previewTitle, previewDescription, previewHost);
  const preview = element("div", "clay-seo-preview");
  preview.append(previewImage, previewText);

  const form = element("div", "clay-seo-form");
  const robotNote = element("p", "clay-seo-note");
  robotNote.hidden = true;
  const cardSize = element("p", "clay-seo-note");

  function buildField(field) {
    const wrap = element("div", "clay-seo-field");
    const row = element("label", "clay-seo-row");
    const caption = element("span", "clay-seo-caption", field.label);
    const input =
      field.kind === "textarea" ? element("textarea", "clay-seo-input") : element("input", field.kind === "checkbox" ? "clay-seo-check" : "clay-seo-input");
    if (field.kind === "checkbox") {
      row.classList.add("clay-seo-row-check");
      input.type = "checkbox";
      input.checked = opened[field.key] !== false;
      row.append(input, caption);
    } else {
      if (field.kind !== "textarea") input.type = "text";
      input.value = text(opened[field.key]);
      row.append(caption, input);
    }
    input.dataset.key = field.key;
    if (window.clay && window.clay.unsent) input.setAttribute("unsent", `seo-${field.key}`);
    inputs.set(field.key, input);

    const error = element("p", "clay-seo-error");
    error.hidden = true;
    errors.set(field.key, error);

    const conflict = element("div", "clay-seo-conflict");
    conflict.hidden = true;
    const theirsLine = element("p");
    const theirs = element("span", "clay-seo-theirs");
    theirsLine.append("Changed elsewhere: ", theirs);
    const theirsButton = element("button", "clay-seo-theirs-button", "Use theirs");
    theirsButton.type = "button";
    const mineButton = element("button", "clay-seo-mine-button", "Keep mine");
    mineButton.type = "button";
    conflict.append(theirsLine, theirsButton, mineButton);
    conflicts.set(field.key, { row: conflict, theirs });

    theirsButton.addEventListener("click", () => {
      const value = readHead(document).values[field.key];
      if (field.kind === "checkbox") input.checked = value !== false;
      else input.value = text(value);
      chosen.add(field.key);
      conflict.hidden = true;
      refresh();
    });
    mineButton.addEventListener("click", () => {
      chosen.add(field.key);
      conflict.hidden = true;
    });

    wrap.append(row, error, conflict);
    return wrap;
  }

  for (const group of GROUPS) {
    const section = element("fieldset", "clay-seo-group");
    section.append(element("legend", "clay-seo-legend", group.legend));
    for (const field of group.fields) section.append(buildField(field));
    if (group.legend === "Search") section.append(robotNote);
    if (group.legend === "Social card") section.append(cardSize);
    form.append(section);
  }

  const derivedButton = element("button", "clay-seo-derived", "Use the first heading");
  derivedButton.type = "button";
  derivedButton.hidden = true;
  inputs.get("title").closest(".clay-seo-field").append(derivedButton);

  const imageInput = inputs.get("ogImage");
  const uploadButton = element("button", "clay-seo-upload-button", "Upload image");
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
  uploadRow.append(uploadButton, fileInput, pasteNote, publicNote);
  imageInput.closest(".clay-seo-field").append(uploadRow);

  const editButton = element("button", "clay-seo-edit", "Edit these settings");
  editButton.type = "button";
  const cancelButton = element("button", "clay-seo-cancel", "Cancel");
  cancelButton.type = "button";
  const applyButton = element("button", "clay-seo-apply", "Apply");
  applyButton.type = "button";
  const actions = element("div", "clay-seo-actions");
  actions.append(editButton, cancelButton, applyButton);

  root.append(top, preview, form, actions);

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

    const image = imageSrc();
    if (image) {
      previewImage.src = image;
      previewImage.hidden = false;
    } else {
      previewImage.removeAttribute("src");
      previewImage.hidden = true;
    }
    previewTitle.textContent = text(readField("ogTitle")).trim() || titleValue || "Untitled page";
    const description = text(readField("ogDescription")).trim() || descriptionValue;
    previewDescription.textContent = description;
    previewDescription.hidden = !description;
    previewHost.textContent = hostOf(readField("canonical")) || location.host || "";
    cardSize.textContent = image ? "Card size: Summary with a large image" : "Card size: Summary";
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

  function showProblems(found) {
    for (const [key, el] of errors) {
      const message = found[key] || "";
      el.textContent = message;
      el.hidden = !message;
    }
  }

  function showConflicts(found) {
    for (const [key, entry] of conflicts) {
      const current = found[key];
      const visible = current !== undefined;
      entry.row.hidden = !visible;
      entry.theirs.textContent = visible ? showValue(key, current) : "";
    }
  }

  function apply() {
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
    run(LABEL, () => applyHead(document, marker ? { ...wanted, titleMode: marker } : wanted));
    close();
  }

  function applyUploadVisibility() {
    uploadButton.hidden = !uploadAvailable;
    pasteNote.hidden = uploadAvailable;
    publicNote.hidden = !uploadAvailable || !/(^|\.)hyperclay\.com$/i.test(location.hostname);
  }

  function layout() {
    const editing = !!(window.clay && window.clay.mode === "edit");
    for (const input of inputs.values()) {
      if (input.type === "checkbox") input.disabled = !editing;
      else input.readOnly = !editing;
    }
    editButton.hidden = editing;
    cancelButton.hidden = !editing;
    applyButton.hidden = !editing;
    uploadRow.hidden = !editing || !uploadAvailable;
    applyUploadVisibility();
  }

  // A live entry commits edit without this page going anywhere, so the sheet's own
  // read-only layout has to follow the mode rather than the mode it opened in.
  function followMode() {
    if (!closed) layout();
  }

  function close() {
    if (closed) return;
    closed = true;
    pending.dispose();
    document.removeEventListener("clay:modechange", followMode);
    root.remove();
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

  function focusables() {
    return Array.from(root.querySelectorAll("button, input, textarea")).filter(
      (el) => !el.disabled && !el.hidden && el.tabIndex >= 0 && !el.closest("[hidden]"),
    );
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
  closeButton.addEventListener("click", close);

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
    if (refusal) window.clay?.toast?.(refusal, "error");
    if (result && result.ok !== false) layout();
  });

  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const all = focusables();
    if (!all.length) return;
    const first = all[0];
    const last = all[all.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  document.addEventListener("clay:modechange", followMode);
  document.body.append(root);
  refresh();
  layout();
  inputs.get("title").focus();
  checkHostedRobots();
  checkUploads();
}
