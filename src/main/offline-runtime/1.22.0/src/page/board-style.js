export const BOARD_CSS = `
:where(article[data-page], .page-shell) { --page-board-lane: 274px; --page-board-gap: 14px; --page-board-radius: 8px; --page-board-panel: 360px; }
.page-editor .page-board { margin-block: 1.1em 1.5em; font-size: 15px; line-height: 1.4; white-space: normal; }
:is(.page-board, .page-board-panel) .i { flex: none; width: 16px; height: 16px; }
.page-board-scroll { position: relative; margin: -4px -4px 0; padding: 4px 4px 12px; overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: thin; scrollbar-color: var(--page-chrome-ink-rest) transparent; }
.page-board-lanes { display: flex; align-items: flex-start; gap: var(--page-board-gap); width: max-content; }
.page-board-lane { flex: 0 0 var(--page-board-lane); width: var(--page-board-lane); min-width: 0; }
.page-board-head { position: relative; display: flex; align-items: flex-start; gap: 8px; padding: 8px 0 7px; margin-bottom: 10px; border-bottom: 1px solid var(--page-rule); }
.page-board-name { min-width: 0; margin: 0; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; color: var(--page-ink-strong); font: 600 14px/20px var(--page-font-heading); overflow-wrap: anywhere; }
.page-board-count { flex: none; color: var(--page-ink-soft); font-size: 14px; line-height: 20px; font-variant-numeric: tabular-nums; }
.page-board-icon { flex: none; display: inline-grid; place-items: center; width: 28px; height: 28px; margin-block: -4px; padding: 0; border: 0; border-radius: 6px; background: none; color: var(--page-ink-faint); cursor: pointer; transition: background-color var(--page-fade), color var(--page-fade); }
.page-board-icon:hover, .page-board-icon[aria-expanded="true"] { background: var(--page-pop-hover); color: var(--page-ink-soft); }
.page-board-icon:focus-visible { color: var(--page-ink-soft); }
.page-board-colmenu { margin-inline: auto -4px; }
.page-board-cards { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
.page-board-cards > li { position: relative; }
.page-board-card { display: block; width: 100%; margin: 0; padding: 10px 12px 11px; border: 1px solid var(--page-rule); border-radius: var(--page-board-radius); background: var(--page-pop-bg); color: var(--page-ink); font: inherit; text-align: start; cursor: pointer; transition: background-color var(--page-fade), border-color var(--page-fade); }
.page-board-card:hover { background-color: color-mix(in srgb, var(--page-pop-bg) 96%, var(--page-ink)); }
.page-board-card[aria-expanded="true"] { border-color: var(--page-accent); box-shadow: inset 0 0 0 1px var(--page-accent); }
.page-board-title { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; overflow: hidden; font-size: 15px; font-weight: 500; line-height: 21px; overflow-wrap: anywhere; }
.page-board-meta { display: flex; align-items: center; gap: 8px; margin-top: 8px; color: var(--page-ink-soft); font-size: 13px; line-height: 20px; }
.page-board-owner { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.page-board-owner-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.page-board-due { flex: none; display: inline-flex; align-items: center; gap: 6px; margin-inline-start: auto; white-space: nowrap; font-variant-numeric: tabular-nums; }
.page-board-due[data-due="today"] { color: var(--page-ink); font-weight: 500; }
.page-board-due[data-due="overdue"] { color: var(--page-ink); }
.page-board-due[data-due="overdue"]::before { content: ""; flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--page-danger); }
.page-board-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.page-board-add { display: flex; align-items: center; gap: 6px; width: 100%; min-height: 36px; margin-top: 6px; padding: 0 12px; border: 0; border-radius: 7px; background: none; color: var(--page-ink-soft); font: inherit; font-size: 14px; text-align: start; cursor: pointer; transition: background-color var(--page-fade); }
.page-board-add .i { width: 14px; height: 14px; color: var(--page-ink-faint); }
.page-board-add:hover { background: var(--page-pop-hover); }
.page-board-addcol { flex: none; display: inline-grid; place-items: center; width: 32px; height: 32px; margin-top: 2px; padding: 0; border: 1px solid var(--page-chrome-line-rest); border-radius: var(--page-chrome-radius); background: var(--page-chrome-bg-rest); color: var(--page-ink-faint); cursor: pointer; transition: color var(--page-fade), background-color var(--page-fade), border-color var(--page-fade); }
.page-board-addcol:hover { border-color: var(--page-chrome-line-moved); background: var(--page-chrome-bg-moved); color: var(--page-ink-soft); }
.page-board-addcol .i { width: 14px; height: 14px; }
.page-board-tray { margin-bottom: 18px; padding: 6px 12px 12px; border-radius: 10px; background: var(--page-callout-bg); }
.page-board-tray-head { display: flex; align-items: center; gap: 8px; min-height: 44px; margin-bottom: 4px; }
.page-board-tray .page-board-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; }
.page-board-select { position: relative; display: block; min-width: 0; }
.page-board-select > .i { position: absolute; inset-inline-end: 8px; top: 50%; margin-top: -8px; color: var(--page-ink-faint); pointer-events: none; }
.page-board-select select { appearance: none; -webkit-appearance: none; padding-inline-end: 32px; text-overflow: ellipsis; }
.page-board-move { margin-top: 6px; }
.page-board-move select { width: 100%; min-height: 32px; padding-inline-start: 10px; border: 1px solid var(--page-pop-line); border-radius: 7px; background: var(--page-pop-bg); color: var(--page-ink); font: inherit; font-size: 14px; cursor: pointer; }
.page-board-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 32px; padding: 0 12px 0 10px; border: 1px solid var(--page-pop-line); border-radius: 7px; background: none; color: var(--page-pop-ink); font: inherit; font-size: 14px; cursor: pointer; transition: background-color var(--page-fade), color var(--page-fade); }
.page-board-btn:hover { background: var(--page-pop-hover); }
.page-board-btn .i { width: 14px; height: 14px; color: var(--page-pop-muted); }
.page-board-btn:disabled { background: none; color: var(--page-ink-faint); cursor: default; }
.page-board-btn:disabled .i { color: var(--page-ink-faint); }
.page-board-restore { flex: none; margin-inline-start: auto; }
.page-board-deleted { background: none; padding: 0; }
.page-board-deleted-toggle[aria-expanded="false"] svg { transform: rotate(-90deg); }
.page-board-deleted-list { list-style: none; margin: 0; padding: 0 0 0 12px; }
.page-board-deleted-item { display: flex; align-items: center; gap: 8px; min-height: 44px; color: var(--page-ink-soft); }
.page-board :is(button, select, input, textarea):focus-visible, .page-board-panel :is(button, select, input, textarea):focus-visible { outline: 2px solid var(--page-accent); outline-offset: 2px; }
.page-board-pop { position: absolute; z-index: 6; padding: 6px; border: 1px solid var(--page-pop-line); border-radius: var(--page-pop-radius); background: var(--page-pop-bg); box-shadow: var(--page-pop-shadow); color: var(--page-pop-ink); font-size: 14px; line-height: 1.4; }
.page-board-menu { top: calc(100% - 2px); inset-inline-end: -6px; width: 208px; }
.page-board-option { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 34px; padding: 4px 10px; border: 0; border-radius: 7px; background: none; color: inherit; font: inherit; text-align: start; cursor: pointer; }
.page-board-option:hover, .page-board-option[aria-selected="true"], .page-board-option[aria-pressed="true"] { background: var(--page-pop-hover); }
.page-board-option > .i { color: var(--page-pop-muted); }
.page-board-option.is-danger { color: var(--page-danger); }
.page-board-option.is-danger > .i { color: inherit; }
.page-board-option:disabled { color: var(--page-ink-faint); cursor: default; background: none; }
.page-board-option:disabled > .i { color: var(--page-ink-faint); }
.page-board-sep { height: 1px; margin: 4px 6px; background: var(--page-pop-line); }
.page-board-rename { flex: 1 1 auto; min-width: 0; height: 28px; margin: -4px 0 -4px -6px; padding: 0 6px; border: 0; border-radius: 6px; background: var(--page-pop-hover); color: var(--page-ink-strong); font: 600 14px/20px var(--page-font-heading); }
.page-board-new { display: block; width: 100%; min-height: 44px; margin-top: 8px; padding: 10px 12px; border: 1px solid var(--page-rule); border-radius: var(--page-board-radius); background: var(--page-pop-bg); color: var(--page-ink); font: 500 15px/21px var(--page-font); }
.page-board-new::placeholder, .page-board-rename::placeholder { color: var(--page-ink-faint); font-weight: 400; }
.page-board-card, .page-board-name, .page-board-count { -webkit-user-select: none; user-select: none; }
.page-editor[contenteditable="true"] .page-board-head[data-col] .page-board-name { cursor: grab; }
.page-board.is-dragging, .page-board.is-dragging * { cursor: grabbing; }
.page-board .is-drag-source { opacity: 0.45; }
.page-board-drop { height: 2px; margin-block: -5px; border-radius: 1px; background: var(--page-drop, var(--page-accent)); pointer-events: none; }
.page-board-drop.is-column { flex: 0 0 2px; align-self: stretch; width: 2px; height: auto; margin-block: 0; margin-inline: calc((var(--page-board-gap) + 2px) / -2); }
.page-board-ghost { position: fixed; z-index: 6; top: 0; left: 0; box-sizing: border-box; margin: 0; box-shadow: var(--page-pop-shadow); pointer-events: none; }
.page-board-lane.page-board-ghost { padding: 0 10px 10px; border-radius: var(--page-board-radius); background: var(--page-bg); }
.page-board-scrim { display: none; position: fixed; inset: 0; z-index: 4; background: var(--page-scrim); }
.page-board-panel { position: fixed; z-index: 5; inset-block: 0; inset-inline-end: 0; width: var(--page-board-panel); box-sizing: border-box; overflow-y: auto; padding: 18px 20px 24px; border-inline-start: 1px solid var(--page-pop-line); background: var(--page-pop-bg); color: var(--page-pop-ink); font-family: var(--page-font); font-size: 15px; line-height: 1.4; }
.page-shell.has-board-panel { padding-inline-end: calc(var(--page-board-panel) + 16px); }
.page-board-panel-top { display: flex; align-items: flex-start; gap: 8px; }
.page-board-panel-title { flex: 1 1 0; min-width: 0; margin: -4px 0 0 -8px; padding: 4px 8px; border: 0; border-radius: 7px; background: none; color: var(--page-ink-strong); font: 600 20px/28px var(--page-font-heading); field-sizing: content; resize: none; overflow: hidden; }
.page-board-panel-title:hover { background: var(--page-pop-hover); }
.page-board-close { width: 32px; height: 32px; margin: -2px -6px 0 0; color: var(--page-ink-soft); }
.page-board-fields { margin: 18px 0 0; border-top: 1px solid var(--page-pop-line); }
.page-board-field { position: relative; display: grid; grid-template-columns: 84px minmax(0, 1fr); align-items: center; column-gap: 8px; min-height: 44px; border-bottom: 1px solid var(--page-pop-line); }
.page-board-field.is-owner { align-items: start; padding-block: 8px; }
.page-board-field.is-owner .page-board-label { padding-top: 4px; }
.page-board-label { color: var(--page-pop-muted); font-size: 14px; }
.page-board-control { display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0; min-height: 34px; margin: 0; padding: 0 8px; border: 0; border-radius: 7px; background: none; color: var(--page-pop-ink); font: inherit; font-size: 15px; text-align: start; cursor: pointer; transition: background-color var(--page-fade); }
.page-board-control:hover { background: var(--page-pop-hover); }
.page-board-control > .i:last-child { margin-inline-start: auto; color: var(--page-ink-faint); }
.page-board-control-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.page-board-none { color: var(--page-ink-faint); }
.page-board-control .page-board-due { margin: 0; color: var(--page-pop-ink); font-weight: 400; }
.page-board-due-note { color: var(--page-pop-muted); font-size: 13px; }
.page-board-control .page-board-due + .page-board-due-note { margin-inline-start: auto; }
.page-board-control .page-board-due-note + .i { margin-inline-start: 0; }
.page-board-date { border: 1px solid var(--page-pop-line); cursor: text; }
.page-board-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 20px; }
.page-board-delete { margin-inline-start: auto; border-color: transparent; color: var(--page-pop-muted); }
.page-board-delete:hover { background: var(--page-pop-hover); color: var(--page-danger); }
.page-board-delete:hover .i { color: inherit; }
@media (max-width: 1039.98px) {
  .page-shell.has-board-panel { padding-inline-end: 16px; }
  .page-board-scrim { display: block; }
  .page-board-panel { inset: auto 0 0 0; width: auto; max-width: 640px; max-height: 85%; margin-inline: auto; padding: 14px 16px calc(16px + env(safe-area-inset-bottom)); border: 1px solid var(--page-pop-line); border-bottom: 0; border-radius: 16px 16px 0 0; box-shadow: var(--page-pop-shadow); }
  .page-board-close { width: 44px; height: 44px; margin: -8px -10px 0 0; }
  .page-board-panel-top { min-height: 36px; }
  .page-board-field { min-height: 48px; }
  .page-board-control { min-height: 44px; }
  .page-board-actions { margin-top: 16px; }
  .page-board-actions .page-board-btn { flex: 1 1 0; min-height: 44px; }
  .page-board-actions .page-board-delete { flex: 1 1 100%; margin-inline-start: 0; }
}
@media (max-width: 560px) {
  .page-board-scroll { scroll-snap-type: x proximity; scroll-padding-inline: 4px; }
  .page-board-lane { scroll-snap-align: start; }
  .page-board-head { padding: 12px 0 11px; }
  .page-board-head .page-board-icon { width: 44px; height: 44px; margin-block: -12px; }
  .page-board-colmenu { margin-inline-end: -12px; }
  .page-board-card { min-height: 44px; padding: 12px 14px 13px; }
  .page-board-add { min-height: 44px; padding-inline: 14px; }
  .page-board-addcol { width: 44px; height: 44px; margin-top: 0; }
  .page-board-tray-head { min-height: 48px; }
  .page-board-move select, .page-board-btn { min-height: 44px; }
  .page-board-move select, .page-board-new { font-size: 16px; }
  .page-board-option { min-height: 44px; }
  .page-board-rename { height: 44px; margin-block: -12px; font-size: 16px; }
  .page-board-panel { border-width: 1px 0 0; }
  .page-board-panel-title { margin-top: -8px; padding-block: 8px; }
  .page-board-control { font-size: 16px; }
  .page-board-label { font-size: 15px; }
}
@media (prefers-reduced-motion: reduce) {
  .page-board-icon, .page-board-card, .page-board-add, .page-board-addcol, .page-board-btn, .page-board-control { transition: none; }
}
`;
