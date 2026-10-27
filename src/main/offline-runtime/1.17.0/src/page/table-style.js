export const TABLE_CSS = `
.page-editor .page-table { position: relative; }
.page-table td { position: relative; }
.page-table th { position: relative; }
.page-table td.is-cell-selected { background: var(--page-block-selected); }
.page-editor.has-cell-rect .page-table td ::selection, .page-editor.has-cell-rect .page-table td::selection { background: transparent; }
.page-editor.has-cell-rect .page-table td { caret-color: transparent; }
.page-table table.is-sized { table-layout: fixed; min-width: 0; }
.page-table table.is-sized th, .page-table table.is-sized td { min-width: 0; overflow-wrap: anywhere; }
.page-table-resize { position: absolute; top: 0; bottom: 0; inset-inline-end: -4px; width: 8px; z-index: 2; cursor: col-resize; touch-action: none; }
.page-table-resize:hover, .page-table-resize:active, .page-table-resize:focus-visible { background: var(--page-accent); opacity: 0.4; }
.page-table-add-row, .page-table-add-col { position: absolute; z-index: 1; border: 0; padding: 0; background: var(--page-chrome-bg-rest); color: var(--page-chrome-ink-rest); font: inherit; line-height: 1; cursor: pointer; opacity: 0; transition: opacity 120ms; }
.page-table-add-row { left: 0; right: 0; top: 100%; height: 14px; border-radius: 0 0 6px 6px; }
.page-table-add-col { top: 0; bottom: 0; left: 100%; width: 14px; border-radius: 0 6px 6px 0; }
.page-table:hover > .page-table-add-row, .page-table:hover > .page-table-add-col, .page-table-add-row:focus-visible, .page-table-add-col:focus-visible { opacity: 1; }
.page-table-add-row:hover, .page-table-add-col:hover { background: var(--page-chrome-bg-moved); color: var(--page-ink-soft); }
.page-table-date { position: absolute; inset-inline-start: 0; top: 100%; z-index: 3; font: inherit; color: var(--page-pop-ink); background: var(--page-pop-bg); border: 1px solid var(--page-pop-line); border-radius: 6px; padding: 4px 6px; box-shadow: var(--page-pop-shadow); }
@media (max-width: 560px) {
  .page-table-date { min-height: 44px; }
  .page-table-resize { display: none; }
  .page-table-add-row, .page-table-add-col { position: static; display: inline-block; width: 50%; height: 44px; border-radius: 0; opacity: 1; border-block-start: 1px solid var(--page-rule); }
  .page-table-add-row::after { content: " Row"; }
  .page-table-add-col::after { content: " Column"; }
}
`;
