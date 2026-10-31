/**
 * recovery-ui.js — the review a page shows for journaled work it may not replay.
 *
 * A capsule this page cannot apply (another authority, another generation, a newer
 * external file, a foreign lineage) is still the person's work, so it is drawn here as
 * the page it reconstructs, can be downloaded, and can be recovered as a copy: fresh
 * block ids, inserted through the page's own document command, never a blind merge.
 * Text typed during a composition that never became a transaction is offered the same
 * way, as text.
 *
 * Loaded lazily, only when there is something to review: a page with nothing held aside
 * pays for none of this, and a reader pays for it never.
 */

import { model, state as pmState } from "../vendor/prosemirror.vendor.js";
import { schema } from "./schema.js";
import { keysBetween, newId, nodeFromBlock } from "./model.js";
import { downloadStored } from "../core/conflict-download.js";
import {
  imeEntries,
  openImeShadow,
  pageCopyChannel,
  pageImeChannel,
  reconstructPage,
  recoverAsCopy,
} from "./ybind/recovery-replay.js";

export const REVIEW_TEXT = "Work from an earlier session could not be put back. Read it, download it, or recover it as a copy.";

const STYLE_ID = "page-recovery-style";
const STYLES = `
.page-recovery { position: fixed; right: 16px; bottom: 16px; z-index: 20; min-height: 36px; padding: 0 14px; font: inherit; font-size: 14px; color: var(--page-ink); background: var(--page-pop-bg); border: 1px solid var(--page-chrome-line-rest); border-radius: 999px; cursor: pointer; }
.page-recovery[hidden], .page-recovery-panel[hidden] { display: none; }
.page-recovery-panel { position: fixed; right: 16px; bottom: 64px; z-index: 21; width: min(420px, calc(100vw - 32px)); max-height: 60vh; overflow-y: auto; color: var(--page-ink); background: var(--page-pop-bg); border: 1px solid var(--page-chrome-line-rest); border-radius: var(--page-chrome-radius); padding: 8px; box-sizing: border-box; }
.page-recovery-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 6px 8px; font-weight: 600; }
.page-recovery-note { margin: 0 6px 8px; font-size: 13px; opacity: .72; }
.page-recovery-failure { margin: 0 6px 8px; font-size: 13px; color: var(--page-warn, #b25b00); }
.page-recovery-row { display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; align-items: center; min-height: 44px; padding: 8px 6px; border-top: 1px solid var(--page-chrome-line-rest); }
.page-recovery-meta { grid-column: 1; font-size: 12px; opacity: .72; }
.page-recovery-text { grid-column: 1; overflow-wrap: anywhere; white-space: pre-wrap; }
.page-recovery-row button, .page-recovery-head button { grid-column: 2; grid-row: 1 / span 2; min-height: 36px; padding: 0 12px; font: inherit; font-size: 14px; color: inherit; background: transparent; border: 1px solid var(--page-chrome-line-rest); border-radius: var(--page-chrome-radius); cursor: pointer; }
.page-recovery-row.is-busy button { opacity: .6; cursor: progress; }
@media (max-width: 560px) {
  .page-recovery { top: 12px; bottom: auto; min-height: 44px; }
  .page-recovery-panel { left: 0; right: 0; bottom: 0; width: 100%; max-height: 70vh; border-radius: var(--page-chrome-radius) var(--page-chrome-radius) 0 0; }
  .page-recovery-row button, .page-recovery-head button { min-height: 44px; }
}
`;

const PREVIEW_LIMIT = 280;

const el = (doc, tag, className, attrs = {}) => {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
};

function ensureStyle(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLES;
  doc.head.append(style);
}

const ordered = (blocks) =>
  Object.keys(blocks).sort((a, b) => {
    const left = typeof blocks[a]?.pos === "string" ? blocks[a].pos : "";
    const right = typeof blocks[b]?.pos === "string" ? blocks[b].pos : "";
    if (left !== right) return left < right ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });

/**
 * One reconstructed page as a copy: fresh block ids, and every parent remapped to its
 * parent's new id, so a toggle's body arrives with its toggle.
 *
 * @param {Object} blocks - a reconstructed page, by block id
 * @returns {Array<Object>} block records carrying their own id and order key
 */
export function copyBlocks(blocks) {
  const order = ordered(blocks ?? {});
  const ids = new Map(order.map((id) => [id, newId()]));
  const keys = keysBetween(null, null, order.length);
  return order.map((id, at) => {
    const block = blocks[id];
    const parent = typeof block?.parent === "string" ? ids.get(block.parent) ?? null : null;
    return { ...block, id: ids.get(id), pos: keys[at], parent };
  });
}

/**
 * The nodes a copy of one reconstructed page is inserted as.
 *
 * A block this runtime cannot build keeps its text as a paragraph, so no writing is
 * lost to a newer format.
 *
 * @param {Object} blocks - a reconstructed page, by block id
 * @returns {Array<Object>} ProseMirror nodes
 */
export function copyNodes(blocks) {
  const nodes = [];
  for (const block of copyBlocks(blocks)) {
    let node = null;
    try {
      node = nodeFromBlock(schema, block.id, block);
    } catch (_) {
      node = null;
    }
    if (!node && typeof block.c === "string" && block.c) {
      node = schema.nodes.paragraph.create({ id: block.id, pos: block.pos, parent: block.parent }, schema.text(block.c));
    }
    if (node) nodes.push(node);
  }
  return nodes;
}

/**
 * Insert one reconstructed page at the end of the document, through the normal command.
 *
 * A single transaction the page turns into its own ops: journaled, offered to the room
 * and undoable, exactly as typing it would be.
 *
 * @param {Object} view - the live editor view
 * @param {Object} blocks - a reconstructed page, by block id
 * @returns {{ok: boolean, code?: string, ids?: Array<string>}}
 */
export function insertCopy(view, blocks) {
  if (!view || !view.state) return { ok: false, code: "no-editor" };
  const nodes = copyNodes(blocks ?? {});
  if (!nodes.length) return { ok: false, code: "nothing-to-copy" };
  const state = view.state;
  const tr = state.tr.insert(state.doc.content.size, model.Fragment.from(nodes));
  tr.setSelection(pmState.Selection.near(tr.doc.resolve(tr.doc.content.size - 1)));
  view.dispatch(tr.scrollIntoView());
  return { ok: true, ids: nodes.map((node) => node.attrs.id) };
}

const preview = (doc, text) => {
  const box = el(doc, "div", "page-recovery-text");
  box.textContent = text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT)}…` : text;
  return box;
};

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {}
  const field = globalThis.document?.createElement("textarea");
  if (!field) return false;
  field.value = text;
  field.style.setProperty("position", "fixed", "important");
  field.style.setProperty("opacity", "0", "important");
  globalThis.document.body?.append(field);
  field.select();
  let ok = false;
  try {
    ok = globalThis.document.execCommand?.("copy") === true;
  } catch (_) {}
  field.remove();
  return ok;
}

/**
 * The review panel for journaled work this page may not replay.
 *
 * @param {Object} options
 * @param {Element} options.mount - where the button and panel live
 * @param {Function} [options.getView] - the live editor view, or null
 * @param {Function} [options.getJournal] - this session's page journal, or null
 * @param {?Object} [options.service] - `clay.recovery`
 * @param {Function} [options.isCurrent] - whether this session still owns the page
 * @param {Function} [options.onCopied] - (row, receipt) after a copy reached this device
 * @param {Function} [options.onCovered] - (row) when a save proved the copy is in the page
 * @returns {Object}
 */
export function createRecoveryReview({
  mount,
  getView = () => null,
  getJournal = () => null,
  service = globalThis.window?.clay?.recovery ?? null,
  isCurrent = () => true,
  onCopied = () => {},
  onCovered = () => {},
} = {}) {
  const doc = mount.ownerDocument;
  ensureStyle(doc);
  const button = el(doc, "button", "page-recovery", { type: "button", "aria-haspopup": "dialog", "aria-expanded": "false" });
  const panel = el(doc, "div", "page-recovery-panel", { role: "dialog", "aria-label": "Recover work" });
  button.hidden = true;
  panel.hidden = true;
  mount.append(button, panel);

  let rows = [];
  let journaled = [];
  let failure = null;
  let copied = new Set();
  const busy = new Set();
  let copies = null;
  let shadow = null;
  let destroyed = false;

  const total = () => rows.length + journaled.length;

  const ensureCopyChannel = () => {
    if (copies) return copies;
    try {
      copies = pageCopyChannel(service);
    } catch (_) {
      copies = null;
    }
    return copies;
  };

  const ensureShadow = () => {
    if (shadow) return shadow;
    try {
      shadow = openImeShadow({ channel: pageImeChannel(service), key: getJournal()?.key ?? "" });
    } catch (_) {
      shadow = null;
    }
    return shadow;
  };

  const close = () => {
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
  };

  const download = () => {
    const edits = [];
    for (const row of rows) edits.push({ id: row.id, kind: "recovered-page", name: row.message, yours: row.text, now: "", sentence: row.message });
    const composing = "Text typed while composing never reached the page.";
    for (const row of journaled) edits.push({ id: row.id, kind: "composing", name: "Typed text", yours: row.text, now: "", sentence: composing });
    if (!downloadStored({ html: null, edits })) failure = "That download could not be made.";
    draw();
  };

  // Recover as a copy. Nothing of the capsule's own operations is merged: the page is
  // inserted as a local edit with fresh ids, and the destination record the journal
  // commits is what the transfer marker names.
  async function recover(row) {
    if (!row || busy.has(row.id) || copied.has(row.id)) return { ok: false, code: "busy" };
    busy.add(row.id);
    failure = null;
    draw();
    try {
      if (!isCurrent()) return { ok: false, code: "stale" };
      const journal = getJournal();
      const channel = journal?.channel ?? null;
      const marks = ensureCopyChannel();
      const result = await recoverAsCopy({
        channel,
        copies: marks,
        source: { key: journal?.key ?? "", id: row.id, revision: row.revision },
        insert: async () => {
          if (!isCurrent()) throw new Error("stale");
          const view = getView();
          if (!view) throw new Error("no-editor");
          const waiting = journal?.next ? journal.next() : null;
          const blocks = row.blocks ?? reconstructPage({ capsule: row.capsule, batches: row.batches ?? [] });
          const inserted = insertCopy(view, blocks);
          if (!inserted.ok) throw new Error(inserted.code);
          if (!waiting) throw new Error("no-journal");
          const record = await waiting;
          if (!record) throw new Error("not-stored");
          return { key: journal?.key ?? "", id: record.id, revision: record.revision };
        },
      });
      if (!result.ok && !isCurrent()) return { ok: false, code: "stale" };
      if (result.ok) {
        copied.add(row.id);
        onCopied(row, result);
      } else if (result.code === "insert-failed") {
        failure = "That copy could not be stored on this device. It is still here to try again.";
      } else if (result.code === "already-copied") {
        copied.add(row.id);
        failure = "This work was already recovered as a copy.";
      } else if (result.code === "covered") {
        onCovered(row);
      } else if (result.code !== "stale" && result.code !== "busy") {
        failure = "Recovery is unavailable here. Download the copy instead.";
      }
      return result;
    } finally {
      busy.delete(row.id);
      if (!destroyed) draw();
    }
  }

  async function dismiss(row) {
    if (!row || !shadow) return { ok: false, code: "unavailable" };
    const record = journaled.find((entry) => entry.id === row.id);
    if (!record) return { ok: false, code: "unknown" };
    try {
      const receipt = await shadow.channel.dismiss(record.id, { revision: record.revision });
      if (receipt?.ok) journaled = journaled.filter((entry) => entry.id !== record.id);
      draw();
      return receipt;
    } catch (_) {
      return { ok: false, code: "error" };
    }
  }

  const rowButton = (label, onClick) => {
    const node = el(doc, "button", "", { type: "button" });
    node.textContent = label;
    node.addEventListener("click", onClick);
    return node;
  };

  function draw() {
    panel.replaceChildren();
    const head = el(doc, "div", "page-recovery-head");
    head.append(doc.createTextNode("Recover work"));
    head.append(rowButton("Download", download));
    const done = rowButton("Close", () => { close(); button.focus(); });
    head.append(done);
    const note = el(doc, "p", "page-recovery-note");
    note.textContent = REVIEW_TEXT;
    panel.append(head, note);
    if (failure) {
      const line = el(doc, "p", "page-recovery-failure");
      line.textContent = failure;
      panel.append(line);
    }
    for (const row of rows) {
      const item = el(doc, "div", "page-recovery-row", { "data-capsule": String(row.id) });
      if (busy.has(row.id)) item.classList.add("is-busy");
      const meta = el(doc, "div", "page-recovery-meta");
      meta.textContent = `${row.message}${copied.has(row.id) ? " · Recovered as a copy" : ""}`;
      const action = rowButton("Recover as a copy", () => recover(row));
      action.disabled = busy.has(row.id) || copied.has(row.id);
      item.append(meta, preview(doc, row.text || "(no text)"), action);
      panel.append(item);
    }
    for (const row of journaled) {
      const item = el(doc, "div", "page-recovery-row", { "data-composing": row.blockId });
      const meta = el(doc, "div", "page-recovery-meta");
      meta.textContent = "Text typed while composing. It never reached the page.";
      item.append(meta, preview(doc, row.text));
      const actions = el(doc, "div", "");
      actions.append(
        rowButton("Copy", async () => { if (!(await copyText(row.text))) failure = "Could not copy. Select the text instead."; draw(); }),
        rowButton("Dismiss", () => dismiss(row)),
      );
      item.append(actions);
      panel.append(item);
    }
  }

  const open = () => {
    if (!total()) return false;
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
    draw();
    panel.querySelector("button")?.focus();
    return true;
  };

  button.addEventListener("click", () => (panel.hidden ? open() : close()));
  panel.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    close();
    button.focus();
  });

  // A composition is never forced into a transaction: its block's visible text is
  // shadowed while it is active, and retired on composition end only when a journaled
  // update already carries that text.
  const composing = new Map();
  const blockOf = (event) => {
    const target = event?.target;
    const element = target?.closest?.("[data-id]") ?? null;
    const id = element?.getAttribute?.("data-id") ?? null;
    return { blockId: id, text: element?.textContent ?? "" };
  };
  const onCompose = (event) => {
    const found = blockOf(event);
    if (!found.blockId) return;
    composing.set(found.blockId, found.text);
    ensureShadow()?.keep(found);
  };
  const onComposed = (event) => {
    const found = blockOf(event);
    const kept = composing.get(found.blockId);
    composing.delete(found.blockId);
    const holder = ensureShadow();
    if (!holder) return;
    const journal = getJournal();
    const text = found.text || kept || "";
    const covered = journal?.covers ? journal.covers(found.blockId, text) : false;
    holder.clear({ blockId: found.blockId, text, covered }).then((receipt) => {
      if (receipt?.ok) refresh();
    }, () => {});
  };

  /**
   * Attach the composition listeners to the editing surface.
   *
   * @param {Element} root
   * @returns {Function} detach
   */
  function watch(root) {
    if (!root) return () => {};
    root.addEventListener("compositionstart", onCompose);
    root.addEventListener("compositionupdate", onCompose);
    root.addEventListener("compositionend", onComposed);
    return () => {
      root.removeEventListener("compositionstart", onCompose);
      root.removeEventListener("compositionupdate", onCompose);
      root.removeEventListener("compositionend", onComposed);
    };
  }

  // What the store holds for this page: composition shadows it kept, offered as text.
  async function refresh() {
    const holder = ensureShadow();
    if (!holder || destroyed) return journaled;
    let listed = null;
    try {
      listed = await holder.list();
    } catch (_) {
      listed = null;
    }
    if (destroyed) return journaled;
    journaled = listed?.ok ? imeEntries(listed.records) : [];
    update({ rows, refreshText: false });
    return journaled;
  }

  function update({ rows: next = rows, refreshText = true } = {}) {
    rows = (next || []).map((row) => ({ ...row }));
    const count = total();
    button.hidden = count === 0;
    button.textContent = `Recover work (${count})`;
    if (!count) close();
    else if (!panel.hidden) draw();
    if (refreshText) refresh();
    return rows;
  }

  return {
    open,
    close,
    download,
    recover,
    dismiss,
    refresh,
    watch,
    update,
    get count() { return total(); },
    get rows() { return rows; },
    get journaled() { return journaled; },
    destroy() {
      destroyed = true;
      button.remove();
      panel.remove();
      shadow = null;
      copies = null;
    },
  };
}
