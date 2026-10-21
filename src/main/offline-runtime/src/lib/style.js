import { insertStyles, getStyleBaseUrl } from "../dom/insert-style-tag.js";
import Mutation from "./mutation.js";
import { adoptStyleComparisons } from "./style-adoption.js";

// A style a script owns. The tag saves with the page, so the next load paints
// styled before any script runs. Each call writes the current CSS into the saved
// tag in place (or points the saved <link> at the current href), so a page saved
// by an older script picks up newer styles. The tag is no-dirty: an update is
// carried by the next real save and never counts as an edit, starts an autosave
// or raises the close warning.
const markNoDirty = (el) => {
  const tokens = (el.getAttribute("clay") ?? "").split(/\s+/).filter(Boolean);
  if (!tokens.includes("no-dirty")) el.setAttribute("clay", [...tokens, "no-dirty"].join(" "));
};

export function style(nameOrHref, css) {
  return writeStyle(nameOrHref, css);
}

export function styleWithLegacyId(name, css, legacyId) {
  return writeStyle(name, css, legacyId);
}

function writeStyle(nameOrHref, css, legacyId) {
  const inline = typeof css === "string";
  const identity = inline ? { name: nameOrHref, legacyId } : { href: getStyleBaseUrl(nameOrHref) };
  const legacy = legacyId === undefined ? [] : document.querySelectorAll(`style[id="${legacyId}"]:not([data-name])`);
  Mutation.pause();
  try {
    adoptStyleComparisons(identity);
    for (const el of legacy) el.dataset.name = nameOrHref;
    if (inline) {
      const el = insertStyles(nameOrHref, css, markNoDirty);
      if (legacyId !== undefined) el.id = legacyId;
      return el;
    }
    return insertStyles(nameOrHref, (link) => {
      markNoDirty(link);
      if (link.getAttribute("href") !== nameOrHref) link.setAttribute("href", nameOrHref);
    });
  } finally {
    Mutation.resume();
  }
}
