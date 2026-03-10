import React, { useState, useEffect, useRef } from 'react';

const ARROW_HEIGHT = 10;
const ARROW_HALF_WIDTH = 8;

const StatusDot = ({ active }) => (
  <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${active ? 'bg-[#28C83E]' : 'bg-[#F73D48]'}`} />
);

const BevelButton = ({ label, onClick, variant, disabled, small, style: extraStyle }) => {
  const [hover, setHover] = useState(false);
  const [active, setActive] = useState(false);

  const colors = {
    success: { bg: '#1E8136', hover: '#23973F', tl: '#56B96C', br: '#15311C' },
    danger: { bg: '#7B2525', hover: '#9F3030', tl: '#B45454', br: '#371111' },
    sync: { bg: '#1D498E', hover: '#2156A8', tl: '#4F7CC4', br: '#0F2447' },
    neutral: { bg: '#1D1F2F', hover: '#232639', tl: '#474C65', br: '#131725' },
  };

  const c = colors[variant] || colors.neutral;
  const bw = 2;
  const fontSize = small ? 15 : 16;
  const padding = small ? '4px 10px 5px' : '5px 12px 7px';

  const borderTop = active ? c.br : c.tl;
  const borderRight = active ? c.tl : c.br;
  const borderBottom = active ? c.tl : c.br;
  const borderLeft = active ? c.br : c.tl;

  return (
    <button
      style={{
        width: '100%',
        padding,
        fontSize,
        fontFamily: '"Fixedsys", monospace',
        border: `${bw}px solid`,
        borderTopColor: borderTop,
        borderRightColor: borderRight,
        borderBottomColor: borderBottom,
        borderLeftColor: borderLeft,
        borderRadius: 0,
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: '#fff',
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

const PopoverApp = () => {
  const [arrowX, setArrowX] = useState(null);
  const [arrowPosition, setArrowPosition] = useState('top');
  const [hasStoredApiKey, setHasStoredApiKey] = useState(false);
  const [currentView, setCurrentView] = useState('home');
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateVersion, setUpdateVersion] = useState(null);

  const [state, setState] = useState({
    selectedFolder: null,
    serverRunning: false,
    serverPort: 4321,
    syncEnabled: false,
    syncStatus: { isRunning: false, username: null, stats: { lastSync: null } },
  });

  // Error queue
  const [errorQueue, setErrorQueue] = useState([]);
  const errorIdCounter = useRef(0);
  const unreadCount = errorQueue.filter(e => !e.read).length;

  // Transfers
  const [recentUploads, setRecentUploads] = useState([]);
  const [recentDownloads, setRecentDownloads] = useState([]);
  const [unseenTransfers, setUnseenTransfers] = useState(0);
  const currentViewRef = useRef(currentView);
  currentViewRef.current = currentView;

  // Credentials form
  const [credUsername, setCredUsername] = useState('');
  const [credApiKey, setCredApiKey] = useState('');
  const [credError, setCredError] = useState('');
  const [credLoading, setCredLoading] = useState(false);

  // Button loading states
  const [serverLoading, setServerLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);

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

  const markAllRead = () => {
    setErrorQueue(prev => prev.map(e => ({ ...e, read: true })));
  };

  const clearAllErrors = () => {
    setErrorQueue([]);
  };

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
      if (currentViewRef.current !== 'transfers') {
        setUnseenTransfers(prev => prev + 1);
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

  const lastSyncText = lastSync ? formatRelativeTime(lastSync) : null;

  // Smart Start Server
  const handleStartServer = async () => {
    if (!state.selectedFolder) {
      const result = await window.electronAPI?.selectFolder();
      if (!result?.success) return;
    }
    setServerLoading(true);
    try {
      await window.electronAPI?.startServer();
    } finally {
      setServerLoading(false);
    }
  };

  const handleStopServer = async () => {
    setServerLoading(true);
    try {
      await window.electronAPI?.stopServer();
    } finally {
      setServerLoading(false);
    }
  };

  // Smart Enable Sync
  const handleToggleSync = async () => {
    if (state.syncEnabled) {
      setSyncLoading(true);
      try {
        await window.electronAPI?.toggleSync(false);
      } finally {
        setSyncLoading(false);
      }
      return;
    }

    // Need folder first
    if (!state.selectedFolder) {
      const result = await window.electronAPI?.selectFolder();
      if (!result?.success) return;
    }

    // Need credentials
    if (!hasStoredApiKey) {
      setCurrentView('credentials');
      return;
    }

    // Has everything — just toggle on
    setSyncLoading(true);
    try {
      const result = await window.electronAPI?.toggleSync(true);
      if (result?.error === 'no-api-key') {
        setHasStoredApiKey(false);
        setCurrentView('credentials');
        return;
      }
    } finally {
      setSyncLoading(false);
    }
  };

  // Credentials form submit
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

  const toggleErrors = () => {
    if (currentView === 'errors') {
      setCurrentView('home');
    } else {
      setCurrentView('errors');
    }
  };

  const toggleTransfers = () => {
    if (currentView === 'transfers') {
      setCurrentView('home');
    } else {
      setCurrentView('transfers');
      setUnseenTransfers(0);
    }
  };

  const clearTransfers = () => {
    setRecentUploads([]);
    setRecentDownloads([]);
    setUnseenTransfers(0);
  };

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
    arrowStyle.borderTop = `${ARROW_HALF_WIDTH}px solid #151722`;
    arrowStyle.filter = 'drop-shadow(0 2px 3px rgba(0,0,0,0.3))';
  } else {
    arrowStyle.top = 2;
    arrowStyle.borderBottom = `${ARROW_HALF_WIDTH}px solid #151722`;
    arrowStyle.filter = 'drop-shadow(0 -2px 3px rgba(0,0,0,0.3))';
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
          background: '#151722',
          borderRadius: 10,
          overflow: 'hidden',
          height: arrowOnBottom ? '100%' : `calc(100% - ${ARROW_HEIGHT}px)`,
          boxShadow: '0 12px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(79,90,151,0.3)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div className="flex items-center px-3.5 pt-3 pb-2.5 border-b border-[#292F52]">
          <button
            onClick={currentView !== 'home' ? navigateHome : undefined}
            className={`bg-transparent border-none text-white text-[16px] font-semibold tracking-wide p-0 font-["Berkeley_Mono",monospace] ${currentView !== 'home' ? 'cursor-pointer' : 'cursor-default'}`}
          >
            Hyperclay Local
          </button>

          {updateAvailable && (
            <button
              onClick={() => window.electronAPI?.openBrowser('https://hyperclay.com/hyperclay-local')}
              title={`Update available: v${updateVersion}`}
              className="ml-2 bg-[#1E8136] border-[1.5px] border-[#56B96C] rounded-full w-5 h-5 flex items-center justify-center cursor-pointer p-0 shrink-0"
            >
              <svg className="w-[11px] h-[11px]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="3" stroke="#fff">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18" />
              </svg>
            </button>
          )}

          <div className="ml-auto flex gap-1">
            <button
              onClick={toggleTransfers}
              title="Transfers"
              className={`relative border-none rounded-[20px] px-2 py-1 cursor-pointer flex items-center justify-center ${currentView === 'transfers' ? 'bg-[#2D3847]' : 'bg-[#232D3A] hover:bg-[#2D3847]'}`}
            >
              <svg className="w-[14px] h-[14px]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 1118 1118">
                <path fill="#fff" d="M544.357 648.648c19.531 19.531 19.531 51.172 0 70.703l-150 150c-9.765 9.765-22.562 14.645-35.354 14.645s-25.588-4.885-35.355-14.651l-150-150c-19.531-19.53-19.531-51.172 0-70.702s51.172-19.531 70.703 0l64.65 64.65V284c0-27.636 22.386-50 50-50s50 22.364 50 50v429.293l64.651-64.65c19.531-19.527 51.172-19.527 70.703.005zm400-250c19.531 19.531 19.531 51.172 0 70.703-9.765 9.765-22.562 14.645-35.354 14.645s-25.588-4.885-35.355-14.651L809.003 404.7v429.293c0 27.636-22.386 50-50 50s-50-22.364-50-50V404.7l-64.651 64.651c-19.531 19.53-51.172 19.53-70.703 0-19.53-19.531-19.53-51.172 0-70.703l150-150c19.531-19.531 51.172-19.531 70.703 0z"/>
              </svg>
              {unseenTransfers > 0 && (
                <span className="absolute -top-0.5 -right-1 flex items-center justify-center min-w-4 h-4 px-1 text-[11px] font-bold font-['Berkeley_Mono',monospace] text-white bg-[#1D498E] rounded-[20px]">
                  {unseenTransfers > 9 ? '9+' : unseenTransfers}
                </span>
              )}
            </button>
            <button
              onClick={toggleErrors}
              title="Notifications"
              className={`relative border-none rounded-[20px] px-2 py-1 cursor-pointer flex items-center justify-center ${currentView === 'errors' ? 'bg-[#2D3847]' : 'bg-[#232D3A] hover:bg-[#2D3847]'}`}
            >
              <svg className="w-[14px] h-[14px] text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
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

        {/* View content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {currentView === 'home' && (
            <HomeView
              state={state}
              lastSyncText={lastSyncText}
              serverLoading={serverLoading}
              syncLoading={syncLoading}
              onStartServer={handleStartServer}
              onStopServer={handleStopServer}
              onToggleSync={handleToggleSync}
              onOpenBrowser={handleOpenBrowser}
              onOpenFolder={handleOpenFolder}
            />
          )}

          {currentView === 'errors' && (
            <ErrorsView
              errors={errorQueue}
              onMarkRead={markAllRead}
              onMarkErrorRead={markErrorRead}
              onClearAll={clearAllErrors}
            />
          )}

          {currentView === 'transfers' && (
            <TransfersView
              uploads={recentUploads}
              downloads={recentDownloads}
              onClear={clearTransfers}
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
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center px-3.5 py-2 border-t border-[#292F52]">
          <FooterButton label="Options" onClick={handleOptions} />
          <FooterButton label="Quit" onClick={handleQuit} />
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// HOME VIEW
// =============================================================================

const HomeView = ({ state, lastSyncText, serverLoading, syncLoading, onStartServer, onStopServer, onToggleSync, onOpenBrowser, onOpenFolder }) => (
  <div className="flex-1 overflow-y-auto px-3.5 py-2.5">
    <div className="flex items-center gap-2 mb-2">
      <StatusDot active={state.serverRunning} />
      <span className="text-[#B8BFE5] text-[13px]">
        Server: {state.serverRunning ? `On (port ${state.serverPort})` : 'Off'}
      </span>
    </div>

    <div className="flex items-center gap-2 mb-1">
      <StatusDot active={state.syncEnabled} />
      <span className="text-[#B8BFE5] text-[13px]">
        Sync: {state.syncEnabled
          ? `Active${state.syncStatus?.username ? ` (${state.syncStatus.username})` : ''}`
          : 'Off'}
      </span>
    </div>

    {lastSyncText && state.syncEnabled && (
      <div className="text-[#6B7194] text-[11px] ml-4 mb-1">
        Last sync: {lastSyncText}
      </div>
    )}

    <div className="border-t border-[#292F52] my-2.5" />

    <div className="flex flex-col gap-[5px]">
      {state.serverRunning ? (
        <BevelButton label="Stop Server" onClick={onStopServer} variant="danger" disabled={serverLoading} />
      ) : (
        <BevelButton label={serverLoading ? 'Starting...' : 'Start Server'} onClick={onStartServer} variant="success" disabled={serverLoading} />
      )}

      {state.syncEnabled ? (
        <BevelButton label={syncLoading ? 'Stopping...' : 'Stop Sync'} onClick={onToggleSync} variant="danger" disabled={syncLoading} />
      ) : (
        <BevelButton label={syncLoading ? 'Enabling...' : 'Enable Sync'} onClick={onToggleSync} variant="sync" disabled={syncLoading} />
      )}

      {state.serverRunning && (
        <BevelButton label="Open in Browser" onClick={onOpenBrowser} variant="neutral" />
      )}

      {state.selectedFolder && (
        <BevelButton label="Open Folder" onClick={onOpenFolder} variant="neutral" />
      )}
    </div>
  </div>
);

// =============================================================================
// ERRORS VIEW
// =============================================================================

const ErrorsView = ({ errors, onMarkRead, onMarkErrorRead, onClearAll }) => {
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 10000);
    return () => clearInterval(interval);
  }, []);

  const sortedErrors = [...errors].sort((a, b) => b.timestamp - a.timestamp);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 pt-2.5 pb-2">
        <span className="text-[15px] font-semibold text-white">Notices</span>
        <div className="ml-auto flex gap-1">
          <BevelButton label="mark read" onClick={onMarkRead} variant="neutral" small />
          <BevelButton label="clear" onClick={onClearAll} variant="danger" small />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3.5 pb-2.5">
        {sortedErrors.length === 0 ? (
          <div className="py-10 text-center text-[#6B7194] text-[13px]">
            No notices
          </div>
        ) : (
          sortedErrors.map(error => (
            <div key={error.id} className="flex gap-2 items-start py-2 border-b border-[#1D1F2F]">
              {!error.read ? (
                <button
                  onClick={() => onMarkErrorRead(error.id)}
                  title="Mark as read"
                  className="shrink-0 mt-[5px] w-[7px] h-[7px] rounded-full bg-gray-500 border-none cursor-pointer p-0"
                />
              ) : (
                <div className="shrink-0 w-[7px]" />
              )}
              <div className="flex-1 min-w-0 text-[12px] text-[#D1D5E8] break-words leading-[1.4]">
                {error.error}
                {error.file && (
                  <div className="mt-0.5 text-[11px] text-[#6B7194]">{error.file}</div>
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
// TRANSFERS VIEW
// =============================================================================

const TransfersTab = ({ active, label, onClick }) => (
  <button
    onClick={onClick}
    className={`cursor-pointer px-3 py-1.5 text-[13px] font-["Berkeley_Mono",monospace] text-white rounded-none -mb-px ${
      active
        ? 'bg-[#151722] border border-[#292F52] border-b-[#151722] z-[1]'
        : 'bg-transparent border border-transparent'
    }`}
  >
    {label}
  </button>
);

const TransfersView = ({ uploads, downloads, onClear }) => {
  const [tab, setTab] = useState('uploads');
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 10000);
    return () => clearInterval(interval);
  }, []);

  const items = tab === 'uploads' ? uploads : downloads;
  const emptyText = tab === 'uploads' ? 'No uploads yet' : 'No downloads yet';

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center pt-2 px-3.5">
        <span className="text-[15px] font-semibold text-white">Transfers</span>
        <div className="ml-auto">
          <BevelButton label="clear" onClick={onClear} variant="danger" small />
        </div>
      </div>

      <div className="flex items-end gap-2 border-b border-[#292F52] pt-2 px-3.5">
        <TransfersTab active={tab === 'uploads'} label="Uploads" onClick={() => setTab('uploads')} />
        <TransfersTab active={tab === 'downloads'} label="Downloads" onClick={() => setTab('downloads')} />
      </div>

      <div className="flex-1 overflow-auto px-3.5 pb-2.5">
        {items.length === 0 ? (
          <div className="py-10 text-center text-[#6B7194] text-[13px]">
            {emptyText}
          </div>
        ) : (
          items.map((item, i) => (
            <div key={item.file + '-' + i} className="flex gap-2 items-center py-[7px] border-b border-[#1D1F2F]">
              <div className="shrink-0 text-[11px] text-gray-500 tabular-nums">
                {formatShortTime(item.timestamp)}
              </div>
              <div className="text-[12px] text-[#D1D5E8] whitespace-nowrap pr-3.5">
                {item.file}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

// =============================================================================
// CREDENTIALS VIEW
// =============================================================================

const CredentialsView = ({ username, apiKey, error, loading, onUsernameChange, onApiKeyChange, onSubmit, onCancel }) => {
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !loading) onSubmit();
  };

  return (
    <div className="flex-1 px-3.5 pt-3.5 pb-2.5">
      <div className="text-sm font-semibold text-white mb-3">
        Connect to Hyperclay
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
  return str.padStart(3, '\u00A0');
}

export default PopoverApp;
