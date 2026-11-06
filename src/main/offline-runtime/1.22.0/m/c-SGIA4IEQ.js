import"./c-VHNSBD2M.js";var p=`.hcp {
  --hcp-ground: #FDF8F0;
  --hcp-surface: #FFFCF6;
  --hcp-sunk: #F4ECDF;
  --hcp-ink: #2B241B;
  --hcp-ink-2: #4A4033;
  --hcp-muted: #6B5942;
  --hcp-line: #E8DCC6;
  --hcp-line-2: #D8C8AF;
  --hcp-brass: #8F6310;
  --hcp-brass-soft: #F0E4CC;
  --hcp-face: #F1E7D4;
  --hcp-edge-hi: #FFF9ED;
  --hcp-edge-lo: #D6C3A5;
  --hcp-shadow: 0 1px 2px rgba(23, 28, 36, .06), 0 14px 34px -14px rgba(43, 36, 27, .32);
  --hcp-sans: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  --hcp-serif: Newsreader, Georgia, "Times New Roman", serif;
  --hcp-mono: "IBM Plex Mono", ui-monospace, Menlo, monospace;
  --hcp-lift: 0px;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  .hcp:not([data-hcp-theme="light"]) {
    --hcp-ground: #0B0C13; --hcp-surface: #11131E; --hcp-sunk: #1A1D2C;
    --hcp-ink: #ECEAF2; --hcp-ink-2: #C9CDE0; --hcp-muted: #8A90AB;
    --hcp-line: #262B42; --hcp-line-2: #353B52;
    --hcp-brass: #D9A445; --hcp-brass-soft: #3A2F17;
    --hcp-face: #22273E; --hcp-edge-hi: #3C4260; --hcp-edge-lo: #1B2033;
    --hcp-shadow: 0 1px 2px rgba(0, 0, 0, .4), 0 16px 38px -14px rgba(0, 0, 0, .7);
    color-scheme: dark;
  }
}
.hcp[data-hcp-theme="dark"] {
  --hcp-ground: #0B0C13; --hcp-surface: #11131E; --hcp-sunk: #1A1D2C;
  --hcp-ink: #ECEAF2; --hcp-ink-2: #C9CDE0; --hcp-muted: #8A90AB;
  --hcp-line: #262B42; --hcp-line-2: #353B52;
  --hcp-brass: #D9A445; --hcp-brass-soft: #3A2F17;
  --hcp-face: #22273E; --hcp-edge-hi: #3C4260; --hcp-edge-lo: #1B2033;
  --hcp-shadow: 0 1px 2px rgba(0, 0, 0, .4), 0 16px 38px -14px rgba(0, 0, 0, .7);
  color-scheme: dark;
}

.hcp, .hcp * , .hcp *::before, .hcp *::after {
  box-sizing: border-box; margin: 0; padding: 0; border: 0;
  font: inherit; letter-spacing: normal; text-transform: none; text-shadow: none;
  line-height: inherit; color: inherit; background: none; float: none; max-width: none;
}
.hcp {
  position: fixed; right: 16px; bottom: calc(16px + var(--hcp-lift)); z-index: 2147482000;
  display: flex; flex-direction: column; align-items: flex-end; gap: 10px;
  font-family: var(--hcp-sans); font-size: 14px; font-weight: 400; line-height: 1.5;
  color: var(--hcp-ink); text-align: left;
  -webkit-font-smoothing: antialiased;
  transition: bottom .25s ease, opacity .2s ease;
  pointer-events: none;
}
.hcp[hidden], .hcp[data-hcp-state="dismissed"], .hcp[data-hcp-state="off"] { display: none; }
.hcp[data-hcp-typing] { opacity: 0; visibility: hidden; }
.hcp > * { pointer-events: auto; }
.hcp svg {
  display: block; flex: none; width: 16px; height: 16px; line-height: 1;
  fill: none; stroke: none; stroke-width: 0; stroke-linecap: butt; stroke-linejoin: miter;
}
.hcp .hcp-x svg, .hcp .hcp-actions .hcp-btn svg, .hcp-tab svg, .hcp-file svg { fill: currentColor; }
.hcp .hcp-file svg { width: 20px; height: 20px; }
.hcp .hcp-tab svg { width: 16px; height: 18px; }
.hcp .hcp-dock .hcp-x svg { width: 12px; height: 12px; }
.hcp button, .hcp a { border-radius: 0; line-height: 1.5; }

.hcp-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
  height: 34px; min-height: 0; padding: 0 14px;
  font-family: var(--hcp-sans); font-size: 14px; font-weight: 500; line-height: 1.5;
  white-space: nowrap; text-decoration: none; cursor: pointer; user-select: none;
  color: var(--hcp-ink); background: var(--hcp-face);
  border: 2px solid; border-radius: 0;
  border-color: var(--hcp-edge-hi) var(--hcp-edge-lo) var(--hcp-edge-lo) var(--hcp-edge-hi);
  outline: none;
}
.hcp .hcp-btn:hover { background: color-mix(in srgb, var(--hcp-face), var(--hcp-edge-hi) 45%); color: var(--hcp-ink); }
.hcp-btn:active { border-color: var(--hcp-edge-lo) var(--hcp-edge-hi) var(--hcp-edge-hi) var(--hcp-edge-lo); }
.hcp-btn:active > span { translate: 1px 1px; }
.hcp-btn > span { display: inline-flex; align-items: center; gap: 7px; }
.hcp-btn:focus-visible, .hcp-x:focus-visible, .hcp-quiet:focus-visible { outline: 2px solid var(--hcp-brass); outline-offset: 2px; }
.hcp-btn--primary {
  --hcp-face: var(--hcp-ink);
  --hcp-edge-hi: color-mix(in srgb, var(--hcp-ink), white 24%);
  --hcp-edge-lo: color-mix(in srgb, var(--hcp-ink), black 32%);
  color: var(--hcp-ground);
}
.hcp .hcp-btn--primary:hover { background: color-mix(in srgb, var(--hcp-ink), var(--hcp-ground) 12%); color: var(--hcp-ground); }

.hcp-dock { display: flex; align-items: stretch; box-shadow: 0 6px 16px -8px rgba(43, 36, 27, .45); }
.hcp:not([data-hcp-arrived]) .hcp-dock { animation: hcp-arrive 2.4s cubic-bezier(.16, 1, .3, 1) 3s both; }
@keyframes hcp-arrive { from { transform: translateX(calc(100% + 48px)); } to { transform: none; } }
.hcp-tab { font-size: 13.5px; padding: 0 12px 0 10px; }
.hcp-tab svg { color: var(--hcp-brass); }
.hcp-dock .hcp-x {
  width: 26px; height: 34px; min-height: 0; border-radius: 0; display: inline-flex; align-items: center; justify-content: center;
  background: var(--hcp-face); color: var(--hcp-muted); cursor: pointer;
  border: 2px solid; border-left: 0;
  border-color: var(--hcp-edge-hi) var(--hcp-edge-lo) var(--hcp-edge-lo) var(--hcp-edge-hi);
}
.hcp .hcp-dock .hcp-x:hover { color: var(--hcp-ink); background: var(--hcp-face); }
.hcp-tab__label { display: inline; }
.hcp-tab__mini { display: none; }
.hcp[data-hcp-state="mini"] .hcp-tab__mini { display: inline; }
.hcp[data-hcp-state="mini"] .hcp-tab__label,
.hcp[data-hcp-state="mini"] .hcp-dock .hcp-x { display: none; }
.hcp[data-hcp-state="card"] .hcp-dock { display: none; }

.hcp-card {
  display: none; position: relative;
  width: min(360px, calc(100vw - 32px)); max-height: calc(100dvh - 32px - var(--hcp-lift)); overflow: auto;
  background: var(--hcp-surface); border: 1px solid var(--hcp-line-2); border-top: 3px solid var(--hcp-brass);
  box-shadow: var(--hcp-shadow);
  padding: 18px 20px 16px;
}
.hcp[data-hcp-state="card"] .hcp-card { display: block; animation: hcp-rise .32s cubic-bezier(.2, .8, .3, 1) both; }
@keyframes hcp-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }

.hcp-card .hcp-x {
  position: absolute; top: 12px; right: 12px; width: 24px; height: 24px; min-height: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--hcp-line-2); border-radius: 3px; background: var(--hcp-surface);
  color: var(--hcp-muted); cursor: pointer;
}
.hcp .hcp-card .hcp-x:hover { color: var(--hcp-ink); border-color: var(--hcp-muted); background: var(--hcp-surface); }
.hcp .hcp-card .hcp-x svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2; }
.hcp-kicker {
  display: flex; align-items: center; gap: 8px;
  font-family: var(--hcp-mono); font-size: 11px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase;
  color: var(--hcp-brass); margin-bottom: 8px;
}
.hcp-title {
  font-family: var(--hcp-serif); font-size: 23px; font-weight: 500; line-height: 1.18;
  color: var(--hcp-ink); padding-right: 26px; margin-bottom: 10px;
  font-variation-settings: "opsz" 36;
}
.hcp-title [data-hcp-for] { display: none; }
.hcp[data-hcp-reason="use"] .hcp-title [data-hcp-for="use"],
.hcp[data-hcp-reason="open"] .hcp-title [data-hcp-for="open"],
.hcp[data-hcp-reason="return"] .hcp-title [data-hcp-for="return"],
.hcp[data-hcp-reason="error"] .hcp-title [data-hcp-for="error"] { display: inline; }
.hcp-body [data-hcp-for] { display: none; }
.hcp[data-hcp-reason="use"] .hcp-body [data-hcp-for="use"], .hcp[data-hcp-reason="open"] .hcp-body [data-hcp-for="open"], .hcp[data-hcp-reason="return"] .hcp-body [data-hcp-for="return"], .hcp[data-hcp-reason="error"] .hcp-body [data-hcp-for="error"] { display: inline; }
.hcp-body { font-size: 14px; line-height: 1.55; color: var(--hcp-ink-2); }
.hcp-file {
  display: flex; align-items: center; gap: 10px; margin: 12px 0 14px;
  padding: 9px 11px; background: var(--hcp-sunk); border: 1px solid var(--hcp-line);
}
.hcp-file svg { color: var(--hcp-brass); }
.hcp-file b { display: block; font-family: var(--hcp-sans); font-size: 14px; font-weight: 600; color: var(--hcp-ink); overflow-wrap: anywhere; }
.hcp-file small { display: block; font-size: 12px; color: var(--hcp-muted); line-height: 1.4; }
.hcp-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.hcp-actions .hcp-btn--primary { flex: 1 1 auto; }
.hcp-foot { margin-top: 12px; display: flex; justify-content: flex-end; }
.hcp-quiet {
  min-height: 0; border-radius: 0;
  font-size: 12px; color: var(--hcp-muted); cursor: pointer;
  text-decoration: underline; text-underline-offset: 2px; text-decoration-color: var(--hcp-line-2);
  white-space: nowrap;
}
.hcp .hcp-quiet:hover { color: var(--hcp-ink); background: none; }

@media (max-width: 480px) {
  .hcp { right: 12px; bottom: calc(12px + var(--hcp-lift)); }
  .hcp-card { width: calc(100vw - 24px); padding: 16px 16px 14px; max-height: min(70dvh, calc(100dvh - 24px - var(--hcp-lift))); }
  .hcp-title { font-size: 21px; }
}
@media (pointer: coarse) {
  .hcp-btn, .hcp-dock .hcp-x, .hcp-card .hcp-x { min-height: 44px; }
  .hcp-card .hcp-x { width: 44px; height: 44px; top: 6px; right: 6px; }
  .hcp-quiet { display: inline-flex; align-items: center; min-height: 44px; }
}
@media (prefers-reduced-motion: reduce) {
  .hcp { transition: none; }
  .hcp[data-hcp-state="card"] .hcp-card { animation: none; }
  .hcp:not([data-hcp-arrived]) .hcp-dock { animation: hcp-arrive-fade .4s ease 3s both; }
  @keyframes hcp-arrive-fade { from { opacity: 0; } to { opacity: 1; } }
  .hcp-btn:active > span { translate: none; }
}
@media (forced-colors: active) {
  .hcp-btn, .hcp-dock .hcp-x { border: 1px solid ButtonText; }
  .hcp-card { border: 1px solid CanvasText; }
}
@media print { .hcp { display: none; } }
`;export{p as PROMPT_CSS};
