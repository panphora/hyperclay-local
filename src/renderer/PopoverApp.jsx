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
        color: on ? '#F6F7FB' : C.text2,
        background: on ? C.greenFill : '#2A2E45',
        ...(on ? bevelOut(C.greenLt, C.greenDk) : bevelOut(C.bevelLt, C.bevelDk)),
      }}
    >
      {on ? 'ON' : 'OFF'}
    </span>
  </button>
);

const BevelButton = ({ label, onClick, variant, disabled, small, style: extraStyle }) => {
  const [hover, setHover] = useState(false);
  const [active, setActive] = useState(false);

  const colors = {
    success: { bg: C.greenFill, hover: C.greenHover, tl: C.greenLt, br: C.greenDk },
    danger: { bg: C.faultFill, hover: '#9F3030', tl: C.faultLt, br: C.faultDk },
    sync: { bg: C.blueFill, hover: '#2156A8', tl: C.blueLt, br: C.blueDk },
    neutral: { bg: '#1D1F2F', hover: '#232639', tl: C.bevelLt, br: '#131725' },
  };

  const c = colors[variant] || colors.neutral;
  const fontSize = small ? 15 : 16;
  const padding = small ? '4px 10px 5px' : '5px 12px 7px';

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

const STATE_CACHE_KEY = 'hyperclayPopoverStateCache';
const DEFAULT_STATE = {
  selectedFolder: null,
  serverRunning: false,
  serverPort: 4321,
  syncEnabled: false,
  syncStatus: { isRunning: false, username: null, stats: { lastSync: null } },
  appVersion: null,
};

// Paint the popover from last-known state so it stays responsive even when
// the main process is blocked (e.g. first-launch safeStorage Keychain hit).
// Includes hasStoredApiKey/username so a connected account paints as
// paused/synced from cache, not as the not-connected state.
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

const folderName = (p) => {
  if (!p) return '';
  const parts = String(p).split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
};

const PopoverApp = () => {
  const [arrowX, setArrowX] = useState(null);
  const [arrowPosition, setArrowPosition] = useState('top');
  const [hasStoredApiKey, setHasStoredApiKey] = useState(!!CACHED_STATE.cachedHasApiKey);
  const [currentView, setCurrentView] = useState('home');
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateVersion, setUpdateVersion] = useState(null);

  const [state, setState] = useState(CACHED_STATE);

  // Error queue
  const [errorQueue, setErrorQueue] = useState([]);
  const errorIdCounter = useRef(0);
  const unreadCount = errorQueue.filter(e => !e.read).length;

  // Transfers
  const [recentUploads, setRecentUploads] = useState([]);
  const [recentDownloads, setRecentDownloads] = useState([]);

  // Credentials form
  const [credUsername, setCredUsername] = useState(CACHED_STATE.cachedUsername || '');
  const [credApiKey, setCredApiKey] = useState('');
  const [credError, setCredError] = useState('');
  const [credLoading, setCredLoading] = useState(false);

  // Button loading states
  const [serverLoading, setServerLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef(null);
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
      localStorage.setItem(STATE_CACHE_KEY, JSON.stringify({
        ...state,
        cachedHasApiKey: hasStoredApiKey,
        cachedUsername: credUsername,
      }));
    } catch {}
  }, [state, hasStoredApiKey, credUsername]);

  useEffect(() => {
    if (!window.electronAPI) return;

    window.electronAPI.getState().then((s) => {
      setState((prev) => ({ ...prev, ...s, syncEnabled: s.syncStatus?.isRunning }));
      if (s.availableUpdate) {
        setUpdateAvailable(true);
        setUpdateVersion(s.availableUpdate.latestVersion);
      }
    });

    window.electronAPI.getApiKeyInfo().then((info) => {
      if (info && info.hasApiKey) {
        setHasStoredApiKey(true);
        setCredUsername(info.username || '');
      } else {
        setHasStoredApiKey(false);
      }
    });

    window.electronAPI.onArrowX((x) => setArrowX(x));
    window.electronAPI.onArrowPosition((pos) => setArrowPosition(pos));

    window.electronAPI.onStateUpdate((s) => {
      setState((prev) => ({
        ...prev,
        ...s,
        syncEnabled: s.syncStatus?.isRunning ?? s.syncEnabled ?? prev.syncEnabled,
      }));
    });

    window.electronAPI.onSyncStats((stats) => {
      setState((prev) => ({
        ...prev,
        syncStatus: { ...prev.syncStatus, stats },
      }));
    });

    window.electronAPI.onSyncUpdate((data) => {
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
    });

    window.electronAPI.onSyncRetry((data) => {
      addError({
        ...data,
        priority: 3,
        type: 'sync_retry',
        dismissable: true,
        error: `Retrying ${data.file} (attempt ${data.attempt}/${data.maxAttempts})`
      });
    });

    window.electronAPI.onSyncFailed((data) => {
      addError({
        ...data,
        error: `Failed to sync ${data.file} after ${data.attempts} attempts: ${data.error}`
      });
    });

    window.electronAPI.onShowCredentials(() => {
      setCurrentView('credentials');
    });

    window.electronAPI.onFileSynced((data) => {
      const entry = { file: data.file, timestamp: Date.now() };
      if (data.action === 'download') {
        setRecentDownloads(prev => [entry, ...prev.filter(e => e.file !== entry.file)].slice(0, 100));
      } else if (data.action === 'upload') {
        setRecentUploads(prev => [entry, ...prev.filter(e => e.file !== entry.file)].slice(0, 100));
      }
    });

    window.electronAPI.onUpdateAvailable((data) => {
      setUpdateAvailable(true);
      setUpdateVersion(data.latestVersion);
    });

    return () => {
      const channels = [
        'update-state', 'sync-update', 'sync-stats', 'file-synced',
        'sync-retry', 'sync-failed', 'popover-arrow-x', 'popover-arrow-position',
        'show-credentials', 'update-available'
      ];
      channels.forEach(ch => window.electronAPI.removeAllListeners(ch));
    };
  }, []);

  // Auto-refresh relative time
  const lastSync = state.syncStatus?.stats?.lastSync;
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!lastSync) return;
    const id = setInterval(() => setTick(t => t + 1), 10000);
    return () => clearInterval(id);
  }, [lastSync]);

  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  const handleServerFlip = async () => {
    if (serverBusy.current) return;
    serverBusy.current = true;
    setServerLoading(true);
    try {
      if (state.serverRunning) {
        await window.electronAPI?.stopServer();
      } else {
        await window.electronAPI?.startServer();
      }
    } finally {
      serverBusy.current = false;
      setServerLoading(false);
    }
  };

  const handleSyncFlip = async () => {
    if (syncBusy.current) return;

    if (state.syncEnabled) {
      syncBusy.current = true;
      setSyncLoading(true);
      try {
        await window.electronAPI?.toggleSync(false);
      } finally {
        syncBusy.current = false;
        setSyncLoading(false);
      }
      return;
    }

    if (!hasStoredApiKey) {
      setCurrentView('credentials');
      return;
    }

    syncBusy.current = true;
    setSyncLoading(true);
    try {
      const result = await window.electronAPI?.toggleSync(true);
      if (result?.error === 'no-api-key') {
        setHasStoredApiKey(false);
        setCurrentView('credentials');
        return;
      }
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
      await window.electronAPI?.startServer();
    } finally {
      serverBusy.current = false;
      setServerLoading(false);
    }
  };

  // Change: repoint the unit. The server follows the new folder; sync pauses
  // instead of silently continuing on the old folder or starting a full sync
  // of a different folder — re-enabling it is an explicit flip of the rocker.
  const handleChangeFolder = async () => {
    if (serverBusy.current || syncBusy.current) return;
    const result = await window.electronAPI?.selectFolder();
    if (!result?.success) return;
    if (state.syncEnabled) {
      syncBusy.current = true;
      setSyncLoading(true);
      try {
        await window.electronAPI?.toggleSync(false);
      } finally {
        syncBusy.current = false;
        setSyncLoading(false);
      }
    }
    if (state.serverRunning) {
      serverBusy.current = true;
      setServerLoading(true);
      try {
        await window.electronAPI?.stopServer();
        await window.electronAPI?.startServer();
      } finally {
        serverBusy.current = false;
        setServerLoading(false);
      }
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

      setHasStoredApiKey(true);
      setCredUsername(keyResult.username || credUsername.trim());
      setCredApiKey('');

      if (state.selectedFolder) {
        await window.electronAPI?.toggleSync(true);
      }

      setCurrentView('home');
    } catch (err) {
      setCredError('Failed to connect');
    } finally {
      setCredLoading(false);
    }
  };

  const handleCopyUrl = async () => {
    const url = `http://localhost:${state.serverPort || 4321}`;
    await window.electronAPI?.copyText(url);
    setCopied(true);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1400);
  };

  const handleOpenBrowser = () => {
    window.electronAPI?.openBrowser();
  };

  const handleOpenFolder = () => {
    window.electronAPI?.openFolder();
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

  const clearActivity = () => {
    setRecentUploads([]);
    setRecentDownloads([]);
  };

  const activity = [
    ...recentUploads.map(e => ({ ...e, dir: 'up' })),
    ...recentDownloads.map(e => ({ ...e, dir: 'down' })),
  ].sort((a, b) => b.timestamp - a.timestamp);

  const criticalNotice = errorQueue
    .filter(e => !e.read && e.priority === 1)
    .sort((a, b) => b.timestamp - a.timestamp)[0] || null;

  const syncUsername = state.syncStatus?.username || credUsername || null;

  const arrowOnBottom = arrowPosition === 'bottom';

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
      padding: arrowOnBottom ? 0 : `${ARROW_HEIGHT}px 0 0 0`,
      width: '100%',
      height: '100%',
      position: 'relative',
    }}>
      {/* Arrow (only shown when at top, i.e. macOS) */}
      {!arrowOnBottom && <div style={arrowStyle} />}

      {/* Panel body */}
      <div
        style={{
          background: C.surface,
          borderRadius: 10,
          overflow: 'hidden',
          height: arrowOnBottom ? '100%' : `calc(100% - ${ARROW_HEIGHT}px)`,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div className="flex items-center px-3.5 pt-3 pb-2.5 border-b border-[#292F52]">
          <button
            onClick={currentView !== 'home' ? navigateHome : undefined}
            className={`bg-transparent border-none text-[#E8EAF6] text-[15px] font-semibold tracking-wide p-0 font-["Berkeley_Mono",monospace] ${currentView !== 'home' ? 'cursor-pointer' : 'cursor-default'}`}
          >
            Hyperclay Local
          </button>

          <div className="ml-auto flex gap-1">
            <button
              onClick={toggleNotices}
              title="Notices"
              aria-label={unreadCount > 0 ? `Notices, ${unreadCount} unread` : 'Notices'}
              className={`relative border-none rounded-[20px] px-2 py-1 cursor-pointer flex items-center justify-center ${currentView === 'notices' ? 'bg-[#2D3847]' : 'bg-[#232D3A] hover:bg-[#2D3847]'}`}
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
          </div>
        </div>

        {/* Update banner */}
        {updateAvailable && currentView === 'home' && (
          <button
            onClick={() => window.electronAPI?.openBrowser('https://hyperclay.com/hyperclay-local')}
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
              hasStoredApiKey={hasStoredApiKey}
              syncUsername={syncUsername}
              lastSync={lastSync}
              serverLoading={serverLoading}
              syncLoading={syncLoading}
              copied={copied}
              activity={activity}
              criticalNotice={criticalNotice}
              onServerFlip={handleServerFlip}
              onSyncFlip={handleSyncFlip}
              onChooseFolder={handleChooseFolder}
              onChangeFolder={handleChangeFolder}
              onOpenFolder={handleOpenFolder}
              onOpenBrowser={handleOpenBrowser}
              onCopyUrl={handleCopyUrl}
              onConnect={() => setCurrentView('credentials')}
              onShowActivity={() => setCurrentView('activity')}
              onShowNotices={() => setCurrentView('notices')}
            />
          )}

          {currentView === 'notices' && (
            <NoticesView
              errors={errorQueue}
              onMarkRead={markAllRead}
              onMarkErrorRead={markErrorRead}
              onDismissError={dismissError}
              onClearAll={clearAllErrors}
            />
          )}

          {currentView === 'activity' && (
            <ActivityView
              activity={activity}
              onClear={clearActivity}
            />
          )}

          {currentView === 'credentials' && (
            <CredentialsView
              username={credUsername}
              apiKey={credApiKey}
              error={credError}
              loading={credLoading}
              folderLabel={folderName(state.selectedFolder)}
              onUsernameChange={setCredUsername}
              onApiKeyChange={setCredApiKey}
              onSubmit={handleCredentialsSubmit}
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
  state, hasStoredApiKey, syncUsername, lastSync, serverLoading, syncLoading,
  copied, activity, criticalNotice,
  onServerFlip, onSyncFlip, onChooseFolder, onChangeFolder, onOpenFolder,
  onOpenBrowser, onCopyUrl, onConnect, onShowActivity, onShowNotices,
}) => {
  const hasFolder = !!state.selectedFolder;
  const port = state.serverPort || 4321;

  const serverSub = serverLoading
    ? (state.serverRunning ? 'stopping…' : 'starting…')
    : state.serverRunning
      ? (
        <>
          <button
            onClick={onOpenBrowser}
            className="bg-transparent border-none p-0 cursor-pointer text-[#69AEFE] text-[11.5px] font-['Berkeley_Mono',monospace] hover:underline"
          >
            localhost:{port}
          </button>
          <button
            onClick={onCopyUrl}
            title="Copy URL"
            aria-label="Copy URL"
            className="bg-transparent border-none p-0 cursor-pointer text-[11px] text-[#6B7194] font-['Berkeley_Mono',monospace] hover:text-[#B8BFE5]"
          >
            {copied ? 'copied' : '⧉'}
          </button>
        </>
      )
      : `starts at localhost:${port}`;

  const syncSub = syncLoading
    ? (state.syncEnabled ? 'stopping…' : 'enabling…')
    : !hasStoredApiKey
      ? 'connects to your hyperclay.com account'
      : state.syncEnabled
        ? `@${syncUsername || '…'} · ${lastSync ? `synced ${formatRelativeTime(lastSync)}` : 'active'}`
        : `@${syncUsername || '…'} · paused`;

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* Folder bay */}
      {hasFolder ? (
        <div
          onClick={onOpenFolder}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onOpenFolder();
            }
          }}
          role="button"
          tabIndex={0}
          aria-label={`Open folder ${folderName(state.selectedFolder)}`}
          title="Open folder"
          className="mx-3 mt-3 mb-2.5 px-2.5 py-2 cursor-pointer group"
          style={{ background: C.well, ...bevelIn() }}
        >
          <div className="flex items-center gap-2">
            <span className="relative shrink-0" style={{ width: 16, height: 12, background: C.greenFill, border: `1px solid ${C.greenLt}` }}>
              <span className="absolute" style={{ top: -4, left: -1, width: 7, height: 3, background: C.greenFill, borderLeft: `1px solid ${C.greenLt}`, borderTop: `1px solid ${C.greenLt}`, borderRight: `1px solid ${C.greenLt}` }} />
            </span>
            <span className="text-[13px] font-medium text-[#E8EAF6] whitespace-nowrap overflow-hidden text-ellipsis group-hover:text-[#F6F7FB]">
              {folderName(state.selectedFolder)}
            </span>
          </div>
          <div className="flex mt-[3px] pl-6 text-[11px] text-[#6B7194]">
            <span>mounted · open folder</span>
            <button
              onClick={(e) => { e.stopPropagation(); onChangeFolder(); }}
              className="ml-auto bg-transparent border-none p-0 cursor-pointer text-[11px] text-[#6B7194] underline underline-offset-2 font-['Berkeley_Mono',monospace] hover:text-[#B8BFE5]"
            >
              change
            </button>
          </div>
        </div>
      ) : (
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
      )}

      {/* Server row */}
      <div className="flex items-center gap-[9px] px-3.5 pt-[7px]">
        <Led on={state.serverRunning} />
        <span className={`text-[12px] tracking-[0.14em] ${hasFolder ? 'text-[#B8BFE5]' : 'text-[#4A4F6E]'}`}>SERVER</span>
        <Rocker
          on={state.serverRunning}
          disabled={!hasFolder || serverLoading}
          onFlip={onServerFlip}
          label={state.serverRunning ? 'Turn server off' : 'Turn server on'}
        />
      </div>
      <div className={`flex items-center gap-1.5 pl-[30px] pr-3.5 pt-[2px] pb-1.5 text-[11.5px] ${hasFolder ? 'text-[#6B7194]' : 'text-[#4A4F6E]'}`}>
        {serverSub}
      </div>

      {/* Sync row */}
      <div className="flex items-center gap-[9px] px-3.5 pt-[7px]">
        <Led on={state.syncEnabled} />
        <span className={`text-[12px] tracking-[0.14em] ${hasFolder ? 'text-[#B8BFE5]' : 'text-[#4A4F6E]'}`}>SYNC</span>
        {hasStoredApiKey ? (
          <Rocker
            on={state.syncEnabled}
            disabled={!hasFolder || syncLoading}
            onFlip={onSyncFlip}
            label={state.syncEnabled ? 'Turn sync off' : 'Turn sync on'}
          />
        ) : (
          <button
            onClick={onConnect}
            disabled={!hasFolder}
            className={`ml-auto bg-transparent border-none p-0 text-[12px] font-['Berkeley_Mono',monospace] ${hasFolder ? 'cursor-pointer text-[#69AEFE] hover:underline' : 'cursor-default text-[#4A4F6E]'}`}
          >
            Connect →
          </button>
        )}
      </div>
      <div className={`pl-[30px] pr-3.5 pt-[2px] pb-1.5 text-[11.5px] ${hasFolder ? 'text-[#6B7194]' : 'text-[#4A4F6E]'}`}>
        {syncSub}
      </div>

      {/* Critical notice banner */}
      {criticalNotice && (
        <button
          onClick={onShowNotices}
          className="flex items-start gap-2 mx-3 mt-1.5 px-2.5 py-2 border-none cursor-pointer text-left font-['Berkeley_Mono',monospace]"
          style={{ background: '#2A1518', borderLeft: `3px solid ${C.faultFill}` }}
        >
          <Led on color={C.fault} glow="rgba(247,61,72,0.55)" />
          <span className="flex-1 min-w-0 text-[11.5px] leading-[1.4] text-[#E8C7CA] overflow-hidden" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {criticalNotice.error}
          </span>
          <span className="text-[11px] text-[#F73D48] whitespace-nowrap">Details →</span>
        </button>
      )}

      {/* Activity — only when sync is on or there is history to show. It is
          fed solely by sync transfers, so server-only users never see it. */}
      {hasFolder && (state.syncEnabled || activity.length > 0) && (
        <>
          <div className="flex items-center gap-2 mx-3.5 mt-2 mb-0.5">
            <span className="text-[10px] tracking-[0.22em] text-[#6B7194]">ACTIVITY</span>
            <span className="flex-1 h-px bg-[#292F52]" />
            {activity.length > 0 && (
              <button
                onClick={onShowActivity}
                className="bg-transparent border-none p-0 cursor-pointer text-[11px] text-[#6B7194] font-['Berkeley_Mono',monospace] hover:text-[#B8BFE5]"
              >
                all →
              </button>
            )}
          </div>
          <div className="flex-1 overflow-hidden px-3.5">
            {activity.length === 0 ? (
              <div className="pt-3 text-[11.5px] text-[#454A68]">
                watching for changes
              </div>
            ) : (
              activity.slice(0, 5).map((item, i) => (
                <ActivityRow key={item.dir + item.file + '-' + i} item={item} />
              ))
            )}
          </div>
        </>
      )}

      {/* First-run tip */}
      {!hasFolder && (
        <div className="flex-1 flex items-end justify-center px-3.5 pb-3">
          <div className="text-[11px] leading-[1.55] text-[#454A68] text-center">
            Any .html file in your folder becomes<br />
            an app you can open, edit, and save,<br />
            right in the browser.
          </div>
        </div>
      )}
    </div>
  );
};

const ActivityRow = ({ item }) => (
  <div className="flex items-baseline gap-2 py-[4px] border-b border-[#1D1F2F] last:border-b-0">
    <span className={`shrink-0 w-3 text-[12px] ${item.dir === 'up' ? 'text-[#28C83E]' : 'text-[#69AEFE]'}`}>
      {item.dir === 'up' ? '↑' : '↓'}
    </span>
    <span className="text-[12px] text-[#B8BFE5] whitespace-nowrap overflow-hidden text-ellipsis">
      {item.file}
    </span>
    <span className="ml-auto shrink-0 text-[11px] text-[#6B7194] tabular-nums">
      {formatShortTime(item.timestamp)}
    </span>
  </div>
);

// =============================================================================
// NOTICES VIEW
// =============================================================================

const NoticesView = ({ errors, onMarkRead, onMarkErrorRead, onDismissError, onClearAll }) => {
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 10000);
    return () => clearInterval(interval);
  }, []);

  const sortedErrors = [...errors].sort((a, b) => b.timestamp - a.timestamp);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 pt-2.5 pb-2">
        <span className="text-[15px] font-semibold text-[#E8EAF6]">Notices</span>
        <div className="ml-auto flex gap-1">
          <BevelButton label="mark read" onClick={onMarkRead} variant="neutral" small />
          <BevelButton label="clear" onClick={onClearAll} variant="danger" small />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3.5 pb-2.5">
        {sortedErrors.length === 0 ? (
          <div className="py-10 text-center text-[#6B7194] text-[13px]">
            All quiet
          </div>
        ) : (
          sortedErrors.map(error => (
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
                {error.error}
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
          ))
        )}
      </div>
    </div>
  );
};

// =============================================================================
// ACTIVITY VIEW
// =============================================================================

const ActivityView = ({ activity, onClear }) => {
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center px-3.5 pt-2.5 pb-2">
        <span className="text-[15px] font-semibold text-[#E8EAF6]">Activity</span>
        <div className="ml-auto">
          <BevelButton label="clear" onClick={onClear} variant="danger" small />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3.5 pb-2.5">
        {activity.length === 0 ? (
          <div className="py-10 text-center text-[#6B7194] text-[13px]">
            Transfers show up here
          </div>
        ) : (
          activity.map((item, i) => (
            <ActivityRow key={item.dir + item.file + '-' + i} item={item} />
          ))
        )}
      </div>
    </div>
  );
};

// =============================================================================
// CREDENTIALS VIEW
// =============================================================================

const CredentialsView = ({ username, apiKey, error, loading, folderLabel, onUsernameChange, onApiKeyChange, onSubmit, onCancel }) => {
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !loading) onSubmit();
  };

  return (
    <div className="flex-1 px-3.5 pt-3.5 pb-2.5">
      <div className="text-sm font-semibold text-[#E8EAF6] mb-1">
        Connect to Hyperclay
      </div>
      <div className="text-[11.5px] text-[#6B7194] leading-[1.5] mb-3">
        Two-way syncs {folderLabel ? `"${folderLabel}"` : 'your folder'} with your hyperclay.com account.
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
  return str.padStart(3, ' ');
}

export default PopoverApp;
