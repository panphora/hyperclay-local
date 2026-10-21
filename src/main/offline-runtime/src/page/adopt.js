// Adopting a hand-edited article (D2: the article wins, no prompt).
//
// Three inputs: the blocks the article was rendered from (base: the live tags
// in the same file), the article as parsed now, and the editor's document
// (current, which may have moved on since the file was written). Only what the
// article changed relative to base is applied, as ONE local ProseMirror
// transaction: the binding turns it into ops like any edit, identityPlugin
// rewrites the fewest pos keys, structurePlugin repairs parent and indent, and
// Cmd+Z takes the whole adoption back.
import { model as pmModel, history } from "../vendor/prosemirror.vendor.js";
import { blockMap, nodeFromBlock, repairSiblings } from "./model.js";
import { project, canon, UNPROJECTED, revOf, parseModel, renderModel, fragmentCleaner } from "./projection.js";
import { blocksFromPageValues } from "./ybind/decode.js";

export const ADOPT = "page-adopt";
const same = (a, b) => canon(a) === canon(b);
const body = ({ id, parent, ...rest }) => ({ ...rest, parent: parent ?? null });

// What the article changed relative to base, or null when nothing did.
//   edited:  id -> parsed item (content or attrs differ from base)
//   created: id -> parsed item (no such block in base)
//   deleted: ids base had and the article dropped
//   order:   the article's order of ids, or null when it kept base's order
// baseItems is what the base looks like read back from its own rendered article
// (classifyFile computes it), so markup the render and the parse disagree on is
// never mistaken for a hand edit.
export function planAdoption(baseBlocks, parsed, baseItems = project(baseBlocks)) {
  const Q = baseItems;
  const q = new Map(Q.map((item) => [item.id, item]));
  const p = new Map(parsed.map((item) => [item.id, item]));
  const edited = new Map(), created = new Map();
  for (const item of parsed) {
    const was = q.get(item.id);
    if (!was) created.set(item.id, item);
    else if (!same(body(was), body(item))) edited.set(item.id, item);
  }
  const deleted = Q.filter((item) => !p.has(item.id)).map((item) => item.id);
  const kept = parsed.filter((item) => q.has(item.id)).map((item) => item.id);
  const baseOrder = Q.filter((item) => p.has(item.id)).map((item) => item.id);
  const reordered = kept.some((id, i) => id !== baseOrder[i]);
  if (!edited.size && !created.size && !deleted.length && !reordered) return null;
  return { edited, created, deleted, order: parsed.map((item) => item.id), reordered, base: q };
}

// ---- model item -> block JSON, keeping what the projection does not carry ----

function keyed(list, current, prefix, extra = (x) => x) {
  const items = list.map((x) => ({ id: x.id, pos: current?.[x.id]?.pos ?? null }));
  const fix = repairSiblings(items, prefix);
  const out = {};
  list.forEach((x, i) => { out[x.id] = extra({ ...x, pos: fix[i] ? fix[i].pos : items[i].pos }); });
  return out;
}

export function blockFromItem(item, cur) {
  const { id, t, ...fields } = item;
  const out = { t, pos: cur?.pos ?? null };
  if (cur && cur.t === t) for (const k of UNPROJECTED[t] || []) if (k in cur) out[k] = cur[k];
  Object.assign(out, fields);
  if (t === "table" && !fields.rows.length) fields.rows = [{ id: `r-${id}`, cells: {} }];
  if (t === "table") {
    out.cols = keyed(fields.cols, cur?.cols, "c", ({ id: _i, ...c }) => c);
    out.rows = keyed(fields.rows, cur?.rows, "r", ({ id: _i, cells, pos }) => ({ pos, cells }));
  }
  if (t === "board") {
    out.columns = keyed(fields.columns, cur?.columns, "c", ({ id: _i, ...c }) => c);
    const cards = {};
    const byCol = new Map();
    for (const k of fields.cards) (byCol.get(k.col) ?? byCol.set(k.col, []).get(k.col)).push(k);
    for (const list of byCol.values()) Object.assign(cards, keyed(list, cur?.cards, "k", ({ id: _i, ...k }) => k));
    out.cards = cards;
  }
  return out;
}

// ---- the transaction ---------------------------------------------------------

function find(doc, id) {
  let found = null;
  doc.forEach((node, pos) => { if (!found && node.attrs.id === id) found = { node, pos }; });
  return found;
}

// Longest run of ids, in target order, whose current positions already increase:
// those stay; every other existing block is lifted out and put back.
function staying(target, index) {
  const seq = target.filter((id) => index.has(id));
  const tails = [], tailAt = [], prev = new Array(seq.length).fill(-1);
  seq.forEach((id, i) => {
    const k = index.get(id);
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] < k) lo = mid + 1; else hi = mid; }
    if (lo > 0) prev[i] = tailAt[lo - 1];
    tails[lo] = k; tailAt[lo] = i;
  });
  const keep = new Set();
  for (let i = tailAt[tails.length - 1] ?? -1; i >= 0; i = prev[i]) keep.add(seq[i]);
  return keep;
}

function replaceInPlace(tr, id, next) {
  const { node, pos } = find(tr.doc, id);
  const attrs = { ...next.attrs, id: node.attrs.id, pos: node.attrs.pos };
  if (node.isTextblock && next.isTextblock && next.type.validContent(node.content)) {
    if (node.type !== next.type || !same(node.attrs, attrs)) tr.setNodeMarkup(pos, next.type, attrs);
    const cur = find(tr.doc, id).node;
    const s = cur.content.findDiffStart(next.content);
    if (s == null) return;
    let { a, b } = cur.content.findDiffEnd(next.content);
    const overlap = s - Math.min(a, b);
    if (overlap > 0) { a += overlap; b += overlap; }
    tr.replace(pos + 1 + s, pos + 1 + a, new pmModel.Slice(next.content.cut(s, b), 0, 0));
    return;
  }
  tr.replaceWith(pos, pos + node.nodeSize, next.type.create(attrs, next.content, next.marks));
}

// The adoption as one transaction on state, or null when there is nothing to do.
export function adoptionTransaction(state, plan) {
  if (!plan) return null;
  const schema = state.schema;
  const doc = state.doc;
  const current = blockMap(doc);
  const tr = state.tr;
  const projected = new Map(project(current).map((item) => [item.id, item]));
  const displaced = {};
  for (const id of [...plan.edited.keys(), ...plan.deleted]) {
    const was = plan.base.get(id), now = projected.get(id);
    if (was && now && !same(body(was), body(now))) displaced[id] = current[id];
  }
  const nodeOf = (id, item) => nodeFromBlock(schema, id, blockFromItem(item, current[id]));

  // Adopting into a page that had no blocks: the editor's empty placeholder line
  // goes, after the article's blocks are in (an empty doc would get a new one).
  const placeholders = plan.base.size ? [] : Object.keys(current).filter((id) => current[id].t === "paragraph" && !current[id].c && !plan.order.includes(id));
  for (const id of plan.deleted) {
    const f = find(tr.doc, id);
    if (f) tr.delete(f.pos, f.pos + f.node.nodeSize);
  }

  // Target order: the article's, with blocks the article never knew (written by
  // someone else since the file was saved) kept after their current predecessor.
  const curOrder = [];
  tr.doc.forEach((n) => curOrder.push(n.attrs.id));
  const known = new Set(plan.order);
  let target = plan.order.filter((id) => !plan.deleted.includes(id));
  if (!plan.reordered) {
    // Keep the current order; place each new block after the block before it in the article.
    target = curOrder.slice();
    plan.order.forEach((id, i) => {
      if (!plan.created.has(id) || target.includes(id)) return;
      let j = i - 1;
      while (j >= 0 && !target.includes(plan.order[j])) j--;
      target.splice(j >= 0 ? target.indexOf(plan.order[j]) + 1 : 0, 0, id);
    });
  } else {
    curOrder.forEach((id, i) => {
      if (known.has(id)) return;
      const before = curOrder.slice(0, i).reverse().find((x) => target.includes(x));
      target.splice(before ? target.indexOf(before) + 1 : 0, 0, id);
    });
  }

  const index = new Map(curOrder.map((id, i) => [id, i]));
  // A block the article shows but someone else deleted since the save stays
  // deleted unless the article changed it.
  target = target.filter((id) => index.has(id) || plan.edited.has(id) || plan.created.has(id));
  const keep = staying(target, index);
  const lifted = new Map();
  for (const id of curOrder.slice().reverse()) {
    if (keep.has(id) || !target.includes(id)) continue;
    const f = find(tr.doc, id);
    lifted.set(id, f.node);
    tr.delete(f.pos, f.pos + f.node.nodeSize);
  }
  let cursor = 0;
  for (const id of target) {
    if (keep.has(id)) {
      const f = find(tr.doc, id);
      cursor = f.pos + f.node.nodeSize;
      continue;
    }
    const item = plan.edited.get(id) || plan.created.get(id);
    const node = item ? nodeOf(id, item) : lifted.get(id);
    tr.insert(cursor, node);
    cursor += node.nodeSize;
  }
  for (const [id, item] of [...plan.edited, ...plan.created]) if (keep.has(id)) replaceInPlace(tr, id, nodeOf(id, item));
  for (const id of placeholders) {
    const f = find(tr.doc, id);
    if (f && tr.doc.childCount > 1) tr.delete(f.pos, f.pos + f.node.nodeSize);
  }
  if (!tr.docChanged) return null;
  return history.closeHistory(tr).setMeta(ADOPT, { displaced });
}

// ---- which file states are adopted ------------------------------------------
//
// data-rev ties one save's article to the tags written in the same save:
//   R  the article's data-rev           A  revOf(parse(article))
//   T  revOf(project(the file's tags))
// A == R: the article is as rendered; nothing to adopt.
// A != R, T == R (or no R): the article was edited and the tags were not, so the
//   tags are the base the edit started from: adopt.
// A != R, T != R: both forms moved (or this is a peer's pre-save snapshot,
//   whose article is its load-time copy): no base to diff from; not adopted.
// With no R (a page written as plain HTML), the article is adopted only when the
// tags hold nothing it does not show: a stale copy of a hand-authored article
// must not revert everything typed since it was first adopted.
//
// Fresh ids depend only on R, so frames edited from the same save (before a
// checkpoint stamps the new blocks' ids) give the same new block the same id.
export function classifyFile(article, tagValues) {
  const R = article.getAttribute("data-rev");
  const base = blocksFromPageValues(tagValues);
  const model = project(base);
  const known = new Map(model.map((i) => [i.id, i]));
  const seed = R ?? "";
  const parsed = parseModel(article, { seed, known });
  const A = revOf(parsed);
  if (R && A === R) return { kind: "untouched" };
  const T = revOf(model);
  if (R && T !== R) return { kind: "unbased", A, R, T };
  if (!R) {
    const shown = new Set(parsed.map((i) => i.id));
    if (!model.every((i) => shown.has(i.id))) return { kind: "unbased", A, R, T };
  }
  const doc = article.ownerDocument;
  const rendered = doc.createElement("article");
  const fallbackOf = (id) => (typeof base[id]?.artifact?.fallbackHtml === "string" ? base[id].artifact.fallbackHtml : "");
  rendered.innerHTML = renderModel(model, { fallbackOf, clean: fragmentCleaner(doc) });
  const baseItems = parseModel(rendered, { seed, known });
  return { kind: "adopt", base, parsed, baseItems };
}
