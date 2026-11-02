// The decoration slot code colours go into: code blocks highlight themselves
// from a separate part, so the editor carries this empty plugin from boot and
// the highlighter fills it once it loads.
import { state, view as pmView } from "../vendor/prosemirror.vendor.js";

const { Plugin, PluginKey } = state;
const { DecorationSet } = pmView;

export const highlightKey = new PluginKey("page-highlight");

export function highlightSlot() {
  return new Plugin({
    key: highlightKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        const decos = tr.getMeta(highlightKey);
        return decos ? DecorationSet.create(tr.doc, decos) : set.map(tr.mapping, tr.doc);
      },
    },
    props: { decorations: (st) => highlightKey.getState(st) },
  });
}
