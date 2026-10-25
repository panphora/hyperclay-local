import themodal, { SURFACE_THEME } from "./modal.js";
import onDomReady from "../lib/dom-ready.js";
import toast from "./toast.js";
import copyToClipboard from "../utils/copy-to-clipboard.js";
import { bevelBox, bevelButton, bevelInput, bevelText } from "./bevel-controls.js";
import { TOKENS, FONT_SANS, FONT_MONO } from "./bevel.js";
import { resolveTheme } from "./theme.js";

// Caller markup (promptText, extraContent, tell's paragraphs) goes in as it is: those
// are markup by design, and callers pass elements through them. Only the frame around
// it is ClayJS's to style. The prompt is the dialog's title, as in the dashboard.
function createModal(promptText, yesCallback, extraContent = "", includeInput = false, defaultValue = "", yesLabel = "OK") {
  const theme = resolveTheme();
  const content = bevelBox("div", ["display:flex", "flex-direction:column", "gap:14px", `font:14.5px/1.55 ${FONT_SANS}`, `color:${TOKENS["ink-2"]}`], { theme, parts: ["dialog.content"], role: "text" });
  let input = null;
  if (includeInput) {
    input = bevelInput("input", { rules: ["display:block", "width:100%", "margin:0"], theme, parts: ["dialog.input"] });
    input.setAttribute("value", String(defaultValue));
    input.required = true;
    content.append(input);
  }
  content.insertAdjacentHTML("beforeend", extraContent);

  themodal.title = promptText;
  themodal.html = includeInput || extraContent ? content : "";
  themodal.width = "440px";
  themodal[SURFACE_THEME] = theme;
  themodal.closeHtml = "x";
  themodal.no = "Cancel";
  themodal.yes = yesLabel;

  const promise = new Promise((resolve, reject) => {
    themodal.onYes(() => {
      let promptResult;
      if (includeInput) {
        promptResult = input.value;
        if (!promptResult) return false; // keep modal open on empty input
      }
      // Run the validation callback synchronously so a throw can keep the
      // modal open (callers rely on this — e.g. delete-site confirms by
      // throwing when the typed name doesn't match).
      if (yesCallback) {
        try {
          yesCallback(promptResult);
        } catch (err) {
          toast(err.message || 'An error occurred', 'error');
          return false; // keep modal open, user can retry
        }
      }
      // Defer resolve so downstream .then() handlers don't fire inside this
      // modal's onYes loop — themodal is a singleton, and chained ask()/
      // consent() calls need a clean themodal to set up their state.
      setTimeout(() => resolve(promptResult), 0);
      return true; // allow modal to close
    });

    themodal.onNo = () => {
      setTimeout(reject, 0);
    };
  });

  themodal.open();

  setTimeout(() => {
    const modalContainer = document.querySelector('[data-clay-modal]');
    if (modalContainer) {
      modalContainer.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-copy]');
        if (btn) {
          copyToClipboard(btn.dataset.copy);
          toast('Copied', 'success');
        }
      });
    }
  }, 0);

  // Fire-and-forget callers (e.g. consent(msg, cb) with no await) don't consume
  // the reject path; dismissal now rejects, so swallow it here to avoid an
  // unhandled rejection. Awaiters still observe the rejection via their await.
  promise.catch(() => {});

  return promise;
}

// Public API functions
export function ask(promptText, yesCallback, defaultValue = "", extraContent = "") {
  return createModal(promptText, yesCallback, extraContent, true, defaultValue, "OK");
}

export function consent(promptText, yesCallback, extraContent = "") {
  return createModal(promptText, yesCallback, extraContent, false, "", "Confirm");
}

/**
 * Display an informational modal with a title and optional content paragraphs
 * @param {string} promptText - The title/heading text
 * @param {...string} content - Additional content paragraphs (variadic)
 * @returns {Promise} Resolves when user confirms, rejects on close
 */
export function tell(promptText, ...content) {
  const theme = resolveTheme();
  const box = bevelBox("div", ["display:flex", "flex-direction:column", "gap:12px"], { theme, parts: ["dialog.content"] });
  for (const c of content) {
    const paragraph = bevelText("div", [`font:14.5px/1.55 ${FONT_SANS}`, `color:${TOKENS["ink-2"]}`, "overflow-wrap:anywhere"], undefined, { theme });
    paragraph.innerHTML = c;
    box.append(paragraph);
  }

  themodal.title = promptText;
  themodal.html = content.length ? box : "";
  themodal.width = "470px";
  themodal[SURFACE_THEME] = theme;
  themodal.closeHtml = "x";
  themodal.yes = "OK";

  const promise = new Promise((resolve, reject) => {
    themodal.onYes(() => {
      setTimeout(resolve, 0);
      return true;
    });

    themodal.onNo = () => {
      setTimeout(reject, 0);
    };
  });

  themodal.open();

  // See createModal: swallow the reject for fire-and-forget tell() callers;
  // awaiters still observe it via their await.
  promise.catch(() => {});

  return promise;
}

/**
 * Display a modal with a code snippet and copy functionality
 * @param {string} title - The modal heading
 * @param {string} content - The code to display
 * @param {string} extraContent - Optional raw HTML rendered below the copy button.
 *   Callers style their own container.
 */
export function snippet(title, content, extraContent = '') {
  const theme = resolveTheme();
  const box = bevelBox("div", ["display:block"], { theme, parts: ["dialog.content"] });
  const well = bevelBox("div", [
    "display:block", "max-width:100%", "overflow-x:auto", "margin:0 0 14px", "padding:14px 16px",
    `background:${TOKENS.sunk}`, `border:1px solid ${TOKENS["line-2"]}`,
  ], { theme, parts: ["dialog.well"], role: "well" });
  const pre = bevelText("pre", ["display:block", "margin:0", "white-space:nowrap", `font:13px/1.6 ${FONT_MONO}`], undefined, { theme, parts: ["dialog.code"], role: "code" });
  pre.innerHTML = content;
  well.append(pre);
  const copy = bevelButton("Copy", {
    small: true,
    extra: ["margin:0 0 14px"],
    theme, parts: ["dialog.button", "dialog.copyButton"], labelParts: ["dialog.buttonLabel"],
    onClick: () => {
      copyToClipboard(content);
      toast('Copied to clipboard!', 'success');
    },
  });
  box.append(well, copy);
  box.insertAdjacentHTML("beforeend", extraContent || "");

  themodal.title = title;
  themodal.html = box;
  themodal.width = "540px";
  themodal[SURFACE_THEME] = theme;
  themodal.closeHtml = "x";
  themodal.yes = '';

  const promise = new Promise((resolve) => {
    themodal.onYes(() => {
      setTimeout(resolve, 0);
      return true;
    });

    themodal.onNo = () => {
      setTimeout(resolve, 0);
    };
  });

  themodal.open();

  return promise;
}

// Auto-initialize - cleanup any leftover modal elements
export function init() {
  onDomReady(() => {
    const micromodalParentElem = document.querySelector("[data-clay-modal]");
    if (micromodalParentElem) {
      micromodalParentElem.remove();
      document.body.style.overflow = "";
    }
  });
}

// Auto-init when module is imported
init();
