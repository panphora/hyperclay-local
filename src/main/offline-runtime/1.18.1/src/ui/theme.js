// Page theming for the UI ClayJS draws on a page: dialogs, prompts, toasts, notices.
// A page configures it with window.clayTheme (read at first use) or clay.theme().
// resolveTheme() captures one surface's theme when that surface is built; a later
// clay.theme() call affects the next surface, never one already open.
import { TOKEN_PROPS, currentConfig, initTheme, validValue } from "./theme-config.js";
import { pageScheme } from "./page-scheme.js";

// The configuration itself lives in theme-config.js, which the loader reads at
// boot; these names stay here because every surface imported them from here.
export { PART_NAMES, STATES, TOKEN_PROPS, _resetTheme, initTheme, theme, validValue } from "./theme-config.js";

const kebab = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

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
  const config = currentConfig();
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
