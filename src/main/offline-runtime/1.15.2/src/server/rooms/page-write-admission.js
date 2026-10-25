import { parseJsonRelaxed } from 'hyper-morph/json-parse';
import { liveTags } from './live-data-tags.js';
import { inspectPage } from './page-admission.js';
import { checkPageConversion, PageConversionError } from './page-conversion.js';
import { PageFormatError } from './page-write-guard.js';
import { ifMatchSatisfied } from './spec-wire.js';

const PAGE = /^page(\.[0-9]+)?$/;
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const refuse = (reason) => { throw new PageConversionError(reason); };

function claimsYPage(html) {
  if (!/merge/i.test(html)) return false;
  return liveTags(html, { includeDuplicates: true }).some((tag) => {
    if (!PAGE.test(tag.name)) return false;
    try {
      const value = parseJsonRelaxed(tag.text);
      return record(value) && value.v === 1 && record(value.y);
    } catch {
      return false;
    }
  });
}

function checkInitialRoom(room) {
  if ([...(room?.stores.keys() ?? [])].some((name) => PAGE.test(name)) ||
    [...(room?.lastN.keys() ?? [])].some((key) => PAGE.test(key.slice(0, key.indexOf('\n')))) ||
    (room?.pageTransition && room.pageTransition.format !== 'none')) refuse('room-page-authority');
}

function checkInitialCondition(ifMatch, currentHtml) {
  if (typeof ifMatch !== 'string' || ifMatch.trim() === '*' || ifMatch.includes(',') ||
    !ifMatchSatisfied(ifMatch, currentHtml)) refuse('file-changed');
}

export function checkPageInitial({ currentHtml, html, ifMatch, room = null }) {
  if (typeof currentHtml !== 'string' || inspectPage(currentHtml).kind !== 'none') refuse('invalid-source');
  if (typeof html !== 'string' || inspectPage(html).kind !== 'yjs') refuse('invalid-capture');
  checkInitialRoom(room);
  checkInitialCondition(ifMatch, currentHtml);
}

export function checkPageWriteAdmission({ currentHtml, html, header = null, ifMatch, room = null }) {
  const before = inspectPage(currentHtml ?? '');
  const after = inspectPage(html ?? '');
  const converted = before.kind === 'yjs' || room?.pageTransition?.format === 'yjs';
  if (converted && after.kind === 'none' && header == null) return 'ordinary';
  if (converted && after.kind !== 'yjs') throw new PageFormatError();
  if (header !== null && header !== undefined) {
    checkPageConversion({ header, currentHtml, html, ifMatch, room });
    return 'conversion';
  }
  if (converted) return 'ordinary';
  if (after.kind !== 'yjs') {
    if (after.kind === 'invalid' && claimsYPage(html ?? '') && !claimsYPage(currentHtml ?? '')) refuse('invalid-capture');
    return 'ordinary';
  }
  if (before.kind === 'hybrid') refuse('implicit-conversion');
  if (before.kind !== 'none' || typeof currentHtml !== 'string') refuse('invalid-source');
  checkInitialRoom(room);
  checkInitialCondition(ifMatch, currentHtml);
  return 'initial';
}
