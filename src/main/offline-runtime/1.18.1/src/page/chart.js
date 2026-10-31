import { schema } from "./schema.js";
import { blockJson, keyBetween, newId, orderedIds } from "./model.js";
import { chartTables, tableName } from "./chart-tables.js";
import { chartModel, renderChartSvg } from "./rich/chart.js";
import { openPageMenu } from "./chrome.js";
import { project } from "./projection.js";
import { columnKinds } from "./table-kinds.js";
import { cellText } from "./rich/cell.js";
import { registerUnsavedState } from "../lib/unsaved-state.js";
import toast from "../ui/toast-lazy.js";
import { asStep } from "./blocksel.js";
import { state } from "../vendor/prosemirror.vendor.js";

const { TextSelection } = state;

const views = new WeakMap();
// A chart inserted by the slash command or a table action opens its inspector as soon
// as its node view exists; one that arrives any other way stays closed.
const openOnMount = new Set();

function sourceTable(doc, id) {
  let table = null;
  doc.forEach((node) => { if (node.type === schema.nodes.table && node.attrs.id === id) table = node; });
  return table;
}

function tableData(node) {
  if (!node) return null;
  return project({ [node.attrs.id]: blockJson(node) })[0];
}

function chartAttrs(table, pos, parent) {
  const colIds = orderedIds(table.attrs.cols);
  if (!colIds.length) return null;
  const kinds = columnKinds(table);
  const series = colIds.filter((id) => id !== colIds[0] && kinds[id] === "number");
  if (!series.length) return null;
  return {
    id: newId(),
    pos,
    parent,
    source: table.attrs.id,
    kind: "bar",
    x: colIds[0],
    series,
    title: "",
    highlight: null,
  };
}

export function insertChartAfterTable(view, tablePos) {
  const doc = view.state.doc;
  const table = doc.nodeAt(tablePos);
  if (table?.type !== schema.nodes.table) return false;
  const after = tablePos + table.nodeSize;
  const next = doc.maybeChild(doc.resolve(after).index(0));
  const attrs = chartAttrs(table, keyBetween(table.attrs.pos, next?.attrs.pos ?? null), table.attrs.parent);
  if (!attrs) {
    toast("This table has no number column to chart yet.");
    return true;
  }
  openOnMount.add(attrs.id);
  view.dispatch(view.state.tr.insert(after, schema.nodes.chart.create(attrs)));
  return true;
}

export { chartTables };

// /chart: an empty line becomes the chart, otherwise it goes below the line.
// One table is charted at once; several open a picker named by their columns.
function placeChart(view, index, table, remove) {
  let tr = view.state.tr;
  if (remove) tr.delete(remove.from, remove.to);
  if (!sourceTable(tr.doc, table.attrs.id) || index >= tr.doc.childCount) return false;
  let at = 0;
  for (let i = 0; i < index; i++) at += tr.doc.child(i).nodeSize;
  const node = tr.doc.child(index);
  const replace = node.isTextblock && node.content.size === 0;
  const next = tr.doc.maybeChild(index + 1);
  const pos = replace ? node.attrs.pos : keyBetween(node.attrs.pos, next?.attrs.pos ?? null);
  const attrs = chartAttrs(table, pos, node.attrs.parent ?? null);
  if (!attrs) {
    if (remove) view.dispatch(view.state.tr.delete(remove.from, remove.to));
    toast("This table has no number column to chart yet.");
    return true;
  }
  const chart = schema.nodes.chart.create(attrs);
  tr = replace ? tr.replaceWith(at, at + node.nodeSize, chart) : tr.insert(at + node.nodeSize, chart);
  openOnMount.add(attrs.id);
  view.dispatch(tr.scrollIntoView());
  return true;
}

export const tableLabel = (table) => orderedIds(table.attrs.cols).map((id) => table.attrs.cols[id].name || "Untitled").join(", ");

export function chartFromSlash(view, index, remove = null) {
  const tables = chartTables(view.state.doc);
  if (!tables.length) {
    if (remove) view.dispatch(view.state.tr.delete(remove.from, remove.to));
    toast("Add a table first: a chart plots the numbers in a table on this page.");
    return true;
  }
  if (tables.length === 1) return placeChart(view, index, tables[0], remove);
  const doc = view.state.doc;
  const anchor = view.nodeDOM(doc.resolve(view.state.selection.head).before(1)) ?? view.dom;
  return openPageMenu(view, anchor, tables.map((table) => ({
    label: tableName(doc, table.attrs.id) ?? "",
    description: `${table.childCount} ${table.childCount === 1 ? "row" : "rows"} · ${tableLabel(table)}`,
    icon: "▦",
    run: () => placeChart(view, index, table, remove),
  })));
}

const ICON = (body) => `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const TABLE_ICON = ICON('<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M2.5 6.5h11M6 6.5V13"/>');
const GEAR_ICON = ICON('<g transform="scale(0.6667)" stroke-width="2.25"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></g>');
const TRASH_ICON = ICON('<path d="M2.75 4.5h10.5M6.25 4.5V2.75h3.5V4.5M4.25 4.5l.6 8.75h6.3l.6-8.75"/>');
const CHART_TYPES = [["bar", "Bar"], ["line", "Line"], ["pie", "Pie"]];
const UNTITLED = "Untitled chart";

function tableOffset(doc, id) {
  let pos = null;
  doc.forEach((node, offset) => { if (pos === null && node.type === schema.nodes.table && node.attrs.id === id) pos = offset; });
  return pos;
}

function documentTables(doc) {
  const tables = [];
  doc.forEach((node) => { if (node.type === schema.nodes.table && orderedIds(node.attrs.cols).length > 1) tables.push(node); });
  return tables.map((node) => ({ id: node.attrs.id, name: tableName(doc, node.attrs.id), rows: node.childCount }));
}

function defaultColumns(table) {
  const colIds = orderedIds(table.attrs.cols);
  if (!colIds.length) return null;
  const kinds = columnKinds(table);
  const x = colIds.find((id) => kinds[id] !== "number") ?? colIds[0];
  const series = colIds.filter((id) => id !== x && kinds[id] === "number");
  return { x, series: series.length ? series : colIds.filter((id) => id !== x).slice(0, 1) };
}

function element(doc, tag, className, text = null) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== null) node.textContent = text;
  return node;
}

function option(doc, value, label, selected = false) {
  const node = element(doc, "option", "", label);
  node.value = value;
  node.selected = selected;
  return node;
}

function select(doc, field, label) {
  const node = element(doc, "select", "page-chart-select");
  node.dataset.field = field;
  node.setAttribute("aria-label", label);
  return node;
}

export class ChartView {
  constructor(node, view, getPos) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.source = undefined;
    this.tables = null;
    this.frame = null;
    this.unsaved = null;
    this.titleInput = null;
    const doc = view.dom.ownerDocument;
    this.doc = doc;
    this.dom = doc.createElement("figure");
    this.dom.className = "page-chart";
    this.dom.dataset.id = node.attrs.id ?? "";
    this.dom.dataset.type = "chart";
    this.head = element(doc, "div", "page-chart-head");
    this.head.contentEditable = "false";
    this.title = element(doc, "span", "page-chart-title");
    this.chip = element(doc, "button", "page-chart-source");
    this.chip.type = "button";
    this.chip.contentEditable = "false";
    this.chip.setAttribute("aria-label", "Go to source table");
    this.chip.innerHTML = TABLE_ICON;
    this.chipName = element(doc, "span", "page-chart-source-name");
    this.chip.append(this.chipName);
    this.chip.addEventListener("click", () => this.goToSource());
    this.edit = element(doc, "button", "page-chart-edit");
    this.edit.type = "button";
    this.edit.contentEditable = "false";
    this.edit.setAttribute("aria-haspopup", "dialog");
    this.edit.setAttribute("aria-expanded", "false");
    this.edit.innerHTML = GEAR_ICON;
    this.edit.append("Edit chart");
    this.edit.addEventListener("click", () => (this.panel.isConnected ? this.closePanel(true) : this.openPanel()));
    this.head.append(this.title, this.chip, this.edit);
    this.plot = element(doc, "div", "page-chart-plot");
    this.broken = element(doc, "div", "page-chart-broken");
    this.broken.hidden = true;
    this.broken.contentEditable = "false";
    this.brokenKey = null;
    this.brokenSelect = null;
    this.broken.addEventListener("click", (event) => this.brokenClick(event));
    this.panel = element(doc, "div", "page-chart-panel");
    this.panel.tabIndex = -1;
    this.panel.contentEditable = "false";
    this.panel.setAttribute("role", "dialog");
    this.panel.setAttribute("aria-label", "Chart settings");
    this.panel.addEventListener("click", (event) => this.panelClick(event));
    this.panel.addEventListener("change", (event) => this.panelChange(event));
    this.panel.addEventListener("mousedown", (event) => { if (event.target.closest?.("button")) event.preventDefault(); });
    this.outside = (event) => {
      if (!this.panel.isConnected || this.dom.contains(event.target)) return;
      this.commitTitle();
      this.closePanel();
    };
    this.escape = (event) => {
      if (!this.panel.isConnected || event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      this.closePanel(true);
    };
    doc.addEventListener("mousedown", this.outside, true);
    doc.addEventListener("keydown", this.escape, true);
    this.dom.append(this.head, this.plot, this.broken);
    if (!views.has(view)) views.set(view, new Set());
    views.get(view).add(this);
    this.refresh();
    if (openOnMount.delete(node.attrs.id)) this.openSoon();
  }

  refresh() {
    this.renderHead();
    if (this.panel.isConnected && this.panelKey() !== this.renderedKey) this.redrawPanel();
    const doc = this.view.state.doc;
    const source = sourceTable(doc, this.node.attrs.source);
    const tables = documentTables(doc).map((table) => `${table.id}:${table.name}:${table.rows}`).join("|");
    if (source === this.source && tables === this.tables) return;
    this.source = source;
    this.tables = tables;
    this.schedule();
  }

  schedule() {
    if (this.frame !== null) return;
    const win = this.dom.ownerDocument.defaultView;
    const raf = win.requestAnimationFrame?.bind(win) ?? ((fn) => win.setTimeout(fn, 0));
    this.frame = raf(() => { this.frame = null; this.draw(); });
  }

  draw() {
    const attrs = this.node.attrs;
    const chart = chartModel({ id: attrs.id, type: attrs.kind, x: attrs.x, series: attrs.series, title: attrs.title, highlight: attrs.highlight }, tableData(this.source));
    this.plot.innerHTML = renderChartSvg(chart, { width: 640, height: 320, narrow: this.dom.getBoundingClientRect().width < 480 });
    this.renderBroken(chart);
  }

  renderBroken(chart) {
    const broken = chart.state === "missing" && chart.reason === "table";
    this.plot.hidden = broken;
    this.broken.hidden = !broken;
    if (!broken) {
      if (this.brokenKey !== null) {
        this.broken.textContent = "";
        this.brokenKey = null;
        this.brokenSelect = null;
      }
      return;
    }
    const tables = documentTables(this.view.state.doc);
    const key = tables.map((table) => `${table.id}:${table.name}:${table.rows}`).join("|");
    if (this.brokenKey === key) return;
    this.brokenKey = key;
    this.brokenSelect = null;
    const doc = this.doc;
    this.broken.textContent = "";
    this.broken.append(
      element(doc, "div", "page-chart-broken-head", "This chart's table was deleted"),
      element(doc, "p", "page-chart-broken-text", "Pick another table in this document, or delete the chart. Undo brings the table back."),
    );
    const actions = element(doc, "div", "page-chart-broken-actions");
    if (tables.length) {
      const sources = select(doc, "rescue", "Source table");
      for (const table of tables) sources.append(option(doc, table.id, `${table.name} (${table.rows} ${table.rows === 1 ? "row" : "rows"})`));
      this.brokenSelect = sources;
      const use = element(doc, "button", "page-chart-use", "Use this table");
      use.type = "button";
      use.dataset.action = "use";
      actions.append(sources, use);
    }
    const remove = element(doc, "button", "page-chart-delete", "Delete chart");
    remove.type = "button";
    remove.dataset.action = "delete";
    actions.append(remove);
    this.broken.append(actions);
  }

  brokenClick(event) {
    const button = event.target.closest?.("button[data-action]");
    if (!button) return;
    if (button.dataset.action === "delete") this.removeChart();
    else if (button.dataset.action === "use") this.switchSource(this.brokenSelect?.value ?? "");
  }

  openSoon() {
    const win = this.dom.ownerDocument.defaultView;
    const raf = win.requestAnimationFrame?.bind(win) ?? ((fn) => win.setTimeout(fn, 0));
    raf(() => { if (!this.view.isDestroyed && this.dom.isConnected) this.openPanel(); });
  }

  renderHead() {
    const attrs = this.node.attrs;
    const name = tableName(this.view.state.doc, attrs.source);
    const broken = !sourceTable(this.view.state.doc, attrs.source);
    this.title.textContent = attrs.title || UNTITLED;
    this.title.classList.toggle("is-empty", !attrs.title);
    this.chipName.textContent = broken ? "No table" : name ?? "";
    this.chip.disabled = broken;
  }

  setAttrs(changes) {
    const pos = this.getPos();
    if (pos == null) return;
    const node = this.view.state.doc.nodeAt(pos);
    if (node?.type !== schema.nodes.chart) return;
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, null, { ...node.attrs, ...changes }));
  }

  row(label, ...children) {
    const row = element(this.doc, "div", "page-chart-row");
    if (label) row.append(element(this.doc, "span", "page-chart-label", label));
    row.append(...children);
    return row;
  }

  panelKey() {
    const doc = this.view.state.doc;
    const tables = documentTables(doc).map((table) => `${table.id}:${table.name}:${table.rows}`).join("|");
    return JSON.stringify([this.node.attrs, tables, tableData(sourceTable(doc, this.node.attrs.source))]);
  }

  redrawPanel() {
    const active = this.doc.activeElement;
    const focus = active && this.panel.contains(active) ? active.dataset ?? {} : null;
    const input = this.titleInput;
    const draft = input && input.value !== this.renderedTitle ? { value: input.value, start: input.selectionStart, end: input.selectionEnd } : null;
    this.renderPanel();
    if (draft && this.titleInput) this.titleInput.value = draft.value;
    if (!focus) return;
    const match = [...this.panel.querySelectorAll("button, input, select")].find((control) =>
      ["field", "kind", "col", "action"].every((key) => control.dataset[key] === focus[key]));
    if (!match) return this.panel.focus();
    match.focus();
    if (draft && match === this.titleInput) match.setSelectionRange?.(draft.start, draft.end);
  }

  renderPanel() {
    const doc = this.doc;
    this.renderedKey = this.panelKey();
    this.renderedTitle = this.node.attrs.title ?? "";
    const attrs = this.node.attrs;
    const source = tableData(this.source);
    const cols = source?.cols ?? [];
    const rows = source?.rows ?? [];
    const pie = attrs.kind === "pie";
    this.unsaved?.dispose();
    this.unsaved = null;
    this.titleInput = null;
    this.panel.textContent = "";

    const types = element(doc, "div", "page-chart-types");
    for (const [kind, label] of CHART_TYPES) {
      const button = element(doc, "button", "page-chart-type", label);
      button.type = "button";
      button.dataset.kind = kind;
      button.setAttribute("aria-pressed", String(attrs.kind === kind));
      types.append(button);
    }
    this.panel.append(this.row("Chart type", types));

    const sources = select(doc, "source", "Source table");
    for (const table of documentTables(this.view.state.doc)) {
      sources.append(option(doc, table.id, `${table.name} (${table.rows} ${table.rows === 1 ? "row" : "rows"})`, table.id === attrs.source));
    }
    this.panel.append(this.row("Source table", sources));

    const labels = select(doc, "labels", "Labels column");
    for (const col of cols) labels.append(option(doc, col.id, col.name || col.id, col.id === attrs.x));
    this.panel.append(this.row("Labels column", labels));

    const values = element(doc, "div", "page-chart-values");
    cols.filter((col) => col.id !== attrs.x).forEach((col, index) => {
      const line = element(doc, "label", "page-chart-value");
      const check = element(doc, "input");
      check.type = "checkbox";
      check.dataset.field = "series";
      check.dataset.col = col.id;
      check.checked = attrs.series.includes(col.id);
      const swatch = element(doc, "span", "page-chart-swatch");
      swatch.style.background = `var(--chart-${index % 6 + 1})`;
      swatch.setAttribute("aria-hidden", "true");
      line.append(check, swatch, element(doc, "span", "page-chart-value-name", col.name || col.id));
      values.append(line);
    });
    const valueRow = this.row(pie ? "Value column" : "Value columns", values);
    if (pie) valueRow.append(element(doc, "span", "page-chart-hint", "Pie charts plot the first value column across rows."));
    this.panel.append(valueRow);

    const highlight = select(doc, "highlight", "Highlight row");
    highlight.append(option(doc, "", "None", !attrs.highlight));
    for (const row of rows) highlight.append(option(doc, row.id, cellText(row.cells?.[attrs.x]) || row.id, row.id === attrs.highlight));
    this.panel.append(this.row("Highlight row", highlight));

    const title = element(doc, "input", "page-chart-title-input");
    title.type = "text";
    title.dataset.field = "title";
    title.setAttribute("aria-label", "Chart title");
    title.value = attrs.title ?? "";
    title.addEventListener("keydown", (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key !== "Enter") return;
      event.preventDefault();
      event.stopPropagation();
      this.commitTitle();
    });
    title.addEventListener("change", () => this.commitTitle());
    title.addEventListener("blur", () => this.commitTitle());
    this.titleInput = title;
    this.panel.append(this.row("Chart title", title));

    const foot = element(doc, "div", "page-chart-foot");
    const remove = element(doc, "button", "page-chart-remove");
    remove.type = "button";
    remove.dataset.action = "remove";
    remove.innerHTML = TRASH_ICON;
    remove.append("Remove");
    const done = element(doc, "button", "page-chart-done", "Done");
    done.type = "button";
    done.dataset.action = "done";
    foot.append(remove, done);
    this.panel.append(foot);

    this.unsaved = registerUnsavedState({
      id: "chart-title",
      isPending: () => title.isConnected && title.value !== (this.node.attrs.title ?? ""),
    });
  }

  openPanel() {
    if (this.panel.isConnected) return;
    this.renderPanel();
    this.dom.append(this.panel);
    this.edit.setAttribute("aria-expanded", "true");
    this.panel.focus();
  }

  closePanel(refocus = false) {
    if (!this.panel.isConnected) return;
    this.unsaved?.dispose();
    this.unsaved = null;
    this.titleInput = null;
    this.panel.remove();
    this.edit.setAttribute("aria-expanded", "false");
    if (refocus) this.edit.focus();
  }

  panelClick(event) {
    const button = event.target.closest?.("button");
    if (!button) return;
    if (button.dataset.action === "done") {
      this.commitTitle();
      this.closePanel(true);
    }
    else if (button.dataset.action === "remove") this.removeChart();
    else if (button.dataset.kind) this.setAttrs({ kind: button.dataset.kind });
  }

  panelChange(event) {
    const control = event.target;
    if (!control?.dataset) return;
    if (control.dataset.field === "source") this.switchSource(control.value);
    else if (control.dataset.field === "labels") this.setAttrs({ x: control.value, series: this.node.attrs.series.filter((id) => id !== control.value) });
    else if (control.dataset.field === "highlight") this.setAttrs({ highlight: control.value || null });
    else if (control.dataset.field === "series") {
      const series = this.node.attrs.series.filter((id) => id !== control.dataset.col);
      this.setAttrs({ series: control.checked ? [...series, control.dataset.col] : series });
    }
  }

  switchSource(id) {
    const table = sourceTable(this.view.state.doc, id);
    const defaults = table ? defaultColumns(table) : null;
    if (!defaults) return;
    this.setAttrs({ source: id, x: defaults.x, series: defaults.series });
  }

  commitTitle() {
    const input = this.titleInput;
    if (!input || input.value === (this.node.attrs.title ?? "")) return;
    this.setAttrs({ title: input.value });
  }

  goToSource() {
    const doc = this.view.state.doc;
    const pos = tableOffset(doc, this.node.attrs.source);
    const table = pos === null ? null : doc.nodeAt(pos);
    if (!table?.childCount || !table.child(0).childCount) return;
    const at = pos + 3;
    this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(doc, at)).scrollIntoView());
    this.view.focus?.();
  }

  removeChart() {
    const pos = this.getPos();
    if (pos == null) return;
    const node = this.view.state.doc.nodeAt(pos);
    if (node?.type !== schema.nodes.chart) return;
    this.closePanel();
    const tr = this.view.state.tr.delete(pos, pos + node.nodeSize);
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size)), -1));
    this.view.dispatch(asStep(tr).scrollIntoView());
  }

  update(node) {
    if (node.type !== schema.nodes.chart) return false;
    const changed = !node.sameMarkup(this.node);
    this.node = node;
    this.dom.dataset.id = node.attrs.id ?? "";
    if (changed) {
      this.source = sourceTable(this.view.state.doc, node.attrs.source);
      this.renderHead();
      this.schedule();
    }
    return true;
  }

  stopEvent(event) { return !!event.target.closest?.(".page-chart-head, .page-chart-panel"); }

  destroy() {
    this.unsaved?.dispose();
    this.unsaved = null;
    this.doc.removeEventListener("mousedown", this.outside, true);
    this.doc.removeEventListener("keydown", this.escape, true);
    views.get(this.view)?.delete(this);
    if (this.frame !== null) {
      const win = this.dom.ownerDocument.defaultView;
      if (win.cancelAnimationFrame) win.cancelAnimationFrame(this.frame);
      else win.clearTimeout(this.frame);
    }
  }
}

// The hook the chart view part registers for its editor view: every change can
// have moved a chart's source table.
export function refreshCharts(view) {
  for (const chart of views.get(view) ?? []) chart.refresh();
}
