export function getStyleBaseUrl(url) {
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.origin + parsed.pathname;
  } catch {
    return url;
  }
}

/**
 * Insert styles into the document (inline CSS or external stylesheet).
 *
 * With a persistent DOM (i.e. clayjs), we need a way to update styles.
 * This function reuses existing elements when possible:
 *   - Inline styles: matches by data-name, reuses if content matches
 *   - External stylesheets: matches by normalized full URL path
 *
 * This ensures:
 *   - No DOM churn: existing elements are reused when content/path matches
 *   - No duplicates: removes any duplicate style/link elements
 *   - Callback always runs: attributes can be updated on existing elements
 *
 * WHY REUSE IN-PLACE:
 * In a persistent DOM (clayjs), removing and re-adding elements changes their
 * position and surrounding whitespace. This causes snapshot diffs even when content
 * is identical, triggering false "unsaved changes" warnings. Reusing existing
 * elements preserves DOM structure for stable snapshots.
 *
 * Usage:
 *   insertStyles('/path/to/file.css')                    // External stylesheet
 *   insertStyles('/path/to/file.css', (link) => { ... }) // With callback
 *   insertStyles('my-styles', '.foo { ... }')            // Inline CSS
 *   insertStyles('my-styles', '.foo { ... }', (style) => { ... }) // With callback
 */
function insertStyles(nameOrHref, cssOrCallback, callback) {
  if (typeof cssOrCallback === 'string') {
    // Inline style: insertStyles('my-styles', '.foo { ... }', optionalCallback)
    const name = nameOrHref;
    const css = cssOrCallback;
    const existingStyles = [...document.querySelectorAll(`style[data-name="${name}"]`)];

    // If exact match exists, just update attributes via callback and return it
    const exactMatch = existingStyles.find(el => el.textContent === css);
    if (exactMatch) {
      if (callback) callback(exactMatch);
      // Remove any duplicates
      existingStyles.filter(el => el !== exactMatch).forEach(el => el.remove());
      return exactMatch;
    }

    // Update first existing style in-place, or create new one
    let style;
    if (existingStyles.length > 0) {
      style = existingStyles[0];
      style.textContent = css;
      if (callback) callback(style);
      // Remove duplicates
      existingStyles.slice(1).forEach(el => el.remove());
    } else {
      style = document.createElement('style');
      style.dataset.name = name;
      style.textContent = css;
      if (callback) callback(style);
      document.head.appendChild(style);
    }

    return style;
  }

  // External stylesheet: insertStyles('/path/to/file.css', optionalCallback)
  const href = nameOrHref;
  const cb = typeof cssOrCallback === 'function' ? cssOrCallback : undefined;

  // Normalize href to full URL path (without query params) for comparison
  const normalizedHref = getStyleBaseUrl(href);

  // Find all links with matching normalized path (ignoring query params like ?v=)
  const existingLinks = [...document.querySelectorAll('link[rel="stylesheet"]')]
    .filter(el => {
      try {
        return getStyleBaseUrl(el.getAttribute('href')) === normalizedHref;
      } catch {
        return false;
      }
    });

  // If match exists, just update attributes via callback and return it
  if (existingLinks.length > 0) {
    const link = existingLinks[0];
    if (cb) cb(link);
    // Remove any duplicates
    existingLinks.slice(1).forEach(el => el.remove());
    return link;
  }

  // Create new link element
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  if (cb) cb(link);
  document.head.appendChild(link);

  return link;
}

export { insertStyles };
export { insertStyles as insertStyleTag };  // backwards-compat alias
export default insertStyles;
