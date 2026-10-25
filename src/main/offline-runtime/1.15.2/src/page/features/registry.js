// Which block types each optional feature serves, which node views its part
// supplies, and how to load it. `module` is the part on the wire (the load meter
// counts it), and `boot` lists what the page plugin fetches with it before the
// editor takes input.
// Literal imports, so the chunk build gives each feature its own files.
export const FEATURES = {
  table: { types: ["table"], views: ["table", "table_cell"], module: "page/features/table.js", load: () => import("./table.js") },
  board: { types: ["board"], module: "page/features/board.js", load: () => import("./board.js") },
  media: { types: ["image", "file"], module: "page/features/media.js", load: () => import("./media.js") },
  tool: { types: ["tool"], module: "page/features/tool.js", boot: ["page/tools.js", "page/tool-data.js"], load: () => import("./tool.js") },
};

export const featureForType = (type) => Object.keys(FEATURES).find((id) => FEATURES[id].types.includes(type)) ?? null;
