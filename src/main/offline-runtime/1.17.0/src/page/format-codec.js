// The inline mark key grammar, read without assuming the schema knows every
// mark in the key. inline.js keeps a unit's marks as one key: a code per mark,
// an attrs-carrying mark followed by its values as a JSON array, and a hard
// break as "@" and the node's JSON.
//
// A key may also carry marks this runtime has no schema type for, and those are
// kept rather than refused:
//   u                        an unfamiliar compact code, with its exact token
//   z["value"]               an unfamiliar compact code carrying attrs
//   x["underline",{}]        an extensible named mark: x[name, attrs]
//   x["text_color",{"color":"red"}]
// `x` takes exactly [name, attrs]; a name matches NAME, holds neither of the
// Yjs separators "~" and "!", and attrs are plain JSON. Values are kept as they
// arrived, and descriptors come back in one canonical order, so two peers that
// saw the same marks write the same key.
//
// Unfamiliar tokens and named descriptors have one internal editor mark,
// opaque_marks, whose entries list them; it is never written as a mark name of
// its own. Where they must cross the Yjs semantic-name representation, the
// compact tokens travel under the reserved name clay_opaque_code with
// { tokens: [...] }, and named descriptors keep their own name.
import { model } from "../vendor/prosemirror.vendor.js";
import { schema } from "./schema.js";

export const OPAQUE_MARK = "opaque_marks";
export const OPAQUE_CODE = "clay_opaque_code";
export const NAMED_CODE = "x";

export const NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;

// A descriptor's JSON is bounded where it is read: past these, the source is
// refused whole rather than cut short.
export const MAX_DEPTH = 32;
export const MAX_KEYS = 10000;

const CODE = /[A-Za-z]/;
const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const copy = (value) => (value === null || typeof value !== "object" ? value : JSON.parse(JSON.stringify(value)));

// Refuses JSON nested deeper than MAX_DEPTH or holding more than MAX_KEYS keys.
export function bounded(value) {
  let keys = 0;
  const walk = (item, depth) => {
    if (depth > MAX_DEPTH) throw new RangeError(`page: inline JSON is deeper than ${MAX_DEPTH}`);
    if (item === null || typeof item !== "object") return;
    if (Array.isArray(item)) {
      for (const child of item) walk(child, depth + 1);
      return;
    }
    for (const name of Object.keys(item)) {
      if (++keys > MAX_KEYS) throw new RangeError(`page: inline JSON has more than ${MAX_KEYS} keys`);
      walk(item[name], depth + 1);
    }
  };
  walk(value, 1);
  return value;
}

// The end of the JSON array that starts at s[i].
export function arrayEnd(s, i) {
  let depth = 0, str = false;
  for (; i < s.length; i++) {
    const ch = s[i];
    if (str) {
      if (ch === "\\") i++;
      else if (ch === '"') str = false;
    } else if (ch === '"') str = true;
    else if (ch === "[") depth++;
    else if (ch === "]" && --depth === 0) return i + 1;
  }
  throw new SyntaxError(`page: unterminated attrs in mark key ${s}`);
}

const bad = (key) => new SyntaxError(`page: malformed mark key ${key}`);

// The descriptors of one key, in the order it lists them: { code, attrs, token }
// for a compact code, its attrs the JSON array as written and token its exact
// text, and { name, attrs } for a named one.
export function descriptors(key) {
  if (typeof key !== "string") throw new TypeError("page: a mark key is not a string");
  const out = [];
  for (let i = 0; i < key.length;) {
    const code = key[i];
    if (!CODE.test(code)) throw bad(key);
    let end = i + 1;
    let values = null;
    if (key[end] === "[") {
      end = arrayEnd(key, end);
      values = bounded(JSON.parse(key.slice(i + 1, end)));
      if (!Array.isArray(values)) throw bad(key);
    }
    if (code !== NAMED_CODE) {
      out.push({ code, attrs: values, token: key.slice(i, end) });
    } else {
      if (!values || values.length !== 2 || typeof values[0] !== "string" || !NAME.test(values[0]) || !plain(values[1])) throw new SyntaxError(`page: the named mark in ${key} is not [name, attrs]`);
      if (values[0] === OPAQUE_CODE) throw new SyntaxError(`page: ${OPAQUE_CODE} is reserved`);
      out.push({ name: values[0], attrs: copy(values[1]) });
    }
    i = end;
  }
  return out;
}

const order = (a, b) => {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  const x = JSON.stringify(a.attrs), y = JSON.stringify(b.attrs);
  return x === y ? 0 : x < y ? -1 : 1;
};

// The entries of an opaque_marks mark for these descriptors: named descriptors
// by name, then the compact tokens in the order they arrived. A descriptor
// listed twice is ambiguous, so it is refused.
export function entriesOf(descs) {
  const named = [], tokens = [], seen = new Set();
  for (const desc of descs) {
    if (desc.name === undefined) {
      if (seen.has(desc.token)) throw new TypeError(`page: duplicate mark descriptor ${desc.token}`);
      seen.add(desc.token);
      tokens.push(desc.token);
    } else {
      const id = JSON.stringify([desc.name, desc.attrs]);
      if (seen.has(id)) throw new TypeError(`page: duplicate mark descriptor ${id}`);
      seen.add(id);
      named.push({ name: desc.name, attrs: copy(desc.attrs) });
    }
  }
  named.sort(order);
  return tokens.length ? [...named, { tokens }] : named;
}

// The entries of an opaque_marks mark, as they must be read back: the same
// validation and the same canonical order however they arrived.
export function normalizeEntries(entries) {
  if (!Array.isArray(entries)) throw new TypeError("page: opaque entries are not a list");
  const descs = [];
  for (const entry of entries) {
    if (!plain(entry)) throw new TypeError("page: an opaque entry is not an object");
    if (entry.tokens !== undefined) {
      if (Object.keys(entry).length !== 1 || !Array.isArray(entry.tokens)) throw new TypeError("page: an opaque entry is not { tokens: [...] }");
      for (const token of entry.tokens) {
        const parsed = descriptors(token);
        if (parsed.length !== 1 || parsed[0].name !== undefined) throw new SyntaxError(`page: malformed mark token ${token}`);
        descs.push(parsed[0]);
      }
    } else {
      if (Object.keys(entry).length !== 2 || typeof entry.name !== "string" || !NAME.test(entry.name) || !plain(entry.attrs)) throw new TypeError("page: an opaque entry is not { name, attrs }");
      if (entry.name === OPAQUE_CODE) throw new SyntaxError(`page: ${OPAQUE_CODE} is reserved`);
      descs.push({ name: entry.name, attrs: bounded(entry.attrs) });
    }
  }
  return entriesOf(descs);
}

// The key fragment for these entries, as the schema-free half of the record
// writes it. Named descriptors are canonical JSON; a compact token is written
// back exactly as it was read.
export function keyOf(entries) {
  let key = "";
  for (const entry of normalizeEntries(entries)) {
    if (entry.tokens) key += entry.tokens.join("");
    else key += NAMED_CODE + JSON.stringify([entry.name, entry.attrs]);
  }
  return key;
}

// The one internal mark unknown entries live in, which the page schema leaves
// out of marks: it is not a format, a command or a key code, and no data of
// ours ever names it as a mark of its own. It is last so a known mark keeps
// its place in the key.
const markType = (() => {
  const type = new model.MarkType(OPAQUE_MARK, Object.keys(schema.marks).length, schema, {
    attrs: { entries: { default: [] } },
    inclusive: false,
    excludes: "",
    toDOM: () => ["span", 0],
  });
  type.excluded = [];
  return type;
})();

export const isOpaque = (mark) => mark.type.name === OPAQUE_MARK;

export const opaqueMark = (entries) => markType.create({ entries: normalizeEntries(entries) });

// The semantic Yjs fields for these entries: a named descriptor under its own
// name and the compact tokens under the reserved one.
export function yjsFields(entries) {
  const out = Object.create(null);
  for (const entry of normalizeEntries(entries)) {
    if (entry.tokens) out[OPAQUE_CODE] = { tokens: [...entry.tokens] };
    else out[entry.name] = copy(entry.attrs);
  }
  return out;
}

// The base mark name of a Yjs key, without its operation or cancellation mark.
export const yjsName = (key) => key.split("!")[0].split("~")[0];
export const yjsCancelled = (key) => key.includes("!");

// The entries a set of Yjs mark fields stands for: cancelled names drop their
// marks exactly as ybind/marks.js already reads them.
export function entriesOfYjs(fields) {
  const cancelled = new Set();
  for (const key of Object.keys(fields)) if (yjsCancelled(key) && fields[key]) cancelled.add(key.split("!")[0]);
  const entries = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined || yjsCancelled(key) || cancelled.has(key)) continue;
    const name = yjsName(key);
    if (name === OPAQUE_CODE) {
      if (!plain(value) || Object.keys(value).length !== 1 || !Array.isArray(value.tokens)) throw new TypeError(`page: ${OPAQUE_CODE} is not { tokens: [...] }`);
      entries.push({ tokens: value.tokens });
    } else entries.push({ name, attrs: plain(value) ? value : {} });
  }
  return normalizeEntries(entries);
}
