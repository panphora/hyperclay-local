import { inspectPage } from './page-admission.js';

export class PageFormatError extends Error {
  constructor() {
    super('A converted page must retain one complete Yjs page value');
    this.name = 'PageFormatError';
    this.code = 'page-format';
    this.statusCode = 409;
  }
}

export function checkPageWriteFormat({ currentHtml, html, room = null }) {
  if (room?.pageTransition?.format !== 'yjs' && inspectPage(currentHtml ?? '').kind !== 'yjs') return;
  const kind = inspectPage(html ?? '').kind;
  if (kind !== 'yjs' && kind !== 'none') throw new PageFormatError();
}

// A Yjs page room whose lineage the written document no longer carries: an
// outside edit or restore replaced the article, so the room's unsaved page
// edits belong in a recovered copy and the room must start over.
export function pageLineageLost(room, html) {
  return room?.pageTransition?.format === 'yjs' && room.stores.has('page') && inspectPage(html ?? '').kind === 'none';
}
