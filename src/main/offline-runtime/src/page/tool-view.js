import { schema } from "./schema.js";
import { openPageMenu } from "./chrome.js";

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
