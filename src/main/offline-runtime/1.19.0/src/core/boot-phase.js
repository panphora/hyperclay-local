// Boot state shared by the loader and save.js. On a page with a derive engine
// (a [sap] root) the loader holds save.js's settled boot baseline until the
// engine's first pass has painted the page, then releases it (loader.js,
// mountDerivedEngine). Every other page, and any test that imports save.js
// directly, never sets the hold.
// servedHash: the fragment the page was served with, read at this module's evaluation.
export const bootPhase = { holdSettle: false, servedHash: typeof window === "undefined" ? "" : window.location.hash };
