import { load } from 'cheerio';
import { inspectPage } from './page-admission.js';
import { recent } from './recent.js';

export const inert = (node) => {
  for (let parent = node.parent; parent; parent = parent.parent) if (parent.name === 'template' || parent.name === 'noscript') return true;
  return false;
};

const span = (node) => {
  const loc = node.sourceCodeLocation;
  return loc ? { startOffset: loc.startOffset, endOffset: loc.endOffset } : null;
};

// Offsets only, never the parsed tree, so the remembered answers stay small.
const locate = recent(4, (html) => {
  const $ = load(html, { sourceCodeLocationInfo: true });
  const articles = $('article[data-page]').toArray().filter((node) => !inert(node));
  const tags = $('script[merge="page"]').toArray().filter((node) => !inert(node) &&
    ($(node).attr('clay') || '').split(/\s+/).includes('live'));
  return Object.freeze({
    articles: articles.length,
    tags: tags.length,
    rev: articles.length === 1 ? $(articles[0]).attr('data-rev') || null : null,
    article: articles.length === 1 ? span(articles[0]) : null,
    tag: tags.length === 1 ? span(tags[0]) : null,
  });
});

export const pageArticles = (html) => locate(html).articles;

export function pageRev(html) {
  if (typeof html !== 'string') return null;
  return locate(html).rev;
}

const lineStart = (html, at) => {
  for (let i = at - 1; i >= 0; i--) if (html[i] === '\n' || html[i] === '\r') return i + 1;
  return 0;
};

const lineEnd = (html, at) => {
  for (let i = at; i < html.length; i++) {
    if (html[i] === '\n') return i + 1;
    if (html[i] === '\r') return html[i + 1] === '\n' ? i + 2 : i + 1;
  }
  return html.length;
};

const newlineOf = (html, from) => {
  const before = html.slice(Math.max(0, from - 2), from);
  if (before.endsWith('\r\n')) return '\r\n';
  if (before.endsWith('\n')) return '\n';
  if (before.endsWith('\r')) return '\r';
  const first = /\r\n|\r|\n/.exec(html);
  return first ? first[0] : '\n';
};

const spanOf = (html, loc) => {
  let start = loc.startOffset;
  let end = loc.endOffset;
  const from = lineStart(html, start);
  const to = lineEnd(html, end);
  if (!/\S/.test(html.slice(from, start)) && !/\S/.test(html.slice(end, to))) { start = from; end = to; }
  return [start, end];
};

// The stored file and the page tag it held, or the html unchanged with no state
// when it is not exactly one Yjs page tag beside exactly one revisioned article.
// A tag with no revisioned article stays in the file: there it is the only copy
// of the page, and no record could hold it.
export function splitPage(html) {
  if (typeof html !== 'string' || inspectPage(html).kind !== 'yjs') return { file: html, state: null };
  const { articles, tags, rev, article, tag: loc } = locate(html);
  if (articles !== 1 || tags !== 1 || !rev) return { file: html, state: null };
  if (!article || !loc || (loc.startOffset < article.endOffset && loc.endOffset > article.startOffset)) return { file: html, state: null };
  const [start, end] = spanOf(html, loc);
  return { file: html.slice(0, start) + html.slice(end), state: { v: 1, rev, tag: html.slice(loc.startOffset, loc.endOffset) } };
}

// The document an editor sees: the file with the stored page tag put back
// before its article, when the record still belongs to that article.
export function composePage(file, state) {
  if (typeof file !== 'string' || !state || state.v !== 1 || typeof state.tag !== 'string' || !state.rev) return file;
  if (inspectPage(file).kind !== 'none') return file;
  const { articles, rev, article } = locate(file);
  if (articles !== 1 || rev !== state.rev || !article) return file;
  const at = article.startOffset;
  const from = lineStart(file, at);
  const indent = file.slice(from, at);
  const insert = /\S/.test(indent) ? state.tag : `${state.tag}${newlineOf(file, from)}${indent}`;
  return file.slice(0, at) + insert + file.slice(at);
}
