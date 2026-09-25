/**
 * The pure half of the main process's IPC surface (C4 §5.2): which id names a
 * root, a session or a discovered account, what each native dialog says (§4.9),
 * which URLs `open-browser` may point at and what the card's `⋯` menu holds
 * (§4). No `electron` import, no filesystem: jest exercises every branch in the
 * node environment.
 */

const EXTERNAL_URL_PREFIXES = ['https://hyperclay.com/', 'https://hyperclaylocal.com/'];

const CARD_MENU_ACTIONS = ['open', 'copy', 'reveal', 'backups', 'disconnect', 'remove'];
const CARD_MENU_LABELS = {
  open: 'Open in Browser',
  copy: 'Copy Address',
  reveal: 'Reveal Folder',
  backups: 'Backups',
  disconnect: 'Disconnect…',
  remove: 'Remove Folder…',
};
const MENU_SEPARATOR_BEFORE = ['disconnect', 'remove'];

function unknownId() {
  return { ok: false, error: 'unknown' };
}

/** C4 §5.2: the update banner, `Get API key` and the shared-documents link, nothing else. */
function isAllowedExternalUrl(url) {
  if (typeof url !== 'string') return false;
  return EXTERNAL_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

function requireRoot(roots, rootId) {
  const root = (roots || []).find((candidate) => candidate.id === rootId) || null;
  return root ? { ok: true, root } : unknownId();
}

function requireSession(sessions, sessionId) {
  const session = (sessions || []).find((candidate) => candidate.id === sessionId) || null;
  return session ? { ok: true, session } : unknownId();
}

function requireAccount(accounts, accountId) {
  const account = (accounts || []).find((candidate) => candidate.id === accountId) || null;
  return account ? { ok: true, account } : unknownId();
}

function questionDialog({ message, detail, action }) {
  return {
    type: 'question',
    message,
    detail,
    buttons: [action, 'Cancel'],
    defaultId: 1,
    cancelId: 1,
  };
}

/** C4 §4.9: sync stops; the folder stays and still serves. Cancel is the default. */
function disconnectDialog({ team, folder, port }) {
  return questionDialog({
    message: `Disconnect ${team}?`,
    detail: `Sync stops. The folder ${folder} stays on your computer and is still served at localhost:${port}.`,
    action: 'Disconnect',
  });
}

/** C4 §4.9: the folder and its files stay on disk, the port stops answering. */
function removeFolderDialog({ folder, port }) {
  return questionDialog({
    message: `Remove ${folder}?`,
    detail: `Sync stops and localhost:${port} stops answering. The folder and its files stay on your computer.`,
    action: 'Remove',
  });
}

/** C4 §4.9: main picks the next port, so this is the only place that names it. */
function movePortDialog({ title, port, nextPort }) {
  return questionDialog({
    message: `Move ${title} to localhost:${nextPort}?`,
    detail: `Links and bookmarks to localhost:${port} will stop working. The htmlclay wire command finds the new port by itself.`,
    action: 'Move',
  });
}

/**
 * C4 §4: the folder as a header, open, copy, reveal, backups, then the two that
 * change what this computer does. Open and copy need a served address. Outside
 * macOS a single `&` in a menu label is an accelerator marker, so the path
 * doubles it.
 */
function cardMenuModel(card, platform = process.platform) {
  const actions = (card && card.actions) || [];
  const served = !!(card && card.url);
  const items = [];
  if (card && card.folder) {
    const label = platform === 'darwin' ? card.folder : card.folder.replace(/&/g, '&&');
    items.push({ label, enabled: false }, { type: 'separator' });
  }
  let separated = false;
  for (const action of CARD_MENU_ACTIONS) {
    if (action === 'copy' ? !served : !actions.includes(action)) continue;
    if (MENU_SEPARATOR_BEFORE.includes(action) && items.length && !separated) {
      items.push({ type: 'separator' });
      separated = true;
    }
    const item = { label: CARD_MENU_LABELS[action], action };
    if (action === 'open' && !served) item.enabled = false;
    items.push(item);
  }
  return items;
}

/** C4 §5.4: one notice row per open conflict, each carrying its session's id. */
function flattenConflicts(statuses = []) {
  const conflicts = [];
  for (const status of statuses || []) {
    if (!status) continue;
    for (const conflict of status.conflicts || []) {
      conflicts.push({ sessionId: status.sessionId, path: conflict.path, kind: conflict.kind });
    }
  }
  return conflicts;
}

const ACTIVITY_THROTTLE_MS = 250;

/**
 * C4 §5.4: at most one call per `wait`, the trailing call always made, so the
 * feed's newest line is never dropped. One timer at a time; `cancel` clears it.
 */
function createThrottle(fn, wait = ACTIVITY_THROTTLE_MS) {
  let timer = null;
  let lastRunAt = -Infinity;

  const run = () => {
    timer = null;
    lastRunAt = Date.now();
    fn();
  };

  const throttled = () => {
    if (timer) return;
    const elapsed = Date.now() - lastRunAt;
    if (elapsed >= wait) {
      run();
      return;
    }
    timer = setTimeout(run, wait - elapsed);
  };

  throttled.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  return throttled;
}

module.exports = {
  EXTERNAL_URL_PREFIXES,
  unknownId,
  isAllowedExternalUrl,
  requireRoot,
  requireSession,
  requireAccount,
  disconnectDialog,
  removeFolderDialog,
  movePortDialog,
  cardMenuModel,
  flattenConflicts,
  ACTIVITY_THROTTLE_MS,
  createThrottle,
};
