// The checklist's decoration: the owner and due chips on every check item. It
// loads the first time a document holds or takes one, through the view hooks, so a
// document with no checklist never fetches it. The keymap stays in checklist.js.
import { view as pmView } from "../../vendor/prosemirror.vendor.js";
import { schema } from "../schema.js";
import { asStep } from "../blocksel.js";
import { addViewHook } from "../view-hooks.js";

const { Decoration, DecorationSet } = pmView;

// The owner chips draw the same initials face a board card does. These two are the
// parts of that face this module needs, kept here so the checklist part does not
// share a chunk with the board's parts and cost the board its one request.
const el = (doc, tag, cls, attrs = {}, text = null) => {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  for (const [key, value] of Object.entries(attrs)) if (value !== null && value !== undefined && value !== false) node.setAttribute(key, value === true ? "" : String(value));
  if (text !== null) node.textContent = text;
  return node;
};

const cardFace = (doc, name) => el(doc, "span", "page-board-face", { "aria-hidden": "true" }, ([...String(name).trim()][0] ?? "?").toUpperCase());

function itemAt(view, id) {
  let found = null;
  view.state.doc.forEach((node, pos) => { if (node.attrs.id === id && node.type === schema.nodes.list_item && node.attrs.kind === "check") found = { node, pos }; });
  return found;
}

function setItem(view, id, attr, value) {
  const found = itemAt(view, id);
  if (!found) return;
  view.dispatch(asStep(view.state.tr.setNodeMarkup(found.pos, null, { ...found.node.attrs, [attr]: value || null })));
}

// The design's three line icons, at the editor's 16px stroke-1.5 drawing.
const ICONS = {
  person: '<circle cx="8" cy="5.4" r="2.3"/><path d="M3.6 13.2c.6-2.1 2.2-3.3 4.4-3.3s3.8 1.2 4.4 3.3"/>',
  calendar: '<rect x="2.5" y="3.5" width="11" height="10"/><path d="M2.5 6.8h11M5.5 2v2.4M10.5 2v2.4"/>',
  clock: '<circle cx="8" cy="8" r="5.5"/><path d="M8 4.8v3.4l2.3 1.4"/>',
  tick: '<path d="M3.5 8.3l3 3 6-6.2"/>',
  plus: '<path d="M8 3.5v9M3.5 8h9"/>',
  clear: '<path d="M4.8 4.8l6.4 6.4M11.2 4.8l-6.4 6.4"/>',
  "chevron-left": '<path d="M9.8 3.6L5.4 8l4.4 4.4"/>',
  "chevron-right": '<path d="M6.2 3.6L10.6 8l-4.4 4.4"/>',
};

function icon(doc, paths) {
  const node = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  node.setAttribute("viewBox", "0 0 16 16");
  node.setAttribute("width", "14");
  node.setAttribute("height", "14");
  node.setAttribute("fill", "none");
  node.setAttribute("stroke", "currentColor");
  node.setAttribute("stroke-width", "1.5");
  node.setAttribute("stroke-linecap", "round");
  node.setAttribute("stroke-linejoin", "round");
  node.setAttribute("aria-hidden", "true");
  node.innerHTML = paths;
  return node;
}

// A tag's words. Today, tomorrow and a short date for the day, as a board card
// reads its own due badge (board-view.js), with the one word a tag needs that the
// badge never shows.
const pad = (n) => String(n).padStart(2, "0");
const DUE = /^\d{4}-\d{2}-\d{2}$/;
const todayKey = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const dayAfter = (key) => {
  const day = new Date(`${key}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
};
function dueLabel(due, today) {
  if (!due) return "No date";
  if (!DUE.test(due)) return due;
  if (due === today) return "Today";
  if (due === dayAfter(today)) return "Tomorrow";
  const sameYear = due.slice(0, 4) === today.slice(0, 4);
  return new Date(`${due}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" });
}

function tag(doc, { name, paths, label, aria, filled, overdue = false }) {
  const button = el(doc, "button", "page-check-chip", {
    type: "button",
    "data-check": name,
    "data-filled": String(filled),
    "data-overdue": overdue ? "true" : null,
    "aria-expanded": "false",
    "aria-label": aria,
  });
  button.append(icon(doc, paths), el(doc, "span", "page-check-chip-label", {}, label));
  return button;
}

// The floating panels: one is open at a time, and it hangs off the tag that opened
// it, right edges aligned, flipping above the tag when there is no room below. Escape
// closes it and hands focus back to the tag; a resize or a scroll moves it with the
// tag; a mousedown outside closes it.
let openPopup = null;

function popup(view, anchor, { className, label, check, onKey = null }) {
  const doc = anchor.ownerDocument;
  const win = doc.defaultView;
  if (openPopup) openPopup.close();
  for (const node of doc.querySelectorAll(".page-check-popup")) node.remove();
  const parent = view.dom.parentNode;
  const anchored = ["relative", "absolute", "fixed", "sticky"].includes(win?.getComputedStyle?.(parent)?.position ?? "");
  const placement = parent && anchored ? parent : doc.body;
  const panel = el(doc, "div", `page-check-popup ${className}`, { role: "dialog", "aria-label": label, "data-check": check });
  let closed = false;
  const place = () => {
    const ring = anchor.getBoundingClientRect();
    const base = placement === doc.body ? { top: -(win?.scrollY ?? 0), left: -(win?.scrollX ?? 0) } : placement.getBoundingClientRect();
    const box = panel.getBoundingClientRect();
    const width = box.width || Math.min(264, (win?.innerWidth || 292) - 28);
    const room = (win?.innerHeight ?? 0) - ring.bottom - 2;
    const flip = box.height > 0 && room < box.height;
    panel.style.left = `${Math.round(ring.right - width - base.left)}px`;
    panel.style.top = `${Math.round((flip ? ring.top - box.height - 2 : ring.bottom + 2) - base.top)}px`;
  };
  const outside = (event) => {
    if (!panel.isConnected) return close();
    if (panel.contains(event.target) || anchor.contains(event.target)) return;
    close();
  };
  const close = ({ focusAnchor = false } = {}) => {
    if (closed) return;
    closed = true;
    doc.removeEventListener("mousedown", outside, true);
    win?.removeEventListener("resize", place);
    win?.removeEventListener("scroll", place, true);
    if (openPopup?.panel === panel) openPopup = null;
    panel.remove();
    anchor.setAttribute("aria-expanded", "false");
    const fromKeys = anchor.dataset.fromKeys === "true";
    delete anchor.dataset.fromKeys;
    if (focusAnchor && fromKeys) view.focus();
    else if (focusAnchor) anchor.focus();
  };
  panel.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); close({ focusAnchor: true }); return; }
    onKey?.(event, panel);
  });
  placement.append(panel);
  anchor.setAttribute("aria-expanded", "true");
  openPopup = { panel, close: () => close() };
  doc.addEventListener("mousedown", outside, true);
  win?.addEventListener("resize", place);
  win?.addEventListener("scroll", place, true);
  return { panel, close, place };
}

function peopleIn(view, extra) {
  const found = new Map();
  view.state.doc.forEach((node) => {
    if (node.type !== schema.nodes.list_item || node.attrs.kind !== "check") return;
    const name = String(node.attrs.owner ?? "").trim();
    if (!name) return;
    const key = name.toLowerCase();
    const entry = found.get(key) ?? { name, count: 0 };
    entry.count += 1;
    found.set(key, entry);
  });
  for (const person of extra ?? []) {
    const name = String((typeof person === "string" ? person : person?.name) ?? "").trim();
    if (name && !found.has(name.toLowerCase())) found.set(name.toLowerCase(), { name, count: 0 });
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// The assignee panel: the document's people with their check-item counts, a name
// box for anyone new, and a row that clears the owner.
function ownerPicker(view, id, anchor) {
  const doc = anchor.ownerDocument;
  const current = itemAt(view, id)?.node.attrs.owner || "";
  const { panel, close, place } = popup(view, anchor, {
    className: "page-check-owner",
    label: "Assignee",
    check: "owner-panel",
    onKey: (event, panel) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const stops = [...panel.querySelectorAll("input, button:not([disabled])")];
      const at = stops.indexOf(doc.activeElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = at < 0 ? (step > 0 ? stops[0] : stops[stops.length - 1]) : stops[(at + step + stops.length) % stops.length];
      next?.focus();
    },
  });
  const input = el(doc, "input", "page-check-search", { type: "text", placeholder: "Find or type a name", "aria-label": "Find or type a name" });
  const list = el(doc, "div", "page-check-people");
  const remove = el(doc, "button", "page-check-person page-check-danger", { type: "button", "data-check": "clear-owner" });
  remove.append(icon(doc, ICONS.clear), el(doc, "span", "page-check-person-name", {}, "Remove assignee"));
  remove.disabled = !current;
  remove.addEventListener("click", () => choose(null));
  panel.append(input, el(doc, "div", "page-check-subhead", {}, "People in this document"), list, el(doc, "div", "page-check-divider"), remove);
  let available = [];
  const choose = (name) => { close(); setItem(view, id, "owner", name); };
  const personRow = (name, count) => {
    const selected = name.toLowerCase() === String(current).toLowerCase();
    const row = el(doc, "button", "page-check-person", { type: "button", "data-check": "owner-option", "data-name": name, "aria-pressed": String(selected) });
    row.append(cardFace(doc, name), el(doc, "span", "page-check-person-name", {}, name), el(doc, "span", "page-check-person-meta", {}, `${count} ${count === 1 ? "item" : "items"}`));
    if (selected) row.append(icon(doc, ICONS.tick));
    row.addEventListener("click", () => choose(name));
    return row;
  };
  const addRow = (name) => {
    const row = el(doc, "button", "page-check-person", { type: "button", "data-check": "owner-new", "data-name": name });
    const label = el(doc, "span", "page-check-person-name", {}, "Assign to ");
    label.append(el(doc, "strong", null, {}, name));
    row.append(icon(doc, ICONS.plus), label, el(doc, "span", "page-check-person-meta", {}, "New"));
    row.addEventListener("click", () => choose(name));
    return row;
  };
  const draw = () => {
    const typed = input.value.trim();
    const needle = typed.toLowerCase();
    const people = peopleIn(view, available);
    const rows = [];
    if (typed && !people.some((person) => person.name.toLowerCase() === needle)) rows.push(addRow(typed));
    for (const person of people) {
      if (needle && !person.name.toLowerCase().includes(needle)) continue;
      rows.push(personRow(person.name, person.count));
    }
    list.replaceChildren(...rows);
  };
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); close({ focusAnchor: true }); return; }
    if (event.key !== "Enter") return;
    event.preventDefault();
    list.querySelector("button[data-check]")?.click();
  });
  input.addEventListener("input", draw);
  draw();
  place();
  input.focus();
  const source = globalThis.clay?.people?.available;
  if (source) Promise.resolve().then(() => source()).then((names) => { if (!openPopup || openPopup.panel !== panel) return; available = Array.isArray(names) ? names : []; draw(); }).catch(() => {});
}

// A day of the local calendar, its ISO key, and the words a quick row and a day
// button read it in.
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const dateOf = (year, month, day) => new Date(year, month, day);
const shortDay = (day) => day.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const longDay = (day) => day.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
const dueDate = (key) => {
  if (!key || !DUE.test(key)) return null;
  const [year, month, day] = key.split("-").map(Number);
  return dateOf(year, month - 1, day);
};

// The due date panel: three quick days, a compact month calendar, and a row that
// clears the date. The calendar opens on the month of the item's own date, or on
// this month when it has none.
function datePicker(view, id, anchor) {
  const doc = anchor.ownerDocument;
  const current = itemAt(view, id)?.node.attrs.due || null;
  const today = todayKey();
  const clock = new Date();
  const now = dateOf(clock.getFullYear(), clock.getMonth(), clock.getDate());
  const opened = dueDate(current) ?? now;
  let year = opened.getFullYear();
  let month = opened.getMonth();

  const { panel, close, place } = popup(view, anchor, {
    className: "page-check-date",
    label: "Due date",
    check: "date-panel",
    onKey: (event, panel) => gridKey(event, panel),
  });
  const pick = (key) => { close(); setItem(view, id, "due", key); };

  const quick = el(doc, "div", "page-check-quick");
  const quickRow = (label, offset) => {
    const day = dateOf(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const row = el(doc, "button", "page-check-quick-row", { type: "button", "data-check": "date-quick", "data-date": todayKey(day) });
    row.append(icon(doc, ICONS.calendar), el(doc, "span", "page-check-quick-label", {}, label), el(doc, "span", "page-check-quick-meta", {}, shortDay(day)));
    row.addEventListener("click", () => pick(todayKey(day)));
    return row;
  };
  quick.append(quickRow("Today", 0), quickRow("Tomorrow", 1), quickRow("Next week", 7));

  const calendar = el(doc, "div", "page-check-cal");
  const head = el(doc, "div", "page-check-cal-head");
  const monthLabel = el(doc, "span", "page-check-cal-month");
  const nav = el(doc, "span", "page-check-cal-nav");
  const step = (by) => {
    const moved = dateOf(year, month + by, 1);
    year = moved.getFullYear();
    month = moved.getMonth();
    draw();
  };
  const previous = el(doc, "button", "page-check-cal-btn", { type: "button", "aria-label": "Previous month" });
  const next = el(doc, "button", "page-check-cal-btn", { type: "button", "aria-label": "Next month" });
  previous.append(icon(doc, ICONS["chevron-left"]));
  next.append(icon(doc, ICONS["chevron-right"]));
  previous.addEventListener("click", () => step(-1));
  next.addEventListener("click", () => step(1));
  nav.append(previous, next);
  head.append(monthLabel, nav);
  const grid = el(doc, "div", "page-check-cal-grid");
  calendar.append(head, grid);

  const draw = () => {
    monthLabel.replaceChildren(el(doc, "span", null, {}, `${MONTHS[month]} `), el(doc, "span", "page-check-cal-year", {}, String(year)));
    const first = dateOf(year, month, 1);
    const days = dateOf(year, month + 1, 0).getDate();
    const cells = Math.ceil((first.getDay() + days) / 7) * 7;
    const heads = ["S", "M", "T", "W", "T", "F", "S"].map((letter) => el(doc, "span", "page-check-cal-dow", {}, letter));
    const buttons = [];
    for (let i = 0; i < cells; i += 1) {
      const day = dateOf(year, month, 1 - first.getDay() + i);
      const key = todayKey(day);
      const button = el(doc, "button", "page-check-cal-day", {
        type: "button",
        "data-check": "date-day",
        "data-date": key,
        "data-outside": String(day.getMonth() !== month),
        "data-today": String(key === today),
        "aria-pressed": String(key === current),
        "aria-label": longDay(day),
      }, String(day.getDate()));
      button.addEventListener("click", () => pick(key));
      buttons.push(button);
    }
    grid.replaceChildren(...heads, ...buttons);
  };

  const gridKey = (event, panel) => {
    const button = doc.activeElement?.closest?.('[data-check="date-day"]');
    if (!button) return;
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); button.click(); return; }
    const move = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (!move) return;
    event.preventDefault();
    const from = dueDate(button.dataset.date);
    const day = dateOf(from.getFullYear(), from.getMonth(), from.getDate() + move);
    if (day.getMonth() !== month || day.getFullYear() !== year) {
      year = day.getFullYear();
      month = day.getMonth();
      draw();
    }
    panel.querySelector(`[data-check="date-day"][data-date="${todayKey(day)}"]`)?.focus();
  };

  const clear = el(doc, "button", "page-check-quick-row page-check-danger", { type: "button", "data-check": "clear-date" });
  clear.append(icon(doc, ICONS.clear), el(doc, "span", "page-check-quick-label", {}, "Clear date"));
  clear.disabled = !current;
  clear.addEventListener("click", () => pick(null));

  panel.append(quick, calendar, el(doc, "div", "page-check-divider"), clear);
  draw();
  place();
  (grid.querySelector('[data-check="date-day"][aria-pressed="true"]') ?? grid.querySelector('[data-check="date-day"][data-today="true"]'))?.focus();
}

function controls(view, node) {
  const doc = view.dom.ownerDocument;
  const box = doc.createElement("span");
  box.className = "page-check-controls";
  box.contentEditable = "false";
  box.dataset.empty = String(!node.attrs.owner && !node.attrs.due);
  const today = todayKey();
  const ownerName = node.attrs.owner || "Unassigned";
  const owner = tag(doc, { name: "owner", paths: ICONS.person, label: ownerName, aria: `Assignee: ${ownerName}`, filled: !!node.attrs.owner });
  const dateName = dueLabel(node.attrs.due, today);
  const overdue = !!node.attrs.due && !node.attrs.checked && DUE.test(node.attrs.due) && node.attrs.due < today;
  const date = tag(doc, { name: "date", paths: overdue ? ICONS.clock : ICONS.calendar, label: dateName, aria: `Due date: ${dateName}`, filled: !!node.attrs.due, overdue });
  owner.addEventListener("click", () => ownerPicker(view, node.attrs.id, owner));
  date.addEventListener("click", () => datePicker(view, node.attrs.id, date));
  box.append(owner, date);
  return box;
}

export function focusControl(view, name) {
  const $pos = view.state.selection.$head;
  if ($pos.depth !== 1 || $pos.parent.type !== schema.nodes.list_item || $pos.parent.attrs.kind !== "check") return false;
  const id = $pos.parent.attrs.id;
  const widget = [...view.dom.querySelectorAll(".page-check-controls")].find((el) => el.dataset.item === id);
  const button = widget?.querySelector(`[data-check="${name}"]`);
  if (!button) return false;
  button.dataset.fromKeys = "true";
  button.click();
  return true;
}

export function decorations(st) {
  const widgets = [];
  const today = todayKey();
  st.doc.forEach((node, pos) => {
    if (node.type !== schema.nodes.list_item || node.attrs.kind !== "check") return;
    widgets.push(Decoration.widget(pos + node.nodeSize - 1, (view) => {
      const box = controls(view, node);
      box.dataset.item = node.attrs.id;
      return box;
    }, { key: `${node.attrs.id}:${node.attrs.owner}:${node.attrs.due}:${node.attrs.checked}:${today}`, side: -1, stopEvent: (event) => !!event.target.closest?.(".page-check-chip, .page-check-popup"), ignoreSelection: true }));
  });
  return DecorationSet.create(st.doc, widgets);
}

// A document left open overnight redraws its Today, Tomorrow and overdue tags when
// the day turns, checked once a minute and whenever the tab comes back.
function watchDay(view) {
  let day = todayKey();
  const check = () => {
    if (view.isDestroyed || todayKey() === day) return;
    day = todayKey();
    view.dispatch(view.state.tr.setMeta("addToHistory", false));
  };
  const win = view.dom.ownerDocument.defaultView;
  const timer = win.setInterval(check, 60000);
  win.document.addEventListener("visibilitychange", check);
  return () => {
    win.clearInterval(timer);
    win.document.removeEventListener("visibilitychange", check);
  };
}

export function createFeature({ view = null } = {}) {
  const off = view ? addViewHook(view, { decorations, focusControl }) : () => {};
  const unwatch = view ? watchDay(view) : () => {};
  if (view && !view.isDestroyed) view.dispatch(view.state.tr.setMeta("addToHistory", false));
  return { id: "checklist", dispose() { off(); unwatch(); } };
}
