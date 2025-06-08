# Hyperclay Local Server (Electron App)

A beautiful, cross-platform desktop application for running your Hyperclay HTML apps locally with zero configuration.

## ✨ Features

- 🖥️ **Native desktop app** - Familiar GUI interface
- 📁 **Visual folder selection** - Point and click to choose your apps folder
- 🚀 **One-click server start** - Start/stop server with buttons
- 🌐 **Auto-browser opening** - Automatically opens your default browser
- 📊 **Real-time status** - Visual indicators for server state
- 🔔 **System tray integration** - Runs in background, accessible from tray
- 🎨 **Beautiful UI** - Modern, responsive interface
- 🔗 **Quick links** - Easy access to Hyperclay.com and docs
- ⚡ **Cross-platform** - Works on macOS, Windows, and Linux

## 🚀 Quick Start

### For Users (Download Pre-built App)

1. **Download** the app for your platform:
   - **macOS**: `Hyperclay-Local-1.0.0.dmg`
   - **Windows**: `Hyperclay-Local-Setup-1.0.0.exe`
   - **Linux**: `Hyperclay-Local-1.0.0.AppImage`

2. **Install** and run the app

3. **Select your folder** containing HTML apps

4. **Click "Start Server"** 

5. **Browser opens** automatically to your apps!

### For Developers (Build from Source)

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for all platforms
npm run build-all

# Build for specific platform
npm run build-mac     # macOS
npm run build-windows # Windows  
npm run build-linux   # Linux
```

## 🎯 User Interface

### Main Window
- **Header**: Shows app name and server status indicator
- **Folder Selection**: Visual folder picker with current selection display
- **Server Controls**: Start/stop buttons and browser launcher
- **Server Info**: Shows URL and folder path when running
- **Instructions**: Step-by-step usage guide
- **Quick Links**: Links to Hyperclay.com and documentation

### System Tray
- **Status indicator**: Green (running) / Red (stopped)
- **Quick actions**: Start/stop server, show/hide window
- **Background operation**: App continues running when window closed

### Keyboard Shortcuts
- `Cmd/Ctrl + O`: Select folder
- `Cmd/Ctrl + R`: Start server
- `Cmd/Ctrl + S`: Stop server
- `Cmd/Ctrl + W`: Close window (app stays in tray)
- `Cmd/Ctrl + Q`: Quit app (macOS only)

## 🔧 How It Works

### Server Integration
The app runs an embedded Express.js server (same as the Node.js version) with:
- Static file serving with extensionless HTML support
- POST `/save/:name` endpoint for app self-saving
- Beautiful directory listings
- Security protections (path traversal, filename validation)

### File Management
- **Folder Selection**: Native OS folder picker dialog
- **Path Security**: Ensures all files served are within selected folder
- **File Types**: Serves all file types, special handling for HTML
- **Hidden Files**: Automatically hides dotfiles and system files

### Browser Integration
- **Auto-launch**: Opens default browser when server starts
- **URL copying**: One-click copy of server URL
- **External links**: Opens external links in default browser

## 🛡️ Security Features

- **Sandboxed renderer**: Web content runs in isolated context
- **IPC security**: Secure communication between main and renderer processes
- **Path validation**: Prevents access to files outside selected folder
- **Filename sanitization**: Only allows safe characters in saved files
- **Content validation**: Validates file content before saving

## 📁 Project Structure

```
electron/
├── main.js              # Main Electron process
├── server.js            # Express server implementation  
├── preload.js           # Secure IPC bridge
├── renderer.html        # Main UI
├── renderer.css         # UI styling
├── package.json         # Dependencies and build config
├── assets/              # App icons and images
└── dist/               # Built applications (after build)
```

## 🔧 Development

### Prerequisites
- Node.js 16+ 
- npm or yarn

### Setup
```bash
# Install dependencies
npm install

# Run in development mode (with hot reload)
npm run dev

# Build for current platform
npm run build

# Build for all platforms
npm run build-all
```

### Development Mode Features
- **Hot reload**: Automatically restarts on file changes
- **Developer tools**: Press F12 to open DevTools
- **Debugging**: Full Chrome DevTools available

## 📦 Building & Distribution

### Build Configuration
The app uses `electron-builder` for packaging with these outputs:

**macOS**:
- `.dmg` installer with drag-to-Applications
- Universal binary (Intel + Apple Silicon)
- Code signing ready

**Windows**:
- NSIS installer with custom install directory option
- Auto-updater support
- Windows Store ready

**Linux**:
- AppImage (portable, runs anywhere)
- Debian/Ubuntu packages available
- Snap package support

### Build Commands
```bash
# Development build (current platform)
npm run build

# Production builds
npm run build-mac      # macOS DMG
npm run build-windows  # Windows installer
npm run build-linux    # Linux AppImage
npm run build-all      # All platforms
```

### Distribution Size
- **macOS**: ~150MB DMG
- **Windows**: ~100MB installer  
- **Linux**: ~120MB AppImage

## 🆚 vs Other Versions

| Feature | Electron App | Go Binary | Node.js |
|---------|--------------|-----------|---------|
| **User Interface** | ✅ Beautiful GUI | ❌ Terminal only | ❌ Terminal only |
| **Setup** | ✅ Install & run | ✅ Drop & run | ❌ npm install |
| **Folder selection** | ✅ Visual picker | ❌ Must be in folder | ❌ Must be in folder |
| **Status indicators** | ✅ Real-time UI | ❌ Terminal output | ❌ Terminal output |
| **System tray** | ✅ Background running | ❌ No | ❌ No |
| **Auto-updates** | ✅ Built-in support | ❌ Manual download | ❌ Manual update |
| **File size** | ~150MB | ~5MB | Node.js + modules |
| **Startup time** | ~2-3 seconds | Instant | ~1-2 seconds |

## 🚨 Troubleshooting

### Installation Issues

**macOS "App is damaged" error**:
```bash
xattr -cr "/Applications/Hyperclay Local.app"
```

**Windows SmartScreen warning**:
- Click "More info" → "Run anyway"
- This happens because the app isn't code-signed

**Linux permission denied**:
```bash
chmod +x Hyperclay-Local-1.0.0.AppImage
```

### Runtime Issues

**Port 4321 already in use**:
- The app will show an error dialog
- Kill any existing process using the port
- Or wait for the existing process to terminate

**Folder selection not working**:
- Ensure you have read permissions for the folder
- Try selecting a different folder
- Restart the app if the dialog doesn't appear

**Server won't start**:
- Check the folder contains some files
- Ensure folder path doesn't contain special characters
- Try selecting the folder again

**Apps won't save**:
- Check browser console for error messages
- Ensure the app is making requests to `localhost:4321`
- Verify the save endpoint is working by testing manually

### Performance Issues

**App feels slow**:
- This is normal for Electron apps
- Close other resource-intensive applications
- Consider using the Go binary for better performance

**High memory usage**:
- Electron apps use more memory than native apps
- ~100-200MB usage is normal
- Restart the app if memory usage grows excessively

## 🔮 Future Enhancements

Planned features for future versions:

- **Auto-updater**: Automatic app updates
- **Multiple servers**: Run multiple folders simultaneously  
- **Custom ports**: Configure server port in settings
- **HTTPS support**: Local SSL certificates
- **File watcher**: Auto-refresh browser on file changes
- **Themes**: Dark mode and custom themes
- **Plugin system**: Extend functionality with plugins

## 🤝 Contributing

Contributions welcome! Areas that need help:

- **UI/UX improvements**: Better design and user experience
- **Performance optimization**: Reduce app size and memory usage
- **Cross-platform testing**: Ensure consistent behavior
- **Documentation**: Improve guides and troubleshooting
- **Feature requests**: Suggest and implement new features

---

**Made with ❤️ for Hyperclay** - The platform for malleable HTML applications  
Get the full experience at [hyperclay.com](https://hyperclay.com)