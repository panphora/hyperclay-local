// The readable snapshot's inventory, made self-contained: every displayed image and
// included attachment the snapshot names is read once, within limits, and written
// into the document as a data URL, so the file that comes out needs nothing fetched
// again. What cannot be carried is named in a loss list rather than dropped in
// silence: a cross-origin read the other origin refuses, a host that is not
// reachable, a missing file, a type a reading copy does not carry, a resource over
// its limit, an embed with no static rendering. Addresses are canonical before the
// duplicate check, so one picture named twice is one request.
/** The limits one export reads under: per resource, in total, and how long each waits. */
export const EXPORT_LIMITS = Object.freeze({
  perResource: 20 * 1024 * 1024,
  total: 50 * 1024 * 1024,
  timeout: 10_000,
  inFlight: 3,
});

// What a reading copy carries inside itself: images, fonts and media, never anything
// a browser would treat as a document, a script or a style. An active type such as
// SVG or HTML is refused by name rather than inlined.
const ALLOWED_MIME = [
  /^image\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)$/i,
  /^font\/(?:woff2?|ttf|otf|sfnt|collection|eot)$/i,
  /^application\/(?:font-woff2?|vnd\.ms-fontobject|x-font-ttf|x-font-opentype|vnd\.ms-opentype)$/i,
  /^audio\/[a-z0-9][a-z0-9.+-]*$/i,
  /^video\/[a-z0-9][a-z0-9.+-]*$/i,
];

// What no attachment may carry: anything a browser would run or render as a document.
const ACTIVE_MIME = /^(?:text\/(?:html|javascript|css|xml|xsl)|application\/(?:xhtml\+xml|xml|javascript|ecmascript|x-javascript|wasm)|image\/svg\+xml)$|\+xml$/i;

/**
 * Whether a response's declared type is one a reading copy carries inside itself. An image
 * is drawn, so only the drawn types; an attachment is a link to a file, so any type that is
 * not active.
 */
export function isAllowedMime(type, kind = "image") {
  const base = String(type ?? "").split(";")[0].trim();
  if (base === "") return false;
  if (kind === "attachment") return !ACTIVE_MIME.test(base);
  return ALLOWED_MIME.some((pattern) => pattern.test(base));
}

/**
 * One address, as the duplicate check and the request both see it: resolved against
 * the captured base URL, with the fragment gone. A value that names nothing, or that
 * is not an address at all, answers null.
 */
export function canonicalUrl(raw, base = globalThis.document?.baseURI ?? null) {
  const text = String(raw ?? "").trim();
  if (!text || text.startsWith("#")) return null;
  try {
    const url = new URL(text, base ?? undefined);
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

const squash = (value) => String(value ?? "").trim().replace(/[\u0000-\u0020]/g, "");
const isLocalHost = (hostname) => /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\]|::1)$/i.test(hostname || "") || /\.local$/i.test(hostname || "");
const originOf = (href) => { try { return new URL(href).origin; } catch { return null; } };
const hostOf = (href) => { try { return new URL(href).hostname; } catch { return null; } };
const mb = (bytes) => (bytes >= 1024 * 1024 ? `${Math.round(bytes / (1024 * 1024))} MiB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KiB` : `${Math.round(bytes)} B`);

const subject = (target) => (target.blockId ? `The ${target.kind} in block ${target.blockId}` : `The ${target.kind}`);
const loss = (code, target, message) => ({ code, kind: target.kind ?? null, url: target.url ?? null, blockId: target.blockId ?? null, message });

function embedLoss(entry, url) {
  const blockId = entry.blockId ?? null;
  const where = blockId ? ` in block ${blockId}` : "";
  return {
    code: "unsupported-embed",
    kind: "embed",
    url: entry.url ?? null,
    blockId,
    message: `The embed${where} is a live frame, which a reading copy cannot carry${url ? ` (${url})` : ""}`,
  };
}

function urlLoss(entry) {
  const blockId = entry.blockId ?? null;
  const where = blockId ? ` in block ${blockId}` : "";
  return {
    code: "unsupported-url",
    kind: entry.kind ?? null,
    url: entry.url ?? null,
    blockId,
    message: `The ${entry.kind}${where} points at ${String(entry.url ?? "").trim().slice(0, 120)}, which is not an address a reading copy can fetch`,
  };
}

const bytesOf = (value) => {
  if (!value) return new Uint8Array(0);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array(value);
};

function toBase64(bytes) {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return globalThis.btoa(binary);
}

const dataUrlOf = (type, bytes) => `data:${String(type).split(";")[0].trim()};base64,${toBase64(bytes)}`;

// The body as bytes, never as a whole file at once: each chunk is counted against
// both limits, so an oversized resource, or one that would push the file past its
// total, stops at the chunk that crossed the line instead of after the download.
async function readBytes(response, task, limits, budget) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > limits.perResource) {
    throw loss("too-large", task.target, `${subject(task.target)} at ${task.target.url} is larger than ${mb(limits.perResource)}`);
  }
  const charge = () => {
    if (task.bytes > limits.perResource) throw loss("too-large", task.target, `${subject(task.target)} at ${task.target.url} is larger than ${mb(limits.perResource)}`);
    if (budget.exhausted || budget.spent + budget.live > budget.total) {
      budget.exhausted = true;
      throw loss("total-too-large", task.target, `The page's resources together are larger than ${mb(budget.total)}`);
    }
  };
  const reader = response.body?.getReader?.();
  if (!reader) {
    const whole = bytesOf(typeof response.arrayBuffer === "function" ? await response.arrayBuffer() : response.body);
    task.bytes += whole.byteLength;
    budget.live += whole.byteLength;
    try {
      charge();
    } finally {
      budget.live -= whole.byteLength;
      if (task.bytes <= limits.perResource) budget.spent += whole.byteLength;
    }
    return whole;
  }
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const part = bytesOf(value);
      task.bytes += part.byteLength;
      budget.live += part.byteLength;
      charge();
      chunks.push(part);
    }
  } catch (error) {
    budget.live -= task.bytes;
    task.bytes = 0;
    try { await reader.cancel?.(); } catch {}
    throw error;
  }
  budget.live -= task.bytes;
  budget.spent += task.bytes;
  const out = new Uint8Array(task.bytes);
  let at = 0;
  for (const part of chunks) { out.set(part, at); at += part.byteLength; }
  return out;
}

// One resource: one request with the credentials its origin is owed, one timeout, one
// cancellation, and one named loss if it cannot be carried. Nothing here throws past
// the loss: an export reports every failure it found rather than the first.
async function fetchOne(task, { fetchImpl, baseOrigin, baseHost, limits, budget, run }) {
  const { target, controller } = task;
  if (run.signal.aborted) return { target, loss: loss("cancelled", target, `Reading ${target.url} was cancelled`) };
  const onCancel = () => controller.abort();
  if (run.signal.aborted) controller.abort();
  else run.signal.addEventListener("abort", onCancel, { once: true });
  const timer = setTimeout(() => { task.timedOut = true; controller.abort(); }, limits.timeout);
  const sameOrigin = baseOrigin != null && originOf(target.url) === baseOrigin;
  try {
    const response = await fetchImpl(target.url, {
      credentials: sameOrigin ? "include" : "omit",
      signal: controller.signal,
    });
    if (!response || response.ok === false) {
      const status = response?.status ?? 0;
      throw loss("missing-resource", target, `${subject(target)} is not at ${target.url} (the host answered ${status || "nothing"})`);
    }
    const type = response.headers?.get?.("content-type") ?? "";
    if (!isAllowedMime(type, target.kind)) {
      throw loss("mime-refused", target, `${subject(target)} at ${target.url} is ${String(type).split(";")[0].trim() || "of no stated type"}, which a reading copy does not carry`);
    }
    const bytes = await readBytes(response, task, limits, budget);
    return { target, hit: { data: dataUrlOf(type, bytes), type: String(type).split(";")[0].trim(), bytes: bytes.byteLength } };
  } catch (error) {
    if (error && typeof error.code === "string" && typeof error.message === "string") return { target, loss: error };
    if (task.timedOut) return { target, loss: loss("timeout", target, `${subject(target)} at ${target.url} did not arrive within ${Math.round(limits.timeout / 1000)} s`) };
    if (run.signal.aborted || controller.signal.aborted) return { target, loss: loss("cancelled", target, `Reading ${target.url} was cancelled`) };
    if (!sameOrigin) return { target, loss: loss("cross-origin-cors", target, `${subject(target)} at ${target.url} could not be read: ${originOf(target.url) ?? "the other origin"} refused a cross-origin read`) };
    if (isLocalHost(baseHost)) return { target, loss: loss("offline-host", target, `${subject(target)} at ${target.url} could not be read: this copy's host is not reachable`) };
    return { target, loss: loss("unreachable", target, `${subject(target)} at ${target.url} could not be read`) };
  } finally {
    clearTimeout(timer);
    run.signal.removeEventListener("abort", onCancel);
  }
}

async function pool(tasks, inFlight, worker) {
  const queue = tasks.slice();
  const run = async () => {
    for (;;) {
      const task = queue.shift();
      if (!task) return;
      await worker(task);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(inFlight, queue.length)) }, run));
}

// The document with the fetched bytes inside it and every remote reference gone: a
// data URL where a picture or an attachment was, and nothing at all where a resource
// could not be carried. A stylesheet or script element has no place in a reading copy,
// and a `url()` or `@import` leaves a style declaration alone.
function rewrite(html, hits, base) {
  const parsed = new DOMParser().parseFromString(String(html ?? ""), "text/html");
  for (const el of [...parsed.querySelectorAll("script, link, base, style[media]")]) el.remove();
  for (const el of [...parsed.querySelectorAll("iframe, embed, object, video, audio, source, track, picture")]) el.remove();
  for (const el of parsed.querySelectorAll("img")) {
    const hit = hits.get(canonicalUrl(el.getAttribute("src"), base));
    if (hit) el.setAttribute("src", hit.data);
    else el.removeAttribute("src");
    el.removeAttribute("srcset");
    el.removeAttribute("poster");
  }
  for (const el of parsed.querySelectorAll('[data-type="file"]')) {
    const hit = hits.get(canonicalUrl(el.getAttribute("data-src"), base)) ?? hits.get(canonicalUrl(el.querySelector("a[href]")?.getAttribute("href"), base));
    if (hit) {
      el.setAttribute("data-src", hit.data);
      const link = el.querySelector("a[href]");
      if (link) link.setAttribute("href", hit.data);
    } else {
      el.removeAttribute("data-src");
      el.querySelector("a[href]")?.removeAttribute("href");
    }
  }
  for (const el of parsed.querySelectorAll("[style]")) {
    const kept = String(el.getAttribute("style")).split(";").filter((part) => !/url\s*\(|@import/i.test(part)).join(";").trim();
    if (kept) el.setAttribute("style", kept);
    else el.removeAttribute("style");
  }
  return `<!DOCTYPE html>\n${parsed.documentElement.outerHTML}`;
}

const CANDIDATES = [...String("src srcset poster data data-src xlink:href").split(" "), "href"];
const carriesRemote = (value) => {
  const s = squash(value);
  if (!s || s.startsWith("#")) return false;
  return !/^data:/i.test(s);
};

/**
 * Every reference in a document that would make the browser request something the
 * file does not hold: a source, a source set, a poster, an object's data, a
 * stylesheet's or a script's address, a `url()` or `@import` in a style. An ordinary
 * hyperlink is not one, and neither is a data URL or a fragment.
 */
export function remoteDependencies(html) {
  const parsed = new DOMParser().parseFromString(String(html ?? ""), "text/html");
  const out = [];
  for (const el of parsed.querySelectorAll("*")) {
    const tag = el.tagName.toLowerCase();
    for (const name of CANDIDATES) {
      if (!el.hasAttribute(name)) continue;
      if (name === "href" && tag !== "link" && tag !== "script" && tag !== "base") continue;
      if (name === "data" && tag !== "object") continue;
      if (name === "data-src" && !el.closest?.('[data-type="file"]')) continue;
      const value = el.getAttribute(name);
      const candidates = name === "srcset" ? String(value).split(",").map((part) => part.trim().split(/\s+/)[0]) : [value];
      for (const candidate of candidates) if (carriesRemote(candidate)) out.push({ tag, attr: name, value: candidate });
    }
    const style = el.getAttribute("style");
    if (style && /url\s*\(|@import/i.test(style)) out.push({ tag, attr: "style", value: style });
  }
  for (const el of parsed.querySelectorAll("style")) {
    if (/url\s*\(|@import/i.test(el.textContent ?? "")) out.push({ tag: "style", attr: "text", value: el.textContent });
  }
  return out;
}

/**
 * One readable snapshot made self-contained: `html` with its images and attachments
 * inside it, the named `losses` that stopped anything else being carried, and the
 * `remote` references that still point off the file (empty when nothing does). The
 * caller downloads only when both lists are empty.
 */
export async function inlineExportResources(html, {
  resources = [],
  base = globalThis.document?.baseURI ?? null,
  fetch: fetchImpl = globalThis.fetch,
  signal = null,
  limits = EXPORT_LIMITS,
} = {}) {
  const capped = { ...EXPORT_LIMITS, ...(limits ?? {}) };
  const losses = [];
  const named = new Set();
  const add = (entry) => {
    const key = `${entry.code}\u0000${entry.blockId ?? ""}\u0000${entry.message}`;
    if (named.has(key)) return;
    named.add(key);
    losses.push(entry);
  };
  const targets = new Map();
  for (const entry of resources ?? []) {
    if (!entry || entry.kind === "chart" || entry.inline) continue;
    const url = entry.url ? canonicalUrl(entry.url, base) : null;
    if (entry.kind === "embed") {
      add(embedLoss(entry, url));
      continue;
    }
    if (!url) {
      add(urlLoss(entry));
      continue;
    }
    const target = targets.get(url) ?? { url, kind: entry.kind, blockId: entry.blockId ?? null };
    target.blockId ??= entry.blockId ?? null;
    targets.set(url, target);
  }

  const listed = [...targets.values()];
  const hits = new Map();
  const budget = { spent: 0, live: 0, total: capped.total, exhausted: false };
  if (listed.length && typeof fetchImpl !== "function") {
    for (const target of listed) add(loss("unavailable", target, `${subject(target)} at ${target.url} could not be read: this page cannot fetch it`));
  } else if (listed.length) {
    const run = new AbortController();
    const onCancel = () => run.abort();
    if (signal) {
      if (signal.aborted) run.abort();
      else signal.addEventListener("abort", onCancel, { once: true });
    }
    const baseOrigin = base ? originOf(canonicalUrl(base, base) ?? base) : null;
    const baseHost = base ? hostOf(canonicalUrl(base, base) ?? base) : null;
    const answers = new Map();
    try {
      const tasks = listed.map((target) => ({ target, controller: new AbortController(), bytes: 0, timedOut: false }));
      await pool(tasks, capped.inFlight, async (task) => {
        if (run.signal.aborted) return;
        answers.set(task.target.url, await fetchOne(task, { fetchImpl, baseOrigin, baseHost, limits: capped, budget, run }));
      });
    } finally {
      signal?.removeEventListener("abort", onCancel);
    }
    for (const target of listed) {
      const answer = answers.get(target.url);
      if (answer?.hit) hits.set(target.url, answer.hit);
      else if (answer?.loss) add(answer.loss);
      else if (run.signal.aborted) add(loss("cancelled", target, `Reading ${target.url} was cancelled`));
      else add(loss("unreachable", target, `${subject(target)} at ${target.url} could not be read`));
    }
  }

  const out = rewrite(html, hits, base);
  return { html: out, losses, remote: remoteDependencies(out), embedded: hits.size, bytes: budget.spent };
}
