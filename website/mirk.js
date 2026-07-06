/*
 * mirk.js — the delegated runtime for the mirk UI kit, v2.
 * https://github.com/panphora/mirk-interface
 *
 * One listener per interaction on `document`. No init(), no MutationObserver:
 * every current AND future element is handled, so injected / re-rendered /
 * saved-and-reopened markup just works. Idempotent; safe to include twice.
 *
 * The markup carries the initial state — chips are real DOM, the slider fill is
 * an inline --mirk-value, native inputs hold their own value — so the page is
 * correct before this script runs. JS only enhances the transitions.
 */
(function () {
  if (window.__mirk) return;
  window.__mirk = true;

  // Crisp × for remove affordances — a font glyph renders at a different weight
  // and baseline in every typeface, so draw it as a tiny square-capped vector.
  const X_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4 12 12M12 4 4 12" stroke="currentColor" stroke-width="2" stroke-linecap="square" fill="none"/></svg>';

  // Number stepper — bevel buttons drive the native input.
  document.addEventListener("click", (e) => {
    const step = e.target.closest(".mirk-number__step");
    if (!step) return;
    const input = step.closest(".mirk-number").querySelector("input[type=number]");
    if (!input) return;
    step.dataset.step === "up" ? input.stepUp() : input.stepDown();
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  // Slider — mirror the value into --mirk-value on the wrapper (fill width + nub
  // left both read it). The markup ships an inline --mirk-value matching value=,
  // so the fill is correct before this runs; this only handles dragging.
  document.addEventListener("input", (e) => {
    const input = e.target.closest(".mirk-slider__input");
    if (!input) return;
    input.closest(".mirk-slider").style.setProperty("--mirk-value", `${input.value}%`);
  });

  // File picker — show the chosen file as a link to it, with a × to clear. The kit
  // has no upload, so the link is a local object URL; an app swaps in the uploaded
  // URL. State lives in the input's files.
  document.addEventListener("change", (e) => {
    const input = e.target.closest(".mirk-file__input");
    if (!input || !input.files.length) return;
    const root = input.closest(".mirk-file");
    const slot = root.querySelector(".mirk-file__name");
    if (!slot) return;
    const file = input.files[0];
    const link = document.createElement("a");
    link.className = "mirk-file__name";
    link.dataset.filled = "";
    link.href = URL.createObjectURL(file);
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = file.name;
    slot.replaceWith(link);
    if (!root.querySelector(".mirk-file__remove")) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "mirk-file__remove";
      remove.setAttribute("aria-label", "Remove file");
      remove.innerHTML = X_SVG;
      link.after(remove);
    }
  });

  // Image input — FileReader thumbnail preview.
  document.addEventListener("change", (e) => {
    const input = e.target.closest(".mirk-image__input");
    if (!input || !input.files.length) return;
    const root = input.closest(".mirk-image");
    const preview = root.querySelector(".mirk-image__preview");
    if (!preview) return;
    const placeholder = root.querySelector(".mirk-image__placeholder");
    const reader = new FileReader();
    reader.onload = (ev) => {
      preview.src = ev.target.result;
      preview.removeAttribute("hidden");
      if (placeholder) placeholder.setAttribute("hidden", "");
      // compact variant: swap the upload button for the thumbnail
      root.querySelector(".mirk-image__thumb")?.removeAttribute("hidden");
      root.querySelector(".mirk-image__upload")?.setAttribute("hidden", "");
    };
    reader.readAsDataURL(input.files[0]);
  });

  // File / image remove — clear the field and return to the empty state.
  document.addEventListener("click", (e) => {
    const fileRemove = e.target.closest(".mirk-file__remove");
    if (fileRemove) {
      const root = fileRemove.closest(".mirk-file");
      const input = root?.querySelector(".mirk-file__input");
      const link = root?.querySelector(".mirk-file__name");
      if (input) input.value = "";
      if (link) {
        const span = document.createElement("span");
        span.className = "mirk-file__name";
        span.textContent = "No file chosen";
        link.replaceWith(span);
      }
      fileRemove.remove();
      return;
    }
    const imageRemove = e.target.closest(".mirk-image__remove");
    if (imageRemove) {
      const root = imageRemove.closest(".mirk-image");
      const input = root?.querySelector(".mirk-image__input");
      const preview = root?.querySelector(".mirk-image__preview");
      if (input) input.value = "";
      if (preview) { preview.removeAttribute("src"); preview.setAttribute("hidden", ""); }
      root?.querySelector(".mirk-image__thumb")?.setAttribute("hidden", "");
      root?.querySelector(".mirk-image__upload")?.removeAttribute("hidden");
    }
  });

  // Tags — Enter / comma adds a real chip, × or Backspace-on-empty removes one.
  // Chips are DOM elements (and carry a hidden input), so outerHTML keeps them.
  function makeChip(value, round) {
    const text = document.createElement("span");
    text.textContent = value;
    const hidden = document.createElement("input");
    hidden.type = "hidden"; hidden.name = "tags[]"; hidden.value = value;
    const remove = document.createElement("button");
    remove.type = "button"; remove.className = "mirk-tags__remove"; remove.textContent = "×";

    const chip = document.createElement("span");
    chip.className = "mirk-tags__chip";
    if (round) {
      const inner = document.createElement("span");
      inner.className = "mirk-tags__chip-inner";
      inner.append(text, hidden, remove);
      chip.append(inner);
    } else {
      chip.append(text, hidden, remove);
    }
    return chip;
  }

  document.addEventListener("keydown", (e) => {
    const input = e.target.closest(".mirk-tags__input");
    if (!input) return;
    const tags = input.closest(".mirk-tags");
    if (e.key === "Enter" || e.key === ",") {
      const value = input.value.trim();
      if (!value) return;
      e.preventDefault();
      input.before(makeChip(value, tags.classList.contains("mirk-tags--round")));
      input.value = "";
    } else if (e.key === "Backspace" && !input.value) {
      const chips = tags.querySelectorAll(".mirk-tags__chip");
      chips[chips.length - 1]?.remove();
    }
  });

  document.addEventListener("click", (e) => {
    const remove = e.target.closest(".mirk-tags__remove");
    if (remove) { remove.closest(".mirk-tags__chip").remove(); return; }
    const tags = e.target.closest(".mirk-tags");
    if (tags && e.target === tags) tags.querySelector(".mirk-tags__input")?.focus();
  });

  // Collapsible chip — open the panel, collapse back to the chip, toggle the
  // before/after field table. State lives in classes on the markup, so a
  // saved-and-reopened chip keeps whatever it was; this only flips them live.
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-mirk-chip]");
    if (!t) return;
    const action = t.getAttribute("data-mirk-chip");
    if (action === "open") t.closest(".mirk-chip")?.classList.add("mirk-chip--open");
    else if (action === "collapse") t.closest(".mirk-chip")?.classList.remove("mirk-chip--open");
    else if (action === "changes") {
      const on = t.closest(".mirk-chip__panel")?.classList.toggle("is-changes");
      t.textContent = on ? "(hide changes)" : "(view changes)";
    }
  });

  // Copy button — delegated so dynamically-added buttons work too.
  // [data-copy]         copies the component's innerHTML (clean markup).
  // [data-copy="text"]  copies textContent (for <pre>/<code> source blocks
  //                     whose displayed HTML must paste as raw characters).
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-copy-btn]");
    if (!btn) return;
    const copyable = btn.closest("[data-copy]");
    if (!copyable) return;

    const clone = copyable.cloneNode(true);
    clone.querySelectorAll("[data-copy-btn]").forEach((b) => b.remove());

    const mode = copyable.getAttribute("data-copy");
    const payload = mode === "text"
      ? clone.textContent.replace(/^\s+|\s+$/g, "")
      : clone.innerHTML
          .replace(/\s+data-copy(="[^"]*")?/g, "")
          .replace(/^\s*\n/gm, "")
          .trim();

    navigator.clipboard.writeText(payload).then(() => {
      const original = btn.textContent;
      btn.textContent = "copied";
      btn.dataset.copied = "";
      setTimeout(() => { btn.textContent = original; delete btn.dataset.copied; }, 1200);
    }).catch(() => {
      btn.textContent = "error";
      setTimeout(() => { btn.textContent = "copy"; }, 1200);
    });
  });
})();
