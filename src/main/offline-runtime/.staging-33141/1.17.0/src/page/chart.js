import { schema } from "./schema.js";
import { blockJson, keyBetween, newId, orderedIds } from "./model.js";
import { chartTables } from "./chart-tables.js";
import { chartModel, renderChartSvg } from "./rich/chart.js";
import { openPageMenu } from "./chrome.js";
import { project } from "./projection.js";
import { columnKinds } from "./table-kinds.js";
import { cellText } from "./rich/cell.js";
import { registerUnsavedState } from "../lib/unsaved-state.js";

const views = new WeakMap();

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
  return {
    id: newId(),
    pos,
    parent,
    source: table.attrs.id,
    kind: "bar",
    x: colIds[0],
    series: series.length ? series : colIds[1] ? [colIds[1]] : [],
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
  if (!attrs) return false;
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
  if (!attrs) return false;
  const chart = schema.nodes.chart.create(attrs);
  tr = replace ? tr.replaceWith(at, at + node.nodeSize, chart) : tr.insert(at + node.nodeSize, chart);
  view.dispatch(tr.scrollIntoView());
  return true;
}

export const tableLabel = (table) => orderedIds(table.attrs.cols).map((id) => table.attrs.cols[id].name || "Untitled").join(", ");

export function chartFromSlash(view, index, remove = null) {
  const tables = chartTables(view.state.doc);
  if (!tables.length) return false;
  if (tables.length === 1) return placeChart(view, index, tables[0], remove);
  const anchor = view.nodeDOM(view.state.doc.resolve(view.state.selection.head).before(1)) ?? view.dom;
  return openPageMenu(view, anchor, tables.map((table, i) => ({
    label: `Table ${i + 1}`,
    description: tableLabel(table),
    icon: "▦",
    run: () => placeChart(view, index, table, remove),
  })));
}

export class ChartView {
  constructor(node, view, getPos) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.source = undefined;
    this.frame = null;
    this.titleUnsaved = null;
    const doc = view.dom.ownerDocument;
    this.dom = doc.createElement("figure");
    this.dom.className = "page-chart";
    this.dom.dataset.id = node.attrs.id ?? "";
    this.dom.dataset.type = "chart";
    this.plot = doc.createElement("div");
    this.plot.className = "page-chart-plot";
    this.caption = doc.createElement("figcaption");
    this.settings = doc.createElement("button");
    this.settings.type = "button";
    this.settings.className = "page-chart-settings";
    this.settings.textContent = "Chart settings";
    this.settings.setAttribute("aria-label", "Chart settings");
    this.settings.contentEditable = "false";
    this.settings.addEventListener("click", () => this.openSettings());
    this.dom.append(this.plot, this.caption, this.settings);
    if (!views.has(view)) views.set(view, new Set());
    views.get(view).add(this);
    this.refresh();
  }

  refresh() {
    const source = sourceTable(this.view.state.doc, this.node.attrs.source);
    if (source === this.source) return;
    this.source = source;
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
    this.caption.textContent = attrs.title;
  }

  setAttrs(changes) {
    const pos = this.getPos();
    if (pos == null) return;
    const node = this.view.state.doc.nodeAt(pos);
    if (node?.type !== schema.nodes.chart) return;
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, null, { ...node.attrs, ...changes }));
  }

  submenu(items) {
    openPageMenu(this.view, this.settings, items);
  }

  openSettings() {
    const attrs = this.node.attrs;
    const table = tableData(sourceTable(this.view.state.doc, attrs.source));
    const cols = table?.cols ?? [];
    const rows = table?.rows ?? [];
    this.submenu([
      { label: "Line", icon: attrs.kind === "line" ? "✓" : "", run: () => this.setAttrs({ kind: "line" }) },
      { label: "Bar", icon: attrs.kind === "bar" ? "✓" : "", run: () => this.setAttrs({ kind: "bar" }) },
      { label: "X column ▸", focus: false, run: () => this.submenu(cols.map((col) => ({ label: col.name || col.id, icon: attrs.x === col.id ? "✓" : "", run: () => this.setAttrs({ x: col.id, series: attrs.series.filter((id) => id !== col.id) }) }))) },
      { label: "Series ▸", focus: false, run: () => this.submenu(cols.filter((col) => col.id !== attrs.x).map((col) => ({ label: col.name || col.id, icon: attrs.series.includes(col.id) ? "✓" : "", checked: attrs.series.includes(col.id), run: () => this.setAttrs({ series: attrs.series.includes(col.id) ? attrs.series.filter((id) => id !== col.id) : [...attrs.series, col.id] }) }))) },
      { label: "Highlight row ▸", focus: false, run: () => this.submenu([{ label: "None", icon: !attrs.highlight ? "✓" : "", run: () => this.setAttrs({ highlight: null }) }, ...rows.map((row) => ({ label: cellText(row.cells[attrs.x]) || row.id, icon: attrs.highlight === row.id ? "✓" : "", run: () => this.setAttrs({ highlight: row.id }) }))]) },
      { label: "Edit title", focus: false, run: () => this.editTitle() },
    ]);
  }

  // A title typed here is unsaved work until Enter or a blur writes it, so the exit
  // asks the registry by its name and refuses while the field holds a title the chart
  // does not.
  editTitle() {
    const input = this.dom.ownerDocument.createElement("input");
    input.type = "text";
    input.className = "page-chart-title-input";
    input.setAttribute("aria-label", "Chart title");
    input.value = this.node.attrs.title ?? "";
    const unsaved = registerUnsavedState({
      id: "chart-title",
      isPending: () => input.isConnected && input.value !== (this.node.attrs.title ?? ""),
    });
    this.titleUnsaved = unsaved;
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      this.titleUnsaved = null;
      unsaved.dispose();
      input.remove();
      this.caption.hidden = false;
      if (save) this.setAttrs({ title: input.value });
      else this.settings.focus();
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(event.key === "Enter");
      }
    });
    input.addEventListener("blur", () => finish(true));
    this.caption.hidden = true;
    this.caption.after(input);
    input.focus();
    input.select();
  }

  update(node) {
    if (node.type !== schema.nodes.chart) return false;
    const changed = !node.sameMarkup(this.node);
    this.node = node;
    this.dom.dataset.id = node.attrs.id ?? "";
    if (changed) { this.source = sourceTable(this.view.state.doc, node.attrs.source); this.schedule(); }
    return true;
  }

  stopEvent(event) { return !!event.target.closest?.(".page-chart-settings, .page-chart-title-input"); }

  destroy() {
    this.titleUnsaved?.dispose();
    this.titleUnsaved = null;
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
