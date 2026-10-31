// The menu's editing items: Undo and Redo, Ask AI, and Download a copy. Each one calls
// the service that already does the job and keeps no second copy of its state.
import { modeRefusalText } from "../../core/mode-refusal.js";
import { downloadHtml, documentName } from "../../core/download.js";
import { keys, revealLabel } from "./preferences.js";

const RESUME_KEY = "menu-resume";
const READY_MS = 5000;

const clay = () => window.clay || {};
const session = () => clay().storage && clay().storage.session;
const pageWants = (name) => {
  const names = clay().editPlugins;
  return Array.isArray(names) && names.includes(name);
};

// An edit-only plugin attaches after the mode change commits, so the item waits for it
// briefly instead of reporting it missing.
function whenPresent(get, ms = READY_MS) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const value = get();
      if (value || Date.now() - start >= ms) resolve(value || null);
      else setTimeout(tick, 50);
    };
    tick();
  });
}

export function attachActions({ addItem, note, currentMode }) {
  const resumers = new Map();

  // Runs `run` in edit mode, entering it first when the page is in view. A reload entry
  // leaves a one-shot receipt in session storage so the action runs once the page is
  // back; a refused entry says why and runs nothing.
  async function inEditMode(action, run) {
    if (currentMode() === "edit") return run();
    const storage = session();
    if (storage) storage.set(RESUME_KEY, action);
    let result;
    try {
      result = await clay().setMode?.("edit");
    } catch (err) {
      result = { ok: false, message: err && err.message };
    }
    if (result && result.ok !== false && result.reloading) return;
    if (storage) storage.remove(RESUME_KEY);
    if (!result || result.ok === false) {
      const text = result ? modeRefusalText(result) : "Couldn't switch modes.";
      if (text) note(text);
      return;
    }
    return run();
  }

  function resumable(action, run) {
    resumers.set(action, run);
    return () => inEditMode(action, run);
  }

  let history = { canUndo: false, canRedo: false };
  let heard = false;

  function renderUndo() {
    if (!pageWants("undo")) return;
    const live = currentMode() === "edit" && clay().undo;
    // The menu loads late, so edits made before it are read from the service itself.
    if (!heard && live && typeof live.canUndo === "boolean") history = { canUndo: live.canUndo, canRedo: !!live.canRedo };
    addItem({
      id: "clay.undo",
      pair: [
        {
          id: "clay.undo.undo",
          label: "Undo",
          keys: keys("⌘Z", "Ctrl+Z"),
          disabled: !(live && history.canUndo),
          run: () => clay().undo?.undo(),
        },
        {
          id: "clay.undo.redo",
          label: "Redo",
          keys: keys("⌘⇧Z", "Ctrl+Shift+Z"),
          disabled: !(live && history.canRedo),
          run: () => clay().undo?.redo(),
        },
      ],
    });
  }

  document.addEventListener("clay:undo-change", (event) => {
    const detail = event.detail || {};
    heard = true;
    history = { canUndo: !!detail.canUndo, canRedo: !!detail.canRedo };
    renderUndo();
  });
  document.addEventListener("clay:modechange", renderUndo);
  renderUndo();

  if (pageWants("ai-edit")) {
    addItem({
      id: "clay.ai",
      label: "Ask AI…",
      keys: keys("⌘J", "Ctrl+J"),
      run: resumable("ai", async () => {
        const ai = await whenPresent(() => clay().aiEdit);
        const opened = ai ? await ai.open(document.body) : false;
        if (!opened) note("Ask AI isn't available on this page right now.");
      }),
    });
  }

  if (pageWants("cms") && clay().cms?.hasRules?.(document)) {
    addItem({
      id: "clay.cms",
      label: "Open the CMS (Edit content)",
      run: resumable("cms", async () => {
        const cms = await whenPresent(() => clay().cms);
        let result = null;
        try {
          result = cms ? await cms.open() : { ok: false };
        } catch {
          result = { ok: false };
        }
        if (result && result.ok === false) note("Couldn't open the CMS. Try again.");
      }),
    });
  }

  // The copy is what a save would send now, unsaved edits included. A reader has no
  // unsaved edits, so the saved file is the same document.
  addItem({
    id: "clay.download",
    label: "Download a copy",
    run: async () => {
      let html = null;
      try {
        if (typeof clay().getHTML === "function") {
          html = clay().getHTML();
        } else {
          const response = await fetch(location.href, { cache: "no-store", credentials: "same-origin" });
          if (response.ok) html = await response.text();
        }
      } catch {}
      // Upload paths only resolve on this host, so the copy names them in full.
      if (typeof html === "string" && /^https?:$/.test(location.protocol)) {
        html = html.replace(/(^|[^\w./:-])\/_\/uploads\//g, `$1${location.origin}/_/uploads/`);
      }
      if (typeof html !== "string" || !downloadHtml({ html, name: `${documentName()}.html` })) {
        note("Couldn't build the download. Try again.");
      }
    },
  });

  // What the host offers for this document. A page opens in a new tab so this one keeps
  // whatever is unsaved; anything else the host does itself when asked, and may answer
  // with a page to open (a duplicate) or a reason it could not.
  async function askHost(url) {
    let body = null;
    try {
      const response = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "Document-URL": location.href } });
      body = await response.json().catch(() => null);
      if (response.ok && body?.ok !== false) {
        if (typeof body?.href === "string") window.open(body.href, "_blank", "noopener");
        return;
      }
    } catch {}
    note(typeof body?.message === "string" && body.message ? body.message : "Couldn't do that. Try again.");
  }

  const hostItem = (id, label, action) => {
    if (action?.href) addItem({ id, label, href: action.href });
    else if (action?.post) addItem({ id, label, run: () => askHost(action.post) });
  };

  import("../../core/host-meta.js")
    .then(({ hostActions }) => hostActions())
    .then((host) => {
      hostItem("clay.code", "Open the code editor", host.codeEditor);
      hostItem("clay.duplicate", "Duplicate as a new page", host.duplicate);
      hostItem("clay.export", "Export as zip", host.export);
      hostItem("clay.reveal", revealLabel(), host.reveal);
      hostItem("clay.versions", "Version history…", host.versions);
    })
    .catch(() => {});

  const storage = session();
  const pending = storage && storage.get(RESUME_KEY);
  if (pending) {
    storage.remove(RESUME_KEY);
    const run = resumers.get(pending);
    if (run && currentMode() === "edit") run();
  }

  return { inEditMode, resumable, refresh: renderUndo };
}
