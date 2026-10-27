// Projecting an accepted saved file onto the article a reader is showing.
//
// The saved markup is already the rendered form of the writer's model, so this is
// not a second merge engine: it never combines concurrent authored changes. It only
// brings a read-only article up to one accepted file while keeping the nodes that
// file did not change, so a mounted tool, an open toggle and find-in-page survive.
//
// Identity comes from logical block `data-id` values. Lists and toggle bodies are
// walked; boards, tables, charts, media and tools are opaque interiors, so a board
// card id can never match an article block id. An id that appears twice is not
// reused at all: neither occurrence promises node identity.

const ARTICLE = "article[data-page]";
const TOOL = 'section[data-type="tool"][data-id]';
const CONTAINERS = new Set(["UL", "OL", "LI", "DETAILS"]);
const LISTS = new Set(["UL", "OL"]);

export const isTool = (el) => el.tagName === "SECTION" && el.getAttribute("data-type") === "tool" && el.hasAttribute("data-id");

/**
 * The tools an article holds, keyed by id, with the revision and artifact their
 * root names. A decode failure is kept as `invalid` so a reader can say so and
 * leave the saved fallback markup visible instead of mounting garbage.
 */
export function toolInfoOf(el) {
  return toolInfo(el);
}

function toolInfo(el) {
  const data = el.querySelector(':scope > script[type="application/json"][data-tool]');
  let parsed = {};
  try {
    parsed = data ? JSON.parse(data.textContent) : {};
  } catch (error) {
    return { rev: null, artifact: null, state: {}, signature: null, invalid: true, error };
  }
  return {
    rev: parsed.rev ?? null,
    artifact: parsed.artifact ?? null,
    state: parsed.state ?? {},
    signature: JSON.stringify(parsed.artifact ?? null),
    invalid: false,
  };
}

export function toolsOf(root) {
  const tools = new Map();
  const duplicated = new Set();
  for (const el of root.querySelectorAll(TOOL)) {
    const id = el.getAttribute("data-id");
    if (duplicated.has(id)) continue;
    if (tools.has(id)) {
      tools.delete(id);
      duplicated.add(id);
      continue;
    }
    tools.set(id, toolInfo(el));
  }
  return tools;
}

export function toolStateOf(doc) {
  const tag = doc.querySelector('script[type="application/json"][merge="page.tools"]');
  if (!tag) return {};
  try { return JSON.parse(tag.textContent); } catch { return {}; }
}

function indexBlocks(root) {
  const found = new Map();
  const duplicated = new Set();
  const walk = (container) => {
    for (const child of container.children) {
      const id = child.getAttribute("data-id");
      if (id) {
        if (duplicated.has(id)) continue;
        if (found.has(id)) {
          found.delete(id);
          duplicated.add(id);
          continue;
        }
        found.set(id, child);
      }
      if (CONTAINERS.has(child.tagName)) walk(child);
    }
  };
  walk(root);
  return found;
}

function retainedIds(root) {
  const ids = new Set();
  const walk = (container) => {
    for (const child of container.children) {
      const id = child.getAttribute("data-id");
      if (id) ids.add(id);
      if (CONTAINERS.has(child.tagName)) walk(child);
    }
  };
  walk(root);
  return ids;
}

/**
 * Validate one full saved file before anything is replaced. Exactly one page
 * article must be present, and the bytes must be the string the host sent, not a
 * live DOM snapshot.
 */
export function prepareSavedArticle(html, doc = document) {
  if (typeof html !== "string" || html === "") return { ok: false, reason: "bytes" };
  const parser = (doc.defaultView ?? globalThis).DOMParser;
  if (typeof parser !== "function") return { ok: false, reason: "parser" };
  const source = new parser().parseFromString(html, "text/html");
  const articles = [...source.querySelectorAll(ARTICLE)];
  if (articles.length !== 1) return { ok: false, reason: "article" };
  const article = articles[0];
  const savedOpen = new Map();
  for (const details of article.querySelectorAll("details[data-id]")) {
    savedOpen.set(details.getAttribute("data-id"), details.hasAttribute("open"));
  }
  const tools = toolsOf(article);
  return {
    ok: true,
    article,
    source,
    rev: article.getAttribute("data-rev"),
    title: source.title || null,
    savedOpen,
    tools,
    toolState: tools.size ? toolStateOf(source) : {},
  };
}

export const keepToolVersion = (live, incoming) => {
  const a = toolInfo(live);
  const b = toolInfo(incoming);
  return !a.invalid && !b.invalid && a.rev === b.rev && a.signature === b.signature;
};

/**
 * Apply one prepared file to the live article. Returns whether anything changed.
 *
 * Each container's children are reconciled in saved order: an equal keyed block is
 * reused, a compatible keyed block is moved rather than cloned, a changed ordinary
 * leaf is replaced, and a changed list or toggle is recursed into so its unchanged
 * descendants survive. A tool whose id, revision and artifact still match is left
 * untouched: its runtime subtree and reader-local interaction state are the host's.
 */
export function applyPreparedArticle(prepared, { article, readerOpen = new Map(), savedOpen = null, keepTool = keepToolVersion } = {}) {
  if (!prepared?.ok || !article) return { changed: false };
  for (const details of prepared.article.querySelectorAll("details[data-id]")) {
    const id = details.getAttribute("data-id");
    if (!readerOpen.has(id)) continue;
    if (details.hasAttribute("open") !== readerOpen.get(id)) details.toggleAttribute("open", readerOpen.get(id));
  }
  const index = indexBlocks(article);
  const used = new Set();
  let changed = false;

  const fresh = (incoming) => {
    changed = true;
    return incoming.cloneNode(true);
  };

  const matchingUnkeyed = (incoming, container) => {
    const wanted = retainedIds(incoming);
    for (const live of container.children) {
      if (used.has(live) || live.hasAttribute("data-id")) continue;
      if (live.tagName !== incoming.tagName) continue;
      if (!wanted.size) return live;
      const have = retainedIds(live);
      for (const id of wanted) if (have.has(id)) return live;
    }
    return null;
  };

  const matchingLeaf = (incoming, container) => {
    for (const live of container.children) {
      if (used.has(live) || live.hasAttribute("data-id")) continue;
      if (live.tagName === incoming.tagName) return live;
    }
    return null;
  };

  const syncAttributes = (live, incoming, skip = null) => {
    for (const { name, value } of [...incoming.attributes]) {
      if (name === skip || live.getAttribute(name) === value) continue;
      live.setAttribute(name, value);
      changed = true;
    }
    for (const { name } of [...live.attributes]) {
      if (name === skip || incoming.hasAttribute(name)) continue;
      live.removeAttribute(name);
      changed = true;
    }
  };

  const reuseNode = (incoming, live, at) => {
    const same = (candidate) =>
      candidate && candidate.nodeType === incoming.nodeType && candidate.nodeValue === incoming.nodeValue && !used.has(candidate);
    const found = same(live.childNodes[at]) ? live.childNodes[at] : [...live.childNodes].find(same);
    if (!found) return incoming.cloneNode(true);
    used.add(found);
    return found;
  };

  const reconcileContainer = (live, incoming) => {
    const ordered = [];
    const children = [...incoming.childNodes];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child.nodeType !== 1) {
        ordered.push(reuseNode(child, live, i));
        continue;
      }
      const node = pick(child, live);
      used.add(node);
      ordered.push(node);
    }
    const kept = new Set(ordered);
    let walk = live.firstChild;
    for (const node of ordered) {
      while (walk && !kept.has(walk)) walk = walk.nextSibling;
      if (walk === node) {
        walk = walk.nextSibling;
        continue;
      }
      live.insertBefore(node, walk);
      changed = true;
    }
    for (const child of [...live.childNodes]) {
      if (kept.has(child)) continue;
      child.remove();
      changed = true;
    }
  };

  const freshShell = (incoming) => {
    changed = true;
    const node = incoming.cloneNode(false);
    reconcileContainer(node, incoming);
    return node;
  };

  const reconcileDetails = (live, incoming) => {
    changed = true;
    const id = live.getAttribute("data-id");
    const open = readerOpen.has(id) ? readerOpen.get(id) : incoming.hasAttribute("open");
    syncAttributes(live, incoming, "open");
    if (live.hasAttribute("open") !== open) live.toggleAttribute("open", open);
    reconcileContainer(live, incoming);
  };

  const reconcileItem = (live, incoming) => {
    changed = true;
    syncAttributes(live, incoming);
    reconcileContainer(live, incoming);
  };

  function pick(incoming, container) {
    const id = incoming.getAttribute("data-id");
    if (id) {
      const live = index.get(id);
      if (!live || used.has(live) || live === container || live.contains(container)) return fresh(incoming);
      used.add(live);
      if (isTool(live) && isTool(incoming)) return keepTool(live, incoming) ? live : fresh(incoming);
      if (live.tagName !== incoming.tagName) return fresh(incoming);
      if (live.isEqualNode(incoming)) return live;
      if (incoming.tagName === "DETAILS") {
        reconcileDetails(live, incoming);
        return live;
      }
      if (incoming.tagName === "LI") {
        reconcileItem(live, incoming);
        return live;
      }
      if (LISTS.has(incoming.tagName)) {
        syncAttributes(live, incoming);
        reconcileContainer(live, incoming);
        return live;
      }
      return fresh(incoming);
    }
    if (LISTS.has(incoming.tagName)) {
      const live = matchingUnkeyed(incoming, container);
      if (!live) return freshShell(incoming);
      used.add(live);
      syncAttributes(live, incoming);
      reconcileContainer(live, incoming);
      return live;
    }
    const live = matchingLeaf(incoming, container);
    if (!live) return fresh(incoming);
    used.add(live);
    if (live.isEqualNode(incoming)) return live;
    changed = true;
    return fresh(incoming);
  }

  reconcileContainer(article, prepared.article);
  if (savedOpen) {
    savedOpen.clear();
    for (const [id, open] of prepared.savedOpen) savedOpen.set(id, open);
  }
  for (const id of [...readerOpen.keys()]) if (!prepared.savedOpen.has(id)) readerOpen.delete(id);
  return { changed };
}
