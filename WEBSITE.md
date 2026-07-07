# hyperclaylocal.com Marketing Page

`website/index.html` is the standalone marketing page for `https://hyperclaylocal.com/`. It presents Hyperclay Local as a free, local-first desktop app for self-saving HTML applications and links directly to the current platform installers.

## What It Includes

- A static, no-build page in `website/`.
- Local UI/runtime assets: `mirk.css`, `mirk.js`, `sap.min.js`, `assets/app-popover.png`, and the vendored Departure Mono font files.
- SEO and social metadata for `https://hyperclaylocal.com/`.
- A sticky header with section navigation, GitHub link, and persisted light/dark toggle.
- An OS-aware hero download button backed by the canonical download list.
- An interactive hero: transparent hotspots over the popover screenshot let visitors click the SERVER/SYNC toggles and the bell to swap between the five captured UI states.
- Live in-page SAP demos for example single-file apps.
- Example malleable HTML snippets for HyperclayJS and plain JavaScript.
- FAQ and troubleshooting content for installation, source builds, saving, and safety.

## How To Use It

Open `website/index.html` directly in a browser, or serve the directory with any static file server:

```bash
cd hyperclay-local/website
python3 -m http.server 8080
```

There is no compile step and no CDN dependency for the page itself. Deploy the whole `website/` directory so the local CSS, JavaScript, image, and font paths keep resolving.

Run the website-specific checks from the package root:

```bash
npm test -- tests/website
```

These Jest tests parse the shipped HTML and execute the page's inline behavior scripts against a small test DOM.

## Updating Downloads

The download list in `#downloads` is the single source of truth. When bumping the page to a new app release, update:

- `#downloads[data-version]`
- the four download filenames and `href` values
- the four visible file sizes

The hero download button reads that static list at runtime. It chooses macOS, Windows, or desktop Linux from the user agent; macOS defaults to Apple Silicon and switches to Intel only when `navigator.userAgentData` reports an x86 architecture. Mobile and unknown platforms fall back to the full download list.

Keep the static list usable without JavaScript. The hero button should still point to `#downloads`, and every row should remain a plain HTTPS download link.

## Regenerating the popover screenshots

The hero images in `assets/` are captured from the REAL popover renderer, not a mock, so they always match the shipping UI. One command rebuilds the bundle and recaptures every state:

```bash
npm run screenshot:setup     # one time: downloads the Chromium used for capture
npm run screenshot:popover   # builds css+react, writes assets/app-popover-*.png
```

It loads the actual `src/renderer/popover.html` in headless Chromium with a stubbed `electronAPI` seeded to each state, and screenshots `#root` at the real window size (300x460) times deviceScaleFactor 2 → 600x920 retina. Captured states: `on-on`, `on-off`, `off-off`, `off-on` (the SERVER/SYNC matrix) and `notices`. `app-popover.png` is kept as an alias of the `on-on` hero.

- States live in `scripts/popover-scenarios.js` (data only; user is `@panphora`).
- The engine is `scripts/screenshot-popover.js`; it asserts its `electronAPI` stub covers every method the real `src/main/popover-preload.js` exposes, so a UI change that starts calling a new method fails loudly instead of silently mis-rendering.
- Capture size follows the real window via the shared `src/main/popover-dimensions.js`.
- Single state / custom output: `node scripts/screenshot-popover.js --scenario notices --outdir /tmp --scale 2`.

Re-run this after any change to the popover UI.

### Interactive hero

The hero `#hero-shot` frame holds one `<img id="hero-img">` plus four transparent `.shot-hotspot` buttons positioned (in %) over the SERVER rocker, SYNC rocker, bell, and the notices back-arrow. A small inline script tracks `(server, sync, view)` and swaps `img.src`/`img.alt` between the five PNGs; the back arrow returns to the last toggle combo. Hotspot positions are percentages of the 300x460 frame, so they stay aligned as the shot scales. If the popover layout moves a control, nudge the matching `.shot-hotspot--*` rule.

## Design Notes

The page is intentionally self-contained. `mirk.css` supplies the UI kit and theme tokens, while `index.html` owns the page-specific layout and copy. The root element uses `data-theme="full-volume"` to align the page palette with the app popover screenshot.

Theme state uses the `hcl-theme` localStorage key. A small guard script runs before `mirk.css` loads to avoid a wrong-theme flash; the footer script updates the toggle icon, ARIA state, and persisted mode. With no saved choice, the page follows the OS color scheme.

The SAP demos are embedded examples, not separate app files. Their collection templates, `trigger-add` forms, detail panes, computed totals, and tab/panel ARIA relationships are covered by `tests/website/marketing-page.structure.test.js`.

## Maintenance Checklist

- Keep local references in `index.html` resolvable inside `website/`.
- Preserve the `#downloads` source-of-truth contract when changing release links.
- Preserve tab and panel ARIA pairings for both demo tabs and code-example tabs.
- Keep `target="_blank"` links paired with `rel="noopener"`.
- Run `npm test -- tests/website` after changing markup, downloads, theme behavior, or live demos.
