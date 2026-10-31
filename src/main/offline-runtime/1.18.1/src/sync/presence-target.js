/**
 * presence-target.js — the one target union behind `clay.presence`.
 *
 * Kanban's record targets and a Document's page targets travel on the same wire
 * field (`editing`) and through the same facade. This module is the contract
 * alone: what a target is, what bounds it, how a roster session is read, and the
 * exact request body a target turns into. It imports no Yjs, no ProseMirror, no
 * page code and no visual code, so a reader can validate a frame without any of
 * them, and the host can validate the same value without decoding Yjs.
 *
 * Three shapes are accepted for `editing`:
 *
 *   null                      nobody is anywhere
 *   "1.2"                     the legacy dotted block path, unchanged
 *   {kind:"record", id, field?}  a Kanban/Journal record (fieldless journals too)
 *   {kind:"page", v:1, epoch, generation, selection}  a Document's page target
 *
 * Anything else is refused rather than repaired: a frame this module cannot read
 * draws nothing, and a target it cannot read is never published.
 */

import { EDITING_PATH } from './editing-path.js';

// The extended envelope's version. A body without `v` is the legacy shape.
export const PRESENCE_VERSION = 1;

// Bounds, shared by this client and the server contract it speaks to.
export const MAX_TARGET_BYTES = 8 * 1024;
export const MAX_PAGE_ID_BYTES = 256;
export const MAX_REL_BYTES = 1024;
export const MAX_RECORD_ID = 128;
export const MAX_SELECTION_IDS = 128;

// Kanban's documented field enum. A record target without a field is valid.
export const RECORD_FIELDS = Object.freeze([
  'title', 'description', 'labels', 'members', 'dates', 'checklist', 'comment', 'attachments',
]);

// Coalesce selection moves to one every 250 ms, renew a standing target every 5 s,
// and let it expire 15 s after the server received it. The server accepts at most
// 10 updates per second, with a burst of 20, per admitted session and document.
export const COALESCE_MS = 250;
export const RENEW_MS = 5000;
export const EXPIRE_MS = 15000;
export const RATE_PER_SECOND = 10;
export const RATE_BURST = 20;

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
export function validateTarget(value) {
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
export function normalizeEditing(value) {
  const result = validateTarget(value === undefined ? null : value);
  if (!result.ok) return null;
  if (result.target !== null && typeof result.target === 'object' && result.target.kind !== 'record') return null;
  return result.target;
}

/**
 * A stable key for a validated target, so the sender can tell whether the target
 * it holds is the one it sent. Expects `validateTarget`'s output.
 */
export function targetKey(target) {
  if (target === null || target === undefined) return '';
  if (typeof target === 'string') return `path:${target}`;
  return `target:${JSON.stringify(target)}`;
}

/**
 * Read one public session. `n` is monotonic within a session: a value below the
 * one already seen for that session id cannot overwrite the newer one.
 *
 * @param {Array} value
 * @param {Map<string, Object>} [previous]
 */
export function normalizeSessions(value, previous = null) {
  const list = Array.isArray(value) ? value : [];
  const sessions = [];
  for (const item of list) {
    if (!isObject(item)) continue;
    const id = pageId(item.id) ? item.id : null;
    if (!id) continue;
    const n = Number.isSafeInteger(item.n) && item.n >= 0 ? item.n : 0;
    const seen = previous && previous.get(id);
    if (seen && n < seen.n) {
      sessions.push(seen);
      continue;
    }
    const editing = validateTarget(item.editing === undefined ? null : item.editing);
    sessions.push({ id, you: item.you === true, n, editing: editing.ok ? editing.target : null });
  }
  return sessions;
}

/** The private recipient-specific transport block. Never published in a snapshot. */
export function normalizeSelfSession(value) {
  if (!isObject(value)) return null;
  const id = pageId(value.id) ? value.id : null;
  const token = typeof value.token === 'string' && value.token.length ? value.token : null;
  return id && token ? { id, token } : null;
}

/**
 * The exact body a target is sent as.
 *
 * The legacy dotted path and a clear keep the single-field shape every host
 * already accepts, character for character. A record or page target uses the
 * extended envelope once the connection has issued a session token; before that a
 * record may still travel in the single-field shape, and a page target — whose
 * coordinates need the envelope — has no body at all.
 *
 * @param {{target: *, session?: ?{token: string}, n?: number}} request
 * @returns {?Object}
 */
export function requestBody({ target = null, session = null, n = 0 }) {
  if (target === null || target === undefined || typeof target === 'string') return { editing: target ?? null };
  const token = session && typeof session.token === 'string' && session.token.length ? session.token : null;
  if (!token) return target.kind === 'record' ? { editing: target } : null;
  if (!Number.isSafeInteger(n) || n < 0) return null;
  return { v: PRESENCE_VERSION, session: token, n, editing: target };
}
