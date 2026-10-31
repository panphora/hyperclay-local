import { applyOp, cloneJson } from "../../live/ops.js";

export const ARTIFACT_LIMIT = 24576;
export const STATE_LIMIT = 8192;
const ARTIFACT_KEYS = ["title", "html", "css", "javascript", "fallbackHtml", "summary"];
const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
let nextScope = 0;

export class ToolStateError extends Error {
  constructor(code) {
    super(code);
    this.name = "ToolStateError";
    this.code = code;
  }
}

export function validateArtifact(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).length !== ARTIFACT_KEYS.length ||
    !ARTIFACT_KEYS.every((key) => Object.hasOwn(value, key) && typeof value[key] === "string")) return { ok: false, code: "invalid-artifact" };
  return bytes(value) <= ARTIFACT_LIMIT ? { ok: true } : { ok: false, code: "artifact-too-large" };
}

export function validateState(value) {
  try {
    const copy = cloneJson(value);
    return bytes(copy) <= STATE_LIMIT ? { ok: true } : { ok: false, code: "state-too-large" };
  } catch {
    return { ok: false, code: "invalid-state" };
  }
}

function pathOf(path) {
  if (!Array.isArray(path) || path.some((part) => typeof part !== "string" && !(Number.isSafeInteger(part) && part >= 0))) {
    throw new TypeError("tool state path must be an array of strings or non-negative integers");
  }
  return path.slice();
}

function checkedState(current, op) {
  try {
    const holder = { state: current === undefined ? {} : cloneJson(current) };
    applyOp(holder, { ...op, path: ["state", ...op.path] });
    const result = validateState(holder.state);
    if (!result.ok) throw new ToolStateError(result.code);
  } catch (error) {
    if (error instanceof ToolStateError) throw error;
    throw new ToolStateError("invalid-state");
  }
}

export function scopedStateHandle(store, toolId, rev) {
  const prefix = [toolId, rev];
  return Object.freeze({
    get data() { return store.data?.[toolId]?.[rev]; },
    set(path, value) {
      const parts = pathOf(path);
      checkedState(store.data?.[toolId]?.[rev], { op: "set", path: parts, value });
      store.set([...prefix, ...parts], value);
    },
    delete(path) { store.delete([...prefix, ...pathOf(path)]); },
    add(path, n = 1) {
      const parts = pathOf(path);
      if (!parts.length || typeof n !== "number" || !Number.isFinite(n)) throw new ToolStateError("invalid-state");
      checkedState(store.data?.[toolId]?.[rev], { op: "add", path: parts, n });
      store.add([...prefix, ...parts], n);
    },
  });
}

export function readerStateHandle(snapshot) {
  let data = cloneJson(snapshot ?? {});
  const listeners = new Set();
  const emit = () => { for (const fn of [...listeners]) fn(); };
  const write = (op) => {
    const holder = { state: data };
    applyOp(holder, { ...op, path: ["state", ...op.path] });
    const result = validateState(holder.state);
    if (!result.ok) throw new ToolStateError(result.code);
    data = holder.state;
    emit();
  };
  return Object.freeze({
    get data() { return cloneJson(data); },
    set(path, value) { write({ op: "set", path: pathOf(path), value }); },
    delete(path) { write({ op: "del", path: pathOf(path) }); },
    add(path, n = 1) {
      const parts = pathOf(path);
      if (!parts.length || typeof n !== "number" || !Number.isFinite(n)) throw new ToolStateError("invalid-state");
      write({ op: "add", path: parts, n });
    },
    on(type, fn) {
      if (type !== "change" || typeof fn !== "function") throw new TypeError("reader state supports on(change, fn)");
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  });
}

function splitSelectors(selector) {
  const out = [];
  let start = 0, quote = null, depth = 0;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (quote) { if (ch === quote && selector[i - 1] !== "\\") quote = null; }
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) { out.push(selector.slice(start, i).trim()); start = i + 1; }
  }
  out.push(selector.slice(start).trim());
  return out.filter(Boolean);
}

export function scopeCss(css, blockSelector) {
  let out = "", cursor = 0;
  while (cursor < css.length) {
    const open = css.indexOf("{", cursor);
    if (open < 0) { out += css.slice(cursor); break; }
    const selector = css.slice(cursor, open).trim();
    let depth = 1, end = open + 1, quote = null;
    for (; end < css.length && depth; end++) {
      const ch = css[end];
      if (quote) { if (ch === quote && css[end - 1] !== "\\") quote = null; }
      else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    const body = css.slice(open + 1, end - 1);
    if (/^@(?:media|supports|container)\b/i.test(selector)) out += `${selector}{${scopeCss(body, blockSelector)}}`;
    else if (selector.startsWith("@")) out += `${selector}{${body}}`;
    else out += `${splitSelectors(selector).map((part) => `${blockSelector} ${part}`).join(", ")}{${body}}`;
    cursor = end;
  }
  return out;
}

export function mountTool({ root, artifact, mode, state, tables = () => [], onError = () => {}, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const listeners = { change: new Set(), tables: new Set() };
  const timers = new Set();
  let cleanup, disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const timer of timers) clearTimer(timer);
    timers.clear();
    for (const group of Object.values(listeners)) group.clear();
    const fn = cleanup;
    cleanup = null;
    if (typeof fn === "function") fn();
  };
  const notify = (type) => { if (!disposed) for (const fn of [...listeners[type]]) fn(); };
  const allTables = () => Object.freeze(cloneJson(tables()).map((table) => deepFreeze(table)));
  const tool = Object.freeze({
    root, mode, state,
    on(event, fn) {
      if (!Object.hasOwn(listeners, event) || typeof fn !== "function") throw new TypeError("unknown tool event");
      listeners[event].add(fn);
      return () => listeners[event].delete(fn);
    },
    table(id) { return allTables().find((table) => table.id === id) ?? null; },
    tables: allTables,
    schedule(fn, ms) {
      if (disposed) return null;
      const timer = setTimer(() => { timers.delete(timer); if (!disposed) fn(); }, ms);
      timers.add(timer);
      return timer;
    },
  });
  try {
    root.innerHTML = artifact.html;
    const style = root.ownerDocument.createElement("style");
    const scope = String(++nextScope);
    const selector = `[data-tool-scope="${scope}"]`;
    root.setAttribute("data-tool-scope", scope);
    style.textContent = scopeCss(artifact.css, selector);
    root.prepend(style);
    const body = `${artifact.javascript}\n;return typeof mount === "function" ? mount : undefined;`;
    const exported = new Function("tool", body)(tool);
    const mount = typeof exported === "function" ? exported : exported?.mount;
    if (typeof mount !== "function") throw new TypeError("tool script must define mount(tool)");
    cleanup = mount(tool);
  } catch (error) {
    try { dispose(); } catch (cleanupError) { onError(cleanupError); }
    onError(error);
    root.innerHTML = `${artifact.fallbackHtml}<p data-tool-error>Tool could not start</p>`;
  }
  return { notifyState: () => notify("change"), notifyTables: () => notify("tables"), dispose };
}

function deepFreeze(value) {
  if (value && typeof value === "object") { for (const item of Object.values(value)) deepFreeze(item); Object.freeze(value); }
  return value;
}

