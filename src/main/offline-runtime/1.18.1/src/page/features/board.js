import { BOARD_CSS } from "../board-style.js";
import { BoardView } from "../board-view.js";
import { cardPanel } from "../board-panel.js";
import { cardPanels } from "../board-views.js";
import { addViewHook } from "../view-hooks.js";

export function createFeature({ view = null, board = null, undo = null, redo = null } = {}) {
  const off = view ? addViewHook(view, {
    update: (editorView) => cardPanels.get(editorView)?.sync(),
    destroy: (editorView) => {
      cardPanels.get(editorView)?.hide(false, false);
      cardPanels.delete(editorView);
    },
  }) : () => {};
  return {
    id: "board",
    nodeViews: board ? { board: (node, editorView, getPos) => new BoardView(node, editorView, getPos, { commands: board, undo, redo, panel: cardPanel(editorView) }) } : null,
    css: board ? BOARD_CSS : null,
    dispose() { off(); },
  };
}
