# Hyperclay Local Server (Electron App)

A beautiful, cross-platform desktop application for running your malleable HTML files locally with zero configuration.

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

## What is Hyperclay?

Hyperclay lets you create **malleable HTML files** - powerful, self-contained files that you fully own and control. Think of it as combining the simplicity of Google Docs with the power of custom web applications.

### The Big Idea
- **Own Your Stack**: No vendor lock-in. Download your apps and run them anywhere.
- **Malleable**: Your HTML files can modify themselves and save changes instantly.
- **Shareable**: Send a link, and others can view or clone your app with one click.
- **Future-Proof**: Built on standard HTML/CSS/JavaScript - no proprietary frameworks.

### How Hyperclay Apps Work

#### Malleable HTML Files
Your malleable HTML files can edit themselves in real-time. Change text, add features, modify layouts - everything saves automatically and becomes part of the app. Each app is a complete HTML document that includes:
- Your content and data
- Styling (CSS) 
- Behavior (JavaScript)
- File references
- Version metadata

#### Edit Mode
Toggle edit mode by adding `?editmode=true` to any app URL or clicking the edit button. In edit mode:
- Click any text to edit it inline
- Add new elements and components
- Upload files and images
- Customize styling and behavior
- Save changes instantly with Ctrl+S

#### Examples You Can Build
- **📝 Writer**: Personal writing app with auto-save, word count, and export options
- **📋 Kanban Board**: Visual project management with drag-and-drop cards and columns
- **🛠️ Development Log**: Track coding projects, bugs, features, and progress over time
- **🏠 Landing Pages**: Beautiful pages for projects, products, or personal sites
- **🎯 Custom Apps**: Calculators, games, portfolios, databases, dashboards - anything you can imagine

### Why Use This Local Server?

While [hyperclay.com](https://hyperclay.com) provides the full hosted experience with user accounts, version history, and collaboration features, this local server lets you:

- ✅ **Work offline** - Edit your apps without internet connection
- ✅ **Own your data** - Complete independence from any platform
- ✅ **No subscription needed** - Run unlimited apps locally for free
- ✅ **Privacy first** - Your apps and data never leave your computer
- ✅ **Future-proof** - Apps work forever, regardless of service status

This local server provides the core functionality needed to run and edit your Hyperclay apps, ensuring you're never locked into any platform while still benefiting from the powerful malleable HTML concept.

## 🚀 Quick Start

### Download Pre-built App

1. **Download** the app for your platform:
   - **macOS (Apple Silicon)**: [HyperclayLocal-1.11.0-arm64.dmg](https://local.hyperclay.com/HyperclayLocal-1.11.0-arm64.dmg) (100.8MB)
   - **macOS (Intel)**: [HyperclayLocal-1.11.0.dmg](https://local.hyperclay.com/HyperclayLocal-1.11.0.dmg) (108.5MB)
   - **Windows**: [HyperclayLocal-Setup-1.11.0.exe](https://local.hyperclay.com/HyperclayLocal-Setup-1.11.0.exe) (~81.3MB)
   - **Linux**: [HyperclayLocal-1.11.0.AppImage](https://local.hyperclay.com/HyperclayLocal-1.11.0.AppImage) (119.1MB)

2. **Install** and run the app

3. **Select your folder** containing malleable HTML files

4. **Click "Start Server"**

5. **Browser opens** automatically to your apps!

### Development

```bash
npm install
npm run dev
```

For building and releasing, see [BUILD.md](./BUILD.md).

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

```bash
npm install
npm run dev
```

Development mode features:
- **Hot reload**: Automatically restarts on file changes
- **Developer tools**: Press F12 to open DevTools

For building signed installers, see [BUILD.md](./BUILD.md).

### Adding npm Modules

When adding new npm dependencies, consider whether they need `asarUnpack` in `package.json`. Electron bundles node_modules into a `.asar` archive, which can break:

- **Native bindings** (e.g., `lightningcss` in `tailwind-hyperclay`)
- **Dynamic require.resolve()** with package.json exports
- **File system operations** with hardcoded paths

If a module fails in production builds but works in development, add it to `asarUnpack`:

```json
"asarUnpack": [
  "node_modules/your-module/**"
]
```

Pure JavaScript modules (like `livesync-hyperclay`) typically work without unpacking.

## 🚨 Troubleshooting

### Installation Issues

**macOS "App is damaged" error**:
```bash
xattr -cr "/Applications/HyperclayLocal.app"
```

**Windows SmartScreen warning**:
- Click "More info" → "Run anyway"
- This happens because the app isn't code-signed

**Linux permission denied**:
```bash
chmod +x Hyperclay-Local-1.1.0.AppImage
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

**Made with ❤️ for Hyperclay** - The platform for malleable HTML files  
Get the full experience at [hyperclay.com](https://hyperclay.com)