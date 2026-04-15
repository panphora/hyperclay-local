const path = require('upath');
const { hasAnyTailwindLink, replaceTailwindLink } = require('tailwind-hyperclay');

/**
 * Rewrite a site's /tailwindcss/<x>.css link so it's scoped to the site's
 * folder path. Two sites with the same baseName in different folders can't
 * collide, and the URL matches the nested disk path used by the compileTailwind
 * block in the /save handler.
 *
 * Mirrors the platform's applyTemplate behavior (hyperclay/server-lib/state-actions.js).
 *
 * @param {string} name - relative path with extension (e.g. "blog/post.html")
 * @param {string} content - HTML content to rewrite
 * @returns {string} content, possibly with the tailwind link URL rewritten
 */
function scopeTailwindLink(name, content) {
  if (!hasAnyTailwindLink(content)) return content;
  const dirPortion = path.dirname(name);
  const sitePath = dirPortion === '.' ? '' : dirPortion;
  const baseName = path.basename(name, path.extname(name));
  return replaceTailwindLink(content, baseName, sitePath);
}

module.exports = { scopeTailwindLink };
