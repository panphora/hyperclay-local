// Code blocks: their language picker and the syntax colours. Loaded the first
// time a document has or takes a code block.
import { CodeBlockView, startHighlighter } from "../highlight.js";

export function createFeature({ view = null, highlight = {} } = {}) {
  const highlighter = view ? startHighlighter(view, highlight) : null;
  return {
    id: "code",
    nodeViews: { code_block: (node, v, getPos) => new CodeBlockView(node, v, getPos) },
    css: null,
    dispose() { highlighter?.destroy(); },
  };
}
