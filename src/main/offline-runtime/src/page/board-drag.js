import { announce } from "./announce.js";
import { scrollParent } from "./drag.js";

const SLOP = 4;
const EDGE = 56;
const MAX_SPEED = 18;
const STRIP = ["id", "data-focus", "data-action", "data-card", "data-col"];

const middle = (node, axis) => {
  const r = node.getBoundingClientRect();
  return axis === "x" ? r.left + r.width / 2 : r.top + r.height / 2;
};
const speed = (at, lo, hi) => (at < lo + EDGE ? -MAX_SPEED * Math.min(1, (lo + EDGE - at) / EDGE) : at > hi - EDGE ? MAX_SPEED * Math.min(1, (at - (hi - EDGE)) / EDGE) : 0);
const same = (a, b) => a?.col === b?.col && a?.afterId === b?.afterId && !a === !b;

export class BoardDrag {
  constructor(host) {
    this.host = host;
    this.state = null;
    this.line = null;
    this.suppress = false;
    this.onMove = (e) => this.move(e);
    this.onUp = (e) => this.end(e);
    this.onCancel = (e) => { if (e.pointerId === this.state?.pointer) this.cancel(); };
    this.onKey = (e) => {
      if (e.key === "Escape" && this.state?.active) {
        e.preventDefault();
        e.stopPropagation();
        this.cancel();
      }
    };
    host.dom.addEventListener("pointerdown", (e) => this.start(e));
    host.dom.addEventListener("click", (e) => {
      if (!this.suppress) return;
      this.suppress = false;
      e.preventDefault();
      e.stopImmediatePropagation();
    }, true);
  }

  start(event) {
    const host = this.host;
    if (event.button !== 0 || event.pointerType === "touch" || this.state || !host.commands || !host.view.editable) return;
    const card = event.target.closest?.(".page-board-card[data-card]");
    const head = card ? null : event.target.closest?.(".page-board-head[data-col]");
    if (!card && (!head || event.target.closest("button, input"))) return;
    this.state = {
      kind: card ? "card" : "column", id: card ? card.dataset.card : head.dataset.col, pointer: event.pointerId,
      x0: event.clientX, y0: event.clientY, x: event.clientX, y: event.clientY, active: false, slot: null, raf: 0, ghost: null,
    };
    const doc = host.dom.ownerDocument;
    doc.addEventListener("pointermove", this.onMove);
    doc.addEventListener("pointerup", this.onUp);
    doc.addEventListener("pointercancel", this.onCancel);
  }

  move(event) {
    const s = this.state;
    if (!s || event.pointerId !== s.pointer) return;
    s.x = event.clientX;
    s.y = event.clientY;
    if (!s.active) {
      if (Math.hypot(s.x - s.x0, s.y - s.y0) <= SLOP) return;
      this.begin();
    }
    event.preventDefault();
    this.track();
  }

  source() {
    const { kind, id } = this.state;
    const nodes = kind === "card" ? this.host.dom.querySelectorAll(".page-board-card[data-card]") : this.host.lanes.querySelectorAll(".page-board-lane[data-col]");
    return [...nodes].find((node) => (kind === "card" ? node.dataset.card : node.dataset.col) === id) ?? null;
  }

  exists() {
    const { kind, id } = this.state, board = this.host.board;
    return kind === "card" ? Object.hasOwn(board.cards, id) : board.columnIds.includes(id);
  }

  begin() {
    const s = this.state, host = this.host;
    const source = this.source();
    if (!source || !this.exists()) return this.stop();
    if (host.menu !== null) host.closeMenu(false);
    s.active = true;
    const r = source.getBoundingClientRect();
    s.dx = s.x0 - r.left;
    s.dy = s.y0 - r.top;
    const ghost = source.cloneNode(true);
    for (const node of [ghost, ...ghost.querySelectorAll("*")]) for (const name of STRIP) node.removeAttribute(name);
    ghost.classList.add("page-board-ghost");
    ghost.setAttribute("aria-hidden", "true");
    ghost.setAttribute("inert", "");
    ghost.style.width = `${r.width}px`;
    s.ghost = ghost;
    host.dom.append(ghost);
    host.dom.classList.add("is-dragging");
    this.line = host.dom.ownerDocument.createElement(s.kind === "card" ? "li" : "div");
    this.line.className = s.kind === "card" ? "page-board-drop" : "page-board-drop is-column";
    this.line.setAttribute("aria-hidden", "true");
    host.dom.setPointerCapture?.(s.pointer);
    host.dom.addEventListener("lostpointercapture", this.onCancel);
    window.addEventListener("keydown", this.onKey, true);
    source.classList.add("is-drag-source");
    this.loop();
  }

  track(force = false) {
    const s = this.state;
    if (!s?.active) return;
    s.ghost.style.transform = `translate(${s.x - s.dx}px, ${s.y - s.dy}px)`;
    if (!this.exists()) return this.cancel();
    const slot = this.inBounds() ? (s.kind === "card" ? this.cardSlot() : this.columnSlot()) : null;
    if (!force && same(slot, s.slot)) return;
    s.slot = slot;
    this.paint();
  }

  inBounds() {
    const s = this.state, r = this.host.scroll.getBoundingClientRect();
    return s.x >= r.left - EDGE && s.x <= r.right + EDGE && s.y >= r.top - EDGE && s.y <= r.bottom + EDGE;
  }

  cardSlot() {
    const s = this.state;
    let lane = null, best = Infinity;
    for (const node of this.host.lanes.querySelectorAll(".page-board-lane[data-col]")) {
      const r = node.getBoundingClientRect();
      const distance = s.x < r.left ? r.left - s.x : s.x > r.right ? s.x - r.right : 0;
      if (distance < best) { best = distance; lane = node; }
    }
    if (!lane) return null;
    const cards = [...lane.querySelectorAll(".page-board-card[data-card]")].filter((node) => node.dataset.card !== s.id);
    const index = cards.filter((node) => middle(node, "y") < s.y).length;
    return { col: lane.dataset.col, afterId: index ? cards[index - 1].dataset.card : null };
  }

  columnSlot() {
    const s = this.state;
    const rtl = getComputedStyle(this.host.lanes).direction === "rtl";
    const lanes = [...this.host.lanes.querySelectorAll(".page-board-lane[data-col]")].filter((node) => node.dataset.col !== s.id);
    const index = lanes.filter((node) => (rtl ? middle(node, "x") > s.x : middle(node, "x") < s.x)).length;
    return { col: null, afterId: index ? lanes[index - 1].dataset.col : null };
  }

  paint() {
    const s = this.state, line = this.line;
    line.remove();
    if (!s.slot) return;
    const lanes = this.host.lanes;
    if (s.kind === "card") {
      const list = [...lanes.querySelectorAll(".page-board-lane[data-col]")].find((node) => node.dataset.col === s.slot.col)?.querySelector(".page-board-cards");
      const after = s.slot.afterId && [...(list?.querySelectorAll(".page-board-card[data-card]") ?? [])].find((node) => node.dataset.card === s.slot.afterId)?.closest("li");
      list?.insertBefore(line, after ? after.nextSibling : list.firstChild);
    } else {
      const after = s.slot.afterId && [...lanes.querySelectorAll(".page-board-lane[data-col]")].find((node) => node.dataset.col === s.slot.afterId);
      lanes.insertBefore(line, after ? after.nextSibling : lanes.firstChild);
    }
  }

  repaint() {
    if (!this.state?.active) return;
    this.source()?.classList.add("is-drag-source");
    this.track(true);
  }

  loop() {
    const step = () => {
      const s = this.state;
      if (!s?.active) return;
      const box = this.host.scroll.getBoundingClientRect();
      const page = scrollParent(this.host.dom);
      const pageBox = page === page.ownerDocument.scrollingElement ? { top: 0, bottom: window.innerHeight } : page.getBoundingClientRect();
      const vx = speed(s.x, box.left, box.right), vy = speed(s.y, pageBox.top, pageBox.bottom);
      if (vx) this.host.scroll.scrollLeft += vx;
      if (vy) page.scrollTop += vy;
      if (vx || vy) this.track();
      if (this.state === s) s.raf = requestAnimationFrame(step);
    };
    this.state.raf = requestAnimationFrame(step);
  }

  end(event) {
    const s = this.state;
    if (!s || event.pointerId !== s.pointer) return;
    if (!s.active) return this.stop();
    event.preventDefault();
    this.suppress = true;
    setTimeout(() => { this.suppress = false; }, 0);
    const { kind, id, slot } = s;
    this.stop();
    const host = this.host;
    if (!slot) return announce(host.view, "Move cancelled");
    const result = kind === "card" ? host.run("moveCard", id, { columnId: slot.col, afterId: slot.afterId }) : host.run("moveColumn", id, { afterId: slot.afterId });
    if (result.status !== "moved") return;
    if (kind === "card") {
      announce(host.view, `Moved card to ${host.board.columns[slot.col]?.name || "Untitled"}`);
      host.focusKey(`card:${id}`);
    } else announce(host.view, "Moved column");
  }

  cancel() {
    this.stop();
    announce(this.host.view, "Move cancelled");
  }

  stop() {
    const s = this.state, host = this.host;
    if (!s) return;
    this.state = null;
    cancelAnimationFrame(s.raf);
    const doc = host.dom.ownerDocument;
    doc.removeEventListener("pointermove", this.onMove);
    doc.removeEventListener("pointerup", this.onUp);
    doc.removeEventListener("pointercancel", this.onCancel);
    host.dom.removeEventListener("lostpointercapture", this.onCancel);
    window.removeEventListener("keydown", this.onKey, true);
    if (host.dom.hasPointerCapture?.(s.pointer)) host.dom.releasePointerCapture(s.pointer);
    s.ghost?.remove();
    this.line?.remove();
    this.line = null;
    host.dom.classList.remove("is-dragging");
    for (const node of host.dom.querySelectorAll(".is-drag-source")) node.classList.remove("is-drag-source");
  }
}
