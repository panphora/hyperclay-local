import { load } from 'cheerio';
import * as Y from '../../vendor/yjs.vendor.js';
import { docFromValue } from '../../page/ybind/provider.js';
import { seedLineage, seedOnly, sharesLineage } from '../../page/ybind/lineage.js';
import { inspectPage } from './page-admission.js';
import { PageConversionError } from './page-conversion.js';
import { pageArticles, splitPage, inert } from './page-state.js';

const refuse = (reason) => { throw new PageConversionError(reason); };
const lineages = new Map();

function storedArticle(html, doc) {
  const $ = load(html);
  const nodes = $('article[data-page]').toArray().filter((node) => !inert(node));
  if (nodes.length !== 1) return null;
  const article = doc.createElement('article');
  for (const [name, value] of Object.entries(nodes[0].attribs)) article.setAttribute(name, value);
  article.innerHTML = $(nodes[0]).html();
  return article;
}

function storedLineage(html, createDocument) {
  if (typeof html !== 'string' || pageArticles(html) !== 1) return null;
  if (lineages.has(html)) return lineages.get(html);
  if (typeof createDocument !== 'function') throw new TypeError('A first write over a page document needs createDocument');
  const article = storedArticle(html, createDocument());
  if (!article) refuse('seed-lineage');
  const lineage = seedLineage(article);
  lineages.set(html, lineage);
  if (lineages.size > 4) lineages.delete(lineages.keys().next().value);
  return lineage;
}

export function checkInitialLineage({ currentHtml, html, pageWrite = null, createDocument }) {
  const lineage = storedLineage(currentHtml, createDocument);
  if (!lineage) return;
  let doc;
  try {
    doc = docFromValue(inspectPage(html).tags[0][1], { strict: true });
  } catch {
    refuse('invalid-capture');
  }
  try {
    if (lineage.client !== null && !Y.decodeStateVector(Y.encodeStateVector(doc)).has(lineage.client)) refuse('seed-lineage');
    if (typeof pageWrite === 'string' && pageWrite.trim() === 'v1' && seedOnly(doc, lineage.client) &&
      splitPage(html).file === currentHtml) refuse('nothing-to-write');
  } finally {
    doc.destroy();
  }
}

export function checkOrdinaryLineage({ currentHtml, html, room = null }) {
  const before = inspectPage(currentHtml ?? '');
  const stored = before.kind === 'yjs' ? before.tags[0][1] : room?.stores.get('page')?.value ?? null;
  if (stored && !sharesLineage(stored, inspectPage(html).tags[0][1])) refuse('seed-lineage');
}
