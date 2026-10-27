// Which block types each optional feature serves, which node views its part
// supplies, and how to load it. `module` is the part on the wire (the load meter
// counts it), and `boot` lists what the page plugin fetches with it before the
// editor takes input.
// Literal imports, so the chunk build gives each feature its own files.
export const FEATURES = {
  table: { types: ["table"], views: ["table", "table_cell"], module: "page/features/table.js", load: () => import("./table.js") },
  board: { types: ["board"], module: "page/features/board.js", load: () => import("./board.js") },
  chart: { types: ["chart"], views: ["chart"], module: "page/features/chart.js", load: () => import("./chart.js") },
  code: { types: ["code_block"], module: "page/features/code.js", load: () => import("./code.js") },
  media: { types: ["image", "file"], module: "page/features/media.js", load: () => import("./media.js") },
  tool: { types: ["tool"], module: "page/features/tool.js", boot: ["page/tools.js", "page/tool-data.js"], load: () => import("./tool.js") },
};

export const featureForType = (type) => Object.keys(FEATURES).find((id) => FEATURES[id].types.includes(type)) ?? null;

// The optional commands: pickers, import and export, which a reader or a plain text
// editor never needs. They are a table of their own, out of the block-type scan above, so
// no document preloads one; the page editor fetches a command the first time somebody
// asks for it. Each row is one literal import, so the build splits it into its own files
// and the offline manifest carries them, and `module` is the part on the wire (the load
// meter counts it). A row lands with the step that gives it a module: a literal import of
// a file this tree does not have yet would stop the chunk build.
export const COMMAND_FEATURES = {
  mentions: { module: "page/features/mentions.js", load: () => import("./mentions.js") },
  dates: { module: "page/features/dates.js", load: () => import("./dates.js") },
  emoji: { module: "page/features/emoji.js", load: () => import("./emoji.js") },
};
