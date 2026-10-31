// Which block types each optional feature serves, which node views its part
// supplies, and how to load it. `module` is the part on the wire (the load meter
// counts it), and `boot` lists what the page plugin fetches with it before the
// editor takes input.
// Literal imports, so the chunk build gives each feature its own files.
export const FEATURES = {
  table: { types: ["table"], views: ["table", "table_cell"], module: "page/features/table.js", load: () => import("./table.js") },
  board: { types: ["board"], module: "page/features/board.js", load: () => import("./board.js") },
  chart: { types: ["chart"], views: ["chart"], module: "page/features/chart.js", load: () => import("./chart.js") },
  checklist: { types: [], views: [], match: (node) => node.type.name === "list_item" && node.attrs.kind === "check", module: "page/features/checklist.js", load: () => import("./checklist.js") },
  code: { types: ["code_block"], module: "page/features/code.js", load: () => import("./code.js") },
  toc: { types: ["toc"], module: "page/features/toc.js", load: () => import("./toc.js") },
  titleIcon: { types: [], views: ["heading"], match: (node) => node.attrs.pageIcon != null || node.attrs.pageCoverSrc != null, module: "page/features/title-icon.js", load: () => import("./title-icon.js") },
  media: { types: ["image", "file"], module: "page/features/media.js", load: () => import("./media.js") },
  tool: { types: ["tool"], module: "page/features/tool.js", boot: ["page/tools.js", "page/tool-data.js"], load: () => import("./tool.js") },
};

export const featureForType = (type) => Object.keys(FEATURES).find((id) => FEATURES[id].types.includes(type)) ?? null;

// The row for a whole block: a row may name its blocks with `match` instead of a type,
// the way the checklist serves only the list items whose kind is check.
export const featureForNode = (node) => {
  for (const id of Object.keys(FEATURES)) {
    const row = FEATURES[id];
    if (row.match ? row.match(node) : row.types.includes(node.type.name)) return id;
  }
  return null;
};

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
  titleIcon: { module: "page/features/title-icon.js", load: () => import("./title-icon.js") },
  titleCover: { module: "page/features/title-cover.js", load: () => import("./title-cover.js") },
  exportHtml: { module: "page/features/export-html.js", load: () => import("./export-html.js") },
  importMarkdown: { module: "page/features/import-markdown.js", load: () => import("./import-markdown.js") },
  exportMarkdown: { module: "page/features/export-markdown.js", load: () => import("./export-markdown.js") },
};
