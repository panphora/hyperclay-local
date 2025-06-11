import React, { useState, useEffect } from 'react';

const HyperclayLocalApp = () => {
  const [currentState, setCurrentState] = useState({
    selectedFolder: null,
    serverRunning: false,
    serverPort: 4321
  });

  const [startButtonText, setStartButtonText] = useState('start server');
  const [startButtonDisabled, setStartButtonDisabled] = useState(true);
  const [showError, setShowError] = useState(false);

  // Initialize app state
  useEffect(() => {
    const initializeApp = async () => {
      if (window.electronAPI) {
        const state = await window.electronAPI.getState();
        setCurrentState(prevState => ({ ...prevState, ...state }));
      }
    };

    // Listen for state updates
    if (window.electronAPI) {
      window.electronAPI.onStateUpdate((state) => {
        setCurrentState(prevState => ({ ...prevState, ...state }));
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

  const getServerStatusClass = () => {
    return currentState.serverRunning 
      ? 'p-[2px_20px_4px] font-bold text-[#28C83E] bg-[#181F28] rounded-full'
      : 'p-[2px_20px_4px] font-bold text-[#F73D48] bg-[#281818] rounded-full';
  };

  const shouldShowErrorMessage = () => {
    return showError;
  };

  return (
    <div className="text-white bg-[#0B0C12]">
      {/* top bar */}
      <div className="flex justify-end items-center p-[16px_24px_15px_24px]" style={{WebkitAppRegion: 'drag'}}>
        <div className={getServerStatusClass()} style={{WebkitAppRegion: 'no-drag'}}>
          {currentState.serverRunning ? 'server on' : 'server off'}
        </div>
      </div>
      
      <hr className="border-[1px] border-[#292F52]" />
      
      {/* main area */}
      <div className="p-[16px_24px_30px_24px]">
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
        
        {/* button: start server */}
        <button 
          className={`group w-full mb-3 p-[6px_17px_9px] text-center text-[23px] cursor-pointer bg-[#1E8136] border-[3px] border-t-[#56B96C] border-r-[#15311C] border-b-[#15311C] border-l-[#56B96C] hover:bg-[#23973F] active:border-b-[#56B96C] active:border-l-[#15311C] active:border-t-[#15311C] active:border-r-[#56B96C] sm:p-[6px_19px_9px] sm:text-[24px] ${currentState.serverRunning ? 'hidden' : ''}`}
          onClick={handleStartServer}
          disabled={startButtonDisabled}
        >
          <span className="whitespace-nowrap select-none inline-block group-active:translate-x-[1.5px] group-active:translate-y-[1.5px]">
            {startButtonText}
          </span>
        </button>
        
        {/* button: stop server */}
        <button 
          className={`group w-full mb-3 p-[6px_17px_9px] text-center text-[23px] cursor-pointer bg-[#7B2525] border-[3px] border-t-[#B45454] border-r-[#371111] border-b-[#371111] border-l-[#B45454] hover:bg-[#9F3030] active:border-b-[#B45454] active:border-l-[#371111] active:border-t-[#371111] active:border-r-[#B45454] sm:p-[6px_19px_9px] sm:text-[24px] ${!currentState.serverRunning ? 'hidden' : ''}`}
          onClick={handleStopServer}
        >
          <span className="whitespace-nowrap select-none inline-block group-active:translate-x-[1.5px] group-active:translate-y-[1.5px]">
            stop server
          </span>
        </button>
        
        {/* conditional error message */}
        <div className={`-mt-1 mb-4 text-[16px] text-center text-[#FE5F58] ${!shouldShowErrorMessage() ? 'hidden' : ''}`}>
          Select a folder before starting server
        </div>
        
        <div className="flex gap-2 mb-8">
          <div className="my-auto">Folder:</div>
          <div className="grow flex items-center min-w-0 border-[1px] border-[#4F5A97]">
            <span className="grow truncate px-2">
              {currentState.selectedFolder || 'No folder selected'}
            </span>
          </div>
          {/* button: select folder */}
          <button 
            className="group p-[4px_17px_7px] text-center text-[20px] cursor-pointer bg-[#1D1F2F] border-[3px] border-t-[#474C65] border-r-[#131725] border-b-[#131725] border-l-[#474C65] hover:bg-[#232639] active:border-b-[#474C65] active:border-l-[#131725] active:border-t-[#131725] active:border-r-[#474C65] sm:p-[4px_19px_7px] sm:text-[21px]"
            onClick={handleSelectFolder}
          >
            <span className="whitespace-nowrap select-none inline-block group-active:translate-x-[1.5px] group-active:translate-y-[1.5px]">
              select folder
            </span>
          </button>
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
      </div>
    </div>
  );
};

export default HyperclayLocalApp;