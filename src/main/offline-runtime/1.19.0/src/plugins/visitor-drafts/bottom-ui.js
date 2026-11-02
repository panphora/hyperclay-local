export const BOTTOM_UI_CHANGED = "clay:bottom-ui-changed";

export function announceBottomUi() {
  document.dispatchEvent(new CustomEvent(BOTTOM_UI_CHANGED));
}

// ClayJS's own interfaces sit in shadow roots, where a hit test stops at the host, and the
// host takes no box of its own. So a hit on one looks inside it too.
function hitsAt(scope, x, y) {
  const hits = scope.elementsFromPoint ? scope.elementsFromPoint(x, y) : [];
  return hits
    .filter((hit) => hit.getRootNode() === scope)
    .flatMap((hit) => (hit.localName === "clay-editor-ui" && hit.shadowRoot ? hitsAt(hit.shadowRoot, x, y) : [hit]));
}

export function bottomBarHeight(x, skip) {
  const h = window.innerHeight;
  let raise = 0;
  for (const hit of hitsAt(document, x, h - 3)) {
    for (let el = hit; el && el !== document.body && el !== document.documentElement; el = el.parentElement ?? el.getRootNode().host) {
      if (skip(el)) break;
      const position = getComputedStyle(el).position;
      if (position === "fixed" || position === "sticky") {
        const height = Math.ceil(h - el.getBoundingClientRect().top);
        if (height < h / 3) raise = Math.max(raise, height);
        break;
      }
    }
  }
  return raise;
}

export function promptPanel(box) {
  const panel = document.querySelector('clay-editor-ui[data-clay-ui="download-prompt"]')?.shadowRoot.querySelector("#hcp:not([hidden])");
  if (!panel) return 0;
  const r = panel.getBoundingClientRect();
  if (!r.width || !r.height || r.right <= box.left || r.left >= box.right) return 0;
  return Math.ceil(window.innerHeight - r.top);
}
