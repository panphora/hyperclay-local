import { ChartView, refreshCharts } from "../chart.js";
import { addViewHook } from "../view-hooks.js";

export function createFeature({ view = null } = {}) {
  const off = view ? addViewHook(view, { update: refreshCharts }) : () => {};
  return {
    id: "chart",
    nodeViews: { chart: (node, editorView, getPos) => new ChartView(node, editorView, getPos) },
    dispose() { off(); },
  };
}
