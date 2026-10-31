import { CLOSE_CSS, INTRO_CSS } from "./intro-style.js";
import { mountEditorUI } from "../../ui/editor-ui.js";
import { announceBottomUi } from "./bottom-ui.js";
import { bootPhase } from "../../core/boot-phase.js";

export const COPY = {
  close: "Hide this introduction",
  label: (appName) => `About ${appName}`,
};

const FOCUSABLE = "a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])";
const TEXT_ENTRY = "textarea, select";
const NON_TEXT_INPUT = ["checkbox", "radio", "button", "submit", "reset", "file"];

function isTextEntry(el) {
  if (el.isContentEditable || el.closest(TEXT_ENTRY)) return true;
  if (el.tagName !== "INPUT") return false;
  return NON_TEXT_INPUT.indexOf(el.type) < 0;
}

function forced() {
  try {
    return new URLSearchParams(window.location.search).get("intro") === "1";
  } catch {
    return false;
  }
}

function stylesOnce() {
  if (document.getElementById("clay-intro-style")) return;
  const style = document.createElement("style");
  style.id = "clay-intro-style";
  style.setAttribute("clay", "editor-ui");
  style.textContent = INTRO_CSS;
  document.head.appendChild(style);
}

function focusApp() {
  const next = [...document.querySelectorAll(FOCUSABLE)].find(
    (el) => !el.disabled && !isTextEntry(el) && !el.closest("[clay~='editor-ui']") && (typeof el.checkVisibility !== "function" || el.checkVisibility())
  );
  if (next) next.focus({ preventScroll: true });
  else document.body.focus({ preventScroll: true });
}

export function mountIntro({ memory, template, appName, hadDraft }) {
  if (!template || !template.content.textContent.trim() && !template.content.querySelector("img, svg, video, canvas")) return null;
  if (!forced()) {
    if (memory.get().intro.done || hadDraft) return null;
    if (bootPhase.servedHash) return null;
    if (window.matchMedia && window.matchMedia("print").matches) return null;
  }
  return mount({ memory, template, appName });
}

function mount({ memory, template, appName }) {
  stylesOnce();

  const section = document.createElement("section");
  section.className = "clay-intro";
  section.setAttribute("clay", "editor-ui");
  section.setAttribute("sap-ignore", "");
  section.setAttribute("aria-label", COPY.label(appName));
  section.appendChild(template.content.cloneNode(true));

  const close = document.createElement("button");
  close.type = "button";
  close.className = "clay-intro__close";
  close.setAttribute("aria-label", COPY.close);
  close.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><path d="M1.4 0 6 4.6 10.6 0 12 1.4 7.4 6 12 10.6 10.6 12 6 7.4 1.4 12 0 10.6 4.6 6 0 1.4z"/></svg>';
  close.addEventListener("click", () => dismiss("closed"));
  mountEditorUI({ name: "intro-close", content: close, css: [CLOSE_CSS], parent: section });

  let gone = false;
  let frame = 0;

  function dismiss(reason) {
    if (gone) return;
    gone = true;
    removeEventListener("scroll", onScroll);
    if (frame) cancelAnimationFrame(frame);
    const height = section.getBoundingClientRect().height;
    const before = window.scrollY;
    memory.get().intro.done = reason;
    memory.save();
    section.remove();
    if (reason === "scrolled") {
      const locked = /hidden|clip/.test(getComputedStyle(document.body).overflowY + getComputedStyle(document.documentElement).overflowY);
      window.scrollTo(0, locked ? 0 : Math.max(0, before - height));
    }
    announceBottomUi();
    if (reason !== "scrolled") focusApp();
  }

  function onScroll() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const bottom = section.getBoundingClientRect().bottom;
      const atEnd = scrollY > 0 && scrollY + innerHeight >= document.documentElement.scrollHeight - 1;
      if (bottom < 1 || (atEnd && bottom < innerHeight)) dismiss("scrolled");
    });
  }

  section.addEventListener("click", (event) => {
    if (event.target.closest("[visitor-intro-dismiss]")) {
      dismiss("closed");
      return;
    }
    if (event.target.closest("[visitor-intro-start]")) {
      event.preventDefault();
      window.scrollTo({ top: window.scrollY + section.getBoundingClientRect().bottom, behavior: "smooth" });
    }
  });

  document.body.prepend(section);
  announceBottomUi();
  addEventListener("scroll", onScroll, { passive: true });

  return section;
}
