import { canon, renderModel, parseModel, fragmentCleaner } from "./projection.js";

const TEXT = new Set(["paragraph", "heading", "list_item", "callout", "code_block", "toggle"]);
const same = (a, b) => canon(a) === canon(b);

function inlineOf(item, doc) {
  const article = doc.createElement("article");
  article.setAttribute("data-page", "");
  article.innerHTML = renderModel([{ id: item.id, t: "paragraph", c: item.c ?? "", ...(item.m ? { m: item.m } : {}) }], { clean: fragmentCleaner(doc) });
  return article;
}

// An incoming block whose id is not in base but whose content is the one base
// block of its kind that no other incoming block took: a writer that dropped the
// data-ids. It gets that block's id back, so the rest of the merge sees the edit
// rather than a deletion and an insertion. Scans base in order, from after the
// base item matched to the previous incoming item, and points the children of a
// block that got its id back at that id. Returns copies.
function restoreIds(base, incoming) {
  const index = new Map(base.map((x, n) => [x.id, n]));
  const used = new Set(incoming.map((x) => x.id));
  const renamed = new Map();
  let from = 0;
  const out = incoming.map((x) => {
    const at = index.get(x.id);
    if (at !== undefined) {
      from = at + 1;
      return x;
    }
    const content = { c: x.c ?? "", m: x.m ?? null };
    for (let k = from; k < base.length; k++) {
      const y = base[k];
      if (used.has(y.id) || y.t !== x.t || !same({ c: y.c ?? "", m: y.m ?? null }, content)) continue;
      used.add(y.id);
      from = k + 1;
      renamed.set(x.id, y.id);
      return { ...x, id: y.id };
    }
    return x;
  });
  return out.map((x) => (renamed.has(x.parent) ? { ...x, parent: renamed.get(x.parent) } : x));
}

// Three page models (arrays from parseModel) merged block by block: the
// structure and every field through mergeJson, and merge3 only inside a text
// block both sides changed. The same words changed on both sides go to the
// incoming side; a block one side edited and the other deleted is kept. A code
// block both sides changed keeps its incoming text, newlines and all, and
// conflicts: merge3 on it would flatten them.
// merge3 and mergeJson are passed in: the browser has the vendored
// HyperMorph, the server the hyper-morph package.
export function mergePageModels(base, current, incoming, { doc, merge3, mergeJson }) {
  const conflicts = [];
  const inc = restoreIds(base, incoming);
  const b = new Map(base.map((x) => [x.id, x]));
  const c = new Map(current.map((x) => [x.id, x]));
  const i = new Map(inc.map((x) => [x.id, x]));
  const current2 = current.map((x) => ({ ...x }));
  const incoming2 = inc.map((x) => ({ ...x }));
  const c2 = new Map(current2.map((x) => [x.id, x]));
  const i2 = new Map(incoming2.map((x) => [x.id, x]));
  for (const [id, was] of b) {
    const l = c.get(id);
    const r = i.get(id);
    if (!l || !r || !TEXT.has(was.t) || !TEXT.has(l.t) || !TEXT.has(r.t)) continue;
    const tb = { c: was.c ?? "", m: was.m ?? null };
    const tl = { c: l.c ?? "", m: l.m ?? null };
    const tr = { c: r.c ?? "", m: r.m ?? null };
    if (same(tl, tb) || same(tr, tb) || same(tl, tr)) continue;
    if (was.t === "code_block") {
      for (const t of [c2.get(id), i2.get(id)]) {
        t.c = r.c ?? "";
        if (r.m) t.m = r.m;
        else delete t.m;
      }
      conflicts.push({ id, kind: "text", local: l.c ?? "", remote: r.c ?? "" });
      continue;
    }
    const res = merge3(inlineOf(was, doc), inlineOf(l, doc), inlineOf(r, doc));
    for (const k of res.conflicts) conflicts.push({ id, kind: "text", local: k.local?.textContent ?? null, remote: k.remote?.textContent ?? null });
    const [merged] = parseModel(res.root, { seed: "", known: new Map() });
    for (const t of [c2.get(id), i2.get(id)]) {
      t.c = merged.c;
      if (merged.m) t.m = merged.m;
      else delete t.m;
    }
  }
  const order = current.map((x) => x.id);
  for (const [id, was] of b) {
    const l = c2.get(id);
    if (!l || i.has(id) || same(c.get(id), was)) continue;
    let k = order.indexOf(id) - 1;
    while (k >= 0 && !i2.has(order[k])) k--;
    const at = k < 0 ? 0 : incoming2.findIndex((x) => x.id === order[k]) + 1;
    incoming2.splice(at, 0, { ...l });
    i2.set(id, incoming2[at]);
    conflicts.push({ id, kind: "kept-edit" });
  }
  const out = mergeJson(base, current2, incoming2, {
    onConflict: (k) => conflicts.push({ kind: "field", path: k.path, local: k.local, remote: k.remote, resolved: k.resolved }),
  });
  const ids = new Set(out.map((x) => x.id));
  const parentOf = (id) => (c.get(id) ?? b.get(id) ?? i.get(id))?.parent ?? null;
  const fixed = out.map((x) => {
    let p = x.parent ?? null;
    while (p && !ids.has(p)) p = parentOf(p);
    return p === (x.parent ?? null) ? x : { ...x, parent: p };
  });
  // Both sides moving blocks into each other leaves a parent cycle: the block
  // whose incoming parent closes the loop keeps the tab's parent instead, and a
  // loop that remains goes back to base.
  const parents = new Map(fixed.map((x) => [x.id, x.parent ?? null]));
  const loops = (id) => {
    const seen = new Set([id]);
    for (let p = parents.get(id); p; p = parents.get(p)) {
      if (seen.has(p)) return true;
      seen.add(p);
    }
    return false;
  };
  for (const x of fixed) {
    if (!loops(x.id)) continue;
    for (const p of [c.get(x.id)?.parent, b.get(x.id)?.parent, null]) {
      parents.set(x.id, p && ids.has(p) ? p : null);
      if (!loops(x.id)) break;
    }
  }
  const items = fixed.map((x) => ((x.parent ?? null) === parents.get(x.id) ? x : { ...x, parent: parents.get(x.id) }));
  return { items, conflicts };
}
