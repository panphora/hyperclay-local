/**
 * The wire's two routes, mounted on every per-folder app (CONTRACTS §11).
 *
 * A page asks, a process answers, the process edits the FILE. HTML never rides
 * the wire: the edit reaches the page through the ordinary external-change path.
 * Port of htmlclay/internal/server/wire.go's handlers; the hub itself lives in
 * wire-hub.js and is injected here, one instance per app.
 *
 * Both routes act only on a `/_/wire/` request, so a user folder actually named
 * `wire/` keeps being served statically. Every 404 these routes answer is
 * text/plain or JSON, never text/html: the CLI reads a text/html 404 as "the
 * recovery page holds this port" (htmlclay/cmd/htmlclay/wire_cli.go:515-536).
 */

const express = require('express');
const { WireError, createWireSub, MAX_WIRE_BODY, MAX_WIRE_TEXT, MAX_WIRE_ID_LEN } = require('./wire-hub');

const KEEPALIVE_MS = 25 * 1000;

// wireEnvelope.isTerminal, wire.go:101-104. The hub does not export it and the
// routes need it to know which of the frames a named handler publishes is the
// one that releases a cancel.
function isTerminal(env) {
  return env.type === 'wire/done' || env.type === 'wire/error';
}

// htmlclay/internal/server/handlers.go:1297-1305: the spec's §3 code for a
// status, so a client branches on the reason instead of pattern-matching the
// message. Statuses the registry does not name (400) carry no code.
const WIRE_ERROR_CODES = {
  401: 'unauthorized',
  402: 'payment-required',
  403: 'forbidden',
  404: 'not-found',
  413: 'too-large',
  415: 'unsupported-type',
  422: 'invalid-document'
};

// A browser attests at least one of Sec-Fetch-Site or Origin on every fetch and
// every EventSource and cannot forge either; a local process attests neither.
// Origin is checked only WHEN PRESENT, never required: Chrome omits it on
// same-origin GETs, including EventSource's stream GET. same-site is rejected
// rather than admitted, because every folder here is its own origin and every
// one of them is same-site with every other.
function wireCaller(req) {
  const site = req.headers['sec-fetch-site'];
  const origin = req.headers.origin;
  if (!site && !origin) return { isBrowser: false, ok: true };
  if (site && site !== 'same-origin') return { isBrowser: true, ok: false };
  if (origin && origin !== `http://${req.headers.host}`) return { isBrowser: true, ok: false };
  return { isBrowser: true, ok: true };
}

function isJSONContentType(ct) {
  const media = String(ct || '').split(';')[0].trim().toLowerCase();
  return media === 'application/json' || media.endsWith('+json');
}

function lastEventId(req) {
  const raw = req.headers['last-event-id'] || req.query.lastEventId || '';
  const v = Number(String(raw).trim());
  return Number.isSafeInteger(v) && v > 0 ? v : 0;
}

function sendError(res, status, message) {
  const code = WIRE_ERROR_CODES[status];
  res.status(status).json({ ok: false, error: message, msg: message, msgType: 'error', ...(code ? { code } : {}) });
}

function mountWire(app, { hub, resolveBrowserTarget, resolveProcessTarget, onHandlerAttach, onTerminalFromProcess }) {
  const isWire = (req) => req.originalUrl.startsWith('/_/wire/');

  app.use('/wire', (req, res, next) => {
    if (!isWire(req)) return next();
    if (!wireCaller(req).ok) return res.status(403).type('text/plain').send('Forbidden');
    next();
  });

  app.get('/wire/subscribe', async (req, res, next) => {
    if (!isWire(req)) return next();
    const { isBrowser } = wireCaller(req);
    const wantHandler = req.query.role === 'handler';
    if (wantHandler && isBrowser) return res.status(403).type('text/plain').send('Forbidden');
    let mode = '';
    if (wantHandler) {
      mode = req.query.mode === undefined || req.query.mode === '' ? 'raw' : req.query.mode;
      if (mode !== 'raw' && mode !== 'jsonl') return sendError(res, 400, 'invalid handler mode');
    }
    const key = isBrowser ? resolveBrowserTarget(req) : await resolveProcessTarget(req.query.file);
    if (!key) return res.status(404).type('text/plain').send('Not Found');

    const sub = createWireSub({ key, handler: wantHandler, mode, res });
    let opened;
    try {
      opened = hub.add(sub, lastEventId(req));
    } catch (err) {
      if (err instanceof WireError && err.code === 'handler-taken') return res.status(409).type('text/plain').send('Conflict');
      if (err instanceof WireError && err.code === 'busy') return res.status(429).type('text/plain').send('Too Many Requests');
      return res.status(503).type('text/plain').send('Service Unavailable');
    }

    let release = () => {};
    if (wantHandler) {
      try {
        release = await onHandlerAttach(key);
      } catch {
        hub.remove(sub);
        return res.status(503).type('text/plain').send('Service Unavailable');
      }
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    if (isBrowser && !wantHandler) {
      res.write(`event: cursor\nid: ${opened.cursor}\ndata: {"seq":${opened.cursor}}\n\n`);
    }
    for (const frame of opened.replay) res.write(frame);

    const keepAlive = setInterval(() => {
      if (!res.writableEnded) res.write(': keepalive\n\n');
    }, KEEPALIVE_MS);
    req.on('close', () => {
      clearInterval(keepAlive);
      hub.remove(sub);
      release();
    });
  });

  // The send lane is POST-only, so a GET on this path is not a wire route at all:
  // it falls through to the static catch-all and 404s, which is the answer the CLI
  // reads as "a live site that is not serving this file" (wire.go answers 405 here;
  // Express has no method-scoped mount to give that, and a 415 on a bodiless GET
  // would describe the wrong thing).
  app.use('/wire/send', (req, res, next) => {
    if (!isWire(req) || req.method !== 'POST') return next();
    if (!isJSONContentType(req.headers['content-type'])) return sendError(res, 415, 'expected application/json');
    next();
  });
  app.use('/wire/send', express.json({ limit: MAX_WIRE_BODY, type: () => true }));
  app.use('/wire/send', (err, req, res, next) => {
    if (!isWire(req)) return next(err);
    if (err.type === 'entity.too.large') return sendError(res, 413, 'wire frame too large');
    return sendError(res, 400, 'invalid JSON');
  });

  app.post('/wire/send', async (req, res, next) => {
    if (!isWire(req)) return next();
    const { isBrowser } = wireCaller(req);
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return sendError(res, 400, 'invalid JSON');
    const type = body.type;
    if (typeof type !== 'string' || !type.startsWith('wire/') || type.length > 64) return sendError(res, 400, 'invalid type');
    const id = body.id;
    if (typeof id !== 'string' || id === '' || id.length > MAX_WIRE_ID_LEN) return sendError(res, 400, 'invalid id');

    const key = isBrowser ? resolveBrowserTarget(req) : await resolveProcessTarget(body.file);
    if (!key) return sendError(res, 404, 'unknown file');

    let text = typeof body.text === 'string' ? body.text : '';
    if (Buffer.byteLength(text) > MAX_WIRE_TEXT) text = Buffer.from(text).subarray(0, MAX_WIRE_TEXT).toString();
    const env = {
      v: 1,
      type,
      id,
      from: isBrowser ? 'page' : 'process',
      file: key,
      helper: typeof body.helper === 'string' ? body.helper : '',
      document: typeof body.document === 'string' ? body.document : '',
      text,
      payload: body.payload,
    };

    if (hub.namedHandler) {
      const cancelKey = `${key}\n${id}`;
      if (env.helper && (type === 'wire/request' || type === 'wire/describe')) {
        const publish = (frame) => {
          const out = { v: 1, id, file: key, helper: env.helper, ...frame, from: 'process' };
          if (isTerminal(out)) hub.namedCancels.delete(cancelKey);
          return hub.publish(key, out);
        };
        const onCancel = (cancelId, cb) => hub.namedCancels.set(`${key}\n${cancelId}`, cb);
        Promise.resolve()
          .then(() => hub.namedHandler(env, { file: key, publish, onCancel }))
          .catch((err) => publish({
            type: 'wire/error',
            text: String(err?.message || err).slice(0, MAX_WIRE_TEXT),
            payload: { source: 'host', code: 'helper_failed' },
          }));
        return res.json({ ok: true, delivered: 1, observers: 0 });
      }
      if (type === 'wire/cancel' && hub.namedCancels.has(cancelKey)) {
        const cb = hub.namedCancels.get(cancelKey);
        hub.namedCancels.delete(cancelKey);
        cb();
        return res.json({ ok: true, delivered: 1, observers: 0 });
      }
    }

    if (env.helper && (type === 'wire/request' || type === 'wire/describe')) {
      const { rejected, observers } = hub.rejectNamedForRawHandler(key, env);
      if (rejected) {
        return res.json({
          ok: true, delivered: 0, observers,
          refused: { source: 'host', code: 'helper_protocol_unsupported', message: 'this handler does not support named helpers' },
        });
      }
    }
    if ((type === 'wire/done' || type === 'wire/error') && !isBrowser) onTerminalFromProcess(key);

    const { handlers, observers } = hub.publish(key, env);
    res.json({ ok: true, delivered: handlers, observers });
  });
}

module.exports = { mountWire, wireCaller, isJSONContentType };
