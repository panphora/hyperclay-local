/**
 * presence-target.js — the Local half of the one target union behind `clay.presence`.
 *
 * A copy of `clayjs/src/sync/presence-target.js` (ClayJS d83aeb0f), which is the reference:
 * the constants, the rules and the refusal reasons have to agree with it exactly, because a
 * target the client will not publish and the host will not accept are the same target seen
 * from two sides. `tests/unit/local-presence.test.js` reads both files and asserts that they
 * do.
 *
 * Three shapes are accepted for `editing`:
 *
 *   null                      nobody is anywhere
 *   "1.2"                     the legacy dotted block path, unchanged
 *   {kind:"record", id, field?}  a Kanban/Journal record (fieldless journals too)
 *   {kind:"page", v:1, epoch, generation, selection}  a Document's page target
 *
 * Anything else is refused rather than repaired: a target this module cannot read is never
 * published, and one the host cannot read is never accepted.
 *
 * The two differences from the client file are its module system and `EDITING_PATH`, which
 * the client imports from `editing-path.js` and this copy spells out here: the server is
 * CommonJS, and re-exporting that expression from this module keeps one definition for both.
 */

const EDITING_PATH = /^\d{1,4}(?:\.\d{1,4}){0,63}$/;

// The extended envelope's version. A body without `v` is the legacy shape.
const PRESENCE_VERSION = 1;

// Bounds, shared by this client and the server contract it speaks to.
const MAX_TARGET_BYTES = 8 * 1024;
const MAX_PAGE_ID_BYTES = 256;
const MAX_REL_BYTES = 1024;
const MAX_RECORD_ID = 128;
const MAX_SELECTION_IDS = 128;

// Kanban's documented field enum. A record target without a field is valid.
const RECORD_FIELDS = Object.freeze([
  'title', 'description', 'labels', 'members', 'dates', 'checklist', 'comment', 'attachments',
]);

// Coalesce selection moves to one every 250 ms, renew a standing target every 5 s,
// and let it expire 15 s after the server received it. The server accepts at most
// 10 updates per second, with a burst of 20, per admitted session and document.
const COALESCE_MS = 250;
const RENEW_MS = 5000;
const EXPIRE_MS = 15000;
const RATE_PER_SECOND = 10;
const RATE_BURST = 20;

const RECORD_KEYS = new Set(['kind', 'id', 'field']);
const PAGE_KEYS = new Set(['kind', 'v', 'epoch', 'generation', 'selection']);
const TEXT_KEYS = new Set(['kind', 'anchor', 'head']);
const BLOCKS_KEYS = new Set(['kind', 'ids']);
const CELL_KEYS = new Set(['kind', 'block', 'row', 'col']);
const POSITION_KEYS = new Set(['block', 'rel']);

// Kanban's ids are ASCII and at most 128 characters. Nothing else is an id.
const RECORD_ID = /^[\x20-\x7e]+$/;
// A base64 relative position: valid alphabet, valid padding, decodable length.
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

const refuse = (reason) => ({ ok: false, reason });
const accept = (target) => ({ ok: true, target });

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const onlyKeys = (value, allowed) => {
  for (const key of Object.keys(value)) if (!allowed.has(key)) return false;
  return true;
};

// UTF-8 length by hand: the host bounds bytes, and neither a test environment nor an
// old browser is guaranteed a TextEncoder.
function utf8Length(text) {
  let length = 0;
  for (const character of text) {
    const code = character.codePointAt(0);
    length += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return length;
}

function pageId(value) {
  return typeof value === 'string'
    && value.length > 0
    && !CONTROL.test(value)
    && utf8Length(value) <= MAX_PAGE_ID_BYTES;
}

function relativePosition(value) {
  if (typeof value !== 'string' || !value.length || value.length % 4 !== 0 || !BASE64.test(value)) return false;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding <= MAX_REL_BYTES;
}

function positionOf(value) {
  if (!isObject(value) || !onlyKeys(value, POSITION_KEYS)) return null;
  if (!pageId(value.block) || !relativePosition(value.rel)) return null;
  return { block: value.block, rel: value.rel };
}

function selectionOf(value) {
  if (!isObject(value)) return null;

  if (value.kind === 'text') {
    if (!onlyKeys(value, TEXT_KEYS)) return null;
    const anchor = positionOf(value.anchor);
    const head = positionOf(value.head);
    return anchor && head ? { kind: 'text', anchor, head } : null;
  }

  if (value.kind === 'blocks') {
    if (!onlyKeys(value, BLOCKS_KEYS) || !Array.isArray(value.ids)) return null;
    if (!value.ids.length || value.ids.length > MAX_SELECTION_IDS) return null;
    for (const id of value.ids) if (!pageId(id)) return null;
    return { kind: 'blocks', ids: [...value.ids] };
  }

  if (value.kind === 'cell') {
    if (!onlyKeys(value, CELL_KEYS)) return null;
    if (!pageId(value.block) || !pageId(value.row) || !pageId(value.col)) return null;
    return { kind: 'cell', block: value.block, row: value.row, col: value.col };
  }

  return null;
}

function withinSize(target) {
  return utf8Length(JSON.stringify(target)) <= MAX_TARGET_BYTES;
}

function recordTarget(value) {
  if (!onlyKeys(value, RECORD_KEYS)) return refuse('key');
  const id = value.id;
  if (typeof id !== 'string' || !id.length || id.length > MAX_RECORD_ID || !RECORD_ID.test(id)) return refuse('id');
  if (value.field === undefined) {
    const target = { kind: 'record', id };
    return withinSize(target) ? accept(target) : refuse('size');
  }
  if (typeof value.field !== 'string' || !RECORD_FIELDS.includes(value.field)) return refuse('field');
  const target = { kind: 'record', id, field: value.field };
  return withinSize(target) ? accept(target) : refuse('size');
}

function pageTarget(value) {
  if (!onlyKeys(value, PAGE_KEYS)) return refuse('key');
  if (value.v !== PRESENCE_VERSION) return refuse('version');
  if (!pageId(value.epoch)) return refuse('epoch');
  if (!Number.isSafeInteger(value.generation) || value.generation < 0) return refuse('generation');
  const selection = selectionOf(value.selection);
  if (!selection) return refuse('selection');
  const target = { kind: 'page', v: PRESENCE_VERSION, epoch: value.epoch, generation: value.generation, selection };
  return withinSize(target) ? accept(target) : refuse('size');
}

/**
 * Read one `editing` value.
 *
 * @param {*} value
 * @returns {{ok: true, target: null|string|Object}|{ok: false, reason: string}}
 */
function validateTarget(value) {
  if (value === null) return accept(null);
  if (typeof value === 'string') return EDITING_PATH.test(value) ? accept(value) : refuse('path');
  if (!isObject(value)) return refuse('shape');
  if (value.kind === 'record') return recordTarget(value);
  if (value.kind === 'page') return pageTarget(value);
  return refuse('kind');
}

/**
 * The person-level `editing` value: the legacy string or a record target. Page
 * coordinates live only in `sessions`, never on a person.
 */
function normalizeEditing(value) {
  const result = validateTarget(value === undefined ? null : value);
  if (!result.ok) return null;
  if (result.target !== null && typeof result.target === 'object' && result.target.kind !== 'record') return null;
  return result.target;
}

module.exports = {
  EDITING_PATH,
  PRESENCE_VERSION,
  MAX_TARGET_BYTES,
  MAX_PAGE_ID_BYTES,
  MAX_REL_BYTES,
  MAX_RECORD_ID,
  MAX_SELECTION_IDS,
  RECORD_FIELDS,
  COALESCE_MS,
  RENEW_MS,
  EXPIRE_MS,
  RATE_PER_SECOND,
  RATE_BURST,
  validateTarget,
  normalizeEditing,
};
