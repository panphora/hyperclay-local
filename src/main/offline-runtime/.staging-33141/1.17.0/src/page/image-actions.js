// The image menu's own actions: the alt text field and the width presets, reached
// by the chrome's actions menu. Its own module, so a document that never sets
// either downloads neither.
import { asStep } from "./blocksel.js";

const indexOfId = (doc, id) => {
  let found = -1;
  doc.forEach((n, _, i) => { if (n.attrs.id === id) found = i; });
  return found;
};

export function setImageAttrs(view, id, patch) {
  const st = view.state;
  const index = indexOfId(st.doc, id);
  if (index < 0) return false;
  let at = 0;
  for (let i = 0; i < index; i++) at += st.doc.child(i).nodeSize;
  const node = st.doc.child(index);
  view.dispatch(asStep(st.tr.setNodeMarkup(at, null, { ...node.attrs, ...patch })));
  return true;
}

export function openAltEditor(view, id) {
  const index = indexOfId(view.state.doc, id);
  if (index < 0) return false;
  const shell = view.dom.parentElement;
  const doc = shell.ownerDocument;
  let at = 0;
  for (let i = 0; i < index; i++) at += view.state.doc.child(i).nodeSize;
  const box = doc.createElement("div");
  box.className = "page-link";
  box.dataset.mode = "alt";
  const input = doc.createElement("input");
  input.className = "page-link-input";
  input.type = "text";
  input.value = view.state.doc.child(index).attrs.alt || "";
  input.placeholder = "Describe the image";
  input.setAttribute("aria-label", "Alt text");
  box.append(input);
  const rect = view.nodeDOM(at)?.getBoundingClientRect?.();
  const shellBox = shell.getBoundingClientRect();
  if (rect) {
    box.style.setProperty("--page-pop-x", `${rect.left - shellBox.left}px`);
    box.style.setProperty("--page-pop-y", `${rect.bottom - shellBox.top + 6}px`);
  }
  shell.append(box);
  let done = false;
  const close = (commit, refocus = true) => {
    if (done) return;
    done = true;
    const value = input.value.trim();
    box.remove();
    const i = indexOfId(view.state.doc, id);
    if (commit && i >= 0 && value !== view.state.doc.child(i).attrs.alt) setImageAttrs(view, id, { alt: value });
    if (refocus) view.focus();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); close(true); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(false); }
  });
  input.addEventListener("blur", () => close(true, false));
  input.focus();
  return true;
}
