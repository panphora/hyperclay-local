// The release's exact aliases, from compat/journal-assets.lock.json: the only foreign URLs a
// saved page may get back for a local runtime address. A unit test keeps the two equal.
export const RUNTIME_ALIASES = Object.freeze({
  "https://cdn.jsdelivr.net/npm/overtype@2.6.1/dist/overtype.min.js": "compat/overtype-2.6.1.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js": "compat/highlight-11.9.0.min.js",
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:ital,wght@0,300;0,400;0,500;0,600;1,400;1,500&family=IBM+Plex+Sans:wght@400;500;600&display=swap": "fonts/ibm-plex.css",
});
