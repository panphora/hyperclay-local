import { siblingSpan, BlockSelection, captureSpan, resolveSpan } from "./blocks.js";
import { outlineOf } from "./outline-cache.js";
import { selectBlocks, asStep } from "./blocksel.js";
import { gapTargets, summaryTarget, pickTarget, moveSpanTo } from "./drop.js";
import { announce } from "./announce.js";

const SLOP = 4;
const HOLD = 250;
const HOLD_SLOP = 8;
const EDGE = 56;
const MAX_SPEED = 18;

export function scrollParent(el) {
  for (let n = el.parentElement; n; n = n.parentElement) {
    const o = getComputedStyle(n).overflowY;
    if ((o === "auto" || o === "scroll") && n.scrollHeight > n.clientHeight) return n;
  }
  return el.ownerDocument.scrollingElement;
}

// The blocks a pointer can land on, in vertical order: one list per outline, so
// every frame of a drag searches it instead of walking the document.
const visibles = new WeakMap();

function visibleOf(ents, view) {
  let list = visibles.get(ents);
  if (!list) {
    list = [];
    for (const e of ents) {
      if (e.hidden) continue;
      const dom = view.nodeDOM(e.at);
      if (dom?.getBoundingClientRect) list.push({ i: e.i, dom });
    }
    visibles.set(ents, list);
  }
  return list;
}

// The first visible entry whose vertical midpoint is below y, or -1 when the
// pointer is past every block.
function firstBelow(list, y) {
  let lo = 0, hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const r = list[mid].dom.getBoundingClientRect();
    if (y < r.top + r.height / 2) hi = mid;
    else lo = mid + 1;
  }
  return lo < list.length ? lo : -1;
}

export class BlockDrag {
  constructor(view, grip, { index, onClick }) {
    this.view = view;
    this.grip = grip;
    this.index = index;
    this.onClick = onClick;
    this.shell = view.dom.parentElement;
    this.line = document.createElement("div");
    this.line.className = "page-drop";
    this.line.hidden = true;
    this.line.setAttribute("aria-hidden", "true");
    this.shell.append(this.line);
    this.state = null;
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
    this.onOther = (e) => { if (this.state && e.pointerId !== this.state.pointer) this.cancel(); };
    this.onBlur = () => this.cancel();
    this.onScroll = () => { if (this.state && !this.state.active) this.stop(); };
    grip.addEventListener("pointerdown", (e) => this.start(e));
  }

  start(event) {
    if (event.button !== 0 || this.state) return;
    const st = this.view.state, ents = outlineOf(st.doc), sel = st.selection;
    const index = Math.min(this.index(), ents.length - 1);
    const inSel = sel instanceof BlockSelection && ents[index].at >= sel.from && ents[index].end <= sel.to;
    const { lo, hi } = inSel ? sel.span(st.doc) : siblingSpan(ents, index, index);
    this.state = {
      index, span: captureSpan(ents, lo, hi), touch: event.pointerType === "touch",
      pointer: event.pointerId, x0: event.clientX, y0: event.clientY, x: event.clientX, y: event.clientY,
      hold: 0, active: false, raf: 0, gap: undefined, targets: [], target: null,
    };
    this.grip.setPointerCapture?.(event.pointerId);
    this.grip.addEventListener("pointermove", this.onMove);
    this.grip.addEventListener("pointerup", this.onUp);
    this.grip.addEventListener("pointercancel", this.onCancel);
    this.grip.addEventListener("lostpointercapture", this.onCancel);
    if (this.state.touch) {
      const s = this.state;
      s.hold = setTimeout(() => this.held(s), HOLD);
      window.addEventListener("pointerdown", this.onOther, true);
      window.addEventListener("blur", this.onBlur);
      window.addEventListener("scroll", this.onScroll, true);
    }
    event.preventDefault();
  }

  // A touch keeps still for a quarter second before it drags: the press the mouse
  // starts on its first move only reaches the same place once a scroll would have
  // begun, so the hold tells the two apart. A tap before then is the menu.
  held(s) {
    if (this.state !== s || s.active) return;
    s.hold = 0;
    if (Math.hypot(s.x - s.x0, s.y - s.y0) > HOLD_SLOP || !this.view.editable) return this.stop();
    this.begin();
  }

  move(event) {
    const s = this.state;
    if (!s || event.pointerId !== s.pointer) return;
    s.x = event.clientX;
    s.y = event.clientY;
    if (s.touch && !this.view.editable) return s.active ? this.cancel() : this.stop();
    if (!s.active) {
      const reach = Math.hypot(s.x - s.x0, s.y - s.y0);
      if (s.touch) { if (reach > HOLD_SLOP) this.stop(); return; }
      if (reach <= SLOP) return;
      this.begin();
    }
    this.track();
  }

  begin() {
    const s = this.state;
    if (!s || s.active) return;
    const st = this.view.state, ents = outlineOf(st.doc);
    const span = resolveSpan(ents, s.span);
    if (!span) return this.cancel();
    s.active = true;
    this.view.dispatch(st.tr.setSelection(selectBlocks(st.doc, span.lo, span.hi)));
    this.shell.classList.add("is-dragging");
    const probe = this.shell.appendChild(document.createElement("div"));
    probe.style.cssText = "position:absolute;visibility:hidden;width:var(--page-indent)";
    this.indentPx = probe.getBoundingClientRect().width || 27;
    probe.remove();
    this.scroller = scrollParent(this.view.dom);
    window.addEventListener("keydown", this.onKey, true);
    this.loop();
    this.track();
  }

  track() {
    const s = this.state, view = this.view, st = view.state;
    if (!s) return;
    const ents = outlineOf(st.doc), span = resolveSpan(ents, s.span);
    if (!span) return this.cancel();
    const { lo, hi } = span;
    const visible = visibleOf(ents, view);
    const k = firstBelow(visible, s.y);
    let next = -1, line = null, over = null;
    const stop = k < 0 ? visible.length : k + 1;
    for (let j = Math.max(0, stop - 2); j < stop; j++) {
      const r = visible[j].dom.getBoundingClientRect();
      if (s.y >= r.top + r.height / 4 && s.y <= r.bottom - r.height / 4) over = { i: visible[j].i, bottom: r.bottom };
      line = r.bottom + 2;
    }
    if (k >= 0) { next = visible[k].i; line = visible[k].dom.getBoundingClientRect().top - 2; }
    const inside = lo < 0 ? null : over && summaryTarget(st, ents, lo, hi, over.i);
    const key = inside ? `summary:${over.i}` : next;
    if (key !== s.gap || st.doc !== s.doc) {
      s.gap = key;
      s.doc = st.doc;
      s.targets = lo < 0 ? [] : inside ? [inside] : gapTargets(st, ents, lo, hi, next);
    }
    if (inside) line = over.bottom + 2;
    const edLeft = view.dom.getBoundingClientRect().left;
    s.target = pickTarget(s.targets, (s.x - edLeft) / this.indentPx);
    const shellBox = this.shell.getBoundingClientRect();
    if (!s.target || line === null) {
      this.line.hidden = true;
      this.shell.dataset.drop = "none";
      return;
    }
    this.shell.dataset.drop = "ok";
    this.line.hidden = false;
    this.line.style.setProperty("--page-drop-y", `${line - shellBox.top}px`);
    this.line.style.setProperty("--page-drop-x", `${edLeft - shellBox.left + s.target.depth * this.indentPx}px`);
    this.line.style.setProperty("--page-drop-w", `${view.dom.getBoundingClientRect().right - edLeft - s.target.depth * this.indentPx}px`);
  }

  loop() {
    const step = () => {
      const s = this.state;
      if (!s?.active) return;
      if (s.touch && !this.view.editable) return this.cancel();
      const sc = this.scroller;
      const box = sc === sc.ownerDocument.scrollingElement ? { top: 0, bottom: window.innerHeight } : sc.getBoundingClientRect();
      let v = 0;
      if (s.y < box.top + EDGE) v = -MAX_SPEED * Math.min(1, (box.top + EDGE - s.y) / EDGE);
      else if (s.y > box.bottom - EDGE) v = MAX_SPEED * Math.min(1, (s.y - (box.bottom - EDGE)) / EDGE);
      if (v) {
        sc.scrollTop += v;
        this.track();
      }
      s.raf = requestAnimationFrame(step);
    };
    this.state.raf = requestAnimationFrame(step);
  }

  end(event) {
    const s = this.state;
    if (!s || event.pointerId !== s.pointer) return;
    if (!s.active) {
      this.stop();
      if (event.type === "pointerup") {
        const ents = outlineOf(this.view.state.doc), span = resolveSpan(ents, s.span);
        if (span) this.onClick(span.lo);
      }
      return;
    }
    this.track();
    if (this.state !== s) return;
    const target = s.target;
    const st = this.view.state, ents = outlineOf(st.doc);
    const span = resolveSpan(ents, s.span);
    this.stop();
    if (!target || !span) return;
    const { lo, hi } = span;
    const same = !target.open && (target.at === ents[lo].at || target.at === ents[hi].end) && target.parent === (ents[lo].node.attrs.parent ?? null)
      && (ents[lo].node.type.name !== "list_item" || target.indent === ents[lo].node.attrs.indent);
    if (same) return;
    this.view.dispatch(asStep(moveSpanTo(st, ents, lo, hi, target)).scrollIntoView());
    if (this.view.state.doc === st.doc) return announce(this.view, "Move cancelled");
    const n = hi - lo + 1;
    announce(this.view, `Moved ${n} ${n === 1 ? "block" : "blocks"}`);
    this.view.focus();
  }

  cancel() {
    this.stop();
    announce(this.view, "Move cancelled");
  }

  stop() {
    const s = this.state;
    if (!s) return;
    this.state = null;
    clearTimeout(s.hold);
    cancelAnimationFrame(s.raf);
    this.grip.removeEventListener("pointermove", this.onMove);
    this.grip.removeEventListener("pointerup", this.onUp);
    this.grip.removeEventListener("pointercancel", this.onCancel);
    this.grip.removeEventListener("lostpointercapture", this.onCancel);
    this.grip.releasePointerCapture?.(s.pointer);
    window.removeEventListener("pointerdown", this.onOther, true);
    window.removeEventListener("blur", this.onBlur);
    window.removeEventListener("scroll", this.onScroll, true);
    window.removeEventListener("keydown", this.onKey, true);
    this.shell.classList.remove("is-dragging");
    delete this.shell.dataset.drop;
    this.line.hidden = true;
  }

  destroy() {
    this.stop();
    this.line.remove();
  }
}
