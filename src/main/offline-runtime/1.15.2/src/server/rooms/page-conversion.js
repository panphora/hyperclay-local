import { ifMatchSatisfied } from './spec-wire.js';
import { inspectPage, pageBaseline } from './page-admission.js';

const PAGE = /^page(\.[0-9]+)?$/;
const BASE = /^[0-9a-f]{64}$/;
const EPOCH = /^[A-Za-z0-9-]{1,64}$/;

export class PageConversionError extends Error {
  constructor(reason) {
    super(`Page conversion refused: ${reason}`);
    this.name = 'PageConversionError';
    this.reason = reason;
  }
}

const refuse = (reason) => { throw new PageConversionError(reason); };

export function parsePageConversion(header) {
  if (header === undefined || header === null) return null;
  if (typeof header !== 'string') refuse('invalid-header');
  const [version, ...fields] = header.split(';').map((part) => part.trim());
  if (version !== 'v1') refuse('invalid-header');
  const params = new Map();
  for (const field of fields) {
    const pair = field.split('=').map((part) => part.trim());
    if (pair.length !== 2 || !['source', 'base', 'epoch'].includes(pair[0]) || !pair[1] || params.has(pair[0])) refuse('invalid-header');
    params.set(pair[0], pair[1]);
  }
  const source = params.get('source');
  const base = params.get('base');
  const epoch = params.get('epoch');
  if (!['file', 'room'].includes(source) || !BASE.test(base ?? '')) refuse('invalid-header');
  if (source === 'file' ? params.has('epoch') : !EPOCH.test(epoch ?? '')) refuse('invalid-header');
  return { source, base, epoch: epoch ?? null };
}

// A null result means no explicit conversion request, not approval of an ordinary save.
export function checkPageConversion({ header, currentHtml, html, ifMatch, room = null }) {
  const request = parsePageConversion(header);
  if (!request) return null;
  if (typeof ifMatch !== 'string' || ifMatch.trim() === '*' || ifMatch.includes(',') || !ifMatchSatisfied(ifMatch, currentHtml)) refuse('file-changed');
  const before = inspectPage(currentHtml);
  const after = inspectPage(html);
  if (before.kind !== 'hybrid') refuse('invalid-source');
  if (after.kind !== 'yjs') refuse('invalid-capture');
  const stores = new Map([...(room?.stores ?? [])].filter(([name]) => PAGE.test(name)));
  if (request.source === 'file' && stores.size) refuse('room-required');
  if (request.source === 'room') {
    if (!stores.size || request.epoch !== room?.epoch) refuse('room-changed');
    const names = new Set(before.tags.map(([name]) => name));
    if ([...stores].some(([name, store]) => !names.has(name) || store.ephemeral)) refuse('ambiguous-source');
  }
  const tags = before.tags.map(([name, value]) => [name, stores.has(name) ? stores.get(name).value : value]);
  let baseline;
  try {
    baseline = pageBaseline(tags);
  } catch {
    refuse('invalid-source');
  }
  if (baseline !== request.base) refuse('source-changed');
  return { ...request, names: tags.map(([name]) => name), value: after.tags[0][1] };
}
