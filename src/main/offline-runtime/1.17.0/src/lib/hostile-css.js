// Styling that survives somebody else's stylesheet.
//
// Every declaration goes on as !important, and that is the whole reason anything this
// library draws on a stranger's page looks the way it was written. A plain inline style
// loses to an author rule carrying !important, and `button { ... !important }` is a
// thing real pages do: the first browser run of the conflict notice had both of its
// controls repainted in the host page's colours and font. Only an inline !important
// outranks an author !important.

/**
 * Apply `prop:value` rules to an element, each one !important.
 * @param {Element} el
 * @param {string[]} rules
 */
export function style(el, rules) {
  for (const rule of rules) {
    const at = rule.indexOf(":");
    el.style.setProperty(rule.slice(0, at).trim(), rule.slice(at + 1).trim(), "important");
  }
}

/**
 * Set one property, !important.
 *
 * Same reason as above, from the other direction: a later assignment has to be able to
 * beat the !important already sitting on the element, and a plain `el.style.foo = x`
 * silently cannot.
 *
 * @param {Element} el
 * @param {string} prop
 * @param {string} value
 */
export function set(el, prop, value) {
  el.style.setProperty(prop, value, "important");
}

/**
 * Build an element with those rules already on it.
 * @param {string} tag
 * @param {string[]} rules
 * @param {string} [text]
 * @returns {HTMLElement}
 */
export function make(tag, rules, text) {
  const el = document.createElement(tag);
  style(el, rules);
  if (text) el.textContent = text;
  return el;
}
