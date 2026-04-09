const { BrowserWindow, screen } = require('electron');
const path = require('upath');

const PANEL_WIDTH = 300;
const PANEL_HEIGHT = 400;
const MARGIN_Y = 4;

let popoverWindow = null;
let lastBlurTime = 0;
let ignoreBlur = false;
let sticky = false;

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
    if (sticky) return;
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

  // Detect whether the tray is in the bottom or top half of the screen
  // to decide whether the popover should appear above or below it
  const displayBounds = display.bounds;
  const trayCenterY = trayBounds.y + trayBounds.height / 2;
  const screenMidY = displayBounds.y + displayBounds.height / 2;
  const trayAtBottom = trayCenterY > screenMidY;

  let y;
  let arrowPosition;
  if (trayAtBottom) {
    y = Math.round(trayBounds.y - height - MARGIN_Y);
    arrowPosition = 'bottom';
  } else {
    y = Math.round(trayBounds.y + trayBounds.height + MARGIN_Y);
    arrowPosition = 'top';
  }

  x = clamp(x, workArea.x, workArea.x + workArea.width - width);
  // When the tray is at the bottom, use full display bounds for the y clamp
  // since the tray itself is outside the workArea (which excludes the taskbar)
  const yBounds = trayAtBottom ? displayBounds : workArea;
  y = clamp(y, yBounds.y, yBounds.y + yBounds.height - height);

  popoverWindow.setPosition(x, y, false);

  const rawArrowX = Math.round(trayBounds.x + trayBounds.width / 2 - x);
  const arrowX = clamp(rawArrowX, 16, width - 16);
  popoverWindow.webContents.send('popover-arrow-x', arrowX);
  popoverWindow.webContents.send('popover-arrow-position', arrowPosition);
}

function showPopover(trayBounds) {
  if (!popoverWindow) createPopoverWindow();

  ignoreBlur = true;
  positionPopover(trayBounds);

  if (sticky) {
    // Dev debugging mode: show in the background without stealing focus
    // or floating above the user's other windows, so an agent-browser
    // debugging session can stay open without interrupting real work.
    popoverWindow.setAlwaysOnTop(false);
    popoverWindow.showInactive();
  } else {
    popoverWindow.setAlwaysOnTop(true, 'pop-up-menu');
    popoverWindow.show();
    popoverWindow.focus();
  }

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

function setSticky(on) {
  sticky = !!on;
}

function isSticky() {
  return sticky;
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
  setSticky,
  isSticky,
  getPopoverWindow,
  destroyPopover,
};
