// The tool block: its node view and its CSS. Loaded the first time a document
// has or takes a tool block; it mounts through the host its caller supplies, or
// through a host it makes for an editor that has none.
import { openPageMenu } from "../chrome.js";
import { schema } from "../schema.js";
import { createToolHost } from "../tools.js";
import { toolViews } from "../tool-views.js";

export const TOOL_CSS = `
.page-tool-block { position: relative; min-height: 48px; border: 1px solid var(--page-rule); border-radius: 8px; padding: 12px; }
.page-tool-settings { position: absolute; top: 4px; inset-inline-end: 4px; border: 0; border-radius: 5px; background: var(--page-pop-bg); color: var(--page-ink-soft); font: 12px var(--page-font); padding: 5px 8px; cursor: pointer; opacity: 0; }
.page-tool-block:hover .page-tool-settings, .page-tool-block:focus-within .page-tool-settings { opacity: 1; }
.page-ai-panel { position: relative; z-index: 5; width: min(520px, 100%); box-sizing: border-box; margin: 12px auto; padding: 14px; border: 1px solid var(--page-pop-line); border-radius: 10px; background: var(--page-pop-bg); color: var(--page-pop-ink); box-shadow: var(--page-pop-shadow); }
.page-ai-panel textarea { width: 100%; min-height: 88px; box-sizing: border-box; padding: 8px; border: 1px solid var(--page-pop-line); border-radius: 6px; background: var(--page-pop-bg); color: inherit; font: inherit; resize: vertical; }
.page-ai-actions { display: flex; gap: 8px; margin-top: 8px; }
.page-ai-actions button { border: 1px solid var(--page-pop-line); border-radius: 6px; background: var(--page-pop-bg); color: inherit; font: inherit; padding: 5px 10px; cursor: pointer; }
.page-ai-status, [data-tool-note], [data-tool-error] { color: var(--page-danger); font-size: 0.85em; }`;

export class ToolView {
  constructor(node, view, getPos, { host, revise = null }) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.host = host;
    this.revise = revise;
    this.showingFallback = false;
    const doc = view.dom.ownerDocument;
    this.dom = doc.createElement("section");
    this.dom.className = "page-tool-block";
    this.dom.dataset.type = "tool";
    this.dom.dataset.id = node.attrs.id ?? "";
    this.dom.contentEditable = "false";
    this.content = doc.createElement("div");
    this.content.className = "page-tool-content";
    this.menu = doc.createElement("button");
    this.menu.type = "button";
    this.menu.className = "page-tool-settings";
    this.menu.textContent = "Tool options";
    this.menu.setAttribute("aria-label", "Tool options");
    this.menu.addEventListener("click", () => this.openMenu());
    this.dom.append(this.content, this.menu);
    this.mount();
  }

  mount() {
    this.instance?.dispose();
    this.instance = null;
    if (this.showingFallback) this.content.innerHTML = this.node.attrs.artifact?.fallbackHtml ?? "";
    else this.instance = this.host.mount(this.content, {
      id: this.node.attrs.id,
      artifact: this.node.attrs.artifact,
      rev: this.node.attrs.rev,
      seed: this.node.attrs.state,
    });
  }

  openMenu() {
    const items = [];
    if (this.revise) items.push({ label: "Revise…", run: () => this.revise(this.node.attrs.id, this.node.attrs.rev) });
    items.push({ label: this.showingFallback ? "Show tool" : "Show fallback", run: () => {
      this.showingFallback = !this.showingFallback;
      this.mount();
    } });
    items.push({ label: "Delete", run: () => {
      const pos = this.getPos();
      if (pos == null || this.view.state.doc.nodeAt(pos)?.type !== schema.nodes.tool) return;
      this.view.dispatch(this.view.state.tr.delete(pos, pos + this.node.nodeSize));
    } });
    openPageMenu(this.view, this.menu, items);
  }

  update(node) {
    if (node.type !== schema.nodes.tool || node.attrs.id !== this.node.attrs.id) return false;
    const changed = node.attrs.rev !== this.node.attrs.rev || JSON.stringify(node.attrs.artifact) !== JSON.stringify(this.node.attrs.artifact);
    this.node = node;
    if (changed) this.mount();
    return true;
  }

  stopEvent(event) { return this.dom.contains(event.target); }
  ignoreMutation() { return true; }
  destroy() { this.instance?.dispose(); this.instance = null; }
}

export function createFeature({ toolHost = null, revise = null, view = null } = {}) {
  const host = toolHost ?? createToolHost({ mode: "edit" });
  if (view) toolViews.set(view, host);
  return {
    id: "tool",
    nodeViews: {
      tool: (node, editorView, getPos) => new ToolView(node, editorView, getPos, { host, revise }),
    },
    css: TOOL_CSS,
    dispose() {
      if (view && toolViews.get(view) === host) toolViews.delete(view);
      if (!toolHost) host.dispose();
    },
  };
}
