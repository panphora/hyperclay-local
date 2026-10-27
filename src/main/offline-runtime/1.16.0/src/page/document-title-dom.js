import { documentTitle } from "./document-title.js";

const TITLE_MODE = "clay-seo-title-mode";

const headOf = (root) =>
  root?.nodeType === 9 ? root.head : root?.tagName === "HEAD" ? root : root?.querySelector?.("head") ?? null;

export function customTitle(root) {
  const head = headOf(root);
  if (!head) return false;
  for (const meta of head.querySelectorAll("meta")) {
    if ((meta.getAttribute("name") ?? "").trim().toLowerCase() !== TITLE_MODE) continue;
    if ((meta.getAttribute("content") ?? "").trim().toLowerCase() === "custom") return true;
  }
  return false;
}

export function titleText(root) {
  return headOf(root)?.querySelector("title")?.textContent ?? "";
}

export function writeTitle(root, text) {
  const head = headOf(root);
  if (!head) return false;
  const el = head.querySelector("title");
  if (el) {
    if (el.textContent === text) return false;
    el.textContent = text;
    return true;
  }
  const title = head.ownerDocument.createElement("title");
  title.textContent = text;
  head.insertBefore(title, head.firstChild);
  return true;
}

export function titleFor(root, items) {
  const custom = customTitle(root);
  return { custom, title: documentTitle(items, { custom, currentTitle: titleText(root) }) };
}
