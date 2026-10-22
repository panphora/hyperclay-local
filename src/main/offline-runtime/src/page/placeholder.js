import { state, view as pmView } from "../vendor/prosemirror.vendor.js";
import { schema } from "./schema.js";

const { Decoration, DecorationSet } = pmView;

export const PLACEHOLDER_TEXT = "Type / for blocks";

export function placeholderPlugin(text = PLACEHOLDER_TEXT) {
  return new state.Plugin({
    props: {
      decorations(st) {
        const { selection } = st;
        if (!selection.empty) return null;
        const $from = selection.$from;
        if ($from.depth !== 1) return null;
        const node = $from.parent;
        if (node.type !== schema.nodes.paragraph || node.content.size) return null;
        const pos = $from.before(1);
        return DecorationSet.create(st.doc, [Decoration.node(pos, pos + node.nodeSize, { class: "page-placeholder", "data-placeholder": text })]);
      },
    },
  });
}
