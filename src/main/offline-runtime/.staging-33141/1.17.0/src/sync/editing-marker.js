/**
 * editing-marker.js — the block somebody else is editing.
 *
 * A thin outline in that person's colour around the block the host names for them,
 * with a chip carrying their name. Three rules, and they are the whole file:
 *
 *   drawn for others only   a `you: true` entry is this reader's own caret, and a
 *                           host that does not announce `presence` draws nothing
 *   runtime only            every element carries RUNTIME_ONLY and the name lives
 *                           in one text node, never in an attribute
 *   never touched           the edited element is measured and nothing else
 */

import { hostSupports } from '../core/host-meta.js';
import { make, set } from '../lib/hostile-css.js';
import { personColor } from '../lib/person-face.js';
import { EDITING_PATH, elementAt } from './editing-path.js';

const FACE = '#FFFCF6';
const RESET = ['all:initial', 'color-scheme:inherit', 'direction:ltr', 'unicode-bidi:isolate'];
const CHIP_HEIGHT = 18;
const GAP = 3;

// The marking token and the chip face are the Bevel subset, a first-use download: a
// reader with nobody else on the page never draws a marker, so it never fetches them.
let ui = null;
let uiLoad = null;

function loadUI() {
  uiLoad ??= Promise.all([import('../ui/bevel-controls.js'), import('../ui/bevel.js')])
    .then(([controls, bevel]) => (ui = {
      RUNTIME_ONLY: controls.RUNTIME_ONLY,
      CHIP_FONT: `600 11px/16px ${bevel.FONT_MONO}`,
    }))
    .catch((error) => {
      uiLoad = null;
      throw error;
    });
  return uiLoad;
}

// A frame never rejects its way back to the stream: a chunk that failed to arrive
// leaves the block unmarked and the next frame asks again.
const uiReady = () => loadUI().then(() => true, () => false);

function runtimeRoot(el) {
  el.setAttribute('clay', ui.RUNTIME_ONLY);
  return el;
}

function editorsOf(frame) {
  const list = frame && Array.isArray(frame.people) ? frame.people : [];
  const editors = [];
  for (const person of list) {
    if (!person || person.you === true || typeof person.id !== 'string' || !person.id) continue;
    if (typeof person.editing !== 'string' || !EDITING_PATH.test(person.editing)) continue;
    const name = typeof person.name === 'string' && person.name.trim() ? person.name.trim() : 'Someone';
    editors.push({ id: person.id, name, path: person.editing });
  }
  return editors;
}

class EditingMarker {
  constructor() {
    this.editors = [];
    this.root = null;
    this._gate = null;
    this._frame = 0;
    this._following = false;
    this._onMove = () => this.schedule();
  }

  supported() {
    if (!this._gate) this._gate = hostSupports('presence').then((ok) => ok === true, () => false);
    return this._gate;
  }

  async update(frame) {
    this.editors = editorsOf(frame);
    if (!(await this.supported())) return;
    await this.render();
  }

  clear() {
    this.editors = [];
    this.follow(false);
    if (this._frame) cancelAnimationFrame(this._frame);
    this._frame = 0;
    if (this.root) this.root.remove();
    this.root = null;
  }

  schedule() {
    if (this._frame) return;
    this._frame = requestAnimationFrame(() => {
      this._frame = 0;
      this.render();
    });
  }

  // A synchronous draw while the chunk is here, as it always was, and one draw
  // queued for when it arrives on the first frame that needs it.
  render() {
    if (ui) {
      this.paint();
      return Promise.resolve();
    }
    return uiReady().then((ok) => {
      if (ok) this.paint();
    });
  }

  paint() {
    const groups = new Map();
    for (const editor of this.editors) {
      const element = elementAt(editor.path);
      if (!element) continue;
      if (!groups.has(element)) groups.set(element, []);
      groups.get(element).push(editor);
    }
    const boxes = [];
    for (const [element, editors] of groups) {
      const box = this.box(element, editors);
      if (box) boxes.push(box);
    }
    if (!boxes.length) {
      if (this.root) {
        this.root.textContent = '';
        set(this.root, 'display', 'none');
      }
      this.follow(this.editors.length > 0);
      return;
    }
    if (!this.build()) return;
    this.root.textContent = '';
    this.root.append(...boxes);
    set(this.root, 'display', 'block');
    this.follow(true);
  }

  box(element, editors) {
    const r = element.getBoundingClientRect();
    if (!(r.width || r.height)) return null;
    const color = personColor(editors[0].id);
    const box = runtimeRoot(make('div', [
      ...RESET,
      'position:fixed', 'box-sizing:border-box', 'pointer-events:none',
      `top:${Math.round(r.top - GAP)}px`, `left:${Math.round(r.left - GAP)}px`,
      `width:${Math.round(r.width + GAP * 2)}px`, `height:${Math.round(r.height + GAP * 2)}px`,
      `border:2px solid ${color}`,
      `box-shadow:0 0 0 1px ${FACE}, inset 0 0 0 1px ${FACE}`,
    ]));
    box.setAttribute('data-clay-editing-marker', '');
    const above = r.top - GAP >= CHIP_HEIGHT + 2;
    const chips = runtimeRoot(make('div', [
      ...RESET,
      'position:absolute', 'left:-2px', above ? 'bottom:100%' : 'top:100%',
      'display:flex', 'gap:2px', 'pointer-events:none',
    ]));
    for (const editor of editors) {
      const chip = runtimeRoot(make('span', [
        ...RESET,
        'box-sizing:border-box', `height:${CHIP_HEIGHT}px`, 'padding:1px 6px',
        `font:${ui.CHIP_FONT}`, 'letter-spacing:.02em', 'white-space:nowrap',
        'max-width:180px', 'overflow:hidden', 'text-overflow:ellipsis',
        `background-color:${personColor(editor.id)}`, `color:${FACE}`,
        `box-shadow:0 0 0 1px ${FACE}`,
      ], editor.name));
      chip.setAttribute('data-clay-editing-chip', '');
      chips.appendChild(chip);
    }
    box.appendChild(chips);
    return box;
  }

  build() {
    if (this.root && this.root.isConnected) return true;
    if (typeof document === 'undefined' || !document.body) return false;
    this.root = runtimeRoot(make('div', [
      ...RESET,
      'position:fixed', 'top:0', 'left:0', 'width:0', 'height:0', 'overflow:visible',
      'z-index:2147482999', 'pointer-events:none', 'display:none',
    ]));
    this.root.setAttribute('data-clay-editing', '');
    document.body.appendChild(this.root);
    return true;
  }

  follow(on) {
    if (typeof window === 'undefined' || !!on === this._following) return;
    this._following = !!on;
    const method = on ? 'addEventListener' : 'removeEventListener';
    window[method]('scroll', this._onMove, { capture: true, passive: true });
    window[method]('resize', this._onMove, { passive: true });
    document[method]('input', this._onMove);
    document[method]('clay:sync-applied', this._onMove);
  }
}

const editingMarker = new EditingMarker();

export { editingMarker, EditingMarker };
export default editingMarker;
