import React, { useState, useEffect, useRef } from 'react';

const ARROW_HEIGHT = 10;
const ARROW_HALF_WIDTH = 8;

// Revision B palette — single source for the bevel/LED colors used inline
const C = {
  surface: '#151722',
  raised: '#1B1E2C',
  well: '#10121C',
  border: '#292F52',
  bevelLt: '#474C65',
  bevelDk: '#0D0F18',
  text: '#E8EAF6',
  text2: '#B8BFE5',
  muted: '#6B7194',
  faint: '#454A68',
  ledGreen: '#28C83E',
  greenFill: '#1E8136',
  greenHover: '#23973F',
  greenLt: '#56B96C',
  greenDk: '#15311C',
  blue: '#69AEFE',
  blueFill: '#1D498E',
  blueLt: '#4F7CC4',
  blueDk: '#0F2447',
  fault: '#F73D48',
  faultFill: '#7B2525',
  faultLt: '#B45454',
  faultDk: '#371111',
  amber: '#E3A93C',
};

const bevelOut = (lt, dk) => ({
  borderWidth: 2,
  borderStyle: 'solid',
  borderTopColor: lt,
  borderLeftColor: lt,
  borderBottomColor: dk,
  borderRightColor: dk,
});

const bevelIn = () => ({
  borderWidth: 2,
  borderStyle: 'solid',
  borderTopColor: C.bevelDk,
  borderLeftColor: C.bevelDk,
  borderBottomColor: C.bevelLt,
  borderRightColor: C.bevelLt,
});

const Led = ({ on, color = C.ledGreen, glow = 'rgba(40,200,62,0.55)' }) => (
  <span
    className="inline-block shrink-0"
    style={{
      width: 7,
      height: 7,
      background: on ? color : '#3A3F58',
      boxShadow: on ? `0 0 6px ${glow}` : 'none',
    }}
  />
);

const Rocker = ({ on, disabled, onFlip, label }) => (
  <button
    role="switch"
    aria-checked={on}
    aria-label={label}
    disabled={disabled}
    onClick={disabled ? undefined : onFlip}
    className="ml-auto flex p-0 shrink-0"
    style={{
      width: 58,
      height: 21,
      background: C.well,
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.45 : 1,
      ...bevelIn(),
    }}
  >
    <span
      className="flex items-center justify-center pointer-events-none"
      style={{
        width: '50%',
        height: '100%',
        marginLeft: on ? '50%' : 0,
        fontFamily: '"Fixedsys", monospace',
        fontSize: 12,
        lineHeight: 1,
        color: on ? '#F6F7FB' : C.text2,
        background: on ? C.greenFill : '#2A2E45',
        ...(on ? bevelOut(C.greenLt, C.greenDk) : bevelOut(C.bevelLt, C.bevelDk)),
      }}
    >
      <span style={{ display: 'block', transform: 'translateY(-1px)' }}>
        {on ? 'ON' : 'OFF'}
      </span>
    </span>
  </button>
);

const BevelButton = ({ label, onClick, variant, disabled, small, tiny, style: extraStyle }) => {
  const [hover, setHover] = useState(false);
  const [active, setActive] = useState(false);

  const colors = {
    success: { bg: C.greenFill, hover: C.greenHover, tl: C.greenLt, br: C.greenDk },
    danger: { bg: C.faultFill, hover: '#9F3030', tl: C.faultLt, br: C.faultDk },
    sync: { bg: C.blueFill, hover: '#2156A8', tl: C.blueLt, br: C.blueDk },
    neutral: { bg: '#1D1F2F', hover: '#232639', tl: C.bevelLt, br: '#131725' },
  };

  const c = colors[variant] || colors.neutral;
  const fontSize = tiny ? 12 : small ? 15 : 16;
  const padding = tiny ? '2px 7px 3px' : small ? '4px 10px 5px' : '5px 12px 7px';

  return (
    <button
      style={{
        padding,
        fontSize,
        fontFamily: '"Fixedsys", monospace',
        borderWidth: 2,
        borderStyle: 'solid',
        borderTopColor: active ? c.br : c.tl,
        borderLeftColor: active ? c.br : c.tl,
        borderBottomColor: active ? c.tl : c.br,
        borderRightColor: active ? c.tl : c.br,
        borderRadius: 0,
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: '#F6F7FB',
        textAlign: 'center',
        background: disabled ? c.bg : (hover ? c.hover : c.bg),
        opacity: disabled ? 0.5 : 1,
        ...extraStyle,
      }}
      onMouseEnter={() => !disabled && setHover(true)}
      onMouseLeave={() => { setHover(false); setActive(false); }}
      onMouseDown={() => !disabled && setActive(true)}
      onMouseUp={() => setActive(false)}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
    >
      <span style={{
        display: 'inline-block',
        whiteSpace: 'nowrap',
        userSelect: 'none',
        transform: active ? 'translate(1px, 1px)' : 'none',
      }}>
        {label}
      </span>
    </button>
  );
};

const LED_BY_STATE = {
  synced: { on: true, color: C.ledGreen, glow: 'rgba(40,200,62,0.55)' },
  syncing: { on: true, color: C.ledGreen, glow: 'rgba(40,200,62,0.55)' },
  paused: { on: true, color: C.amber, glow: 'rgba(227,169,60,0.5)' },
  offline: { on: true, color: C.amber, glow: 'rgba(227,169,60,0.5)' },
  conflict: { on: true, color: C.fault, glow: 'rgba(247,61,72,0.55)' },
  error: { on: true, color: C.fault, glow: 'rgba(247,61,72,0.55)' },
  'port-taken': { on: true, color: C.fault, glow: 'rgba(247,61,72,0.55)' },
};

const linkClass = "bg-transparent border-none p-0 cursor-pointer text-[11.5px] font-['Berkeley_Mono',monospace] hover:underline";

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
  uploaded: { glyph: '↑', color: C.ledGreen },
  downloaded: { glyph: '↓', color: C.blue },
  conflict: { glyph: '!', color: C.fault },
  deleted: { glyph: '×', color: C.muted },
  renamed: { glyph: '→', color: C.muted },
};

const PopoverApp = () => {
  const [arrowX, setArrowX] = useState(null);
  const [arrowPosition, setArrowPosition] = useState('top');
  const [currentView, setCurrentView] = useState('home');
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
  // rockers — these refs make the flips single-flight.
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

  const handleAction = (action, card) => {
    const api = window.electronAPI;
    if (!api) return;

    if (action === 'open') api.openInBrowser(card.rootId);
    else if (action === 'copy') api.copyText(card.url);
    else if (action === 'reveal') api.revealFolder(card.rootId);
    else if (action === 'more') api.showCardMenu(card.rootId);
    else if (action === 'web') api.openWeb(card.accountId);
    else if (action === 'disconnect') api.disconnect(card.sessionId);
    else if (action === 'retry') api.retryPort(card.rootId);
    else if (action === 'change-port') api.changePort(card.rootId);
    else if (action === 'notices') setCurrentView('notices');
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

  const toggleNotices = () => {
    setCurrentView(currentView === 'notices' ? 'home' : 'notices');
  };

  const setupCard = currentView === 'setup'
    ? (state.cards || []).find((card) => card.accountId === setupAccountId)
    : null;

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
      {/* Arrow (only shown when at top, i.e. macOS) */}
      {!arrowOnBottom && !arrowHidden && <div style={arrowStyle} />}

      {/* Panel body */}
      <div
        style={{
          background: C.surface,
          borderRadius: 10,
          overflow: 'hidden',
          height: arrowOnBottom || arrowHidden ? '100%' : `calc(100% - ${ARROW_HEIGHT}px)`,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header — context-aware: title + bell on home, back button + view title on sub-views */}
        <div className="flex items-center gap-2 px-3.5 pt-3 pb-2.5 border-b border-[#292F52]">
          {currentView === 'home' ? (
            <>
              <span className="text-[#E8EAF6] text-[15px] font-semibold tracking-wide font-['Berkeley_Mono',monospace]">
                Hyperclay Local
              </span>
              <button
                onClick={toggleNotices}
                title="Notices"
                aria-label={unreadCount > 0 ? `Notices, ${unreadCount} unread` : 'Notices'}
                className="relative ml-auto border-none rounded-[20px] px-2 py-1 cursor-pointer flex items-center justify-center bg-[#232D3A] hover:bg-[#2D3847]"
              >
                <svg className="w-[14px] h-[14px] text-[#B8BFE5]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
                </svg>
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-1 flex items-center justify-center min-w-4 h-4 px-1 text-[11px] font-bold font-['Berkeley_Mono',monospace] text-white bg-[#8B2020] rounded-[20px]">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={navigateHome}
                title="Back"
                aria-label="Back"
                className="border-none rounded-[20px] px-2 py-1 cursor-pointer flex items-center justify-center bg-[#232D3A] hover:bg-[#2D3847]"
              >
                <svg className="w-[14px] h-[14px] text-[#B8BFE5]" xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M20 11v2H4v-2zM8 13v2H6v-2zm2 2v2H8v-2zm2 2v2h-2v-2zm-4-6V9H6v2z" />
                  <path d="M10 15V7H8v8zm2 2V5h-2v12z" />
                </svg>
              </button>
              <span className="text-[#E8EAF6] text-[15px] font-semibold tracking-wide font-['Berkeley_Mono',monospace]">
                {currentView === 'notices' ? 'Notices'
                  : currentView === 'activity' ? 'Activity'
                    : currentView === 'setup' ? `Set up ${(setupCard && setupCard.title) || 'team'}`
                      : 'Connect'}
              </span>
              <div className="ml-auto flex gap-1">
                {currentView === 'notices' && (
                  <>
                    <BevelButton label="mark read" onClick={markAllRead} variant="neutral" tiny />
                    <BevelButton label="clear" onClick={clearAllErrors} variant="sync" tiny />
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {/* Update banner */}
        {updateAvailable && currentView === 'home' && (
          <button
            onClick={() => window.electronAPI?.openBrowser('https://hyperclaylocal.com/')}
            className="flex items-center gap-2 w-full px-3.5 py-1.5 bg-[#1B1E2C] border-none border-b border-b-[#292F52] cursor-pointer text-left font-['Berkeley_Mono',monospace]"
            style={{ borderBottom: `1px solid ${C.border}` }}
          >
            <Led on color={C.ledGreen} />
            <span className="text-[12px] text-[#B8BFE5]">Update v{updateVersion} available</span>
            <span className="ml-auto text-[12px] text-[#69AEFE]">→</span>
          </button>
        )}

        {/* View content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {currentView === 'home' && (
            <HomeView
              state={state}
              serverLoading={serverLoading}
              syncLoading={syncLoading}
              onServerFlip={handleServerFlip}
              onSyncFlip={handleSyncFlip}
              onChooseFolder={handleChooseFolder}
              onConnect={() => setCurrentView('credentials')}
              onShowActivity={() => setCurrentView('activity')}
              onAction={handleAction}
            />
          )}

          {currentView === 'notices' && (
            <NoticesView
              errors={errorQueue}
              conflicts={state.conflicts || []}
              cards={state.cards || []}
              onMarkErrorRead={markErrorRead}
              onDismissError={dismissError}
              onResolveConflict={(sessionId, path, choice) => window.electronAPI?.resolveConflict(sessionId, path, choice)}
            />
          )}

          {currentView === 'activity' && (
            <ActivityView
              lines={state.activity || []}
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
              onDone={navigateHome}
              onCancel={navigateHome}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center px-3.5 py-2 border-t border-[#292F52]">
          <FooterButton label="Options" onClick={handleOptions} />
          <span className="flex-1 text-center text-[11px] text-[#454A68]">
            {state.appVersion ? `v${state.appVersion}` : ''}
          </span>
          <FooterButton label="Quit" onClick={handleQuit} />
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// HOME VIEW
// =============================================================================

const HomeView = ({
  state, serverLoading, syncLoading,
  onServerFlip, onSyncFlip, onChooseFolder, onConnect, onShowActivity, onAction,
}) => {
  const cards = state.cards || [];
  const activity = state.activity || [];
  const hasPersonal = cards.some((card) => card.kind === 'personal');
  const hasTeam = cards.some((card) => card.kind !== 'personal');

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <SwitchBar
        serverEnabled={state.serverEnabled}
        syncEnabled={state.syncEnabled}
        hasApiKey={state.hasApiKey}
        sublines={state.sublines}
        serverLoading={serverLoading}
        syncLoading={syncLoading}
        onServerFlip={onServerFlip}
        onSyncFlip={onSyncFlip}
        onConnect={onConnect}
      />

      <GlobalBanner banner={state.banner} onReconnect={onConnect} />

      {!hasPersonal && (
        <FirstRunBay serverLoading={serverLoading} onChooseFolder={onChooseFolder} />
      )}

      <CardList cards={cards} onAction={onAction} />

      <ActivityFeed
        lines={activity}
        onShowAll={onShowActivity}
        showSharedNote={hasTeam || !state.hasApiKey}
      />
    </div>
  );
};

// =============================================================================
// SWITCH BAR
// =============================================================================

const SwitchBar = ({
  serverEnabled, syncEnabled, hasApiKey, sublines,
  serverLoading, syncLoading, onServerFlip, onSyncFlip, onConnect,
}) => {
  const lines = sublines || {};
  const serverSub = serverLoading
    ? (serverEnabled ? 'stopping…' : 'starting…')
    : lines.server;
  const syncSub = syncLoading
    ? (syncEnabled ? 'stopping…' : 'enabling…')
    : lines.sync;

  return (
    <div className="flex px-3.5 pt-[9px]">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-[9px]">
          <Led on={serverEnabled} />
          <span className="text-[12px] tracking-[0.14em] text-[#B8BFE5]">SERVER</span>
          <Rocker
            on={serverEnabled}
            disabled={serverLoading}
            onFlip={onServerFlip}
            label={serverEnabled ? 'Turn server off' : 'Turn server on'}
          />
        </div>
        <div className="pl-[30px] pt-[2px] pb-1.5 text-[11.5px] text-[#6B7194] whitespace-nowrap overflow-hidden text-ellipsis">
          {serverSub}
        </div>
      </div>

      <div className="flex-1 min-w-0 pl-3">
        <div className="flex items-center gap-[9px]">
          <Led on={hasApiKey && syncEnabled} />
          <span className="text-[12px] tracking-[0.14em] text-[#B8BFE5]">SYNC</span>
          {hasApiKey ? (
            <Rocker
              on={syncEnabled}
              disabled={syncLoading}
              onFlip={onSyncFlip}
              label={syncEnabled ? 'Turn sync off' : 'Turn sync on'}
            />
          ) : (
            <button
              onClick={onConnect}
              className="ml-auto bg-transparent border-none p-0 text-[12px] cursor-pointer text-[#69AEFE] font-['Berkeley_Mono',monospace] hover:underline"
            >
              Connect →
            </button>
          )}
        </div>
        <div className="pl-[30px] pt-[2px] pb-1.5 text-[11.5px] text-[#6B7194] whitespace-nowrap overflow-hidden text-ellipsis">
          {syncSub}
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// GLOBAL BANNER
// =============================================================================

const GlobalBanner = ({ banner, onReconnect }) => {
  if (banner === 'reconnect') {
    return (
      <button
        onClick={onReconnect}
        className="flex items-start gap-2 mx-3 mt-1.5 px-2.5 py-2 border-none cursor-pointer text-left font-['Berkeley_Mono',monospace]"
        style={{ background: '#2A1518', borderLeft: `3px solid ${C.faultFill}` }}
      >
        <Led on color={C.fault} glow="rgba(247,61,72,0.55)" />
        <span className="flex-1 min-w-0 text-[11.5px] leading-[1.4] text-[#E8C7CA]">
          Sync key no longer works.
        </span>
        <span className="text-[11px] text-[#F73D48] whitespace-nowrap">Reconnect →</span>
      </button>
    );
  }

  if (banner === 'server-update') {
    return (
      <div
        className="flex items-start gap-2 mx-3 mt-1.5 px-2.5 py-2"
        style={{ background: '#2A2415', borderLeft: `3px solid ${C.amber}` }}
      >
        <Led on color={C.amber} glow="rgba(227,169,60,0.5)" />
        <span className="flex-1 min-w-0 text-[11.5px] leading-[1.4] text-[#E4D3AE]">
          hyperclay.com needs an update before sync can run. Folders are still served.
        </span>
      </div>
    );
  }

  return null;
};

// =============================================================================
// CARD LIST AND CARD
// =============================================================================

const CardList = ({ cards, onAction }) => (
  <div className="overflow-y-auto pt-1.5" style={{ maxHeight: 236 }}>
    {cards.map((card) => (
      <FolderCard
        key={card.rootId || `account-${card.accountId}`}
        card={card}
        onAction={onAction}
      />
    ))}
  </div>
);

const FolderCard = ({ card, onAction }) => {
  const led = LED_BY_STATE[card.state] || { on: false };
  const dimmed = card.state === 'viewer';
  const detail = card.state === 'synced' && card.lastSyncAt
    ? `synced ${formatRelativeTime(card.lastSyncAt)}`
    : card.detail;
  const inline = card.actions.find((a) => a === 'setup' || a === 'web') || null;
  return (
    <div
      className="mx-3 mb-1.5 px-2.5 py-[7px]"
      style={{ background: C.well, opacity: dimmed ? 0.55 : 1, ...bevelIn() }}
      title={card.detailLong || undefined}
      data-card-state={card.state}
    >
      <div className="flex items-center gap-2 min-w-0">
        <Led on={led.on} color={led.color} glow={led.glow} />
        <span className="text-[13px] font-medium text-[#E8EAF6] whitespace-nowrap overflow-hidden text-ellipsis">
          {card.title}
        </span>
        <span className="ml-auto flex items-center gap-1.5 shrink-0">
          {inline === 'setup' && (
            <button onClick={() => onAction('setup', card)} className={`${linkClass} text-[#69AEFE]`}>Set up →</button>
          )}
          {inline === 'web' && (
            <button onClick={() => onAction('web', card)} className={`${linkClass} text-[#69AEFE]`}>hyperclay.com ↗</button>
          )}
          {!inline && card.state === 'port-taken' && (
            <span className="text-[11.5px] text-[#F73D48]">port {card.port} is in use</span>
          )}
          {!inline && card.state !== 'port-taken' && card.url && (
            <>
              <button onClick={() => onAction('open', card)} className={`${linkClass} text-[#69AEFE]`}>
                {card.url.replace('http://', '')}
              </button>
              <button
                onClick={() => onAction('copy', card)}
                title="Copy URL"
                aria-label={`Copy URL for ${card.title}`}
                className="bg-transparent border-none p-0 cursor-pointer text-[11px] text-[#6B7194] hover:text-[#B8BFE5]"
              >
                ⧉
              </button>
            </>
          )}
          {!inline && card.state !== 'port-taken' && !card.url && card.port && (
            <span className="text-[11.5px] text-[#6B7194]">starts at :{card.port}</span>
          )}
        </span>
      </div>
      <div className="mt-[2px] pl-[15px] text-[11px] text-[#6B7194] whitespace-nowrap overflow-hidden text-ellipsis">
        {card.subtitle}{detail ? ` · ${detail}` : ''}
        {(card.state === 'conflict' || card.state === 'error') && (
          <button onClick={() => onAction('notices', card)} className={`${linkClass} ml-1.5 text-[#F73D48]`}>see notices</button>
        )}
      </div>
      {card.folder && (
        <div className="flex items-center gap-2 mt-[2px] pl-[15px] text-[11px] text-[#6B7194]">
          <button
            onClick={() => onAction('reveal', card)}
            title="Reveal folder"
            className={`${linkClass} text-[11px] text-[#6B7194] whitespace-nowrap overflow-hidden text-ellipsis`}
          >
            {card.folder}
          </button>
          <span className="ml-auto flex items-center gap-2.5 shrink-0">
            {card.actions.includes('retry') && (
              <button onClick={() => onAction('retry', card)} className={`${linkClass} text-[#B8BFE5]`}>Retry</button>
            )}
            {card.actions.includes('change-port') && card.nextPort && (
              <button onClick={() => onAction('change-port', card)} className={`${linkClass} text-[#B8BFE5]`}>Use port {card.nextPort}…</button>
            )}
            {card.state === 'paused' && card.actions.includes('disconnect') && (
              <button onClick={() => onAction('disconnect', card)} className={`${linkClass} text-[#B8BFE5]`}>Disconnect…</button>
            )}
            <button
              onClick={() => onAction('more', card)}
              title="More"
              aria-label={`More actions for ${card.title}`}
              className="bg-transparent border-none px-1 cursor-pointer text-[13px] leading-none text-[#6B7194] hover:text-[#B8BFE5]"
            >
              ⋯
            </button>
          </span>
        </div>
      )}
    </div>
  );
};

// =============================================================================
// ACTIVITY
// =============================================================================

const ActivityFeed = ({ lines, onShowAll, showSharedNote }) => (
  <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
    <div className="flex items-center gap-2 mx-3.5 mt-2 mb-0.5">
      <span className="text-[10px] tracking-[0.22em] text-[#6B7194]">ACTIVITY</span>
      <span className="flex-1 h-px bg-[#292F52]" />
      {lines.length > 0 && (
        <button
          onClick={onShowAll}
          className="bg-transparent border-none p-0 cursor-pointer text-[11px] text-[#6B7194] font-['Berkeley_Mono',monospace] hover:text-[#B8BFE5]"
        >
          all →
        </button>
      )}
    </div>
    <div className="flex-1 overflow-hidden px-3.5" style={{ minHeight: 48 }}>
      {lines.length === 0 ? (
        <div className="pt-3 text-[11.5px] text-[#454A68]">
          watching for changes
        </div>
      ) : (
        lines.slice(0, 5).map((line, i) => (
          <ActivityRow key={line.path + '-' + i} line={line} />
        ))
      )}
    </div>
    {showSharedNote && (
      <button
        onClick={() => window.electronAPI?.openBrowser('https://hyperclay.com/dashboard')}
        className="mx-3.5 mb-2 mt-1 bg-transparent border-none p-0 cursor-pointer text-left text-[10.5px] text-[#454A68] font-['Berkeley_Mono',monospace] hover:text-[#B8BFE5]"
      >
        Shared documents and links are on the website
      </button>
    )}
  </div>
);

const ActivityRow = ({ line }) => {
  const verb = VERB_GLYPHS[line.verb] || { glyph: '·', color: C.muted };
  return (
    <div className="flex items-baseline gap-2 py-[4px] border-b border-[#1D1F2F] last:border-b-0">
      <span className="shrink-0 w-3 text-[12px]" style={{ color: verb.color }}>
        {verb.glyph}
      </span>
      <span className="text-[12px] text-[#B8BFE5] whitespace-nowrap overflow-hidden text-ellipsis">
        {line.path}
      </span>
      <span className="ml-auto shrink-0 text-[11px] text-[#6B7194] tabular-nums">
        {line.time ? formatShortTime(line.time) : ''}
      </span>
    </div>
  );
};

// =============================================================================
// NOTICES VIEW
// =============================================================================

const NoticesView = ({ errors, conflicts, cards, onMarkErrorRead, onDismissError, onResolveConflict }) => {
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 10000);
    return () => clearInterval(interval);
  }, []);

  const titleForSession = (sessionId) => {
    const card = (cards || []).find((candidate) => candidate.sessionId === sessionId);
    return card ? card.title : null;
  };

  const sortedErrors = [...errors].sort((a, b) => b.timestamp - a.timestamp);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex-1 overflow-y-auto px-3.5 pt-3 pb-2.5">
        {(sortedErrors.length === 0 && (conflicts || []).length === 0) ? (
          <div className="py-10 text-center text-[#6B7194] text-[13px]">
            All quiet
          </div>
        ) : (
          <>
            {(conflicts || []).map((conflict, i) => {
              const label = titleForSession(conflict.sessionId);
              return (
                <div key={`conflict-${conflict.sessionId}-${conflict.path}-${i}`} className="py-2 border-b border-[#1D1F2F]" style={{ borderLeft: `3px solid ${C.amber}`, paddingLeft: 8, marginLeft: -11 }}>
                  <div className="text-[12px] text-[#D1D5E8] break-words leading-[1.4]">
                    {label ? `${label}: ` : ''}{conflict.path} changed here and on hyperclay.com
                  </div>
                  <div className="mt-1 flex gap-2">
                    <button
                      onClick={() => onResolveConflict(conflict.sessionId, conflict.path, 'mine')}
                      className={`${linkClass} text-[#B8BFE5]`}
                    >
                      Keep mine
                    </button>
                    <button
                      onClick={() => onResolveConflict(conflict.sessionId, conflict.path, 'theirs')}
                      className={`${linkClass} text-[#B8BFE5]`}
                    >
                      Keep theirs
                    </button>
                  </div>
                </div>
              );
            })}
            {sortedErrors.map(error => (
              <div
                key={error.id}
                className="flex gap-2 items-start py-2 border-b border-[#1D1F2F]"
                style={error.priority === 1 ? { borderLeft: `3px solid ${C.faultFill}`, paddingLeft: 8, marginLeft: -11 } : undefined}
              >
                {!error.read ? (
                  <button
                    onClick={() => onMarkErrorRead(error.id)}
                    title="Mark as read"
                    aria-label="Mark as read"
                    className={`shrink-0 mt-[5px] w-[7px] h-[7px] rounded-full border-none cursor-pointer p-0 ${error.priority === 1 ? 'bg-[#F73D48]' : 'bg-gray-500'}`}
                  />
                ) : (
                  <div className="shrink-0 w-[7px]" />
                )}
                <div className="flex-1 min-w-0 text-[12px] text-[#D1D5E8] break-words leading-[1.4]">
                  {(() => {
                    const label = error.sessionId ? titleForSession(error.sessionId) : null;
                    return label ? `${label}: ${error.error}` : error.error;
                  })()}
                  {error.file && (
                    <div className="mt-0.5 text-[11px] text-[#6B7194]">{error.file}</div>
                  )}
                  {error.dismissable !== false && error.priority !== 1 && (
                    <button
                      onClick={() => onDismissError(error.id)}
                      className="block mt-1 bg-transparent border-none p-0 cursor-pointer text-[11px] text-[#6B7194] underline underline-offset-2 font-['Berkeley_Mono',monospace] hover:text-[#B8BFE5]"
                    >
                      Dismiss
                    </button>
                  )}
                </div>
                <div className="shrink-0 text-[11px] text-gray-500 tabular-nums">
                  {formatRelativeTime(error.timestamp)}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
};

// =============================================================================
// ACTIVITY VIEW
// =============================================================================

const ActivityView = ({ lines }) => {
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex-1 overflow-y-auto px-3.5 pt-3 pb-2.5">
        {lines.length === 0 ? (
          <div className="py-10 text-center text-[#6B7194] text-[13px]">
            Transfers show up here
          </div>
        ) : (
          lines.map((line, i) => (
            <ActivityRow key={line.path + '-' + i} line={line} />
          ))
        )}
      </div>
    </div>
  );
};

// =============================================================================
// TEAM SETUP VIEW
// =============================================================================

const TeamSetupView = ({ accountId, onDone, onCancel }) => {
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
    <div className="flex-1 overflow-y-auto px-3.5 pt-3 pb-2.5">
      <div className="text-[12px] text-[#B8BFE5]">
        {(setup && setup.displayName) || username}{role ? ` · you're an ${role}` : ''}
      </div>

      <div className="mt-3 text-[10px] tracking-[0.22em] text-[#6B7194]">FOLDER</div>
      <div className="mt-1 flex items-center gap-2 px-2.5 py-2" style={{ background: C.well, ...bevelIn() }}>
        <span className={`text-[12px] whitespace-nowrap overflow-hidden text-ellipsis ${folder ? 'text-[#E8EAF6]' : 'text-[#454A68]'}`}>
          {folder || ''}
        </span>
        <span className="ml-auto shrink-0 text-[11px] text-[#6B7194]">
          {setup && setup.folderIsNew ? '(new)' : ''}
        </span>
      </div>
      {folderError && (
        <div className="mt-1 text-[11.5px] text-[#F73D48]">{folderError}</div>
      )}
      {alternative && (
        <button
          onClick={() => { setFolder(alternative); setFolderError(null); setAlternative(null); }}
          className={`${linkClass} mt-1 text-[#69AEFE] block`}
        >
          Use {alternative} instead
        </button>
      )}
      <button
        onClick={handleChooseFolder}
        className={`${linkClass} mt-1.5 text-[#69AEFE] block`}
      >
        Choose another folder…
      </button>

      <div className="mt-3.5 flex items-center gap-3">
        <span className="text-[10px] tracking-[0.22em] text-[#6B7194]">ADDRESS</span>
        {setup && (
          <span className="text-[12px] text-[#B8BFE5]">localhost:{setup.port}</span>
        )}
      </div>

      <div className="mt-3.5 text-[11.5px] leading-[1.5] text-[#6B7194]">
        Pages in this folder come from {username}'s editors. They run in your browser at this address, like your own apps do.
      </div>

      <label className="mt-3.5 flex items-center gap-2 cursor-pointer text-[11.5px] text-[#B8BFE5]">
        <input
          type="checkbox"
          checked={trusted}
          onChange={(e) => setTrusted(e.target.checked)}
          className="w-3.5 h-3.5 cursor-pointer accent-[#1E8136]"
        />
        I trust {username}'s editors
      </label>

      {error && (
        <div className="mt-2 text-[12px] text-[#FE5F58] text-center">{error}</div>
      )}

      <div className="mt-3 flex items-center justify-end gap-2">
        <BevelButton label="Cancel" onClick={onCancel} variant="neutral" small />
        <BevelButton
          label="Set up & sync"
          onClick={handleSetup}
          variant="success"
          small
          disabled={!trusted || !folder || saving}
        />
      </div>

      <div className="mt-2 text-[11px] text-[#6B7194]">
        {!setup
          ? 'Counting files…'
          : (files == null ? '' : `${files} ${files === 1 ? 'file' : 'files'}${size ? `, ${size}` : ''} will download.`)}
      </div>
    </div>
  );
};

// =============================================================================
// FIRST-RUN BAY
// =============================================================================

const FirstRunBay = ({ serverLoading, onChooseFolder }) => (
  <>
    <div
      className="mx-3 mt-3 mb-2.5 px-3 pt-4 pb-3.5 text-center"
      style={{ background: C.well, border: `2px dashed ${C.border}` }}
    >
      <BevelButton
        label={serverLoading ? 'Starting…' : 'Choose Folder…'}
        onClick={onChooseFolder}
        variant="success"
        disabled={serverLoading}
      />
      <div className="mt-2.5 text-[11.5px] leading-[1.5] text-[#6B7194]">
        Serve your HTML apps locally.<br />Sync them to hyperclay.com.
      </div>
    </div>
    <div className="px-3.5 pb-3 text-center text-[11px] leading-[1.55] text-[#454A68]">
      Any .html file in your folder becomes<br />
      an app you can open, edit, and save,<br />
      right in the browser.
    </div>
  </>
);

// =============================================================================
// CREDENTIALS VIEW
// =============================================================================

const CredentialsView = ({ username, apiKey, error, loading, onUsernameChange, onApiKeyChange, onSubmit, onCancel }) => {
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !loading) onSubmit();
  };

  return (
    <div className="flex-1 px-3.5 pt-3.5 pb-2.5">
      <div className="text-[11.5px] text-[#6B7194] leading-[1.5] mb-3">
        Syncs your folders with hyperclay.com. Teams you're on appear automatically.
      </div>

      <div className="mb-2.5">
        <label className="block mb-[3px] text-[12px] text-[#8A92BB]">Username</label>
        <input
          type="text"
          value={username}
          onChange={(e) => onUsernameChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Your hyperclay.com username"
          className="w-full px-2 py-1.5 text-[13px] font-['Berkeley_Mono',monospace] bg-[#111220] border-2 border-[#4F5A97] text-white outline-none"
        />
      </div>

      <div className="mb-3">
        <label className="block mb-[3px] text-[12px] text-[#8A92BB]">API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => onApiKeyChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="hcsk_..."
          className="w-full px-2 py-1.5 text-[13px] font-['Berkeley_Mono',monospace] bg-[#111220] border-2 border-[#4F5A97] text-white outline-none"
        />
      </div>

      {error && (
        <div className="mb-2 text-[12px] text-[#FE5F58] text-center">
          {error}
        </div>
      )}

      <BevelButton
        label={loading ? 'Connecting...' : 'Connect & Enable Sync'}
        onClick={onSubmit}
        variant="sync"
        disabled={loading}
        style={{ width: '100%' }}
      />

      <div className="mt-2.5 flex justify-between items-center">
        <button
          onClick={onCancel}
          className="bg-transparent border-none text-[#6B7194] text-[12px] cursor-pointer py-0.5 font-['Berkeley_Mono',monospace]"
        >
          Cancel
        </button>
        <button
          onClick={() => window.electronAPI?.openBrowser('https://hyperclay.com/dashboard')}
          className="bg-transparent border-none text-[#69AEFE] text-[12px] cursor-pointer py-0.5 font-['Berkeley_Mono',monospace]"
        >
          Get API key
        </button>
      </div>
    </div>
  );
};

// =============================================================================
// FOOTER BUTTON
// =============================================================================

const FooterButton = ({ label, onClick }) => (
  <button
    className="bg-transparent border-none text-[#6B7194] hover:text-[#B8BFE5] text-[13px] cursor-pointer px-1 py-0.5 font-['Berkeley_Mono',monospace]"
    onClick={onClick}
  >
    {label}
  </button>
);

// =============================================================================
// HELPERS
// =============================================================================

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

function subfolderPath(folder, name) {
  return `${String(folder).replace(/[\\/]+$/, '')}/${name}`;
}

export default PopoverApp;
