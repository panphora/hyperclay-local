const { parse } = require('parse5');

function persistentTags(html) {
  const { liveTags } = require('@panphora/clayjs/server/rooms');
  const tags = liveTags(html, { includeDuplicates: true });
  const found = new Map();
  for (const tag of tags) {
    if (tag.ephemeral) continue;
    const entries = found.get(tag.name) || [];
    entries.push(tag);
    found.set(tag.name, entries);
  }
  return found;
}

function compatibleContinuation(baseline, html, room) {
  const { serializeLive, textHash } = require('@panphora/clayjs/server/rooms');
  if (!baseline || !room) return false;
  const stores = [...room.stores].filter(([, store]) => !store.ephemeral);
  if (!stores.length) return false;
  const before = persistentTags(baseline);
  const after = persistentTags(html);
  if (before.size !== after.size || before.size !== stores.length) return false;
  for (const [name, store] of stores) {
    const previous = before.get(name);
    const next = after.get(name);
    if (previous?.length !== 1 || next?.length !== 1) return false;
    if (previous[0].text === next[0].text &&
        JSON.stringify(previous[0].at) === JSON.stringify(next[0].at)) continue;
    const text = serializeLive(store.value);
    if (next[0].text !== text || next[0].at?.epoch !== room.epoch ||
        next[0].at.seq !== store.last || next[0].at.hash !== textHash(text)) return false;
  }
  return true;
}

function tagRewrite(baseline, room, stores) {
  const { serializeLive, stampOf } = require('@panphora/clayjs/server/rooms');
  const locations = new Map();
  const visit = (node, inert = false) => {
    const hidden = inert || node.tagName === 'template' || node.tagName === 'noscript';
    if (node.tagName === 'script' && !hidden && node.sourceCodeLocation?.startTag && node.sourceCodeLocation.endTag) {
      const attrs = Object.fromEntries((node.attrs || []).map((attr) => [attr.name, attr.value]));
      const tokens = (attrs.clay || '').split(/\s+/);
      const type = (attrs.type || '').split(';')[0].trim().toLowerCase();
      if (tokens.includes('live') && !tokens.includes('ephemeral') &&
          (type === 'application/json' || type.endsWith('+json')) && attrs.merge) {
        const entries = locations.get(attrs.merge) || [];
        entries.push(node.sourceCodeLocation);
        locations.set(attrs.merge, entries);
      }
    }
    for (const child of node.childNodes || []) visit(child, hidden);
    if (node.content) visit(node.content, hidden);
  };
  visit(parse(baseline, { sourceCodeLocationInfo: true }));

  const valid = persistentTags(baseline);
  const edits = [];
  for (const [name, store] of stores) {
    const found = locations.get(name);
    if (valid.get(name)?.length !== 1 || found?.length !== 1) {
      throw new Error(`Missing or duplicate recovery tag: ${name}`);
    }
    const loc = found[0];
    const text = serializeLive(store.value);
    const stamp = stampOf(room.epoch, store.last, text);
    let start = baseline.slice(loc.startTag.startOffset, loc.startTag.endOffset);
    const attributes = Object.entries(loc.startTag.attrs || {})
      .filter(([name]) => name === 'live-at' || name === 'live-by')
      .map(([, at]) => ({ start: at.startOffset - loc.startTag.startOffset, end: at.endOffset - loc.startTag.startOffset }))
      .sort((a, b) => b.start - a.start);
    for (const attr of attributes) start = start.slice(0, attr.start) + start.slice(attr.end);
    start = start.slice(0, -1) + ` live-at="${stamp}">`;
    edits.push({ start: loc.startTag.startOffset, end: loc.endTag.startOffset, value: `${start}${text}` });
  }
  edits.sort((a, b) => b.start - a.start);
  let rendered = baseline;
  for (const edit of edits) rendered = rendered.slice(0, edit.start) + edit.value + rendered.slice(edit.end);
  const result = persistentTags(rendered);
  for (const [name, store] of stores) {
    const tags = result.get(name);
    if (tags?.length !== 1 || tags[0].text !== serializeLive(store.value)) {
      throw new Error(`Recovery validation failed: ${name}`);
    }
  }
  return rendered;
}

function renderRecovered(baseline, room) {
  if (typeof baseline !== 'string' || !room) throw new Error('Missing recovery baseline');
  const stores = [...room.stores].filter(([, store]) => !store.ephemeral);
  if (!stores.length) throw new Error('No persistent state to recover');
  const { splitPage } = require('@panphora/clayjs/server/rooms');
  const { captureCheckpoint, renderCheckpoint } = require('@panphora/clayjs/server/checkpoint');
  const capture = captureCheckpoint(room, { nodeId: room.nodeId, roomKey: room.key });
  const { JSDOM } = require('jsdom');
  const rendered = renderCheckpoint(baseline, capture, {
    createDocument: () => new JSDOM('<!doctype html><html><body></body></html>', {
      runScripts: undefined, resources: undefined,
    }).window.document,
  });
  return splitPage(rendered.kind === 'ok' ? rendered.html : tagRewrite(baseline, room, stores)).file;
}

module.exports = { compatibleContinuation, renderRecovered };
