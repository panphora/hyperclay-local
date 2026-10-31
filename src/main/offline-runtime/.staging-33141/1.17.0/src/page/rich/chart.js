import { parseDecimal } from "./csv.js";
import { cellText } from "./cell.js";

const esc = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const fmt = (value) => Number(value.toFixed(2)).toString();

function ticks(min, max, count) {
  if (min === max) { min -= Math.max(Math.abs(min) * .05, 1); max += Math.max(Math.abs(max) * .05, 1); }
  const target = (max - min) / (count - 1);
  const power = 10 ** Math.floor(Math.log10(target));
  const steps = [1, 2, 5, 10].map((n) => n * power);
  let step = steps.find((n) => Math.floor(max / n) - Math.ceil(min / n) + 1 <= count) ?? steps.at(-1);
  while (Math.floor(max / step) - Math.ceil(min / step) + 1 > count) step *= 2;
  const out = [];
  for (let n = Math.ceil(min / step); n <= Math.floor(max / step); n++) out.push(Number((n * step).toPrecision(12)));
  return out.length ? out : [Number(min.toFixed(2)), Number(max.toFixed(2))];
}

export function chartModel(chart, table) {
  if (!table) return { state: "missing", reason: "table" };
  const cols = table.cols ?? [];
  const rows = table.rows ?? [];
  const x = cols.find((col) => col.id === chart.x);
  if (!x || !chart.series?.length || chart.series.some((id) => !cols.some((col) => col.id === id))) return { state: "missing", reason: "column" };
  const series = chart.series.map((id, index) => {
    const col = cols.find((item) => item.id === id);
    const points = rows.map((row, rowIndex) => ({
      id: `${chart.id}:${row.id}:${id}`, rowId: row.id, colId: id, rowIndex,
      xLabel: cellText(row.cells?.[chart.x]), value: parseDecimal(cellText(row.cells?.[id])),
      highlight: row.id === chart.highlight,
    }));
    return { id, name: col.name, color: `var(--chart-${index % 6 + 1})`, points };
  });
  const points = series.flatMap((item) => item.points);
  const values = points.map((point) => point.value).filter((value) => value !== null);
  let min = values.length ? values.reduce((current, value) => Math.min(current, value), Infinity) : 0;
  let max = values.length ? values.reduce((current, value) => Math.max(current, value), -Infinity) : 1;
  if (chart.type === "bar") { min = Math.min(min, 0); max = Math.max(max, 0); }
  else { const pad = (max - min || Math.max(Math.abs(max), 1)) * .05; min -= pad; max += pad; }
  if (min === max) max = min + 1;
  return {
    state: "ok", type: chart.type, title: chart.title ?? "", series, points,
    xLabels: rows.map((row) => cellText(row.cells?.[chart.x])),
    yTicks: ticks(min, max, 6), narrowTicks: ticks(min, max, 3), domain: [min, max],
  };
}

export function renderChartSvg(model, { width = 640, height = 320, narrow = false } = {}) {
  if (model.state === "missing") return `<svg xmlns="http://www.w3.org/2000/svg" role="img" width="${width}" height="80" viewBox="0 0 ${width} 80"><title>Chart source missing</title><text x="12" y="44">Chart source missing</text></svg>`;
  const margin = { left: 52, right: 72, top: 28, bottom: 48 };
  const plotW = Math.max(1, width - margin.left - margin.right);
  const plotH = Math.max(1, height - margin.top - margin.bottom);
  const [min, max] = model.domain;
  const y = (value) => margin.top + (max - value) / (max - min) * plotH;
  const n = model.xLabels.length;
  const x = (index) => margin.left + (n <= 1 ? plotW / 2 : index * plotW / (n - 1));
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" role="img" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`, `<title>${esc(model.title)}</title>`];
  const caption = model.series.map((item) => {
    const valid = item.points.filter((point) => point.value !== null);
    return `${item.name}: ${valid.length ? `${fmt(valid[0].value)} to ${fmt(valid.at(-1).value)}` : "no values"}`;
  }).join("; ");
  parts.push(`<desc>${esc(caption)}</desc>`);
  for (const tick of narrow ? model.narrowTicks : model.yTicks) {
    const yy = fmt(y(tick));
    parts.push(`<line x1="${margin.left}" y1="${yy}" x2="${fmt(margin.left + plotW)}" y2="${yy}" stroke="currentColor" opacity="0.15"/><text x="${margin.left - 8}" y="${fmt(y(tick) + 4)}" text-anchor="end">${fmt(tick)}</text>`);
  }
  if (model.type === "bar") {
    const groupW = plotW / Math.max(n, 1);
    const barW = Math.max(1, Math.min(32, groupW * .7 / model.series.length));
    const base = y(0);
    model.series.forEach((item, seriesIndex) => {
      item.points.forEach((point) => {
        if (point.value === null) return;
        const xx = margin.left + (point.rowIndex + .5) * groupW - model.series.length * barW / 2 + seriesIndex * barW;
        const yy = y(point.value);
        parts.push(`<rect data-point="${esc(point.id)}"${point.highlight ? ' data-highlight="true"' : ""} x="${fmt(xx)}" y="${fmt(Math.min(yy, base))}" width="${fmt(barW)}" height="${fmt(Math.abs(base - yy))}" fill="${item.color}"/>`);
      });
      const last = [...item.points].reverse().find((point) => point.value !== null);
      if (last) {
        const xx = margin.left + (last.rowIndex + .5) * groupW - model.series.length * barW / 2 + seriesIndex * barW;
        parts.push(`<text x="${fmt(xx + barW / 2)}" y="${fmt(Math.min(y(last.value), base) - 7)}" text-anchor="middle">${esc(item.name)}</text>`);
      }
    });
  } else {
    model.series.forEach((item) => {
      let segment = [];
      const flush = () => { if (segment.length > 1) parts.push(`<polyline points="${segment.join(" ")}" fill="none" stroke="${item.color}" stroke-width="2"/>`); segment = []; };
      item.points.forEach((point) => {
        if (point.value === null) { flush(); return; }
        segment.push(`${fmt(x(point.rowIndex))},${fmt(y(point.value))}`);
        parts.push(`<circle data-point="${esc(point.id)}"${point.highlight ? ' data-highlight="true"' : ""} cx="${fmt(x(point.rowIndex))}" cy="${fmt(y(point.value))}" r="3" fill="${item.color}"/>`);
      });
      flush();
      const last = [...item.points].reverse().find((point) => point.value !== null);
      if (last) parts.push(`<text x="${fmt(x(last.rowIndex) + 7)}" y="${fmt(y(last.value) - 5)}">${esc(item.name)}</text>`);
    });
  }
  model.xLabels.forEach((label, i) => {
    const xx = model.type === "bar" ? margin.left + (i + .5) * plotW / Math.max(n, 1) : x(i);
    parts.push(`<text x="${fmt(xx)}" y="${fmt(height - 14)}" text-anchor="middle">${esc(label)}</text>`);
  });
  parts.push("</svg>");
  return parts.join("");
}
