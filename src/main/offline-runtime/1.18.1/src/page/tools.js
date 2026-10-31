import { mountTool, readerStateHandle, scopedStateHandle, validateArtifact } from "./rich/tool-runtime.js";

export function createToolHost({ store = null, mode, tables = () => [] }) {
  const mounted = new Set();
  const warned = new Set();
  let disposed = false;
  let frame = null;
  let frameWindow = null;

  const warn = (id, rev, error) => {
    const key = `${id}:${rev}`;
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(`clayjs: tool ${id} revision ${rev} failed`, error);
  };

  const fail = (item, error) => {
    warn(item.id, item.rev, error);
    item.readerOff?.();
    item.readerOff = null;
    try { item.runtime?.dispose(); } catch (cleanupError) { warn(item.id, item.rev, cleanupError); }
    item.runtime = null;
    item.root.innerHTML = item.artifact?.fallbackHtml ?? "";
    const note = item.root.ownerDocument.createElement("p");
    note.setAttribute("data-tool-error", "");
    note.textContent = "Tool could not start";
    item.root.append(note);
  };

  const onChange = () => {
    for (const item of mounted) {
      if (item.disposed || mode === "view") continue;
      const next = store?.data?.[item.id]?.[item.rev];
      const signature = JSON.stringify(next);
      if (signature === item.signature) continue;
      item.signature = signature;
      try {
        if (!item.runtime) item.render();
        else if (next !== undefined) item.runtime.notifyState();
        else item.render();
      } catch (error) { fail(item, error); }
    }
  };
  const unsubscribe = store?.on?.("change", onChange) ?? (() => {});

  const host = {
    mount(root, { id, artifact, rev, seed = {} }) {
      if (disposed) throw new Error("tool host is disposed");
      const item = { root, id, artifact, rev, seed, runtime: null, readerOff: null, disposed: false, signature: undefined };
      const note = (message) => {
        const line = root.ownerDocument.createElement("p");
        line.setAttribute("data-tool-note", "");
        line.textContent = message;
        root.append(line);
      };
      item.render = () => {
        item.readerOff?.();
        item.readerOff = null;
        try { item.runtime?.dispose(); } catch (error) { warn(item.id, item.rev, error); }
        item.runtime = null;
        root.removeAttribute("data-tool-scope");
        if (validateArtifact(item.artifact).ok === false) {
          root.textContent = "Tool unavailable";
          warn(item.id, item.rev, new Error("invalid artifact"));
          return;
        }
        const current = store?.data?.[item.id]?.[item.rev];
        item.signature = JSON.stringify(current);
        if (mode === "edit" && store && current === undefined) {
          root.innerHTML = item.artifact.fallbackHtml;
          note("Waiting for this tool's state…");
          return;
        }
        const state = mode === "edit" && store
          ? scopedStateHandle(store, item.id, item.rev)
          : readerStateHandle(current ?? item.seed ?? {});
        item.runtime = mountTool({ root, artifact: item.artifact, mode, state, tables, onError: (error) => warn(item.id, item.rev, error) });
        item.readerOff = state.on?.("change", () => {
          try { item.runtime?.notifyState(); } catch (error) { fail(item, error); }
        }) ?? null;
        if (mode === "edit" && !store) note("This document can't save tool state");
      };
      try { item.render(); } catch (error) { fail(item, error); }
      mounted.add(item);
      return {
        update({ artifact: nextArtifact, rev: nextRev }) {
          if (item.disposed) return;
          if (nextRev === item.rev && nextArtifact === item.artifact) return;
          item.artifact = nextArtifact;
          item.rev = nextRev;
          try { item.render(); } catch (error) { fail(item, error); }
        },
        dispose() {
          if (item.disposed) return;
          item.disposed = true;
          mounted.delete(item);
          item.readerOff?.();
          try { item.runtime?.dispose(); } catch (error) { warn(item.id, item.rev, error); }
          item.runtime = null;
        },
      };
    },
    tablesChanged() {
      if (disposed || frame !== null || !mounted.size) return;
      const win = [...mounted][0]?.root.ownerDocument.defaultView ?? globalThis;
      frameWindow = win;
      const raf = win.requestAnimationFrame?.bind(win) ?? ((fn) => win.setTimeout(fn, 0));
      frame = raf(() => {
        frame = null;
        for (const item of mounted) {
          try { item.runtime?.notifyTables(); } catch (error) { fail(item, error); }
        }
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      if (frame !== null) {
        if (frameWindow.cancelAnimationFrame) frameWindow.cancelAnimationFrame(frame);
        else frameWindow.clearTimeout(frame);
        frame = null;
      }
      for (const item of [...mounted]) {
        item.disposed = true;
        item.readerOff?.();
        try { item.runtime?.dispose(); } catch (error) { warn(item.id, item.rev, error); }
      }
      mounted.clear();
    },
  };
  return host;
}
