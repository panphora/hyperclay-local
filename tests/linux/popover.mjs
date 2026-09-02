// Drive the packaged Electron app on Linux with Playwright's Electron driver: the
// tray-only app must create its popover window, render the served folder and the
// running server, and survive a click on every control the popover offers. Runs
// against the AppImage's extracted tree so the binary under test is the shipped one.
// Usage: node tests/linux/popover.mjs <executable> <home> <outdir>
import { _electron as electron } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [executablePath, home, outDir] = process.argv.slice(2);
if (!executablePath || !home || !outDir) { console.error('usage: popover.mjs <executable> <home> <outdir>'); process.exit(2); }
mkdirSync(outDir, { recursive: true });
const notes = [];
const note = (s) => { notes.push(s); console.log('ok   [popover] ' + s); };
const fail = (s) => { console.error('FAIL [popover] ' + s); writeFileSync(path.join(outDir, 'popover-notes.txt'), notes.join('\n') + '\nFAIL ' + s + '\n'); process.exit(1); };

const app = await electron.launch({
  executablePath,
  args: ['--no-sandbox'],
  env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') },
  timeout: 60000,
});
app.process().stderr.on('data', (d) => writeFileSync(path.join(outDir, 'popover-stderr.log'), d, { flag: 'a' }));

const win = await app.firstWindow({ timeout: 60000 });
note('popover window created (' + (await win.title() || 'untitled') + ')');

const info = await app.evaluate(async ({ BrowserWindow, app }) => {
  const w = BrowserWindow.getAllWindows()[0];
  w.show();
  return { windows: BrowserWindow.getAllWindows().length, userData: app.getPath('userData'), visible: w.isVisible(), bounds: w.getBounds(), name: app.getName(), version: app.getVersion() };
});
note(`app ${info.name} ${info.version}, ${info.windows} window(s), userData ${info.userData}, bounds ${JSON.stringify(info.bounds)}`);
if (!info.userData.includes('Hyperclay Local')) fail('userData is not under HyperclayLocal: ' + info.userData);

await win.waitForLoadState('domcontentloaded');
await win.waitForTimeout(2500);
await win.screenshot({ path: path.join(outDir, 'popover.png') });
const text = await win.evaluate(() => document.body.innerText);
writeFileSync(path.join(outDir, 'popover-text.txt'), text);
if (!/apps/.test(text)) fail('popover does not show the served folder; text was: ' + text.slice(0, 300));
note('popover shows the served folder');
let up = false;
for (let i = 0; i < 80 && !up; i++) {
  up = await fetch('http://127.0.0.1:4321/_/meta').then((r) => r.ok).catch(() => false);
  if (!up) await win.waitForTimeout(250);
}
if (!up) fail('the server did not answer on :4321 within 20s; popover text was: ' + text.slice(0, 300));
await win.waitForTimeout(500);
const running = await win.evaluate(() => document.body.innerText);
await win.screenshot({ path: path.join(outDir, 'popover-running.png') });
if (/\bOFF\b/.test(running)) fail('the server answers on :4321 but the popover toggle still says OFF; text was: ' + running.slice(0, 300));
note('popover shows the running server (toggle no longer OFF, /_/meta answers)');

// Every visible button must be clickable without the renderer throwing. Labels are
// read up front: a click can redraw the popover, and a locator by index would then
// wait on a button that no longer exists.
const errors = [];
win.on('pageerror', (e) => errors.push(String(e)));
const visibleButtons = win.locator('button:visible');
const total = await visibleButtons.count();
const labels = [];
for (let i = 0; i < total; i++) {
  const b = visibleButtons.nth(i);
  const label = (await b.textContent({ timeout: 2000 }).catch(() => '')) || (await b.getAttribute('aria-label', { timeout: 2000 }).catch(() => '')) || '';
  labels.push(label.trim());
}
note('buttons: ' + labels.map((l) => JSON.stringify(l)).join(' '));
let clicked = 0;
let gone = 0;
for (const label of labels) {
  if (!label || /quit|stop server|open in browser|open folder|choose|select|change/i.test(label)) continue;
  const b = win.locator('button:visible', { hasText: label }).first();
  if (!(await b.count())) { gone++; continue; }
  await b.click({ timeout: 3000 }).catch((e) => errors.push(label + ': ' + e.message));
  clicked++;
  await win.waitForTimeout(300);
}
note(`clicked ${clicked} of ${labels.length} popover buttons (${gone} redrawn away by earlier clicks) without a renderer error`);
if (errors.length) fail('renderer errors: ' + errors.join(' | '));
await win.screenshot({ path: path.join(outDir, 'popover-after-clicks.png') });

writeFileSync(path.join(outDir, 'popover-notes.txt'), notes.join('\n') + '\n');
await app.close();
