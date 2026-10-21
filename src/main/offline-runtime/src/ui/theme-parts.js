// Theme declarations for the controls ClayJS draws. tokenRules() maps a theme's tokens
// onto one semantic role in one state; partRules() applies a page's explicit part
// overrides, general to specific. Both return "prop:value" strings for hostile-css,
// and both return nothing for no theme or the exact Bevel theme.

export const themed = (theme) => !!theme && !theme.bevel;

const mix = (a, b, pct) => `color-mix(in srgb, ${a}, ${b} ${pct}%)`;
const decl = (prop, value) => (value ? [`${prop}:${value}`] : []);

// States in the order they apply. Disabled suppresses hover and pressed.
export function stateList({ hover = false, active = false, focus = false, disabled = false } = {}) {
  const list = ["base"];
  if (!disabled && hover) list.push("hover");
  if (!disabled && active) list.push("active");
  if (focus) list.push("focus");
  if (disabled) list.push("disabled");
  return list;
}

// Hover and press on neutral controls: a page's own background colour when it gave one
// that differs from the surface, else the surface tinted toward the text (or the
// control's own colour when the theme has no text).
function neutral(t, pct) {
  if (t.background && t.background !== t.surface) return pct > 8 ? mix(t.background, t.text || "currentColor", 6) : t.background;
  if (t.surface) return mix(t.surface, t.text || "currentColor", pct);
  return t.background;
}

function button(t, variant, state) {
  const r = [];
  const fill = { primary: ["accent", "accentText"], danger: ["danger", "dangerText"] }[variant];
  if (state === "base") r.push(...decl("font-family", t.font), ...decl("border-radius", t.radius));
  if (state === "base" && t.buttonHeight) r.push("height:auto", "block-size:auto", `min-height:${t.buttonHeight}`);
  if (fill) {
    const bg = t[fill[0]];
    const fg = t[fill[1]];
    if (state === "base") r.push(...decl("background", bg), ...decl("border-color", bg), ...decl("color", fg));
    if (state === "hover" && bg && fg) r.push(`background:${mix(bg, fg, 12)}`);
    if (state === "active" && bg) r.push(`border-color:${bg}`, ...(fg ? [`background:${mix(bg, fg, 20)}`] : []));
    if (state === "disabled" && bg) r.push("opacity:.55");
  } else if (variant === "quiet") {
    if (state === "base") r.push(...decl("color", t.text));
    if (state === "hover") r.push(...decl("background", neutral(t, 7)));
    if (state === "active") r.push(...decl("background", neutral(t, 12)));
    if (state === "disabled") r.push(...decl("color", t.mutedText));
  } else {
    if (state === "base") r.push(...decl("background", t.surface), ...decl("color", t.text), ...decl("border-color", t.border));
    if (state === "hover") r.push(...decl("background", neutral(t, 7)));
    if (state === "active") r.push(...decl("background", neutral(t, 12)), ...decl("border-color", t.border));
    if (state === "disabled") r.push(...decl("color", t.mutedText));
  }
  if (state === "focus" && t.accent) r.push(`outline:2px solid ${t.accent}`);
  return r;
}

const ROLES = {
  input: (t, s) =>
    s === "base" ? [...decl("font-family", t.font), ...decl("color", t.text), ...decl("background", t.surface), ...decl("border-color", t.border), ...decl("border-radius", t.radius)]
    : s === "hover" ? decl("border-color", t.mutedText)
    : s === "focus" && t.accent ? [`outline:2px solid ${t.accent}`, `border-color:${t.accent}`]
    : [],
  surface: (t, s) =>
    s === "base" ? [...decl("background", t.surface), ...decl("color", t.text), ...decl("border-color", t.border), ...decl("box-shadow", t.shadow), ...decl("border-radius", t.radius), ...decl("font-family", t.font)] : [],
  text: (t, s) => (s === "base" ? [...decl("color", t.text), ...decl("font-family", t.font)] : []),
  mutedText: (t, s) => (s === "base" ? [...decl("color", t.mutedText), ...decl("font-family", t.font)] : []),
  heading: (t, s) => (s === "base" ? [...decl("font-family", t.headingFont || t.font), ...decl("color", t.text)] : []),
  code: (t, s) => (s === "base" ? decl("color", t.text) : []),
  well: (t, s) =>
    s === "base" ? [...decl("background", t.background), ...(t.border ? [`border:1px solid ${t.border}`] : []), ...decl("border-radius", t.radius)] : [],
  overlay: (t, s) => (s === "base" ? decl("background", t.overlay) : []),
  close: (t, s) =>
    s === "base" ? [...decl("background", t.surface), ...decl("color", t.mutedText), ...decl("border-color", t.border)]
    : s === "hover" ? decl("background", neutral(t, 7))
    : s === "focus" && t.accent ? [`outline:2px solid ${t.accent}`] : [],
};

/** Token declarations for `role` ("button.primary", "input", "surface", ...) in `state`. */
export function tokenRules(theme, role, state = "base") {
  if (!themed(theme)) return [];
  if (role.startsWith("button.")) return button(theme.tokens, role.slice(7), state);
  return ROLES[role] ? ROLES[role](theme.tokens, state) : [];
}

/** Token declarations for every applicable state, in order. */
export function tokenRulesFor(theme, role, active) {
  return stateList(active).flatMap((s) => tokenRules(theme, role, s));
}

/** A page's explicit part declarations: each name general to specific, base then states. */
export function partRules(theme, names, active) {
  if (!themed(theme) || !names?.length) return [];
  const states = stateList(active);
  const r = [];
  for (const name of names) {
    const part = theme.parts[name];
    if (!part) continue;
    for (const s of states) for (const [prop, value] of Object.entries(part[s] || {})) r.push(`${prop}:${value}`);
  }
  return r;
}

/** Mark a themed element with its part names, so the contract can be inspected. */
export function markParts(el, theme, names) {
  if (themed(theme) && names?.length) el.setAttribute("data-clay-part", names.join(" "));
}

// A floor goes on after the theme: first the plain floor, then the larger of the floor
// and what the theme asked for. When the theme's value cannot go inside max() (a keyword
// such as auto), the browser drops that second declaration and the plain floor stands.
export function floorRules(rules, prop, px) {
  if (!px) return [];
  const last = [...rules].reverse().find((r) => r.startsWith(`${prop}:`));
  const value = last ? last.slice(prop.length + 1).trim() : "";
  const out = [`${prop}:${px}px`];
  if (value && value !== `${px}px`) out.push(`${prop}:max(${px}px, ${value})`);
  return out;
}

export function heightFloor(rules, narrow) {
  return narrow ? floorRules(rules, "min-height", 44) : [];
}
