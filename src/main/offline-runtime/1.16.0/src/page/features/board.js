import { BOARD_CSS } from "../board-style.js";
import { BoardView } from "../board-view.js";
import { cardPanel } from "../board-panel.js";

export function createFeature({ board = null, undo = null, redo = null } = {}) {
  return {
    id: "board",
    nodeViews: board ? { board: (node, view, getPos) => new BoardView(node, view, getPos, { commands: board, undo, redo, panel: cardPanel(view) }) } : null,
    css: board ? BOARD_CSS : null,
    dispose() {},
  };
}
