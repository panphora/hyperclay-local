// Thin wrapper over the shared `hyper-html-api` engine, ported from the platform's
// server-lib/data-extractor.js. hyperclay-local is CommonJS and the engine is pure
// ESM, so the engine loads via a cached dynamic import() and the three functions
// are async (the only behavioral difference from the platform's sync wrapper —
// every call site must `await` inside try/catch so a would-be-400 stays a 400).
//
// cheerio is loaded with a plain require (it ships a CJS require condition and the
// engine's cheerio adapter does NOT pull cheerio in — the wrapper owns it, exactly
// like the platform wrapper does).
const cheerio = require('cheerio');

let enginePromise = null;
function loadEngine() {
  if (!enginePromise) {
    enginePromise = Promise.all([
      import('hyper-html-api/engine'),
      import('hyper-html-api/cheerio')
    ]).then(([engine, cheerioAdapterMod]) => ({
      extract: engine.extract,
      findRulesIn: engine.findRulesIn,
      parseRelaxed: engine.parseRelaxed,
      cheerioAdapter: cheerioAdapterMod.default
    }));
  }
  return enginePromise;
}

async function extractData(html, rules) {
  const { extract, cheerioAdapter } = await loadEngine();
  return extract(cheerioAdapter, cheerio.load(html).root(), rules);
}

async function extractViaTag(html, token) {
  const { extract, findRulesIn, cheerioAdapter } = await loadEngine();
  const $ = cheerio.load(html);
  const found = findRulesIn(cheerioAdapter, $.root(), token);
  if (!found) return null;
  return extract(cheerioAdapter, $.root(), found.rules);
}

async function parseExtractionRules(str) {
  const { parseRelaxed } = await loadEngine();
  return parseRelaxed(str);
}

module.exports = { extractData, extractViaTag, parseExtractionRules };
