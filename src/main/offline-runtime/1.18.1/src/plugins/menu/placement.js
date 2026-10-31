// Where the dock sits: one of four corners, chosen by dragging the grip or with its
// arrow keys, and remembered for this document in this browser.
const CORNERS = new Set(["top-left", "top-right", "bottom-left", "bottom-right"]);
const DRAG_START = 4;
const KEY = "menu-corner";

export function nearestCorner(x, y, width, height) {
  return `${y < height / 2 ? "top" : "bottom"}-${x < width / 2 ? "left" : "right"}`;
}

export function cornerAfterKey(corner, key) {
  let [v, h] = corner.split("-");
  if (key === "ArrowUp") v = "top";
  else if (key === "ArrowDown") v = "bottom";
  else if (key === "ArrowLeft") h = "left";
  else if (key === "ArrowRight") h = "right";
  else return null;
  return `${v}-${h}`;
}

export function savedCorner(storage) {
  let value = null;
  try {
    value = storage ? storage.get(KEY) : null;
  } catch {}
  return CORNERS.has(value) ? value : "top-right";
}

function makeSpots(container) {
  const spots = document.createElement("div");
  spots.className = "clay-menu-spots";
  spots.setAttribute("clay", "editor-ui");
  spots.setAttribute("aria-hidden", "true");
  for (const to of CORNERS) {
    const spot = document.createElement("span");
    spot.className = "clay-menu-spot";
    spot.dataset.to = to;
    spots.append(spot);
  }
  container.append(spots);
  return spots;
}

export function attachPlacement({ dock, container = document.body, grip, storage, onMove, onDragStart }) {
  function setCorner(corner, { remember = true } = {}) {
    dock.dataset.corner = corner;
    if (remember) {
      try {
        if (storage) storage.set(KEY, corner);
      } catch {}
    }
    if (onMove) onMove(corner);
  }

  setCorner(savedCorner(storage), { remember: false });

  grip.addEventListener("keydown", (event) => {
    const next = cornerAfterKey(dock.dataset.corner, event.key);
    if (!next) return;
    event.preventDefault();
    if (next !== dock.dataset.corner) setCorner(next);
  });

  let drag = null;

  grip.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    const rect = dock.getBoundingClientRect();
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
      w: rect.width,
      h: rect.height,
      moving: false,
      spots: null,
      near: null,
    };
    if (grip.setPointerCapture) {
      try {
        grip.setPointerCapture(event.pointerId);
      } catch {}
    }
  });

  grip.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    if (!drag.moving) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < DRAG_START) return;
      drag.moving = true;
      dock.setAttribute("data-dragging", "");
      drag.spots = makeSpots(container);
      drag.spots.style.setProperty("color-scheme", getComputedStyle(dock).colorScheme);
      if (onDragStart) onDragStart();
    }
    const left = event.clientX - drag.dx;
    const top = event.clientY - drag.dy;
    Object.assign(dock.style, { left: `${left}px`, top: `${top}px`, right: "auto", bottom: "auto" });
    drag.near = nearestCorner(left + drag.w / 2, top + drag.h / 2, window.innerWidth, window.innerHeight);
    for (const spot of drag.spots.children) spot.toggleAttribute("data-near", spot.dataset.to === drag.near);
  });

  const finish = (commit) => (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const { moving, near, spots } = drag;
    drag = null;
    if (!moving) return;
    spots.remove();
    dock.removeAttribute("data-dragging");
    for (const side of ["left", "top", "right", "bottom"]) dock.style.removeProperty(side);
    if (commit && near) setCorner(near);
    else setCorner(dock.dataset.corner, { remember: false });
  };
  grip.addEventListener("pointerup", finish(true));
  grip.addEventListener("pointercancel", finish(false));
  grip.addEventListener("lostpointercapture", finish(false));

  return { setCorner };
}
