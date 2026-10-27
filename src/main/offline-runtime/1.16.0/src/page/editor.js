// The page editor: a ProseMirror view over the flat block document, with the
// list, toggle, move, collapse and paste behaviour of blocks.js and the chrome
// of chrome.js. Local editing only; the live record and sync attach elsewhere.
//
// Theming: the base look below is built on --page-* tokens and sits in the
// `page` cascade layer, so a theme is one plain stylesheet that sets tokens on
// .page-shell (and adds scoped rules where it needs to); unlayered theme rules
// always win. Contract: plans/.../default-page/v1/look/THEME-CONTRACT.md
import { state, view as pmView, model, keymap, commands, history, gapcursor, inputrules } from "../vendor/prosemirror.vendor.js";
import { schema } from "./schema.js";
import { identityPlugin, docFromBlocks, blockMap, keyBetween, newId } from "./model.js";
import { blockKeys, structurePlugin, collapsePlugin, pastePlugin, BlockSelection, STEP } from "./blocks.js";
import { chromePlugin, slashRangePlugin } from "./chrome.js";
import { announcementPlugin } from "./announce.js";
import { linkPlugin } from "./link.js";
import { blockSelectionPlugin, asStep } from "./blocksel.js";
import { markdownPlugin, markdownKeys, backspaceToParagraph, composing } from "./markdown.js";
import { placeholderPlugin } from "./placeholder.js";
import { titlePlugin } from "./document-title-runtime.js";
import { mediaPlugin } from "./media.js";
import { highlightSlot } from "./highlight-slot.js";
import { tableKeys, tablePlugin } from "./table.js";
import { tableSelectPlugin } from "./table-select.js";
import { chartPlugin, ChartView } from "./chart.js";
import { boardPlugin } from "./board-views.js";
import { checklistPlugin, checklistKeys } from "./checklist.js";
import { csvImportPlugin } from "./csv-import.js";
import { styleWithLegacyId } from "../lib/style.js";
import { historyIntentPlugin } from "./history-intent.js";
import { createFeatureLoader } from "./feature-loader.js";
import { COMMAND_FEATURES, FEATURES, featureForType } from "./features/registry.js";
import { toolViews } from "./tool-views.js";

const STYLE_ID = "page-editor-style";
const INDENTS = [1, 2, 3, 4, 5, 6, 7, 8];

const LIGHT = `
  --page-bg: #F7F6F2; --page-ink: #23221F; --page-ink-soft: #6B6862; --page-ink-faint: #9B968C;
  --page-rule: rgba(35, 34, 31, 0.10); --page-accent: #2F5E9E; --page-link: #164583; --page-selection: rgba(88, 120, 170, 0.20);
  --page-check-border: rgba(35, 34, 31, 0.35); --page-check-fill: #23221F; --page-check-ink: #F7F6F2;
  --page-callout-bg: rgba(35, 34, 31, 0.04); --page-code-bg: rgba(35, 34, 31, 0.05);
  --page-code-token-keyword: #8A3B6E; --page-code-token-constant: #1F5A8A; --page-code-token-string: #3E6A28; --page-code-token-string-expression: #3E6A28; --page-code-token-comment: #8B877E; --page-code-token-function: #5E4596; --page-code-token-parameter: #8A5A1E; --page-code-token-punctuation: var(--page-ink-soft); --page-code-token-link: var(--page-link);
  --page-chrome-ink-rest: rgba(35, 34, 31, 0.20); --page-chrome-ink-moved: rgba(35, 34, 31, 0.34);
  --page-chrome-bg-rest: rgba(35, 34, 31, 0.02); --page-chrome-bg-moved: rgba(35, 34, 31, 0.04);
  --page-chrome-line-rest: rgba(35, 34, 31, 0.06); --page-chrome-line-moved: rgba(35, 34, 31, 0.11);
  --page-pop-bg: #FBFAF7; --page-pop-ink: #23221F; --page-pop-muted: #6B6862; --page-pop-line: rgba(35, 34, 31, 0.10);
  --page-pop-shadow: 0 1px 2px rgba(35, 34, 31, 0.05), 0 8px 24px rgba(35, 34, 31, 0.08); --page-pop-hover: rgba(35, 34, 31, 0.06);
  --page-scrim: rgba(35, 34, 31, 0.12);
  --page-danger: #9E3B2F; --page-block-selected: rgba(88, 120, 170, 0.12);`;

const DARK = `
  --page-bg: #1A1A18; --page-ink: #E7E4DC; --page-ink-soft: #A3A098; --page-ink-faint: #75726B;
  --page-rule: rgba(231, 228, 220, 0.10); --page-accent: #8DB0E6; --page-link: #8DB0E6; --page-selection: rgba(120, 155, 210, 0.28);
  --page-check-border: rgba(231, 228, 220, 0.35); --page-check-fill: #E7E4DC; --page-check-ink: #1A1A18;
  --page-callout-bg: rgba(231, 228, 220, 0.05); --page-code-bg: rgba(231, 228, 220, 0.06);
  --page-code-token-keyword: #D9A0C8; --page-code-token-constant: #8DB0E6; --page-code-token-string: #A9C98B; --page-code-token-string-expression: #A9C98B; --page-code-token-comment: #75726B; --page-code-token-function: #BBA6E6; --page-code-token-parameter: #E0B47A; --page-code-token-punctuation: var(--page-ink-soft); --page-code-token-link: var(--page-link);
  --page-chrome-ink-rest: rgba(231, 228, 220, 0.18); --page-chrome-ink-moved: rgba(231, 228, 220, 0.30);
  --page-chrome-bg-rest: rgba(231, 228, 220, 0.02); --page-chrome-bg-moved: rgba(231, 228, 220, 0.04);
  --page-chrome-line-rest: rgba(231, 228, 220, 0.06); --page-chrome-line-moved: rgba(231, 228, 220, 0.11);
  --page-pop-bg: #222220; --page-pop-ink: #E7E4DC; --page-pop-muted: #A3A098; --page-pop-line: rgba(231, 228, 220, 0.10);
  --page-pop-shadow: 0 1px 2px rgba(10, 10, 9, 0.3), 0 10px 28px rgba(10, 10, 9, 0.35); --page-pop-hover: rgba(231, 228, 220, 0.07);
  --page-scrim: rgba(10, 10, 9, 0.35);
  --page-danger: #E08A7A; --page-block-selected: rgba(120, 155, 210, 0.18);
  --chart-1: #8DB0E6; --chart-2: #D9A0C8; --chart-3: #A9C98B; --chart-4: #BBA6E6; --chart-5: #E0B47A; --chart-6: #A3A098;`;

export const PAGE_EDITOR_CSS = `
@layer page {
:where(article[data-page], .page-shell) {${LIGHT}
  --chart-1: #2F5E9E; --chart-2: #164583; --chart-3: #5B5953; --chart-4: #8A3B6E; --chart-5: #3E6A28; --chart-6: #8A5A1E;
  --page-ink-strong: var(--page-ink); --page-caret: var(--page-accent);
  --page-font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; --page-font-display: var(--page-font); --page-font-heading: var(--page-font);
  --page-font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --page-font-size: 17px; --page-line-height: 1.65; --page-measure: 680px; --page-pad-top: 72px;
  --page-h1-size: 34px; --page-h1-weight: 600; --page-h1-tracking: -0.01em; --page-h1-line: 1.2;
  --page-h2-size: 21px; --page-h2-weight: 600; --page-h3-size: 17px; --page-h3-weight: 600;
  --page-block-gap: 0.35em; --page-indent: 1.6em;
  --page-marker: var(--page-ink-soft); --page-bullet-size: 0.36em; --page-check-size: 16px; --page-check-radius: 4px; --page-done-ink: var(--page-ink-faint);
  --page-toggle-ink: var(--page-ink-soft); --page-callout-line: transparent; --page-code-ink: var(--page-ink);
  --page-chrome-shadow-rest: none; --page-chrome-shadow-moved: none; --page-chrome-radius: 7px; --page-plus-size: 24px; --page-fade: 240ms;
  --page-pop-radius: 10px; --page-bar-bg: var(--page-pop-bg); --page-bar-ink: var(--page-pop-ink);
}
@media (prefers-color-scheme: dark) { :where(:root:not([data-theme="light"]) :is(article[data-page], .page-shell)) {${DARK} } }
:where(:root[data-theme="dark"] :is(article[data-page], .page-shell)) {${DARK} }

.page-shell { position: relative; background: var(--page-bg); color: var(--page-ink); font-family: var(--page-font); font-size: var(--page-font-size); line-height: var(--page-line-height); padding: 0 16px; }
.page-editor { max-width: var(--page-measure); margin: 0 auto; padding: var(--page-pad-top) 0 30vh; outline: none; white-space: pre-wrap; overflow-wrap: break-word; caret-color: var(--page-caret); }
:where(article[data-page], .page-editor) ::selection { background: var(--page-selection); }
:where(article[data-page], .page-editor) > * { margin: var(--page-block-gap) 0; margin-inline-start: calc(var(--page-depth, 0) * var(--page-indent)); }
:where(article[data-page], .page-editor) > h1 { font-family: var(--page-font-display); font-size: var(--page-h1-size); font-weight: var(--page-h1-weight); letter-spacing: var(--page-h1-tracking); line-height: var(--page-h1-line); color: var(--page-ink-strong); margin-block: 0 0.6em; }
:where(article[data-page], .page-editor) > h2 { font-family: var(--page-font-heading); font-size: var(--page-h2-size); font-weight: var(--page-h2-weight); color: var(--page-ink-strong); line-height: 1.35; margin-block-start: 1.4em; }
:where(article[data-page], .page-editor) > h3 { font-family: var(--page-font-heading); font-size: var(--page-h3-size); font-weight: var(--page-h3-weight); color: var(--page-ink-strong); margin-block-start: 1.2em; }
:where(article[data-page], .page-editor) a { color: var(--page-link, var(--page-accent)); }
:where(article[data-page], .page-editor) code { font-family: var(--page-font-mono); font-size: 0.88em; background: var(--page-code-bg); color: var(--page-code-ink); border-radius: 4px; padding: 0.1em 0.3em; }
:where(article[data-page], .page-editor) pre { font-family: var(--page-font-mono); font-size: 0.88em; background: var(--page-code-bg); color: var(--page-code-ink); border-radius: 8px; padding: 12px 14px; }
:where(article[data-page], .page-editor) pre code { background: none; padding: 0; font-size: inherit; }
:where(article[data-page], .page-editor) pre { position: relative; padding-top: 32px; white-space: pre-wrap; overflow-wrap: anywhere; }
:where(article[data-page], .page-editor) pre[data-lang] { white-space: pre; overflow-wrap: normal; }
:where(article[data-page], .page-editor) pre[data-lang] > code { display: block; overflow-x: auto; }
.page-code-lang { position: absolute; top: 5px; inset-inline-end: 6px; max-width: 120px; height: 24px; padding: 0 4px; border: 0; border-radius: 5px; background: none; color: var(--page-ink-faint); font: 12px/1 var(--page-font); opacity: 0; cursor: pointer; transition: opacity var(--page-fade); }
.page-editor pre:hover .page-code-lang, .page-editor pre:focus-within .page-code-lang, .page-code-lang:focus-visible, .page-editor pre[data-lang] .page-code-lang { opacity: 1; }
.page-code-lang:hover, .page-code-lang:focus-visible { background: var(--page-pop-hover); color: var(--page-ink-soft); }
:where(article[data-page], .page-editor) .page-callout { background: var(--page-callout-bg); border: 1px solid var(--page-callout-line); border-radius: 8px; padding: 10px 14px; }
:where(article[data-page], .page-editor) hr { border: 0; border-top: 1px solid var(--page-rule); margin-block: 1.2em; }
:where(article[data-page], .page-editor) .page-hidden { display: none; }
:where(article[data-page], .page-editor) .page-li { position: relative; --li-indent: 0; padding-inline-start: calc((var(--li-indent) + 1) * var(--page-indent)); }
${INDENTS.map((n) => `:where(article[data-page], .page-editor) .page-li[data-indent="${n}"] { --li-indent: ${n}; }`).join("\n")}
:where(article[data-page], .page-editor) .page-li::before { position: absolute; inset-inline-start: calc(var(--li-indent) * var(--page-indent)); width: var(--page-indent); text-align: center; color: var(--page-marker); content: "\\2022"; }
:where(article[data-page], .page-editor) .page-li[data-kind="bullet"]::before { content: ""; box-sizing: border-box; width: var(--page-bullet-size); height: var(--page-bullet-size); top: calc((1em * var(--page-line-height) - var(--page-bullet-size)) / 2); inset-inline-start: calc(var(--li-indent) * var(--page-indent) + (var(--page-indent) - var(--page-bullet-size)) / 2); border-radius: 50%; background: currentColor; }
:where(article[data-page], .page-editor) .page-li[data-kind="ordered"]::before { content: attr(data-marker); font-variant-numeric: tabular-nums; }
:where(article[data-page], .page-editor) .page-li[data-kind="check"]::before { content: ""; box-sizing: border-box; width: var(--page-check-size); height: var(--page-check-size); top: calc((1em * var(--page-line-height) - var(--page-check-size)) / 2); inset-inline-start: calc(var(--li-indent) * var(--page-indent) + (var(--page-indent) - var(--page-check-size)) / 2); border: 1px solid var(--page-check-border); border-radius: var(--page-check-radius); cursor: pointer; }
:where(article[data-page], .page-editor) .page-li[data-kind="check"][data-checked="true"]::before { background: var(--page-check-fill); border-color: var(--page-check-fill); }
:where(article[data-page], .page-editor) .page-li[data-kind="check"][data-checked="true"]::after { content: ""; position: absolute; width: var(--page-check-size); height: var(--page-check-size); top: calc((1em * var(--page-line-height) - var(--page-check-size)) / 2); inset-inline-start: calc(var(--li-indent) * var(--page-indent) + (var(--page-indent) - var(--page-check-size)) / 2); background: var(--page-check-ink); -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.8 8.4l2.9 2.9 5.5-6.4' fill='none' stroke='%23000' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / 72% no-repeat; mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.8 8.4l2.9 2.9 5.5-6.4' fill='none' stroke='%23000' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / 72% no-repeat; pointer-events: none; }
:where(article[data-page], .page-editor) .page-li[data-kind="check"][data-checked="true"] { color: var(--page-done-ink); text-decoration: line-through; }
:where(article[data-page], .page-editor) .page-toggle { position: relative; padding-inline-start: var(--page-indent); }
.page-editor .page-toggle-button { position: absolute; inset-inline-start: 0; top: 0; width: var(--page-indent); height: calc(1em * var(--page-line-height)); display: grid; place-items: center; border: 0; padding: 0; background: none; color: var(--page-toggle-ink); font: inherit; line-height: 1; cursor: pointer; transition: transform var(--page-fade); }
.page-editor .page-toggle-button::before { content: "\\25B8"; font-size: 1.4em; }
.page-editor .page-toggle[aria-expanded="true"] > .page-toggle-button { transform: rotate(90deg); }

.page-dock, .page-plus { color: var(--page-chrome-ink-rest); background: var(--page-chrome-bg-rest); border: 1px solid var(--page-chrome-line-rest); box-shadow: var(--page-chrome-shadow-rest); border-radius: var(--page-chrome-radius); transition: color var(--page-fade), background-color var(--page-fade), border-color var(--page-fade), box-shadow var(--page-fade); }
.page-shell.is-moved .page-dock, .page-shell.is-moved .page-plus { color: var(--page-chrome-ink-moved); background: var(--page-chrome-bg-moved); border-color: var(--page-chrome-line-moved); box-shadow: var(--page-chrome-shadow-moved); }
.page-dock { position: sticky; top: 12px; z-index: 3; display: flex; align-items: center; gap: 2px; width: max-content; margin: 12px auto 0; padding: 3px; }
/* One formatting bar at a time: the selection bar covers what the fixed bar offers. Hidden, not removed, so the page does not shift under the selection. */
.page-shell:has(.page-bubble:not([hidden])) .page-dock { visibility: hidden; }
.page-dock, .page-shell.is-moved .page-dock { background: var(--page-pop-bg); }
.page-dock + .page-editor { padding-top: max(16px, calc(var(--page-pad-top) - 48px)); }
.page-tool { display: inline-flex; align-items: center; justify-content: center; min-width: 28px; height: 28px; padding: 0 6px; border: 0; border-radius: 5px; background: none; color: inherit; font: 500 13px/1 var(--page-font); cursor: pointer; }
.page-tool:hover, .page-tool[aria-pressed="true"] { background: var(--page-pop-hover); }
.page-tool-turn { gap: 4px; padding: 0 8px; }
/* The phone's fourth control: everything the narrow bar folds away. */
.page-tool-more { display: none; }
.page-tool-sep { width: 1px; height: 16px; margin: 0 3px; background: currentColor; opacity: 0.5; }
.page-safe-probe { position: fixed; left: 0; bottom: 0; width: 0; height: 0; padding-bottom: env(safe-area-inset-bottom); visibility: hidden; pointer-events: none; }
.page-plus { position: absolute; z-index: 2; top: calc(var(--page-plus-top, 0px) - var(--page-plus-size) / 2); left: calc(var(--page-plus-left, 0px) - var(--page-plus-size) - 12px); width: var(--page-plus-size); height: var(--page-plus-size); display: grid; place-items: center; padding: 0; cursor: pointer; }
.page-plus[aria-expanded="true"] { color: var(--page-chrome-ink-moved); background: var(--page-chrome-bg-moved); }
.page-grip { position: absolute; z-index: 2; top: calc(var(--page-plus-top, 0px) - var(--page-grip-size, var(--page-plus-size)) / 2); left: calc(var(--page-plus-left, 0px) - var(--page-plus-size) - 12px - var(--page-grip-size, var(--page-plus-size)) - 2px); width: var(--page-grip-size, var(--page-plus-size)); height: var(--page-grip-size, var(--page-plus-size)); display: grid; place-items: center; padding: 0; border: 0; border-radius: var(--page-chrome-radius); background: none; color: var(--page-chrome-ink-moved); opacity: 0; cursor: grab; touch-action: none; transition: opacity var(--page-fade); }
.page-shell.is-moved .page-grip, .page-grip.is-on, .page-grip:focus-visible, .page-grip[aria-expanded="true"] { opacity: 1; }
.page-bubble, .page-menu { position: absolute; z-index: 4; background: var(--page-pop-bg); color: var(--page-pop-ink); border: 1px solid var(--page-pop-line); box-shadow: var(--page-pop-shadow); border-radius: var(--page-pop-radius); }
.page-bubble { display: flex; gap: 1px; padding: 3px; left: var(--page-pop-x, 0px); top: var(--page-pop-y, 0px); transform: translate(-50%, calc(-100% - 8px)); }
.page-menu { left: var(--page-pop-x, 0px); top: var(--page-pop-y, 0px); width: 260px; max-height: 340px; overflow-y: auto; padding: 6px; font-size: 14px; }
.page-menu-title { padding: 4px 10px 6px; color: var(--page-pop-muted); font-size: 12px; }
.page-menu-item { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 34px; padding: 4px 10px; border: 0; border-radius: 7px; background: none; color: inherit; font: inherit; text-align: start; cursor: pointer; }
.page-menu-item[aria-selected="true"], .page-menu-item.is-active, .page-menu-item:hover { background: var(--page-pop-hover); }
.page-menu-icon { display: grid; place-items: center; width: 24px; height: 24px; border: 1px solid var(--page-pop-line); border-radius: 6px; color: var(--page-pop-muted); font-size: 12px; flex: none; }
.page-menu-hint { margin-inline-start: auto; color: var(--page-pop-muted); font-size: 12px; }
.page-menu-text { display: flex; flex-direction: column; min-width: 0; }
.page-menu-desc { color: var(--page-pop-muted); font-size: 12px; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.page-menu-empty { padding: 8px 10px; color: var(--page-pop-muted); font-size: 13px; }
.page-shell.is-dragging, .page-shell.is-dragging .page-grip { cursor: grabbing; }
.page-shell[data-drop="none"] { cursor: no-drop; }
.page-drop { position: absolute; z-index: 3; left: var(--page-drop-x, 0px); top: var(--page-drop-y, 0px); width: var(--page-drop-w, 0px); height: 2px; margin-top: -1px; border-radius: 1px; background: var(--page-drop, var(--page-accent)); pointer-events: none; }
.page-shell.is-dragging .page-block-selected { opacity: 0.45; }
.page-editor.ProseMirror-hideselection { caret-color: transparent; }
.page-editor.ProseMirror-hideselection *::selection { background: transparent; }
.page-editor .page-block-selected { background: var(--page-block-selected, rgba(88, 120, 170, 0.12)); box-shadow: -6px 0 0 var(--page-block-selected, rgba(88, 120, 170, 0.12)), 6px 0 0 var(--page-block-selected, rgba(88, 120, 170, 0.12)); border-radius: 4px; }
.page-editor .page-link-pending { background: var(--page-selection); }
.page-link { position: absolute; z-index: 4; left: var(--page-pop-x, 0px); top: var(--page-pop-y, 0px); display: flex; align-items: center; gap: 2px; padding: 4px; max-width: min(420px, calc(100% - 32px)); background: var(--page-pop-bg); color: var(--page-pop-ink); border: 1px solid var(--page-pop-line); box-shadow: var(--page-pop-shadow); border-radius: var(--page-pop-radius); font-size: 14px; }
.page-link-input { flex: 1; min-width: 220px; height: 30px; padding: 0 8px; border: 0; border-radius: 6px; background: var(--page-pop-hover); color: inherit; font: inherit; outline: none; }
.page-link-input[aria-invalid="true"] { box-shadow: inset 0 0 0 1px var(--page-danger, #9E3B2F); }
.page-link-url { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 8px; color: var(--page-pop-muted); text-decoration: none; }
.page-link-btn { display: inline-grid; place-items: center; min-width: 30px; height: 30px; padding: 0 6px; border: 0; border-radius: 6px; background: none; color: inherit; font: inherit; cursor: pointer; }
.page-link-btn:hover { background: var(--page-pop-hover); }
.page-live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.ProseMirror-focused .page-placeholder::before { content: attr(data-placeholder); float: left; height: 0; color: var(--page-ink-faint); pointer-events: none; }
.page-editor .page-title-placeholder::before { content: attr(data-placeholder); float: left; height: 0; color: var(--page-ink-faint); pointer-events: none; }
.page-csv-error { margin: 8px 0; color: var(--page-danger); font-size: 14px; }
.page-editor .page-table { max-width: 100%; min-width: 0; border: 1px solid var(--page-rule); border-radius: 8px; }
.page-editor .page-chart { position: relative; max-width: 100%; min-width: 0; margin-inline: 0; color: var(--page-ink); }
.page-chart-plot svg { display: block; width: 100%; height: auto; color: var(--chart-text, var(--page-ink-soft)); font: 12px var(--page-font); }
.page-chart figcaption { color: var(--page-ink-soft); font-size: 0.88em; text-align: center; }
.page-chart-settings { display: block; margin: 8px auto 0; padding: 4px 10px; border: 1px solid var(--page-rule); border-radius: 6px; background: var(--page-pop-bg); color: var(--page-ink); font: inherit; cursor: pointer; }
.page-chart-title-input { display: block; width: min(100%, 24em); box-sizing: border-box; margin: 6px auto; padding: 4px 8px; border: 1px solid var(--page-rule); border-radius: 6px; background: var(--page-pop-bg); color: var(--page-ink); font: inherit; }
.page-table-scroll { max-width: 100%; overflow-x: auto; }
.page-table table { border-collapse: collapse; min-width: max-content; width: 100%; table-layout: auto; }
.page-table th, .page-table td { min-width: 120px; padding: 6px 10px; border-inline-end: 1px solid var(--page-rule); border-block-end: 1px solid var(--page-rule); text-align: start; white-space: pre-wrap; }
.page-table th { background: var(--page-code-bg); color: var(--page-ink-soft); font-weight: 600; }
.page-table th[data-kind="number"], .page-table td[data-kind="number"] { text-align: end; }
.page-table th[aria-sort="ascending"] button::after { content: " ↑"; }
.page-table th[aria-sort="descending"] button::after { content: " ↓"; }
.page-table th button, .page-table-row-menu, .page-check-chip { border: 0; border-radius: 5px; background: none; color: inherit; font: inherit; cursor: pointer; }
.page-table th button:hover, .page-table-row-menu:hover, .page-check-chip:hover { background: var(--page-pop-hover); }
.page-table-row-menu { opacity: 0; font-size: 12px; color: var(--page-ink-soft); }
.page-table tr:hover .page-table-row-menu, .page-table tr:focus-within .page-table-row-menu, .page-table-row-menu:focus-visible { opacity: 1; }
.page-check-controls { display: inline-flex; gap: 4px; margin-inline-start: 8px; color: var(--page-ink-soft); font-size: 0.78em; text-decoration: none; }
.page-check-controls[data-empty="true"] { opacity: 0; }
.page-li:hover .page-check-controls, .page-li:focus-within .page-check-controls { opacity: 1; }
.page-check-popup { display: inline-flex; gap: 4px; padding: 4px; background: var(--page-pop-bg); color: var(--page-pop-ink); border: 1px solid var(--page-pop-line); border-radius: var(--page-pop-radius); box-shadow: var(--page-pop-shadow); }
.page-check-popup input { font: inherit; color: inherit; background: var(--page-pop-bg); border: 1px solid var(--page-pop-line); }
.page-check-popup.page-check-owner { display: inline-block; width: min(280px, 80vw); padding: 8px 0; vertical-align: top; }
.page-board-owners { display: flex; flex-direction: column; gap: 6px; min-width: 0; padding-inline: 8px; }
.page-board-people { display: flex; flex-wrap: wrap; gap: 4px; }
.page-board-person { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px 0 4px; border: 1px solid var(--page-rule); border-radius: 14px; background: var(--page-pop-bg); color: var(--page-pop-ink); font: inherit; font-size: 13px; cursor: pointer; transition: background-color var(--page-fade), border-color var(--page-fade); }
.page-board-person.is-none { padding-inline-start: 10px; color: var(--page-pop-muted); }
.page-board-person:hover { background: var(--page-pop-hover); }
.page-board-person[aria-pressed="true"] { border-color: var(--page-accent); background: var(--page-selection); color: var(--page-pop-ink); }
.page-board-owner-input { width: 100%; height: 32px; box-sizing: border-box; padding: 0 8px; border: 1px solid var(--page-pop-line); border-radius: 7px; background: var(--page-pop-bg); color: var(--page-pop-ink); font: inherit; font-size: 14px; }
.page-board-owner-input::placeholder { color: var(--page-ink-faint); }
.page-board-face { flex: none; display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: var(--page-code-bg); box-shadow: inset 0 0 0 1px var(--page-rule); color: var(--page-ink-soft); font-size: 10.5px; font-weight: 600; line-height: 1; }
.page-scrim { display: none; }
.page-shell [hidden] { display: none !important; }
@media (max-width: 560px) {
  /* One fixed bar over the visual viewport, with the four controls a phone keeps.
     The bubble and the desktop-only tools stand down so nothing is doubled. */
  .page-dock { display: flex; position: fixed; left: 0; top: 8px; width: 204px; min-width: 204px; box-sizing: border-box; align-items: center; justify-content: center; gap: 4px; margin: 0; padding: 8px; z-index: 3; }
  .page-tool-desk { display: none; }
  .page-dock .page-tool-more { display: inline-flex; }
  .page-dock .page-tool { min-width: 44px; height: 44px; }
  .page-shell:has(.page-bubble:not([hidden])) .page-dock { visibility: visible; }
  .page-dock + .page-editor { padding-bottom: calc(72px + env(safe-area-inset-bottom)); }
  .page-plus { position: fixed; top: auto; left: 16px; bottom: calc(16px + env(safe-area-inset-bottom)); width: 44px; height: 44px; border-radius: 22px; }
  .page-grip { position: fixed; top: auto; left: 68px; bottom: calc(16px + var(--page-grip-lift, 0px) + env(safe-area-inset-bottom)); width: 44px; height: 44px; border-radius: 22px; opacity: 1; color: var(--page-chrome-ink-rest); background: var(--page-chrome-bg-rest); border: 1px solid var(--page-chrome-line-rest); }
  .page-bubble { display: none; }
  .page-scrim { display: block; position: fixed; inset: 0; z-index: 4; background: var(--page-scrim); }
  .page-menu { position: fixed; left: 0; top: 0; width: var(--page-pop-width, min(280px, calc(100vw - 16px))); max-height: min(70vh, var(--page-pop-max, 70vh)); overflow-y: auto; transform: translate(var(--page-pop-x, 0px), var(--page-pop-y, 0px)); z-index: 5; }
  .page-menu-item { min-height: 48px; font-size: 16px; }
  .page-link { position: fixed; left: 0; right: 0; top: auto; bottom: 0; max-width: none; padding: 8px 16px calc(8px + env(safe-area-inset-bottom)); border-radius: 0; border-width: 1px 0 0; }
  .page-link-input { min-width: 0; height: 44px; font-size: 16px; }
  .page-link-btn, .page-upload-btn { min-width: 44px; height: 44px; }
  .page-image-frame { width: 100% !important; }
  .page-image-handle { display: none; }
  .page-table th button, .page-table-row-menu, .page-check-chip, .page-check-popup button, .page-menu-item { min-height: 44px; }
  .page-board-owner-input { font-size: 16px; height: 44px; }
  .page-board-person { height: 44px; border-radius: 22px; }
}
@media (prefers-reduced-motion: reduce) {
  .page-dock, .page-plus, .page-grip, .page-toggle-button, .page-image-handle, .page-upload-bar > span, .page-board-person { transition: none; }
}
}
`;

const insertHardBreak = (st, dispatch) => {
  if (dispatch) dispatch(st.tr.replaceSelectionWith(schema.nodes.hard_break.create()).scrollIntoView());
  return true;
};

const editKeys = ({ history: useHistory = true, undo, redo } = {}) => ({
  "Mod-z": useHistory ? history.undo : () => { undo?.(); return true; },
  "Shift-Mod-z": useHistory ? history.redo : () => { redo?.(); return true; },
  "Mod-y": useHistory ? history.redo : () => { redo?.(); return true; },
  "Shift-Enter": insertHardBreak,
  "Mod-b": commands.toggleMark(schema.marks.strong),
  "Mod-i": commands.toggleMark(schema.marks.em),
});

const restoreShortcut = (st, dispatch, view) => {
  if (composing(null, view)) return false;
  return inputrules.undoInputRule(st, dispatch && ((tr) => dispatch(asStep(tr))));
};

const markKeys = {
  Backspace: commands.chainCommands(restoreShortcut, backspaceToParagraph),
  "Mod-e": commands.toggleMark(schema.marks.code),
  "Mod-Shift-s": commands.toggleMark(schema.marks.strike),
};

const defaultUpload = (file, options) => globalThis.clay?.upload?.(file, options) ?? Promise.resolve({ ok: false, code: "unavailable", msg: "File uploads are not available in this editor" });

const nodeViewRegistries = new WeakMap();

export const lazyViewsKey = new state.PluginKey("lazyViews");

// Stands in for a view part's node view until its type loads: the schema's own
// toDOM, and an update that asks to be recreated once the real view exists.
class PendingView {
  constructor(node, registry) {
    this.node = node;
    this.type = node.type;
    this.registry = registry;
    const { dom, contentDOM } = model.DOMSerializer.renderSpec(document, node.type.spec.toDOM(node));
    this.dom = dom;
    this.contentDOM = contentDOM ?? null;
  }
  update(node) { return node.type === this.type && !this.registry.has(node.type.name); }
}

// Recreates only the node views of the types that just loaded: one node
// decoration makes ProseMirror rebuild those nodes and no others.
export function lazyViewsPlugin() {
  return new state.Plugin({
    key: lazyViewsKey,
    state: {
      init: () => pmView.DecorationSet.empty,
      apply(tr) {
        const meta = tr.getMeta(lazyViewsKey);
        if (!meta) return pmView.DecorationSet.empty;
        const decorations = [];
        tr.doc.forEach((node, offset) => {
          if (!meta.types.includes(node.type.name)) return;
          decorations.push(pmView.Decoration.node(offset, offset + node.nodeSize, {}, { lazyView: decorations.length + 1 }));
        });
        return pmView.DecorationSet.create(tr.doc, decorations);
      },
    },
    props: { decorations: (state) => lazyViewsKey.getState(state) },
  });
}

// Adds a view part to a running editor: its CSS at once, its node views into the
// editor's registry, and a transaction that recreates only those block types.
export function installPageFeature({ view, upload, toolHost, board = null, undo = null, redo = null, revise = null, highlight }, id, mod) {
  const feature = mod.createFeature({ view, upload, toolHost, board, undo, redo, revise, highlight });
  const registry = nodeViewRegistries.get(view);
  const apply = () => {
    if (feature.css) styleWithLegacyId(`page-feature-${id}`, feature.css, `page-feature-${id}`, ["editor-ui"]);
    if (!feature.nodeViews) return;
    const types = Object.keys(feature.nodeViews);
    for (const type of types) registry.set(type, feature.nodeViews[type]);
    view.dispatch(view.state.tr.setMeta(lazyViewsKey, { types }).setMeta("addToHistory", false));
  };
  const afterComposition = () => {
    if (view.isDestroyed) return;
    if (view.composing) setTimeout(afterComposition, 25);
    else apply();
  };
  if (view.composing) view.dom.addEventListener("compositionend", () => setTimeout(afterComposition, 25), { once: true });
  else apply();
  return feature;
}

// Loads the view part for a block type the editor shows but has no view for:
// the blocks that were there at boot, and any that arrive later.
function featureWatchPlugin(features) {
  return new state.Plugin({
    view(editorView) {
      const failed = new Set();
      const walk = () => {
        for (const id of failed) if (features.has(id)) failed.delete(id);
        editorView.state.doc.forEach((node) => {
          const id = featureForType(node.type.name);
          if (!id || features.has(id) || failed.has(id)) return;
          features.ensure(id).catch(() => { failed.add(id); });
        });
      };
      let doc = editorView.state.doc;
      walk();
      return {
        update() {
          if (editorView.state.doc === doc) return;
          doc = editorView.state.doc;
          walk();
        },
      };
    },
  });
}

// The optional commands. A command module exports `createFeature(context)` returning
// `{ run, dispose }`; the editor fetches it on the first ask and installs it once, and
// nothing here is preloaded by the block-type scan. A command is asked for with the state
// it was asked in: the module is fetched, and the command runs only if the edit is still
// open, the document revision has not moved and the selection is where it was. A failed
// fetch is reported and asked for again on the next request; an exit disposes what was
// installed and aborts whatever was still arriving, and the next entry installs fresh
// against the module the browser already holds.
function createCommandHost({ load = () => Promise.reject(new Error("page: this editor has no command module")), context = () => ({}), reportError } = {}) {
  const modules = new Map();
  const waiters = new Set();
  let view = null;
  let loader = null;
  let active = true;
  let disposed = false;
  let revision = 0;

  // One fetch per command for the life of the host, whatever the entry: a module that
  // failed is the one thing not kept, so the next ask loads it again.
  const moduleFor = (id) => {
    let fetched = modules.get(id);
    if (!fetched) {
      fetched = Promise.resolve(load(id));
      modules.set(id, fetched);
      fetched.catch(() => { if (modules.get(id) === fetched) modules.delete(id); });
    }
    return fetched;
  };

  const loaderFor = () => {
    loader ??= createFeatureLoader({
      load: moduleFor,
      install: (id, mod) => mod.createFeature(context(view)),
      reportError: reportError ?? ((error, id) => console.error(`clayjs: the ${id} command failed to load`, error)),
    });
    return loader;
  };

  // The document revision and the selection a command was asked for. A revision moves
  // when any transaction changes the document, whoever wrote it.
  const leaseOf = () => {
    const at = revision;
    const selection = view.state.selection;
    return {
      revision: at,
      selection,
      valid: () => active && !disposed && !view.isDestroyed && revision === at && view.state.selection.eq(selection),
    };
  };

  function observe(state, prevState) {
    if (state.doc !== prevState.doc) revision += 1;
    for (const waiter of waiters) {
      if (waiter.lease.valid()) continue;
      waiters.delete(waiter);
      waiter.controller.abort({ ok: false, code: "stale-target" });
    }
  }

  async function run(id, args) {
    if (!active || disposed || !view || view.isDestroyed) return { ok: false, code: "not-editing" };
    const waiter = { lease: leaseOf(), controller: new AbortController() };
    waiters.add(waiter);
    try {
      const feature = await loaderFor().ensure(id, { signal: waiter.controller.signal });
      if (!feature) return { ok: false, code: "not-editing" };
      if (!waiter.lease.valid()) return { ok: false, code: "stale-target" };
      return await feature.run(args);
    } catch (error) {
      if (waiter.controller.signal.aborted) return waiter.controller.signal.reason;
      return { ok: false, code: "unavailable", error };
    } finally {
      waiters.delete(waiter);
    }
  }

  function leave() {
    if (!active) return;
    active = false;
    for (const waiter of waiters) waiter.controller.abort({ ok: false, code: "not-editing" });
    waiters.clear();
    loader?.dispose();
    loader = null;
  }

  return {
    attach(editorView) { view = editorView; },
    observe,
    run,
    enter() { if (!disposed) active = true; },
    leave,
    dispose() {
      leave();
      disposed = true;
      active = false;
      modules.clear();
    },
  };
}

const commandHosts = new WeakMap();
// A command asks for its module with the state it was asked in, so the host has to hear
// about every transaction: one that moves the document revision or the selection refuses
// a command whose module is still arriving rather than running it where the person has
// since left.
function commandWatchPlugin(host) {
  return new state.Plugin({
    view: () => ({ update: (editorView, prevState) => host.observe(editorView.state, prevState) }),
  });
}

// Runs an optional command on a mounted editor, by the id its row has in COMMAND_FEATURES.
// A command nobody offers, or an editor with no command host, refuses rather than throws.
export function runPageCommand(view, id, args) {
  const host = view ? commandHosts.get(view) : null;
  if (!host) return Promise.resolve({ ok: false, code: "not-editing" });
  if (!Object.hasOwn(COMMAND_FEATURES, id)) return Promise.resolve({ ok: false, code: "unknown-command" });
  return host.run(id, args);
}

// Tools follow the tables a document holds; the host arrives with the tool view
// part on a document that had no tool at boot.
function toolFollowPlugin(toolHost) {
  return new state.Plugin({
    view(view) {
      const changed = toolHost ? () => toolHost.tablesChanged() : () => toolViews.get(view)?.tablesChanged?.();
      let previous = view.state.doc;
      return { update(next) { if (next.state.doc !== previous) { previous = next.state.doc; changed(); } } };
    },
  });
}

export function pagePlugins({ upload = defaultUpload, highlight, history: useHistory = true, undo, redo, onAiTool = null, toolHost = null, features = null, commandHost = null } = {}) {
  return [
    announcementPlugin(),
    chromePlugin({ onAiTool }),
    slashRangePlugin(),
    toolFollowPlugin(toolHost),
    linkPlugin(),
    tableSelectPlugin(),
    blockSelectionPlugin(),
    markdownPlugin(),
    markdownKeys(),
    placeholderPlugin(),
    titlePlugin(),
    keymap.keymap(markKeys),
    tableKeys,
    checklistKeys,
    keymap.keymap(blockKeys),
    keymap.keymap(editKeys({ history: useHistory, undo, redo })),
    keymap.keymap(commands.baseKeymap),
    structurePlugin(),
    identityPlugin(),
    tablePlugin(),
    chartPlugin(),
    boardPlugin(),
    checklistPlugin(),
    csvImportPlugin({ upload }),
    collapsePlugin(),
    mediaPlugin({ upload, features }),
    highlightSlot(),
    pastePlugin(),
    historyIntentPlugin(),
    useHistory ? history.history() : null,
    gapcursor.gapCursor(),
    lazyViewsPlugin(),
    features ? featureWatchPlugin(features) : null,
    commandHost ? commandWatchPlugin(commandHost) : null,
  ].filter(Boolean);
}

export function pageState(blocks, options = {}) {
  const record = blocks && Object.keys(blocks).length ? blocks : { [newId()]: { t: "paragraph", pos: keyBetween(), c: "" } };
  const doc = options.doc ?? docFromBlocks(schema, record);
  return state.EditorState.create({ doc, plugins: pagePlugins(options) });
}

// The shell is built detached and moved into the article once it is complete, so
// the node views in it measured nothing while it was out of the document. One pass
// in place gives them a real box: the state is the same object it was, and no node
// view is rebuilt for it.
export function refreshMountedView(view) {
  if (!view || view.isDestroyed) return;
  view.updateState(view.state);
}

// Admission on a mounted editor, in one place: the commit that enters edit opens it,
// and the exit that holds the session closed shuts it without touching a buffer.
export function setEditorActive(view, active) {
  if (!view || view.isDestroyed) return false;
  const open = active === true;
  view.setProps({ editable: () => open });
  // A refused exit closes admission without destroying the view, so the commands are told
  // here: the exit disposes what they installed, and the next entry installs fresh.
  const host = commandHosts.get(view);
  if (open) host?.enter();
  else host?.leave();
  return open;
}

// Clicking a checklist box (drawn by ::before in the item's start gutter)
// toggles `checked`.
function checkboxClick(view, event) {
  const li = event.target.closest?.('.page-li[data-kind="check"]');
  if (!li || !view.dom.contains(li)) return false;
  const box = li.getBoundingClientRect();
  const start = parseFloat(getComputedStyle(li).paddingInlineStart) || 0;
  const x = getComputedStyle(li).direction === "rtl" ? box.right - event.clientX : event.clientX - box.left;
  if (x < 0 || x > start) return false;
  const pos = view.posAtDOM(li, 0) - 1;
  const node = view.state.doc.nodeAt(pos);
  if (!node) return false;
  event.preventDefault();
  view.dispatch(view.state.tr.setNodeMarkup(pos, null, { ...node.attrs, checked: !node.attrs.checked }));
  return true;
}

// Mounts the editor in `mount`, inside a .page-shell wrapper (the surface a
// theme styles). `onChange(record)` gets the block record (blockMap) after
// every transaction that changed the document.
export function createPageEditor(mount, { blocks = null, onChange = null, upload, highlight, doc: initialDoc, dispatch, history: useHistory = true, undo, redo, editable = true, toolHost = null, onAiTool = null, reviseTool = null, board = null, features: providedFeatures = null } = {}) {
  const doc = mount.ownerDocument;
  // Editor chrome, injected on every edit-mode boot and kept out of the saved file:
  // the reader theme <link> styles the page for visitors.
  styleWithLegacyId(STYLE_ID, PAGE_EDITOR_CSS, STYLE_ID, ["editor-ui"]);
  const shell = doc.createElement("div");
  shell.className = "page-shell";
  shell.setAttribute("clay", "editor-ui");
  shell.setAttribute("sap-ignore", "");
  mount.appendChild(shell);
  let afterStep = false;
  let view = null;
  const features = providedFeatures ?? createFeatureLoader({
    load: (id) => FEATURES[id].load(),
    install: (id, mod) => installPageFeature({ view, upload, toolHost, board, undo, redo, revise: reviseTool, highlight }, id, mod),
  });
  // Commands are their own loader: a document never fetches a picker to be read or typed
  // in, and the host outlives a refused exit so a re-entry installs once more.
  const commandHost = createCommandHost({
    load: (id) => COMMAND_FEATURES[id].load(),
    context: (editorView) => ({ view: editorView, upload }),
  });
  const nodeViewRegistry = new Map();
  const nodeViews = {
    chart: (node, v, getPos) => new ChartView(node, v, getPos),
  };
  for (const feature of Object.values(FEATURES)) for (const type of feature.views ?? feature.types) {
    nodeViews[type] = (node, v, getPos, decorations, inner) => {
      const make = nodeViewRegistry.get(node.type.name);
      return make ? make(node, v, getPos, decorations, inner) : new PendingView(node, nodeViewRegistry);
    };
  }
  view = new pmView.EditorView(shell, {
    state: pageState(blocks, { upload, highlight, doc: initialDoc, history: useHistory, undo, redo, onAiTool, toolHost, features, commandHost }),
    attributes: { class: "page-editor" },
    editable: () => editable,
    nodeViews,
    handleDOMEvents: {
      mousedown: checkboxClick,
      dragstart(v, event) {
        const sel = v.state.selection;
        if (!(sel instanceof state.NodeSelection || sel instanceof BlockSelection)) return false;
        event.preventDefault();
        return true;
      },
    },
    dispatchTransaction(tr) {
      if (dispatch) {
        dispatch(tr);
        return;
      }
      if (afterStep && tr.docChanged && !tr.getMeta(STEP)) history.closeHistory(tr);
      if (tr.docChanged) afterStep = !!tr.getMeta(STEP);
      const before = view.state.doc;
      view.updateState(view.state.apply(tr));
      if (onChange && view.state.doc !== before) onChange(blockMap(view.state.doc));
    },
  });
  nodeViewRegistries.set(view, nodeViewRegistry);
  commandHost.attach(view);
  commandHosts.set(view, commandHost);
  const destroy = view.destroy.bind(view);
  view.destroy = () => { commandHost.dispose(); features.dispose(); destroy(); };
  return view;
}
