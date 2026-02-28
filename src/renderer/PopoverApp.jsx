import React, { useState, useEffect, useRef } from 'react';

const ARROW_HEIGHT = 10;
const ARROW_HALF_WIDTH = 8;

const StatusDot = ({ active }) => (
  <span
    style={{
      display: 'inline-block',
      width: 8,
      height: 8,
      borderRadius: '50%',
      backgroundColor: active ? '#28C83E' : '#F73D48',
      flexShrink: 0,
    }}
  />
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

    window.electronAPI.onUpdateAvailable((data) => {
      setUpdateAvailable(true);
      setUpdateVersion(data.latestVersion);
    });

    return () => {
      const channels = [
        'update-state', 'sync-update', 'sync-stats', 'file-synced',
        'sync-retry', 'sync-failed', 'popover-arrow-x',
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

  return (
    <div style={{ padding: `${ARROW_HEIGHT}px 0 0 0`, width: '100%', height: '100%' }}>
      {/* Arrow */}
      <div
        style={{
          position: 'absolute',
          top: 2,
          left: arrowX != null ? arrowX : '50%',
          transform: `translateX(-${ARROW_HALF_WIDTH}px)`,
          width: 0,
          height: 0,
          borderLeft: `${ARROW_HALF_WIDTH}px solid transparent`,
          borderRight: `${ARROW_HALF_WIDTH}px solid transparent`,
          borderBottom: `${ARROW_HALF_WIDTH}px solid #151722`,
          filter: 'drop-shadow(0 -2px 3px rgba(0,0,0,0.3))',
          zIndex: 10,
        }}
      />

      {/* Panel body */}
      <div
        style={{
          background: '#151722',
          borderRadius: 10,
          overflow: 'hidden',
          height: `calc(100% - ${ARROW_HEIGHT}px)`,
          boxShadow: '0 12px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(79,90,151,0.3)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{ padding: '12px 14px 9px', borderBottom: '1px solid #292F52', display: 'flex', alignItems: 'center' }}>
          <button
            onClick={currentView !== 'home' ? navigateHome : undefined}
            style={{
              background: 'none',
              border: 'none',
              color: '#fff',
              fontSize: 16,
              fontWeight: 600,
              letterSpacing: '0.02em',
              cursor: currentView !== 'home' ? 'pointer' : 'default',
              padding: 0,
              fontFamily: '"Berkeley Mono", monospace',
            }}
          >
            Hyperclay Local
          </button>

          {updateAvailable && (
            <button
              onClick={() => window.electronAPI?.openBrowser('https://hyperclay.com/hyperclay-local')}
              title={`Update available: v${updateVersion}`}
              style={{
                marginLeft: 8,
                background: '#1E8136',
                border: '1.5px solid #56B96C',
                borderRadius: '50%',
                width: 20,
                height: 20,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                padding: 0,
                flexShrink: 0,
              }}
            >
              <svg style={{ width: 11, height: 11 }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="3" stroke="#fff">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18" />
              </svg>
            </button>
          )}

          <div style={{ marginLeft: 'auto' }}>
            <button
              onClick={toggleErrors}
              title="Notifications"
              style={{
                position: 'relative',
                background: currentView === 'errors' ? '#232D3A' : '#181F28',
                border: 'none',
                borderRadius: 20,
                padding: '4px 8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg style={{ width: 14, height: 14, color: '#fff' }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
              </svg>
              {unreadCount > 0 && (
                <span style={{
                  position: 'absolute',
                  top: -2,
                  right: -4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: 16,
                  height: 16,
                  padding: '0 4px',
                  fontSize: 11,
                  fontWeight: 700,
                  fontFamily: '"Berkeley Mono", monospace',
                  color: '#fff',
                  background: '#8B2020',
                  borderRadius: 20,
                }}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* View content */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
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
        <div
          style={{
            padding: '8px 14px',
            borderTop: '1px solid #292F52',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
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
  <div style={{ padding: '10px 14px', flex: 1, overflowY: 'auto' }}>
    {/* Server status */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <StatusDot active={state.serverRunning} />
      <span style={{ color: '#B8BFE5', fontSize: 13 }}>
        Server: {state.serverRunning ? `On (port ${state.serverPort})` : 'Off'}
      </span>
    </div>

    {/* Sync status */}
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
      <StatusDot active={state.syncEnabled} />
      <span style={{ color: '#B8BFE5', fontSize: 13 }}>
        Sync: {state.syncEnabled
          ? `Active${state.syncStatus?.username ? ` (${state.syncStatus.username})` : ''}`
          : 'Off'}
      </span>
    </div>

    {lastSyncText && state.syncEnabled && (
      <div style={{ color: '#6B7194', fontSize: 11, marginLeft: 16, marginBottom: 4 }}>
        Last sync: {lastSyncText}
      </div>
    )}

    {/* Divider */}
    <div style={{ borderTop: '1px solid #292F52', margin: '10px 0' }} />

    {/* Action buttons */}
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
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
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      {/* Errors header */}
      <div style={{ padding: '10px 14px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>Notices</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <BevelButton label="mark read" onClick={onMarkRead} variant="neutral" small />
          <BevelButton label="clear" onClick={onClearAll} variant="danger" small />
        </div>
      </div>

      {/* Error list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 14px 10px' }}>
        {sortedErrors.length === 0 ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: '#6B7194', fontSize: 13 }}>
            No notices
          </div>
        ) : (
          sortedErrors.map(error => (
            <div
              key={error.id}
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
                padding: '8px 0',
                borderBottom: '1px solid #1D1F2F',
              }}
            >
              {!error.read ? (
                <button
                  onClick={() => onMarkErrorRead(error.id)}
                  title="Mark as read"
                  style={{
                    flexShrink: 0,
                    marginTop: 5,
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: '#6B7280',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                />
              ) : (
                <div style={{ flexShrink: 0, width: 7 }} />
              )}
              <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: '#D1D5E8', wordBreak: 'break-word', lineHeight: 1.4 }}>
                {error.error}
                {error.file && (
                  <div style={{ marginTop: 2, fontSize: 11, color: '#6B7194' }}>{error.file}</div>
                )}
              </div>
              <div style={{ flexShrink: 0, fontSize: 11, color: '#6B7280', fontVariantNumeric: 'tabular-nums' }}>
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
// CREDENTIALS VIEW
// =============================================================================

const CredentialsView = ({ username, apiKey, error, loading, onUsernameChange, onApiKeyChange, onSubmit, onCancel }) => {
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !loading) onSubmit();
  };

  return (
    <div style={{ padding: '14px 14px 10px', flex: 1 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 12 }}>
        Connect to Hyperclay
      </div>

      <div style={{ marginBottom: 10 }}>
        <label style={{ display: 'block', marginBottom: 3, fontSize: 12, color: '#8A92BB' }}>Username</label>
        <input
          type="text"
          value={username}
          onChange={(e) => onUsernameChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Your hyperclay.com username"
          style={{
            width: '100%',
            padding: '6px 8px',
            fontSize: 13,
            fontFamily: '"Berkeley Mono", monospace',
            background: '#111220',
            border: '2px solid #4F5A97',
            color: '#fff',
            outline: 'none',
          }}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', marginBottom: 3, fontSize: 12, color: '#8A92BB' }}>API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => onApiKeyChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="hcsk_..."
          style={{
            width: '100%',
            padding: '6px 8px',
            fontSize: 13,
            fontFamily: '"Berkeley Mono", monospace',
            background: '#111220',
            border: '2px solid #4F5A97',
            color: '#fff',
            outline: 'none',
          }}
        />
      </div>

      {error && (
        <div style={{ marginBottom: 8, fontSize: 12, color: '#FE5F58', textAlign: 'center' }}>
          {error}
        </div>
      )}

      <BevelButton
        label={loading ? 'Connecting...' : 'Connect & Enable Sync'}
        onClick={onSubmit}
        variant="sync"
        disabled={loading}
      />

      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button
          onClick={onCancel}
          style={{
            background: 'none',
            border: 'none',
            color: '#6B7194',
            fontSize: 12,
            cursor: 'pointer',
            padding: '2px 0',
            fontFamily: '"Berkeley Mono", monospace',
          }}
        >
          Cancel
        </button>
        <button
          onClick={() => window.electronAPI?.openBrowser('https://hyperclay.com/dashboard')}
          style={{
            background: 'none',
            border: 'none',
            color: '#69AEFE',
            fontSize: 12,
            cursor: 'pointer',
            padding: '2px 0',
            fontFamily: '"Berkeley Mono", monospace',
          }}
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

const FooterButton = ({ label, onClick }) => {
  const [hover, setHover] = useState(false);

  return (
    <button
      style={{
        background: 'none',
        border: 'none',
        color: hover ? '#B8BFE5' : '#6B7194',
        fontSize: 12,
        cursor: 'pointer',
        padding: '2px 4px',
        fontFamily: '"Berkeley Mono", monospace',
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
    >
      {label}
    </button>
  );
};

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

export default PopoverApp;
