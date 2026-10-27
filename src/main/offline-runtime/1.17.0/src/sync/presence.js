/**
 * presence.js — who else is on this document.
 *
 * A fixed-corner stack of squares, one per participant the host chose to name,
 * plus a count of everyone it did not. The host decides who is named, per
 * recipient, from that recipient's own access; nothing here asks for a name and
 * nothing here can widen what arrived.
 *
 * The roster itself is not here: it lives in `presence-store.js`, which is what
 * `clay.presence` hands to a page and what a caret adapter reads. This module is
 * the chrome a reader sees — the squares, the count and the tip — and the visual
 * library behind it stays a first-use download, so a reader who draws nothing
 * still has a roster and still fetches none of it.
 *
 * THE RULE THIS FILE EXISTS TO GET RIGHT.
 *
 * captureForSaveAndComparison() clones the document, hands that clone to peers
 * on `clay:snapshot-ready`, and only THEN strips the save-only regions. So
 * `no-save` alone is not enough: it keeps names out of the file while
 * broadcasting them to every peer on the document, including a visitor the host
 * deliberately answered with a count and no names. `no-snapshot` is the token
 * that runs BEFORE the clone is emitted (captureSnapshot), so every runtime root
 * here carries all three, tooltip included:
 *
 *   no-save      not written to the saved file
 *   no-watch     invisible to the mutation system, so a roster change is not an edit
 *   no-snapshot  absent from every snapshot, including the one peers receive
 *
 * The roster lives in this module's memory. It is never written to a DOM data
 * store, an attribute or anything else a serializer walks — the names on screen
 * are text nodes inside a subtree that no snapshot contains, and the hover label
 * is held in a closure rather than in `title`. Styling is inline and hostile-css
 * !important throughout, so there is no injected <style> tag to mark either.
 *
 * Gated on the host, not on the first frame: a host that does not announce
 * `presence` draws nothing at all rather than an empty stack. That is what
 * hyperclay-local, HTML Clay and makerclay do today and it stays that way until
 * they adopt it.
 *
 * `people[].id` is the person's people id (the one `clay.me` and `clay.people`
 * use) or a guest's per-document pseudonym. It picks the colour and nothing
 * else: it is not a permission check, and it is never logged.
 */

import { hostSupports } from '../core/host-meta.js';
import { make, set } from '../lib/hostile-css.js';
import { initialsOf, personColor } from '../lib/person-face.js';
import { presence as store } from './presence-store.js';

// Two initials at 11px need about 15px of the square, so the overlap has to
// leave that much clear or the neighbouring square eats the second letter.
const SIZE = 30;
const OVERLAP = 6;

// The palette, the marking token and the two faces are the Bevel subset, which is a
// first-use download: a reader alone on a document never draws a square, so it never
// fetches them. Everything here is read after loadUI() resolves.
let ui = null;
let uiLoad = null;

function loadUI() {
  uiLoad ??= Promise.all([import('../ui/bevel-controls.js'), import('../ui/bevel.js')])
    .then(([controls, bevel]) => (ui = {
      pageScheme: controls.pageScheme,
      RUNTIME_ONLY: controls.RUNTIME_ONLY,
      TOKENS: bevel.TOKENS,
      SHADOW: bevel.SHADOW,
      FONT: `600 11px/1 ${bevel.FONT_MONO}`,
      LABEL_FONT: `500 11px/1.4 ${bevel.FONT_MONO}`,
    }))
    .catch((error) => {
      uiLoad = null;
      throw error;
    });
  return uiLoad;
}

// A roster frame never rejects its way back to the stream: a chunk that failed to
// arrive leaves the corner empty and the next frame asks again.
const uiReady = () => loadUI().then(() => true, () => false);

// all:initial first on every element, so a page rule has nothing left to reach; it
// resets color-scheme and direction too, which are put back straight after.
const RESET = ['all:initial', 'color-scheme:inherit', 'direction:ltr', 'unicode-bidi:isolate'];

// The fill of every square, under the participant's colour. One literal in both
// schemes, because every colour the shared person-face palette draws with was
// chosen against it.
const FACE = '#FFFCF6';

/** Every element this module creates, marked the same way. */
function runtimeRoot(el) {
  el.setAttribute('clay', ui.RUNTIME_ONLY);
  return el;
}

/**
 * What this module draws from a snapshot. The store keeps the rest — the target
 * each person holds and their sessions — because none of it is chrome: a frame that
 * only moved somebody's caret must leave every square where it is.
 */
function faces(snapshot) {
  const people = snapshot.people.map((person) => ({ id: person.id, name: person.name, you: person.you }));
  return { people, anonymous: snapshot.anonymous };
}

class Presence {
  constructor() {
    this.roster = { people: [], anonymous: 0 };
    this.root = null;
    this.stack = null;
    this.count = null;
    this.tip = null;
    this._gate = null;
  }

  /**
   * Does this host run presence at all? Asked once, of /_/meta, and never
   * inferred from a frame arriving: the answer decides whether the chrome is
   * built, so a host that says nothing draws nothing forever. The two awareness
   * capabilities travel with it, because the store publishes them in the same
   * snapshot and a page reads them before it publishes a target.
   */
  supported() {
    if (!this._gate) {
      this._gate = Promise.all([
        hostSupports('presence'),
        hostSupports('record-awareness-v1'),
        hostSupports('page-awareness-v1'),
      ]).then(([supported, recordAwareness, pageAwareness]) => {
        store.setCapabilities({ supported, recordAwareness, pageAwareness });
        return supported === true;
      }, () => false);
    }
    return this._gate;
  }

  /**
   * Take a roster frame. Held in memory first so a frame that arrives before
   * discovery answers is not lost, and drawn only if the host announced the
   * capability.
   *
   * @param {{people: Array, anonymous: number}} data
   * @returns {Promise<void>}
   */
  async update(data) {
    const next = faces(store.receive(data));
    const same = this.root && JSON.stringify(next) === JSON.stringify(this.roster);
    this.roster = next;
    if (!(await this.supported())) return;
    if (same) {
      set(this.root, 'color-scheme', ui.pageScheme());
      return;
    }
    await this.render();
  }

  /** The stream went away, so the roster is no longer true about anything. */
  clear() {
    store.clear();
    this.roster = { people: [], anonymous: 0 };
    if (!this.root) return;
    this.root.remove();
    this.root = null;
    this.stack = null;
    this.count = null;
    this.tip = null;
  }

  async render() {
    const { people, anonymous } = this.roster;

    // A person alone on a document is told nothing at all. The count is the
    // total either way: a recipient the host would not name gets people: [] and
    // everyone in `anonymous`, so this sum is the same participant count in both
    // directions.
    if (people.length + anonymous <= 1) {
      this.hide();
      return;
    }
    if (!(await uiReady())) return;
    if (!this.build()) return;

    this.hideTip();
    set(this.root, 'color-scheme', ui.pageScheme());
    this.stack.textContent = '';
    for (const person of people) {
      this.stack.appendChild(this.avatar(person));
    }
    // The overlap belongs between squares, so the leftmost one does not pull
    // itself into the count beside it.
    if (this.stack.firstElementChild) set(this.stack.firstElementChild, 'margin-left', '0');

    if (anonymous > 0) {
      this.count.textContent = `+${anonymous} viewing`;
      set(this.count, 'display', 'inline-block');
    } else {
      this.count.textContent = '';
      set(this.count, 'display', 'none');
    }
    set(this.root, 'display', 'flex');
  }

  hide() {
    if (!this.root) return;
    this.hideTip();
    this.stack.textContent = '';
    this.count.textContent = '';
    set(this.root, 'display', 'none');
  }

  build() {
    if (this.root) return true;
    if (typeof document === 'undefined' || !document.body) return false;

    this.root = runtimeRoot(make('div', [
      ...RESET,
      `color-scheme:${ui.pageScheme()}`,
      'position:fixed',
      'top:calc(12px + env(safe-area-inset-top,0px))',
      'right:calc(12px + env(safe-area-inset-right,0px))',
      'z-index:2147483000',
      'display:flex', 'align-items:center', 'gap:8px',
      'max-width:calc(100vw - 24px)',
      `font:${ui.LABEL_FONT}`, `color:${ui.TOKENS.ink}`,
      // Only the squares take a pointer. A fixed corner that swallowed clicks
      // would take a bite out of whatever the page put underneath it.
      'pointer-events:none',
    ]));
    this.root.setAttribute('data-clay-presence', '');

    this.count = runtimeRoot(make('span', [
      ...RESET,
      'box-sizing:border-box', 'flex:none', 'white-space:nowrap',
      'padding:3px 8px', 'border-radius:0',
      `background:${ui.TOKENS.surface}`, `color:${ui.TOKENS.muted}`,
      `border:1px solid ${ui.TOKENS['line-2']}`,
      `font:${ui.LABEL_FONT}`, 'letter-spacing:.02em',
      `box-shadow:${ui.SHADOW}`,
      'display:none',
      'pointer-events:none',
    ]));
    this.count.setAttribute('data-clay-presence-count', '');

    this.stack = runtimeRoot(make('div', [
      ...RESET,
      'display:flex', 'align-items:center', 'flex:none', 'pointer-events:none',
    ]));

    // Inside the root rather than appended to <body>, so the one element that
    // holds a name at rest cannot outlive the subtree that keeps it out of a
    // snapshot. It carries the marking of its own too.
    this.tip = runtimeRoot(make('span', [
      ...RESET,
      'position:absolute', 'top:100%', 'right:0', 'margin-top:6px',
      'box-sizing:border-box', 'white-space:nowrap', 'pointer-events:none',
      'padding:5px 9px', 'border-radius:0',
      `background:${ui.TOKENS.ink}`, `color:${ui.TOKENS.ground}`,
      `font:${ui.LABEL_FONT}`, 'letter-spacing:.02em',
      `box-shadow:${ui.SHADOW}`,
      'display:none',
    ]));
    this.tip.setAttribute('data-clay-presence-tip', '');

    this.root.append(this.stack, this.count, this.tip);
    document.body.appendChild(this.root);
    return true;
  }

  avatar(person) {
    const color = personColor(person.id);
    const skin = [`background-color:${FACE}`, `color:${color}`, `border-color:${color}`];

    const el = runtimeRoot(make('div', [
      ...RESET,
      'box-sizing:border-box', 'flex:none',
      `width:${SIZE}px`, `height:${SIZE}px`, 'border-radius:0',
      'display:flex', 'align-items:center', 'justify-content:center',
      `font:${ui.FONT}`, 'letter-spacing:.02em',
      `margin-left:-${OVERLAP}px`,
      'border-width:2px', 'border-style:solid', 'background-image:none',
      `box-shadow:${ui.SHADOW}`,
      'user-select:none', 'cursor:default', 'pointer-events:auto',
      ...skin,
    ], initialsOf(person.name)));
    el.setAttribute('data-clay-presence-avatar', '');

    // The name lives in this closure, never in an attribute on the element, and
    // it reaches the DOM only while a pointer is actually on the square.
    const label = person.you ? `${person.name} (you)` : person.name;
    el.addEventListener('mouseenter', () => this.showTip(label));
    el.addEventListener('mouseleave', () => this.hideTip());
    return el;
  }

  showTip(text) {
    if (!this.tip) return;
    this.tip.textContent = text;
    set(this.tip, 'display', 'block');
  }

  hideTip() {
    if (!this.tip) return;
    this.tip.textContent = '';
    set(this.tip, 'display', 'none');
  }
}

const presence = new Presence();

export { presence, Presence };
export default presence;
