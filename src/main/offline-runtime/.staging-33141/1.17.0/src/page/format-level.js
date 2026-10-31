// The document format floor: how much of the page format a runtime must know
// before it may write.
//
// The canonical marker is document metadata, outside the unchanged `{v,g,y}`
// page value:
//   <meta name="clay-page-format" content="1">
// Absence means floor 0. A document's floor only ever rises, and every path that
// writes a page declares the capability it writes with in
// `X-Clay-Page-Format`. The value is protocol capability, not authorization: the
// host still applies every permission check.
//
// `requiredPageFormat` answers the other direction: what floor does THIS content
// need? Its registry is frozen at R (floor 1), so it does not shrink back as a
// later release adds native schema support.

export {
  PAGE_FORMAT, PAGE_FORMAT_HEADER, PAGE_FORMAT_META, PAGE_FORMAT_EXTENSION, PAGE_FORMAT_UPGRADE,
  formatCapability, pageFormatFloor, withPageFormatFloor, knownPageFormatFloor, notePageFormatFloor,
} from "../core/page-format.js";
import { PAGE_FORMAT, PAGE_FORMAT_UPGRADE, formatCapability } from "../core/page-format.js";

const level = (value) => (Number.isSafeInteger(value) && value > 0 ? value : 0);

// The floor-0 registry, frozen: every block type, mark code and block field R
// understood when the floor was introduced. Built on first ask, so a client that
// never checks content for its floor never carries the list.
const REGISTRY = {
  types: [
    "paragraph", "heading", "list_item", "callout", "code_block", "toggle",
    "divider", "image", "file", "table", "chart", "board", "tool", "preserved",
  ],
  marks: ["a", "b", "c", "i", "s"],
  fields: [
    "id", "t", "parent", "c", "m", "level", "kind", "indent", "checked", "owner",
    "due", "lang", "open", "src", "alt", "caption", "width", "align", "name",
    "size", "mime", "cols", "rows", "sort", "source", "series", "title",
    "highlight", "columns", "cards", "artifact", "rev", "state", "html", "pos",
  ],
};
let frozen = null;

export function floorZero() {
  if (!frozen) {
    frozen = Object.freeze({
      types: Object.freeze([...REGISTRY.types]),
      marks: Object.freeze([...REGISTRY.marks]),
      fields: Object.freeze([...REGISTRY.fields]),
    });
  }
  return frozen;
}

const CODE = /^[A-Za-z]$/;

// A mark key holds one code per mark, each followed by its attrs as a JSON array
// when it carries them. Anything this registry has no code for is a newer
// runtime's: an unfamiliar compact token, or `x` with a named extension.
function newerMark(key) {
  if (typeof key !== "string") throw new TypeError("page: a mark key is not a string");
  if (!key || key[0] === "@") return false;
  for (let i = 0; i < key.length;) {
    const code = key[i];
    if (!CODE.test(code)) throw new SyntaxError(`page: malformed mark key ${key}`);
    if (!floorZero().marks.includes(code)) return true;
    i += 1;
    if (key[i] !== "[") continue;
    let depth = 0, quoted = false;
    const start = i;
    for (; i < key.length; i++) {
      const ch = key[i];
      if (quoted) {
        if (ch === "\\") i++;
        else if (ch === '"') quoted = false;
      } else if (ch === '"') quoted = true;
      else if (ch === "[") depth++;
      else if (ch === "]" && --depth === 0) { i++; break; }
    }
    if (i >= key.length && key[key.length - 1] !== "]") throw new SyntaxError(`page: unterminated attrs in mark key ${key.slice(start)}`);
  }
  return false;
}

const newerRuns = (m) => {
  if (!Array.isArray(m)) return false;
  for (const run of m) {
    if (Array.isArray(run)) {
      if (run.length === 2 && Number.isInteger(run[0]) && newerMark(run[1])) return true;
    } else if (newerMark(run)) return true;
  }
  return false;
};

/**
 * The floor a prospective semantic model needs: 1 when it holds a named
 * extension mark, an unfamiliar compact token, an unfamiliar block or a block
 * field the floor-0 registry does not know, 0 otherwise.
 *
 * @param {Array<Object>} model - items as projection.js projects them
 * @returns {number}
 */
export function requiredPageFormat(model) {
  if (!Array.isArray(model)) throw new TypeError("page: requiredPageFormat expects a model");
  for (const item of model) {
    if (!item || typeof item !== "object") continue;
    if (!floorZero().types.includes(item.t)) return PAGE_FORMAT;
    for (const key of Object.keys(item)) {
      if (!floorZero().fields.includes(key)) return PAGE_FORMAT;
    }
    if (newerRuns(item.m)) return PAGE_FORMAT;
    if (!Array.isArray(item.rows)) continue;
    for (const row of item.rows) {
      for (const cell of Object.values(row?.cells ?? {})) {
        if (cell && typeof cell === "object" && newerRuns(cell.m)) return PAGE_FORMAT;
      }
    }
  }
  return 0;
}

/**
 * One floor decision for every writer: the client's activation gate and the
 * room's admission helper ask the same question and get the same answer.
 *
 * `floor` is the document's active floor, `required` what the prospective model
 * needs, `capability` what this writer declares, and `admitted` the capabilities
 * of the page editors already in the room. A write is refused before any
 * mutation when this writer is below what the content needs, and a floor rise is
 * refused while an admitted editor could not read the result.
 *
 * @param {Object} input
 * @param {number} [input.floor]
 * @param {number} [input.required]
 * @param {number} [input.capability]
 * @param {number[]} [input.admitted]
 * @returns {{ok: boolean, activate: boolean, floor: number, required: number}}
 */
export function pageFormatDecision({ floor = 0, required = 0, capability = 0, admitted = [] } = {}) {
  const active = level(floor);
  const needs = Math.max(level(required), active);
  const refuse = (minimum) => ({ ok: false, activate: false, floor: active, required: needs, minimum });
  if (formatCapability(capability) < needs) return refuse(needs);
  const activate = needs > active;
  if (activate && admitted.some((value) => formatCapability(value) < needs)) return refuse(needs);
  return { ok: true, activate, floor: needs, required: needs };
}

// What a refused writer is told: which floor the document needs and that its own
// unsaved work is still its own. Nothing here is a reload.
export function pageFormatRefusal(required, message = null) {
  const minimum = level(required) || PAGE_FORMAT;
  const error = new Error(message ?? `This document uses a newer page format (floor ${minimum}); update the editor to keep writing`);
  error.name = "PageFormatUpgradeRequired";
  error.code = PAGE_FORMAT_UPGRADE;
  error.statusCode = 409;
  error.minimum = minimum;
  return error;
}
