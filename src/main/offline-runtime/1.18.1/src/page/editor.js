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
import { markable } from "./format-native.js";
import { placeholderPlugin } from "./placeholder.js";
import { titlePlugin } from "./document-title-runtime.js";
import { mediaPlugin } from "./media.js";
import { highlightSlot } from "./highlight-slot.js";
import { tableKeys, tablePlugin } from "./table.js";
import { tableSelectPlugin } from "./table-select.js";
import { viewFeatures, viewHookPlugin } from "./view-hooks.js";
import { checklistKeys } from "./checklist.js";
import { csvImportPlugin } from "./csv-import.js";
import { styleWithLegacyId } from "../lib/style.js";
import { historyIntentPlugin } from "./history-intent.js";
import { createFeatureLoader } from "./feature-loader.js";
import { COMMAND_FEATURES, FEATURES, featureForNode } from "./features/registry.js";
import { toolViews } from "./tool-views.js";

const STYLE_ID = "page-editor-style";
const INDENTS = [1, 2, 3, 4, 5, 6, 7, 8];

const LIGHT = `
  --page-bg: #F7F6F2; --page-ink: #23221F; --page-ink-soft: #6B6862; --page-ink-faint: #9B968C;
  --page-rule: rgba(35, 34, 31, 0.10); --page-accent: #2F5E9E; --page-link: #164583; --page-selection: rgba(88, 120, 170, 0.20);
  --page-check-border: rgba(35, 34, 31, 0.35); --page-check-fill: #23221F; --page-check-ink: #F7F6F2;
  --page-callout-bg: rgba(35, 34, 31, 0.04); --page-code-bg: rgba(35, 34, 31, 0.05);
  --page-color-gray: #5B5953; --page-color-brown: #8A5A1E; --page-color-orange: #B4531A; --page-color-yellow: #7A6210; --page-color-green: #3E6A28;
  --page-color-blue: #1F5A8A; --page-color-purple: #5E4596; --page-color-pink: #A23E6E; --page-color-red: #9E3B2F;
  --page-mark-bg-gray: rgba(35, 34, 31, 0.12); --page-mark-bg-brown: rgba(138, 90, 30, 0.20); --page-mark-bg-orange: rgba(180, 83, 26, 0.20);
  --page-mark-bg-yellow: rgba(122, 98, 16, 0.22); --page-mark-bg-green: rgba(62, 106, 40, 0.20); --page-mark-bg-blue: rgba(31, 90, 138, 0.18);
  --page-mark-bg-purple: rgba(94, 69, 150, 0.18); --page-mark-bg-pink: rgba(162, 62, 110, 0.18); --page-mark-bg-red: rgba(158, 59, 47, 0.18);
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
  --page-color-gray: #A3A098; --page-color-brown: #E0B47A; --page-color-orange: #E8A177; --page-color-yellow: #DEC97A; --page-color-green: #A9C98B;
  --page-color-blue: #8DB0E6; --page-color-purple: #BBA6E6; --page-color-pink: #E3A3C4; --page-color-red: #E08A7A;
  --page-mark-bg-gray: rgba(231, 228, 220, 0.14); --page-mark-bg-brown: rgba(224, 180, 122, 0.22); --page-mark-bg-orange: rgba(232, 161, 119, 0.22);
  --page-mark-bg-yellow: rgba(222, 201, 122, 0.24); --page-mark-bg-green: rgba(169, 201, 139, 0.22); --page-mark-bg-blue: rgba(141, 176, 230, 0.22);
  --page-mark-bg-purple: rgba(187, 166, 230, 0.22); --page-mark-bg-pink: rgba(227, 163, 196, 0.22); --page-mark-bg-red: rgba(224, 138, 122, 0.22);
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
/* The four floor-1 formats. A quote is set apart by its own inset and ink, with
   no left-border accent; the palette's keys are fixed tokens, in both themes. */
:where(article[data-page], .page-editor) blockquote { padding-inline-start: var(--page-indent); color: var(--page-ink-soft); }
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
/* The phone's fourth control folds away everything the narrow bar hides; on a desktop it
   holds what has no button of its own (colors, icon and cover, the exports). */
.page-tool-sep { width: 1px; height: 16px; margin: 0 3px; background: currentColor; opacity: 0.5; }
.page-safe-probe { position: fixed; left: 0; bottom: 0; width: 0; height: 0; padding-bottom: env(safe-area-inset-bottom); visibility: hidden; pointer-events: none; }
.page-plus { position: absolute; z-index: 2; top: calc(var(--page-plus-top, 0px) - var(--page-plus-size) / 2); left: calc(var(--page-plus-left, 0px) - var(--page-plus-size) - 12px); width: var(--page-plus-size); height: var(--page-plus-size); display: grid; place-items: center; padding: 0; cursor: pointer; }
.page-plus[aria-expanded="true"] { color: var(--page-chrome-ink-moved); background: var(--page-chrome-bg-moved); }
.page-grip { position: absolute; z-index: 2; top: calc(var(--page-plus-top, 0px) - var(--page-grip-size, var(--page-plus-size)) / 2); left: calc(var(--page-plus-left, 0px) - var(--page-plus-size) - 12px - var(--page-grip-size, var(--page-plus-size)) - 2px); width: var(--page-grip-size, var(--page-plus-size)); height: var(--page-grip-size, var(--page-plus-size)); display: grid; place-items: center; padding: 0; border: 0; border-radius: var(--page-chrome-radius); background: none; color: var(--page-chrome-ink-moved); opacity: 0; cursor: grab; touch-action: none; transition: opacity var(--page-fade); }
.page-shell.is-moved .page-grip, .page-grip.is-on, .page-grip:focus-visible, .page-grip[aria-expanded="true"] { opacity: 1; }
.page-bubble, .page-menu { position: absolute; z-index: 4; background: var(--page-pop-bg); color: var(--page-pop-ink); border: 1px solid var(--page-pop-line); box-shadow: var(--page-pop-shadow); border-radius: var(--page-pop-radius); }
.page-bubble { display: flex; gap: 1px; padding: 3px; left: var(--page-pop-x, 0px); top: var(--page-pop-y, 0px); transform: translate(-50%, calc(-100% - 8px)); }
.page-menu { left: var(--page-pop-x, 0px); top: var(--page-pop-y, 0px); width: 260px; max-height: 340px; overflow-y: auto; padding: 6px; font-size: 14px; }
.page-settings { position: absolute; z-index: 4; box-sizing: border-box; left: var(--page-pop-x, 0px); top: var(--page-pop-y, 0px); width: min(264px, calc(100vw - 28px)); padding: 9px 11px; background: var(--page-pop-bg); color: var(--page-pop-ink); border: 1px solid var(--page-pop-line); border-radius: var(--page-pop-radius); box-shadow: var(--page-pop-shadow); font-size: 13px; }
.page-settings-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-bottom: 6px; margin-bottom: 2px; border-bottom: 1px solid var(--page-pop-line); }
.page-settings-title { font-size: 12.5px; font-weight: 600; color: var(--page-pop-ink); }
.page-settings-close { display: inline-grid; place-content: center; width: 20px; height: 20px; padding: 0; border: 1px solid transparent; border-radius: 5px; background: none; color: var(--page-pop-muted); cursor: pointer; }
.page-settings-close:hover { background: var(--page-pop-hover); color: var(--page-pop-ink); }
.page-settings-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 0; }
.page-settings-name { min-width: 0; font-weight: 500; line-height: 1.3; }
.page-settings-switch { position: relative; flex: 0 0 30px; box-sizing: border-box; width: 30px; height: 18px; padding: 0; border: 0; border-radius: 9px; background: var(--page-chrome-line-moved); cursor: pointer; transition: background-color var(--page-fade); }
.page-settings-switch[aria-checked="true"] { background: var(--page-accent); }
.page-settings-knob { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--page-pop-bg); transition: transform var(--page-fade); }
.page-settings-switch[aria-checked="true"] .page-settings-knob { transform: translateX(12px); }
.page-settings-note { margin: 4px 0 2px; color: var(--page-pop-muted); font-size: 11px; line-height: 1.4; }
.page-menu-title { padding: 4px 10px 6px; color: var(--page-pop-muted); font-size: 12px; }
.page-menu-item { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 34px; padding: 4px 10px; border: 0; border-radius: 7px; background: none; color: inherit; font: inherit; text-align: start; cursor: pointer; }
.page-menu-item[aria-selected="true"], .page-menu-item.is-active, .page-menu-item:hover { background: var(--page-pop-hover); }
.page-menu-icon { display: grid; place-items: center; width: 24px; height: 24px; border: 1px solid var(--page-pop-line); border-radius: 6px; color: var(--page-pop-muted); font-size: 12px; flex: none; }
.page-menu-icon svg { display: block; }
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
.page-editor .page-chart { position: relative; max-width: 100%; min-width: 0; margin-inline: 0; border: 1px solid var(--page-rule); border-radius: var(--page-chrome-radius); color: var(--page-ink); }
.page-chart-plot svg { display: block; width: 100%; height: auto; color: var(--chart-text, var(--page-ink-soft)); font: 12px var(--page-font); }
.page-chart-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--page-rule); }
.page-chart-title { min-width: 0; margin-inline-end: auto; font-size: 14px; font-weight: 600; line-height: 1.3; }
.page-chart-title.is-empty { color: var(--page-ink-faint); font-weight: 500; }
.page-chart-source { display: inline-flex; align-items: center; gap: 5px; box-sizing: border-box; height: 22px; padding: 0 7px; border: 1px solid var(--page-pop-line); border-radius: var(--page-chrome-radius); background: var(--page-pop-bg); color: var(--page-pop-muted); font: inherit; font-size: 11.5px; cursor: pointer; }
.page-chart-source:hover { color: var(--page-ink); border-color: var(--page-chrome-line-moved); }
.page-chart-source svg, .page-chart-edit svg, .page-chart-remove svg { flex: none; }
.page-chart-edit { display: inline-flex; align-items: center; gap: 6px; box-sizing: border-box; height: 28px; padding: 0 10px; border: 1px solid var(--page-rule); border-radius: var(--page-chrome-radius); background: none; color: var(--page-ink); font: inherit; font-size: 12.5px; font-weight: 500; cursor: pointer; }
.page-chart-edit:hover, .page-chart-edit[aria-expanded="true"] { background: var(--page-pop-hover); }
.page-chart-panel { position: absolute; z-index: 5; top: 46px; inset-inline-end: 10px; box-sizing: border-box; width: 304px; padding: 12px; border: 1px solid var(--page-pop-line); border-radius: var(--page-pop-radius); background: var(--page-pop-bg); box-shadow: var(--page-pop-shadow); color: var(--page-pop-ink); font-family: var(--page-font); font-size: 13px; text-align: start; }
.page-chart-panel:focus { outline: none; }
.page-chart-row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
.page-chart-row:last-child { margin-bottom: 0; }
.page-chart-label { color: var(--page-pop-muted); font-size: 12px; font-weight: 500; }
.page-chart-types { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; }
.page-chart-type, .page-chart-remove, .page-chart-done { display: inline-flex; align-items: center; justify-content: center; gap: 6px; box-sizing: border-box; height: 28px; padding: 0 10px; border: 1px solid var(--page-pop-line); border-radius: var(--page-chrome-radius); background: none; color: var(--page-pop-ink); font: inherit; font-size: 12.5px; font-weight: 500; cursor: pointer; }
.page-chart-type:hover, .page-chart-remove:hover, .page-chart-done:hover { background: var(--page-pop-hover); }
.page-chart-type[aria-pressed="true"] { border-color: var(--page-chrome-line-moved); background: var(--page-pop-hover); font-weight: 600; }
.page-chart-select, .page-chart-title-input { box-sizing: border-box; width: 100%; height: 28px; padding: 0 8px; border: 1px solid var(--page-pop-line); border-radius: var(--page-chrome-radius); background: var(--page-pop-bg); color: var(--page-pop-ink); font: inherit; font-size: 12.5px; }
.page-chart-values { display: flex; flex-direction: column; gap: 1px; padding: 5px 6px; border: 1px solid var(--page-pop-line); border-radius: var(--page-chrome-radius); }
.page-chart-value { display: flex; align-items: center; gap: 7px; padding: 2px 4px; font-size: 12.5px; cursor: pointer; }
.page-chart-value:hover { background: var(--page-pop-hover); }
.page-chart-value input { margin: 0; accent-color: var(--page-accent); }
.page-chart-swatch { flex: none; width: 10px; height: 10px; border-radius: 2px; }
.page-chart-hint { color: var(--page-pop-muted); font-size: 11px; line-height: 1.4; }
.page-chart-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--page-pop-line); }
.page-chart-remove { color: var(--page-danger); }
.page-chart-broken { box-sizing: border-box; padding: 16px; border: 1px solid var(--page-pop-line); border-radius: var(--page-chrome-radius); background: var(--page-pop-hover); font-family: var(--page-font); text-align: start; }
.page-chart-broken[hidden] { display: none; }
.page-chart-plot[hidden] { display: none; }
.page-chart-broken-head { margin-bottom: 4px; font-size: 13.5px; font-weight: 600; line-height: 1.3; }
.page-chart-broken-text { margin: 0 0 12px; color: var(--page-pop-muted); font-size: 12.5px; line-height: 1.45; }
.page-chart-broken-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.page-chart-use, .page-chart-delete { display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; height: 28px; padding: 0 10px; border: 1px solid var(--page-pop-line); border-radius: var(--page-chrome-radius); background: var(--page-pop-bg); color: var(--page-pop-ink); font: inherit; font-size: 12.5px; font-weight: 500; cursor: pointer; }
.page-chart-use:hover, .page-chart-delete:hover { background: var(--page-pop-bg); border-color: var(--page-chrome-line-moved); }
.page-chart-delete { color: var(--page-danger); }
.page-chart-broken-actions .page-chart-select { width: auto; min-width: 0; flex: 1 1 140px; }
@media (max-width: 560px) {
  .page-chart-panel { position: static; inset-inline-end: auto; width: auto; border: 0; border-top: 1px solid var(--page-pop-line); border-radius: 0; box-shadow: none; }
  .page-chart-use, .page-chart-delete, .page-chart-broken-actions .page-chart-select { height: 44px; }
}
.page-table-scroll { max-width: 100%; overflow-x: auto; }
.page-table table { border-collapse: collapse; min-width: max-content; width: 100%; table-layout: auto; }
.page-table th, .page-table td { min-width: 120px; padding: 6px 10px; border-inline-end: 1px solid var(--page-rule); border-block-end: 1px solid var(--page-rule); text-align: start; white-space: pre-wrap; }
.page-table th { background: var(--page-code-bg); color: var(--page-ink-soft); font-weight: 600; }
.page-table th[data-kind="number"], .page-table td[data-kind="number"] { text-align: end; }
.page-table th[aria-sort="ascending"] button::after { content: " ↑"; }
.page-table th[aria-sort="descending"] button::after { content: " ↓"; }
.page-table th button, .page-table-row-menu { border: 0; border-radius: 5px; background: none; color: inherit; font: inherit; cursor: pointer; }
.page-table th button:hover, .page-table-row-menu:hover { background: var(--page-pop-hover); }
.page-editor td > span { display: block; }
.page-table-row-menu { float: inline-end; margin-inline-start: 4px; opacity: 0; font-size: 12px; color: var(--page-ink-soft); display: inline-grid; place-items: center; width: 22px; height: 22px; padding: 0; }
.page-table tr:hover .page-table-row-menu, .page-table tr:focus-within .page-table-row-menu, .page-table-row-menu:focus-visible { opacity: 1; }
/* The tags float to the end of the item's first line, so long text wraps beside and
   below them without the text's own marks being pulled apart. The item's whole line
   stays the click target for an empty item, which has no text of its own. */
.page-li.page-check-placeholder::after { content: attr(data-placeholder); position: absolute; inset-inline-start: calc((var(--li-indent) + 1) * var(--page-indent)); color: var(--page-ink-faint); pointer-events: none; }
.page-check-controls { display: inline-flex; float: inline-end; flex-wrap: wrap; align-items: center; gap: 5px; margin-inline-start: 10px; text-decoration: none; }
.page-check-chip { display: inline-flex; align-items: center; gap: 4px; box-sizing: border-box; height: 23px; padding: 0 7px; border: 1px solid var(--page-rule); border-radius: var(--page-check-radius); background: transparent; color: var(--page-ink-soft); font: 400 12px/1 var(--page-font); white-space: nowrap; cursor: pointer; }
.page-check-chip svg { flex: none; }
.page-check-chip:hover { background: var(--page-pop-hover); }
.page-check-chip[data-filled="true"] { border-color: transparent; background: var(--page-chrome-bg-moved); color: var(--page-ink); font-weight: 500; }
.page-check-chip[data-overdue="true"] { border-color: var(--page-danger); color: var(--page-danger); }
.page-li[data-checked="true"] .page-check-controls { opacity: 0.62; }
[data-assignees="false"] .page-check-chip[data-check="owner"], [data-dates="false"] .page-check-chip[data-check="date"] { display: none; }
[data-assignees="false"][data-dates="false"] .page-check-controls { display: none; }
.page-check-popup { display: inline-flex; gap: 4px; padding: 4px; background: var(--page-pop-bg); color: var(--page-pop-ink); border: 1px solid var(--page-pop-line); border-radius: var(--page-pop-radius); box-shadow: var(--page-pop-shadow); }
.page-check-popup input { font: inherit; color: inherit; background: var(--page-pop-bg); border: 1px solid var(--page-pop-line); }
.page-check-popup.page-check-owner, .page-check-popup.page-check-date { position: absolute; z-index: 5; display: block; box-sizing: border-box; width: min(264px, calc(100vw - 28px)); padding: 8px; background: var(--page-pop-bg); color: var(--page-pop-ink); border: 1px solid var(--page-pop-line); border-radius: var(--page-pop-radius); box-shadow: var(--page-pop-shadow); font-family: var(--page-font); }
.page-check-search { box-sizing: border-box; width: 100%; height: 28px; padding: 0 8px; border: 1px solid var(--page-pop-line); border-radius: 7px; background: var(--page-pop-bg); color: var(--page-pop-ink); font: inherit; font-size: 12.5px; }
.page-check-search::placeholder { color: var(--page-ink-faint); }
.page-check-subhead { padding: 7px 4px 4px; color: var(--page-pop-muted); font-size: 11.5px; font-weight: 500; }
.page-check-people { display: flex; flex-direction: column; gap: 1px; }
.page-check-person { display: flex; align-items: center; gap: 7px; width: 100%; padding: 5px 6px; border: 0; background: none; color: var(--page-pop-ink); font: inherit; font-size: 12.5px; text-align: start; cursor: pointer; }
.page-check-person:hover { background: var(--page-pop-hover); }
.page-check-person[aria-pressed="true"] { font-weight: 500; }
.page-check-person .page-board-face { flex: 0 0 18px; width: 18px; height: 18px; }
.page-check-person-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.page-check-person-meta { margin-inline-start: auto; color: var(--page-pop-muted); font-size: 11px; }
.page-check-person svg { flex: none; }
.page-check-divider { height: 1px; margin: 6px 0; background: var(--page-pop-line); }
.page-check-danger { color: var(--page-danger); }
.page-check-danger:hover { background: var(--page-pop-hover); }
.page-check-danger[disabled] { opacity: 0.45; background: none; cursor: default; }
.page-check-quick { display: flex; flex-direction: column; gap: 1px; }
.page-check-quick-row { display: flex; align-items: center; gap: 7px; width: 100%; padding: 5px 6px; border: 0; background: none; color: var(--page-pop-ink); font: inherit; font-size: 12.5px; text-align: start; cursor: pointer; }
.page-check-quick-row:hover { background: var(--page-pop-hover); }
.page-check-quick-row svg { flex: none; }
.page-check-quick-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.page-check-quick-meta { margin-inline-start: auto; color: var(--page-pop-muted); font-family: var(--page-font-mono); font-size: 11px; font-variant-numeric: tabular-nums; }
.page-check-cal { margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--page-pop-line); }
.page-check-cal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 5px; padding: 0 2px; }
.page-check-cal-month { color: var(--page-pop-ink); font-size: 12px; font-weight: 600; }
.page-check-cal-year { font-family: var(--page-font-mono); font-size: 11.5px; font-variant-numeric: tabular-nums; }
.page-check-cal-nav { display: inline-flex; gap: 3px; }
.page-check-cal-btn { display: inline-grid; place-content: center; width: 22px; height: 22px; padding: 0; border: 1px solid var(--page-pop-line); border-radius: var(--page-check-radius); background: none; color: var(--page-pop-ink); cursor: pointer; }
.page-check-cal-btn:hover { background: var(--page-pop-hover); }
.page-check-cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; text-align: center; }
.page-check-cal-dow { padding: 2px 0; color: var(--page-pop-muted); font-size: 10.5px; font-weight: 500; }
.page-check-cal-day { height: 28px; padding: 0; border: 1px solid transparent; border-radius: var(--page-check-radius); background: transparent; color: var(--page-pop-ink); font-family: var(--page-font-mono); font-size: 11.5px; font-variant-numeric: tabular-nums; cursor: pointer; }
.page-check-cal-day:hover { background: var(--page-pop-hover); }
.page-check-cal-day[data-outside="true"] { opacity: 0.5; }
.page-check-cal-day[data-today="true"] { border-color: var(--page-accent); font-weight: 500; }
.page-check-cal-day[aria-pressed="true"] { background: var(--page-chrome-bg-moved); font-weight: 500; }
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
  .page-settings { position: fixed; left: 0; top: 0; transform: translate(var(--page-pop-x, 0px), var(--page-pop-y, 0px)); z-index: 5; }
  .page-menu-item { min-height: 48px; font-size: 16px; }
  .page-link { position: fixed; left: 0; right: 0; top: auto; bottom: 0; max-width: none; padding: 8px 16px calc(8px + env(safe-area-inset-bottom)); border-radius: 0; border-width: 1px 0 0; }
  .page-link-input { min-width: 0; height: 44px; font-size: 16px; }
  .page-link-btn, .page-upload-btn { min-width: 44px; height: 44px; }
  .page-image-frame { width: 100% !important; }
  .page-image-handle { display: none; }
  .page-table th button, .page-table-row-menu, .page-check-chip, .page-check-popup button, .page-menu-item { min-height: 44px; }
  .page-check-person { min-height: 44px; }
  .page-check-popup .page-check-quick-row { min-height: 44px; }
  .page-check-popup .page-check-cal-day { height: 40px; min-height: 40px; }
  .page-board-owner-input { font-size: 16px; height: 44px; }
  .page-check-search { font-size: 16px; height: 44px; }
  .page-check-popup .page-check-cal-btn { width: 44px; height: 44px; }
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

// Mod-u belongs to an editable page selection only: anywhere else the browser
// keeps its own meaning for the key. The write itself goes through the format
// gate, so a refused activation leaves the document exactly as it was.
const underlineShortcut = (st, dispatch, view) => {
  if (!dispatch || !view?.editable || !markable(st, schema.marks.underline)) return false;
  import("./format-native-commands.js")
    .then(({ formatMark, refuse }) => formatMark(view, "underline").then((result) => {
      if (result?.status !== "applied") refuse(view, result?.message ?? "That format isn\u2019t available here.");
    }), () => null);
  return true;
};

const editKeys = ({ history: useHistory = true, undo, redo } = {}) => ({
  "Mod-z": useHistory ? history.undo : () => { undo?.(); return true; },
  "Shift-Mod-z": useHistory ? history.redo : () => { redo?.(); return true; },
  "Mod-y": useHistory ? history.redo : () => { redo?.(); return true; },
  "Shift-Enter": insertHardBreak,
  "Mod-b": commands.toggleMark(schema.marks.strong),
  "Mod-i": commands.toggleMark(schema.marks.em),
  "Mod-u": underlineShortcut,
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
          const id = featureForNode(node);
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

  function quiesce() {
    if (!active) return;
    active = false;
    for (const waiter of waiters) waiter.controller.abort({ ok: false, code: "not-editing" });
    waiters.clear();
  }

  function leave() {
    quiesce();
    loader?.dispose();
    loader = null;
  }

  return {
    attach(editorView) { view = editorView; },
    observe,
    run,
    enter() { if (!disposed) active = true; },
    quiesce,
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
// since left. It also holds the one typed key a command owns: `@` asks for the mention
// picker, and the host types the character itself so the command is handed the bookmark it
// belongs to, with everything else about that picker left to the module that arrives for
// it. It is asked before the plugin that records ordinary typing, since it types it.
function commandWatchPlugin(host) {
  return new state.Plugin({
    view: () => ({ update: (editorView, prevState) => host.observe(editorView.state, prevState) }),
    props: { handleTextInput(v, from, to, text) {
      if (text !== "@" || v.composing || !Object.hasOwn(COMMAND_FEATURES, "mentions")) return false;
      v.dispatch(v.state.tr.insertText("@", from, to));
      host.run("mentions", { from, to: from + 1 });
      return true;
    } },
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
    commandHost ? commandWatchPlugin(commandHost) : null,
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
    viewHookPlugin(),
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
export function setEditorActive(view, active, { quiesce = false } = {}) {
  if (!view || view.isDestroyed) return false;
  const open = active === true;
  view.setProps({ editable: () => open });
  // A refused exit closes admission without destroying the view, so the commands are told
  // here: a quiesce keeps what they installed and their pending registrations for the
  // resume, and only a committed exit disposes them.
  const host = commandHosts.get(view);
  if (open) host?.enter();
  else if (quiesce) host?.quiesce();
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
export function createPageEditor(mount, { blocks = null, onChange = null, upload, highlight, doc: initialDoc, dispatch, history: useHistory = true, undo, redo, editable = true, toolHost = null, onAiTool = null, reviseTool = null, board = null, features: providedFeatures = null, formatGate = null } = {}) {
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
  const nodeViews = {};
  for (const feature of Object.values(FEATURES)) for (const type of feature.views ?? feature.types) {
    nodeViews[type] = (node, v, getPos, decorations, inner) => {
      const make = nodeViewRegistry.get(node.type.name);
      return make ? make(node, v, getPos, decorations, inner) : new PendingView(node, nodeViewRegistry);
    };
  }
  view = new pmView.EditorView(shell, {
    state: pageState(blocks, { upload, highlight, doc: initialDoc, history: useHistory, undo, redo, onAiTool, toolHost, features, commandHost }),
    attributes: { class: "page-editor" },
    // The phone keeps a fixed bar and the plus and grip at the bottom: a caret scrolled into
    // view stops clear of them.
    scrollMargin: { top: 16, bottom: 96, left: 5, right: 5 },
    scrollThreshold: { top: 16, bottom: 96, left: 0, right: 0 },
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
  viewFeatures.set(view, features);
  commandHost.attach(view);
  commandHosts.set(view, commandHost);
  const destroy = view.destroy.bind(view);
  // A new-format command asks the format gate, which the page plugin hands over as a
  // loader of its own: neither the gate nor its host adapter is on the editor's ready
  // path, so a reader who never uses a newer format never fetches them. The gate is
  // created once, on the first command, and belongs to this view.
  let gateHeld = null;
  let disposed = false;
  const heldGate = () => {
    if (!gateHeld) {
      gateHeld = Promise.resolve().then(() => formatGate()).catch((error) => {
        gateHeld = null;
        throw error;
      });
    }
    return gateHeld;
  };
  view.runFormatCommand = async (apply) => {
    if (disposed) return { status: "disposed", retry: false };
    if (!formatGate) return { status: "unsupported-host", code: "page-format-unsupported", retry: false };
    const gate = await heldGate();
    if (disposed) {
      gate.dispose?.();
      return { status: "disposed", retry: false };
    }
    return gate.run({ apply });
  };
  view.destroy = () => {
    disposed = true;
    if (gateHeld) gateHeld.then((gate) => gate?.dispose?.(), () => {});
    commandHost.dispose();
    features.dispose();
    destroy();
  };
  return view;
}
