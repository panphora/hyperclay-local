import React, { useState, useEffect, useRef } from 'react';

const ARROW_HEIGHT = 10;
const ARROW_HALF_WIDTH = 8;

// The seat C palette. `blue` and `muted` are the two colors the UI suite reads
// back as computed styles, so they keep their old values.
const C = {
  surface: '#171A27',
  well: '#11131D',
  wellHi: '#2A2F47',
  face: '#262B3F',
  faceHi: '#3B4263',
  faceLo: '#0B0C14',
  line: '#1C1F2E',
  text: '#DCDFEB',
  soft: '#A3A8C0',
  muted: '#6B7194',
  faint: '#454B68',
  green: '#45D17A',
  blue: '#69AEFE',
  amber: '#E8AD45',
  red: '#F0616A',
};

// One bevel rule: raised means you can press it, sunken means it is a readout.
const FACES = {
  plain: { bg: C.face, hi: C.faceHi, lo: C.faceLo, color: C.text },
  go: { bg: '#1F5A37', hi: '#3F8F5E', lo: '#0B2415', color: C.text },
  link: { bg: '#1D3F73', hi: '#3E6AAE', lo: '#0B1A33', color: C.text },
  warn: { bg: '#4A3A1C', hi: '#7A6232', lo: '#1E170A', color: '#F3D9A4' },
  bad: { bg: '#4F2227', hi: '#83404A', lo: '#1F0C0F', color: '#F5C0C4' },
};

const raised = (variant = 'plain', pressed = false) => {
  const f = FACES[variant] || FACES.plain;
  return {
    background: f.bg,
    color: f.color,
    border: 'none',
    borderRadius: 0,
    boxShadow: pressed
      ? `inset 1px 1px 0 ${f.lo}, inset -1px -1px 0 ${f.hi}`
      : `inset 1px 1px 0 ${f.hi}, inset -1px -1px 0 ${f.lo}`,
  };
};

const SUNKEN_TONES = {
  plain: { bg: C.well, hi: C.wellHi },
  warn: { bg: '#2B2415', hi: '#4A3D20' },
  bad: { bg: '#2C1519', hi: '#4D2530' },
};

const sunken = (tone = 'plain') => {
  const t = SUNKEN_TONES[tone] || SUNKEN_TONES.plain;
  return { background: t.bg, boxShadow: `inset 1px 1px 0 ${C.faceLo}, inset -1px -1px 0 ${t.hi}` };
};

const FIXEDSYS = '"Fixedsys", monospace';
const MONO = '"Berkeley Mono", monospace';

// Every pressable surface. Held down, it shows the sunken edges.
const Press = ({ variant, selected, disabled, onClick, style, children, ...rest }) => {
  const [held, setHeld] = useState(false);
  const [hover, setHover] = useState(false);
  return (
    <button
      {...rest}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => !disabled && setHover(true)}
      onMouseLeave={() => { setHover(false); setHeld(false); }}
      onMouseDown={() => !disabled && setHeld(true)}
      onMouseUp={() => setHeld(false)}
      style={{
        ...raised(variant, held || selected),
        fontFamily: FIXEDSYS,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        filter: hover && !held ? 'brightness(1.15)' : 'none',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </button>
  );
};

const small = { height: 24, padding: '0 9px', fontSize: 12, display: 'inline-flex', alignItems: 'center' };
const large = { height: 30, padding: '0 14px', fontSize: 13, display: 'inline-flex', alignItems: 'center' };

// A plain text button: footer items, in-list addresses, Dismiss. Never beveled.
const TextButton = ({ color = C.muted, style, children, ...rest }) => (
  <button
    {...rest}
    style={{
      background: 'transparent',
      border: 'none',
      padding: 0,
      cursor: 'pointer',
      color,
      fontFamily: MONO,
      ...style,
    }}
  >
    {children}
  </button>
);

const LED_COLORS = {
  green: { background: C.green, boxShadow: '0 0 6px rgba(69,209,122,.7)' },
  blue: { background: C.blue, boxShadow: '0 0 6px rgba(105,174,254,.6)' },
  amber: { background: C.amber, boxShadow: '0 0 6px rgba(232,173,69,.5)' },
  red: { background: C.red, boxShadow: '0 0 6px rgba(240,97,106,.6)' },
  off: { background: C.faint, boxShadow: 'none' },
};

const Led = ({ tone = 'off' }) => (
  <span style={{ width: 8, height: 8, flex: 'none', display: 'inline-block', ...LED_COLORS[tone] }} />
);

const STATE_TONE = {
  synced: 'green',
  syncing: 'blue',
  paused: 'amber',
  offline: 'amber',
  conflict: 'red',
  error: 'red',
  'port-taken': 'red',
};

const NOTE_COLOR = {
  paused: C.amber,
  offline: C.amber,
  conflict: C.red,
  error: C.red,
  'port-taken': C.red,
};

const STATE_CACHE_KEY = 'hyperclayPopoverStateCache.v2';
const DEFAULT_STATE = {
  serverEnabled: false,
  syncEnabled: false,
  hasApiKey: false,
  actor: null,
  banner: null,
  cards: [],
  activity: [],
  appVersion: null,
};

// Paint the popover from last-known state so it stays responsive even when
// the main process is blocked (e.g. first-launch safeStorage Keychain hit).
const readCachedState = () => {
  try {
    const raw = localStorage.getItem(STATE_CACHE_KEY);
    if (!raw) return DEFAULT_STATE;
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_STATE;
  }
};

const CACHED_STATE = readCachedState();

// C4 §4.9: the feed's five verbs. `line.path` and `line.verb` come from main.
const VERB_GLYPHS = {
  uploaded: { glyph: '↑', color: C.green },
  downloaded: { glyph: '↓', color: C.blue },
  conflict: { glyph: '!', color: C.red },
  deleted: { glyph: '×', color: C.muted },
  renamed: { glyph: '→', color: C.muted },
};

const PopoverApp = () => {
  const [arrowX, setArrowX] = useState(null);
  const [arrowPosition, setArrowPosition] = useState('top');
  const [currentView, setCurrentView] = useState('home');
  const [noticesTab, setNoticesTab] = useState('notices');
  const [setupAccountId, setSetupAccountId] = useState(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateVersion, setUpdateVersion] = useState(null);

  const [state, setState] = useState(CACHED_STATE);

  // Error queue
  const [errorQueue, setErrorQueue] = useState([]);
  const errorIdCounter = useRef(0);
  const unreadCount = errorQueue.filter(e => !e.read).length;

  // Credentials form
  const [credUsername, setCredUsername] = useState(CACHED_STATE.actor?.username || '');
  const [credApiKey, setCredApiKey] = useState('');
  const [credError, setCredError] = useState('');
  const [credLoading, setCredLoading] = useState(false);

  // Button loading states
  const [serverLoading, setServerLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  // Re-render lags a fast second click, so state alone can't debounce the
  // switches — these refs make the flips single-flight.
  const serverBusy = useRef(false);
  const syncBusy = useRef(false);

  const addError = (errorData) => {
    const errorId = errorIdCounter.current++;
    const error = {
      id: errorId,
      ...errorData,
      read: false,
      timestamp: errorData.timestamp || Date.now()
    };

    setErrorQueue(prev => {
      const isDuplicate = prev.some(e =>
        e.error === error.error && e.type === error.type &&
        (error.timestamp - e.timestamp) <= 5000
      );
      if (isDuplicate) return prev;
      return [...prev, error].slice(-50);
    });
  };

  const markErrorRead = (errorId) => {
    setErrorQueue(prev => prev.map(e =>
      e.id === errorId ? { ...e, read: true } : e
    ));
  };

  const dismissError = (errorId) => {
    setErrorQueue(prev => prev.filter(e => e.id !== errorId));
  };

  const markAllRead = () => {
    setErrorQueue(prev => prev.map(e => ({ ...e, read: true })));
  };

  const clearAllErrors = () => {
    setErrorQueue([]);
  };

  // Persist state to localStorage so the next popover open can paint instantly
  // from cache, even if the main process is momentarily unresponsive.
  useEffect(() => {
    try {
      localStorage.setItem(STATE_CACHE_KEY, JSON.stringify(state));
    } catch {}
  }, [state]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    api.getState().then((s) => {
      setState((prev) => ({ ...prev, ...s }));
      if (s.actor?.username) setCredUsername((current) => current || s.actor.username);
      if (s.availableUpdate) {
        setUpdateAvailable(true);
        setUpdateVersion(s.availableUpdate.latestVersion);
      }
    });

    const unsubscribe = [
      api.onArrowX((x) => setArrowX(x)),
      api.onArrowPosition((pos) => setArrowPosition(pos)),
      api.onStateUpdate((s) => {
        setState((prev) => ({ ...prev, ...s }));
      }),
      api.onSyncUpdate((data) => {
        if (data.error) {
          if (data.type === 'validation') {
            addError({
              ...data,
              priority: data.priority || 2,
              dismissable: true,
              error: `Validation failed: ${data.error}`,
              file: data.file
            });
          } else {
            addError(data);
          }
        }
      }),
      api.onSyncRetry((data) => {
        addError({
          ...data,
          priority: 3,
          type: 'sync_retry',
          dismissable: true,
          error: `Retrying ${data.file} (attempt ${data.attempt}/${data.maxAttempts})`
        });
      }),
      api.onSyncFailed((data) => {
        addError({
          ...data,
          error: `Failed to sync ${data.file} after ${data.attempts} attempts: ${data.error}`
        });
      }),
      api.onShowCredentials(() => {
        setCurrentView('credentials');
      }),
      api.onShowTeamSetup((data) => {
        if (!data || data.accountId == null) return;
        setSetupAccountId(data.accountId);
        setCurrentView('setup');
      }),
      api.onUpdateAvailable((data) => {
        setUpdateAvailable(true);
        setUpdateVersion(data.latestVersion);
      }),
    ];

    return () => unsubscribe.forEach((off) => off && off());
  }, []);

  // Auto-refresh the relative times the cards and the feed print
  const hasRelativeTime = state.cards.some((card) => card.lastSyncAt)
    || state.activity.some((line) => line.time);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!hasRelativeTime) return;
    const id = setInterval(() => setTick(t => t + 1), 10000);
    return () => clearInterval(id);
  }, [hasRelativeTime]);

  const handleServerFlip = async () => {
    if (serverBusy.current) return;
    serverBusy.current = true;
    setServerLoading(true);
    try {
      await window.electronAPI?.setServerEnabled(!state.serverEnabled);
    } finally {
      serverBusy.current = false;
      setServerLoading(false);
    }
  };

  const handleSyncFlip = async () => {
    if (syncBusy.current) return;

    if (!state.hasApiKey) {
      setCurrentView('credentials');
      return;
    }

    syncBusy.current = true;
    setSyncLoading(true);
    try {
      const result = await window.electronAPI?.setSyncEnabled(!state.syncEnabled);
      if (result?.error === 'no-api-key') setCurrentView('credentials');
    } finally {
      syncBusy.current = false;
      setSyncLoading(false);
    }
  };

  // First-run: choosing the folder also powers the server on, so one click
  // takes a fresh install to a served folder.
  const handleChooseFolder = async () => {
    if (serverBusy.current) return;
    const result = await window.electronAPI?.selectFolder();
    if (!result?.success) return;
    serverBusy.current = true;
    setServerLoading(true);
    try {
      await window.electronAPI?.setServerEnabled(true);
    } finally {
      serverBusy.current = false;
      setServerLoading(false);
    }
  };

  const handleCredentialsSubmit = async () => {
    if (!credApiKey.trim()) {
      setCredError('API key is required');
      return;
    }
    if (!credUsername.trim()) {
      setCredError('Username is required');
      return;
    }

    setCredLoading(true);
    setCredError('');

    try {
      const keyResult = await window.electronAPI?.setApiKey(credApiKey.trim(), undefined);

      if (!keyResult?.success) {
        setCredError(keyResult?.error || 'Invalid API key');
        return;
      }

      setCredUsername(keyResult.username || credUsername.trim());
      setCredApiKey('');

      await window.electronAPI?.setSyncEnabled(true);

      setCurrentView('home');
    } catch (err) {
      setCredError('Failed to connect');
    } finally {
      setCredLoading(false);
    }
  };

  const openNotices = () => {
    setNoticesTab('notices');
    setCurrentView('notices');
  };

  const handleAction = (action, card) => {
    const api = window.electronAPI;
    if (!api) return;

    if (action === 'open') api.openInBrowser(card.rootId);
    else if (action === 'reveal') api.revealFolder(card.rootId);
    else if (action === 'more') api.showCardMenu(card.rootId);
    else if (action === 'web') api.openWeb(card.accountId);
    else if (action === 'disconnect') api.disconnect(card.sessionId);
    else if (action === 'retry') api.retryPort(card.rootId);
    else if (action === 'change-port') api.changePort(card.rootId);
    else if (action === 'notices') openNotices();
    else if (action === 'setup') {
      setSetupAccountId(card.accountId);
      setCurrentView('setup');
    }
  };

  const handleOptions = () => {
    window.electronAPI?.showOptionsMenu();
  };

  const handleQuit = () => {
    window.electronAPI?.quitApp();
  };

  const navigateHome = () => {
    setCurrentView('home');
  };

  const setupCard = currentView === 'setup'
    ? (state.cards || []).find((card) => card.accountId === setupAccountId)
    : null;

  const heading = currentView === 'home' ? 'Hyperclay Local'
    : currentView === 'notices' ? 'Notices'
      : currentView === 'setup' ? `Set up ${(setupCard && setupCard.title) || 'team'}`
        : 'Connect';

  const arrowOnBottom = arrowPosition === 'bottom';
  const arrowHidden = arrowPosition === 'none';

  const arrowStyle = {
    position: 'absolute',
    left: arrowX != null ? arrowX : '50%',
    transform: `translateX(-${ARROW_HALF_WIDTH}px)`,
    width: 0,
    height: 0,
    borderLeft: `${ARROW_HALF_WIDTH}px solid transparent`,
    borderRight: `${ARROW_HALF_WIDTH}px solid transparent`,
    zIndex: 10,
  };

  if (arrowOnBottom) {
    arrowStyle.bottom = 0;
    arrowStyle.borderTop = `${ARROW_HALF_WIDTH}px solid ${C.surface}`;
  } else {
    arrowStyle.top = 2;
    arrowStyle.borderBottom = `${ARROW_HALF_WIDTH}px solid ${C.surface}`;
  }

  return (
    <div style={{
      padding: arrowOnBottom || arrowHidden ? 0 : `${ARROW_HEIGHT}px 0 0 0`,
      width: '100%',
      height: '100%',
      position: 'relative',
    }}>
      {!arrowOnBottom && !arrowHidden && <div style={arrowStyle} />}

      <div
        style={{
          background: C.surface,
          color: C.text,
          fontFamily: MONO,
          borderRadius: 10,
          overflow: 'hidden',
          height: arrowOnBottom || arrowHidden ? '100%' : `calc(100% - ${ARROW_HEIGHT}px)`,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Header
          view={currentView}
          heading={heading}
          unreadCount={unreadCount}
          onNotices={openNotices}
          onBack={navigateHome}
        />

        {currentView === 'home' && (
          <Plate
            banner={state.banner}
            updateVersion={updateAvailable ? updateVersion : null}
            onReconnect={() => setCurrentView('credentials')}
          />
        )}

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {currentView === 'home' && (
            <HomeView
              cards={state.cards || []}
              banner={state.banner}
              syncActive={!!state.hasApiKey && !!state.syncEnabled}
              serverLoading={serverLoading}
              onChooseFolder={handleChooseFolder}
              onAction={handleAction}
            />
          )}

          {currentView === 'notices' && (
            <NoticesView
              tab={noticesTab}
              onTab={setNoticesTab}
              unreadCount={unreadCount}
              errors={errorQueue}
              conflicts={state.conflicts || []}
              cards={state.cards || []}
              lines={state.activity || []}
              onMarkErrorRead={markErrorRead}
              onDismissError={dismissError}
              onMarkAllRead={markAllRead}
              onClearAll={clearAllErrors}
              onResolveConflict={(sessionId, path, choice) => window.electronAPI?.resolveConflict(sessionId, path, choice)}
            />
          )}

          {currentView === 'credentials' && (
            <CredentialsView
              username={credUsername}
              apiKey={credApiKey}
              error={credError}
              loading={credLoading}
              onUsernameChange={setCredUsername}
              onApiKeyChange={setCredApiKey}
              onSubmit={handleCredentialsSubmit}
              onCancel={navigateHome}
            />
          )}

          {currentView === 'setup' && (
            <TeamSetupView
              accountId={setupAccountId}
              home={state.home}
              onDone={navigateHome}
              onCancel={navigateHome}
            />
          )}
        </div>

        {currentView === 'home' && (
          <SwitchStrip
            serverEnabled={state.serverEnabled}
            syncEnabled={state.syncEnabled}
            hasApiKey={state.hasApiKey}
            serverLoading={serverLoading}
            syncLoading={syncLoading}
            onServerFlip={handleServerFlip}
            onSyncFlip={handleSyncFlip}
            onConnect={() => setCurrentView('credentials')}
          />
        )}

        <div style={{ height: 34, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px' }}>
          <TextButton onClick={handleOptions} style={{ fontSize: 12 }}>Options</TextButton>
          <span style={{ fontSize: 11, color: C.faint }}>{state.appVersion ? `v${state.appVersion}` : ''}</span>
          <TextButton onClick={handleQuit} style={{ fontSize: 12 }}>Quit</TextButton>
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// HEADER, PLATE, SWITCH STRIP
// =============================================================================

const BELL_ICON = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke={C.soft} strokeWidth="1.5">
    <path d="M4 11V7a4 4 0 0 1 8 0v4l1 1.5H3L4 11Z" />
    <path d="M6.5 14h3" />
  </svg>
);

const Header = ({ view, heading, unreadCount, onNotices, onBack }) => (
  <div style={{ height: 44, flex: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px 0 16px' }}>
    {view !== 'home' && (
      <Press
        onClick={onBack}
        title="Back"
        aria-label="Back"
        style={{ width: 28, height: 28, fontSize: 14, display: 'grid', placeItems: 'center', padding: 0 }}
      >
        ←
      </Press>
    )}
    <span data-view-heading style={{ flex: 1, fontFamily: FIXEDSYS, fontSize: 14, letterSpacing: '.02em', color: C.text }}>
      {heading}
    </span>
    {view === 'home' && (
      <Press
        onClick={onNotices}
        title="Notices"
        aria-label={unreadCount > 0 ? `Notices, ${unreadCount} unread` : 'Notices'}
        style={{ width: 30, height: 28, display: 'grid', placeItems: 'center', padding: 0, position: 'relative' }}
      >
        {BELL_ICON}
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: -5, right: -5, minWidth: 16, height: 16, padding: '0 4px',
            borderRadius: 8, background: C.amber, color: '#20180A', fontSize: 11, lineHeight: '16px', textAlign: 'center',
          }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </Press>
    )}
  </div>
);

const plateStyle = { margin: '0 16px 6px', padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, lineHeight: 1.4 };

const Plate = ({ banner, updateVersion, onReconnect }) => {
  if (banner === 'reconnect') {
    return (
      <div data-plate="reconnect" style={{ ...plateStyle, ...sunken('bad'), color: '#F5C0C4' }}>
        <span style={{ flex: 1 }}>Sync key no longer works.</span>
        <Press variant="bad" onClick={onReconnect} style={small}>Reconnect →</Press>
      </div>
    );
  }
  if (banner === 'server-update') {
    return (
      <div data-plate="server-update" style={{ ...plateStyle, ...sunken('warn'), color: '#F3D9A4' }}>
        <span style={{ flex: 1 }}>hyperclay.com needs an update before sync can run. Folders are still served.</span>
      </div>
    );
  }
  if (updateVersion) {
    return (
      <Press
        variant="link"
        onClick={() => window.electronAPI?.openBrowser('https://hyperclaylocal.com/')}
        style={{ ...plateStyle, fontFamily: MONO, textAlign: 'left', width: 'calc(100% - 32px)' }}
      >
        <span style={{ flex: 1 }}>Update v{updateVersion} available</span>
        <span>→</span>
      </Press>
    );
  }
  return null;
};

const Chip = ({ label, on, loading, onFlip, ariaLabel }) => (
  <Press
    role="switch"
    aria-checked={on}
    aria-label={ariaLabel}
    disabled={loading}
    onClick={onFlip}
    style={{
      height: 36, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 8px 0 12px', fontSize: 13, color: on ? C.text : C.muted, opacity: loading ? 0.7 : 1,
    }}
  >
    <span>{loading ? (on ? 'Stopping…' : 'Starting…') : (on ? label : `${label} off`)}</span>
    <span style={{ ...sunken(), width: 34, height: 18, padding: 2, display: 'flex', justifyContent: on ? 'flex-end' : 'flex-start' }}>
      <span style={{
        width: 14, height: 14, display: 'block',
        background: on ? C.green : '#4A5070',
        boxShadow: on ? '0 0 6px rgba(69,209,122,.6)' : 'none',
      }} />
    </span>
  </Press>
);

const SwitchStrip = ({
  serverEnabled, syncEnabled, hasApiKey, serverLoading, syncLoading, onServerFlip, onSyncFlip, onConnect,
}) => (
  <div style={{ flex: 'none', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '10px 16px' }}>
    <Chip
      label="Serve"
      on={serverEnabled}
      loading={serverLoading}
      onFlip={onServerFlip}
      ariaLabel={serverEnabled ? 'Turn server off' : 'Turn server on'}
    />
    {hasApiKey ? (
      <Chip
        label="Sync"
        on={syncEnabled}
        loading={syncLoading}
        onFlip={onSyncFlip}
        ariaLabel={syncEnabled ? 'Turn sync off' : 'Turn sync on'}
      />
    ) : (
      <Press onClick={onConnect} style={{ height: 36, fontSize: 13, color: C.blue }}>
        Connect sync →
      </Press>
    )}
  </div>
);

// =============================================================================
// HOME VIEW
// =============================================================================

const HomeView = ({ cards, banner, syncActive, serverLoading, onChooseFolder, onAction }) => {
  const personal = cards.find((card) => card.kind === 'personal');
  // Under an account-wide plate, Disconnect is the wrong advice; it stays in the ⋯ menu.
  const keyRevoked = banner === 'reconnect' || banner === 'server-update';
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '4px 16px 0' }}>
      {!personal && <FirstRun serverLoading={serverLoading} onChooseFolder={onChooseFolder} />}
      {personal && cards.length === 1 && <Hero card={personal} keyRevoked={keyRevoked} onAction={onAction} />}
      {(personal ? cards.length > 1 : cards.length > 0) && (
        <FolderList cards={cards} keyRevoked={keyRevoked} syncActive={syncActive} onAction={onAction} />
      )}
    </div>
  );
};

const cardAttrs = (card) => ({
  'data-card-state': card.state,
  'data-card-title': card.title || '',
  'data-card-folder': card.folder || '',
  'data-card-detail': card.detail || '',
  title: card.detailLong || undefined,
});

// The address a card shows: the served URL, the port it will start on, or its
// taken port. The span is the one element the UI suite reads the address from.
const addressOf = (card) => {
  if (card.url) return { text: card.url.replace('http://', ''), color: C.blue, live: true };
  if (card.port && card.state === 'port-taken') return { text: `localhost:${card.port}`, color: C.muted, live: false };
  if (card.port) return { text: `starts at :${card.port}`, color: C.muted, live: false };
  return null;
};

const heroStatus = (card) => {
  if (card.state === 'synced') {
    const ago = card.lastSyncAt ? ` ${formatRelativeTime(card.lastSyncAt)}` : '';
    const who = card.kind === 'personal' && card.title ? ` as @${card.title}` : '';
    return `Synced${ago}${who}`;
  }
  if (card.state === 'syncing') return capitalize(card.detail);
  return card.detailLong || capitalize(card.detail);
};

const CardButtons = ({ card, keyRevoked, onAction }) => {
  const buttons = [];
  if (card.state === 'conflict' || card.state === 'error') buttons.push(['notices', 'See notices']);
  if (card.actions.includes('change-port') && card.nextPort) buttons.push(['change-port', `Use port ${card.nextPort}…`]);
  if (card.actions.includes('retry')) buttons.push(['retry', 'Retry']);
  if (card.state === 'paused' && !keyRevoked && card.actions.includes('disconnect')) buttons.push(['disconnect', 'Disconnect…']);
  if (!buttons.length) return null;
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
      {buttons.map(([action, label]) => (
        <Press key={action} onClick={() => onAction(action, card)} style={small}>{label}</Press>
      ))}
    </div>
  );
};

const Hero = ({ card, keyRevoked, onAction }) => {
  const address = addressOf(card);
  const statusTone = card.state === 'serve-only' ? 'off' : (STATE_TONE[card.state] || 'off');
  return (
    <div {...cardAttrs(card)} style={{ marginTop: 14 }}>
      {address && (
        <Press
          onClick={() => onAction('open', card)}
          disabled={!address.live}
          style={{
            width: '100%', height: 52, padding: '0 14px', display: 'flex', alignItems: 'center', gap: 10,
            fontSize: 18, opacity: address.live ? 1 : 0.55,
          }}
        >
          <Led tone={address.live ? 'green' : (card.state === 'port-taken' ? 'red' : 'off')} />
          <span data-card-address style={{ color: address.color }}>{address.text}</span>
          {address.live && <span style={{ marginLeft: 'auto', color: C.soft, fontSize: 14 }}>↗</span>}
        </Press>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12, color: C.soft }}>
        <span
          title={card.folder || undefined}
          style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: 'rtl', textAlign: 'left' }}
        >
          <bdi>{card.folder}</bdi>
        </span>
        {card.rootId && <Press onClick={() => onAction('reveal', card)} style={small}>Reveal</Press>}
        {card.rootId && (
          <Press
            onClick={() => onAction('more', card)}
            title="More"
            aria-label={`More actions for ${card.title}`}
            style={{ ...small, color: C.soft }}
          >
            ···
          </Press>
        )}
      </div>
      <div style={{ ...sunken(), marginTop: 14, padding: '9px 12px', fontSize: 12, lineHeight: 1.45, color: C.soft, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ paddingTop: 4 }}><Led tone={statusTone} /></span>
        <span>{heroStatus(card)}</span>
      </div>
      <CardButtons card={card} keyRevoked={keyRevoked} onAction={onAction} />
    </div>
  );
};

const FolderList = ({ cards, keyRevoked, syncActive, onAction }) => {
  const compact = cards.length > 4;
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', paddingBottom: 4 }}>
      <div style={{ fontFamily: FIXEDSYS, fontSize: 11, letterSpacing: '.08em', color: C.muted, margin: '12px 0 6px' }}>
        FOLDERS{cards.length > 4 ? ` · ${cards.length}` : ''}
      </div>
      <div style={{ ...sunken(), minHeight: 0, overflowY: 'auto' }}>
        {cards.map((card, i) => (
          <FolderRow
            key={card.rootId || `account-${card.accountId}`}
            card={card}
            first={i === 0}
            compact={compact}
            keyRevoked={keyRevoked}
            syncActive={syncActive}
            onAction={onAction}
          />
        ))}
      </div>
    </div>
  );
};

// The switch strip already says sync is off or not connected, so a serve-only
// row only speaks when sync runs and this folder still does not (a detached team).
const rowNote = (card, compact, syncActive) => {
  if (card.state === 'synced') {
    return compact || !card.lastSyncAt ? null : `synced ${formatRelativeTime(card.lastSyncAt)}`;
  }
  if (card.state === 'serve-only' && !syncActive) return null;
  return card.detail;
};

const rowTag = (card) => (card.kind === 'personal' ? 'you' : (card.subtitle || '').split(' · ')[1] || 'team');

const FolderRow = ({ card, first, compact, keyRevoked, syncActive, onAction }) => {
  const address = addressOf(card);
  const note = rowNote(card, compact, syncActive);
  const inline = card.actions.find((a) => a === 'setup' || a === 'web') || null;
  return (
    <div
      {...cardAttrs(card)}
      style={{
        padding: '9px 10px 9px 12px',
        boxShadow: first ? 'none' : `inset 0 1px 0 ${C.line}`,
        opacity: card.state === 'viewer' ? 0.55 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <Led tone={STATE_TONE[card.state] || 'off'} />
        <span title={card.subtitle || undefined} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
          {card.title}
          <small style={{ color: C.muted, fontSize: 11, marginLeft: 6 }}>{rowTag(card)}</small>
        </span>
        {inline === 'setup' && <Press onClick={() => onAction('setup', card)} style={small}>Set up →</Press>}
        {inline === 'web' && <Press onClick={() => onAction('web', card)} style={small}>hyperclay.com ↗</Press>}
        {!inline && address && (
          address.live ? (
            <TextButton onClick={() => onAction('open', card)} color={C.blue} style={{ fontSize: 12 }}>
              <span data-card-address style={{ color: address.color }}>{address.text}</span>
            </TextButton>
          ) : (
            <span data-card-address style={{ color: address.color, fontSize: 12 }}>{address.text}</span>
          )
        )}
        {card.rootId && (
          <Press
            onClick={() => onAction('more', card)}
            title="More"
            aria-label={`More actions for ${card.title}`}
            style={{ ...small, width: 26, height: 22, padding: 0, justifyContent: 'center', color: C.soft }}
          >
            ···
          </Press>
        )}
      </div>
      {note && (
        <div style={{ marginTop: 3, paddingLeft: 18, fontSize: 11.5, color: NOTE_COLOR[card.state] || C.muted }}>
          {note}
        </div>
      )}
      <div style={{ paddingLeft: 18 }}>
        <CardButtons card={card} keyRevoked={keyRevoked} onAction={onAction} />
      </div>
    </div>
  );
};

const FirstRun = ({ serverLoading, onChooseFolder }) => (
  <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
    <div style={{ fontFamily: FIXEDSYS, fontSize: 16, color: C.text }}>Pick a folder to serve</div>
    <p style={{ margin: '12px 0 0', fontSize: 12, lineHeight: 1.5, color: C.soft }}>
      Every .html file in it opens in your browser and saves itself back into the folder.
    </p>
    <Press variant="go" onClick={onChooseFolder} disabled={serverLoading} style={{ ...large, marginTop: 16 }}>
      {serverLoading ? 'Starting…' : 'Choose Folder…'}
    </Press>
  </div>
);

// =============================================================================
// NOTICES VIEW (notices + activity)
// =============================================================================

const NoticesView = ({
  tab, onTab, unreadCount, errors, conflicts, cards, lines,
  onMarkErrorRead, onDismissError, onMarkAllRead, onClearAll, onResolveConflict,
}) => {
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '4px 16px 12px' }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <Press selected={tab === 'notices'} onClick={() => onTab('notices')} style={small}>
          Notices{unreadCount > 0 ? ` ${unreadCount}` : ''}
        </Press>
        <Press selected={tab === 'activity'} onClick={() => onTab('activity')} style={small}>Activity</Press>
        <span style={{ flex: 1 }} />
        {tab === 'notices' && (
          <>
            <Press onClick={onMarkAllRead} style={small}>Mark read</Press>
            <Press onClick={onClearAll} style={small}>Clear</Press>
          </>
        )}
      </div>
      <div style={{ ...sunken(), flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {tab === 'notices'
          ? <NoticeRows errors={errors} conflicts={conflicts} cards={cards} onMarkErrorRead={onMarkErrorRead} onDismissError={onDismissError} onResolveConflict={onResolveConflict} />
          : <ActivityRows lines={lines} />}
      </div>
      {tab === 'activity' && (
        <TextButton
          onClick={() => window.electronAPI?.openBrowser('https://hyperclay.com/dashboard')}
          color={C.faint}
          style={{ marginTop: 8, textAlign: 'left', fontSize: 11 }}
        >
          Shared documents and links are on the website
        </TextButton>
      )}
    </div>
  );
};

const logRow = (first) => ({ padding: '7px 10px', boxShadow: first ? 'none' : `inset 0 1px 0 ${C.line}` });

const NoticeRows = ({ errors, conflicts, cards, onMarkErrorRead, onDismissError, onResolveConflict }) => {
  const titleForSession = (sessionId) => {
    const card = (cards || []).find((candidate) => candidate.sessionId === sessionId);
    return card ? card.title : null;
  };

  const sortedErrors = [...errors].sort((a, b) => b.timestamp - a.timestamp);

  if (sortedErrors.length === 0 && (conflicts || []).length === 0) {
    return <div style={{ padding: '40px 0', textAlign: 'center', color: C.muted, fontSize: 13 }}>All quiet</div>;
  }

  return (
    <>
      {(conflicts || []).map((conflict, i) => {
        const label = titleForSession(conflict.sessionId);
        return (
          <div key={`conflict-${conflict.sessionId}-${conflict.path}-${i}`} style={logRow(i === 0)}>
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{ color: C.amber, fontSize: 12 }}>!</span>
              <span style={{ fontSize: 12, lineHeight: 1.4, color: C.text, wordBreak: 'break-word' }}>
                {label ? `${label}: ` : ''}{conflict.path} changed here and on hyperclay.com
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6, paddingLeft: 16 }}>
              <Press onClick={() => onResolveConflict(conflict.sessionId, conflict.path, 'mine')} style={small}>Keep mine</Press>
              <Press onClick={() => onResolveConflict(conflict.sessionId, conflict.path, 'theirs')} style={small}>Keep theirs</Press>
            </div>
          </div>
        );
      })}
      {sortedErrors.map((error, i) => {
        const label = error.sessionId ? titleForSession(error.sessionId) : null;
        return (
          <div
            key={error.id}
            style={{ ...logRow(i === 0 && !(conflicts || []).length), display: 'flex', gap: 8, alignItems: 'flex-start' }}
          >
            {!error.read ? (
              <button
                onClick={() => onMarkErrorRead(error.id)}
                title="Mark as read"
                aria-label="Mark as read"
                style={{
                  flex: 'none', marginTop: 5, width: 7, height: 7, borderRadius: '50%', border: 'none', padding: 0, cursor: 'pointer',
                  background: error.priority === 1 ? C.red : C.amber,
                }}
              />
            ) : (
              <div style={{ flex: 'none', width: 7 }} />
            )}
            <div style={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: 1.4, wordBreak: 'break-word', color: error.read ? C.soft : C.text }}>
              {label ? `${label}: ${error.error}` : error.error}
              {error.file && (
                <div style={{ marginTop: 2, fontSize: 11, color: C.muted }}>{error.file}</div>
              )}
              {error.dismissable !== false && error.priority !== 1 && (
                <TextButton
                  onClick={() => onDismissError(error.id)}
                  style={{ display: 'block', marginTop: 4, fontSize: 11, textDecoration: 'underline', textUnderlineOffset: 2 }}
                >
                  Dismiss
                </TextButton>
              )}
            </div>
            <div style={{ flex: 'none', fontSize: 11, color: C.muted }}>
              {formatRelativeTime(error.timestamp)}
            </div>
          </div>
        );
      })}
    </>
  );
};

const ActivityRows = ({ lines }) => {
  if (lines.length === 0) {
    return <div style={{ padding: '40px 0', textAlign: 'center', color: C.muted, fontSize: 13 }}>Transfers show up here</div>;
  }
  return lines.map((line, i) => {
    const verb = VERB_GLYPHS[line.verb] || { glyph: '·', color: C.muted };
    return (
      <div key={line.path + '-' + i} style={{ ...logRow(i === 0), display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ flex: 'none', width: 12, fontSize: 12, color: verb.color }}>{verb.glyph}</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: C.soft, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {line.path}
        </span>
        <span style={{ flex: 'none', fontSize: 11, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>
          {line.time ? formatShortTime(line.time) : ''}
        </span>
      </div>
    );
  });
};

// =============================================================================
// TEAM SETUP VIEW
// =============================================================================

const labelStyle = { fontFamily: FIXEDSYS, fontSize: 11, letterSpacing: '.08em', color: C.muted, margin: '14px 0 6px' };

const TeamSetupView = ({ accountId, home, onDone, onCancel }) => {
  const [setup, setSetup] = useState(null);
  const [folder, setFolder] = useState(null);
  const [alternative, setAlternative] = useState(null);
  const [folderError, setFolderError] = useState(null);
  const [trusted, setTrusted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    window.electronAPI?.getTeamSetup(accountId).then((result) => {
      if (!alive || !result || !result.ok) return;
      setSetup(result);
      setFolder(result.suggestedFolder || null);
    });
    return () => { alive = false; };
  }, [accountId]);

  const handleChooseFolder = async () => {
    const result = await window.electronAPI?.chooseTeamFolder(accountId);
    if (!result || !result.ok) return;
    setFolder(result.folder);
    if (result.empty) {
      setFolderError(null);
      setAlternative(null);
      return;
    }
    setFolderError("This folder isn't empty. A team folder has to start empty.");
    setAlternative(subfolderPath(result.folder, (setup && setup.username) || 'team'));
  };

  const handleSetup = async () => {
    if (saving || !folder || !trusted) return;
    setSaving(true);
    setError(null);
    try {
      const result = await window.electronAPI?.setupTeam(accountId, folder, true);
      if (result && result.ok === false) {
        setError('Could not set up this folder.');
        return;
      }
      onDone();
    } finally {
      setSaving(false);
    }
  };

  const username = (setup && setup.username) || 'this team';
  const role = setup && setup.role;
  const files = setup && setup.files;
  const size = formatBytes(setup && setup.bytes);

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 16px 12px', display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>
      <div style={{ fontSize: 12, color: C.soft }}>
        {(setup && setup.displayName) || username}{role ? ` · you're an ${role}` : ''}
      </div>

      <div style={labelStyle}>FOLDER</div>
      <div style={{ ...sunken(), padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: folder ? C.text : C.faint }}>
          {shortenHome(folder, home)}
        </span>
        <span style={{ marginLeft: 'auto', flex: 'none', fontSize: 11, color: C.muted }}>
          {setup && setup.folderIsNew ? '(new)' : ''}
        </span>
      </div>
      {folderError && (
        <div style={{ marginTop: 6, fontSize: 11.5, color: C.red }}>{folderError}</div>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
        {alternative && (
          <Press
            onClick={() => { setFolder(alternative); setFolderError(null); setAlternative(null); }}
            style={small}
          >
            Use {shortenHome(alternative, home)} instead
          </Press>
        )}
        <Press onClick={handleChooseFolder} style={small}>Choose another folder…</Press>
      </div>

      <div style={labelStyle}>OPENS AT</div>
      <div style={{ ...sunken(), padding: '9px 12px', fontSize: 12.5, color: C.text }}>
        {setup ? `localhost:${setup.port}` : '…'}
      </div>

      <div style={{ marginTop: 12, fontSize: 12, lineHeight: 1.5, color: C.soft }}>
        Pages in this folder come from {username}'s editors. They run in your browser at this address, like your own apps do.
      </div>

      <label style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', fontSize: 12.5, color: C.text }}>
        <input
          type="checkbox"
          checked={trusted}
          onChange={(e) => setTrusted(e.target.checked)}
          style={{ width: 14, height: 14, cursor: 'pointer', accentColor: C.green }}
        />
        I trust {username}'s editors
      </label>

      {error && (
        <div style={{ marginTop: 8, fontSize: 12, color: C.red }}>{error}</div>
      )}

      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <Press onClick={onCancel} style={large}>Cancel</Press>
        <Press variant="go" onClick={handleSetup} disabled={!trusted || !folder || saving} style={large}>
          Set up &amp; sync
        </Press>
      </div>

      <div style={{ marginTop: 10, fontSize: 11, color: C.muted }}>
        {!setup
          ? 'Counting files…'
          : (files == null ? '' : `${files} ${files === 1 ? 'file' : 'files'}${size ? `, ${size}` : ''} will download.`)}
      </div>
    </div>
  );
};

// =============================================================================
// CREDENTIALS VIEW
// =============================================================================

const fieldStyle = {
  ...sunken(),
  width: '100%',
  boxSizing: 'border-box',
  border: 'none',
  outline: 'none',
  padding: '8px 10px',
  fontSize: 13,
  fontFamily: MONO,
  color: C.text,
};

const CredentialsView = ({ username, apiKey, error, loading, onUsernameChange, onApiKeyChange, onSubmit, onCancel }) => {
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !loading) onSubmit();
  };

  return (
    <div style={{ flex: 1, padding: '4px 16px 12px' }}>
      <div style={{ fontSize: 12, lineHeight: 1.5, color: C.soft, marginBottom: 14 }}>
        Syncs your folders with hyperclay.com. Teams you're on appear automatically.
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', marginBottom: 5, fontSize: 12, color: C.soft }}>Username</label>
        <input
          type="text"
          value={username}
          onChange={(e) => onUsernameChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Your hyperclay.com username"
          style={fieldStyle}
        />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ display: 'block', marginBottom: 5, fontSize: 12, color: C.soft }}>API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => onApiKeyChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="hcsk_..."
          style={fieldStyle}
        />
      </div>

      {error && (
        <div style={{ marginBottom: 10, fontSize: 12, color: C.red, textAlign: 'center' }}>{error}</div>
      )}

      <Press variant="link" onClick={onSubmit} disabled={loading} style={{ ...large, width: '100%', justifyContent: 'center' }}>
        {loading ? 'Connecting...' : 'Connect & Enable Sync'}
      </Press>

      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <TextButton onClick={onCancel} style={{ fontSize: 12 }}>Cancel</TextButton>
        <TextButton
          onClick={() => window.electronAPI?.openBrowser('https://hyperclay.com/dashboard')}
          color={C.blue}
          style={{ fontSize: 12 }}
        >
          Get API key
        </TextButton>
      </div>
    </div>
  );
};

// =============================================================================
// HELPERS
// =============================================================================

function capitalize(text) {
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatRelativeTime(timestamp) {
  const diff = Date.now() - new Date(timestamp).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatShortTime(timestamp) {
  const diff = Date.now() - new Date(timestamp).getTime();
  const seconds = Math.floor(diff / 1000);
  let str;
  if (seconds < 10) str = 'now';
  else if (seconds < 60) str = `${seconds}s`;
  else {
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) str = `${minutes}m`;
    else {
      const hours = Math.floor(minutes / 60);
      if (hours < 24) str = `${hours}h`;
      else str = `${Math.floor(hours / 24)}d`;
    }
  }
  return str.padStart(3, ' ');
}

function formatBytes(bytes) {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function shortenHome(folder, home) {
  if (!folder) return '';
  const base = String(home || '').replace(/[\\/]+$/, '');
  if (base && (folder === base || folder.startsWith(`${base}/`) || folder.startsWith(`${base}\\`))) {
    return `~${folder.slice(base.length)}`;
  }
  return folder;
}

function subfolderPath(folder, name) {
  return `${String(folder).replace(/[\\/]+$/, '')}/${name}`;
}

export default PopoverApp;
