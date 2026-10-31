// The colour painted behind a viewport rectangle, read from the DOM, so ClayJS UI can
// take the page's scheme and lean its surface toward the page instead of guessing from
// the reader's preference. It answers null when it cannot tell (photos, video, canvas,
// gradients, busy patterns, split regions), and the UI then keeps Bevel's own look.
// Measured on about 1,000 real pages: right on 86% of flat regions, about 1 answer in
// 10,000 regions with the wrong scheme (plans/starter-templates/page-colour/report.md).
//
// Per point: the elementsFromPoint stack (open shadow roots spliced in, ClayJS UI
// skipped), plus pointer-events:none painters that hit-testing cannot see (a census
// refreshed every 15 s), each layer's background composited front to back over the
// canvas colour, with ancestor opacity. Unknown layers are folded as black and as
// white; if the two disagree, the point is unknown. Fifteen points vote in OKLab.
//
// It imports nothing: under jest's ESM linker, a module with imports of its own that
// joins bevel-controls.js's graph fails dynamic imports of bevel-dialog.js with "not in
// cache". So page-scheme.js's rule is repeated here and the inline !important is direct.

const pageScheme = () => {
  const s = getComputedStyle(document.documentElement).colorScheme;
  return s === 'light' || s === 'dark' ? s : 'light dark';
};

// ClayJS's own UI and anything else drawn over the page that is never saved.
const UI = '[clay~="editor-ui"], [clay~="no-snapshot"], [editor-ui], [no-snapshot], [snapshot-remove]';
const REPLACED = /^(img|video|canvas|iframe|embed|object|image|use|path|rect|circle|ellipse|line|poly(line|gon))$/;
const BAD = /(invert|brightness|contrast|grayscale|sepia|hue-rotate|opacity|url)\(/;
const TO_LMS = [0.4122, 0.5363, 0.0514, 0.2119, 0.6807, 0.1074, 0.0883, 0.2817, 0.63];
const TO_LAB = [0.2105, 0.7936, -0.0041, 1.978, -2.4286, 0.4506, 0.0259, 0.7828, -0.8087];
const FROM_LAB = [1, 0.3963, 0.2158, 1, -0.1056, -0.0639, 1, -0.0895, -1.2915];
const FROM_LMS = [4.0767, -3.3077, 0.231, -1.2684, 2.6098, -0.3413, -0.0042, -0.7034, 1.7076];

const clamp = (v) => (v < 0 ? 0 : v > 1 ? 1 : v || 0);
const multiply = (m, v) => [0, 3, 6].map((k) => m[k] * v[0] + m[k + 1] * v[1] + m[k + 2] * v[2]);
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gamma = (c) => clamp(c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const oklab = (rgb) => multiply(TO_LAB, multiply(TO_LMS, rgb.map(lin)).map(Math.cbrt));
const fromOklab = (lab) => multiply(FROM_LMS, multiply(FROM_LAB, lab).map((v) => v ** 3)).map(gamma);
const luminance = (rgb) => rgb.map(lin).reduce((sum, c, k) => sum + c * [0.2126, 0.7152, 0.0722][k], 0.05);
const contrast = (p, q) => Math.max(luminance(p) / luminance(q), luminance(q) / luminance(p));
const darkInk = (rgb) => luminance(rgb) >= 0.2343;
const distance = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const average = (list) => [0, 1, 2].map((k) => list.reduce((sum, v) => sum + v[k], 0) / list.length);
const fade = (c, k) => c && [c[0], c[1], c[2], c[3] * k];
const inside = (r, x, y) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

const colours = new Map();
function colour(text) {
  if (!colours.has(text)) {
    const [, fn, body = ''] = /^(rgba?|oklch|oklab|color)\(([^()]*)\)$/.exec(text) || [];
    const v = body.replace(/^srgb /, '').split(/[\s,/]+/).map((t) => parseFloat(t) || 0);
    const h = (v[2] * Math.PI) / 180;
    const rgb = !fn || (fn === 'color' && !body.startsWith('srgb ')) ? null
      : fn === 'color' ? v.slice(0, 3).map(clamp)
      : fn[0] === 'r' ? v.slice(0, 3).map((c) => clamp(c / 255))
      : fromOklab(fn === 'oklab' ? v : [v[0], v[1] * Math.cos(h), v[1] * Math.sin(h)]);
    colours.set(text, rgb && [...rgb, v.length > 3 ? clamp(v[3]) : 1]);
  }
  return colours.get(text);
}

// A gradient whose stops are all one colour is that colour; any other image is unknown.
function paint(cs) {
  const image = cs.backgroundImage, c = colour(cs.backgroundColor);
  const stops = (/url\(/.test(image) ? [null] : image.match(/[a-z]+\([^()]*\)/g) || [null]).map(colour);
  const flat = stops.every((s) => s && Math.abs(s[3] - stops[0][3]) < 0.05 && distance(oklab(s), oklab(stops[0])) < 0.02) && stops[0];
  const covers = cs.backgroundRepeat === 'repeat' || /^(auto|cover|100%)( (auto|100%))?$/.test(cs.backgroundSize);
  if (cs.backgroundClip.includes('text')) return [];
  return [
    ...(image !== 'none' && (!flat || flat[3] > 0) ? [{ c: flat, maybe: flat && !covers }] : []),
    ...(!c || c[3] > 0 ? [{ c }] : []),
  ];
}

// Read again every 15 s, or after a second when elements were added or removed.
let painters = [], censusAt = -Infinity, censusSize = 0;
function findPainters() {
  const all = document.getElementsByTagName('*'), age = performance.now() - censusAt;
  if (age > 15000 || (age > 1000 && all.length !== censusSize)) {
    censusAt = performance.now();
    censusSize = all.length;
    painters = [...(all.length > 8000 ? [] : all)].filter((el) => {
      const cs = getComputedStyle(el), r = cs.pointerEvents === 'none' && el.getBoundingClientRect();
      return r?.width >= 40 && r.height >= 20 && cs.visibility === 'visible' && !el.closest(UI) && (REPLACED.test(el.localName) || paint(cs).some((l) => !l.c || l.c[3] > 0.03));
    });
  }
  return painters;
}

function deepStack(x, y) {
  const stack = document.elementsFromPoint(x, y), seen = new Set();
  for (let k = 0; k < stack.length; k++) {
    const host = stack[k], root = host.shadowRoot;
    if (root && !seen.has(root) && seen.add(root)) stack.splice(k--, inside(host.getBoundingClientRect(), x, y) ? 0 : 1, ...root.elementsFromPoint(x, y).filter((e) => e.getRootNode() === root));
  }
  return stack;
}

const grid = ({ x, y, width, height }) => [0, 1, 2].flatMap((j) => [0, 1, 2, 3, 4].map((i) => [x + ((i + 0.5 + (j - 1) / 4) * width) / 5, y + ((j + 0.5) * height) / 3]));

/**
 * The colour behind a viewport rectangle: { colour: [r, g, b], confidence: 0..1,
 * scheme: 'light' | 'dark' }, or null when it cannot tell.
 */
export function pageColour(rect) {
  const html = document.documentElement, body = document.body;
  if (typeof document.elementsFromPoint !== 'function' || !body || !(rect.width > 0 && rect.height > 0)) return null;
  const memo = new Map();
  const info = (el) => memo.get(el) || memo.set(el, { el, cs: getComputedStyle(el) }).get(el);
  const rectOf = (i) => (i.rect ??= i.el.getBoundingClientRect());

  const hcs = getComputedStyle(html);
  const propagated = !paint(hcs).length && body.localName === 'body';
  const owners = propagated ? [html, body] : [html];
  const scheme = hcs.colorScheme === 'normal' ? document.querySelector('meta[name="color-scheme"]')?.content : hcs.colorScheme;
  const dark = /dark/.test(scheme) && (!/light/.test(scheme) || matchMedia('(prefers-color-scheme: dark)').matches);

  function group(el) {
    const i = info(el), cs = i.cs;
    if (i.k === undefined) {
      const host = el.assignedSlot || el.parentElement || el.parentNode?.host;
      const parent = host ? group(host) : { k: 1 };
      i.k = parent.k * +cs.opacity;
      i.ui = parent.ui || el.matches(UI);
      i.bad = parent.bad || BAD.test(cs.filter + cs.backdropFilter) || cs.mixBlendMode !== 'normal' || /\(/.test(cs.maskImage);
    }
    return i;
  }

  const ownOf = (i) => (i.own ??= [...(REPLACED.test(i.el.localName) ? [{ c: null }] : []), ...(owners.includes(i.el) ? [] : paint(i.cs))]);

  // Visible text at a point whose answer it cannot be read on means a painter was missed.
  function inkOf(i) {
    const ink = colour(i.cs.webkitTextFillColor || i.cs.color);
    return (i.ink ??= ink?.[3] >= 0.5 && [...i.el.childNodes].some((n) => n.nodeType === 3 && /\S/.test(n.data)) && ink);
  }

  function fold(layers, unknown, withMaybe) {
    let rgb = [0, 0, 0], through = 1;
    for (const { c, k = 1, maybe } of layers) {
      const [r, g, b, a] = c || [unknown, unknown, unknown, k];
      const opacity = maybe && !withMaybe ? 0 : a;
      rgb = rgb.map((v, k) => v + through * opacity * [r, g, b][k]);
      through *= 1 - opacity;
    }
    return oklab(rgb);
  }

  function samplePoint(x, y, found) {
    const raw = deepStack(x, y);
    if (!raw.length) return;
    const unplaced = new Set();
    for (const el of found) {
      const r = rectOf(info(el));
      if (raw.includes(el) || !inside(r, x, y) || !el.isConnected || info(el).cs.visibility !== 'visible') continue;
      let at = raw.findLastIndex((e) => el.contains(e)) + 1;
      if (!at && info(el).cs.zIndex < 0) at = Math.max(0, raw.findIndex((e) => owners.includes(e)));
      if (!at) unplaced.add(el);
      raw.splice(at, 0, el);
    }
    const layers = [];
    let ink = null, covered = false;
    for (const [k, el] of raw.entries()) {
      const i = group(el);
      if (i.ui || !i.k) continue;
      const own = raw.lastIndexOf(el) === k, stray = !owners.includes(el) && !inside(rectOf(i), x, y);
      for (const l of stray ? [{}] : own ? ownOf(i) : []) layers.push({ c: i.bad ? null : fade(l.c, i.k), k: i.k, maybe: l.maybe || unplaced.has(el) });
      if (own && !ink && !covered && !stray) ink = inkOf(i);
      covered ||= stray || (own && ownOf(i).some((l) => !l.maybe && (!l.c || l.c[3] >= 0.5)));
    }
    const root = group(html);
    for (const l of paint(propagated ? getComputedStyle(body) : hcs)) layers.push({ c: root.bad ? null : fade(l.c, root.k) });
    layers.push({ c: dark ? [0.0706, 0.0706, 0.0706, 1] : [1, 1, 1, 1] });
    const variants = [0, 1].flatMap((unknown) => [fold(layers, unknown, false), fold(layers, unknown, true)]);
    if (variants.some((v) => distance(v, variants[0]) > 0.06)) return null;
    const lab = average(variants), rgb = fromOklab(lab);
    const contra = !!ink && contrast([0, 1, 2].map((k) => ink[k] * ink[3] + rgb[k] * (1 - ink[3])), rgb) < 1.25;
    return { lab, contra, approx: layers.some((l) => !l.c || l.maybe) };
  }

  const found = findPainters();
  const results = grid(rect).map(([x, y]) => samplePoint(x, y, found)).filter((r) => r !== undefined);
  const total = results.length, known = results.filter(Boolean);
  const near = (centre) => known.filter((b) => distance(centre, b.lab) <= 0.035);
  const seed = known.map((a) => near(a.lab)).sort((p, q) => q.length - p.length)[0];
  const members = seed ? near(average(seed.map((m) => m.lab))) : [];
  if (!members.length || members.length < 0.6 * total) return null;
  const contra = members.filter((m) => m.contra).length, rgb = fromOklab(average(members.map((m) => m.lab)));
  const against = known.filter((b) => !members.includes(b) && darkInk(fromOklab(b.lab)) !== darkInk(rgb)).length;
  if ((contra >= 2 && contra >= members.length / 3) || (against >= 2 && against >= 0.2 * total)) return null;
  const approx = members.filter((m) => m.approx).length / members.length;
  return {
    colour: rgb.map((v) => Math.round(v * 255)),
    confidence: +((members.length / total) * (1 - 0.3 * approx) * (1 - contra / members.length)).toFixed(3),
    scheme: darkInk(rgb) ? 'light' : 'dark',
  };
}

// Bevel's surface and its weakest text ink, per scheme. A surface with its own
// palette (the page menu's stylesheet) passes its own pair.
export const BEVEL_SURFACE = { light: [0xFF, 0xFC, 0xF6], dark: [0x11, 0x13, 0x1E], mutedLight: [0x6B, 0x59, 0x42], mutedDark: [0x8A, 0x90, 0xAB] };

/**
 * The look for UI drawn over `rect`: { scheme, surface }. `scheme` is the detected
 * one, or pageScheme() when the colour is unknown. `surface` is Bevel's surface mixed
 * up to 35% toward a confidently detected colour, never so far that the muted ink
 * drops below 4.5:1, or null to keep Bevel's own fill. A page the detector cannot
 * read is unknown, never a reason for the UI drawing over it to fail.
 */
export function uiLook(rect, base = BEVEL_SURFACE) {
  let found = null;
  try {
    found = pageColour(rect);
  } catch {}
  if (!found || found.confidence < 0.5) return { scheme: pageScheme(), surface: null };
  const { scheme } = found;
  const own = base[scheme], muted = (scheme === 'dark' ? base.mutedDark : base.mutedLight).map((v) => v / 255);
  let surface = null;
  for (let w = 0.35; found.confidence >= 0.75 && !surface && w > 0.01; w -= 0.05) {
    const mix = own.map((v, k) => Math.round(v + (found.colour[k] - v) * w));
    if (contrast(mix.map((v) => v / 255), muted) >= 4.5) surface = `rgb(${mix.join(' ')})`;
  }
  return { scheme, surface };
}

/**
 * Gives an inline-styled Bevel surface the look for where it sits: `color-scheme`
 * always, and `background` set to the tint or back to `background` when there is
 * none. Pass `background: null` to leave the fill alone (a surface whose fill means
 * something, like an alarm).
 */
// A Bevel button rebuilds its inline style on every hover and focus, keeping only what
// was pinned, so on a button the look is pinned. An element with no size yet (hidden,
// empty) takes the page's declared scheme, or keeps the look it has.
export function paintLook(el, { rect = el.getBoundingClientRect(), background = null } = {}) {
  const sized = rect.width > 0 && rect.height > 0;
  if (!sized && pageScheme() === 'light dark') return null;
  const look = sized ? uiLook(rect) : { scheme: pageScheme(), surface: null };
  const props = { 'color-scheme': look.scheme };
  if (background !== null) props.background = look.surface || background;
  if (typeof el.pin === 'function') el.pin(props);
  else for (const [prop, value] of Object.entries(props)) el.style.setProperty(prop, value, 'important');
  return look;
}

/**
 * The same look for a surface styled by a stylesheet of Bevel variables (the page
 * menu): `color-scheme`, and `--bevel-surface` when tinted, set inline on `el`.
 */
export function lookAt(el, rect, base) {
  const look = uiLook(rect, base);
  el.style.setProperty('color-scheme', look.scheme, 'important');
  if (look.surface) el.style.setProperty('--bevel-surface', look.surface, 'important');
  else el.style.removeProperty('--bevel-surface');
  return look;
}

// A fixed surface the page moves under: read again once scrolling or resizing settles,
// when html or body change attributes (a theme toggle), when the reader's scheme
// changes, when it moves to another corner and when it is shown again. While it has
// no size (hidden) it keeps its last look.
export function followLook(root, target, base) {
  let timer = 0;
  const refresh = () => {
    timer = 0;
    const rect = target.getBoundingClientRect();
    if (!document.hidden && root.isConnected && rect.width && rect.height) lookAt(root, rect, base);
  };
  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, 150);
  };
  window.addEventListener('scroll', soon, { capture: true, passive: true });
  window.addEventListener('resize', soon);
  document.addEventListener('visibilitychange', soon);
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', soon);
  const watch = new MutationObserver(soon);
  watch.observe(document.documentElement, { attributes: true });
  watch.observe(document.body, { attributes: true });
  watch.observe(root, { attributes: true, attributeFilter: ['data-corner', 'hidden'] });
  refresh();
}
