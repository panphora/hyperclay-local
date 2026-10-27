import toast, { toastPersistent, dismissPersistent } from "../ui/toast-lazy.js";
import { state as pmState } from "../vendor/prosemirror.vendor.js";

export const NOTICE_TEXT = "Some text you typed was kept aside when its block moved or was removed.";

const STYLE_ID = "page-recover-style";
const STYLES = `
.page-recover { position: fixed; right: 16px; bottom: 16px; z-index: 20; min-height: 36px; padding: 0 14px; font: inherit; font-size: 14px; color: var(--page-ink); background: var(--page-pop-bg); border: 1px solid var(--page-chrome-line-rest); border-radius: 999px; cursor: pointer; }
.page-recover[hidden], .page-recover-panel[hidden] { display: none; }
.page-recover-panel { position: fixed; right: 16px; bottom: 64px; z-index: 21; width: min(380px, calc(100vw - 32px)); max-height: 60vh; overflow-y: auto; color: var(--page-ink); background: var(--page-pop-bg); border: 1px solid var(--page-chrome-line-rest); border-radius: var(--page-chrome-radius); padding: 8px; box-sizing: border-box; }
.page-recover-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 6px 8px; font-weight: 600; }
.page-recover-note { margin: 0 6px 8px; font-size: 13px; opacity: .72; }
.page-recover-row { display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; align-items: center; min-height: 44px; padding: 8px 6px; border-top: 1px solid var(--page-chrome-line-rest); }
.page-recover-row.is-target { outline: 2px solid var(--page-accent, currentColor); outline-offset: -2px; }
.page-recover-meta { grid-column: 1; font-size: 12px; opacity: .72; }
.page-recover-text { grid-column: 1; overflow-wrap: anywhere; }
.page-recover-text mark { background: var(--page-mark-bg, rgba(255, 214, 102, .45)); color: inherit; border-radius: 2px; }
.page-recover-row button, .page-recover-head button { grid-column: 2; grid-row: 1 / span 2; min-height: 36px; padding: 0 12px; font: inherit; font-size: 14px; color: inherit; background: transparent; border: 1px solid var(--page-chrome-line-rest); border-radius: var(--page-chrome-radius); cursor: pointer; }
@media (max-width: 560px) {
  .page-recover { top: 12px; bottom: auto; min-height: 44px; }
  .page-recover-panel { left: 0; right: 0; bottom: 0; width: 100%; max-height: 70vh; border-radius: var(--page-chrome-radius) var(--page-chrome-radius) 0 0; }
  .page-recover-row button, .page-recover-head button { min-height: 44px; }
}
`;

const TYPE_LABELS = { heading: "Heading", list_item: "List item", toggle: "Toggle", quote: "Quote", code_block: "Code", callout: "Callout", table: "Table", image: "Image" };
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

function previewOf(doc, record) {
  const out = el(doc, "div", "page-recover-text");
  let used = 0;
  for (const block of record.blocks) {
    for (const run of block.runs) {
      if (run.kind !== "text" || used >= PREVIEW_LIMIT) continue;
      const text = run.text.slice(0, PREVIEW_LIMIT - used);
      used += text.length;
      out.append(run.displaced ? Object.assign(doc.createElement("mark"), { textContent: text }) : doc.createTextNode(text));
    }
    if (used < PREVIEW_LIMIT && block !== record.blocks[record.blocks.length - 1]) out.append(doc.createTextNode(" / "));
  }
  if (!out.textContent) out.textContent = "(no text)";
  return out;
}

function authorsOf(record) {
  const out = new Set();
  for (const block of record.blocks) for (const run of block.runs) if (run.displaced) out.add(run.author ?? null);
  return [...out];
}

export function focusBlock(view, id) {
  let at = null;
  view.state.doc.forEach((node, pos) => { if (at === null && node.attrs.id === id) at = node.isTextblock ? pos + 1 : pos; });
  if (at === null) return false;
  view.dispatch(view.state.tr.setSelection(pmState.Selection.near(view.state.doc.resolve(at))).scrollIntoView());
  view.focus();
  return true;
}

export function createRecoverList({ binding, mount, ownTokens = [], onRestored = () => {}, onStale = () => {} }) {
  const doc = mount.ownerDocument;
  ensureStyle(doc);
  const own = new Set(ownTokens.filter(Boolean));
  const button = el(doc, "button", "page-recover", { type: "button", "aria-haspopup": "dialog", "aria-expanded": "false" });
  const panel = el(doc, "div", "page-recover-panel", { role: "dialog", "aria-label": "Recover changes" });
  button.hidden = true;
  panel.hidden = true;
  mount.append(button, panel);

  let snapshot = { recoverable: [], notices: [] };
  let target = null;
  let noticeSignature = "";

  const who = (tokens) => {
    if (tokens.some((token) => own.has(token))) return tokens.length > 1 ? "You and others" : "You";
    return tokens.some((token) => token !== null) ? "Another editor" : "An earlier edit";
  };

  const close = () => {
    panel.hidden = true;
    target = null;
    button.setAttribute("aria-expanded", "false");
  };

  const restore = (record) => {
    let result;
    try {
      result = binding.restore(record.source, record.revision);
    } catch (error) {
      console.error("[clay] Restore failed:", error);
      toast("This change could not be restored.", "error");
      return { status: "failed" };
    }
    if (result.status === "restored" || result.status === "resolved") onRestored(result.id);
    else if (result.status === "stale") onStale(result);
    return result;
  };

  const draw = () => {
    panel.replaceChildren();
    const head = el(doc, "div", "page-recover-head");
    head.append(doc.createTextNode("Recover changes"));
    const done = el(doc, "button", "", { type: "button" });
    done.textContent = "Close";
    done.addEventListener("click", () => { close(); button.focus(); });
    head.append(done);
    const note = el(doc, "p", "page-recover-note");
    note.textContent = "Text typed while its block was moved or removed. Restore puts it back as a new block.";
    panel.append(head, note);
    for (const record of snapshot.recoverable) {
      const row = el(doc, "div", "page-recover-row", { "data-source": record.source });
      if (record.source === target) row.classList.add("is-target");
      const meta = el(doc, "div", "page-recover-meta");
      meta.textContent = `${TYPE_LABELS[record.type] ?? "Paragraph"} · ${who(authorsOf(record))}`;
      const action = el(doc, "button", "", { type: "button" });
      action.textContent = "Restore";
      action.addEventListener("click", () => restore(record));
      row.append(meta, previewOf(doc, record), action);
      panel.append(row);
    }
  };

  const open = (source = null) => {
    if (!snapshot.recoverable.length) return;
    target = source;
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
    draw();
    const rows = [...panel.querySelectorAll(".page-recover-row")];
    const focus = (rows.find((row) => row.dataset.source === source) ?? rows[0])?.querySelector("button");
    focus?.focus();
  };

  const showNotices = (notices) => {
    const signature = notices.map((notice) => `${notice.source}\u0000${notice.revision}`).join("\n");
    if (signature === noticeSignature) return;
    noticeSignature = signature;
    if (!notices.length) { dismissPersistent(NOTICE_TEXT); return; }
    toastPersistent(NOTICE_TEXT, "warning", {
      actions: [
        { label: "Review", onClick: () => open(notices[0].source) },
        { label: "Dismiss", onClick: () => { for (const notice of notices) binding.dismiss(notice.source, notice.revision); } },
      ],
    });
  };

  const update = (next) => {
    snapshot = next;
    const count = next.recoverable.length;
    button.hidden = count === 0;
    button.textContent = `Recover changes (${count})`;
    if (!count) close();
    else if (!panel.hidden) draw();
    showNotices(next.notices);
  };

  button.addEventListener("click", () => (panel.hidden ? open() : close()));
  panel.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    close();
    button.focus();
  });
  const off = binding.subscribeRecovery(update);

  return {
    open,
    close,
    restore,
    get count() { return snapshot.recoverable.length; },
    destroy() {
      off();
      dismissPersistent(NOTICE_TEXT);
      button.remove();
      panel.remove();
    },
  };
}
