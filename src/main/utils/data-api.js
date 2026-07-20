// Testable core for the two per-site data-API endpoints, ported from the platform's
// server-lib/data-actions.js (serveSiteApi + extractSiteData) minus the platform-only
// pieces: nginx static layer, private-site guard, the `data_api_called` funnel, the
// 5-min in-memory cache, and DB backup-recovery.
//
// Each handler returns a plain result object so tests never boot the hardcoded
// server port. server.js translates it to a response:
//   { status, headers?, json?, raw? }   raw = a JSON string sent verbatim with
//   application/json; json = an object sent via res.json.
//
// Callers MUST pass a `name` that already passed validateAndResolvePath.
const fs = require('fs').promises;
const path = require('upath');
const { extractData, extractViaTag, parseExtractionRules } = require('./data-extractor');
const { writeApiSidecarData, deleteApiSidecar, readFreshSidecar } = require('./api-sidecar');
const { withFileLock } = require('./write-queue');

// Map an api-tag extraction failure to the platform's author-facing 400 bodies
// (data-actions.js serveSiteApi). Returns null for an unmapped error → caller
// rethrows → 500.
function mapApiTagError(error) {
  const name = error && error.name;
  const message = (error && error.message) || '';
  if (name === 'UnknownRulesVersion') {
    return { error: 'Unsupported rules version', message };
  }
  if (name === 'RulesParseError') {
    return {
      error: 'Malformed api rules tag',
      message: 'The api rules tag body is not valid JSON.',
      details: message
    };
  }
  if (message.includes('selector')) {
    return { error: 'Invalid selector in api rules tag', message };
  }
  return null;
}

// GET /_/api/<name> — tag-driven extraction served from a sidecar.
// Static-hit when the sidecar is fresh, regenerate-on-miss otherwise.
// `sourcePath`, when given, is the caller's phase-4 canonical resolved path.
// Rebuilding `path.join(baseDir, name)` here would follow symlinks independently
// of the one canonical pass in path-resolver.js.
async function serveSiteApiLocal(baseDir, name, { sourcePath } = {}) {
  sourcePath = sourcePath || path.join(baseDir, name);
  // A1: the freshness stat, the source read, the extraction and the sidecar
  // refresh are ONE critical section on the source file's queue slot — the same
  // slot /save takes. Unqueued, a cache-miss GET can extract from H0 while a
  // concurrent save publishes H1 and its H1 sidecar, then overwrite that newer
  // sidecar with H0 data. The fresh mtime then makes the stale data read as
  // current on every subsequent request.
  return await withFileLock(sourcePath, () => serveSiteApiInLock(baseDir, name, sourcePath));
}

async function serveSiteApiInLock(baseDir, name, sourcePath) {
  let sourceStat;
  try {
    sourceStat = await fs.stat(sourcePath);
  } catch {
    // Source gone (deleted/renamed externally): drop any stale sidecar, then 404.
    await deleteApiSidecar(baseDir, name);
    return {
      status: 404,
      json: { error: 'Site content not found', message: 'The site exists but has no content' }
    };
  }

  const fresh = await readFreshSidecar(baseDir, name, sourceStat.mtimeMs);
  if (fresh !== null) {
    // Send the file bytes verbatim — res.json on a string would double-encode it.
    return { status: 200, raw: fresh };
  }

  const html = await fs.readFile(sourcePath, 'utf8');
  let data;
  try {
    data = await extractViaTag(html, 'api');
  } catch (err) {
    const mapped = mapApiTagError(err);
    if (!mapped) throw err; // unmapped → 500
    await writeApiSidecarData(baseDir, name, null); // delete stale
    return { status: 400, json: mapped };
  }

  if (data === null) {
    await writeApiSidecarData(baseDir, name, null); // delete stale
    return {
      status: 400,
      json: { error: 'No api rules tag', message: 'This page has no rules tag with data-rules-name~="api".' }
    };
  }

  await writeApiSidecarData(baseDir, name, data);
  return { status: 200, headers: { 'X-Served-By': 'app-generated' }, json: data };
}

// GET <name>?data={...} — query-driven extraction with relaxed-JSON rules.
// Note the error discriminators differ from serveSiteApiLocal: this path keys on
// message.includes('JSON') and has no version-error case (matches the platform).
async function extractSiteDataLocal(baseDir, name, dataParam, { sourcePath } = {}) {
  if (!dataParam) {
    return {
      status: 400,
      json: {
        error: 'Missing data parameter',
        message: 'Please provide extraction rules via ?data= parameter',
        example: '?data={title:"h1",items:".item"}'
      }
    };
  }

  let html;
  try {
    html = await fs.readFile(sourcePath || path.join(baseDir, name), 'utf8');
  } catch {
    return {
      status: 404,
      json: { error: 'Site content not found', message: 'The site exists but has no content' }
    };
  }

  try {
    const rules = await parseExtractionRules(dataParam);
    const data = await extractData(html, rules);
    return { status: 200, json: data };
  } catch (err) {
    const message = (err && err.message) || '';
    if (message.includes('JSON')) {
      return {
        status: 400,
        json: {
          error: 'Invalid extraction rules',
          message: 'Failed to parse extraction rules. Check your JSON syntax.',
          details: message,
          example: '?data={title:"h1",items:".item"}'
        }
      };
    }
    if (message.includes('selector')) {
      return {
        status: 400,
        json: { error: 'Invalid CSS selector', message: 'One or more CSS selectors are invalid', details: message }
      };
    }
    return {
      status: 500,
      json: {
        error: 'Extraction failed',
        message: 'Failed to extract data from the site',
        details: process.env.NODE_ENV === 'development' ? message : undefined
      }
    };
  }
}

module.exports = { mapApiTagError, serveSiteApiLocal, extractSiteDataLocal };
