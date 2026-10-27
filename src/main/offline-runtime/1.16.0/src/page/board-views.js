import { state } from "../vendor/prosemirror.vendor.js";

// The card panels a board plugin can reach, filled by the board view part when it
// loads. The plugin works, and does nothing, for a board without a panel.
export const cardPanels = new WeakMap();

export function boardPlugin() {
  return new state.Plugin({
    view: (view) => ({
      update: () => cardPanels.get(view)?.sync(),
      destroy: () => {
        cardPanels.get(view)?.hide(false, false);
        cardPanels.delete(view);
      },
    }),
  });
}
