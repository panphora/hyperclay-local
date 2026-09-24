/**
 * The card model (C4 §5.1): every popover and tray decision the main process
 * makes, as data. Pure CommonJS, no `electron`, no clock, no filesystem: the
 * snapshot goes in, `Card`s and tray items come out, so jest can exercise each
 * state and each line of copy in the node environment.
 *
 * A card never carries an API key, a capability name or a server URL; the only
 * URLs it builds are the `url` and `webUrl` fields CONTRACTS §8 defines.
 */

const STATE_ORDER = ['error', 'port-taken', 'conflict', 'paused', 'offline', 'syncing',
  'synced', 'setup', 'viewer', 'serve-only'];

// C4 §4.9 as data. `{team}` is the account username, `{Team}` its display name.
const CARD_COPY = {
  synced: { detail: 'synced', detailLong: 'synced' },
  syncing: { one: 'syncing 1 file…', many: 'syncing {count} files…', none: 'syncing…' },
  'serve-only': {
    'no-key': { detail: 'not synced', detailLong: 'Served locally. Connect to sync it with hyperclay.com.' },
    'sync-off': { detail: 'sync off', detailLong: 'Sync is off for all folders.' },
    detached: { detail: 'local only · was {team}', detailLong: 'Disconnected from {team}. Still served here; nothing syncs.' },
  },
  setup: { detail: 'not on this computer', detailLong: "You're an editor on {Team}. Set up a folder to sync it here." },
  viewer: { detail: 'viewers use the site', detailLong: "You're a viewer on {Team}. Viewers open team documents on hyperclay.com." },
  conflict: {
    one: '1 conflict',
    many: '{count} conflicts',
    detailLong: 'A file changed here and on hyperclay.com. Both copies are kept; see Notices.',
  },
  offline: { detail: 'offline', detailLong: "Can't reach hyperclay.com. Changes sync when you're back online." },
  error: { detail: 'sync error', detailLong: '{error}' },
  'port-taken': {
    detail: 'Not served. Another program has :{port}.',
    detailLong: 'Not served. Another program has :{port}.',
  },
  paused: {
    viewer: {
      detail: "paused: you're a viewer",
      detailLong: "You're now a viewer on {Team}. Your files are still here and still served at localhost:{port}. Sync resumes if you're made an editor again.",
    },
    'plan-lapsed': {
      detail: 'paused: plan inactive',
      detailLong: "{team}'s plan isn't active. Your files are still here and still served. Sync resumes when the plan is active again.",
    },
    'plan-lapsed-personal': {
      detail: 'paused: plan inactive',
      detailLong: "your hyperclay.com plan isn't active. Your files are still here and still served. Sync resumes when the plan is active again.",
    },
    removed: {
      detail: 'paused: not on {team}',
      detailLong: "You're no longer on {Team}. Your files are still here and still served. Sync resumes if you're added back.",
    },
    unavailable: {
      detail: 'paused: team unavailable',
      detailLong: '{Team} was deleted or is unavailable on hyperclay.com. Your files are still here and still served.',
    },
    'key-revoked': {
      detail: 'paused: reconnect',
      detailLong: 'Your sync key no longer works. Reconnect to resume.',
    },
    forbidden: {
      detail: 'paused: no sync access',
      detailLong: "Your role on {Team} doesn't allow syncing right now. Your files are still here and still served.",
    },
    'server-update-required': {
      detail: 'paused: waiting for hyperclay.com',
      detailLong: "hyperclay.com needs an update before this folder can sync. It's still served.",
    },
    'folder-missing': {
      detail: 'paused: folder missing',
      detailLong: "This folder isn't there any more, so nothing syncs and nothing was deleted on hyperclay.com. Put it back, or Disconnect.",
    },
    'identity-mismatch': {
      detail: 'paused: set up again',
      detailLong: "This folder's sync records belong to a different account or folder, so nothing syncs. Disconnect, then set it up again.",
    },
  },
};

const STATUS_STATES = {
  idle: 'synced',
  syncing: 'syncing',
  conflict: 'conflict',
  offline: 'offline',
  error: 'error',
};

const ACTION_LABELS = {
  open: 'Open in Browser',
  reveal: 'Reveal Folder',
  backups: 'Backups',
  disconnect: 'Disconnect…',
  remove: 'Remove Folder…',
  setup: 'Set Up…',
  web: 'Open on hyperclay.com',
  retry: 'Retry',
  'change-port': 'Use Another Port…',
};

const VERBS = {
  upload: 'uploaded',
  download: 'downloaded',
  create: 'downloaded',
  trash: 'deleted',
  relocate: 'renamed',
  conflict: 'conflict',
};

const TRAY_WORDS = {
  error: ['error', 'errors'],
  'port-taken': ['port taken', 'ports taken'],
  conflict: ['conflict', 'conflicts'],
  paused: ['paused', 'paused'],
  offline: ['offline', 'offline'],
  syncing: ['syncing', 'syncing'],
  setup: ['not set up', 'not set up'],
  viewer: ['viewer', 'viewers'],
};

function fillCopy(template, values) {
  return template.replace(/\{(\w+)\}/g, (match, key) => (values[key] == null ? match : String(values[key])));
}

function plural(count, one, many) {
  return count === 1 ? one : many;
}

function baseName(dir) {
  const parts = String(dir || '').split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

function tilde(folder, home) {
  if (!folder) return null;
  const base = String(home || '').replace(/[\\/]+$/, '');
  if (base && (folder === base || folder.startsWith(`${base}/`) || folder.startsWith(`${base}\\`))) {
    return `~${folder.slice(base.length)}`;
  }
  return folder;
}

function lastSyncOf(session) {
  if (!session) return null;
  // C1-C2 §5.10: C3 names it `lastSyncAt`; C2's statuses() spelling is `lastSync`.
  if (session.lastSyncAt != null) return session.lastSyncAt;
  return session.lastSync != null ? session.lastSync : null;
}

function stateFor(root, session, snapshot) {
  if (root.portTaken) return 'port-taken';
  if (session && session.paused && session.paused.reason) {
    return session.paused.reason === 'port-taken' ? 'port-taken' : 'paused';
  }
  if (!session) return 'serve-only';
  if (snapshot.syncEnabled === false) return 'serve-only';
  return STATUS_STATES[session.status] || 'synced';
}

function rootActions(state, root, session) {
  const actions = ['open', 'reveal', 'backups'];
  if (root.kind !== 'personal') {
    if (session) actions.push('disconnect');
    actions.push('remove');
  }
  if (state === 'port-taken') actions.push('retry', 'change-port');
  else if (state === 'paused' && !actions.includes('disconnect')) actions.push('disconnect');
  return actions;
}

function rootCopy(state, { root, session, personal, username, displayName }) {
  const names = { team: username, Team: displayName, port: root.port };
  if (state === 'synced') return CARD_COPY.synced;
  if (state === 'offline') return CARD_COPY.offline;
  if (state === 'syncing') {
    const count = session && Number.isFinite(session.pendingCount) ? session.pendingCount : 0;
    const detail = count > 0 ? plural(count, CARD_COPY.syncing.one, fillCopy(CARD_COPY.syncing.many, { count })) : CARD_COPY.syncing.none;
    return { detail, detailLong: detail };
  }
  if (state === 'conflict') {
    const count = (session && session.conflicts && session.conflicts.length) || 1;
    return {
      detail: plural(count, CARD_COPY.conflict.one, fillCopy(CARD_COPY.conflict.many, { count })),
      detailLong: CARD_COPY.conflict.detailLong,
    };
  }
  if (state === 'error') {
    return { detail: CARD_COPY.error.detail, detailLong: (session && session.lastError) || CARD_COPY.error.detail };
  }
  if (state === 'port-taken') {
    return {
      detail: fillCopy(CARD_COPY['port-taken'].detail, names),
      detailLong: fillCopy(CARD_COPY['port-taken'].detailLong, names),
    };
  }
  if (state === 'serve-only') {
    if (!session) {
      if (!personal && root.formerAccount && root.formerAccount.username) {
        const copy = CARD_COPY['serve-only'].detached;
        return { detail: fillCopy(copy.detail, names), detailLong: fillCopy(copy.detailLong, names) };
      }
      return CARD_COPY['serve-only']['no-key'];
    }
    return CARD_COPY['serve-only']['sync-off'];
  }
  if (state === 'setup') {
    return { detail: CARD_COPY.setup.detail, detailLong: fillCopy(CARD_COPY.setup.detailLong, names) };
  }
  if (state === 'viewer') {
    return { detail: CARD_COPY.viewer.detail, detailLong: fillCopy(CARD_COPY.viewer.detailLong, names) };
  }
  if (state === 'paused') {
    const reason = session.paused.reason;
    const copy = CARD_COPY.paused[personal && reason === 'plan-lapsed' ? 'plan-lapsed-personal' : reason];
    return { detail: fillCopy(copy.detail, names), detailLong: fillCopy(copy.detailLong, names) };
  }
  return { detail: null, detailLong: null };
}

function rootCard(root, session, snapshot, accountsById) {
  const personal = root.kind === 'personal';
  let account = null;
  if (session && session.accountId != null) account = accountsById.get(session.accountId) || null;
  if (!account && personal) account = (snapshot.accounts || []).find((a) => a.kind === 'personal') || null;

  let username = null;
  if (session && session.cached && session.cached.username) username = session.cached.username;
  else if (account && account.username) username = account.username;
  else if (root.formerAccount && root.formerAccount.username) username = root.formerAccount.username;
  else if (personal && snapshot.actor && snapshot.actor.username) username = snapshot.actor.username;
  if (!username) username = baseName(root.path);

  const displayName = personal
    ? 'personal'
    : (session && session.cached && session.cached.displayName) || (account && account.displayName) || username;
  const role = personal
    ? null
    : (session && session.cached && session.cached.role) || (account && account.role) || null;

  const state = stateFor(root, session, snapshot);
  const copy = rootCopy(state, { root, session, personal, username, displayName });

  const card = {
    rootId: root.id,
    sessionId: session ? session.id : null,
    accountId: account ? account.id : (root.formerAccount && root.formerAccount.id != null ? root.formerAccount.id : null),
    kind: root.kind,
    port: root.port == null ? null : root.port,
    nextPort: root.nextPort == null ? null : root.nextPort,
    webUrl: (account && account.webUrl) || null,
    lastSyncAt: lastSyncOf(session),
    title: username,
    subtitle: [displayName, role].filter(Boolean).join(' · '),
    folder: tilde(root.path, snapshot.home),
    url: snapshot.serverEnabled && root.running ? `http://localhost:${root.port}` : null,
    state,
    detail: copy.detail,
    detailLong: copy.detailLong,
    actions: rootActions(state, root, session),
  };
  return { card, sortName: displayName };
}

function accountCard(account, state) {
  const username = account.username || null;
  const displayName = account.displayName || username;
  const copy = state === 'viewer' ? CARD_COPY.viewer : CARD_COPY.setup;
  const card = {
    sessionId: null,
    accountId: account.id,
    kind: 'team',
    port: null,
    nextPort: null,
    webUrl: account.webUrl || null,
    lastSyncAt: null,
    title: username,
    subtitle: [displayName, account.role].filter(Boolean).join(' · '),
    folder: null,
    url: null,
    state,
    detail: copy.detail,
    detailLong: fillCopy(copy.detailLong, { team: username, Team: displayName }),
    actions: state === 'viewer' ? ['web'] : ['setup'],
  };
  return { card, sortName: displayName };
}

function buildCards(snapshot) {
  const s = snapshot || {};
  const roots = s.roots || [];
  const sessions = s.sessions || [];
  const accounts = s.accounts || [];
  const accountsById = new Map(accounts.map((a) => [a.id, a]));

  const sessionByRootId = new Map();
  for (const session of sessions) sessionByRootId.set(session.rootId, session);

  const accountsWithRoots = new Set();
  for (const root of roots) {
    const session = sessionByRootId.get(root.id);
    const accountId = session ? session.accountId : (root.formerAccount ? root.formerAccount.id : null);
    if (accountId != null) accountsWithRoots.add(accountId);
  }

  const personal = [];
  const teams = [];
  for (const root of roots) {
    const entry = rootCard(root, sessionByRootId.get(root.id), s, accountsById);
    (root.kind === 'personal' ? personal : teams).push(entry);
  }
  for (const account of accounts) {
    if (account.kind !== 'team' || accountsWithRoots.has(account.id)) continue;
    if (account.sync && account.sync.enabled === true) teams.push(accountCard(account, 'setup'));
    else if (account.sync && account.sync.reason === 'viewer') teams.push(accountCard(account, 'viewer'));
  }

  teams.sort((a, b) => {
    const left = String(a.sortName || '').toLowerCase();
    const right = String(b.sortName || '').toLowerCase();
    if (left === right) return 0;
    return left < right ? -1 : 1;
  });

  return [...personal.map((entry) => entry.card), ...teams.map((entry) => entry.card)];
}

function worstState(cards) {
  let best = STATE_ORDER.length;
  for (const c of cards || []) best = Math.min(best, STATE_ORDER.indexOf(c.state));
  return STATE_ORDER[best] || 'serve-only';
}

function trayIconVariant(worst) {
  if (worst === 'error' || worst === 'port-taken' || worst === 'conflict') return 'alert';
  if (worst === 'paused' || worst === 'offline') return 'dim';
  return 'normal';
}

function trayTooltip(cards) {
  const list = cards || [];
  const worst = worstState(list);
  if (!list.length || worst === 'synced' || worst === 'serve-only') return 'Hyperclay Local';
  const count = list.filter((card) => card.state === worst).length;
  const word = plural(count, TRAY_WORDS[worst][0], TRAY_WORDS[worst][1]);
  return `Hyperclay Local: ${list.length} ${plural(list.length, 'folder', 'folders')}, ${count} ${word}`;
}

function switchSublines(snapshot, cards) {
  const s = snapshot || {};
  const count = (cards || []).filter((card) => card.rootId).length;
  const folders = `${count} ${plural(count, 'folder', 'folders')}`;
  const actor = s.actor && s.actor.username ? `@${s.actor.username}` : '';
  let sync;
  if (!s.hasApiKey) sync = 'syncs with hyperclay.com';
  else sync = s.syncEnabled === false ? `${actor} · paused` : actor;
  return { server: s.serverEnabled ? `${folders} served` : `starts ${folders}`, sync };
}

function toLine(event, sessionsById, personalUsername) {
  const e = event || {};
  const verb = VERBS[e.action];
  if (!verb) return null;
  const session = sessionsById && sessionsById.get ? sessionsById.get(e.sessionId) : null;
  const username = (session && session.kind !== 'personal' && session.cached && session.cached.username)
    ? session.cached.username
    : personalUsername;
  return {
    time: e.timestamp == null ? null : e.timestamp,
    path: `${username}/${e.file}`,
    verb,
    sessionId: e.sessionId == null ? null : e.sessionId,
  };
}

function trayCardLabel(card) {
  if (card.url) return `${card.title}  localhost:${card.port}`;
  if (card.state === 'setup') return `${card.title}  (not set up)`;
  if (card.state === 'port-taken') return `${card.title}  (port ${card.port} in use)`;
  if (card.port) return `${card.title}  (not served)`;
  return card.title;
}

function trayCardItem(card) {
  return {
    label: trayCardLabel(card),
    submenu: card.actions.map((action) => ({
      label: ACTION_LABELS[action],
      enabled: action === 'open' ? !!card.url : true,
    })),
  };
}

function trayMenuModel(cards, flags) {
  const f = flags || {};
  const items = [
    { label: `Server: ${f.serverEnabled ? 'On' : 'Off'}`, enabled: false },
    { label: `Sync: ${f.syncEnabled ? 'On' : 'Off'}`, enabled: false },
    { label: `AI Editing: ${f.aiEditEnabled ? 'On' : 'Off'}`, enabled: false },
    { type: 'separator' },
    { label: f.serverEnabled ? 'Stop Server' : 'Start Server' },
    { label: f.syncEnabled ? 'Disable Sync' : 'Enable Sync', enabled: !!f.hasApiKey },
    { label: f.aiEditEnabled ? 'Disable AI Editing' : 'Enable AI Editing' },
    { type: 'separator' },
  ];

  for (const card of cards || []) {
    if (card.state === 'viewer') continue;
    items.push(trayCardItem(card));
  }

  items.push(
    { type: 'separator' },
    { label: 'View Sync Logs' },
    { label: 'View Error Logs' },
    { label: 'About Hyperclay Local' },
    { type: 'separator' },
    { label: 'Quit' },
  );
  return items;
}

module.exports = {
  buildCards,
  worstState,
  trayIconVariant,
  trayTooltip,
  switchSublines,
  toLine,
  CARD_COPY,
  STATE_ORDER,
  trayMenuModel,
};
