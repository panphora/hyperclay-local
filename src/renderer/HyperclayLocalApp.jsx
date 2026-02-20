import React, { useState, useEffect, useRef } from 'react';
import ErrorsPage from './components/ErrorsPage';
import Tooltip from './components/Tooltip';

const HyperclayLocalApp = () => {
  const [currentState, setCurrentState] = useState({
    selectedFolder: null,
    serverRunning: false,
    serverPort: 4321,
    syncStatus: {
      isRunning: false,
      syncFolder: null,
      username: null,
      stats: {
        filesProtected: 0,
        filesDownloaded: 0,
        filesUploaded: 0,
        filesDownloadedSkipped: 0,
        filesUploadedSkipped: 0, // Placeholder for future upload skip feature
        lastSync: null,
        recentErrors: []
      }
    }
  });

  const [startButtonText, setStartButtonText] = useState('start server');
  const [startButtonDisabled, setStartButtonDisabled] = useState(true);
  const [showError, setShowError] = useState(false);

  // Sync state
  const [syncApiKey, setSyncApiKey] = useState('');
  const [syncUsername, setSyncUsername] = useState('');
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [hasStoredApiKey, setHasStoredApiKey] = useState(false);
  const [syncButtonText, setSyncButtonText] = useState('enable sync');
  const [syncButtonDisabled, setSyncButtonDisabled] = useState(false);
  const [showSyncError, setShowSyncError] = useState(false);
  const [syncErrorMessage, setSyncErrorMessage] = useState('');

  // Error queue state
  const [errorQueue, setErrorQueue] = useState([]);
  const errorIdCounter = useRef(0);

  // Navigation state
  const [currentView, setCurrentView] = useState('main'); // 'main' | 'sync' | 'errors'

  // Update notification state
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateVersion, setUpdateVersion] = useState(null);

  // Ref for content container to measure height
  const contentRef = useRef(null);

  const unreadCount = errorQueue.filter(e => !e.read).length;

  // Error management functions
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
  window.__addError = addError;

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

  // Initialize app state
  useEffect(() => {
    const initializeApp = async () => {
      if (window.electronAPI) {
        const state = await window.electronAPI.getState();
        setCurrentState(prevState => ({ ...prevState, ...state }));

        // Check if API key is already configured
        const apiKeyInfo = await window.electronAPI.getApiKeyInfo();
        if (apiKeyInfo && apiKeyInfo.hasApiKey) {
          setSyncUsername(apiKeyInfo.username || '');
          setSyncApiKey('••••••••••••••••••••••••••••••••');
          setHasStoredApiKey(true);
        }
      }
    };

    // Listen for state updates
    if (window.electronAPI) {
      window.electronAPI.onStateUpdate((state) => {
        // Update all state including sync status
        if (state.syncStatus) {
          setCurrentState(prevState => ({
            ...prevState,
            syncStatus: state.syncStatus,
            selectedFolder: state.selectedFolder,
            serverRunning: state.serverRunning,
            serverPort: state.serverPort
          }));
        } else {
          setCurrentState(prevState => ({ ...prevState, ...state }));
        }
      });

      // Listen for sync errors
      window.electronAPI.onSyncUpdate((data) => {
        if (data.error) {
          // Handle validation errors specially
          if (data.type === 'validation') {
            addError({
              ...data,
              priority: data.priority || 2, // HIGH priority
              dismissable: true,
              error: `❌ Validation failed: ${data.error}`,
              file: data.file
            });
          } else {
            addError(data);
          }
        }
      });

      // Listen for sync stats updates
      window.electronAPI.onSyncStats((stats) => {
        setCurrentState(prevState => ({
          ...prevState,
          syncStatus: {
            ...prevState.syncStatus,
            stats: stats
          }
        }));
      });

      // Listen for retry events
      window.electronAPI.onSyncRetry((data) => {
        addError({
          ...data,
          priority: 3, // MEDIUM priority
          type: 'sync_retry',
          dismissable: true,
          error: `Retrying ${data.file} (attempt ${data.attempt}/${data.maxAttempts})`
        });
      });

      // Listen for permanent failure events
      window.electronAPI.onSyncFailed((data) => {
        addError({
          ...data,
          error: `Failed to sync ${data.file} after ${data.attempts} attempts: ${data.error}`
        });
      });

      // Listen for update available
      window.electronAPI.onUpdateAvailable((data) => {
        setUpdateAvailable(true);
        setUpdateVersion(data.latestVersion);
      });
    }

    initializeApp();
  }, []);

  // Update button states based on current state
  useEffect(() => {
    if (currentState.selectedFolder) {
      setShowError(false); // Hide error when folder is selected
    }

    if (!currentState.serverRunning) {
      setStartButtonText('start server');
      setStartButtonDisabled(false); // Always enable start button so users can click it
    } else {
      setStartButtonDisabled(true); // Disable when server is running
    }

    // Update sync state
    if (currentState.syncStatus) {
      setSyncEnabled(currentState.syncStatus.isRunning);

      // Update button text to match running state
      if (currentState.syncStatus.isRunning) {
        setSyncButtonText('disable sync');
      } else {
        setSyncButtonText('enable sync');
      }

      if (currentState.syncStatus.username) {
        setSyncUsername(currentState.syncStatus.username);
      }
    }
  }, [currentState]);

  const handleSelectFolder = async () => {
    if (window.electronAPI) {
      await window.electronAPI.selectFolder();
    }
  };

  const handleStartServer = async () => {
    // Check if folder is selected, show error if not
    if (!currentState.selectedFolder) {
      setShowError(true);
      return;
    }

    setStartButtonDisabled(true);
    setStartButtonText('starting...');
    setShowError(false);
    try {
      if (window.electronAPI) {
        await window.electronAPI.startServer();
      }
    } catch (error) {
      console.error('Failed to start server:', error);
      setStartButtonDisabled(false);
      setStartButtonText('start server');
    }
  };

  const handleStopServer = async () => {
    if (window.electronAPI) {
      await window.electronAPI.stopServer();
    }
  };

  const handleOpenBrowser = async (e) => {
    e.preventDefault();
    if (window.electronAPI) {
      await window.electronAPI.openBrowser();
    }
  };

  const handleOpenFolder = async () => {
    if (window.electronAPI) {
      await window.electronAPI.openFolder();
    }
  };

  const handleOpenLogs = async () => {
    if (window.electronAPI) {
      await window.electronAPI.openLogs();
    }
  };

  const handleEnableSync = async () => {
    // Check if user is using stored credentials (placeholder dots)
    const isUsingStoredKey = syncApiKey.startsWith('••••');

    if (isUsingStoredKey) {
      // Validate username even when reusing stored key
      if (!syncUsername.trim()) {
        setShowSyncError(true);
        setSyncErrorMessage('Username is required');
        return;
      }

      // Resume with stored credentials
      setSyncButtonDisabled(true);
      setSyncButtonText('enabling...');
      setShowSyncError(false);

      try {
        if (window.electronAPI) {
          // Pass selectedFolder and username to sync-resume
          const result = await window.electronAPI.syncResume(
            currentState.selectedFolder,
            syncUsername.trim()
          );

          if (result.success) {
            setSyncEnabled(true);
            setSyncButtonText('disable sync');
            setSyncButtonDisabled(false);
          } else {
            setShowSyncError(true);
            setSyncErrorMessage(result.error || 'Failed to enable sync');
            setSyncButtonText('enable sync');
            setSyncButtonDisabled(false);
          }
        }
      } catch (error) {
        console.error('Sync resume error:', error);
        setShowSyncError(true);
        setSyncErrorMessage('Failed to enable sync');
        setSyncButtonText('enable sync');
        setSyncButtonDisabled(false);
      }
      return;
    }

    // Validate inputs for new API key
    if (!syncApiKey.trim()) {
      setShowSyncError(true);
      setSyncErrorMessage('API key is required');
      return;
    }

    if (!syncUsername.trim()) {
      setShowSyncError(true);
      setSyncErrorMessage('Username is required');
      return;
    }

    if (!currentState.selectedFolder) {
      setShowSyncError(true);
      setSyncErrorMessage('Select a folder first');
      return;
    }

    setSyncButtonDisabled(true);
    setSyncButtonText('enabling...');
    setShowSyncError(false);

    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.syncStart(
          syncApiKey.trim(),
          syncUsername.trim(),
          currentState.selectedFolder
        );

        if (result.success) {
          setSyncEnabled(true);
          setSyncButtonText('disable sync');
          setHasStoredApiKey(true);
          // Replace API key with placeholder dots
          setSyncApiKey('••••••••••••••••••••••••••••••••');
          setSyncButtonDisabled(false);
        } else {
          setShowSyncError(true);
          setSyncErrorMessage(result.error || 'Failed to enable sync');
          setSyncButtonDisabled(false);
          setSyncButtonText('enable sync');
        }
      }
    } catch (error) {
      console.error('Failed to enable sync:', error);
      setShowSyncError(true);
      setSyncErrorMessage('Failed to enable sync');
      setSyncButtonDisabled(false);
      setSyncButtonText('enable sync');
    }
  };

  const handleDisableSync = async () => {
    setSyncButtonDisabled(true);
    setSyncButtonText('disabling...');

    try {
      if (window.electronAPI) {
        await window.electronAPI.syncStop();
        setSyncEnabled(false);
        setSyncButtonText('enable sync');
        setSyncButtonDisabled(false);
      }
    } catch (error) {
      console.error('Failed to disable sync:', error);
      setSyncButtonDisabled(false);
      setSyncButtonText('disable sync');
    }
  };

  const getServerStatusClass = () => {
    return currentState.serverRunning
      ? 'whitespace-nowrap p-[2px_20px_4px] font-bold text-[#28C83E] bg-[#181F28] rounded-full'
      : 'whitespace-nowrap p-[2px_20px_4px] font-bold text-[#F73D48] bg-[#281818] rounded-full';
  };

  const getSyncStatusClass = () => {
    return 'whitespace-nowrap p-[2px_20px_4px] font-bold text-[#28C83E] bg-[#181F28] rounded-full';
  };

  const handleTabClick = (view) => {
    setCurrentView(view);
  };

  // Auto-resize window based on content height
  useEffect(() => {
    if (contentRef.current && window.electronAPI) {
      // Use ResizeObserver to watch for content size changes
      const resizeObserver = new ResizeObserver(() => {
        if (contentRef.current) {
          // Get the full content height including padding and borders
          const contentHeight = contentRef.current.scrollHeight;

          // Add extra space for top bar, padding, and breathing room
          // Top bar (~65px) + content + bottom padding
          const targetHeight = contentHeight + 100;

          // Request resize from main process
          window.electronAPI.resizeWindow(targetHeight);
        }
      });

      resizeObserver.observe(contentRef.current);

      // Cleanup
      return () => {
        resizeObserver.disconnect();
      };
    }
  }, [currentView]); // Re-run when view changes

  const shouldShowErrorMessage = () => {
    return showError;
  };

  return (
    <div className="text-white bg-[#0B0C12] min-h-screen">
      {/* top bar */}
      <div className="flex justify-end gap-3 p-[16px_24px_15px_24px]" style={{WebkitAppRegion: 'drag'}}>
        <div className="flex items-stretch gap-3" style={{WebkitAppRegion: 'no-drag'}}>
          <button
            className="relative flex items-center justify-center px-2 cursor-pointer bg-[#181F28] rounded-full hover:bg-[#232D3A]"
            onClick={() => setCurrentView(currentView === 'errors' ? 'main' : 'main')}
            title="Home"
          >
            <svg className="w-[18px] h-[18px] text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
            </svg>
          </button>
          <button
            className="relative flex items-center justify-center px-2 cursor-pointer bg-[#181F28] rounded-full hover:bg-[#232D3A]"
            onClick={() => setCurrentView(currentView === 'errors' ? 'main' : 'errors')}
            title="Notifications"
          >
            <svg className="w-[18px] h-[18px] text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
            </svg>
            {unreadCount > 0 && (
              <span className="absolute top-0 right-0 translate-x-[37.5%] -translate-y-[37.5%] flex items-center justify-center min-w-[18px] h-[18px] px-1 regular-font !text-[12px] font-bold text-white bg-[#8B2020] rounded-full">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
          {updateAvailable && (
            <Tooltip label="update available">
              <button
                className="relative h-full aspect-square flex items-center justify-center font-bold text-white bg-[#1E8136] rounded-full cursor-pointer hover:bg-[#23973F] border-2 border-[#0B0C11]"
                onClick={() => window.electronAPI?.openBrowser('https://hyperclay.com/hyperclay-local')}
              >
                <svg className="w-[15px] h-[15px]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="3" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18" />
                </svg>
              </button>
            </Tooltip>
          )}
          <div className={getServerStatusClass()}>
            {currentState.serverRunning ? 'server on' : 'server off'}
          </div>
          {syncEnabled && (
            <div className={getSyncStatusClass()}>
              sync active
            </div>
          )}
        </div>
      </div>

      <hr className="border-[1px] border-[#292F52]" />

      {/* main area */}
      <div ref={contentRef} className="p-[16px_24px_30px_24px]">
        {currentView === 'errors' ? (
          <ErrorsPage
            errors={errorQueue}
            onMarkRead={markAllRead}
            onMarkErrorRead={markErrorRead}
            onClearAll={clearAllErrors}
          />
        ) : (
        <>
        {/* heading */}
        <div className="flex gap-2 items-center mb-2.5">
          <h1 className="text-[36px]">Hyperclay Local</h1>
          <div className="ml-auto flex gap-2" style={{WebkitAppRegion: 'no-drag'}}>
            <span className={`text-[24px] text-[#292F52] ${!currentState.selectedFolder || !currentState.serverRunning ? 'hidden' : ''}`}> &middot;</span>
            <button className={`regular-font group flex gap-2 items-center text-[#69AEFE] ${!currentState.selectedFolder ? 'hidden' : ''}`} onClick={handleOpenFolder}>
              <svg className="w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 240 240">
                <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="21" d="m130.6 63.1-21.2-21.2a15 15 0 0 0-10.6-4.4H45A22.5 22.5 0 0 0 22.5 60v120A22.5 22.5 0 0 0 45 202.5h150a22.5 22.5 0 0 0 22.5-22.5V90A22.5 22.5 0 0 0 195 67.5h-53.8a15 15 0 0 1-10.6-4.4Z"/>
              </svg>
              <span className="text-[20px] underline group-hover:no-underline">folder</span>
            </button>
            <span className={`text-[24px] text-[#292F52] ${!currentState.serverRunning ? 'hidden' : ''}`}> &middot;</span>
            <a
              href="#"
              className={`group flex gap-1 items-center text-[#69AEFE] ${!currentState.serverRunning ? 'hidden' : ''}`}
              onClick={handleOpenBrowser}
            >
              <span className="text-[20px] underline group-hover:no-underline">browser</span>
              <svg className="w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
            </a>
          </div>
        </div>

        {/* Folder selector - shared across tabs */}
        <div className="flex gap-2 mb-6">
          <div className="my-auto">Folder:</div>
          <Tooltip label={currentState.selectedFolder} disabled={!currentState.selectedFolder}>
            <div className="grow min-w-0 border-[2px] border-[#4F5A97] overflow-hidden whitespace-nowrap text-ellipsis px-2 leading-[42px]" style={{ direction: 'rtl' }}>
              <span style={{ direction: 'ltr', unicodeBidi: 'plaintext' }}>
                {currentState.selectedFolder || 'No folder selected'}
              </span>
            </div>
          </Tooltip>
          {/* button: select folder */}
          <button
            className="group p-[4px_17px_7px] text-center text-[20px] cursor-pointer bg-[#1D1F2F] border-[3px] border-t-[#474C65] border-r-[#131725] border-b-[#131725] border-l-[#474C65] hover:bg-[#232639] active:border-b-[#474C65] active:border-l-[#131725] active:border-t-[#131725] active:border-r-[#474C65] sm:p-[4px_19px_7px] sm:text-[21px]"
            onClick={handleSelectFolder}
          >
            <span className="whitespace-nowrap select-none inline-block group-active:translate-x-[1.5px] group-active:translate-y-[1.5px]">
              select
            </span>
          </button>
        </div>

        {/* Tabs */}
        <div className="tabs-container">
          <div className="tabs flex gap-2 mb-0" style={{WebkitAppRegion: 'no-drag'}}>
            <button
              className={`relative p-[7px_16px_9px] bg-[#0B0C12] border-t-2 border-r-2 border-l-2 border-[#4F5A97] ${
                currentView === 'main'
                  ? 'border-b-0 z-10'
                  : 'border-b-2 text-opacity-70 -mb-[2px]'
              }`}
              onClick={() => handleTabClick('main')}
            >
              main
            </button>
            <button
              className={`relative p-[7px_16px_9px] bg-[#0B0C12] border-t-2 border-r-2 border-l-2 border-[#4F5A97] ${
                currentView === 'sync'
                  ? 'border-b-0 z-10'
                  : 'border-b-2 text-opacity-70 -mb-[2px]'
              }`}
              onClick={() => handleTabClick('sync')}
            >
              sync
            </button>
          </div>

          <div className="tab-content bg-[#0B0C12] border-2 border-[#4F5A97] p-6 -mt-[2px] relative">
            {/* Main view content */}
            {currentView === 'main' && (
              <>
            {/* button: start server */}
            <button
              className={`group w-full mb-[17px] p-[6px_17px_9px] text-center text-[23px] cursor-pointer bg-[#1E8136] border-[3px] border-t-[#56B96C] border-r-[#15311C] border-b-[#15311C] border-l-[#56B96C] hover:bg-[#23973F] active:border-b-[#56B96C] active:border-l-[#15311C] active:border-t-[#15311C] active:border-r-[#56B96C] sm:p-[6px_19px_9px] sm:text-[24px] ${currentState.serverRunning ? 'hidden' : ''}`}
              onClick={handleStartServer}
              disabled={startButtonDisabled}
            >
              <span className="whitespace-nowrap select-none inline-block group-active:translate-x-[1.5px] group-active:translate-y-[1.5px]">
                {startButtonText}
              </span>
            </button>

            {/* button: stop server */}
            <button
              className={`group w-full mb-[17px] p-[6px_17px_9px] text-center text-[23px] cursor-pointer bg-[#7B2525] border-[3px] border-t-[#B45454] border-r-[#371111] border-b-[#371111] border-l-[#B45454] hover:bg-[#9F3030] active:border-b-[#B45454] active:border-l-[#371111] active:border-t-[#371111] active:border-r-[#B45454] sm:p-[6px_19px_9px] sm:text-[24px] ${!currentState.serverRunning ? 'hidden' : ''}`}
              onClick={handleStopServer}
            >
              <span className="whitespace-nowrap select-none inline-block group-active:translate-x-[1.5px] group-active:translate-y-[1.5px]">
                stop server
              </span>
            </button>

            {/* conditional error message */}
            <div className={`mb-[17px] text-[16px] text-center text-[#FE5F58] ${!shouldShowErrorMessage() ? 'hidden' : ''}`}>
              Select a folder before starting server
            </div>

            <div className="flex flex-col gap-[17px]">
              <div className="flex gap-4 items-center p-2 border-[2px] border-[#292F52] bg-[#111220] text-[18px]">
                <div className="w-[42px] h-[42px] text-center leading-[42px] text-white bg-[#292F52] rounded-full">1</div>
                <div className="text-[#B8BFE5]">Select folder that contains HTML app files</div>
              </div>
              <div className="flex gap-4 items-center p-2 border-[2px] border-[#292F52] bg-[#111220] text-[18px]">
                <div className="w-[42px] h-[42px] text-center leading-[42px] text-white bg-[#292F52] rounded-full">2</div>
                <div className="text-[#B8BFE5]">Start server and visit http://localhost:4321</div>
              </div>
              <div className="flex gap-4 items-center p-2 border-[2px] border-[#292F52] bg-[#111220] text-[18px]">
                <div className="w-[42px] h-[42px] text-center leading-[42px] text-white bg-[#292F52] rounded-full">3</div>
                <div className="text-[#B8BFE5]">Locally edit HTML apps using their own UI</div>
              </div>
            </div>
          </>
        )}

            {/* Sync view content */}
            {currentView === 'sync' && (
              <>
            <div className="flex gap-2 items-center mb-4">
              <h2 className="text-[28px]">Sync to Hyperclay Platform</h2>
              <div className="ml-auto flex gap-2" style={{WebkitAppRegion: 'no-drag'}}>
                <button className="regular-font group flex gap-2 items-center text-[#69AEFE]" onClick={handleOpenLogs}>
                  <svg className="w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                  </svg>
                  <span className="text-[20px] underline group-hover:no-underline">logs</span>
                </button>
              </div>
            </div>

            {!syncEnabled ? (
              <>
                {/* Sync setup form - always show */}
                <div className="mb-3">
                  <label className="block mb-1 text-[16px] text-[#B8BFE5]">API Key:</label>
                  <input
                    type="password"
                    className="w-full p-2 border-[2px] border-[#4F5A97] bg-[#111220] text-white focus:border-[#69AEFE] focus:outline-none"
                    placeholder="Your sync key from hyperclay.com"
                    value={syncApiKey}
                    onChange={(e) => setSyncApiKey(e.target.value)}
                  />
                </div>

                <div className="mb-5">
                  <label className="block mb-1 text-[16px] text-[#B8BFE5]">Username:</label>
                  <input
                    type="text"
                    className="w-full p-2 border-[2px] border-[#4F5A97] bg-[#111220] text-white focus:border-[#69AEFE] focus:outline-none"
                    placeholder="Your hyperclay.com username"
                    value={syncUsername}
                    onChange={(e) => setSyncUsername(e.target.value)}
                  />
                </div>

                {/* Enable sync button */}
                <button
                  className="group w-full mb-3 p-[6px_17px_9px] text-center text-[23px] cursor-pointer bg-[#1D498E] border-[3px] border-t-[#4F7CC4] border-r-[#0F2447] border-b-[#0F2447] border-l-[#4F7CC4] hover:bg-[#2156A8] active:border-b-[#4F7CC4] active:border-l-[#0F2447] active:border-t-[#0F2447] active:border-r-[#4F7CC4] sm:p-[6px_19px_9px] sm:text-[24px] disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleEnableSync}
                  disabled={syncButtonDisabled}
                >
                  <span className="whitespace-nowrap select-none inline-block group-active:translate-x-[1.5px] group-active:translate-y-[1.5px]">
                    {syncButtonText}
                  </span>
                </button>

                {/* Sync error message */}
                {showSyncError && (
                  <div className="-mt-1 mb-4 text-[16px] text-center text-[#FE5F58]">
                    {syncErrorMessage}
                  </div>
                )}

                <div className="text-[14px] text-[#8A92BB]">
                  Generate your sync key at{' '}
                  <button
                    className="text-[#69AEFE] underline hover:no-underline"
                    onClick={() => window.electronAPI?.openBrowser('https://hyperclay.com/dashboard')}
                  >
                    hyperclay.com/dashboard
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* Sync stats */}
                <div className="mb-4 p-4 border-[2px] border-[#28C83E] bg-[#111220]">
                  <div className="mb-3 text-[18px] text-[#28C83E]">✓ Sync Active</div>
                  <div className="text-[14px] text-[#B8BFE5] space-y-1">
                    <div>Username: {currentState.syncStatus.username}</div>
                    <div>Folder: {currentState.syncStatus.syncFolder || currentState.selectedFolder}</div>
                    {currentState.syncStatus.stats.lastSync && (
                      <div>Last sync: {new Date(currentState.syncStatus.stats.lastSync).toLocaleString()}</div>
                    )}
                  </div>

                  {/* Stats grid - merged format */}
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[14px]">
                    <div className="p-2 bg-[#0B0C12] border-2 border-[#292F52]">
                      <div className="text-[#8A92BB] mb-1">Downloaded / Skipped</div>
                      <div className="text-[20px] flex items-center gap-1">
                        <span style={{ color: '#ffffff' }}>
                          {currentState.syncStatus.stats.filesDownloaded}
                        </span>
                        <span style={{ color: '#8A92BB' }}>/</span>
                        <span style={{ color: '#ffffff' }}>
                          {currentState.syncStatus.stats.filesProtected + currentState.syncStatus.stats.filesDownloadedSkipped}
                        </span>
                      </div>
                    </div>
                    <div className="p-2 bg-[#0B0C12] border-2 border-[#292F52]">
                      <div className="text-[#8A92BB] mb-1">Uploaded / Skipped</div>
                      <div className="text-[20px] flex items-center gap-1">
                        <span style={{ color: '#ffffff' }}>
                          {currentState.syncStatus.stats.filesUploaded}
                        </span>
                        <span style={{ color: '#8A92BB' }}>/</span>
                        <span style={{ color: '#ffffff' }}>
                          {currentState.syncStatus.stats.filesUploadedSkipped || 0}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Disable sync button */}
                <button
                  className="group w-full mb-3 p-[6px_17px_9px] text-center text-[23px] cursor-pointer bg-[#7B2525] border-[3px] border-t-[#B45454] border-r-[#371111] border-b-[#371111] border-l-[#B45454] hover:bg-[#9F3030] active:border-b-[#B45454] active:border-l-[#371111] active:border-t-[#371111] active:border-r-[#B45454] sm:p-[6px_19px_9px] sm:text-[24px]"
                  onClick={handleDisableSync}
                  disabled={syncButtonDisabled}
                >
                  <span className="whitespace-nowrap select-none inline-block group-active:translate-x-[1.5px] group-active:translate-y-[1.5px]">
                    {syncButtonText}
                  </span>
                </button>
              </>
            )}
              </>
            )}
          </div>
        </div>
        </>
        )}
      </div>
    </div>
  );
};

export default HyperclayLocalApp;