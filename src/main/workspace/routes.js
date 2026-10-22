const fs = require('fs').promises;
const path = require('upath');
const { getConsentRegistry, resolveReadPath } = require('../utils/path-resolver');
const { documentEtag } = require('../spec-wire');
const { logicalBytes } = require('../page-state-store');
const { safePath, refusal } = require('./commands');

const SAVE_MAX_BYTES = 20 * 1024 * 1024;
const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
const FORWARDED_HEADERS = ['content-type', 'if-match', 'save-id', 'page-if-match', 'page-revision', 'accept'];

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}

async function readBytes(req, max) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw refusal('forbidden', 'Request is too large', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req, max = 1024 * 1024) {
  try { return JSON.parse((await readBytes(req, max)).toString('utf8')); }
  catch (error) {
    if (error.status) throw error;
    throw refusal('forbidden', 'Invalid JSON', 400);
  }
}

function documentPath(value) {
  const rel = safePath(value);
  if (!/\.html(?:clay)?$/i.test(rel)) throw refusal('forbidden', 'Not an HTML document', 400);
  return rel;
}

function encoded(rel) { return rel.split('/').map(encodeURIComponent).join('/'); }

async function fileFor(root, rel) {
  const file = await resolveReadPath(getConsentRegistry(root.path), rel);
  if (!(await fs.stat(file)).isFile()) throw refusal('missing', 'File is missing', 404);
  return file;
}

function rootUrl(root, route) { return `http://127.0.0.1:${root.port}${route}`; }

async function upstream(root, req, route, { method = 'GET', headers = {}, body } = {}) {
  const forwarded = {};
  for (const name of FORWARDED_HEADERS) if (req.headers[name]) forwarded[name] = req.headers[name];
  Object.assign(forwarded, headers);
  try { return await fetch(rootUrl(root, route), { method, headers: forwarded, body }); }
  catch { throw refusal('unknown', 'The root response was lost; refresh before trying again', 502); }
}

function reasonFor(status) {
  return status === 404 ? 'missing' : status === 403 ? 'forbidden' : status === 409 || status === 412
    ? 'conflict' : status === 501 ? 'unsupported' : status >= 500 ? 'unknown' : 'forbidden';
}

async function relayRefusal(res, response) {
  const body = await response.json().catch(() => null);
  const message = body?.error || body?.msg || `Root request failed (${response.status})`;
  return sendJson(res, response.status, { ...(body && typeof body === 'object' ? body : {}), error: message,
    reason: reasonFor(response.status),
    ...(response.headers.get('retry-after') ? { retryAfter: Number(response.headers.get('retry-after')) } : {}) });
}

function validateSave(request) {
  if (!request || typeof request !== 'object' || typeof request.html !== 'string' ||
    typeof request.etag !== 'string' || !request.etag || typeof request.operationId !== 'string' ||
    !request.operationId || request.operationId.length > 128) {
    throw refusal('forbidden', 'Invalid save request', 400);
  }
  return documentPath(request.path);
}

async function handleWorkspaceRoute({ req, res, url, root, route, settings, syncManager }) {
  if (route === 'source' && req.method === 'GET') {
    const rel = documentPath(url.searchParams.get('path'));
    const bytes = await fs.readFile(await fileFor(root, rel));
    // The editor is sent the clean file, but the stamp describes the logical
    // document the save route will compare its If-Match against.
    return sendJson(res, 200, {
      html: bytes.toString('utf8'),
      etag: documentEtag(await logicalBytes(root.path, rel, bytes))
    });
  }
  if (route === 'source' && req.method === 'PUT') {
    const request = await readJson(req, SAVE_MAX_BYTES + 1024 * 1024);
    const rel = validateSave(request);
    await fileFor(root, rel);
    const response = await upstream(root, req, '/_/save', {
      method: 'POST',
      headers: { 'content-type': 'text/html; charset=utf-8', 'document-url': rootUrl(root, `/${encoded(rel)}`),
        'if-match': request.etag, 'save-id': request.operationId, prefer: 'return=representation' },
      body: request.html,
    });
    if (!response.ok) return relayRefusal(res, response);
    const body = await response.json().catch(() => null);
    if (!body || typeof body.etag !== 'string' || typeof body.html !== 'string') {
      return sendJson(res, 502, { error: 'The save response was incomplete; refresh before trying again', reason: 'unknown' });
    }
    return sendJson(res, 200, { kind: 'saved', etag: body.etag, html: body.html });
  }
  if (route === 'versions' && req.method === 'GET') {
    const rel = documentPath(url.searchParams.get('path'));
    const response = await upstream(root, req, `/_/versions/${encoded(rel)}`);
    if (!response.ok) return relayRefusal(res, response);
    const body = await response.json();
    return sendJson(res, 200, { versions: body.versions.map(item => ({ id: item.name, savedAt: item.time,
      bytes: item.size, ...(item.kind ? { kind: item.kind } : {}) })) });
  }
  if (route === 'version' && req.method === 'GET') {
    const rel = documentPath(url.searchParams.get('path'));
    const id = safePath(url.searchParams.get('id'));
    if (id.includes('/')) throw refusal('forbidden', 'Invalid version', 400);
    const response = await upstream(root, req, `/_/version/${encoded(rel)}/${encodeURIComponent(id)}`);
    if (!response.ok) return relayRefusal(res, response);
    return sendJson(res, 200, { id, html: await response.text() });
  }
  if (route === 'restore' && req.method === 'POST') {
    const request = await readJson(req);
    const rel = documentPath(request?.path);
    const id = safePath(request?.versionId);
    if (id.includes('/') || typeof request.etag !== 'string' || !request.etag ||
      typeof request.operationId !== 'string' || !request.operationId || request.operationId.length > 128) {
      throw refusal('forbidden', 'Invalid restore request', 400);
    }
    const response = await upstream(root, req, `/_/restore/${encoded(rel)}/${encodeURIComponent(id)}`, {
      method: 'POST', headers: { 'if-match': request.etag, 'save-id': request.operationId },
    });
    if (!response.ok) return relayRefusal(res, response);
    const body = await response.json().catch(() => null);
    if (!body?.etag) return sendJson(res, 502, { error: 'The restore response was incomplete', reason: 'unknown' });
    return sendJson(res, 200, { kind: 'saved', etag: body.etag });
  }
  if (route === 'upload' && req.method === 'POST') {
    const parent = url.searchParams.get('path') || '';
    if (parent) safePath(parent);
    const registry = getConsentRegistry(root.path);
    const folder = parent ? await resolveReadPath(registry, parent) : (await registry.ready(), registry.baseReal);
    if (!(await fs.stat(folder)).isDirectory()) throw refusal('missing', 'Folder is missing', 404);
    const documents = (await fs.readdir(folder)).filter(name => /\.html(?:clay)?$/i.test(name)).sort();
    const document = documents.length ? `${parent ? `${parent}/` : ''}${documents[0]}` : null;
    if (document) await fileFor(root, document);
    const bytes = await readBytes(req, UPLOAD_MAX_BYTES + 1024 * 1024);
    const context = document
      ? { 'document-url': rootUrl(root, `/${encoded(document)}`) }
      : { 'upload-folder': encodeURIComponent(parent) };
    const response = await upstream(root, req, '/_/upload', { method: 'POST', headers: context, body: bytes });
    if (!response.ok) return relayRefusal(res, response);
    const body = await response.json().catch(() => null);
    const uploaded = body?.uploads?.[0]?.url;
    if (typeof uploaded !== 'string' || !uploaded.startsWith('/')) {
      return sendJson(res, 502, { error: 'The upload response was incomplete; refresh before trying again', reason: 'unknown' });
    }
    const stored = uploaded.startsWith('/_/uploads/')
      ? `uploads/${uploaded.slice('/_/uploads/'.length)}`
      : uploaded.slice(1);
    return sendJson(res, 200, { path: stored });
  }
  if (route === 'download' && req.method === 'GET') {
    const rel = safePath(url.searchParams.get('path'));
    const bytes = await fs.readFile(await fileFor(root, rel));
    res.writeHead(200, { 'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(rel))}`,
      'Content-Length': bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    return res.end(bytes);
  }
  if (route === 'consents' && req.method === 'GET') {
    await fileFor(root, documentPath(url.searchParams.get('path')));
    return sendJson(res, 200, { granted: [], denied: [] });
  }
  if (route === 'consents' && req.method === 'POST') {
    const request = await readJson(req);
    await fileFor(root, documentPath(request?.path));
    if (typeof request.permission !== 'string' || !request.permission ||
      !['grant', 'deny'].includes(request.decision)) throw refusal('forbidden', 'Invalid consent request', 400);
    throw refusal(request.decision === 'grant' ? 'forbidden' : 'unsupported',
      'Document permissions are unavailable in this window', request.decision === 'grant' ? 403 : 501);
  }
  if (route === 'conflicts/resolve' && req.method === 'POST') {
    if (root.kind !== 'team') throw refusal('unsupported', 'Personal roots have no sync conflicts', 501);
    const request = await readJson(req);
    const rel = safePath(request?.path);
    if (!['mine', 'theirs', 'both'].includes(request.keep)) throw refusal('forbidden', 'Invalid choice', 400);
    if (request.keep === 'both') throw refusal('unsupported', 'The sync resolver cannot keep both copies', 501);
    const session = (settings().syncSessions || []).find(item => item.rootId === root.id);
    const manager = syncManager?.();
    if (!session || !manager) throw refusal('unsupported', 'Sync is unavailable', 501);
    const result = await manager.resolveConflict({ sessionId: session.id, path: rel, choice: request.keep });
    if (!result.ok) throw refusal(result.error === 'no-conflict' ? 'missing' : 'conflict',
      result.error || 'Conflict resolution failed', result.error === 'no-conflict' ? 404 : 409);
    return sendJson(res, 200, result);
  }
  throw refusal('unsupported', 'Method is not available', 405);
}

module.exports = { handleWorkspaceRoute };
