// Single source of truth for the tray popover window size.
// Consumed by src/main/popover.js (the real Electron window) and by
// scripts/screenshot-popover.js (so marketing captures match the real window).
module.exports = {
  PANEL_WIDTH: 340,
  PANEL_HEIGHT: 500,
};
