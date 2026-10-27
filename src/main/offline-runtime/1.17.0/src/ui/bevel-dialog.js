// The frame every ClayJS dialog draws: a backdrop, a Bevel panel, an optional corner
// close. It holds no behaviour. The modal and the crop adapter own focus, Escape,
// backdrop clicks and settling, so each keeps the rules it already had.
import { style, set } from "../lib/hostile-css.js";
import { bevelBox, bevelSurface, bevelText, pageScheme, protectIcon, restyleBox } from "./bevel-controls.js";
import { TOKENS, FONT_SANS, RULES, GLYPHS } from "./bevel.js";
import { themed, tokenRulesFor, partRules, markParts } from "./theme-parts.js";

// A frame's own way to settle itself. The modal is a singleton and clears every frame
// when it opens; a frame it does not own (the crop dialog) registers here, so it is
// cancelled properly instead of vanishing with its caller still waiting.
export const dismissOf = new WeakMap();

const FOCUSABLE = 'a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [contenteditable], [tabindex]:not([tabindex^="-"])';

// Tab and Shift+Tab wrap inside `container`, the rule MicroModal applies to the modal.
export function keepFocusIn(container, event) {
  const nodes = [...container.querySelectorAll(FOCUSABLE)].filter((node) => node.offsetParent !== null);
  if (!nodes.length) return;
  const at = nodes.indexOf(document.activeElement);
  if (at === -1) {
    nodes[0].focus();
    event.preventDefault();
  } else if (event.shiftKey && at === 0) {
    nodes[nodes.length - 1].focus();
    event.preventDefault();
  } else if (!event.shiftKey && at === nodes.length - 1) {
    nodes[0].focus();
    event.preventDefault();
  }
}

// The dashboard's dialog (Bevel's React dialog with the dashboard's overrides), drawn
// inline. ClayJS loads no webfonts, so the title's Newsreader falls back to Georgia.
const LINE = `1px solid ${TOKENS["line-2"]}`;

// The close: a column at the header's right edge in the button face, or a 62px square
// at the panel's corner when there is no header.
function dialogClose(label, inHeader, theme = null, names = [], iconNames = []) {
  const hover = RULES.dialogCloseHover[0].slice("background:".length);
  const base = [
    "position:absolute", "top:-1px", "right:-1px", "z-index:2",
    "display:grid", "place-items:center", inHeader ? "height:calc(100% + 1px)" : "height:62px",
    "margin:0", "padding:0", "border:0", ...RULES.dialogClose, ...(inHeader ? [] : [`border-bottom:${LINE}`]),
    "cursor:pointer", "outline:none",
  ];
  const b = bevelBox("button", base);
  b.type = "button";
  b.setAttribute("aria-label", label);
  b.title = label;
  b.innerHTML = GLYPHS.dialogClose;
  if (!themed(theme)) {
    protectIcon(b.firstElementChild, 16);
    b.addEventListener("pointerenter", () => set(b, "background", hover));
    b.addEventListener("pointerleave", () => set(b, "background", TOKENS.face));
    b.addEventListener("focus", () => { set(b, "outline", `2px solid ${TOKENS.brass}`); set(b, "outline-offset", "-4px"); });
    b.addEventListener("blur", () => set(b, "outline", "none"));
    return b;
  }
  const allNames = ["close", ...names];
  const icon = ["icon", ...iconNames];
  markParts(b, theme, allNames);
  markParts(b.firstElementChild, theme, icon);
  const flags = { hover: false, focus: false, pressed: false };
  const paint = () => {
    const act = { hover: flags.hover, active: flags.pressed, focus: flags.focus };
    const svg = b.firstElementChild;
    svg.style.cssText = "";
    protectIcon(svg, 16);
    style(svg, partRules(theme, icon, act));
    restyleBox(b, [
      ...base,
      ...(flags.hover ? [`background:${hover}`] : []),
      ...(flags.focus ? [`outline:2px solid ${TOKENS.brass}`, "outline-offset:-4px"] : []),
      ...tokenRulesFor(theme, "close", act),
      ...partRules(theme, allNames, act),
    ]);
  };
  b.addEventListener("pointerenter", () => { flags.hover = true; paint(); });
  b.addEventListener("pointerleave", () => { flags.hover = false; flags.pressed = false; paint(); });
  b.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    flags.pressed = true;
    paint();
  });
  b.addEventListener("pointerup", () => { flags.pressed = false; paint(); });
  b.addEventListener("focus", () => { flags.focus = true; paint(); });
  b.addEventListener("blur", () => { flags.focus = false; flags.pressed = false; paint(); });
  paint();
  return b;
}

// `theme` is a captured resolveTheme() result, or null for the exact Bevel look.
// `surface` names the dialog for part overrides: "modal" uses dialog.* parts only;
// "people" and "crop" add people.* or crop.* after them, so those win.
export function bevelDialog({ zIndex = "100", width = "600px", closable = false, titled = false, theme = null, surface = "modal" } = {}) {
  const on = themed(theme);
  const t = on ? theme.tokens : {};
  const S = t.spacing;
  const names = (part) => (surface === "modal" ? [`dialog.${part}`] : [`dialog.${part}`, `${surface}.${part}`]);

  const root = bevelBox("div", ["display:block"], { theme, parts: names("root") });
  root.setAttribute("data-clay-modal", "");
  if (on) root.setAttribute("data-clay-ui", surface);
  root.setAttribute("aria-hidden", "true");
  set(root, "color-scheme", on ? theme.scheme : pageScheme());

  const overlay = bevelBox("div", [
    "position:fixed", "inset:0", `z-index:${zIndex}`, "overflow:auto",
    "display:flex", "align-items:flex-start", "justify-content:center",
    "padding:min(96px, 10vh) 16px 16px",
    `background:color-mix(in srgb, ${TOKENS.ground} 72%, transparent)`,
  ], { theme, parts: names("overlay"), role: "overlay" });
  overlay.tabIndex = -1;

  const panel = bevelSurface("form", [
    "position:relative", "display:flex", "flex-direction:column", "margin:0",
    `width:min(${width}, 100%)`, "max-height:calc(100dvh - min(96px, 10vh) - 16px)",
    ...RULES.dialogPanel,
  ], { theme, parts: names("panel") });
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");

  let header = null;
  let heading = null;
  if (titled) {
    header = bevelBox("div", [
      "position:relative", "display:block", "flex:none",
      `padding:20px ${closable ? "68px" : "22px"} 16px 22px`, ...RULES.dialogHeader,
      ...(t.border ? [`border-bottom-color:${t.border}`] : []),
      ...(S ? [`padding:${S} ${closable ? `calc(${S} + 46px)` : S} calc(${S} * .7) ${S}`] : []),
    ], { theme, parts: names("header") });
    heading = bevelText("div", ["display:block", ...RULES.dialogHeading, "overflow-wrap:anywhere"], undefined, { theme, parts: names("title"), role: "heading" });
    heading.setAttribute("role", "heading");
    heading.setAttribute("aria-level", "2");
    header.append(heading);
    panel.append(header);
  }

  const body = bevelText("div", [
    "display:block", "flex:1 1 auto", "min-height:0", "overflow-y:auto", "overflow-x:hidden",
    `padding:20px ${closable && !titled ? "84px" : "22px"} 20px 22px`,
    "overflow-wrap:anywhere", `font:14.5px/1.55 ${FONT_SANS}`,
    ...(S ? [`padding:${S} ${closable && !titled ? `calc(${S} + 62px)` : S} ${S} ${S}`] : []),
  ], undefined, { theme, parts: names("body") });
  const footer = bevelBox("div", [
    "display:flex", "flex:none", "flex-wrap:wrap", "justify-content:flex-end", "align-items:center", ...RULES.dialogFooter,
    ...(t.border ? [`border-top-color:${t.border}`] : []),
    ...(S ? [`padding:calc(${S} * .65) ${S}`, `gap:calc(${S} / 2)`] : []),
  ], { theme, parts: [...names("footer"), ...names("actions")] });
  panel.append(body, footer);

  const close = closable ? dialogClose("Close", titled, theme, names("close"), names("closeIcon")) : null;
  if (close) (header || panel).append(close);

  overlay.append(panel);
  root.append(overlay);
  return { root, overlay, panel, header, heading, body, footer, close, theme };
}
