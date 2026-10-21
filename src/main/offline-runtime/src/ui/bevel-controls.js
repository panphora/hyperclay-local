// Bevel controls for UI ClayJS draws on somebody else's page. Every declaration
// goes on inline and !important (hostile-css.js), so the page's stylesheet cannot
// repaint them. Inline styles have no :hover or :active, so each button keeps its
// state in flags and rebuilds its whole inline style from them on every change:
// a property one state set can never survive into the next. Style a button only
// through `extra` and `labelExtra`; anything set on it afterwards is rebuilt away.
//
// all:initial resets color-scheme and direction too. Both are put back after every
// reset, so light-dark() follows the scheme the UI root sets and a page cannot
// flip the text direction.
import { style, make, set } from '../lib/hostile-css.js';
import { RULES, MEDIA, FONT_SANS, TOKENS } from './bevel.js';
import { themed, tokenRulesFor, partRules, markParts, floorRules } from './theme-parts.js';

export const RUNTIME_ONLY = 'no-save no-watch no-snapshot';

const RESET = ['all:initial', 'color-scheme:inherit', 'direction:ltr', 'unicode-bidi:isolate'];

const SIZE = {
  normal: [`font:500 14px/1.45 ${FONT_SANS}`, 'padding:4px 12px'],
  small: [`font:500 12.5px/1.45 ${FONT_SANS}`, 'padding:1px 8px'],
};

// Bevel composes :hover and :active in source order; so do these lists.
const VARIANT = {
  default: { rest: RULES.button, hover: RULES.buttonHover, active: RULES.buttonActive },
  primary: { rest: RULES.buttonPrimary, hover: [...RULES.buttonPrimaryHoverBase, ...RULES.buttonPrimaryHover], active: RULES.buttonPrimaryActive },
  quiet: { rest: [...RULES.button, ...RULES.buttonQuiet], hover: [...RULES.buttonHover, ...RULES.buttonQuietHover], active: [...RULES.buttonActive, ...RULES.buttonQuietActive] },
  danger: { rest: RULES.buttonDanger, hover: RULES.buttonDangerHover, active: RULES.buttonDangerActive },
};

const media = (query) => typeof matchMedia === 'function' && matchMedia(query).matches;

let keyboardModality = false;
const focusedButtons = new Set();
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', () => {
    keyboardModality = true;
    for (const refresh of focusedButtons) refresh();
  }, true);
  document.addEventListener('pointerdown', () => { keyboardModality = false; }, true);
}

function runtime(el) {
  el.setAttribute('clay', RUNTIME_ONLY);
  return el;
}

function restyle(el, rules) {
  el.style.cssText = '';
  style(el, rules);
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const SHAPES = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'g']);

// Presentation attributes lose to any author rule, so the icon's own attributes are
// restated as inline !important declarations: the page cannot hide, resize or
// repaint it. A path's geometry is pinned through the `d` property as well.
// It inherits colour, so a currentColor shape takes the ink of the control it sits in.
function protectIcon(svg, size) {
  if (!svg || svg.namespaceURI !== SVG_NS) return;
  runtime(svg);
  style(svg, [
    ...RESET, 'color:inherit', 'display:block', `width:${size}px`, `height:${size}px`, 'overflow:visible',
    'visibility:visible', 'opacity:1', 'transform:none', 'pointer-events:none',
  ]);
  for (const el of svg.querySelectorAll('*')) {
    if (!SHAPES.has(el.localName)) continue;
    const attr = (name, fallback) => el.getAttribute(name) ?? fallback;
    const rules = [
      'visibility:visible', 'opacity:1', 'transform:none', 'display:inline',
      `fill:${attr('fill', svg.getAttribute('fill') ?? 'currentColor')}`,
      `stroke:${attr('stroke', svg.getAttribute('stroke') ?? 'none')}`,
    ];
    for (const prop of ['stroke-width', 'stroke-linecap', 'stroke-linejoin']) {
      const value = el.getAttribute(prop) ?? svg.getAttribute(prop);
      if (value !== null) rules.push(`${prop}:${value}`);
    }
    if (el.localName === 'path' && el.hasAttribute('d')) rules.push(`d:path("${el.getAttribute('d')}")`);
    style(el, rules);
  }
}

export function bevelButton(label, { variant = 'default', small = false, onClick = null, extra = [], labelExtra = [], onState = null, theme = null, parts = [], labelParts = [] } = {}) {
  const v = VARIANT[variant] || VARIANT.default;
  const size = small ? SIZE.small : SIZE.normal;
  const reducedMotion = media('(prefers-reduced-motion: reduce)');
  const forced = media('(forced-colors: active)');
  const coarse = media('(pointer: coarse)');
  const narrow = media('(max-width: 760px)');
  const flags = { hovered: false, pressed: false, focusVisible: false, disabled: false };
  const pinned = new Map();

  const b = runtime(make('button', []));
  b.type = 'button';
  const span = runtime(make('span', []));
  span.textContent = label;
  b.append(span);

  const variantName = VARIANT[variant] ? variant : 'default';
  const names = ['button', `button.${variantName}`, ...parts];
  const labelNames = ['buttonLabel', ...labelParts];
  markParts(b, theme, names);
  markParts(span, theme, labelNames);

  function applyState() {
    const rules = [...RESET, 'box-sizing:border-box', ...v.rest, ...size];
    if (flags.disabled) {
      rules.push(...RULES.buttonDisabled);
    } else {
      if (flags.hovered) rules.push(...v.hover);
      if (flags.pressed) rules.push(...v.active);
    }
    if (flags.focusVisible) rules.push(...RULES.focus);
    if (forced) rules.push(...MEDIA.forcedColors);
    if (coarse) rules.push(...MEDIA.coarseButton);
    if (narrow) rules.push('min-height:44px');
    rules.push(...extra);
    if (themed(theme)) {
      const act = { hover: flags.hovered, active: flags.pressed, focus: flags.focusVisible, disabled: flags.disabled };
      rules.push(...tokenRulesFor(theme, `button.${variantName}`, act), ...partRules(theme, names, act));
      if (forced) rules.push(...MEDIA.forcedColors);
      rules.push(...floorRules(rules, 'min-height', narrow ? 44 : coarse ? 40 : 0));
    }
    for (const [prop, value] of pinned) rules.push(`${prop}:${value}`);
    restyle(b, rules);
    const labelRules = [...RESET, 'font:inherit', 'color:inherit', ...RULES.buttonLabel];
    if (flags.disabled) labelRules.push(...RULES.buttonDisabledLabel);
    else if (flags.pressed) labelRules.push(...(reducedMotion ? MEDIA.reducedMotion : RULES.buttonActiveLabel));
    labelRules.push(...labelExtra);
    if (themed(theme)) {
      const act = { hover: flags.hovered, active: flags.pressed, focus: flags.focusVisible, disabled: flags.disabled };
      labelRules.push(...partRules(theme, labelNames, act));
      if (flags.pressed && !flags.disabled && reducedMotion) labelRules.push(...MEDIA.reducedMotion);
    }
    restyle(span, labelRules);
    onState?.({ ...flags });
  }

  function refreshFocus() {
    let visible;
    try { visible = b.matches(':focus-visible'); } catch { visible = false; }
    const next = visible || keyboardModality;
    if (next !== flags.focusVisible) { flags.focusVisible = next; applyState(); }
  }

  const on = (type, fn) => b.addEventListener(type, fn);
  on('pointerenter', () => { flags.hovered = true; applyState(); });
  on('pointerleave', () => { flags.hovered = false; flags.pressed = false; applyState(); });
  on('pointercancel', () => { flags.pressed = false; applyState(); });
  on('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (!flags.disabled) { flags.pressed = true; applyState(); }
  });
  on('pointerup', () => { flags.pressed = false; applyState(); });
  on('keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && !flags.disabled) { flags.pressed = true; applyState(); }
  });
  on('keyup', () => { if (flags.pressed) { flags.pressed = false; applyState(); } });
  on('focus', () => { focusedButtons.add(refreshFocus); flags.focusVisible = false; refreshFocus(); applyState(); });
  on('blur', () => { focusedButtons.delete(refreshFocus); flags.focusVisible = false; flags.pressed = false; applyState(); });
  on('click', (e) => {
    if (flags.pressed) { flags.pressed = false; applyState(); }
    if (flags.disabled) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (onClick) onClick(e);
  });

  b.setLabel = (text) => { span.textContent = text; };
  b.setDisabled = (disabled) => {
    flags.disabled = !!disabled;
    if (flags.disabled) b.setAttribute('aria-disabled', 'true');
    else b.removeAttribute('aria-disabled');
    applyState();
  };
  b.isDisabled = () => flags.disabled;
  // Declarations that must outlive every state rebuild: where a floating button sits,
  // whether it shows. Written anywhere else, they would be rebuilt away on the next hover.
  b.pin = (props) => {
    for (const [prop, value] of Object.entries(props)) pinned.set(prop, value);
    applyState();
  };

  applyState();
  return b;
}

export function bevelIconButton(svg, { label, onClick = null }) {
  const b = bevelButton('', {
    small: true,
    onClick,
    extra: ['width:26px', 'height:26px', 'padding:0', 'display:inline-grid', 'place-items:center'],
    labelExtra: ['display:inline-grid', 'width:12px', 'height:12px'],
  });
  b.firstChild.innerHTML = svg;
  protectIcon(b.firstChild.firstElementChild, 12);
  b.setAttribute('aria-label', label);
  b.title = label;
  return b;
}

// Bevel's overlay close: a 68px corner cut on the diagonal, the pixel X drawn on it.
// Hover lifts the corner to the face, keyboard focus fills it with brass.
const CORNER = [
  'position:absolute', 'top:-1px', 'right:-1px', 'z-index:2', 'display:block',
  'width:68px', 'height:68px', 'padding:0', 'margin:0', 'border:0', 'outline:none',
  'background:transparent', 'clip-path:polygon(0 4%, 0 0, 100% 0, 100% 100%, 94% 100%)',
];
const CORNER_BG = 'M132 132.5 1 1.5h131v131Z';
const CORNER_X = 'M0 0h3v1.5h1.5V3H6v1.5h1.5V6H9v1.5h1.5V9H12v1.5h1.5V12H15v1.5h1.5V15H18v1.5h1.5V18H21v1.5h1.5V21H24v1.5h1.5V24H27v1.5h1.5V27H30v1.5h1.5V30H33v1.5h1.5V33H36v1.5h1.5V36H39v1.5h1.5V39H42v1.5h1.5V42H45v1.5h1.5V45H48v1.5h1.5V48H51v1.5h1.5V51H54v1.5h1.5V54H57v1.5h1.5V57H60v1.5h1.5V60H63v1.5h1.5V63H66v1.5h1.5V66H69v1.5h1.5V69H72v1.5h1.5V72H75v1.5h1.5V75H78v1.5h1.5V78H81v1.5h1.5V81H84v1.5h1.5V84H87v1.5h1.5V87H90v1.5h1.5V90H93v1.5h1.5V93H96v1.5h1.5V96H99v1.5h1.5V99h1.5v1.5h1.5v1.5h1.5v1.5h1.5v1.5h1.5v1.5h1.5v1.5h1.5v1.5h1.5v1.5h1.5v1.5h1.5v1.5h1.5v1.5h1.5v1.5h1.5v1.5h1.5v1.5h1.5v1.5h1.5v1.5h1.5v1.5h1.5v1.5h1.5v1.5h1.5v1.5h1.5v1.5h1.5v3h-3V132H129v-1.5h-1.5V129H126v-1.5h-1.5V126H123v-1.5h-1.5V123H120v-1.5h-1.5V120H117v-1.5h-1.5V117H114v-1.5h-1.5V114H111v-1.5h-1.5V111H108v-1.5h-1.5V108H105v-1.5h-1.5V105H102v-1.5h-1.5V102H99v-1.5h-1.5V99H96v-1.5h-1.5V96H93v-1.5h-1.5V93H90v-1.5h-1.5V90H87v-1.5h-1.5V87H84v-1.5h-1.5V84H81v-1.5h-1.5V81H78v-1.5h-1.5V78H75v-1.5h-1.5V75H72v-1.5h-1.5V72H69v-1.5h-1.5V69H66v-1.5h-1.5V66H63v-1.5h-1.5V63H60v-1.5h-1.5V60H57v-1.5h-1.5V57H54v-1.5h-1.5V54H51v-1.5h-1.5V51H48v-1.5h-1.5V48H45v-1.5h-1.5V45H42v-1.5h-1.5V42H39v-1.5h-1.5V39H36v-1.5h-1.5V36H33v-1.5h-1.5V33H30v-1.5h-1.5V30H27v-1.5h-1.5V27H24v-1.5h-1.5V24H21v-1.5h-1.5V21H18v-1.5h-1.5V18H15v-1.5h-1.5V15H12v-1.5h-1.5V12H9v-1.5H7.5V9H6V7.5H4.5V6H3V4.5H1.5V3H0V0ZM108.8 22h5.2v5.1h-2.6v2.6H109v2.6h-2.6v2.6h-2.6v2.5h-2.6v5.2h2.6V45h2.6v2.6h2.6v2.6h2.5v2.6h2.6V58h-5.1v-2.6h-2.6V53h-2.6v-2.6h-2.6v-2.6h-2.5v-2.6h-5.2v2.6H91v2.6h-2.6v2.6h-2.6v2.5h-2.6V58H78v-5.1h2.6v-2.6H83v-2.6h2.6v-2.6h2.6v-2.5h2.6v-5.2h-2.6V35h-2.6v-2.6h-2.6v-2.6h-2.5v-2.6H78V22h5.2v2.6h2.5V27h2.6v2.6h2.6v2.6h2.5v2.6h5.2v-2.6h2.5v-2.6h2.6v-2.6h2.6v-2.5h2.5V22Z';

export function bevelCornerClose({ label = 'Close', onClick = null } = {}) {
  let bg = null;
  let x = null;
  const paint = ({ hovered, focusVisible }) => {
    if (!bg) return;
    set(bg, 'fill', focusVisible ? TOKENS.brass : hovered ? TOKENS.face : TOKENS.sunk);
    set(x, 'fill', focusVisible ? TOKENS.face : TOKENS.ink);
  };
  const b = bevelButton('', {
    variant: 'quiet', onClick, extra: CORNER,
    labelExtra: ['display:block', 'width:100%', 'height:100%'], onState: paint,
  });
  b.setAttribute('aria-label', label);
  b.firstChild.innerHTML = `<svg viewBox="0 0 134 134" xmlns="http://www.w3.org/2000/svg"><path d="${CORNER_BG}"/><path fill-rule="evenodd" clip-rule="evenodd" d="${CORNER_X}"/></svg>`;
  const svg = b.firstChild.firstElementChild;
  protectIcon(svg, 68);
  [bg, x] = svg.children;
  set(x, 'fill-rule', 'evenodd');
  set(x, 'clip-rule', 'evenodd');
  paint({ hovered: false, focusVisible: false });
  return b;
}

// A plain runtime-only box: reset, then only the given rules. For structure inside a
// surface (rows, stacks, backdrops) that carries no material of its own. `role` names the
// token declarations it takes, or null for parts only.
export function bevelBox(tag, rules = [], { theme = null, parts = [], role = null } = {}) {
  const el = runtime(make(tag, [...RESET, 'box-sizing:border-box', ...rules]));
  if (themed(theme)) {
    if (role) style(el, tokenRulesFor(theme, role, {}));
    const names = [...(['text', 'mutedText', 'well'].includes(role) ? [role] : []), ...parts];
    style(el, partRules(theme, names, {}));
    markParts(el, theme, names);
  }
  return el;
}

// Rebuild a box's whole inline style: what a stateful control does on every change.
export function restyleBox(el, rules) {
  restyle(el, [...RESET, 'box-sizing:border-box', ...rules]);
}

export function bevelSurface(tag, rules = [], { theme = null, parts = [], role = 'surface' } = {}) {
  const el = runtime(make(tag, [...RESET, 'box-sizing:border-box', ...RULES.surface, `font:14px/1.5 ${FONT_SANS}`, ...rules]));
  if (themed(theme)) {
    if (role) style(el, tokenRulesFor(theme, role, {}));
    style(el, partRules(theme, parts, {}));
    markParts(el, theme, parts);
  }
  return el;
}

export function bevelWell(rules = [], { theme = null, parts = [], role = 'well' } = {}) {
  const el = runtime(make('div', [...RESET, 'display:block', 'box-sizing:border-box', `font:14px/1.5 ${FONT_SANS}`, `color:${TOKENS.ink}`, ...RULES.recess, ...rules]));
  if (themed(theme)) {
    if (role) style(el, tokenRulesFor(theme, role, {}));
    const names = [...(['text', 'mutedText', 'well'].includes(role) ? [role] : []), ...parts];
    style(el, partRules(theme, names, {}));
    markParts(el, theme, names);
  }
  return el;
}

export function bevelText(tag, rules = [], text, { theme = null, parts = [], role = 'text' } = {}) {
  const el = runtime(make(tag, [...RESET, 'font:inherit', `color:${TOKENS.ink}`, ...rules]));
  if (text != null) el.textContent = text;
  if (themed(theme)) {
    if (role) style(el, tokenRulesFor(theme, role, {}));
    const names = [...(['text', 'mutedText', 'well'].includes(role) ? [role] : []), ...parts];
    style(el, partRules(theme, names, {}));
    markParts(el, theme, names);
  }
  return el;
}

// A text field in Bevel's input material, on an element that already exists (markup a
// dialog wrote) or a new one. Focus and hover live in flags, as on a button. A
// textarea keeps the height a person dragged it to across every repaint.
export function paintInput(el, { rules = [], theme = null, parts = [] } = {}) {
  const flags = { hovered: false, focused: false };
  const forced = media('(forced-colors: active)');
  const coarse = media('(pointer: coarse)');
  runtime(el);
  const names = ['input', ...parts];
  markParts(el, theme, names);
  function applyState() {
    const height = el.localName === 'textarea' ? el.style.getPropertyValue('height') : '';
    const list = [...RESET, 'box-sizing:border-box', ...RULES.input];
    if (flags.hovered) list.push(...RULES.inputHover);
    if (flags.focused) list.push(...RULES.inputFocus);
    if (forced) list.push(...MEDIA.forcedColors);
    list.push(...rules);
    if (coarse) list.push(...MEDIA.coarseInput);
    if (themed(theme)) {
      const act = { hover: flags.hovered && !el.disabled, focus: flags.focused, disabled: !!el.disabled };
      list.push(...tokenRulesFor(theme, 'input', act), ...partRules(theme, names, act));
      if (forced) list.push(...MEDIA.forcedColors);
      if (coarse) list.push(...floorRules(list, 'font-size', 16));
    }
    if (height) list.push(`height:${height}`);
    restyle(el, list);
  }
  el.addEventListener('pointerenter', () => { flags.hovered = true; applyState(); });
  el.addEventListener('pointerleave', () => { flags.hovered = false; applyState(); });
  el.addEventListener('focus', () => { flags.focused = true; applyState(); });
  el.addEventListener('blur', () => { flags.focused = false; applyState(); });
  applyState();
  return el;
}

export function bevelInput(tag = 'input', opts = {}) {
  const el = document.createElement(tag);
  if (tag === 'input') el.type = 'text';
  return paintInput(el, opts);
}

// The scheme a UI root gives its subtree: the page's own when it declares one, so
// light-dark() matches what the person is looking at, else the reader's preference.
export function pageScheme() {
  const s = getComputedStyle(document.documentElement).colorScheme;
  return s === 'light' || s === 'dark' ? s : 'light dark';
}

// `hidden` loses to an inline !important display, so showing and hiding a control
// sets both: the attribute for assistive tech and callers, the declaration for looks.
export function setShown(el, shown, display = 'block') {
  el.hidden = !shown;
  if (el.pin) el.pin({ display: shown ? display : 'none' });
  else set(el, 'display', shown ? display : 'none');
}

export { protectIcon };
