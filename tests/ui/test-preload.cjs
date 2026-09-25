// Loaded by src/main/main.js when HYPERCLAY_TEST_PRELOAD names this file (unpackaged builds only).
// It runs before the app reads its settings: userData moves to the test's folder, and every fetch
// to the app's default server (or the test host) goes to the test server on loopback, keeping the
// Host header the test server routes by. Mirrors tests/round-trip/desktop-driver.cjs.
const { app } = require('electron');
const { Agent } = require(process.env.UNDICI_PATH);

// safeStorage encrypts the API key with a keychain entry. The mock keychain keeps tests off the
// person's real one, and with a temp HOME there is no login keychain for macOS to find at all.
app.commandLine.appendSwitch('use-mock-keychain');
app.setPath('userData', process.env.HYPERCLAY_TEST_USER_DATA);
// `app.getPath('home')` is Electron's own answer, not `$HOME`'s: without this line the setup
// view's default team folder is `~/hyperclay/<team>` in the person's real home folder.
if (process.env.HYPERCLAY_TEST_HOME) app.setPath('home', process.env.HYPERCLAY_TEST_HOME);

const APP_HOST = process.env.APP_HOSTNAME;
const PORT = Number(process.env.APP_PORT);
const DEFAULT_HOSTS = new Set(['localhyperclay.com', 'hyperclay.com', APP_HOST]);
const dispatcher = new Agent({
  connect: {
    lookup(_h, options, cb) {
      const a = { address: '127.0.0.1', family: 4 };
      return options?.all ? cb(null, [a]) : cb(null, a.address, a.family);
    },
  },
});
const nativeFetch = global.fetch;
global.fetch = (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
  if (!DEFAULT_HOSTS.has(url.hostname)) return nativeFetch(input, init);
  url.protocol = 'http:';
  url.hostname = APP_HOST;
  url.port = String(PORT);
  return nativeFetch(url, { ...init, dispatcher });
};

// The suite drives the popover with Playwright, which works on a window that is never shown.
// Keeping every window hidden and unfocused stops test runs from covering the screen or taking
// focus; background throttling stays off so the hidden renderer still updates on time.
if (process.env.HYPERCLAY_TEST_SHOW_WINDOWS !== '1') {
  app.on('browser-window-created', (_event, win) => {
    for (const method of ['show', 'showInactive', 'focus', 'moveTop', 'setAlwaysOnTop']) win[method] = () => {};
    win.webContents.setBackgroundThrottling(false);
  });
  app.whenReady().then(() => app.dock?.hide());
}
