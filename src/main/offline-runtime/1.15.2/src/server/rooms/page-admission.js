import { createHash } from 'node:crypto';
import { parseJsonRelaxed } from 'hyper-morph/json-parse';
import { cloneJson } from './live-data-ops.js';
import { liveTags } from './live-data-tags.js';
import { recent } from './recent.js';

const PAGE = /^page(\.[0-9]+)?$/;
const PART = /^(.+)\.(\d+)\.(\d+)$/;
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export const isHybridPageValue = (value) => record(value) && record(value.blocks) && (value.deleted == null || record(value.deleted)) && Object.keys(value).every((key) => key === 'blocks' || key === 'deleted');

export function isYPageValue(value, { complete = true } = {}) {
  if (!record(value) || value.v !== 1 || !record(value.y) || Object.keys(value).some((key) => !['v', 'g', 'y'].includes(key))) return false;
  const whole = new Set();
  const groups = new Map();
  for (const [key, text] of Object.entries(value.y)) {
    if (typeof text !== 'string') return false;
    const part = PART.exec(key);
    if (!part) {
      whole.add(key);
      continue;
    }
    const index = Number(part[2]);
    const count = Number(part[3]);
    if (!Number.isSafeInteger(index) || !Number.isSafeInteger(count) || count < 1 || index >= count) return false;
    const group = groups.get(part[1]) ?? { count, indices: new Set() };
    if (group.count !== count || group.indices.has(index)) return false;
    group.indices.add(index);
    groups.set(part[1], group);
  }
  for (const [key, group] of groups) {
    if (whole.has(key) || (complete && group.indices.size !== group.count)) return false;
  }
  return true;
}

// Callers get their own copy of the tags, so none can change another's answer.
export function inspectPage(html) {
  const answer = inspected(html);
  return { ...answer, tags: cloneJson(answer.tags) };
}

const inspected = recent(4, (html) => {
  if (!/merge/i.test(html)) return { kind: 'none', tags: [] };
  const source = liveTags(html, { includeDuplicates: true }).filter((tag) => PAGE.test(tag.name));
  if (!source.length) return { kind: 'none', tags: [] };
  const names = new Set();
  const tags = [];
  for (const tag of source) {
    if (names.has(tag.name)) return { kind: 'invalid', reason: 'duplicate-tag', tags: [] };
    names.add(tag.name);
    if (tag.ephemeral) return { kind: 'invalid', reason: 'ephemeral-tag', tags: [] };
    try {
      tags.push([tag.name, cloneJson(parseJsonRelaxed(tag.text))]);
    } catch {
      return { kind: 'invalid', reason: 'invalid-json', tags: [] };
    }
  }
  if (tags.some(([, value]) => record(value) && (Object.hasOwn(value, 'y') || Object.hasOwn(value, 'v')))) {
    if (tags.length !== 1 || tags[0][0] !== 'page' || !isYPageValue(tags[0][1])) return { kind: 'invalid', reason: 'invalid-yjs', tags };
    return { kind: 'yjs', tags };
  }
  return { kind: tags.every(([, value]) => isHybridPageValue(value)) ? 'hybrid' : 'other', tags };
});

const canon = (value) => (Array.isArray(value) ? `[${value.map(canon).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canon(value[key])).join(',')}}` : JSON.stringify(value ?? null));

export function pageBaseline(tags) {
  if (!Array.isArray(tags) || !tags.length) throw new TypeError('Expected named hybrid page tags');
  const names = new Set();
  const source = tags.map((tag) => {
    if (!Array.isArray(tag) || tag.length !== 2 || typeof tag[0] !== 'string' || !PAGE.test(tag[0]) || names.has(tag[0])) throw new TypeError('Expected unique page tag names');
    names.add(tag[0]);
    const value = cloneJson(tag[1]);
    if (!isHybridPageValue(value)) throw new TypeError('Expected a hybrid page value');
    return [tag[0], value];
  });
  return createHash('sha256').update(canon(source), 'utf8').digest('hex');
}
