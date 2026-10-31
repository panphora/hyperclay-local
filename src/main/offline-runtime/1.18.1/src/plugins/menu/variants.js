// Style variants: a document can carry several looks for the same markup, each a
// <style clay-variant="A">. The saved choice is the one block without media="not all",
// so it paints with no JavaScript. The pill in the dock lets an editor step through
// them: in edit mode a step is the saved choice, in view mode it previews this tab
// only. Keep deletes every other look, after which the page is an ordinary one-look
// document. A choice and Keep are undo entries and saves, like the SEO panel's Done.
import { modeRefusalText } from "../../core/mode-refusal.js";

const OFF = "not all";
const RECEIPT = "variants-choose";
const KEEP_ID = "clay.variants.keep";
const CHOOSE_LABEL = "Change the page look";
const KEEP_LABEL = "Keep one page look";

const PREV =
  '<svg viewBox="0 0 6 10" aria-hidden="true" focusable="false"><rect x="4" width="2" height="2"/><rect x="2" y="2" width="2" height="2"/>' +
  '<rect y="4" width="2" height="2"/><rect x="2" y="6" width="2" height="2"/><rect x="4" y="8" width="2" height="2"/></svg>';
const NEXT =
  '<svg viewBox="0 0 6 10" aria-hidden="true" focusable="false"><rect width="2" height="2"/><rect x="2" y="2" width="2" height="2"/>' +
  '<rect x="4" y="4" width="2" height="2"/><rect x="2" y="6" width="2" height="2"/><rect y="8" width="2" height="2"/></svg>';

export const looks = () => [...document.querySelectorAll("head style[clay-variant]")];
const nameOf = (style) => style.getAttribute("clay-variant");
const names = () => looks().map(nameOf);

// The first block without media="not all" is the saved choice. A merge or a hand edit
// can leave none or several; this tab paints the first one either way, and the next
// choice writes a clean state.
function savedName() {
  const all = looks();
  const on = all.find((style) => style.getAttribute("media") !== OFF);
  return on ? nameOf(on) : all.length ? nameOf(all[0]) : null;
}

// `<head>` changes are undo entries only inside a commit; outside one the history skips
// them and Cmd+Z takes back an earlier edit instead. A page without autosave saves its
// markup only when asked, so the choice is saved here.
function writeHead(label, change) {
  const undo = window.clay && window.clay.undo;
  if (undo && typeof undo.commit === "function") undo.commit(label, change);
  else change();
  if (!document.documentElement.hasAttribute("autosave") && typeof window.clay?.save === "function") window.clay.save();
}

// Until the boot baseline settles, a change to the document counts as load-time churn and
// becomes the saved state without ever being sent.
async function afterBaseline() {
  const save = await import("../../core/save.js");
  while (!save.baselineSettled()) {
    await new Promise((resolve) => document.addEventListener("clay:baseline-settled", resolve, { once: true }));
  }
}

function joinNames(list) {
  const named = list.map((name) => `Variant ${name}`);
  return named.length < 2 ? named.join("") : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
}

export function attachVariants({ root, capsule, addItem, removeItem, note, currentMode }) {
  let previewing = null;
  let pending = null;
  let copy = null;
  let pill = null;
  let drawn = null;

  const isEdit = () => currentMode() === "edit";
  const shown = () => previewing ?? savedName();
  const storage = () => window.clay && window.clay.storage && window.clay.storage.session;

  // Nothing here writes the file: the preview is an editor-ui copy of the previewed
  // look, and the saved look and any extra active look are switched off through the
  // CSSOM `disabled` flag, which is not an attribute.
  function paint() {
    const saved = savedName();
    if (previewing !== null && previewing === saved) previewing = null;
    copy?.remove();
    copy = null;
    for (const style of looks()) {
      if (!style.sheet) continue;
      const active = style.getAttribute("media") !== OFF;
      style.sheet.disabled = active && (nameOf(style) !== saved || previewing !== null);
    }
    if (previewing === null) return;
    const source = looks().find((style) => nameOf(style) === previewing);
    if (!source) {
      previewing = null;
      return paint();
    }
    copy = document.createElement("style");
    copy.setAttribute("clay", "editor-ui");
    copy.dataset.clayVariantPreview = previewing;
    copy.textContent = source.textContent;
    source.after(copy);
  }

  function announce() {
    document.dispatchEvent(new CustomEvent("clay:variant-change", { detail: { active: savedName(), shown: shown() } }));
  }

  function choose(name) {
    if (!isEdit()) return { ok: false, code: "not-editing" };
    if (!names().includes(name)) return { ok: false, code: "unknown-variant" };
    pending = previewing = null;
    writeHead(CHOOSE_LABEL, () => {
      for (const style of looks()) {
        if (nameOf(style) === name) style.removeAttribute("media");
        else if (style.getAttribute("media") !== OFF) style.setAttribute("media", OFF);
      }
    });
    refresh();
    return { ok: true };
  }

  function preview(name) {
    if (name !== null && !names().includes(name)) return { ok: false, code: "unknown-variant" };
    previewing = name;
    refresh();
    return { ok: true };
  }

  function keepNow(name) {
    pending = previewing = null;
    writeHead(KEEP_LABEL, () => {
      for (const style of looks()) {
        if (nameOf(style) === name) {
          style.removeAttribute("clay-variant");
          style.removeAttribute("media");
          if (style.sheet) style.sheet.disabled = false;
        } else {
          style.remove();
        }
      }
    });
    refresh();
  }

  function keep() {
    if (!isEdit()) return Promise.resolve({ ok: false, code: "not-editing" });
    const name = savedName();
    const others = names().filter((other) => other !== name);
    if (!others.length) return Promise.resolve({ ok: false, code: "unknown-variant" });
    const text = `Keep Variant ${name} and delete ${joinNames(others)}? The switcher goes away. Version history still has them.`;
    return import("../../ui/dialogs.js")
      .then((m) => m.consent(text))
      .then(
        () => {
          keepNow(name);
          return { ok: true };
        },
        () => ({ ok: false, code: "cancelled" })
      );
  }

  async function useShown() {
    const name = previewing;
    const clay = window.clay;
    if (name === null || !clay || typeof clay.setMode !== "function") return;
    // The receipt carries the choice across the reload into edit; a live entry never
    // leaves the page, so the mode change below picks it up and clears it.
    storage()?.set(RECEIPT, name);
    let result;
    try {
      result = await clay.setMode("edit");
    } catch (err) {
      result = { ok: false, message: err && err.message };
    }
    if (result && result.reloading) return;
    if (result && result.ok === false) {
      storage()?.remove(RECEIPT);
      const text = modeRefusalText(result);
      if (text) note(text);
    }
  }

  // The chosen look paints at once as a preview, and becomes the saved choice once the
  // boot baseline has settled, so it is sent as an edit.
  async function applyReceipt() {
    const store = storage();
    const name = store?.get(RECEIPT);
    if (name == null) return;
    store.remove(RECEIPT);
    if (!isEdit() || !names().includes(name)) return;
    pending = previewing = name;
    refresh();
    await afterBaseline();
    if (pending !== name || !current()) return;
    pending = null;
    if (isEdit() && names().includes(name)) choose(name);
  }

  function step(by) {
    const all = names();
    const target = all[(all.indexOf(shown()) + by + all.length) % all.length];
    if (isEdit()) choose(target);
    else preview(target);
  }

  function buildPill() {
    const node = document.createElement("div");
    node.className = "clay-variants";
    node.setAttribute("role", "group");
    node.setAttribute("aria-label", "Page look");
    node.innerHTML =
      `<button type="button" class="clay-variants-step" data-step="-1" aria-label="Previous look">${PREV}</button>` +
      `<span class="clay-variants-name" aria-live="polite"></span>` +
      `<button type="button" class="clay-variants-step" data-step="1" aria-label="Next look">${NEXT}</button>` +
      `<button type="button" class="clay-menu-btn clay-menu-btn-small clay-menu-btn-primary clay-variants-use" hidden>Use this look</button>` +
      `<button type="button" class="clay-menu-btn clay-menu-btn-small clay-variants-keep" hidden>Keep</button>`;
    for (const button of node.querySelectorAll(".clay-variants-step")) {
      button.addEventListener("click", () => step(Number(button.dataset.step)));
    }
    node.querySelector(".clay-variants-use").addEventListener("click", useShown);
    node.querySelector(".clay-variants-keep").addEventListener("click", () => keep());
    return node;
  }

  function draw() {
    const all = names();
    drawn = state();
    if (all.length < 2) {
      pill?.remove();
      pill = null;
      removeItem(KEEP_ID);
      return;
    }
    if (!pill) pill = buildPill();
    if (!pill.isConnected) root.insertBefore(pill, root.querySelector(".clay-roster") ?? capsule);
    const name = shown();
    const label = pill.querySelector(".clay-variants-name");
    label.textContent = `Variant ${name} `;
    const count = document.createElement("small");
    count.textContent = `(${all.indexOf(name) + 1}/${all.length})`;
    label.append(count);
    pill.querySelector(".clay-variants-use").hidden = isEdit() || previewing === null;
    pill.querySelector(".clay-variants-keep").hidden = !isEdit();
    if (isEdit()) addItem({ id: KEEP_ID, label: `Keep Variant ${savedName()}, remove the others…`, run: () => keep() });
    else removeItem(KEEP_ID);
  }

  function refresh() {
    paint();
    draw();
    announce();
  }

  const state = () => `${names().join(",")}|${savedName()}|${shown()}`;

  // Only the switcher behind the current clay.variants answers page events; one left from
  // an earlier boot of the same document would read and clear this tab's receipt.
  let api = null;
  const current = () => window.clay?.variants === api;

  document.addEventListener("clay:modechange", () => {
    if (!current()) return;
    if (isEdit()) {
      previewing = pending;
      applyReceipt();
    } else {
      pending = null;
    }
    refresh();
  });

  // A merge can rebuild a look block, which clears its CSSOM flag, or bring a peer's
  // choice or Keep; painting again settles all three.
  document.addEventListener("clay:sync-applied", () => {
    if (current()) refresh();
  });

  // An undo or redo of a choice or of Keep brings the blocks back or moves the saved one.
  // Every other entry leaves the looks alone, so only a change redraws and announces.
  document.addEventListener("clay:undo-change", () => {
    if (current() && state() !== drawn) refresh();
  });

  api = window.clay.variants = {
    list: () => {
      const active = savedName();
      return names().map((name) => ({ name, label: `Variant ${name}`, active: name === active }));
    },
    get active() {
      return savedName();
    },
    get shown() {
      return shown();
    },
    preview,
    choose,
    keep,
  };

  if (names().length >= 2) {
    if (isEdit()) applyReceipt();
    refresh();
  }
}
