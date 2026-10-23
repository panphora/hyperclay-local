import { HyperMorph } from "../vendor/hyper-morph.vendor.js";
import { conflicts } from "./conflicts.js";
import { protectionOf, protectionGeneration, captureFootprintWitnesses, footprintWitnessesValid } from "./conflict-footprints.js";
import { SYNC_IGNORE_SELECTOR, REMOTE_WINS_SELECTOR } from "./live-sync.js";
import { savePage } from "../core/save.js";
import { gateMarkDirty } from "../lib/dirty-gate.js";
import { repaintDerived } from "../lib/derived.js";
import Mutation from "../lib/mutation.js";
import { markExplicitSave } from "../lib/user-gesture.js";
import { enableContentEditable } from "../core/admin-contenteditable.js";
import { enableOnClick } from "../core/admin-onclick.js";
import { enableAdminInputs } from "../core/admin-inputs.js";
import { enableAdminResources } from "../core/admin-resources.js";

// Revert to mine: put this tab's side of the losses it selected back on the page as
// an ordinary local edit, acknowledge exactly the ids that verifiably went back, then
// save through savePage(). The plan resolves every target against the page as it is
// and keeps only losses whose footprints stay apart; the newest of two that touch
// wins and the older is blocked. The writes run as one transaction under a
// MutationObserver: when any op's own check or any whole-page invariant fails, every
// record is undone in reverse and the page is the page it was before the click, with
// nothing acknowledged and nothing saved. Attributes, form control state, focus and
// the selection come back from a snapshot taken before the first write, and neither
// the page's change feed nor its undo history sees the undone writes. Everything here
// reads the engine's recovery data on each record and the clone the merge read as
// "mine"; nothing here touches a sync base, a ticket or a saved baseline: a revert is
// typing.

export const BLOCKED = "This spot changed again. Review the latest edit or download your copy.";

// The engine's flat convention (hyper-morph inline-merge.js): one U+FFFC per atom,
// one U+001E per block break, marks descended, ignored elements skipped. Kept in step
// by conflict-revert.test.js, which checks projections against merged.text.
const ATOM = "￼";
const BREAK = "\u001E";
const MARK_TAGS = new Set("A ABBR B BDI BDO CITE CODE DATA DEL DFN EM FONT I INS KBD MARK Q S SAMP SMALL SPAN STRIKE STRONG SUB SUP TIME TT U VAR".split(" "));
const ATOM_TAGS = new Set(["BR", "WBR", "IMG"]);
const BLOCK_TAGS = new Set("ADDRESS ARTICLE ASIDE AUDIO BLOCKQUOTE BODY CANVAS CAPTION CENTER COL COLGROUP DD DETAILS DIALOG DIR DIV DL DT FIELDSET FIGCAPTION FIGURE FOOTER FORM FRAME FRAMESET H1 H2 H3 H4 H5 H6 HEAD HEADER HGROUP HR HTML IFRAME LEGEND LI MAIN MATH MENU NAV NOSCRIPT OBJECT OL OPTGROUP OPTION P PRE SCRIPT SECTION SELECT STYLE SUMMARY SVG TABLE TBODY TD TEMPLATE TEXTAREA TFOOT TH THEAD TITLE TR UL VIDEO".split(" "));
const TEXT_BLOCK_TAGS = new Set("P H1 H2 H3 H4 H5 H6 DIV LI DD DT BLOCKQUOTE FIGCAPTION SUMMARY ADDRESS".split(" "));
// Text blocks whose content model is phrasing only: a block inside one is a broken
// page. DIV, LI, DD, DT, BLOCKQUOTE, FIGCAPTION and ADDRESS hold blocks by design.
const INLINE_ONLY_TAGS = new Set("P H1 H2 H3 H4 H5 H6 SUMMARY".split(" "));
const STRUCTURAL = /[￼\u001E]/;
const OBSERVE = { subtree: true, childList: true, characterData: true, characterDataOldValue: true, attributes: true, attributeOldValue: true };

const isEl = (n) => !!n && n.nodeType === 1;
const isMark = (n) => isEl(n) && MARK_TAGS.has(n.tagName);
const ignored = (el) => el.matches(SYNC_IGNORE_SELECTOR);
const remoteWins = (el) => el.matches(REMOTE_WINS_SELECTOR);
const kidsOf = (el) => (el.localName === "template" && el.content ? el.content : el);
const indexOf = (node) => Array.prototype.indexOf.call(node.parentNode.childNodes, node);
const authored = (el) => el.getAttribute("data-id") || el.getAttribute("id") || null;

function isEmptyMark(el) {
  return !el.firstChild || (el.textContent === "" && !el.querySelector("br,img,wbr"));
}

function isInlineUnit(node) {
  if (node.nodeType === 3) return true;
  if (!isEl(node)) return false;
  if (ignored(node)) return true;
  if (ATOM_TAGS.has(node.tagName)) return true;
  if (!MARK_TAGS.has(node.tagName)) return !BLOCK_TAGS.has(node.tagName);
  if (remoteWins(node)) return false;
  for (const c of node.childNodes) if (!isInlineUnit(c)) return false;
  return true;
}

function isTextBlock(el) {
  if (!TEXT_BLOCK_TAGS.has(el.tagName) || ignored(el) || remoteWins(el)) return false;
  for (const c of el.childNodes) if (c.nodeType === 8 || !isInlineUnit(c)) return false;
  return true;
}

function templateOf(fragment, root = document) {
  for (const t of root.querySelectorAll("template")) {
    if (t.content === fragment) return t;
    const inner = templateOf(fragment, t.content);
    if (inner) return inner;
  }
  return null;
}

// Still part of the page: the document, or a live template's content.
function within(node, root) {
  for (let n = node; n; n = n.nodeType === 11 ? templateOf(n) : n.parentNode) if (n === root) return true;
  return false;
}
const onPage = (node) => within(node, document);

function nodeAt(root, path) {
  let n = root;
  for (const step of path) {
    n = step === "content" ? n.content : n.childNodes[step];
    if (!n) return null;
  }
  return n;
}

// Every authored identity in a subtree, template content included.
function idsIn(node, out = new Set()) {
  if (isEl(node)) {
    const id = authored(node);
    if (id) out.add(id);
  }
  if (node.nodeType === 1 || node.nodeType === 11) for (const c of kidsOf(node).childNodes) idsIn(c, out);
  return out;
}

// Fragments are parsed inert. A fragment carrying any block element is blocked
// outright: a block inside a paragraph is a broken page, and a parsed script would
// run when it reaches the page.
function parse(html) {
  const t = document.createElement("template");
  t.innerHTML = html;
  return t.content;
}

const hasBlock = (fragment) => [...fragment.querySelectorAll("*")].some((el) => BLOCK_TAGS.has(el.tagName));

// The single-child element chain a fragment wraps its content in, outermost first.
function wrappers(fragment) {
  const out = [];
  for (let n = fragment; n.childNodes.length === 1 && isEl(n.firstChild); n = n.firstChild) out.push(n.firstChild);
  return out;
}

// Where a clone path lives now: the document, or the content of the live template
// the path enters. A subject inside a template never resolves to a twin outside it.
function scopeFor(path, apply) {
  const at = path.lastIndexOf("content");
  if (at < 0) return document;
  const tpl = byIdentity(path.slice(0, at), apply);
  return tpl && tpl.content ? tpl.content : null;
}

// The one element in scope carrying the authored identity of the clone node at
// path, if it is unique there. Never the first equal string on the page.
function byIdentity(path, apply) {
  const src = nodeAt(apply.root, path);
  if (!isEl(src)) return null;
  const id = authored(src);
  const scope = id ? scopeFor(path, apply) : null;
  if (!scope) return null;
  const same = [...scope.querySelectorAll(src.localName)].filter((el) => el.namespaceURI === src.namespaceURI && authored(el) === id);
  return same.length === 1 ? same[0] : null;
}

// The one element on the page with el's tag and authored identity, if unique.
function twinOf(el) {
  const id = authored(el);
  if (!id) return null;
  const same = [...document.querySelectorAll(el.localName)].filter((x) => x.namespaceURI === el.namespaceURI && authored(x) === id);
  return same.length === 1 ? same[0] : null;
}

// A ref's live node when it is still on the page with the expected node type; else
// the element now carrying the identity the clone's node had, or, for a subject the
// clone does not hold, the identity its last live node had.
function liveOf(ref, apply, nodeType = ref ? ref.nodeType : 1) {
  if (!ref) return null;
  for (const n of ref.live) if (n.nodeType === nodeType && onPage(n)) return n;
  if (nodeType !== 1) return null;
  if (ref.local.length) return byIdentity(ref.local[0], apply);
  const stale = ref.live.find(isEl);
  return stale ? twinOf(stale) : null;
}

// The subject's last live node carried an identity and nothing on the page has it.
function provenGone(ref) {
  const stale = ref.live.find(isEl);
  const id = stale ? authored(stale) : null;
  return !!id && ![...document.querySelectorAll(stale.localName)].some((x) => authored(x) === id);
}

// ---------------------------------------------------------------------------
// Text: the current projection of a scope root, offsets to DOM points
// ---------------------------------------------------------------------------

function project(root) {
  const container = kidsOf(root);
  const f = { root, container, text: "", nodes: [], atoms: [], blocks: [] };
  const walk = (list) => {
    for (const node of list) {
      if (node.nodeType === 3) {
        if (!node.data) continue;
        f.nodes.push({ node, s: f.text.length, e: f.text.length + node.data.length });
        f.text += node.data;
        continue;
      }
      if (!isEl(node) || ignored(node)) continue;
      if (isTextBlock(node)) {
        if (f.text.length && f.text[f.text.length - 1] !== BREAK) f.text += BREAK;
        const b = { el: node, from: f.text.length, to: -1 };
        f.blocks.push(b);
        walk(node.childNodes);
        f.text += BREAK;
        b.to = f.text.length;
        continue;
      }
      const empty = MARK_TAGS.has(node.tagName) && isEmptyMark(node);
      if (ATOM_TAGS.has(node.tagName) || !MARK_TAGS.has(node.tagName) || remoteWins(node) || empty) {
        f.atoms.push({ i: f.text.length, el: node });
        f.text += ATOM;
        continue;
      }
      walk(node.childNodes);
    }
  };
  walk(container.childNodes);
  const lone = f.atoms.length === 1 && f.atoms[0].el.tagName === "BR" && !f.blocks.length && f.text.replace(ATOM, "").trim() === "";
  if (lone) {
    const at = f.atoms[0].i;
    f.text = f.text.slice(0, at) + f.text.slice(at + 1);
    f.atoms = [];
    for (const n of f.nodes) if (n.s > at) { n.s--; n.e--; }
  }
  return f;
}

// A flat offset as a DOM point: inside a text node, at an atom's edge, at a block's
// edge, or touching a text node. The engine's rawPoint, on the live tree.
function pointAt(f, i, edge) {
  for (const n of f.nodes) if (edge === "start" ? n.s <= i && i < n.e : n.s < i && i <= n.e) return [n.node, i - n.s];
  const at = edge === "start" ? i : i - 1;
  const atom = f.atoms.find((a) => a.i === at);
  if (atom) return [atom.el.parentNode, indexOf(atom.el) + (edge === "start" ? 0 : 1)];
  if (f.text[at] === BREAK) {
    const closing = f.blocks.find((b) => b.to === at + 1);
    if (closing) return edge === "start" ? [closing.el, closing.el.childNodes.length] : [closing.el.parentNode, indexOf(closing.el) + 1];
    const opening = f.blocks.find((b) => b.from === at + 1);
    if (opening) return edge === "start" ? [opening.el, 0] : [opening.el.parentNode, indexOf(opening.el)];
  }
  for (const n of f.nodes) if (n.s === i || n.e === i) return [n.node, i - n.s];
  return [f.container, i === 0 ? 0 : f.container.childNodes.length];
}

function point(node, offset) {
  const r = document.createRange();
  r.setStart(node, offset);
  r.setEnd(node, offset);
  return r;
}

// A DOM point as a flat offset in a projection: inside one of its text nodes, else
// the offset of the first unit at or after the point. Null when the point is not in
// the projected tree.
function offsetOf(f, node, off) {
  if (node.nodeType === 3) {
    const n = f.nodes.find((x) => x.node === node);
    return n ? n.s + off : null;
  }
  if (node !== f.container && !within(node, f.root)) return null;
  const at = point(node, off);
  let best = f.text.length;
  const after = (n, o) => {
    try {
      return at.comparePoint(n, o) >= 0;
    } catch {
      return false;
    }
  };
  for (const n of f.nodes) if (after(n.node, 0)) best = Math.min(best, n.s);
  for (const a of f.atoms) if (after(a.el.parentNode, indexOf(a.el))) best = Math.min(best, a.i);
  return best;
}

// apply.js's trimHunk: a word hunk shrunk to the characters that differ.
function trim(old, h) {
  const was = old.slice(h.bs, h.be);
  let p = 0;
  while (p < was.length && p < h.text.length && was[p] === h.text[p]) p++;
  let s = 0;
  while (s < was.length - p && s < h.text.length - p && was[was.length - 1 - s] === h.text[h.text.length - 1 - s]) s++;
  return { bs: h.bs + p, be: h.be - s, text: h.text.slice(p, h.text.length - s) };
}

// [S, E) in the old projection as an interval of the current one. A change before
// the range shifts it; an insertion exactly at the start is before it; an insertion
// exactly at the end stays outside; a change inside belongs to this spot. A hunk
// crossing a boundary, or an atom or break changing inside, gives null: the spot is
// not this record's any more.
function rebase(oldText, newText, S, E) {
  if (oldText === newText) return { s: S, e: E };
  let shift = 0;
  let inner = 0;
  const hunks = HyperMorph.diff(oldText, newText).map((h) => trim(oldText, h)).sort((a, b) => a.bs - b.bs);
  for (const h of hunks) {
    if (h.bs === h.be && !h.text) continue;
    const d = h.text.length - (h.be - h.bs);
    if (h.be <= S) shift += d;
    else if (h.bs >= E) continue;
    else if (h.bs >= S && h.be <= E) {
      if (STRUCTURAL.test(oldText.slice(h.bs, h.be) + h.text)) return null;
      inner += d;
    } else return null;
  }
  return { s: S + shift, e: E + shift + inner };
}

// Where the record's scope text begins in the subject now: the scope start the
// engine recorded, when it is still on the page inside the subject; else the start
// of a subject that is one text block, whose scope is its whole content; else the
// one place the merged scope text occurs. Two occurrences or none cannot be told
// apart.
function scopeStart(t, live, f) {
  const sc = t.liveScope;
  if (sc && sc.startContainer && within(sc.startContainer, live) && within(sc.endContainer, live)) {
    const at = offsetOf(f, sc.startContainer, sc.startOffset);
    if (at !== null) return at;
  }
  if (isTextBlock(live)) return 0;
  const first = t.merged.text ? f.text.indexOf(t.merged.text) : -1;
  return first >= 0 && f.text.indexOf(t.merged.text, first + 1) < 0 ? first : null;
}

// The text block the range sits in, or the subject when the range is not inside
// one: the unit the after-write invariant projects.
function scopeOf(range, root) {
  let n = range.commonAncestorContainer;
  if (n.nodeType === 3) n = n.parentNode;
  for (; n && n !== root; n = n.parentNode) if (isEl(n) && isTextBlock(n)) return n;
  return root;
}

// ---------------------------------------------------------------------------
// Text: marks around the spot
// ---------------------------------------------------------------------------

const sameMark = (a, b) =>
  a.tagName === b.tagName && a.attributes.length === b.attributes.length &&
  [...a.attributes].every((at) => b.getAttribute(at.name) === at.value);

// The marks enclosing a node, up to the nearest non-mark element, outermost first.
function marksAbove(node, root) {
  const out = [];
  for (let n = isEl(node) ? node : node.parentNode; n && n !== root && isMark(n); n = n.parentNode) out.unshift(n);
  return out;
}

// A collapsed point at the edge of marks the fragment does not carry moves outside
// them, nested marks included: the local side wrote its text next to the mark, not
// inside it.
function hoist(point, root, carried) {
  let [node, off] = point;
  if (node.nodeType === 3) {
    if (off !== 0 && off !== node.data.length) return point;
    [node, off] = [node.parentNode, indexOf(node) + (off === 0 ? 0 : 1)];
  }
  let lifted = false;
  while (node !== root && isMark(node) && (off === 0 || off === node.childNodes.length) && !carried.some((w) => sameMark(w, node))) {
    [node, off] = [node.parentNode, indexOf(node) + (off === 0 ? 0 : 1)];
    lifted = true;
  }
  return lifted ? [node, off] : point;
}

// Decide, before any write, how the fragment's wrappers meet the marks around the
// range. Both ends of the range must sit under the same marks, and those marks must
// equal, outermost first, the fragment's outer wrappers: the text goes inside them
// once and the remaining wrappers come along. Anything else (a mark this tab removed,
// a mark the other side added, a range crossing a mark's edge, a wrapper that would
// nest a live mark of its own tag) cannot be proven and blocks.
function reconcile(op, range, root) {
  const chain = marksAbove(range.startContainer, root);
  const atEnd = marksAbove(range.endContainer, root);
  if (chain.length !== atEnd.length || chain.some((c, i) => c !== atEnd[i])) return false;
  if (chain.length > op.wrappers.length || chain.some((c, i) => !sameMark(c, op.wrappers[i]))) return false;
  op.peel = chain.length;
  return !op.wrappers.slice(op.peel).some((w) => chain.some((c) => c.tagName === w.tagName));
}

// The engine records a clash whose neighbour shares the word one level up and
// serializes the paragraph around the local text. That one wrapper goes when it is
// the live text block holding both ends of the range, by tag and authored identity;
// an id-less wrapper matches by being that block.
function peelBlock(fragment, start, end, live) {
  const outer = fragment.childNodes.length === 1 && isEl(fragment.firstChild) ? fragment.firstChild : null;
  if (!outer || !BLOCK_TAGS.has(outer.tagName)) return;
  const range = document.createRange();
  range.setStart(...start);
  range.setEnd(...end);
  const block = scopeOf(range, live);
  if (block === live || block.tagName !== outer.tagName || block.namespaceURI !== outer.namespaceURI || authored(block) !== authored(outer)) return;
  outer.replaceWith(...outer.childNodes);
}

// A fragment that is one run of text, or nothing, is written into a single text node
// with one replaceData, which undo can reverse.
function plainOf(op) {
  if (!op.parsed) return op.fragment;
  const kids = op.parsed.childNodes;
  if (!kids.length) return "";
  return kids.length === 1 && kids[0].nodeType === 3 ? kids[0].data : null;
}

function planText(rec, apply) {
  const t = rec.recovery.text;
  const subject = rec.recovery.subject;
  const live = liveOf(subject, apply, subject.nodeType);
  if (!live) return null;
  const local = t.local.text.slice(t.local.start, t.local.end);
  if (STRUCTURAL.test(t.merged.text.slice(t.merged.start, t.merged.end)) || local.includes(BREAK)) return null;
  const op = { kind: "text", id: rec.id, ticket: apply.ticket, key: subject.key, fragment: t.local.fragment, encoding: t.encoding, local, ids: new Set(), range: document.createRange() };
  if (live.nodeType === 8) {
    const span = rebase(t.merged.text, live.data, t.merged.start, t.merged.end);
    if (!span) return null;
    op.range.setStart(live, span.s);
    op.range.setEnd(live, span.e);
    return { ...op, root: live, owner: live, scope: live, s: span.s, e: span.e, before: live.data, bs: span.s, be: span.e };
  }
  // A textarea shows its value, which typing moves away from its child text: the
  // spot is found in the value and both are written.
  if (live.localName === "textarea") {
    if (op.encoding !== "plain") return null;
    const span = rebase(t.merged.text, live.value, t.merged.start, t.merged.end);
    if (!span) return null;
    op.range.selectNodeContents(live);
    return { ...op, root: live, field: live, scope: live, f: { text: live.value }, s: span.s, e: span.e, before: live.value, bs: span.s, be: span.e };
  }
  const f = project(live);
  const from = scopeStart(t, live, f);
  if (from === null) return null;
  const span = rebase(t.merged.text, f.text.slice(from), t.merged.start, t.merged.end);
  if (!span) return null;
  const s = from + span.s;
  const e = from + span.e;
  let start = pointAt(f, s, "start");
  let end = s === e ? start : pointAt(f, e, "end");
  op.parsed = op.encoding === "html" ? parse(op.fragment) : null;
  if (op.parsed) peelBlock(op.parsed, start, end, live);
  if (op.parsed && hasBlock(op.parsed)) return null;
  op.wrappers = op.parsed ? wrappers(op.parsed) : [];
  if (op.parsed) idsIn(op.parsed, op.ids);
  op.plain = plainOf(op);
  if (s === e) start = end = hoist(start, live, op.wrappers);
  op.range.setStart(...start);
  op.range.setEnd(...end);
  if (!reconcile(op, op.range, live)) return null;
  const scope = scopeOf(op.range, live);
  const g = scope === live ? f : project(scope);
  const bs = offsetOf(g, ...start);
  const be = s === e ? bs : offsetOf(g, ...end);
  if (bs === null || be === null || g.text.slice(bs, be) !== f.text.slice(s, e)) return null;
  return { ...op, root: live, f, s, e, scope, before: g.text, bs, be };
}

function applyText(op) {
  if (op.owner) {
    const d = op.owner.data;
    op.owner.data = d.slice(0, op.s) + op.fragment + d.slice(op.e);
    op.check = () => op.owner.data.slice(op.s, op.s + op.fragment.length) === op.fragment && onPage(op.owner);
    return;
  }
  if (op.field) {
    const field = op.field;
    const next = field.value.slice(0, op.s) + op.fragment + field.value.slice(op.e);
    field.textContent = next;
    if (field.value !== next) {
      field.value = next;
      op.wroteProperty = true;
    }
    if (field.hasAttribute("data-value")) field.setAttribute("data-value", next);
    op.check = () => onPage(field) && field.value === next && field.textContent === next;
    return;
  }
  const range = op.range;
  const node = range.startContainer;
  if (op.plain !== null && node.nodeType === 3 && range.endContainer === node) {
    const at = range.startOffset;
    node.replaceData(at, range.endOffset - at, op.plain);
    op.check = () => onPage(node) && node.data.slice(at, at + op.plain.length) === op.plain;
    return;
  }
  range.deleteContents();
  let nodes = [];
  if (op.fragment) {
    if (op.parsed) {
      const frag = document.importNode(op.parsed, true);
      const ws = wrappers(frag);
      for (let depth = 0; depth < op.peel; depth++) ws[depth].replaceWith(...ws[depth].childNodes);
      nodes = [...frag.childNodes];
      range.insertNode(frag);
    } else {
      nodes = [document.createTextNode(op.fragment)];
      range.insertNode(nodes[0]);
    }
  }
  op.check = () => nodes.every(onPage) && (op.parsed || !nodes.length || nodes[0].data === op.fragment);
}

// ---------------------------------------------------------------------------
// Attributes and structure
// ---------------------------------------------------------------------------

function planAttr(rec, apply) {
  const el = liveOf(rec.recovery.subject, apply, 1);
  if (!el) return null;
  const a = rec.recovery.attribute;
  const op = { kind: "attr", id: rec.id, ticket: apply.ticket, key: rec.recovery.subject.key, el, ns: a.namespaceURI, name: a.qualifiedName, local: a.localName, value: rec.local ?? null, ids: new Set() };
  try {
    if (op.ns === null) document.createAttribute(op.name);
    else document.createAttributeNS(op.ns, op.name);
  } catch {
    return null;
  }
  return op;
}

// Input types whose value attribute is not what the control shows.
const DEFAULT_VALUE_TYPES = new Set(["hidden", "submit", "image", "reset", "button", "checkbox", "radio", "file"]);

// What a control shows for a value: the browser sanitizes some input types (a colour
// is lowercased, a URL trimmed), so the check compares against that.
function shownValue(el, value) {
  const probe = document.createElement("input");
  probe.type = el.type;
  probe.value = value;
  return probe.value;
}

// The live property a form-state attribute stands for, and the state it should show:
// once a person has typed or clicked, the control shows the property, and a [persist]
// save serializes it, whatever the attribute says.
function formState(op) {
  const el = op.el;
  if (op.ns !== null || el.namespaceURI !== "http://www.w3.org/1999/xhtml") return null;
  if (el.localName === "input" && op.name === "checked" && (el.type === "checkbox" || el.type === "radio")) return ["checked", op.value !== null];
  if (el.localName === "input" && op.name === "value" && !DEFAULT_VALUE_TYPES.has(el.type)) return ["value", shownValue(el, op.value ?? "")];
  if (el.localName === "option" && op.name === "selected") return ["selected", op.value !== null];
  return null;
}

function applyAttr(op) {
  if (op.ns === null) {
    if (op.value === null) op.el.removeAttribute(op.name);
    else op.el.setAttribute(op.name, op.value);
  } else if (op.value === null) op.el.removeAttributeNS(op.ns, op.local);
  else op.el.setAttributeNS(op.ns, op.name, op.value);
  // A control that still follows its attribute has taken the state already; the
  // property is written only when it did not, so no pristine control turns dirty.
  const state = formState(op);
  if (state && op.el[state[0]] !== state[1]) {
    op.el[state[0]] = state[1];
    op.wroteProperty = true;
  }
  const now = () => (op.ns === null ? op.el.getAttribute(op.name) : op.el.getAttributeNS(op.ns, op.local));
  op.check = () => onPage(op.el) && now() === op.value && (!state || op.el[state[0]] === state[1]);
}

function planStructure(rec, apply) {
  const s = rec.recovery.structure;
  const subject = rec.recovery.subject;
  const live = liveOf(subject, apply, subject.nodeType);
  const base = { id: rec.id, ticket: apply.ticket, key: subject.key, apply, ids: new Set() };
  const parentOf = (placement) => (placement ? liveOf(placement.parent, apply, 1) : null);
  // A deletion whose subject is provably gone is achieved: nothing to write, nothing
  // to protect.
  if (s.localAction === "deleted") {
    if (live) return { ...base, kind: "remove", node: live };
    return provenGone(subject) ? { ...base, kind: "done", check: () => true } : null;
  }
  if (s.localAction === "moved") {
    const parent = parentOf(s.localPlacement);
    if (!live || !parent || live === parent || within(parent, live)) return null;
    return { ...base, kind: "move", node: live, parent, placement: s.localPlacement };
  }
  if (s.localAction === "reordered") {
    if (!live || !s.localOrder) return null;
    const container = kidsOf(live);
    const order = s.localOrder.map((r) => liveOf(r, apply, r.nodeType)).filter((n) => n && n.parentNode === container);
    if (order.length < 2) return null;
    return { ...base, kind: "reorder", parent: live, order };
  }
  if (s.localAction === "inserted") {
    const parent = parentOf(s.localPlacement);
    if (!parent) return null;
    if (live && live.parentNode !== kidsOf(parent)) return null;
    if (s.fragmentKind !== "element") {
      if (typeof s.localFragment !== "string") return null;
      return { ...base, kind: "run", node: live, parent, placement: s.localPlacement, text: s.localFragment, nodeType: subject.nodeType };
    }
    const src = subject.local.length ? nodeAt(apply.root, subject.local[0]) : null;
    if (!isEl(src)) return null;
    const mode = !live ? "place" : live.tagName === src.tagName && live.namespaceURI === src.namespaceURI ? "morph" : "replace";
    return { ...base, kind: "realize", node: live, parent, placement: s.localPlacement, src, mode, ids: idsIn(src) };
  }
  return null;
}

// Where a restored or moved node goes: before the first `before` sibling still under
// the parent, else after the first `after` sibling still there, else the start or
// end the empty arrays encode.
function place(node, parent, placement, apply) {
  const container = kidsOf(parent);
  const under = (refs) => {
    for (const r of refs) {
      const n = liveOf(r, apply, r.nodeType);
      if (n && n !== node && n.parentNode === container) return n;
    }
    return null;
  };
  const before = under(placement.before);
  if (before) return container.insertBefore(node, before);
  const after = under(placement.after);
  if (after) return container.insertBefore(node, after.nextSibling);
  return placement.before.length ? container.insertBefore(node, container.firstChild) : container.appendChild(node);
}

// A clone from a save-domain apply (disk lane) is the inert saved form; it wakes up
// the way an incoming disk document does, before it reaches the page.
function realized(op) {
  const imported = document.importNode(op.src, true);
  const holder = document.createDocumentFragment();
  holder.append(imported);
  if (op.apply.domain === "save") {
    enableContentEditable(holder);
    enableOnClick(holder);
    enableAdminInputs(holder);
    enableAdminResources(holder);
  }
  return imported;
}

// The graph, in an order where every step's preconditions still hold: moved nodes
// wait in the parked fragment, restored subtrees and runs are written where the plan
// decided, moves land, reorders settle, removals come last.
function applyStructure(ops, parked) {
  const moves = ops.filter((op) => op.kind === "move");
  for (const op of moves) parked.append(op.node);
  for (const op of ops) {
    if (op.kind === "run") {
      if (op.node) op.node.data = op.text;
      else op.node = place(op.nodeType === 8 ? document.createComment(op.text) : document.createTextNode(op.text), op.parent, op.placement, op.apply);
      op.check = () => onPage(op.node) && op.node.parentNode === kidsOf(op.parent) && op.node.data === op.text;
      continue;
    }
    if (op.kind !== "realize") continue;
    const fresh = realized(op);
    if (op.mode === "morph") HyperMorph.morphElement(op.node, fresh, { ignore: ignored, scripts: { execute: false } });
    else if (op.mode === "replace") {
      op.node.replaceWith(fresh);
      op.node = fresh;
    } else op.node = place(fresh, op.parent, op.placement, op.apply);
    op.check = () => onPage(op.node) && op.node.parentNode === kidsOf(op.parent);
  }
  for (const op of moves) {
    place(op.node, op.parent, op.placement, op.apply);
    op.check = () => op.node.parentNode === kidsOf(op.parent) && onPage(op.node);
  }
  for (const op of ops) {
    if (op.kind !== "reorder") continue;
    const container = kidsOf(op.parent);
    const participants = op.order.filter((n) => n.parentNode === container);
    const queue = participants.slice();
    const target = [...container.childNodes].map((n) => (participants.includes(n) ? queue.shift() : n));
    let ref = null;
    for (let i = target.length - 1; i >= 0; i--) {
      const n = target[i];
      if (participants.includes(n) && n.nextSibling !== ref) container.insertBefore(n, ref);
      ref = n;
    }
    op.check = () => {
      const now = [...container.childNodes].filter((n) => participants.includes(n));
      return now.length === participants.length && now.every((n, i) => n === participants[i]);
    };
  }
  for (const op of ops) {
    if (op.kind !== "remove") continue;
    op.node.remove();
    op.check = () => !onPage(op.node);
  }
}

// ---------------------------------------------------------------------------
// Footprints: which losses may share one revert
// ---------------------------------------------------------------------------

// The subtrees an op rewrites, removes or moves as a whole.
function owned(op) {
  if (op.kind === "move" || op.kind === "remove") return [op.node];
  if (op.kind === "realize" || op.kind === "run") return op.node ? [op.node] : [];
  return [];
}

// The containers an op writes inside of.
function into(op) {
  if (op.kind === "text") return [op.scope];
  if (op.kind === "move" || op.kind === "reorder") return [op.parent];
  if ((op.kind === "realize" || op.kind === "run") && !op.node) return [op.parent];
  return [];
}

const heldBy = (op) => (op.kind === "attr" ? [op.el] : [...owned(op), ...into(op)]);

// Two spans meet when one starts before the other ends, or both are the same
// insertion point. Compared as DOM points, so scopes of different depths agree.
function spansMeet(a, b) {
  try {
    const startA = point(a.startContainer, a.startOffset);
    const startB = point(b.startContainer, b.startOffset);
    if (a.collapsed && b.collapsed) return startA.comparePoint(b.startContainer, b.startOffset) === 0;
    return startA.comparePoint(b.endContainer, b.endOffset) > 0 && startB.comparePoint(a.endContainer, a.endOffset) > 0;
  } catch {
    return false;
  }
}

function contains(outer, inner) {
  try {
    return outer.comparePoint(inner.startContainer, inner.startOffset) === 0 && outer.comparePoint(inner.endContainer, inner.endOffset) === 0;
  } catch {
    return false;
  }
}

function inRange(range, node) {
  try {
    return range.intersectsNode(node) && !within(range.commonAncestorContainer, node);
  } catch {
    return false;
  }
}

// An identity one op's payload carries that the other op's payload also carries,
// or that sits inside a node the other op holds: writing both makes two of it.
function meetIds(a, b) {
  if (!a.ids.size && !b.ids.size) return false;
  const inside = (op) => {
    const out = new Set();
    for (const n of heldBy(op)) idsIn(n, out);
    return out;
  };
  const heldA = a.ids.size ? null : inside(a);
  const heldB = inside(b);
  return [...a.ids].some((id) => b.ids.has(id) || heldB.has(id)) || [...b.ids].some((id) => (heldA || inside(a)).has(id));
}

function attrMeets(a, b) {
  if (b.kind === "text") return inRange(b.range, a.el);
  return owned(b).some((n) => within(a.el, n)) || b.ids.has(authored(a.el));
}

function textMeets(a, b) {
  if (b.kind === "reorder") return within(b.parent, a.scope) || meetIds(a, b);
  if (owned(b).some((n) => within(n, a.scope) || within(a.scope, n))) return true;
  if (into(b).some((n) => within(n, a.scope))) return true;
  return meetIds(a, b);
}

function reorderMeets(r, b) {
  if (owned(b).some((n) => r.order.includes(n) || within(r.parent, n))) return true;
  if (into(b).includes(r.parent)) return true;
  return meetIds(r, b);
}

// Two selected ops touch when one works inside what the other owns, both write the
// same spot, or their payloads would duplicate an identity. Two insertions into the
// same container, an attribute and the text under it, and two attributes of one
// element stay apart.
function touch(a, b) {
  if (a.kind === "done" || b.kind === "done") return false;
  if (a.kind === "text" && b.kind === "text") return spansMeet(a.range, b.range);
  if (a.kind === "attr" && b.kind === "attr") return a.el === b.el && a.ns === b.ns && a.local === b.local;
  if (a.kind === "attr") return attrMeets(a, b);
  if (b.kind === "attr") return attrMeets(b, a);
  if (a.kind === "text") return textMeets(a, b);
  if (b.kind === "text") return textMeets(b, a);
  if (a.kind === "reorder" && b.kind === "reorder") return a.parent === b.parent || meetIds(a, b);
  if (a.kind === "reorder") return reorderMeets(a, b);
  if (b.kind === "reorder") return reorderMeets(b, a);
  for (const x of owned(a)) for (const y of owned(b)) if (within(x, y) || within(y, x)) return true;
  for (const x of owned(a)) for (const y of into(b)) if (within(y, x)) return true;
  for (const x of owned(b)) for (const y of into(a)) if (within(y, x)) return true;
  return meetIds(a, b);
}

// An op touches the footprint of a loss that could not be planned when it holds
// that node, works inside it, or carries an identity it contains.
function touchesNode(op, c) {
  if (op.kind === "done") return false;
  if (op.kind === "attr") return within(op.el, c.node);
  if (heldBy(op).some((n) => within(n, c.node) || within(c.node, n))) return true;
  if (!op.ids.size) return false;
  if (!c.ids) c.ids = idsIn(c.node);
  return [...op.ids].some((id) => c.ids.has(id));
}

// The newer op (k) achieves the older's local state: the same live node, and the
// older's whole range inside the newer's. Nothing else covers.
function covers(k, op) {
  return k.kind === "text" && op.kind === "text" && !k.field && k.root === op.root && contains(k.range, op.range);
}

// What a loss that cannot be planned still protects, as narrow as the page allows:
// the text block around its recorded clash, else around its recorded scope, else its
// live subject, else its live placement parent, else the nearest ancestor of its
// clone path still on the page by identity, else the whole page.
function footprintsOf(rec, apply) {
  const protection = protectionOf(rec);
  return protection ? protection.nodes : [footprintOf(rec, apply)];
}

function footprintOf(rec, apply) {
  const r = rec.recovery;
  const subject = r.subject;
  for (const span of r.text ? [r.text.liveSpan, r.text.liveScope] : []) {
    if (span && span.startContainer && onPage(span.startContainer) && onPage(span.endContainer)) return blockAround(scopeRoot(span));
  }
  const live = subject ? liveOf(subject, apply, subject.nodeType) : null;
  if (live) return live;
  const parent = r.structure && r.structure.localPlacement ? liveOf(r.structure.localPlacement.parent, apply, 1) : null;
  if (parent) return parent;
  const path = subject && subject.local.length ? subject.local[0] : [];
  for (let i = path.length - 1; i > 0; i--) {
    if (path[i - 1] === "content") continue;
    const el = byIdentity(path.slice(0, i), apply);
    if (el) return el;
  }
  return document.documentElement;
}

function scopeRoot(scope) {
  const above = new Set();
  for (let n = scope.startContainer; n; n = n.parentNode) above.add(n);
  let c = scope.endContainer;
  while (c && !above.has(c)) c = c.parentNode;
  return c.nodeType === 1 || c.nodeType === 11 ? c : c.parentNode;
}

function blockAround(node) {
  for (let n = node; n; n = n.parentNode) if (isEl(n) && TEXT_BLOCK_TAGS.has(n.tagName)) return n;
  return node;
}

function planOne(rec, apply) {
  const r = rec.recovery;
  if (r.applied === false || r.unavailable) return null;
  if (r.structure) return planStructure(rec, apply);
  if (r.text) return planText(rec, apply);
  if (r.attribute) return planAttr(rec, apply);
  return null;
}

const revisionNow = () => `${protectionGeneration()}|${conflicts.hasPendingApply() ? 1 : 0}|${conflicts.list().map((r) => r.id).join(",")}`;

// ---------------------------------------------------------------------------
// The whole page: what must hold after the writes
// ---------------------------------------------------------------------------

// How often each id and each data-id occurs, counted apart and the document element
// included, and which block elements sit inside a phrasing-only block or a mark.
// Template content counts with the page.
function census() {
  const out = { ids: new Map(), nested: new Set() };
  const tally = (el) => {
    for (const name of ["id", "data-id"]) {
      const value = el.getAttribute(name);
      if (value) out.ids.set(`${name} ${value}`, (out.ids.get(`${name} ${value}`) || 0) + 1);
    }
  };
  const walk = (node, under) => {
    for (const el of kidsOf(node).children) {
      tally(el);
      if (under && BLOCK_TAGS.has(el.tagName)) out.nested.add(el);
      walk(el, under || isMark(el) || INLINE_ONLY_TAGS.has(el.tagName));
    }
  };
  tally(document.documentElement);
  walk(document.documentElement, false);
  return out;
}

// No identity doubled that was single before, no block newly inside a paragraph or
// a mark, and each text scope reads exactly as before with its restored spans
// replaced by the local text: nothing else in the scope moved.
function holds(plan) {
  const after = census();
  for (const [id, n] of after.ids) if (n > 1 && (plan.before.ids.get(id) || 0) <= 1) return false;
  for (const el of after.nested) if (!plan.before.nested.has(el)) return false;
  const byScope = new Map();
  for (const op of plan.ops) if (op.kind === "text") byScope.set(op.scope, [...(byScope.get(op.scope) || []), op]);
  for (const [scope, ops] of byScope) {
    let expected = ops[0].before;
    for (const op of [...ops].sort((a, b) => b.bs - a.bs)) expected = expected.slice(0, op.bs) + op.local + expected.slice(op.be);
    const now = ops[0].owner ? scope.data : ops[0].field ? scope.value : project(scope).text;
    if (now !== expected) return false;
  }
  return true;
}

// What mutation records cannot carry back, taken before the first write: each
// element's attribute nodes with their values in order (qualified name, namespace and
// prefix travel with the node), each form control's live state, the focused element
// and its selection, and the document selection.
function remember() {
  const attrs = new Map();
  const walk = (root) => {
    for (const el of root.querySelectorAll("*")) {
      attrs.set(el, [...el.attributes].map((a) => [a, a.value]));
      if (el.localName === "template" && el.content) walk(el.content);
    }
  };
  walk(document);
  const controls = [];
  for (const el of document.querySelectorAll("input, textarea")) controls.push([el, "value", el.value]);
  for (const el of document.querySelectorAll("input")) controls.push([el, "checked", el.checked]);
  for (const el of document.querySelectorAll("option")) controls.push([el, "selected", el.selected]);
  const active = document.activeElement;
  let caret = null;
  try {
    if (active && typeof active.selectionStart === "number") caret = [active.selectionStart, active.selectionEnd, active.selectionDirection];
  } catch {}
  const sel = document.getSelection();
  const selection = sel && sel.rangeCount ? [sel.anchorNode, sel.anchorOffset, sel.focusNode, sel.focusOffset] : null;
  return { attrs, controls, active, caret, selection };
}

function sameAttrs(el, list) {
  const now = el.attributes;
  return now.length === list.length && list.every(([a, value], i) => now[i] === a && a.value === value);
}

// Every mutation record undone, last first; attributes, control state, focus and the
// selection then come back from the snapshot.
function rollback(records, page) {
  const touched = new Set();
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    if (r.type === "characterData") r.target.data = r.oldValue;
    else if (r.type === "attributes") touched.add(r.target);
    else {
      for (const n of r.addedNodes) if (n.parentNode === r.target) r.target.removeChild(n);
      for (const n of r.removedNodes) r.target.insertBefore(n, r.nextSibling);
    }
  }
  for (const el of touched) {
    const list = page.attrs.get(el);
    if (!list || sameAttrs(el, list)) continue;
    for (const a of [...el.attributes]) el.removeAttributeNode(a);
    for (const [a, value] of list) {
      a.value = value;
      el.setAttributeNode(a);
    }
  }
  for (const [el, prop, value] of page.controls) {
    if (el[prop] === value) continue;
    try {
      el[prop] = value;
    } catch {}
  }
  const sel = document.getSelection();
  if (sel && page.selection) {
    if (onPage(page.selection[0]) && onPage(page.selection[2])) sel.setBaseAndExtent(...page.selection);
  } else if (sel && sel.rangeCount) sel.removeAllRanges();
  const active = page.active;
  if (active && active !== document.activeElement && active !== document.body && onPage(active) && active.focus) active.focus({ preventScroll: true });
  if (page.caret && document.activeElement === active) {
    try {
      active.setSelectionRange(...page.caret);
    } catch {}
  }
}

// Every tree a write can reach: the document and the content of every template on
// the page, nested templates included.
function observeAll(observer) {
  const visit = (root) => {
    observer.observe(root, OBSERVE);
    for (const t of root.querySelectorAll("template")) if (t.content) visit(t.content);
  };
  visit(document);
}

// hyper-undo reads a text node's final data for every record on it, so a node
// written twice in one transaction cannot be undone through its records.
function undoable(records) {
  const seen = new Set();
  for (const r of records) {
    if (r.type !== "characterData") continue;
    if (seen.has(r.target)) return false;
    seen.add(r.target);
  }
  return true;
}

/**
 * Read-only preflight: resolve every selected target against the page as it is,
 * rebase text spans, settle the marks, decide which selected op each spot belongs
 * to, and note the ledger revision and the page's census. Nothing changes here.
 */
export function prepareRevert(ids) {
  const revision = revisionNow();
  const blocked = new Map();
  const covered = new Map();
  const selected = [];
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const rec = conflicts.get(id);
    if (!rec) continue;
    if (rec.claimedBy || rec.kind === "apply-incomplete" || rec.kind === "json" || !rec.recovery) blocked.set(id, BLOCKED);
    else selected.push(rec);
  }
  if (conflicts.hasPendingApply()) {
    for (const rec of selected) blocked.set(rec.id, BLOCKED);
    return { ops: [], covered, blocked, revision, before: null };
  }
  const constraints = [];
  const plan = (rec) => {
    const apply = conflicts.recoveryOf(rec.id);
    const op = apply ? planOne(rec, apply) : null;
    if (!op && apply) {
      for (const node of footprintsOf(rec, apply)) constraints.push({ ticket: apply.ticket, node });
    }
    return op;
  };
  const ops = [];
  for (const rec of selected) {
    const op = plan(rec);
    if (op) ops.push(op);
    else blocked.set(rec.id, BLOCKED);
  }
  const others = [];
  for (const rec of conflicts.list()) {
    if (seen.has(rec.id)) continue;
    if (rec.kind === "apply-incomplete") constraints.push({ ticket: rec.ticket, node: document.documentElement });
    else if (rec.recovery) {
      const op = plan(rec);
      if (op) others.push(op);
    }
  }
  ops.sort((a, b) => b.ticket - a.ticket);
  const kept = [];
  const shadow = [];
  const block = (op) => {
    blocked.set(op.id, BLOCKED);
    shadow.push(op);
  };
  for (const op of ops) {
    if (constraints.some((c) => c.ticket > op.ticket && touchesNode(op, c)) || others.some((o) => o.ticket > op.ticket && touch(o, op)) || shadow.some((b) => touch(b, op))) {
      block(op);
      continue;
    }
    const newer = kept.find((k) => touch(k, op));
    if (!newer) {
      kept.push(op);
      continue;
    }
    if (covers(newer, op)) {
      covered.set(op.id, newer.id);
      continue;
    }
    block(op);
    // Two losses from the same merge have no order between them; neither goes.
    if (newer.ticket === op.ticket) {
      kept.splice(kept.indexOf(newer), 1);
      block(newer);
    }
  }
  const protectedWitnesses = captureFootprintWitnesses(constraints
    .filter((c) => kept.some((op) => c.ticket > op.ticket))
    .map((c) => c.node));
  return { ops: kept, covered, blocked, revision: revisionNow(), protectedWitnesses, before: census() };
}

/**
 * One synchronous transaction over a plan: text and attributes first, then the
 * structural graph, then every op's postcondition and the whole-page invariants.
 * Returns the ids that went back, or nothing when anything failed: then every write
 * has been undone, the page is what it was, no id is acknowledged and nothing is
 * saved.
 */
export function applyRevert(plan) {
  if (plan.revision !== revisionNow() || !footprintWitnessesValid(plan.protectedWitnesses || [])) {
    for (const op of plan.ops) plan.blocked.set(op.id, BLOCKED);
    for (const id of plan.covered.keys()) plan.blocked.set(id, BLOCKED);
    return [];
  }
  const page = remember();
  // The undo recorder is held while the writes run: a revert that goes through is
  // one entry when its records can be undone, one that is undone is none.
  const undo = window.clay?.undo;
  undo?.pause?.();
  const observer = new MutationObserver(() => {});
  const parked = document.createDocumentFragment();
  let records = [];
  let ok = false;
  try {
    observeAll(observer);
    observer.observe(parked, OBSERVE);
    const texts = plan.ops.filter((op) => op.kind === "text").sort((a, b) => (a.root === b.root ? b.s - a.s || b.e - a.e : 0));
    for (const op of texts) applyText(op);
    for (const op of plan.ops) if (op.kind === "attr") applyAttr(op);
    applyStructure(plan.ops.filter((op) => op.kind !== "text" && op.kind !== "attr"), parked);
    records = observer.takeRecords();
    ok = plan.ops.every((op) => op.check()) && holds(plan) &&
      plan.revision === revisionNow() && footprintWitnessesValid(plan.protectedWitnesses || []);
  } catch (err) {
    console.error("[clay] Revert to mine failed while writing and was undone", err);
  } finally {
    records = records.concat(observer.takeRecords());
    observer.disconnect();
  }
  if (ok) {
    // A live property write is not in the records, so its entry could not undo it.
    if (undoable(records) && !plan.ops.some((op) => op.wroteProperty)) undo?.commitCaptured?.("Revert to mine");
    else undo?.discardCaptured?.();
    undo?.resume?.();
    return [...plan.ops.map((op) => op.id), ...plan.covered.keys()];
  }
  try {
    rollback(records, page);
  } finally {
    // The page's change feed drops the writes and their undoing together: nothing
    // changed, so the dirty gate, autosave and the hub's other pausable subscribers
    // have nothing to see.
    Mutation.dropQueued();
    undo?.discardCaptured?.();
    undo?.resume?.();
  }
  for (const op of plan.ops) plan.blocked.set(op.id, BLOCKED);
  for (const id of plan.covered.keys()) plan.blocked.set(id, BLOCKED);
  return [];
}

/**
 * Revert to mine for the given ids. Unknown ids are ignored; claimed ids, ids whose
 * apply did not finish and ids whose spot cannot be proven come back blocked and stay
 * open. Acknowledges after the DOM writes and before the save: the page holds the
 * content now, and ordinary dirty bytes protect it.
 */
export async function revertConflicts(ids) {
  // Changes made before the call reach the page's change feed first: an undone
  // transaction drops what the feed holds when it ends.
  await Promise.resolve();
  const plan = prepareRevert(ids);
  const revertedIds = applyRevert(plan);
  repaintDerived();
  let saveResult = null;
  if (revertedIds.length) {
    gateMarkDirty();
    conflicts.acknowledge(revertedIds, { reason: "reverted" });
    markExplicitSave();
    // The mutation feed reports the writes above on this microtask checkpoint; the
    // save's gate token has to be taken after it, or the clear it earns is refused.
    await Promise.resolve();
    saveResult = await savePage();
  }
  return { revertedIds, blockedIds: [...plan.blocked.keys()], saveResult };
}
