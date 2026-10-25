import { load } from 'cheerio';
import { merge3, mergeJson } from 'hyper-morph';
import { parseJsonRelaxed } from 'hyper-morph/json-parse';
import { project, parseModel, renderModel, fragmentCleaner } from '../../page/projection.js';
import { blocksFromPageValues } from '../../page/ybind/decode.js';
import { mergePageModels } from '../../page/merge.js';
import { inert, pageRev } from './page-state.js';

// The lone article of html: its element rebuilt in doc, and where its start tag
// and its contents sit in html.
function articleOf(html, doc) {
  const $ = load(html, { sourceCodeLocationInfo: true });
  const nodes = $('article[data-page]').toArray().filter((node) => !inert(node));
  if (nodes.length !== 1) return null;
  const loc = nodes[0].sourceCodeLocation;
  if (!loc?.startTag || !loc?.endTag) return null;
  const article = doc.createElement('article');
  for (const [name, value] of Object.entries(nodes[0].attribs)) article.setAttribute(name, value);
  article.innerHTML = html.slice(loc.startTag.endOffset, loc.endTag.startOffset);
  return { article, startTag: loc.startTag, inner: [loc.startTag.endOffset, loc.endTag.startOffset] };
}

// The article's start tag with its data-rev replaced or added, using the
// attribute's own location so a data-rev inside another value is left alone.
function stampOpen(html, startTag, rev) {
  const at = startTag.attrs?.['data-rev'];
  if (!at) return `${html.slice(startTag.startOffset, startTag.endOffset - 1)} data-rev="${rev}">`;
  return html.slice(startTag.startOffset, at.startOffset) + `data-rev="${rev}"` + html.slice(at.endOffset, startTag.endOffset);
}

function tagValue(tag, doc) {
  const holder = doc.createElement('div');
  holder.innerHTML = tag;
  const script = holder.querySelector('script');
  return script ? parseJsonRelaxed(script.textContent) : null;
}

// An outside writer's page rebased onto the stored page. base is the version the
// writer started from (its article carries the incoming data-rev), current the
// stored file, state the stored page record ({ v, rev, tag }). The result is the
// incoming document with a merged article stamped with state.rev, so the host
// composes the record back in and open tabs adopt it as a hand edit. Null when
// there is nothing to rebase: no record, the writer already had the stored rev,
// or the inputs do not line up.
export function rebasePage({ storedHtml, state, incomingHtml, baseHtml, createDocument }) {
  if (!state || state.v !== 1 || !state.rev || typeof state.tag !== 'string') return null;
  const rev = pageRev(incomingHtml);
  if (!rev || rev === state.rev) return null;
  if (pageRev(baseHtml) !== rev || pageRev(storedHtml) !== state.rev) return null;
  const doc = createDocument();
  const value = tagValue(state.tag, doc);
  if (!value) return null;
  const blocks = blocksFromPageValues([value]);
  const known = new Map(project(blocks).map((item) => [item.id, item]));
  const incoming = articleOf(incomingHtml, doc);
  const base = articleOf(baseHtml, doc);
  const stored = articleOf(storedHtml, doc);
  if (!incoming || !base || !stored) return null;
  const merged = mergePageModels(
    parseModel(base.article, { seed: rev, known }),
    parseModel(stored.article, { seed: state.rev, known }),
    parseModel(incoming.article, { seed: rev, known }),
    { doc, merge3, mergeJson },
  );
  const fallbackOf = (id) => (typeof blocks[id]?.artifact?.fallbackHtml === 'string' ? blocks[id].artifact.fallbackHtml : '');
  const inner = `\n${renderModel(merged.items, { fallbackOf, clean: fragmentCleaner(doc) })}\n`;
  const [innerStart, innerEnd] = incoming.inner;
  const open = stampOpen(incomingHtml, incoming.startTag, state.rev);
  const html = incomingHtml.slice(0, incoming.startTag.startOffset) + open + inner + incomingHtml.slice(innerEnd);
  return { html, conflicts: merged.conflicts };
}

// Of the versions carrying the incoming body's rev, newest first, the one it was
// most likely copied from: the one sharing the most blocks with it, the oldest on
// a tie. A hand edit that kept the rev is a second such version, and merging a
// writer that copied the first one onto it would undo that hand edit.
export function closestBase(candidates, incomingHtml, createDocument) {
  if (candidates.length <= 1) return candidates[0] ?? null;
  const doc = createDocument();
  const rev = pageRev(incomingHtml);
  const blocksOf = (html) => {
    const found = articleOf(html, doc);
    return found ? parseModel(found.article, { seed: rev, known: new Map() }).map((item) => JSON.stringify(item)) : null;
  };
  const incoming = blocksOf(incomingHtml);
  if (!incoming) return candidates[candidates.length - 1];
  const wanted = new Set(incoming);
  let best = candidates[candidates.length - 1];
  let most = -1;
  for (const html of candidates) {
    const blocks = blocksOf(html);
    const shared = blocks ? blocks.filter((block) => wanted.has(block)).length : -1;
    if (shared >= most) { best = html; most = shared; }
  }
  return best;
}

// The page document with its article stamped with rev: a version restored as an
// edit carries the stored rev, so open tabs merge it onto the page they have.
export function stampPageRev(html, rev) {
  if (typeof html !== 'string' || !rev) return null;
  const $ = load(html, { sourceCodeLocationInfo: true });
  const nodes = $('article[data-page]').toArray().filter((node) => !inert(node));
  const loc = nodes.length === 1 ? nodes[0].sourceCodeLocation?.startTag : null;
  if (!loc) return null;
  const stamped = stampOpen(html, loc, rev);
  return html.slice(0, loc.startOffset) + stamped + html.slice(loc.endOffset);
}
