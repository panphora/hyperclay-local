const { BrowserWindow, screen } = require('electron');
const path = require('upath');

const PANEL_WIDTH = 300;
const PANEL_HEIGHT = 400;
const MARGIN_Y = 4;

let popoverWindow = null;
let lastBlurTime = 0;
let ignoreBlur = false;

function createPopoverWindow() {
  popoverWindow = new BrowserWindow({
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true,
    ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'popover-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  popoverWindow.loadFile(path.join(__dirname, '../renderer/popover.html'));

  popoverWindow.setAlwaysOnTop(true, 'pop-up-menu');
  popoverWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (typeof popoverWindow.setHiddenInMissionControl === 'function') {
    popoverWindow.setHiddenInMissionControl(true);
  }

  popoverWindow.on('blur', () => {
    if (ignoreBlur) return;
    if (popoverWindow && popoverWindow.isVisible()) {
      lastBlurTime = Date.now();
      popoverWindow.hide();
    }
  });

  popoverWindow.on('closed', () => {
    popoverWindow = null;
  });

  return popoverWindow;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(n, max));
}

function positionPopover(trayBounds) {
  if (!popoverWindow) return;

  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  const workArea = display.workArea;
  const { width, height } = popoverWindow.getBounds();

  let x = Math.round(trayBounds.x + trayBounds.width / 2 - width / 2);
  let y = Math.round(trayBounds.y + trayBounds.height + MARGIN_Y);

  x = clamp(x, workArea.x, workArea.x + workArea.width - width);
  y = clamp(y, workArea.y, workArea.y + workArea.height - height);

  popoverWindow.setPosition(x, y, false);

  const rawArrowX = Math.round(trayBounds.x + trayBounds.width / 2 - x);
  const arrowX = clamp(rawArrowX, 16, width - 16);
  popoverWindow.webContents.send('popover-arrow-x', arrowX);
}

function showPopover(trayBounds) {
  if (!popoverWindow) createPopoverWindow();

  ignoreBlur = true;
  positionPopover(trayBounds);
  popoverWindow.show();
  popoverWindow.focus();

  setTimeout(() => {
    ignoreBlur = false;
  }, 150);
}

function hidePopover() {
  if (!popoverWindow || !popoverWindow.isVisible()) return;
  ignoreBlur = true;
  popoverWindow.hide();
  setTimeout(() => {
    ignoreBlur = false;
  }, 150);
}

function togglePopover(trayBounds) {
  if (!trayBounds) return;

  if (!popoverWindow) {
    showPopover(trayBounds);
    return;
  }

  const timeSinceBlur = Date.now() - lastBlurTime;
  if (timeSinceBlur < 200) {
    return;
  }

  if (popoverWindow.isVisible()) {
    hidePopover();
  } else {
    showPopover(trayBounds);
  }
}

function getPopoverWindow() {
  return popoverWindow;
}

function destroyPopover() {
  if (popoverWindow) {
    popoverWindow.destroy();
    popoverWindow = null;
  }
}

module.exports = {
  createPopoverWindow,
  togglePopover,
  showPopover,
  hidePopover,
  getPopoverWindow,
  destroyPopover,
};
