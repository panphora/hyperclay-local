/**
 * Option Visibility
 *
 * Shows/hides elements based on `option:` and `option-not:` attributes.
 *
 * SYNTAX:
 *   option:name="value"       - Show when ancestor has name="value"
 *   show-when:name="value"    - Same as option: (the canonical, sapjs-aligned spelling)
 *   option:name="a|b|c"       - Show when ancestor has name="a" OR "b" OR "c"
 *   option:name=""            - Show when ancestor has name="" (empty value)
 *   option:name="|saved"      - Show when ancestor has name="" OR name="saved"
 *   hide-when:name="value"    - Inverse of show-when: hide WHEN ancestor has name="value"
 *   option-not:name="value"   - Show when ancestor has name attr but ≠ "value"
 *   option-not:name="a|b"     - Show when ancestor has name attr but ≠ "a" AND ≠ "b"
 *
 * show-when:/hide-when: are honored identically here and in sapjs, so visibility
 * authored against either library just works. option:/option-not: stay permanent
 * aliases.
 *
 * EXAMPLES:
 *   <div view="kanban">
 *     <button option:view="kanban">Visible when view=kanban</button>
 *     <button option:view="list">Hidden</button>
 *   </div>
 *
 * The ancestor carries the plain attribute (view="kanban"); descendants opt in with
 * option:view / option-not:view. editmode/pageowner are stamped on <html> by clay.js,
 * so option:/show-when:editmode is an edit-mode bridge that sapjs honors too.
 *
 *   <div savestatus="error">
 *     <span option:savestatus="saved|error">Visible (matches error)</span>
 *     <span option-not:savestatus="saving">Visible (error ≠ saving)</span>
 *   </div>
 *
 * HOW IT WORKS:
 * Uses a single conditional-hide rule per pattern. Elements get `display: none !important`
 * ONLY when they are NOT inside a matching ancestor scope. When the ancestor condition
 * IS met, the hide rule doesn't match, so the author's original display value
 * (flex, grid, block, etc.) applies naturally — no recovery needed.
 *
 * BROWSER SUPPORT:
 * Requires `:is()` and `:not()` with selector lists (~96% of browsers, 2021+).
 * Falls back gracefully - elements remain visible if unsupported.
 *
 * TRADEOFFS:
 * - Pro: Pure CSS after generation, zero JS overhead for toggling
 * - Pro: No @layer or revert-layer — works with any author CSS (layered or unlayered)
 * - Pro: One rule per pattern instead of two
 * - Con: Pipe character `|` cannot be used as a literal value (reserved as OR delimiter)
 */

import Mutation from "../lib/mutation.js";
import insertStyles from "../dom/insert-style-tag.js";

const STYLE_NAME = 'option-visibility';

// The visibility prefixes, longest-disambiguating first. show-when/option are the
// "show when match" pair; hide-when is its inverse; option-not is "present but not
// match". All four compile to ancestor-attribute CSS below.
const OPTION_PREFIXES = [
  { prefix: 'option-not', kind: 'show-not' },
  { prefix: 'option', kind: 'show' },
  { prefix: 'show-when', kind: 'show' },
  { prefix: 'hide-when', kind: 'hide' },
];

/**
 * Parse an option:/option-not:/show-when:/hide-when: attribute into a pattern object.
 * Pure function for easy testing.
 *
 * @param {string} attrName - Attribute name (e.g., 'show-when:editmode', 'option-not:status')
 * @param {string} attrValue - Attribute value (e.g., 'true', 'a|b|c')
 * @returns {Object|null} Pattern object or null if not a valid visibility attribute
 */
export function parseOptionAttribute(attrName, attrValue) {
  let match = null;
  for (const p of OPTION_PREFIXES) {
    if (attrName.startsWith(p.prefix + ':')) { match = p; break; }
  }
  if (!match) return null;

  const name = attrName.slice(match.prefix.length + 1);
  const rawValue = attrValue;
  // Split by pipe, keep empty strings (they match empty attribute values)
  const values = rawValue.split('|');

  return { name, rawValue, values, kind: match.kind, prefix: match.prefix, negated: match.kind === 'show-not' };
}

const optionVisibility = {
  debug: false,
  _started: false,
  _unsubscribe: null,

  log(...args) {
    if (this.debug) console.log('[OptionVisibility]', ...args);
  },

  /**
   * Find all unique option:/option-not: patterns using XPath
   * Returns array of { name, rawValue, values, negated }
   */
  findOptionAttributes() {
    const patterns = new Map();

    try {
      const snapshot = document.evaluate(
        '//*[@*[starts-with(name(), "option:") or starts-with(name(), "option-not:") or starts-with(name(), "show-when:") or starts-with(name(), "hide-when:")]]',
        document.documentElement,
        null,
        XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE,
        null
      );

      for (let i = 0; i < snapshot.snapshotLength; i++) {
        const el = snapshot.snapshotItem(i);
        for (const attr of el.attributes) {
          const pattern = parseOptionAttribute(attr.name, attr.value);
          if (!pattern) continue;

          // key includes the prefix so each authored spelling gets its own rule
          // (option:tab and show-when:tab target different attributes, same scope).
          const key = `${pattern.prefix}:${pattern.name}=${pattern.rawValue}`;
          if (!patterns.has(key)) {
            patterns.set(key, pattern);
          }
        }
      }
    } catch (error) {
      this.log('XPath error, falling back to empty', error);
    }

    return [...patterns.values()];
  },

  /**
   * Generate CSS rules for conditional hiding.
   *
   * Each pattern produces a single rule that hides the element ONLY when
   * it's NOT inside a matching ancestor scope. When the condition IS met,
   * the rule doesn't match, so the author's original display value applies.
   */
  generateCSS(patterns) {
    if (!patterns.length) return '';

    return patterns.map((pattern) => {
      const { name, rawValue, values } = pattern;
      // Tolerate the legacy {negated} pattern shape so external callers keep working.
      const kind = pattern.kind || (pattern.negated ? 'show-not' : 'show');
      const prefix = pattern.prefix || (kind === 'show-not' ? 'option-not' : kind === 'hide' ? 'hide-when' : 'option');
      const safeName = CSS.escape(name);
      const safeRawValue = CSS.escape(rawValue);
      const safePrefix = CSS.escape(prefix);
      const attrSelector = `[${safePrefix}\\:${safeName}="${safeRawValue}"]`;

      // The "matching scope": an ancestor (or self) carries name="value".
      const self = values.map(v => `[${safeName}="${CSS.escape(v)}"]`);
      const desc = values.map(v => `[${safeName}="${CSS.escape(v)}"] *`);
      const matchScope = [...self, ...desc].join(',');

      if (kind === 'hide') {
        // hide-when: hide WHEN inside a matching scope — the inverse selector shape.
        return `${attrSelector}:is(${matchScope}){display:none!important}`;
      }

      let scopeSelectors;
      if (kind === 'show-not') {
        // option-not: active when ancestor has attr but NOT any of the values
        const notList = values.map(v => `[${safeName}="${CSS.escape(v)}"]`).join(',');
        const scope = `[${safeName}]:not(${notList})`;
        scopeSelectors = `${scope},${scope} *`;
      } else {
        // option / show-when: active when ancestor has ANY of the values
        scopeSelectors = matchScope;
      }

      return `${attrSelector}:not(:is(${scopeSelectors})){display:none!important}`;
    }).join('');
  },

  /**
   * Update the style element with current rules
   */
  update() {
    try {
      const attributes = this.findOptionAttributes();
      const css = this.generateCSS(attributes);
      insertStyles(STYLE_NAME, css, (style) => {
        style.setAttribute('clay', 'no-watch');
      });
      this.log(`Generated ${attributes.length} rules`);
    } catch (error) {
      console.error('[OptionVisibility] Error generating rules:', error);
    }
  },

  start() {
    if (this._started) return;

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.start(), { once: true });
      return;
    }

    this._started = true;

    this.update();

    // selectorFilter only triggers on option:/option-not: attribute changes (new patterns).
    // Ancestor attribute changes (e.g., editmode="true" -> "false") are handled
    // automatically by the browser - CSS rules re-evaluate when attributes change.
    this._unsubscribe = Mutation.onAnyChange({
      debounce: 200,
      selectorFilter: el => [...el.attributes].some(attr =>
        attr.name.startsWith('option:') || attr.name.startsWith('option-not:') ||
        attr.name.startsWith('show-when:') || attr.name.startsWith('hide-when:')
      ),
      omitChangeDetails: true,
      require: 'observed',
      pausable: false
    }, () => this.update());

    this.log('Started');
  },

  stop() {
    if (!this._started) return;

    this._started = false;

    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }

    const style = document.querySelector(`style[data-name="${STYLE_NAME}"]`);
    if (style) style.remove();

    this.log('Stopped');
  }
};

window.clay.optionVisibility = optionVisibility;

export default optionVisibility;

export function init() {
  optionVisibility.start();
}

init();
