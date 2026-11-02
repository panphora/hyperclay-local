// What a replaced edit is called in the notice, and what it said. Pure: reads the
// page, never writes it. Names come from what the person can see (the element's
// kind and the nearest heading above it), never from authored ids.

const KIND = {
  p: "Paragraph", a: "Link", li: "List item", ul: "List", ol: "List", img: "Image",
  section: "Section", article: "Article", div: "Block", span: "Text", td: "Table cell",
  th: "Table cell", tr: "Table row", table: "Table", button: "Button", blockquote: "Quote",
  pre: "Code block", code: "Code", script: "Data block", style: "Style", figure: "Figure",
  video: "Video", input: "Field", textarea: "Field", select: "Field", label: "Label",
  template: "Template",
};

const ATTR = {
  href: "Link address", alt: "Image description", title: "Tooltip", class: "Style",
  style: "Style", value: "Field value", placeholder: "Placeholder",
};

const CONTAINERS = new Set(["section", "article", "div", "li", "aside", "main", "header", "footer", "nav"]);
const HIDDEN = new Set(["script", "style", "template", "noscript"]);
const HEADINGS = "h1,h2,h3,h4,h5,h6";
const OWN_HEADING = ":scope > :is(h1,h2,h3,h4,h5,h6)";
const CONTEXT = 40;

export function cut(text, max = CONTEXT) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max).trimEnd() + "…" : t;
}

// The engine's slices can carry inline markup. Parsed inert, text only: nothing
// from another tab's edit is ever put into the notice as HTML.
export function plain(html) {
  if (html == null) return "";
  const t = document.createElement("template");
  t.innerHTML = String(html);
  return t.content.textContent;
}

function elementOf(node) {
  if (!node) return null;
  return node.nodeType === 1 ? node : node.parentElement;
}

// A node inside a live <template>'s content is not on the page; its host is.
function hostOf(node) {
  let n = node;
  while (n) {
    if (n.isConnected) return elementOf(n);
    const root = n.getRootNode?.();
    if (root && root.nodeType === 11 && root.host) { n = root.host; continue; }
    const tpl = root && root.nodeType === 11 ? findTemplateOwning(root) : null;
    if (tpl) { n = tpl; continue; }
    return null;
  }
  return null;
}

function findTemplateOwning(fragment) {
  for (const t of document.querySelectorAll("template")) if (t.content === fragment) return t;
  return null;
}

function kindName(el) {
  if (!el) return "Edit";
  const tag = el.localName;
  if (/^h[1-6]$/.test(tag)) return "Heading";
  return KIND[tag] || tag.charAt(0).toUpperCase() + tag.slice(1);
}

export function headingAbove(node) {
  let found = null;
  for (const h of document.body.querySelectorAll(HEADINGS)) {
    if (h === node || h.contains(node)) continue;
    if (h.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) found = h;
  }
  return found ? cut(found.textContent) : null;
}

function nameOfElement(el, attrName) {
  if (!el) return attrName ? `"${attrName}" attribute` : "Edit";
  if (attrName) {
    const label = attrName === "src"
      ? (el.localName === "img" || el.localName === "video" ? "Image address" : "Address")
      : ATTR[attrName] || `"${attrName}" attribute`;
    const under = el.isConnected ? headingAbove(el) : null;
    return under ? `${label} under ${under}` : label;
  }
  if (HIDDEN.has(el.localName)) return kindName(el);
  if (/^h[1-6]$/.test(el.localName)) {
    const under = headingAbove(el);
    return under ? `Heading under ${under}` : "Page heading";
  }
  if (CONTAINERS.has(el.localName)) {
    const own = el.querySelector(OWN_HEADING);
    if (own && own.textContent.trim()) return `${cut(own.textContent)} section`;
  }
  const kind = kindName(el);
  const under = el.isConnected ? headingAbove(el) : null;
  return under ? `${kind} under ${under}` : kind;
}

// Up to 40 characters either side of the clash, cut back to a word boundary, with
// the ellipsis only where something was left out.
export function textContext(full, start, end) {
  let before = full.slice(Math.max(0, start - CONTEXT), start);
  let after = full.slice(end, end + CONTEXT);
  let cutBefore = start - CONTEXT > 0;
  let cutAfter = end + CONTEXT < full.length;
  if (cutBefore) {
    const i = before.indexOf(" ");
    before = i >= 0 ? before.slice(i + 1) : before;
  }
  if (cutAfter) {
    const i = after.lastIndexOf(" ");
    after = i >= 0 ? after.slice(0, i) : after;
  }
  return { before, after, cutBefore, cutAfter };
}

function side(hit, ctx) {
  return { before: ctx?.before || "", hit, after: ctx?.after || "", cutBefore: !!ctx?.cutBefore, cutAfter: !!ctx?.cutAfter };
}

const SENTENCE = {
  "edit-beats-delete": (k) => `You deleted this ${k}. The other edit changed it at the same time, so it is still here.`,
  "move-beats-delete": (k) => `You deleted this ${k}. The other edit moved it at the same time, so it is still here.`,
  "both-moved": (k) => `You moved this ${k}. The other edit moved it somewhere else. Their place is showing.`,
  "both-reordered": (k) => `You reordered the items in this ${k}. The other edit reordered them too. Their order is showing.`,
  "insert-collision": () => "You added something here. The other edit added something else in the same place. Theirs is showing.",
};

export function structuralSentence(record, kind) {
  const reason = record.detail || record.reason;
  const make = SENTENCE[reason];
  return make ? make(kind.toLowerCase()) : "Your change here was replaced by the other edit.";
}

function visibleContainer(el) {
  let n = el.parentElement;
  while (n && HIDDEN.has(n.localName)) n = n.parentElement;
  return n && n !== document.documentElement ? n : null;
}

const ATOM = "\uFFFC";
const BREAK = "\u001E";

// The engine's flattened text marks an inline element (an image, a field) with
// U+FFFC and a block break with U+001E. Neither is shown as a control character.
function shown(text) {
  return text.replaceAll(ATOM, "[item]").replaceAll(BREAK, "\n");
}

function textSide(t) {
  if (!t || typeof t.text !== "string") return null;
  const ctx = textContext(t.text, t.start, t.end);
  return {
    before: shown(ctx.before), hit: shown(t.text.slice(t.start, t.end)), after: shown(ctx.after),
    cutBefore: ctx.cutBefore, cutAfter: ctx.cutAfter,
  };
}

// A live node the engine named, still on the page or in a live template.
function liveOf(ref) {
  for (const n of ref?.live || []) if (hostOf(n)) return n;
  return null;
}

// Recovery paths index childNodes from the root the merge read as "mine" (the
// clone the ledger keeps); "content" enters a template's fragment.
function nodeAtPath(root, path) {
  let n = root;
  for (const step of path) {
    if (!n) return null;
    n = step === "content" ? n.content : n.childNodes[step];
  }
  return n || null;
}

function localNode(record, ref) {
  const root = window.clay?.conflicts?.recoveryOf?.(record.id)?.root;
  const path = ref?.local?.[0];
  return root && path ? nodeAtPath(root, path) : null;
}

function visibleHost(node) {
  const h = hostOf(node);
  return h && HIDDEN.has(h.localName) ? visibleContainer(h) : h;
}

// Where a moved block went, in words: "into the FAQ section", "under Pricing".
function placeName(node) {
  const el = elementOf(node);
  if (!el) return null;
  if (CONTAINERS.has(el.localName)) {
    const own = el.querySelector(OWN_HEADING);
    if (own && own.textContent.trim()) return `into the ${cut(own.textContent)} section`;
  }
  const under = el.isConnected ? headingAbove(el) : null;
  return under ? `under ${under}` : null;
}

function recoverySentence(record, rv, kind) {
  const s = rv.structure;
  const k = kind.toLowerCase();
  switch (`${s.localAction}/${s.remoteAction}`) {
    case "deleted/edited":
      return `You deleted this ${k}. The other edit changed it at the same time, so it is still here.`;
    case "deleted/moved":
      return `You deleted this ${k}. The other edit moved it, so it is still here.`;
    case "reordered/reordered":
      return `You changed the order of the items in this ${k}. The other edit changed their order too. Their order is showing.`;
    case "inserted/inserted":
      return "You and the other edit added different content in the same place. Their content is showing.";
    case "moved/moved": {
      const mine = placeName(liveOf(s.localPlacement?.parent) || localNode(record, s.localPlacement?.parent));
      const theirs = placeName(liveOf(s.mergedPlacement?.parent));
      if (mine && theirs && mine !== theirs) {
        return `You moved this ${k} ${mine}. The other edit moved it ${theirs}. Their position is showing.`;
      }
      return `You moved this ${k}. The other edit moved it somewhere else. Their position is showing.`;
    }
    default:
      return "Your change here was replaced by the other edit.";
  }
}

const CHANGED_AGAIN = "The other edit replaced this, and the page changed again before it could be shown here. Download my copy keeps your version.";

const NON_ELEMENT = { 3: "Text", 8: "Comment" };

function recoveryRow(record, rv) {
  const id = record.id;
  // Output the engine could not map to the page: nothing here to point at, and
  // what the page shows is not the other edit's text either.
  const shown = rv.applied !== false;
  const live = shown ? liveOf(rv.subject) : null;
  const target = live ? visibleHost(live) : null;
  const shape = elementOf(live) || elementOf(localNode(record, rv.subject));
  const plainKind = NON_ELEMENT[rv.subject?.nodeType];
  if (rv.attribute) {
    return {
      id, kind: "attr", name: nameOfElement(shape, rv.attribute.qualifiedName), target,
      yours: side(String(record.local ?? "")), now: shown ? side(String(record.remote ?? "")) : null,
      sentence: shown ? null : CHANGED_AGAIN,
    };
  }
  if (rv.structure) {
    const kind = plainKind || (shape ? kindName(shape) : "Block");
    const name = plainKind || (live ? nameOfElement(elementOf(live)) : kind);
    return {
      id, kind: "struct", name, target, yours: null, now: null,
      sentence: shown ? recoverySentence(record, rv, kind) : CHANGED_AGAIN,
    };
  }
  const name = plainKind === "Comment" ? "Comment"
    : shape && HIDDEN.has(shape.localName) ? kindName(shape)
    : nameOfElement(shape);
  return {
    id, kind: "text", name, target,
    yours: textSide(rv.text?.local), now: shown ? textSide(rv.text?.merged) : null,
    sentence: shown ? null : CHANGED_AGAIN,
  };
}

// A JSON conflict path ('players[id="alice"].x', 'grid[0][1]', '["a b"]') as the words
// a person reads: players → alice → x. A keyed segment shows its key's value.
export function jsonPathWords(path) {
  const words = [];
  let i = 0;
  while (i < path.length) {
    if (path[i] === ".") { i++; continue; }
    if (path[i] === "[") {
      let j = i + 1;
      let inString = false;
      for (; j < path.length; j++) {
        const ch = path[j];
        if (inString) {
          if (ch === "\\") j++;
          else if (ch === '"') inString = false;
        } else if (ch === '"') inString = true;
        else if (ch === "]") break;
      }
      let inner = path.slice(i + 1, j);
      const keyed = /^[A-Za-z_$][\w$]*=/.exec(inner);
      if (keyed) inner = inner.slice(keyed[0].length);
      try { words.push(String(JSON.parse(inner))); } catch { words.push(inner); }
      i = j + 1;
      continue;
    }
    let j = i;
    while (j < path.length && path[j] !== "." && path[j] !== "[") j++;
    words.push(path.slice(i, j));
    i = j;
  }
  return words.join(" → ");
}

const jsonValue = (v) => (v === undefined ? "(deleted)" : JSON.stringify(v));

export function rowOf(record) {
  const id = record.id;
  if (record.recovery?.version === 1) return recoveryRow(record, record.recovery);
  if (record.kind === "attr") {
    const el = record.el || null;
    return {
      id, kind: "attr", name: nameOfElement(el, record.name), target: hostOf(el),
      yours: side(String(record.local ?? "")), now: side(String(record.remote ?? "")), sentence: null,
    };
  }
  if (record.kind === "structure") {
    const live = record.el && record.el.isConnected ? record.el : null;
    const shape = live || record.base || record.el || null;
    const kind = kindName(elementOf(shape));
    const sentence = structuralSentence(record, kind);
    const both = typeof record.local === "string" && typeof record.remote === "string";
    return {
      id, kind: "struct", name: live ? nameOfElement(live) : kind, target: live ? hostOf(live) : null,
      yours: both ? side(plain(record.local)) : null, now: both ? side(plain(record.remote)) : null, sentence,
    };
  }
  if (record.kind === "json") {
    const where = jsonPathWords(record.path || "");
    return {
      id, kind: "json", name: where ? `${record.name} → ${where}` : record.name, target: null,
      yours: side(jsonValue(record.local)), now: side(jsonValue(record.resolved)), sentence: null,
    };
  }
  const host = hostOf(record.node);
  const el = elementOf(record.node);
  const name = el && HIDDEN.has(el.localName) ? kindName(el)
    : record.node?.nodeType === 8 ? "Comment"
    : nameOfElement(el);
  // Inline-merge slices (they carry lss) are HTML; whole-text and word-level
  // conflicts are the raw text itself, and parsing that as HTML would eat a literal <.
  const html = typeof record.lss === "number";
  const text = (v) => (v == null ? "" : Array.isArray(v) ? v.join("") : String(v));
  const yours = html ? plain(record.local) : text(record.local);
  const now = html ? plain(record.remote) : text(record.remote);
  return {
    id, kind: "text", name, target: host && !HIDDEN.has(host.localName) ? host : (host ? visibleContainer(host) : null),
    yours: side(yours), now: side(now), sentence: null,
  };
}
