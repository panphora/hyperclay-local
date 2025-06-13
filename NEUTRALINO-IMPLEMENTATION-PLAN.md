# NeutralinoJS Implementation Plan for Hyperclay Local

## Overview

This document provides a detailed, step-by-step implementation plan for migrating the Hyperclay Local Electron app to NeutralinoJS. Each step includes specific code examples and is designed to be followed by junior developers.

**Total Estimated Time: 2-4 weeks**  
**Difficulty Level: Moderate**  
**Expected Result: 85% smaller bundle size with identical functionality**

---

## Phase 1: Project Setup and Foundation (Days 1-2)

### Step 1.1: Initialize NeutralinoJS Project
**Time: 30 minutes**

1. **Create new NeutralinoJS project**
   ```bash
   # Install NeutralinoJS CLI globally
   npm install -g @neutralinojs/neu

   # Create new project
   neu create hyperclay-local-neu --template vanilla

   # Navigate to project directory
   cd hyperclay-local-neu
   ```

2. **Install required dependencies**
   ```bash
   # Install React and related packages
   npm install react@19.1.0 react-dom@19.1.0
   npm install @babel/core @babel/preset-react babel-loader webpack webpack-cli
   npm install @tailwindcss/cli tailwindcss

   # Install NeutralinoJS client library
   npm install @neutralinojs/lib
   ```

### Step 1.2: Configure Basic Project Structure
**Time: 45 minutes**

1. **Create directory structure**
   ```bash
   mkdir -p src/components
   mkdir -p src/assets
   mkdir -p extensions/server-ext
   mkdir -p resources/icons
   ```

2. **Copy assets from original project**
   ```bash
   # Copy these files from the Electron project:
   # assets/icon.png → resources/icons/appIcon.png
   # assets/icon.svg → resources/icons/appIcon.svg
   # assets/*.woff2 → resources/fonts/
   ```

### Step 1.3: Configure neutralino.config.json
**Time: 30 minutes**

1. **Replace default config with comprehensive setup**
   ```json
   {
     "applicationId": "com.hyperclay.local-server",
     "version": "1.0.0",
     "defaultMode": "window",
     "port": 0,
     "documentRoot": "/resources/",
     "url": "/",
     "enableServer": true,
     "enableNativeAPI": true,
     "enableExtensions": true,
     "enableHTTPAPI": true,
     "tokenSecurity": "one-time",
     "logging": {
       "enabled": true,
       "writeToLogFile": true
     },
     "nativeAllowList": [
       "app.*",
       "os.*",
       "filesystem.*",
       "extensions.*",
       "window.*",
       "events.*"
     ],
     "globalVariables": {
       "TEST_MODE": false
     },
     "modes": {
       "window": {
         "title": "Hyperclay Local",
         "width": 720,
         "height": 600,
         "minWidth": 600,
         "minHeight": 500,
         "resizable": true,
         "maximizable": true,
         "hidden": false,
         "exitProcessOnClose": false,
         "enableInspector": false,
         "borderless": false,
         "alwaysOnTop": false,
         "icon": "/resources/icons/appIcon.png",
         "resourcesPath": "/resources/"
       }
     },
     "cli": {
       "binaryName": "hyperclay-local",
       "resourcesPath": "./resources/",
       "extensionsPath": "./extensions/",
       "clientLibrary": "./src/neutralino.js",
       "binaryVersion": "4.15.0",
       "clientVersion": "3.12.0"
     },
     "extensions": [
       {
         "id": "server-ext",
         "command": "node extensions/server-ext/main.js"
       }
     ]
   }
   ```

### Step 1.4: Set up Build Configuration
**Time: 30 minutes**

1. **Create webpack.config.js**
   ```javascript
   const path = require('path');

   module.exports = {
     mode: 'development',
     entry: './src/index.js',
     output: {
       path: path.resolve(__dirname, 'resources'),
       filename: 'js/bundle.js',
       publicPath: '/resources/'
     },
     module: {
       rules: [
         {
           test: /\.(js|jsx)$/,
           exclude: /node_modules/,
           use: {
             loader: 'babel-loader',
             options: {
               presets: ['@babel/preset-react']
             }
           }
         },
         {
           test: /\.css$/,
           use: ['style-loader', 'css-loader', 'postcss-loader']
         }
       ]
     },
     resolve: {
       extensions: ['.js', '.jsx']
     },
     devtool: 'source-map'
   };
   ```

2. **Update package.json scripts**
   ```json
   {
     "scripts": {
       "build-css": "npx @tailwindcss/cli -i ./src/styles.css -o ./resources/css/styles.css",
       "build-react": "webpack --mode=development",
       "build-react-prod": "webpack --mode=production",
       "dev": "concurrently \"npm run dev-css\" \"npm run dev-react\" \"neu run\"",
       "dev-css": "npx @tailwindcss/cli -i ./src/styles.css -o ./resources/css/styles.css --watch",
       "dev-react": "webpack --mode=development --watch",
       "build": "npm run build-css && npm run build-react-prod && neu build",
       "start": "npm run build && neu run"
     }
   }
   ```

---

## Phase 2: Core Frontend Migration (Days 3-4)

### Step 2.1: Create Base HTML Structure
**Time: 20 minutes**

1. **Create resources/index.html**
   ```html
   <!DOCTYPE html>
   <html lang="en">
   <head>
     <meta charset="utf-8">
     <meta name="viewport" content="width=device-width, initial-scale=1.0">
     <title>Hyperclay Local</title>
     <link rel="stylesheet" href="css/styles.css">
     <style>
       @font-face {
         font-family: 'Fixedsys';
         src: url('./fonts/fixedsys-webfont.woff2') format('woff2');
         font-weight: 400;
         font-style: normal;
         font-display: swap;
       }
       @font-face {
         font-family: 'Berkeley Mono';
         src: url('./fonts/BerkeleyMonoVariable-Regular.woff2') format('woff2');
         font-weight: 100 900;
         font-style: normal;
         font-display: swap;
       }
       html, body {
         overflow: hidden;
         font-family: "Berkeley Mono";
         font-size: 19px;
         font-weight: 400;
         margin: 0;
         padding: 0;
       }
       body button {
         font-family: "Fixedsys";
         font-weight: 400;
       }
       .regular-font {
         font-family: "Berkeley Mono";
         font-size: 19px;
         font-weight: 400;
       }
     </style>
   </head>
   <body class="bg-[#0B0C12]">
     <div id="root"></div>
     <script src="js/neutralino.js"></script>
     <script src="js/bundle.js"></script>
   </body>
   </html>
   ```

### Step 2.2: Set up NeutralinoJS API Bridge
**Time: 45 minutes**

1. **Create src/neutralino-api.js** (equivalent to preload.js)
   ```javascript
   import { app, os, filesystem, extensions, window as neuWindow, events } from '@neutralinojs/lib';

   // Initialize Neutralino
   Neutralino.init();

   // API bridge to match Electron API structure
   class NeutralinoAPI {
     constructor() {
       this.state = {
         selectedFolder: null,
         serverRunning: false,
         serverPort: 4321
       };
       this.stateListeners = [];
       this.initializeEventListeners();
     }

     // Initialize event listeners for extension communication
     initializeEventListeners() {
       events.on('serverStateChanged', (evt) => {
         this.state = { ...this.state, ...evt.detail };
         this.notifyStateListeners(this.state);
       });
     }

     // Folder selection
     async selectFolder() {
       try {
         const folderPath = await os.showFolderDialog('Select folder containing your HTML apps');
         if (folderPath) {
           this.state.selectedFolder = folderPath;
           await this.saveSettings();
           this.notifyStateListeners(this.state);
         }
         return folderPath;
       } catch (error) {
         console.error('Error selecting folder:', error);
         throw error;
       }
     }

     // Server management
     async startServer() {
       try {
         if (!this.state.selectedFolder) {
           throw new Error('No folder selected');
         }
         
         const result = await extensions.dispatch('server-ext', 'startServer', {
           baseDir: this.state.selectedFolder,
           port: this.state.serverPort
         });
         
         this.state.serverRunning = true;
         this.notifyStateListeners(this.state);
         
         // Auto-open browser
         await os.open(`http://localhost:${this.state.serverPort}`);
         
         return result;
       } catch (error) {
         console.error('Error starting server:', error);
         throw error;
       }
     }

     async stopServer() {
       try {
         await extensions.dispatch('server-ext', 'stopServer', {});
         this.state.serverRunning = false;
         this.notifyStateListeners(this.state);
       } catch (error) {
         console.error('Error stopping server:', error);
         throw error;
       }
     }

     // Get current state
     async getState() {
       await this.loadSettings();
       return { ...this.state };
     }

     // Open folder in system explorer
     async openFolder() {
       if (this.state.selectedFolder) {
         await os.open(this.state.selectedFolder);
       }
     }

     // Open browser
     async openBrowser(url = null) {
       const targetUrl = url || `http://localhost:${this.state.serverPort}`;
       await os.open(targetUrl);
     }

     // Settings persistence
     async saveSettings() {
       try {
         const settings = {
           selectedFolder: this.state.selectedFolder
         };
         await filesystem.writeFile('./settings.json', JSON.stringify(settings, null, 2));
       } catch (error) {
         console.error('Failed to save settings:', error);
       }
     }

     async loadSettings() {
       try {
         const data = await filesystem.readFile('./settings.json');
         const settings = JSON.parse(data);
         this.state.selectedFolder = settings.selectedFolder || null;
       } catch (error) {
         // Settings file doesn't exist or is invalid - use defaults
         this.state.selectedFolder = null;
       }
     }

     // State management
     onStateUpdate(callback) {
       this.stateListeners.push(callback);
     }

     removeAllListeners() {
       this.stateListeners = [];
     }

     notifyStateListeners(state) {
       this.stateListeners.forEach(callback => callback(state));
     }
   }

   // Create global API instance
   window.neutralinoAPI = new NeutralinoAPI();

   export default window.neutralinoAPI;
   ```

### Step 2.3: Migrate React Components
**Time: 90 minutes**

1. **Create src/components/HyperclayLocalApp.jsx**
   ```javascript
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
         if (window.neutralinoAPI) {
           const state = await window.neutralinoAPI.getState();
           setCurrentState(prevState => ({ ...prevState, ...state }));
         }
       };

       // Listen for state updates
       if (window.neutralinoAPI) {
         window.neutralinoAPI.onStateUpdate((state) => {
           setCurrentState(prevState => ({ ...prevState, ...state }));
         });
       }

       initializeApp();

       // Cleanup listeners on unmount
       return () => {
         if (window.neutralinoAPI) {
           window.neutralinoAPI.removeAllListeners();
         }
       };
     }, []);

     // Update button states based on current state
     useEffect(() => {
       if (currentState.selectedFolder) {
         setShowError(false);
       }

       if (!currentState.serverRunning) {
         setStartButtonText('start server');
         setStartButtonDisabled(false);
       } else {
         setStartButtonDisabled(true);
       }
     }, [currentState]);

     const handleSelectFolder = async () => {
       if (window.neutralinoAPI) {
         try {
           await window.neutralinoAPI.selectFolder();
         } catch (error) {
           console.error('Failed to select folder:', error);
         }
       }
     };

     const handleStartServer = async () => {
       if (!currentState.selectedFolder) {
         setShowError(true);
         return;
       }

       setStartButtonDisabled(true);
       setStartButtonText('starting...');
       setShowError(false);
       
       try {
         if (window.neutralinoAPI) {
           await window.neutralinoAPI.startServer();
         }
       } catch (error) {
         console.error('Failed to start server:', error);
         setStartButtonDisabled(false);
         setStartButtonText('start server');
       }
     };

     const handleStopServer = async () => {
       if (window.neutralinoAPI) {
         try {
           await window.neutralinoAPI.stopServer();
         } catch (error) {
           console.error('Failed to stop server:', error);
         }
       }
     };

     const handleOpenBrowser = async (e) => {
       e.preventDefault();
       if (window.neutralinoAPI) {
         try {
           await window.neutralinoAPI.openBrowser();
         } catch (error) {
           console.error('Failed to open browser:', error);
         }
       }
     };

     const handleOpenFolder = async () => {
       if (window.neutralinoAPI) {
         try {
           await window.neutralinoAPI.openFolder();
         } catch (error) {
           console.error('Failed to open folder:', error);
         }
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
         {/* Top bar - Note: No drag region in NeutralinoJS */}
         <div className="flex justify-end items-center p-[16px_24px_15px_24px]">
           <div className={getServerStatusClass()}>
             {currentState.serverRunning ? 'server on' : 'server off'}
           </div>
         </div>
         
         <hr className="border-[1px] border-[#292F52]" />
         
         {/* Main area */}
         <div className="p-[16px_24px_30px_24px]">
           {/* Heading */}
           <div className="flex gap-2 items-center mb-2.5">
             <h1 className="text-[36px]">Hyperclay Local</h1>
             <div className="ml-auto flex gap-2">
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
           
           {/* Start server button */}
           <button 
             className={`group w-full mb-3 p-[6px_17px_9px] text-center text-[23px] cursor-pointer bg-[#1E8136] border-[3px] border-t-[#56B96C] border-r-[#15311C] border-b-[#15311C] border-l-[#56B96C] hover:bg-[#23973F] active:border-b-[#56B96C] active:border-l-[#15311C] active:border-t-[#15311C] active:border-r-[#56B96C] sm:p-[6px_19px_9px] sm:text-[24px] ${currentState.serverRunning ? 'hidden' : ''}`}
             onClick={handleStartServer}
             disabled={startButtonDisabled}
           >
             <span className="whitespace-nowrap select-none inline-block group-active:translate-x-[1.5px] group-active:translate-y-[1.5px]">
               {startButtonText}
             </span>
           </button>
           
           {/* Stop server button */}
           <button 
             className={`group w-full mb-3 p-[6px_17px_9px] text-center text-[23px] cursor-pointer bg-[#7B2525] border-[3px] border-t-[#B45454] border-r-[#371111] border-b-[#371111] border-l-[#B45454] hover:bg-[#9F3030] active:border-b-[#B45454] active:border-l-[#371111] active:border-t-[#371111] active:border-r-[#B45454] sm:p-[6px_19px_9px] sm:text-[24px] ${!currentState.serverRunning ? 'hidden' : ''}`}
             onClick={handleStopServer}
           >
             <span className="whitespace-nowrap select-none inline-block group-active:translate-x-[1.5px] group-active:translate-y-[1.5px]">
               stop server
             </span>
           </button>
           
           {/* Error message */}
           <div className={`-mt-1 mb-4 text-[16px] text-center text-[#FE5F58] ${!shouldShowErrorMessage() ? 'hidden' : ''}`}>
             Select a folder before starting server
           </div>
           
           {/* Folder selection section */}
           <div className="flex gap-2 mb-8">
             <div className="my-auto">Folder:</div>
             <div className="grow flex items-center min-w-0 border-[1px] border-[#4F5A97]">
               <span className="grow truncate px-2">
                 {currentState.selectedFolder || 'No folder selected'}
               </span>
             </div>
             <button 
               className="group p-[4px_17px_7px] text-center text-[20px] cursor-pointer bg-[#1D1F2F] border-[3px] border-t-[#474C65] border-r-[#131725] border-b-[#131725] border-l-[#474C65] hover:bg-[#232639] active:border-b-[#474C65] active:border-l-[#131725] active:border-t-[#131725] active:border-r-[#474C65] sm:p-[4px_19px_7px] sm:text-[21px]"
               onClick={handleSelectFolder}
             >
               <span className="whitespace-nowrap select-none inline-block group-active:translate-x-[1.5px] group-active:translate-y-[1.5px]">
                 select folder
               </span>
             </button>
           </div>
           
           {/* Instructions */}
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
   ```

2. **Create src/index.js**
   ```javascript
   import React from 'react';
   import { createRoot } from 'react-dom/client';
   import HyperclayLocalApp from './components/HyperclayLocalApp.jsx';
   import './neutralino-api.js'; // Initialize API bridge

   const container = document.getElementById('root');
   const root = createRoot(container);
   root.render(<HyperclayLocalApp />);
   ```

### Step 2.4: Set up Styling
**Time: 30 minutes**

1. **Create src/styles.css**
   ```css
   @tailwind base;
   @tailwind components;
   @tailwind utilities;
   ```

2. **Create tailwind.config.js**
   ```javascript
   module.exports = {
     content: [
       "./src/**/*.{js,jsx}",
       "./resources/**/*.html"
     ],
     theme: {
       extend: {},
     },
     plugins: [],
   }
   ```

---

## Phase 3: Server Extension Development (Days 5-7)

### Step 3.1: Create Server Extension Structure
**Time: 30 minutes**

1. **Create extensions/server-ext/package.json**
   ```json
   {
     "name": "hyperclay-server-extension",
     "version": "1.0.0",
     "description": "Server extension for Hyperclay Local",
     "main": "main.js",
     "dependencies": {
       "express": "^4.18.2",
       "dotenv": "^16.5.0"
     }
   }
   ```

2. **Install extension dependencies**
   ```bash
   cd extensions/server-ext
   npm install
   cd ../..
   ```

### Step 3.2: Create Extension Main File
**Time: 2 hours**

1. **Create extensions/server-ext/main.js**
   ```javascript
   const express = require('express');
   const fs = require('fs').promises;
   const path = require('path');
   const { spawn } = require('child_process');

   let server = null;
   let app = null;
   let connections = new Set();
   let currentPort = 4321;
   let currentBaseDir = null;

   // Send messages to the main app
   function sendMessage(event, data) {
     process.stdout.write(JSON.stringify({
       method: 'app.broadcast',
       data: {
         event: event,
         data: data
       }
     }) + '\n');
   }

   // Generate timestamp for backups
   function generateTimestamp() {
     const now = new Date();
     const year = now.getFullYear();
     const month = String(now.getMonth() + 1).padStart(2, '0');
     const day = String(now.getDate()).padStart(2, '0');
     const hours = String(now.getHours()).padStart(2, '0');
     const minutes = String(now.getMinutes()).padStart(2, '0');
     const seconds = String(now.getSeconds()).padStart(2, '0');
     const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
     
     return `${year}-${month}-${day}-${hours}-${minutes}-${seconds}-${milliseconds}`;
   }

   // Create backup functionality
   async function createBackup(baseDir, siteName, content) {
     try {
       const versionsDir = path.join(baseDir, 'sites-versions');
       const siteVersionsDir = path.join(versionsDir, siteName);
       
       await fs.mkdir(versionsDir, { recursive: true });
       await fs.mkdir(siteVersionsDir, { recursive: true });
       
       const timestamp = generateTimestamp();
       const backupFilename = `${timestamp}.html`;
       const backupPath = path.join(siteVersionsDir, backupFilename);
       
       await fs.writeFile(backupPath, content, 'utf8');
       console.log(`Backup created: sites-versions/${siteName}/${backupFilename}`);
     } catch (error) {
       console.error(`Warning: Failed to create backup for ${siteName}:`, error.message);
     }
   }

   // Start Express server
   function startServer(baseDir, port = 4321) {
     return new Promise((resolve, reject) => {
       if (server) {
         return reject(new Error('Server is already running'));
       }

       currentBaseDir = baseDir;
       currentPort = port;
       app = express();

       // Cookie options for local development
       const cookieOptions = {
         httpOnly: false,
         secure: false,
         sameSite: 'lax'
       };

       // Set admin and login cookies
       app.use((req, res, next) => {
         res.cookie('isAdminOfCurrentResource', 'true', cookieOptions);
         res.cookie('isLoggedIn', 'true', cookieOptions);
         next();
       });

       // Parse plain text body for save route
       app.use('/save/:name', express.text({ type: 'text/plain', limit: '10mb' }));

       // POST route to save/overwrite HTML files
       app.post('/save/:name', async (req, res) => {
         const { name } = req.params;
         const content = req.body;

         const safeNameRegex = /^[a-zA-Z0-9_-]+$/;
         if (!safeNameRegex.test(name)) {
           return res.status(400).json({
             msg: 'Invalid characters in filename. Only alphanumeric, underscores, and hyphens are allowed.',
             msgType: 'error'
           });
         }

         const filename = `${name}.html`;
         const filePath = path.join(baseDir, filename);

         // Security check
         const resolvedPath = path.resolve(filePath);
         const resolvedBaseDir = path.resolve(baseDir);
         
         if (!resolvedPath.startsWith(resolvedBaseDir + path.sep) || path.dirname(resolvedPath) !== resolvedBaseDir) {
           console.error(`Security Alert: Attempt to save outside base directory blocked for "${name}"`);
           return res.status(400).json({
             msg: 'Invalid file path. Saving is only allowed in the base directory.',
             msgType: 'error'
           });
         }

         if (typeof content !== 'string') {
           return res.status(400).json({
             msg: 'Invalid request body. Plain text HTML content expected.',
             msgType: 'error'
           });
         }

         try {
           await createBackup(baseDir, name, content);
           await fs.writeFile(filePath, content, 'utf8');
           res.status(200).json({
             msg: `File ${filename} saved successfully.`,
             msgType: 'success'
           });
           console.log(`Saved: ${filename}`);
         } catch (error) {
           console.error(`Error saving file ${filename}:`, error);
           res.status(500).json({
             msg: `Server error saving file: ${error.message}`,
             msgType: 'error'
           });
         }
       });

       // Set currentResource cookie
       app.use((req, res, next) => {
         const urlPath = req.path;
         let appName = null;
         
         if (urlPath === '/') {
           appName = 'index';
         } else {
           const cleanPath = urlPath.substring(1);
           if (cleanPath.endsWith('.html')) {
             appName = cleanPath.slice(0, -5);
           } else if (!cleanPath.includes('.')) {
             appName = cleanPath;
           }
         }
         
         if (appName) {
           res.cookie('currentResource', appName, cookieOptions);
         }
         
         next();
       });

       // Static file serving
       app.use((req, res, next) => {
         const urlPath = req.path;
         const requestedPath = urlPath === '/' ? 'index.html' : urlPath.substring(1);
         const filePath = path.join(baseDir, requestedPath);

         const resolvedPath = path.resolve(filePath);
         const resolvedBaseDir = path.resolve(baseDir);
         
         if (!resolvedPath.startsWith(resolvedBaseDir)) {
           return res.status(403).send('Access denied');
         }

         fs.stat(resolvedPath)
           .then(stats => {
             if (stats.isDirectory()) {
               const indexPath = path.join(resolvedPath, 'index.html');
               return fs.stat(indexPath)
                 .then(() => res.sendFile(indexPath))
                 .catch(() => serveDirListing(res, resolvedPath, baseDir));
             } else {
               res.sendFile(resolvedPath);
             }
           })
           .catch(() => {
             if (!requestedPath.endsWith('.html') && requestedPath !== 'index.html') {
               const htmlPath = path.join(baseDir, requestedPath + '.html');
               return fs.stat(htmlPath)
                 .then(() => res.sendFile(htmlPath))
                 .catch(() => {
                   if (requestedPath === 'index.html') {
                     serveDirListing(res, baseDir, baseDir);
                   } else {
                     res.status(404).send('File not found');
                   }
                 });
             } else if (requestedPath === 'index.html') {
               serveDirListing(res, baseDir, baseDir);
             } else {
               res.status(404).send('File not found');
             }
           });
       });

       // Start server
       server = app.listen(port, 'localhost', (err) => {
         if (err) {
           server = null;
           return reject(err);
         }
         console.log(`Hyperclay Local Server running on http://localhost:${port}`);
         console.log(`Serving files from: ${baseDir}`);
         
         // Notify main app
         sendMessage('serverStateChanged', {
           serverRunning: true,
           serverPort: port
         });
         
         resolve();
       });

       // Track connections
       server.on('connection', (connection) => {
         connections.add(connection);
         connection.on('close', () => {
           connections.delete(connection);
         });
       });

       server.on('error', (err) => {
         server = null;
         connections.clear();
         sendMessage('serverStateChanged', {
           serverRunning: false
         });
         reject(err);
       });
     });
   }

   // Stop server
   function stopServer() {
     return new Promise((resolve) => {
       if (server) {
         console.log('Stopping server...');
         
         for (const connection of connections) {
           connection.destroy();
         }
         connections.clear();
         
         server.close(() => {
           server = null;
           app = null;
           console.log('Server stopped');
           
           sendMessage('serverStateChanged', {
             serverRunning: false
           });
           
           resolve();
         });
         
         if (server.closeAllConnections) {
           server.closeAllConnections();
         }
       } else {
         resolve();
       }
     });
   }

   // Directory listing function
   async function serveDirListing(res, dirPath, baseDir) {
     try {
       const entries = await fs.readdir(dirPath, { withFileTypes: true });
       const relPath = path.relative(baseDir, dirPath);
       const displayPath = relPath === '' ? '' : relPath;

       res.setHeader('Content-Type', 'text/html');
       
       let html = `<!DOCTYPE html>
   <html>
   <head>
       <title>📁 Directory: /${displayPath}</title>
       <style>
           body { 
               font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
               margin: 40px; 
               background: #f5f5f5; 
           }
           .container { 
               background: white; 
               padding: 30px; 
               border-radius: 8px; 
               box-shadow: 0 2px 10px rgba(0,0,0,0.1); 
           }
           h1 { 
               color: #333; 
               border-bottom: 2px solid #eee; 
               padding-bottom: 10px; 
           }
           .file-list { 
               list-style: none; 
               padding: 0; 
           }
           .file-item { 
               padding: 8px 0; 
               border-bottom: 1px solid #eee; 
           }
           .file-item:hover { 
               background: #f9f9f9; 
               margin: 0 -10px; 
               padding-left: 10px; 
               padding-right: 10px; 
           }
           .file-link { 
               text-decoration: none; 
               color: #0066cc; 
               display: flex; 
               align-items: center; 
           }
           .file-link:hover { 
               text-decoration: underline; 
           }
           .icon { 
               margin-right: 10px; 
               font-size: 16px; 
           }
           .html-file { 
               color: #ff6b35; 
           }
           .directory { 
               color: #4a90e2; 
               font-weight: 500; 
           }
           .back-link { 
               color: #666; 
               margin-bottom: 20px; 
               display: inline-block; 
           }
       </style>
   </head>
   <body>
       <div class="container">
           <h1>📁 Directory: /${displayPath}</h1>`;

       if (displayPath !== '') {
         const parentPath = path.dirname('/' + displayPath);
         const backPath = parentPath === '/.' ? '/' : parentPath;
         html += `<a href="${backPath}" class="back-link">⬆️ Back to parent directory</a>`;
       }

       html += '<ul class="file-list">';

       const dirs = entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.'));
       const files = entries.filter(entry => entry.isFile() && !entry.name.startsWith('.'));

       for (const entry of dirs) {
         const entryPath = displayPath ? `${displayPath}/${entry.name}` : entry.name;
         html += `<li class="file-item">
           <a href="/${entryPath}" class="file-link directory">
             <span class="icon">📁</span>${entry.name}/
           </a>
         </li>`;
       }

       for (const entry of files) {
         const entryPath = displayPath ? `${displayPath}/${entry.name}` : entry.name;
         const icon = entry.name.endsWith('.html') ? '🌐' : '📄';
         const className = entry.name.endsWith('.html') ? 'html-file' : '';
         
         html += `<li class="file-item">
           <a href="/${entryPath}" class="file-link ${className}">
             <span class="icon">${icon}</span>${entry.name}
           </a>
         </li>`;
       }

       html += `</ul>
       </div>
   </body>
   </html>`;

       res.send(html);
     } catch (error) {
       res.status(500).send('Error reading directory');
     }
   }

   // Handle extension messages
   process.stdin.on('data', (data) => {
     try {
       const message = JSON.parse(data.toString());
       
       switch (message.method) {
         case 'startServer':
           startServer(message.data.baseDir, message.data.port)
             .then(() => {
               process.stdout.write(JSON.stringify({
                 id: message.id,
                 data: { success: true }
               }) + '\n');
             })
             .catch((error) => {
               process.stdout.write(JSON.stringify({
                 id: message.id,
                 error: error.message
               }) + '\n');
             });
           break;
           
         case 'stopServer':
           stopServer()
             .then(() => {
               process.stdout.write(JSON.stringify({
                 id: message.id,
                 data: { success: true }
               }) + '\n');
             })
             .catch((error) => {
               process.stdout.write(JSON.stringify({
                 id: message.id,
                 error: error.message
               }) + '\n');
             });
           break;
           
         case 'getStatus':
           process.stdout.write(JSON.stringify({
             id: message.id,
             data: {
               running: server !== null,
               port: currentPort,
               baseDir: currentBaseDir
             }
           }) + '\n');
           break;
       }
     } catch (error) {
       console.error('Error processing message:', error);
     }
   });

   // Cleanup on exit
   process.on('SIGINT', () => {
     stopServer().then(() => {
       process.exit(0);
     });
   });

   process.on('SIGTERM', () => {
     stopServer().then(() => {
       process.exit(0);
     });
   });

   console.log('Server extension started');
   ```

---

## Phase 4: Native Features Implementation (Days 8-10)

### Step 4.1: System Tray Implementation
**Time: 90 minutes**

1. **Create src/tray-manager.js**
   ```javascript
   import { os, events } from '@neutralinojs/lib';

   class TrayManager {
     constructor(api) {
       this.api = api;
       this.isInitialized = false;
       this.initializeTray();
       this.setupEventListeners();
     }

     async initializeTray() {
       try {
         await os.setTray({
           icon: '/resources/icons/appIcon.png',
           menuItems: [
             { id: 'SHOW', text: 'Show App' },
             { id: 'START_SERVER', text: 'Start Server' },
             { id: 'STOP_SERVER', text: 'Stop Server' },
             { id: 'SEP1', text: '-' },
             { id: 'QUIT', text: 'Quit' }
           ]
         });
         this.isInitialized = true;
         console.log('System tray initialized');
       } catch (error) {
         console.error('Failed to initialize system tray:', error);
       }
     }

     setupEventListeners() {
       events.on('trayMenuItemClicked', async (evt) => {
         const { id } = evt.detail;
         
         try {
           switch (id) {
             case 'SHOW':
               await this.showApp();
               break;
             case 'START_SERVER':
               await this.api.startServer();
               break;
             case 'STOP_SERVER':
               await this.api.stopServer();
               break;
             case 'QUIT':
               await this.quitApp();
               break;
           }
         } catch (error) {
           console.error('Tray menu action failed:', error);
         }
       });

       // Update tray menu when server state changes
       this.api.onStateUpdate((state) => {
         this.updateTrayMenu(state.serverRunning);
       });
     }

     async updateTrayMenu(serverRunning) {
       if (!this.isInitialized) return;

       try {
         await os.setTray({
           icon: '/resources/icons/appIcon.png',
           menuItems: [
             { id: 'SHOW', text: 'Show App' },
             { 
               id: serverRunning ? 'STOP_SERVER' : 'START_SERVER', 
               text: serverRunning ? 'Stop Server' : 'Start Server' 
             },
             { id: 'SEP1', text: '-' },
             { id: 'QUIT', text: 'Quit' }
           ]
         });
       } catch (error) {
         console.error('Failed to update tray menu:', error);
       }
     }

     async showApp() {
       try {
         const { window } = await import('@neutralinojs/lib');
         await window.show();
         await window.focus();
       } catch (error) {
         console.error('Failed to show app:', error);
       }
     }

     async quitApp() {
       try {
         // Stop server before quitting
         if (this.api.state.serverRunning) {
           await this.api.stopServer();
         }
         
         const { app } = await import('@neutralinojs/lib');
         await app.exit();
       } catch (error) {
         console.error('Failed to quit app:', error);
       }
     }
   }

   export default TrayManager;
   ```

### Step 4.2: Application Menu Implementation
**Time: 2 hours**

1. **Create src/menu-manager.js**
   ```javascript
   import { os, events } from '@neutralinojs/lib';

   class MenuManager {
     constructor(api) {
       this.api = api;
       this.setupMenu();
       this.setupEventListeners();
     }

     async setupMenu() {
       try {
         const menuTemplate = [
           {
             id: 'FILE',
             text: 'File',
             items: [
               { id: 'SELECT_FOLDER', text: 'Select Folder...', hotkey: 'CmdOrCtrl+O' },
               { id: 'SEP1', text: '-' },
               { id: 'START_SERVER', text: 'Start Server', hotkey: 'CmdOrCtrl+R' },
               { id: 'STOP_SERVER', text: 'Stop Server', hotkey: 'CmdOrCtrl+S' },
               { id: 'SEP2', text: '-' },
               { id: 'CLOSE', text: 'Close', hotkey: 'CmdOrCtrl+W' }
             ]
           },
           {
             id: 'EDIT',
             text: 'Edit',
             items: [
               { id: 'UNDO', text: 'Undo', hotkey: 'CmdOrCtrl+Z' },
               { id: 'REDO', text: 'Redo', hotkey: 'CmdOrCtrl+Shift+Z' },
               { id: 'SEP3', text: '-' },
               { id: 'CUT', text: 'Cut', hotkey: 'CmdOrCtrl+X' },
               { id: 'COPY', text: 'Copy', hotkey: 'CmdOrCtrl+C' },
               { id: 'PASTE', text: 'Paste', hotkey: 'CmdOrCtrl+V' },
               { id: 'SELECT_ALL', text: 'Select All', hotkey: 'CmdOrCtrl+A' }
             ]
           },
           {
             id: 'VIEW',
             text: 'View',
             items: [
               { id: 'RELOAD', text: 'Reload', hotkey: 'F5' },
               { id: 'FORCE_RELOAD', text: 'Force Reload', hotkey: 'CmdOrCtrl+F5' },
               { id: 'DEV_TOOLS', text: 'Developer Tools', hotkey: 'F12' },
               { id: 'SEP4', text: '-' },
               { id: 'ZOOM_IN', text: 'Zoom In', hotkey: 'CmdOrCtrl+Plus' },
               { id: 'ZOOM_OUT', text: 'Zoom Out', hotkey: 'CmdOrCtrl+-' },
               { id: 'ZOOM_RESET', text: 'Actual Size', hotkey: 'CmdOrCtrl+0' },
               { id: 'SEP5', text: '-' },
               { id: 'FULLSCREEN', text: 'Toggle Fullscreen', hotkey: 'F11' }
             ]
           },
           {
             id: 'HELP',
             text: 'Help',
             items: [
               { id: 'ABOUT', text: 'About Hyperclay Local' },
               { id: 'VISIT_SITE', text: 'Visit Hyperclay.com' }
             ]
           }
         ];

         await os.setWindowMenu(menuTemplate);
         console.log('Application menu initialized');
       } catch (error) {
         console.error('Failed to setup menu:', error);
       }
     }

     setupEventListeners() {
       events.on('windowMenuItemClicked', async (evt) => {
         const { id } = evt.detail;
         
         try {
           switch (id) {
             case 'SELECT_FOLDER':
               await this.api.selectFolder();
               break;
             case 'START_SERVER':
               await this.api.startServer();
               break;
             case 'STOP_SERVER':
               await this.api.stopServer();
               break;
             case 'CLOSE':
               await this.closeWindow();
               break;
             case 'UNDO':
               document.execCommand('undo');
               break;
             case 'REDO':
               document.execCommand('redo');
               break;
             case 'CUT':
               document.execCommand('cut');
               break;
             case 'COPY':
               document.execCommand('copy');
               break;
             case 'PASTE':
               document.execCommand('paste');
               break;
             case 'SELECT_ALL':
               document.execCommand('selectAll');
               break;
             case 'RELOAD':
               location.reload();
               break;
             case 'FORCE_RELOAD':
               location.reload(true);
               break;
             case 'DEV_TOOLS':
               await this.toggleDevTools();
               break;
             case 'ZOOM_IN':
               await this.zoomIn();
               break;
             case 'ZOOM_OUT':
               await this.zoomOut();
               break;
             case 'ZOOM_RESET':
               await this.zoomReset();
               break;
             case 'FULLSCREEN':
               await this.toggleFullscreen();
               break;
             case 'ABOUT':
               await this.showAbout();
               break;
             case 'VISIT_SITE':
               await os.open('https://hyperclay.com');
               break;
           }
         } catch (error) {
           console.error('Menu action failed:', error);
         }
       });
     }

     async closeWindow() {
       const { window } = await import('@neutralinojs/lib');
       await window.hide();
     }

     async toggleDevTools() {
       try {
         const { debug } = await import('@neutralinojs/lib');
         await debug.log('DevTools toggle requested');
       } catch (error) {
         console.error('DevTools not available:', error);
       }
     }

     async zoomIn() {
       document.body.style.zoom = (parseFloat(document.body.style.zoom || 1) + 0.1).toString();
     }

     async zoomOut() {
       document.body.style.zoom = Math.max(0.5, parseFloat(document.body.style.zoom || 1) - 0.1).toString();
     }

     async zoomReset() {
       document.body.style.zoom = '1';
     }

     async toggleFullscreen() {
       try {
         const { window } = await import('@neutralinojs/lib');
         await window.toggleFullScreen();
       } catch (error) {
         console.error('Fullscreen toggle failed:', error);
       }
     }

     async showAbout() {
       await os.showMessageBox(
         'About Hyperclay Local',
         'Hyperclay Local Server v1.0.0\n\nA local server for running your Hyperclay HTML apps offline.\n\nMade with ❤️ for the Hyperclay platform.',
         'INFO'
       );
     }
   }

   export default MenuManager;
   ```

### Step 4.3: Context Menu Implementation
**Time: 45 minutes**

1. **Create src/context-menu.js**
   ```javascript
   class ContextMenuManager {
     constructor() {
       this.setupContextMenu();
     }

     setupContextMenu() {
       document.addEventListener('contextmenu', (event) => {
         event.preventDefault();
         this.showContextMenu(event);
       });
     }

     showContextMenu(event) {
       const target = event.target;
       const isEditable = target.isContentEditable || 
                         target.tagName === 'INPUT' || 
                         target.tagName === 'TEXTAREA';
       const hasSelection = window.getSelection().toString().length > 0;
       
       // Create context menu items based on context
       const menuItems = [];
       
       if (hasSelection) {
         menuItems.push({
           label: 'Copy',
           action: () => document.execCommand('copy')
         });
       }
       
       if (isEditable) {
         if (hasSelection) {
           menuItems.push({
             label: 'Cut',
             action: () => document.execCommand('cut')
           });
         }
         
         menuItems.push({
           label: 'Paste',
           action: () => document.execCommand('paste')
         });
         
         if (menuItems.length > 0) {
           menuItems.push({ label: '-' }); // Separator
         }
         
         menuItems.push({
           label: 'Select All',
           action: () => document.execCommand('selectAll')
         });
       }
       
       if (menuItems.length === 0) return; // No menu items to show
       
       this.createContextMenu(event.clientX, event.clientY, menuItems);
     }

     createContextMenu(x, y, items) {
       // Remove existing context menu
       const existingMenu = document.getElementById('custom-context-menu');
       if (existingMenu) {
         existingMenu.remove();
       }
       
       const menu = document.createElement('div');
       menu.id = 'custom-context-menu';
       menu.style.cssText = `
         position: fixed;
         top: ${y}px;
         left: ${x}px;
         background: #fff;
         border: 1px solid #ccc;
         border-radius: 4px;
         box-shadow: 0 2px 10px rgba(0,0,0,0.2);
         z-index: 10000;
         min-width: 150px;
         font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         font-size: 14px;
       `;
       
       items.forEach(item => {
         if (item.label === '-') {
           const separator = document.createElement('hr');
           separator.style.cssText = 'margin: 4px 0; border: none; border-top: 1px solid #eee;';
           menu.appendChild(separator);
         } else {
           const menuItem = document.createElement('div');
           menuItem.textContent = item.label;
           menuItem.style.cssText = `
             padding: 8px 16px;
             cursor: pointer;
             border-radius: 4px;
             margin: 2px;
           `;
           
           menuItem.addEventListener('mouseenter', () => {
             menuItem.style.background = '#e6f3ff';
           });
           
           menuItem.addEventListener('mouseleave', () => {
             menuItem.style.background = 'transparent';
           });
           
           menuItem.addEventListener('click', () => {
             item.action();
             menu.remove();
           });
           
           menu.appendChild(menuItem);
         }
       });
       
       document.body.appendChild(menu);
       
       // Remove menu when clicking elsewhere
       const removeMenu = (e) => {
         if (!menu.contains(e.target)) {
           menu.remove();
           document.removeEventListener('click', removeMenu);
         }
       };
       
       setTimeout(() => {
         document.addEventListener('click', removeMenu);
       }, 10);
     }
   }

   export default ContextMenuManager;
   ```

### Step 4.4: Update Main Application
**Time: 30 minutes**

1. **Update src/neutralino-api.js to include managers**
   ```javascript
   // Add these imports at the top
   import TrayManager from './tray-manager.js';
   import MenuManager from './menu-manager.js';
   import ContextMenuManager from './context-menu.js';

   // Add to the NeutralinoAPI constructor
   constructor() {
     // ... existing code ...
     
     // Initialize managers after Neutralino is ready
     this.initializeManagers();
   }

   async initializeManagers() {
     try {
       // Wait for Neutralino to be ready
       await new Promise(resolve => {
         if (window.NL_OS) {
           resolve();
         } else {
           window.addEventListener('neutralinoReady', resolve);
         }
       });
       
       // Initialize managers
       this.trayManager = new TrayManager(this);
       this.menuManager = new MenuManager(this);
       this.contextMenuManager = new ContextMenuManager();
       
       console.log('All managers initialized');
     } catch (error) {
       console.error('Failed to initialize managers:', error);
     }
   }
   ```

---

## Phase 5: Testing and Optimization (Days 11-12)

### Step 5.1: Build and Test Basic Functionality
**Time: 2 hours**

1. **Build the application**
   ```bash
   npm run build
   ```

2. **Test the application**
   ```bash
   neu run
   ```

3. **Test checklist:**
   - [ ] App starts without errors
   - [ ] UI renders correctly
   - [ ] Folder selection works
   - [ ] Server starts and stops
   - [ ] Browser opens automatically
   - [ ] File serving works correctly
   - [ ] System tray appears and functions
   - [ ] Application menu works
   - [ ] Context menus appear
   - [ ] Keyboard shortcuts work

### Step 5.2: Cross-Platform Build Testing
**Time: 90 minutes**

1. **Build for all platforms**
   ```bash
   # Build for current platform
   neu build --release

   # Build for all platforms (if supported)
   neu build --release --target linux
   neu build --release --target mac  
   neu build --release --target win
   ```

2. **Platform-specific testing:**
   - **Windows**: Test NSIS installer, system tray, native dialogs
   - **macOS**: Test DMG creation, dock integration, app menu
   - **Linux**: Test AppImage functionality, desktop integration

### Step 5.3: Performance Optimization
**Time: 60 minutes**

1. **Optimize bundle size**
   ```javascript
   // Update webpack.config.js for production
   module.exports = (env, argv) => {
     const isProduction = argv.mode === 'production';
     
     return {
       // ... existing config ...
       
       optimization: isProduction ? {
         minimize: true,
         sideEffects: false,
         usedExports: true
       } : {},
       
       resolve: {
         alias: isProduction ? {
           'react': 'react/cjs/react.production.min.js',
           'react-dom': 'react-dom/cjs/react-dom.production.min.js'
         } : {}
       }
     };
   };
   ```

2. **Test memory usage and startup time**

### Step 5.4: Error Handling and Edge Cases
**Time: 90 minutes**

1. **Add comprehensive error handling**
2. **Test edge cases:**
   - Invalid folder selection
   - Port conflicts
   - Permission errors
   - Network issues
   - Extension crashes

---

## Phase 6: Documentation and Deployment (Days 13-14)

### Step 6.1: Update Documentation
**Time: 60 minutes**

1. **Update README.md with NeutralinoJS instructions**
2. **Create migration notes**
3. **Update troubleshooting guide**

### Step 6.2: Distribution Setup
**Time: 2 hours**

1. **Configure distribution packages**
2. **Set up auto-updater (if needed)**
3. **Create installation scripts**
4. **Test final packages**

---

## Common Issues and Solutions

### Issue 1: Extension Communication Problems
**Symptoms**: Server doesn't start, no response from extension
**Solution**: 
- Check extension process is running
- Verify JSON message format
- Add logging to extension main.js

### Issue 2: File System Permission Errors
**Symptoms**: Cannot read/write files, folder selection fails
**Solution**:
- Update neutralino.config.json permissions
- Check nativeAllowList configuration
- Handle permission errors gracefully

### Issue 3: System Tray Not Appearing
**Symptoms**: No tray icon visible
**Solution**:
- Check icon file path and format
- Verify tray API permissions
- Add fallback for unsupported platforms

### Issue 4: Menu Items Not Working
**Symptoms**: Menu clicks don't trigger actions
**Solution**:
- Verify event listener setup
- Check menu item IDs match
- Add error handling for menu actions

---

## Success Criteria

By the end of this implementation, you should have:

✅ **Functional Equivalence**: All Electron features working in NeutralinoJS  
✅ **Size Reduction**: 85% smaller bundle size  
✅ **Performance Improvement**: Faster startup and lower memory usage  
✅ **Cross-Platform Support**: Working on Windows, macOS, and Linux  
✅ **Professional Polish**: System tray, native menus, proper error handling  

## Next Steps After Completion

1. **User Testing**: Get feedback from beta users
2. **Performance Monitoring**: Track real-world performance metrics
3. **Feature Parity**: Ensure no Electron features were missed
4. **Documentation**: Create user guides and developer documentation
5. **Distribution**: Set up automated builds and releases

This plan provides a complete roadmap for migrating from Electron to NeutralinoJS while maintaining all functionality and significantly improving the application's size and performance characteristics.