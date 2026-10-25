export const BOTTOM_UI_CHANGED = "clay:bottom-ui-changed";

export function announceBottomUi() {
  document.dispatchEvent(new CustomEvent(BOTTOM_UI_CHANGED));
}

export function bottomBarHeight(x, skip) {
  const h = window.innerHeight;
  let raise = 0;
  const hits = document.elementsFromPoint ? document.elementsFromPoint(x, h - 3) : [];
  for (const hit of hits) {
    for (let el = hit; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
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
  const panel = document.querySelector("#hcp:not([hidden])");
  if (!panel) return 0;
  const r = panel.getBoundingClientRect();
  if (!r.width || !r.height || r.right <= box.left || r.left >= box.right) return 0;
  return Math.ceil(window.innerHeight - r.top);
}
