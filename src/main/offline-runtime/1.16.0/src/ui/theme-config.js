// Theme configuration for the UI ClayJS draws on a page: dialogs, prompts, toasts,
// notices. A page configures it (window.clayTheme at first use, or clay.theme());
// the surfaces that paint it are elsewhere, so a reader that never opens one never
// loads them. Configuration is synchronous: clay.theme() answers and throws without
// waiting for a stylesheet, an element or an import.

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

// The configuration a surface resolves against. One owner: theme() writes it here
// and a surface reads it here, so a split module cannot hold a stale copy.
export function currentConfig() {
  return config;
}

// Test hook: forget configuration so the next call re-reads window.clayTheme.
export function _resetTheme() {
  config = null;
  initialized = false;
}
