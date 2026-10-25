import { parse } from '../vendor/parse5.vendor.js';
import { getStyleBaseUrl } from '../dom/insert-style-tag.js';

export function styleComparisonStripper(identity) {
  const cache = new Map();
  return (html) => {
    if (!html || !html.includes(identity.name !== undefined ? '<style' : '<link')) return html;
    if (cache.has(html)) return cache.get(html);
    const spans = [];
    const tree = parse(html, { sourceCodeLocationInfo: true, scriptingEnabled: true });
    const visit = (node) => {
      const attrs = new Map((node.attrs || []).map(({ name, value }) => [name, value]));
      const owned = identity.name !== undefined
        ? node.tagName === 'style' && (attrs.get('data-name') === identity.name ||
          (identity.legacyId !== undefined && attrs.get('id') === identity.legacyId && !attrs.has('data-name')))
        : node.tagName === 'link' && attrs.get('rel')?.toLowerCase() === 'stylesheet' &&
          getStyleBaseUrl(attrs.get('href') ?? null) === identity.href;
      const loc = node.sourceCodeLocation;
      if (owned && loc?.startTag) {
        spans.push([loc.startTag.startOffset, loc.endTag?.endOffset ?? loc.endOffset]);
      } else {
        for (const child of node.childNodes || []) visit(child);
      }
    };
    visit(tree);
    spans.sort((a, b) => a[0] - b[0]);
    let result = '';
    let offset = 0;
    for (const [from, to] of spans) {
      result += html.slice(offset, from);
      offset = to;
    }
    result += html.slice(offset);
    cache.set(html, result);
    return result;
  };
}
