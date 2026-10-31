import { load } from 'cheerio';
import { parseStamp } from './live-data-ops.js';
import { parseBy } from './live-provenance.js';

const NAME = /^[A-Za-z0-9_.:-]{1,64}$/;

// A browser with scripting on reads <noscript> as text, so a tag there is no live tag.
const inert = (node) => {
  for (let parent = node.parent; parent; parent = parent.parent) if (parent.name === 'template' || parent.name === 'noscript') return true;
  return false;
};

/**
 * The live tags in a document: inline JSON scripts with a valid merge name and
 * the live token, outside <template> and <noscript>. A name used twice is skipped
 * entirely unless includeDuplicates is requested for admission checks.
 * Parsed with parse5, as a browser parses it: htmlparser2 is ten times faster
 * but splits a tag differently on input outside writers can produce (a JSON
 * string holding `<!--<script>`, scripts inside <svg> or <iframe>).
 * @param {string} html
 * @param {{ includeDuplicates?: boolean }} options
 * @returns {{ name: string, ephemeral: boolean, text: string, at: { epoch: string, seq: number, hash: string } | null, by: { client: string, n: number } | null }[]}
 */
export function liveTags(html, { includeDuplicates = false } = {}) {
  const $ = load(html);
  const found = new Map();
  const duplicated = new Set();
  const all = [];
  $('script[merge]').each((_, node) => {
    const el = $(node);
    if (inert(node) || el.attr('src') !== undefined) return;
    const tokens = (el.attr('clay') || '').split(/\s+/);
    if (!tokens.includes('live')) return;
    const type = (el.attr('type') || '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json' && !type.endsWith('+json')) return;
    const name = el.attr('merge');
    if (!NAME.test(name)) return;
    const tag = { name, ephemeral: tokens.includes('ephemeral'), text: el.html() ?? '', at: parseStamp(el.attr('live-at')), by: parseBy(el.attr('live-by')) };
    if (includeDuplicates) all.push(tag);
    if (found.has(name)) {
      duplicated.add(name);
      return;
    }
    found.set(name, tag);
  });
  if (includeDuplicates) return all;
  for (const name of duplicated) found.delete(name);
  return [...found.values()];
}
