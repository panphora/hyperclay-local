// Page theming for the UI ClayJS draws on a page: dialogs, prompts, toasts, notices.
// A page configures it with window.clayTheme (read at first use) or clay.theme().
// resolveTheme() captures one surface's theme when that surface is built; a later
// clay.theme() call affects the next surface, never one already open.
import { pageScheme } from "./bevel-controls.js";

export const TOKEN_PROPS = {
  font: "font-family",
  headingFont: "font-family",
  text: "color",
  mutedText: "color",
  background: "background-color",
  surface: "background-color",
  border: "border-color",
  accent: "background-color",
  accentText: "color",
  danger: "background-color",
  dangerText: "color",
  success: "color",
  warning: "color",
  radius: "border-radius",
  shadow: "box-shadow",
  overlay: "background-color",
  spacing: "outline-offset",
  buttonHeight: "min-height",
};

export const STATES = ["base", "hover", "active", "focus", "disabled"];

const DIALOG = ["root", "overlay", "panel", "header", "title", "body", "footer", "close", "closeIcon", "content", "input", "hint", "actions", "button", "buttonLabel", "well", "code", "copyButton"];
const NOTICE = ["root", "panel", "header", "title", "text", "icon", "dot", "actions", "button", "buttonLabel", "close", "well", "list", "row", "location", "valueLabel", "value", "before", "after", "mine", "theirs", "warning", "previewRing"];

export const PART_NAMES = new Set([
  "button", "button.default", "button.primary", "button.quiet", "button.danger",
  "buttonLabel", "input", "text", "mutedText", "icon", "well", "close",
  ...["dialog", "people", "crop"].flatMap((s) => DIALOG.map((p) => `${s}.${p}`)),
  "people.choices", "people.choice", "people.choiceLabel",
  "crop.stage", "crop.image", "crop.dim", "crop.selection", "crop.handle",
  "crop.handle.nw", "crop.handle.ne", "crop.handle.sw", "crop.handle.se",
  "toast.stack", "toast.panel", "toast.icon", "toast.text", "toast.close", "toast.closeIcon",
  ...["notice", "conflict", "section", "staleHost"].flatMap((s) => NOTICE.map((p) => `${s}.${p}`)),
]);

const SCHEMES = ["page", "light", "dark"];
const DEFAULT = Object.freeze({ auto: true, colorScheme: "page", tokens: {}, parts: {} });
const kebab = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

let config = null;
let initialized = false;

// A CSS value a page hands us. It lands inside an inline declaration, so it may
// never close that declaration or add a priority of its own.
export function validValue(prop, value) {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (!v || v.length > 500 || /[;{}]|!\s*important/i.test(v)) return false;
  const supports = globalThis.CSS?.supports;
  return typeof supports === "function" ? supports.call(globalThis.CSS, prop, v) : true;
}

function plainObject(x) {
  return !!x && typeof x === "object" && Object.getPrototypeOf(x) === Object.prototype;
}

function normalize(options) {
  if (!plainObject(options)) throw new TypeError("clay.theme: pass an options object, false or null");
  const { auto = true, colorScheme = "page", tokens = {}, parts = {}, ...rest } = options;
  const unknown = Object.keys(rest);
  if (unknown.length) throw new TypeError(`clay.theme: unknown option "${unknown[0]}"`);
  if (typeof auto !== "boolean") throw new TypeError("clay.theme: auto must be true or false");
  if (!SCHEMES.includes(colorScheme)) throw new TypeError(`clay.theme: colorScheme must be one of ${SCHEMES.join(", ")}`);
  if (!plainObject(tokens)) throw new TypeError("clay.theme: tokens must be an object");
  if (!plainObject(parts)) throw new TypeError("clay.theme: parts must be an object");
  const outTokens = {};
  for (const [name, value] of Object.entries(tokens)) {
    if (!(name in TOKEN_PROPS)) throw new TypeError(`clay.theme: unknown token "${name}"`);
    if (!validValue(TOKEN_PROPS[name], value)) throw new TypeError(`clay.theme: token "${name}" is not a valid ${TOKEN_PROPS[name]} value`);
    outTokens[name] = name === "spacing" && value.trim() === "0" ? "0px" : value.trim();
  }
  const outParts = {};
  for (const [name, states] of Object.entries(parts)) {
    if (!PART_NAMES.has(name)) throw new TypeError(`clay.theme: unknown part "${name}"`);
    if (!plainObject(states)) throw new TypeError(`clay.theme: part "${name}" must map states to declarations`);
    outParts[name] = {};
    for (const [state, decls] of Object.entries(states)) {
      if (!STATES.includes(state)) throw new TypeError(`clay.theme: part "${name}" has unknown state "${state}"`);
      if (!plainObject(decls)) throw new TypeError(`clay.theme: "${name}.${state}" must be an object of CSS declarations`);
      outParts[name][state] = {};
      for (const [prop, value] of Object.entries(decls)) {
        if (!/^-?[a-z][a-z-]*$/.test(prop) || prop.startsWith("--")) throw new TypeError(`clay.theme: "${prop}" in ${name}.${state} is not a CSS property name`);
        if (!validValue(prop, value)) throw new TypeError(`clay.theme: "${prop}: ${value}" in ${name}.${state} is not valid`);
        outParts[name][state][prop] = value.trim();
      }
    }
  }
  return Object.freeze({ auto, colorScheme, tokens: Object.freeze(outTokens), parts: Object.freeze(outParts) });
}

function copy(c) {
  if (c === false) return false;
  return JSON.parse(JSON.stringify(c));
}

/**
 * clay.theme(options) replaces the page's theme; clay.theme(false) restores the exact
 * Bevel look; clay.theme(null) restores the default automatic theme; clay.theme()
 * returns a copy of the current configuration. Invalid options throw a TypeError and
 * leave the previous theme in place.
 */
export function theme(options) {
  initTheme();
  if (arguments.length === 0) return copy(config);
  if (options === false) config = false;
  else if (options === null) config = DEFAULT;
  else config = normalize(options);
  return copy(config);
}

// Idempotent. Reads window.clayTheme once and attaches clay.theme. An invalid
// preloaded theme warns and falls back to the default; it never stops ClayJS booting.
export function initTheme() {
  if (initialized) return;
  initialized = true;
  const pre = typeof window !== "undefined" ? window.clayTheme : undefined;
  if (pre === false) config = false;
  else if (pre === undefined || pre === null) config = DEFAULT;
  else {
    try {
      config = normalize(pre);
    } catch (err) {
      console.warn(`clayjs: ignoring window.clayTheme: ${err.message}`);
      config = DEFAULT;
    }
  }
  if (typeof window !== "undefined") {
    const clay = (window.clay = window.clay || {});
    clay.theme = theme;
  }
}

// --- colour helpers --------------------------------------------------------

// [r, g, b, a] for rgb()/rgba() or #rgb/#rrggbb, else null.
export function parseColor(value) {
  const v = String(value).trim().toLowerCase();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1);
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(v);
  if (!m) return null;
  const a = m[4] === undefined ? 1 : Number(m[4]) / (m[5] ? 100 : 1);
  return [Number(m[1]), Number(m[2]), Number(m[3]), a];
}

function luminance([r, g, b]) {
  const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// --- sampling --------------------------------------------------------------

const TRANSPARENT = new Set(["", "transparent", "rgba(0, 0, 0, 0)"]);
const DEFAULT_FONTS = new Set(["serif", "times", "times new roman", "-webkit-standard", "tinos", "liberation serif"]);

// A family list made only of the browser's default serif means the page never chose a font.
function chosenFont(value) {
  const families = String(value || "").split(",").map((f) => f.trim().replace(/^["']|["']$/g, "").toLowerCase()).filter(Boolean);
  return families.length && !families.every((f) => DEFAULT_FONTS.has(f));
}

// The element's own background: null when it has none (transparent, so look further
// out), { blocked: true } when it is translucent, image-backed, or a colour this code
// cannot read, so no palette is inferred at all.
function opaqueBackground(el) {
  if (!el) return null;
  const cs = getComputedStyle(el);
  if (cs.backgroundImage && cs.backgroundImage !== "none") return { blocked: true };
  const raw = (cs.backgroundColor || "").trim();
  if (TRANSPARENT.has(raw)) return null;
  const c = parseColor(raw);
  if (!c) return { blocked: true };
  if (c[3] === 0) return null;
  if (c[3] < 1) return { blocked: true };
  return { value: raw, rgb: c };
}

// The page's font, and its background and text as a pair, from body and root only.
// The pair is kept only when it reads: a dark body whose text colour is set on inner
// elements would otherwise give black on near-black.
export function samplePage() {
  const out = {};
  const body = document.body;
  if (!body) return out;
  const cs = getComputedStyle(body);
  if (chosenFont(cs.fontFamily)) out.font = cs.fontFamily.trim();
  let bg = opaqueBackground(body);
  if (!bg) bg = opaqueBackground(document.documentElement);
  const text = parseColor(cs.color);
  if (bg && !bg.blocked && text && text[3] === 1 && contrast(bg.rgb, text) >= 3) {
    out.background = bg.value;
    out.surface = bg.value;
    out.text = cs.color;
  }
  return out;
}

function cssTokens() {
  const out = {};
  if (!document.body) return out;
  const cs = getComputedStyle(document.body);
  for (const [name, prop] of Object.entries(TOKEN_PROPS)) {
    const v = cs.getPropertyValue(`--clay-ui-${kebab(name)}`).trim();
    if (v && validValue(prop, v)) out[name] = name === "spacing" && v === "0" ? "0px" : v;
  }
  return out;
}

// "page": the root's declared scheme, else <meta name="color-scheme">, else the scheme
// of a sampled or given surface colour, else both, as unthemed ClayJS UI has always used.
function scheme(choice, tokens) {
  if (choice !== "page") return choice;
  const s = getComputedStyle(document.documentElement).colorScheme;
  if (s && s !== "normal") return s;
  const meta = document.querySelector('meta[name="color-scheme"]')?.getAttribute("content")?.trim();
  if (meta && /\b(light|dark)\b/.test(meta)) return meta;
  const surface = parseColor(tokens.surface || "");
  if (surface) return luminance(surface) < 0.2 ? "dark" : "light";
  return "light dark";
}

function onColor(fill, t) {
  const f = parseColor(fill);
  const a = parseColor(t.text);
  const b = parseColor(t.surface);
  if (f && a && b) return contrast(f, a) >= contrast(f, b) ? t.text : t.surface;
  return null;
}

/**
 * The theme for one surface, captured when it is built.
 * Returns { bevel: true, scheme } for the exact Bevel look, otherwise
 * { bevel: false, scheme, tokens, parts }. An absent token means "keep Bevel's
 * declaration for that part".
 */
export function resolveTheme() {
  initTheme();
  if (config === false) return { bevel: true, scheme: pageScheme(), tokens: {}, parts: {} };
  const sampled = config.auto ? samplePage() : {};
  const tokens = { ...sampled, ...cssTokens(), ...config.tokens };
  if (tokens.text && tokens.surface) {
    tokens.mutedText ??= `color-mix(in srgb, ${tokens.text} 70%, ${tokens.surface})`;
    tokens.border ??= `color-mix(in srgb, ${tokens.text} 18%, ${tokens.surface})`;
    tokens.overlay ??= `color-mix(in srgb, ${tokens.text} 20%, transparent)`;
    // A page's own ink is its primary colour unless it names one.
    tokens.accent ??= tokens.text;
  }
  for (const [fill, on] of [["accent", "accentText"], ["danger", "dangerText"]]) {
    if (!tokens[fill] || tokens[on]) continue;
    const pick = onColor(tokens[fill], tokens);
    if (pick) tokens[on] = pick;
    else console.warn(`clayjs: theme sets ${fill} without ${on}; pass ${on} so text on it stays readable`);
  }
  return { bevel: false, scheme: scheme(config.colorScheme, tokens), tokens, parts: config.parts };
}

// Test hook: forget configuration so the next call re-reads window.clayTheme.
export function _resetTheme() {
  config = null;
  initialized = false;
}
