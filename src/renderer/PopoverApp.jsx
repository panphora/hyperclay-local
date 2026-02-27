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

const PopoverApp = () => {
  const [arrowX, setArrowX] = useState(null);
  const [hasStoredApiKey, setHasStoredApiKey] = useState(false);
  const [state, setState] = useState({
    selectedFolder: null,
    serverRunning: false,
    serverPort: 4321,
    syncEnabled: false,
    syncStatus: { isRunning: false, username: null, stats: { lastSync: null } },
  });

  useEffect(() => {
    if (!window.electronAPI) return;

    window.electronAPI.getState().then((s) => {
      setState((prev) => ({ ...prev, ...s, syncEnabled: s.syncStatus?.isRunning }));
    });

    window.electronAPI.getApiKeyInfo().then((info) => {
      if (info && info.hasApiKey) setHasStoredApiKey(true);
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
  }, []);

  const handleStartServer = async () => {
    await window.electronAPI?.startServer();
  };

  const handleStopServer = async () => {
    await window.electronAPI?.stopServer();
  };

  const handleOpenBrowser = () => {
    window.electronAPI?.openBrowser();
  };

  const handleOpenFolder = () => {
    window.electronAPI?.openFolder();
  };

  const handleToggleSync = async () => {
    if (state.syncEnabled) {
      await window.electronAPI?.toggleSync(false);
    } else if (hasStoredApiKey) {
      await window.electronAPI?.toggleSync(true);
    } else {
      window.electronAPI?.openSettings('sync');
    }
  };

  const handleOpenSettings = () => {
    window.electronAPI?.openSettings();
  };

  const handleQuit = () => {
    window.electronAPI?.quitApp();
  };

  const lastSync = state.syncStatus?.stats?.lastSync;
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!lastSync) return;
    const id = setInterval(() => setTick(t => t + 1), 10000);
    return () => clearInterval(id);
  }, [lastSync]);
  const lastSyncText = lastSync ? formatRelativeTime(lastSync) : null;

  return (
    <div style={{ padding: `${ARROW_HEIGHT}px 0 0 0`, width: '100%', height: '100%' }}>
      {/* Arrow */}
      <div
        id="popover-arrow"
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
        <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid #292F52' }}>
          <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '0.02em' }}>
            Hyperclay Local
          </div>
        </div>

        {/* Status rows */}
        <div style={{ padding: '12px 16px', flex: 1 }}>
          {/* Server status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <StatusDot active={state.serverRunning} />
            <span style={{ color: '#B8BFE5', fontSize: 14 }}>
              Server: {state.serverRunning ? `On (port ${state.serverPort})` : 'Off'}
            </span>
          </div>

          {/* Sync status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <StatusDot active={state.syncEnabled} />
            <span style={{ color: '#B8BFE5', fontSize: 14 }}>
              Sync: {state.syncEnabled
                ? `Active${state.syncStatus?.username ? ` (${state.syncStatus.username})` : ''}`
                : 'Off'}
            </span>
          </div>

          {lastSyncText && state.syncEnabled && (
            <div style={{ color: '#6B7194', fontSize: 12, marginLeft: 18, marginBottom: 4 }}>
              Last sync: {lastSyncText}
            </div>
          )}

          {/* Divider */}
          <div style={{ borderTop: '1px solid #292F52', margin: '12px 0' }} />

          {/* Quick actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {state.serverRunning ? (
              <ActionButton label="Stop Server" onClick={handleStopServer} variant="danger" />
            ) : (
              <ActionButton label="Start Server" onClick={handleStartServer} variant="success" />
            )}

            {state.syncEnabled ? (
              <ActionButton label="Stop Sync" onClick={handleToggleSync} variant="danger" />
            ) : (
              <ActionButton label="Enable Sync to Platform" onClick={handleToggleSync} variant="sync" />
            )}

            {state.serverRunning && (
              <ActionButton label="Open in Browser" onClick={handleOpenBrowser} />
            )}

            {state.selectedFolder && (
              <ActionButton label="Open Folder" onClick={handleOpenFolder} />
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '10px 16px',
            borderTop: '1px solid #292F52',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <FooterButton label="Settings" onClick={handleOpenSettings} />
          <FooterButton label="Quit" onClick={handleQuit} />
        </div>
      </div>
    </div>
  );
};

const ActionButton = ({ label, onClick, variant }) => {
  const baseStyle = {
    width: '100%',
    padding: '7px 12px 9px',
    fontSize: 15,
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    color: '#fff',
    textAlign: 'center',
  };

  let bg, hoverBg;
  if (variant === 'success') {
    bg = '#1E8136';
    hoverBg = '#23973F';
  } else if (variant === 'sync') {
    bg = '#1D498E';
    hoverBg = '#2156A8';
  } else if (variant === 'danger') {
    bg = '#7B2525';
    hoverBg = '#9F3030';
  } else {
    bg = '#1D2333';
    hoverBg = '#283044';
  }

  const [hover, setHover] = useState(false);

  return (
    <button
      style={{ ...baseStyle, background: hover ? hoverBg : bg }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
    >
      {label}
    </button>
  );
};

const FooterButton = ({ label, onClick }) => {
  const [hover, setHover] = useState(false);

  return (
    <button
      style={{
        background: 'none',
        border: 'none',
        color: hover ? '#B8BFE5' : '#6B7194',
        fontSize: 13,
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
