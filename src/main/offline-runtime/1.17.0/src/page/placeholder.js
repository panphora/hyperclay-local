import { state, view as pmView } from "../vendor/prosemirror.vendor.js";
import { schema } from "./schema.js";

const { Decoration, DecorationSet } = pmView;

export const PLACEHOLDER_TEXT = "Type / for blocks";
export const TITLE_PLACEHOLDER = "Untitled";

function titlePlaceholder(doc) {
  let done = false;
  let decoration = null;
  doc.forEach((node, offset) => {
    if (done) return;
    if (node.type !== schema.nodes.heading || node.attrs.level !== 1 || (node.attrs.parent ?? null) !== null) return;
    done = true;
    if (!node.content.size) decoration = Decoration.node(offset, offset + node.nodeSize, { class: "page-title-placeholder", "data-placeholder": TITLE_PLACEHOLDER });
  });
  return decoration;
}

export function placeholderPlugin(text = PLACEHOLDER_TEXT) {
  return new state.Plugin({
    props: {
      decorations(st) {
        const decorations = [];
        const title = titlePlaceholder(st.doc);
        if (title) decorations.push(title);
        const { selection } = st;
        if (selection.empty) {
          const $from = selection.$from;
          if ($from.depth === 1) {
            const node = $from.parent;
            if (node.type === schema.nodes.paragraph && !node.content.size) {
              const pos = $from.before(1);
              decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: "page-placeholder", "data-placeholder": text }));
            }
          }
        }
        return decorations.length ? DecorationSet.create(st.doc, decorations) : null;
      },
    },
  });
}
