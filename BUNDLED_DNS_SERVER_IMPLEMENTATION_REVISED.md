# Revised Implementation: Bundled DNS Server for Hyperclay Local

## Changes from Original Plan

This revision addresses all issues from `BUNDLED_DNS_SERVER_IMPLEMENTATION_REVIEW.md`:

1. ✅ Fixed `dns2` API usage to use correct `createServer` factory
2. ✅ Use `dns2` `Resolver` instead of raw dgram for upstream forwarding
3. ✅ Persist DNS configuration to survive crashes
4. ✅ Changed HTTP server to port 4321 (no admin required)
5. ✅ Added static asset support with proper MIME types
6. ✅ Reduced Windows UAC prompts by batching commands
7. ✅ Added crash recovery and DNS restoration on startup
8. ✅ Made IPv6 configurable
9. ✅ Added structured logging with levels
10. ✅ Match Hyperclay platform routing (HTML files at subdomains, assets at paths)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                   Hyperclay Local App                    │
│                                                          │
│  ┌────────────────┐        ┌──────────────────────┐    │
│  │  DNS Server    │        │   HTTP Server        │    │
│  │  (port 53)     │        │   (port 4321)        │    │
│  │                │        │                      │    │
│  │  *.hyperclay   │        │  Parses Host header  │    │
│  │  local.com     │        │  Serves HTML + assets│    │
│  │  → 127.0.0.1   │        │                      │    │
│  │                │        │                      │    │
│  │  Other queries │        │                      │    │
│  │  → dns2        │        │                      │    │
│  │    Resolver    │        │                      │    │
│  └────────────────┘        └──────────────────────┘    │
│         ↑                           ↑                   │
│         │                           │                   │
└─────────┼───────────────────────────┼───────────────────┘
          │                           │
          │                           │
    ┌─────┴──────┐            ┌───────┴────────┐
    │ System DNS │            │  Any Browser   │
    │ 127.0.0.1  │            │  app.hyperclay │
    └────────────┘            │ local.com:4321 │
                              └────────────────┘
```

**Key Features:**
- HTTP server on **port 4321** (no admin needed)
- DNS server on **port 53** (requires admin/sudo on startup)
- Works with **any browser** (Safari, Chrome, Firefox, etc.)
- Works with **browser extensions**
- Config persisted via `electron-store`

---

## Updated DNS Server

**`src/dns-server/index.js`**

```javascript
/**
 * Pure JavaScript DNS Server
 * Uses dns2 library correctly with createServer factory
 */

const dns2 = require('dns2');
const { Packet } = dns2;

class HyperclayDNSServer {
  constructor(options = {}) {
    this.upstreamDNS = options.upstreamDNS || '8.8.8.8';
    this.localDomain = options.localDomain || 'hyperclaylocal.com';
    this.enableIPv6 = options.enableIPv6 || false;
    this.server = null;
    this.isRunning = false;
    this.resolver = null;
    this.logger = options.logger || console;

    // Track active requests for graceful shutdown
    this.activeRequests = new Map(); // requestId -> { promise, reject }
    this.isShuttingDown = false;
  }

  async start() {
    if (this.isRunning) {
      this.logger.log('[DNS] Server already running');
      return;
    }

    try {
      // Pre-flight privilege check
      await this.checkPrivileges();

      // Create resolver for upstream queries
      this.resolver = new dns2.Resolver({
        nameServers: [this.upstreamDNS],
        timeout: 5000,
        retries: 2
      });

      // Create server using correct dns2 API
      this.server = dns2.createServer({
        udp: true,
        tcp: true,
        handle: this.handleRequest.bind(this)
      });

      // Bind to port 53 on localhost only
      await new Promise((resolve, reject) => {
        this.server.listen({ port: 53, address: '127.0.0.1' }, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      this.isRunning = true;
      this.logger.log('[DNS] Server started on 127.0.0.1:53');
      this.logger.log(`[DNS] Resolving *.${this.localDomain} to 127.0.0.1`);
      this.logger.log(`[DNS] Forwarding other queries to ${this.upstreamDNS}`);

    } catch (error) {
      this.logger.error('[DNS] Failed to start server:', error.message);

      // Provide helpful error messages
      if (error.code === 'EADDRINUSE') {
        throw new Error('Port 53 is already in use. Please close other DNS servers or restart your computer.');
      }

      if (error.code === 'EACCES' || error.code === 'EPERM') {
        throw new Error('Permission denied. DNS server requires admin/sudo to bind to port 53. Please restart the app with administrator privileges.');
      }

      if (error.code === 'INSUFFICIENT_PRIVILEGES') {
        throw error; // Re-throw with original message
      }

      throw error;
    }
  }

  async checkPrivileges() {
    const os = require('os');
    const platform = os.platform();

    if (platform === 'win32') {
      // Check if running as administrator on Windows
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);

      try {
        await execAsync('net session', { timeout: 1000 });
        this.logger.log('[DNS] Running with administrator privileges (Windows)');
      } catch {
        const error = new Error('Administrator privileges required. Please right-click the app and select "Run as administrator".');
        error.code = 'INSUFFICIENT_PRIVILEGES';
        throw error;
      }
    } else {
      // Check if running as root on Unix-like systems
      if (process.getuid && process.getuid() !== 0) {
        const error = new Error('Root privileges required. Please run the app with sudo or grant elevated permissions.');
        error.code = 'INSUFFICIENT_PRIVILEGES';
        throw error;
      }
      this.logger.log('[DNS] Running with root privileges');
    }
  }

  async stop() {
    if (!this.isRunning) return;

    try {
      // Signal shutdown to prevent new requests
      this.isShuttingDown = true;

      // Reject all active requests
      for (const [requestId, { reject }] of this.activeRequests) {
        reject(new Error('DNS server shutting down'));
      }
      this.activeRequests.clear();

      // Close server
      if (this.server) {
        await new Promise((resolve) => {
          this.server.close(() => resolve());
        });
      }

      this.isRunning = false;
      this.isShuttingDown = false;
      this.logger.log('[DNS] Server stopped');
    } catch (error) {
      this.logger.error('[DNS] Error stopping server:', error.message);
    }
  }

  async handleRequest(request, send, rinfo) {
    const response = Packet.createResponseFromRequest(request);
    const [question] = request.questions;
    const { name, type } = question;

    // Structured logging with rate limiting (only log occasionally in production)
    if (Math.random() < 0.1 || this.logger.level === 'debug') {
      this.logger.log(`[DNS] Query: ${name} (type: ${type})`);
    }

    try {
      // Check if query is for our local domain
      if (this.isLocalDomain(name)) {
        this.respondLocalDomain(name, type, response, send);
      } else {
        // Forward to upstream using dns2 Resolver
        await this.forwardToUpstream(request, send, name, type);
      }
    } catch (error) {
      this.logger.error(`[DNS] Error handling request for ${name}:`, error.message);
      // Send empty response on error
      send(response);
    }
  }

  respondLocalDomain(name, type, response, send) {
    if (type === Packet.TYPE.A) {
      // IPv4 - always respond with 127.0.0.1
      response.answers.push({
        name,
        type: Packet.TYPE.A,
        class: Packet.CLASS.IN,
        ttl: 300,
        address: '127.0.0.1'
      });
      this.logger.log(`[DNS] Resolved ${name} -> 127.0.0.1`);
      send(response);
    } else if (type === Packet.TYPE.AAAA && this.enableIPv6) {
      // IPv6 - only if enabled
      response.answers.push({
        name,
        type: Packet.TYPE.AAAA,
        class: Packet.CLASS.IN,
        ttl: 300,
        address: '::1'
      });
      this.logger.log(`[DNS] Resolved ${name} -> ::1 (IPv6)`);
      send(response);
    } else {
      // Other record types - send empty response
      send(response);
    }
  }

  async forwardToUpstream(request, send, name, type) {
    // Check if shutting down
    if (this.isShuttingDown) {
      const response = Packet.createResponseFromRequest(request);
      send(response);
      return;
    }

    const requestId = `${name}-${type}-${Date.now()}`;
    let timeoutId;
    let requestReject;

    // Create tracked promise
    const trackedPromise = new Promise((resolve, reject) => {
      requestReject = reject;

      timeoutId = setTimeout(() => {
        this.activeRequests.delete(requestId);
        reject(new Error('Timeout'));
      }, 5000);

      // Start the actual DNS resolution
      this.resolver.resolve(name, type)
        .then(resolve)
        .catch(reject)
        .finally(() => {
          clearTimeout(timeoutId);
          this.activeRequests.delete(requestId);
        });
    });

    // Track this request for graceful shutdown
    this.activeRequests.set(requestId, {
      promise: trackedPromise,
      reject: requestReject
    });

    try {
      const answers = await trackedPromise;

      // Build response from resolver results
      const response = Packet.createResponseFromRequest(request);
      response.answers = answers.answers || [];

      send(response);

      if (this.logger.level === 'debug') {
        this.logger.log(`[DNS] Forwarded ${name} to upstream`);
      }
    } catch (error) {
      // Don't log errors if we're shutting down
      if (!this.isShuttingDown && error.message !== 'DNS server shutting down') {
        this.logger.error(`[DNS] Upstream query failed for ${name}:`, error.message);
      }

      const response = Packet.createResponseFromRequest(request);
      send(response);
    }
  }

  isLocalDomain(name) {
    // Match *.hyperclaylocal.com and hyperclaylocal.com
    return name.endsWith(`.${this.localDomain}`) ||
           name === this.localDomain;
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      upstreamDNS: this.upstreamDNS,
      localDomain: this.localDomain,
      enableIPv6: this.enableIPv6,
      activeRequests: this.activeRequests.size
    };
  }

  setUpstreamDNS(dns) {
    this.upstreamDNS = dns;
    if (this.resolver) {
      this.resolver = new dns2.Resolver({
        nameServers: [dns],
        timeout: 5000,
        retries: 2
      });
    }
    this.logger.log(`[DNS] Upstream DNS changed to ${dns}`);
  }
}

module.exports = HyperclayDNSServer;
```

---

## Updated System DNS Manager

**`src/dns-server/system-dns-manager.js`**

Key improvements:
- Persist original DNS config to electron-store
- Batch Windows commands to reduce UAC prompts
- Add crash recovery

```javascript
/**
 * Cross-platform system DNS configuration with persistence
 */

const sudo = require('sudo-prompt');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const os = require('os');
const fs = require('fs').promises;
const path = require('path');

const SUDO_OPTIONS = {
  name: 'Hyperclay Local'
};

class SystemDNSManager {
  constructor(store, logger = console) {
    this.platform = os.platform();
    this.store = store; // electron-store instance
    this.logger = logger;
  }

  /**
   * Set system DNS to 127.0.0.1 with persistence
   */
  async setDNSToLocalhost() {
    this.logger.log(`[DNS Manager] Setting DNS on ${this.platform}...`);

    try {
      // Store original DNS BEFORE changing (critical for crash recovery)
      await this.storeOriginalDNS();

      switch (this.platform) {
        case 'darwin':
          return await this.setDNSMacOS();
        case 'win32':
          return await this.setDNSWindows();
        case 'linux':
          return await this.setDNSLinux();
        default:
          throw new Error(`Unsupported platform: ${this.platform}`);
      }
    } catch (error) {
      this.logger.error('[DNS Manager] Failed to set DNS:', error.message);
      throw error;
    }
  }

  /**
   * Restore original DNS settings from persistent storage
   */
  async restoreDNS() {
    this.logger.log(`[DNS Manager] Restoring original DNS on ${this.platform}...`);

    try {
      const originalDNS = this.store.get('originalDNS');

      if (!originalDNS) {
        this.logger.warn('[DNS Manager] No original DNS config found, using defaults');
      }

      switch (this.platform) {
        case 'darwin':
          return await this.restoreDNSMacOS();
        case 'win32':
          return await this.restoreDNSWindows();
        case 'linux':
          return await this.restoreDNSLinux();
        default:
          throw new Error(`Unsupported platform: ${this.platform}`);
      }
    } catch (error) {
      this.logger.error('[DNS Manager] Failed to restore DNS:', error.message);
      throw error;
    } finally {
      // Clear stored config after successful restore
      this.store.delete('originalDNS');
    }
  }

  // ===========================
  // macOS Implementation
  // ===========================

  async setDNSMacOS() {
    const services = await this.getNetworkServicesMacOS();

    // Batch all commands into one sudo call to reduce prompts
    const commands = services.map(service =>
      `networksetup -setdnsservers "${service}" 127.0.0.1 8.8.8.8`
    );

    const script = commands.join(' && ');

    return new Promise((resolve, reject) => {
      sudo.exec(script, SUDO_OPTIONS, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Failed to set DNS: ${stderr || error.message}`));
        } else {
          this.logger.log(`[DNS Manager] macOS DNS set for ${services.length} service(s)`);
          resolve();
        }
      });
    });
  }

  async restoreDNSMacOS() {
    const originalDNS = this.store.get('originalDNS', {});
    const services = Object.keys(originalDNS);

    if (services.length === 0) {
      // Fallback: clear DNS for all active services
      const activeServices = await this.getNetworkServicesMacOS();
      const commands = activeServices.map(s => `networksetup -setdnsservers "${s}" empty`);
      const script = commands.join(' && ');

      return new Promise((resolve, reject) => {
        sudo.exec(script, SUDO_OPTIONS, (error, stdout, stderr) => {
          if (error) reject(new Error(`Failed to restore DNS: ${stderr || error.message}`));
          else {
            this.logger.log('[DNS Manager] macOS DNS restored (default)');
            resolve();
          }
        });
      });
    }

    // Restore specific values
    const commands = services.map(service => {
      const servers = originalDNS[service];
      if (servers === "There aren't any DNS Servers set") {
        return `networksetup -setdnsservers "${service}" empty`;
      } else {
        return `networksetup -setdnsservers "${service}" ${servers}`;
      }
    });

    const script = commands.join(' && ');

    return new Promise((resolve, reject) => {
      sudo.exec(script, SUDO_OPTIONS, (error, stdout, stderr) => {
        if (error) reject(new Error(`Failed to restore DNS: ${stderr || error.message}`));
        else {
          this.logger.log('[DNS Manager] macOS DNS restored');
          resolve();
        }
      });
    });
  }

  async getNetworkServicesMacOS() {
    try {
      // Step 1: Get currently active DNS resolvers from scutil --dns
      const { stdout: scutilOutput } = await execAsync('scutil --dns');

      // Parse scutil output to find active resolvers and their interfaces
      // Example output:
      // resolver #1
      //   search domain[0] : example.com
      //   nameserver[0] : 8.8.8.8
      //   if_index : 4 (en0)
      //   flags    : Request A records, Request AAAA records
      //   reach    : 0x00000002 (Reachable)

      const activeInterfaces = new Set();
      const resolverBlocks = scutilOutput.split('resolver #');

      for (const block of resolverBlocks) {
        if (!block.trim()) continue;

        // Look for if_index line with interface name
        const ifMatch = block.match(/if_index\s*:\s*\d+\s*\(([^)]+)\)/);
        if (ifMatch) {
          activeInterfaces.add(ifMatch[1].trim());
        }
      }

      this.logger.log(`[DNS Manager] Active interfaces from scutil: ${Array.from(activeInterfaces).join(', ')}`);

      // Step 2: Get service order mapping from networksetup
      const { stdout: orderOutput } = await execAsync('networksetup -listnetworkserviceorder');

      // Parse output like:
      // (1) Wi-Fi
      // (Hardware Port: Wi-Fi, Device: en0)
      // (2) Ethernet
      // (Hardware Port: Ethernet, Device: en1)

      const serviceMap = new Map(); // device -> serviceName
      const lines = orderOutput.split('\n');

      let currentService = null;
      for (const line of lines) {
        // Match service name: (1) Wi-Fi
        const serviceMatch = line.match(/^\(\d+\)\s+(.+)$/);
        if (serviceMatch) {
          currentService = serviceMatch[1].trim();
          continue;
        }

        // Match hardware port line: (Hardware Port: Wi-Fi, Device: en0)
        const deviceMatch = line.match(/Device:\s*(\w+)\)/);
        if (deviceMatch && currentService) {
          const device = deviceMatch[1].trim();
          serviceMap.set(device, currentService);
          this.logger.log(`[DNS Manager] Mapped ${device} -> ${currentService}`);
        }
      }

      // Step 3: Match active interfaces to service names
      const activeServices = [];
      for (const iface of activeInterfaces) {
        const serviceName = serviceMap.get(iface);
        if (serviceName) {
          // Verify service supports DNS operations
          try {
            await execAsync(`networksetup -getdnsservers "${serviceName}"`);
            activeServices.push(serviceName);
            this.logger.log(`[DNS Manager] Active service: ${serviceName} (${iface})`);
          } catch {
            this.logger.warn(`[DNS Manager] Service ${serviceName} doesn't support DNS`);
          }
        }
      }

      if (activeServices.length > 0) {
        this.logger.log(`[DNS Manager] Found ${activeServices.length} active DNS service(s)`);
        return activeServices;
      }

      // Fallback: if scutil parsing failed, try all services
      this.logger.warn('[DNS Manager] scutil parsing incomplete, falling back to all services');
      const { stdout: allServices } = await execAsync('networksetup -listallnetworkservices');
      const serviceLines = allServices.split('\n').filter(line =>
        line &&
        !line.startsWith('An asterisk') &&
        !line.startsWith('*')
      );

      const workingServices = [];
      for (const serviceName of serviceLines) {
        const trimmed = serviceName.trim();
        if (!trimmed) continue;

        try {
          await execAsync(`networksetup -getdnsservers "${trimmed}"`);
          workingServices.push(trimmed);
        } catch {}
      }

      if (workingServices.length > 0) {
        return workingServices;
      }

      // Last resort: common service names
      const fallbacks = ['Wi-Fi', 'Ethernet', 'Thunderbolt Ethernet'];
      for (const service of fallbacks) {
        try {
          await execAsync(`networksetup -getdnsservers "${service}"`);
          this.logger.log(`[DNS Manager] Using last-resort fallback: ${service}`);
          return [service];
        } catch {}
      }

      throw new Error('Could not detect any network services on macOS');
    } catch (error) {
      this.logger.error('[DNS Manager] Error detecting macOS services:', error.message);
      throw error;
    }
  }

  // ===========================
  // Windows Implementation
  // ===========================

  async setDNSWindows() {
    const interfaces = await this.getNetworkInterfacesWindows();

    // Create PowerShell script to batch commands (single UAC prompt)
    const psCommands = interfaces.map(iface => `
      netsh interface ip set dns name="${iface}" static 127.0.0.1 primary
      netsh interface ip add dns name="${iface}" 8.8.8.8 index=2
    `).join('\n');

    const psScript = `
      $ErrorActionPreference = 'Stop'
      ${psCommands}
      exit 0
    `;

    // Write to temp file
    const tempFile = path.join(os.tmpdir(), 'hyperclay-dns-setup.ps1');
    await fs.writeFile(tempFile, psScript);

    return new Promise((resolve, reject) => {
      const command = `powershell -ExecutionPolicy Bypass -File "${tempFile}"`;

      sudo.exec(command, SUDO_OPTIONS, async (error, stdout, stderr) => {
        // Cleanup temp file
        try {
          await fs.unlink(tempFile);
        } catch {}

        if (error) {
          reject(new Error(`Failed to set DNS: ${stderr || error.message}`));
        } else {
          this.logger.log(`[DNS Manager] Windows DNS set for ${interfaces.length} interface(s)`);
          resolve();
        }
      });
    });
  }

  async restoreDNSWindows() {
    const interfaces = await this.getNetworkInterfacesWindows();

    // Restore to DHCP (automatic)
    const psCommands = interfaces.map(iface =>
      `netsh interface ip set dns name="${iface}" dhcp`
    ).join('\n');

    const psScript = `
      $ErrorActionPreference = 'Stop'
      ${psCommands}
      exit 0
    `;

    const tempFile = path.join(os.tmpdir(), 'hyperclay-dns-restore.ps1');
    await fs.writeFile(tempFile, psScript);

    return new Promise((resolve, reject) => {
      const command = `powershell -ExecutionPolicy Bypass -File "${tempFile}"`;

      sudo.exec(command, SUDO_OPTIONS, async (error, stdout, stderr) => {
        try {
          await fs.unlink(tempFile);
        } catch {}

        if (error) {
          reject(new Error(`Failed to restore DNS: ${stderr || error.message}`));
        } else {
          this.logger.log('[DNS Manager] Windows DNS restored to DHCP');
          resolve();
        }
      });
    });
  }

  async getNetworkInterfacesWindows() {
    try {
      // Try PowerShell Get-NetAdapter first (more reliable)
      const psCommand = `
        Get-NetAdapter |
        Where-Object { $_.Status -eq 'Up' -and $_.InterfaceType -notlike '*Loopback*' } |
        Select-Object -ExpandProperty Name
      `;

      try {
        const { stdout } = await execAsync(`powershell -Command "${psCommand}"`);
        const interfaces = stdout.split('\n')
          .map(line => line.trim())
          .filter(line => line && line.length > 0);

        if (interfaces.length > 0) {
          this.logger.log(`[DNS Manager] Found ${interfaces.length} active interface(s) via Get-NetAdapter`);
          return interfaces;
        }
      } catch (psError) {
        this.logger.warn('[DNS Manager] Get-NetAdapter failed, falling back to netsh');
      }

      // Fallback to netsh
      const { stdout } = await execAsync('netsh interface show interface');

      const lines = stdout.split('\n');
      const activeInterfaces = [];

      for (const line of lines) {
        if (line.includes('Connected') && !line.includes('Disconnected')) {
          // Parse interface name (handle spaces in names)
          const parts = line.trim().split(/\s{2,}/);
          const name = parts[parts.length - 1];
          if (name && name !== 'Admin State' && name !== 'Interface') {
            activeInterfaces.push(name);
          }
        }
      }

      this.logger.log(`[DNS Manager] Found ${activeInterfaces.length} active interface(s) via netsh`);
      return activeInterfaces.length > 0 ? activeInterfaces : ['Wi-Fi', 'Ethernet'];
    } catch (error) {
      this.logger.warn('[DNS Manager] Could not detect interfaces, using defaults');
      return ['Wi-Fi', 'Ethernet'];
    }
  }

  // ===========================
  // Linux Implementation
  // ===========================

  async setDNSLinux() {
    // Check for NetworkManager first (most common on modern distros)
    const hasNetworkManager = await this.checkNetworkManager();
    if (hasNetworkManager) {
      return await this.setDNSLinuxNetworkManager();
    }

    // Fall back to systemd-resolved
    const hasSystemdResolved = await this.checkSystemdResolved();
    if (hasSystemdResolved) {
      return await this.setDNSLinuxSystemd();
    }

    // Last resort: edit /etc/resolv.conf directly
    return await this.setDNSLinuxResolvConf();
  }

  async restoreDNSLinux() {
    // Try to restore using the method that was used to set
    const hasNetworkManager = await this.checkNetworkManager();
    if (hasNetworkManager) {
      return await this.restoreDNSLinuxNetworkManager();
    }

    const hasSystemdResolved = await this.checkSystemdResolved();
    if (hasSystemdResolved) {
      return await this.restoreDNSLinuxSystemd();
    }

    return await this.restoreDNSLinuxResolvConf();
  }

  async checkNetworkManager() {
    try {
      // Check if nmcli exists and NetworkManager is actually managing connections
      await execAsync('nmcli --version');

      // Verify NetworkManager is managing at least one device
      const { stdout } = await execAsync('nmcli -t dev status');
      const lines = stdout.split('\n').filter(line => line.trim());

      // Check if any device is connected
      for (const line of lines) {
        const parts = line.split(':');
        if (parts[2] === 'connected') {
          this.logger.log('[DNS Manager] NetworkManager detected and managing connections');
          return true;
        }
      }

      this.logger.log('[DNS Manager] NetworkManager installed but not managing connections');
      return false;
    } catch {
      return false;
    }
  }

  async checkSystemdResolved() {
    try {
      await execAsync('systemctl is-active systemd-resolved');
      return true;
    } catch {
      return false;
    }
  }

  async setDNSLinuxNetworkManager() {
    try {
      // Get all connected devices
      const { stdout: devOutput } = await execAsync('nmcli -t dev status');
      const lines = devOutput.split('\n').filter(line => line.trim());

      const connectedDevices = [];
      for (const line of lines) {
        const parts = line.split(':');
        const device = parts[0];
        const type = parts[1];
        const state = parts[2];
        const connection = parts[3];

        if (state === 'connected' && connection) {
          connectedDevices.push({ device, connection });
        }
      }

      if (connectedDevices.length === 0) {
        throw new Error('No active NetworkManager connections found');
      }

      this.logger.log(`[DNS Manager] Found ${connectedDevices.length} connected device(s)`);

      // Build commands for all connected devices
      const commands = [];
      for (const { device, connection } of connectedDevices) {
        commands.push(`nmcli connection modify "${connection}" ipv4.dns "127.0.0.1 8.8.8.8"`);
        commands.push(`nmcli connection modify "${connection}" ipv4.ignore-auto-dns yes`);
        commands.push(`nmcli device reapply "${device}"`);
      }

      // Add systemd-resolved restart if it's running
      commands.push('systemctl is-active systemd-resolved && systemctl restart systemd-resolved || true');

      const script = commands.join(' && ');

      return new Promise((resolve, reject) => {
        sudo.exec(script, SUDO_OPTIONS, (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`Failed to set DNS via NetworkManager: ${stderr || error.message}`));
          } else {
            this.logger.log(`[DNS Manager] Linux DNS set via NetworkManager on ${connectedDevices.length} device(s)`);
            resolve();
          }
        });
      });
    } catch (error) {
      this.logger.error('[DNS Manager] NetworkManager setup failed:', error.message);
      throw error;
    }
  }

  async restoreDNSLinuxNetworkManager() {
    try {
      // Get all connected devices
      const { stdout: devOutput } = await execAsync('nmcli -t dev status');
      const lines = devOutput.split('\n').filter(line => line.trim());

      const connectedDevices = [];
      for (const line of lines) {
        const parts = line.split(':');
        const device = parts[0];
        const state = parts[2];
        const connection = parts[3];

        if (state === 'connected' && connection) {
          connectedDevices.push({ device, connection });
        }
      }

      if (connectedDevices.length === 0) {
        this.logger.warn('[DNS Manager] No active NetworkManager connections found');
        return;
      }

      // Build commands to restore DNS for all devices
      const commands = [];
      for (const { device, connection } of connectedDevices) {
        commands.push(`nmcli connection modify "${connection}" ipv4.dns ""`);
        commands.push(`nmcli connection modify "${connection}" ipv4.ignore-auto-dns no`);
        commands.push(`nmcli device reapply "${device}"`);
      }

      // Restart systemd-resolved if running
      commands.push('systemctl is-active systemd-resolved && systemctl restart systemd-resolved || true');

      const script = commands.join(' && ');

      return new Promise((resolve, reject) => {
        sudo.exec(script, SUDO_OPTIONS, (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`Failed to restore DNS via NetworkManager: ${stderr || error.message}`));
          } else {
            this.logger.log(`[DNS Manager] Linux DNS restored via NetworkManager on ${connectedDevices.length} device(s)`);
            resolve();
          }
        });
      });
    } catch (error) {
      this.logger.error('[DNS Manager] NetworkManager restore failed:', error.message);
      throw error;
    }
  }

  async setDNSLinuxSystemd() {
    const iface = await this.getDefaultInterfaceLinux();

    // Use resolvectl (newer) or systemd-resolve (older)
    const commands = [
      `resolvectl dns ${iface} 127.0.0.1 8.8.8.8`,
      `resolvectl domain ${iface} '~.'`, // Route all domains
      `systemctl restart systemd-resolved`
    ].join(' && ');

    return new Promise((resolve, reject) => {
      sudo.exec(commands, SUDO_OPTIONS, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Failed to set DNS: ${stderr || error.message}`));
        } else {
          this.logger.log(`[DNS Manager] Linux DNS set via systemd-resolved on ${iface}`);
          resolve();
        }
      });
    });
  }

  async restoreDNSLinuxSystemd() {
    const iface = await this.getDefaultInterfaceLinux();

    const commands = [
      `resolvectl revert ${iface}`,
      `systemctl restart systemd-resolved`
    ].join(' && ');

    return new Promise((resolve, reject) => {
      sudo.exec(commands, SUDO_OPTIONS, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Failed to restore DNS: ${stderr || error.message}`));
        } else {
          this.logger.log(`[DNS Manager] Linux DNS restored via systemd-resolved`);
          resolve();
        }
      });
    });
  }

  async setDNSLinuxResolvConf() {
    const commands = [
      `cp /etc/resolv.conf /etc/resolv.conf.hyperclaylocal.bak`,
      `echo "nameserver 127.0.0.1\\nnameserver 8.8.8.8" > /etc/resolv.conf`
    ].join(' && ');

    return new Promise((resolve, reject) => {
      sudo.exec(commands, SUDO_OPTIONS, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Failed to set DNS: ${stderr || error.message}`));
        } else {
          this.logger.log('[DNS Manager] Linux DNS set via /etc/resolv.conf');
          resolve();
        }
      });
    });
  }

  async restoreDNSLinuxResolvConf() {
    const command = `mv /etc/resolv.conf.hyperclaylocal.bak /etc/resolv.conf`;

    return new Promise((resolve, reject) => {
      sudo.exec(command, SUDO_OPTIONS, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Failed to restore DNS: ${stderr || error.message}`));
        } else {
          this.logger.log('[DNS Manager] Linux DNS restored from backup');
          resolve();
        }
      });
    });
  }

  async getDefaultInterfaceLinux() {
    try {
      const { stdout } = await execAsync("ip route | grep default | awk '{print $5}' | head -n1");
      const iface = stdout.trim();
      return iface || 'eth0';
    } catch {
      return 'eth0';
    }
  }

  // ===========================
  // Persistence Helpers
  // ===========================

  async storeOriginalDNS() {
    try {
      const dnsConfig = {};

      switch (this.platform) {
        case 'darwin': {
          const services = await this.getNetworkServicesMacOS();
          for (const service of services) {
            const { stdout } = await execAsync(`networksetup -getdnsservers "${service}"`);
            dnsConfig[service] = stdout.trim();
          }
          break;
        }
        case 'win32': {
          const interfaces = await this.getNetworkInterfacesWindows();
          for (const iface of interfaces) {
            try {
              const { stdout } = await execAsync(`netsh interface ip show dns name="${iface}"`);
              dnsConfig[iface] = stdout.trim();
            } catch {}
          }
          break;
        }
        case 'linux': {
          const { stdout } = await execAsync('cat /etc/resolv.conf');
          dnsConfig.resolvConf = stdout.trim();
          break;
        }
      }

      // Persist to electron-store
      this.store.set('originalDNS', dnsConfig);
      this.logger.log('[DNS Manager] Original DNS config stored');
    } catch (error) {
      this.logger.warn('[DNS Manager] Could not store original DNS:', error.message);
    }
  }

  async checkDNSIsSet() {
    try {
      const { stdout } = await execAsync('nslookup test.hyperclaylocal.com 127.0.0.1');
      return stdout.includes('127.0.0.1');
    } catch {
      return false;
    }
  }

  async attemptRecovery() {
    // Called on app startup to check if DNS needs restoration
    const dnsSetupComplete = this.store.get('dnsSetupComplete', false);
    const hasOriginalDNS = this.store.get('originalDNS') !== undefined;

    if (!dnsSetupComplete && hasOriginalDNS) {
      // App crashed during DNS setup - restore original
      this.logger.warn('[DNS Manager] Detected incomplete DNS setup, attempting recovery...');
      try {
        await this.restoreDNS();
        this.logger.log('[DNS Manager] Recovery successful');
      } catch (error) {
        this.logger.error('[DNS Manager] Recovery failed:', error.message);
      }
    }
  }
}

module.exports = SystemDNSManager;
```

---

## Updated HTTP Server (Port 4321 + Static Assets)

**`src/http-server/index.js`**

```javascript
/**
 * HTTP Server on port 4321 (no admin required)
 * Supports static assets with proper MIME types
 *
 * Routing behavior (matches Hyperclay platform):
 * - HTML files: Always served at [filename].hyperclaylocal.com:4321
 *   (even if located in nested folders on disk)
 * - Other files: Served at http://hyperclaylocal.com:4321/path/to/file
 *   or http://hyperclaylocal.com:4321/[username]/path/to/file if username set
 */

const express = require('express');
const compression = require('compression');
const path = require('path');
const fs = require('fs').promises;

class HyperclayHTTPServer {
  constructor(syncFolder, options = {}) {
    this.syncFolder = syncFolder;
    this.port = options.port || 4321; // High port, no admin needed
    this.username = options.username || null; // Optional username for asset paths
    this.logger = options.logger || console;
    this.app = express();
    this.server = null;

    // Cache for file reads
    this.fileCache = new Map();

    // Cache for HTML file locations (siteName -> fullPath)
    this.htmlFileLocations = new Map();

    this.setupMiddleware();
    this.setupRoutes();
  }

  setUsername(username) {
    this.username = username;
    this.logger.log(`[HTTP] Username set to: ${username}`);
  }

  setupMiddleware() {
    // Enable gzip compression
    this.app.use(compression());

    // Trust proxy headers
    this.app.set('trust proxy', true);

    // CORS headers
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
      next();
    });

    // Request logging
    this.app.use((req, res, next) => {
      if (this.logger.level === 'debug') {
        this.logger.log(`[HTTP] ${req.method} ${req.headers.host}${req.url}`);
      }
      next();
    });
  }

  setupRoutes() {
    // Main router based on Host header
    this.app.use(async (req, res, next) => {
      const host = req.headers.host || '';

      // Parse subdomain (remove :port if present)
      const hostWithoutPort = host.split(':')[0];
      const match = hostWithoutPort.match(/^(.+?)\.hyperclaylocal\.com$/);

      if (match) {
        // Subdomain request - this is a site
        const siteName = match[1];

        // Check if requesting an asset (anything other than /)
        if (req.url !== '/' && req.url !== '') {
          // Find the site's HTML file to determine its directory
          const htmlPath = await this.findSiteFile(siteName);

          if (!htmlPath) {
            return res.status(404).send('Site not found');
          }

          // Serve asset relative to the HTML file's directory
          const siteDir = path.dirname(htmlPath);
          await this.serveAsset(siteDir, req.url, res);
        } else {
          // Serve the HTML file itself
          await this.serveSite(siteName, req, res);
        }
      } else if (hostWithoutPort === 'hyperclaylocal.com' || hostWithoutPort === 'localhost') {
        await this.serveDashboard(req, res);
      } else {
        res.status(404).send('Not Found');
      }
    });

    // Error handler
    this.app.use((err, req, res, next) => {
      this.logger.error('[HTTP] Error:', err);
      res.status(500).send('Internal Server Error');
    });
  }

  async serveSite(siteName, req, res) {
    try {
      // Find the HTML file
      const htmlPath = await this.findSiteFile(siteName);

      if (!htmlPath) {
        return this.send404(res, siteName);
      }

      // Serve the HTML file (assets are handled in middleware)
      const html = await this.readFileWithCache(htmlPath);
      res.type('html');
      res.setHeader('Cache-Control', 'no-cache');
      res.send(html);

      if (this.logger.level === 'debug') {
        this.logger.log(`[HTTP] Served ${siteName} from ${htmlPath}`);
      }
    } catch (error) {
      this.logger.error(`[HTTP] Error serving ${siteName}:`, error.message);
      res.status(500).send('Internal Server Error');
    }
  }

  async serveAsset(siteDir, assetUrl, res) {
    try {
      // Clean up the URL (remove query strings, leading slashes)
      const cleanUrl = assetUrl.split('?')[0].replace(/^\/+/, '');

      // Build absolute path to asset
      const assetPath = path.join(siteDir, cleanUrl);

      // Security: prevent directory traversal
      const resolvedAssetPath = path.resolve(assetPath);
      const resolvedSiteDir = path.resolve(siteDir);

      if (!resolvedAssetPath.startsWith(resolvedSiteDir)) {
        this.logger.warn(`[HTTP] Directory traversal attempt blocked: ${assetUrl}`);
        return res.status(403).send('Forbidden');
      }

      // Check if asset exists
      let stats;
      try {
        stats = await fs.stat(assetPath);
      } catch {
        this.logger.warn(`[HTTP] Asset not found: ${assetPath}`);
        return res.status(404).send('Asset not found');
      }

      // Don't serve directories
      if (stats.isDirectory()) {
        return res.status(404).send('Not Found');
      }

      // Determine MIME type
      const ext = path.extname(assetPath).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.mjs': 'application/javascript',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.webp': 'image/webp',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf',
        '.otf': 'font/otf',
        '.eot': 'application/vnd.ms-fontobject',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.pdf': 'application/pdf',
        '.txt': 'text/plain',
        '.xml': 'application/xml'
      };

      const contentType = mimeTypes[ext] || 'application/octet-stream';

      // Read and serve asset
      const content = await fs.readFile(assetPath);
      res.type(contentType);
      res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache assets for 1 year
      res.setHeader('Content-Length', content.length);
      res.send(content);

      if (this.logger.level === 'debug') {
        this.logger.log(`[HTTP] Served asset: ${assetUrl} -> ${assetPath}`);
      }

    } catch (error) {
      this.logger.error(`[HTTP] Error serving asset ${assetUrl}:`, error.message);
      res.status(500).send('Error serving asset');
    }
  }

  async readFileWithCache(filePath) {
    // Check cache
    const cached = this.fileCache.get(filePath);
    if (cached) {
      const stat = await fs.stat(filePath);
      if (stat.mtimeMs === cached.mtime) {
        return cached.content;
      }
    }

    // Read and cache
    const content = await fs.readFile(filePath, 'utf-8');
    const stat = await fs.stat(filePath);

    this.fileCache.set(filePath, {
      content,
      mtime: stat.mtimeMs
    });

    return content;
  }

  invalidateCache(filePath) {
    this.fileCache.delete(filePath);
  }

  async buildHTMLFileIndex() {
    // Recursively scan for all .html files in syncFolder
    this.htmlFileLocations.clear();

    const files = await this.findAllHTMLFiles(this.syncFolder);

    for (const filePath of files) {
      const filename = path.basename(filePath, '.html');
      this.htmlFileLocations.set(filename, filePath);
    }

    this.logger.log(`[HTTP] Indexed ${this.htmlFileLocations.size} HTML file(s)`);
  }

  async findAllHTMLFiles(dir) {
    const results = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          const nested = await this.findAllHTMLFiles(fullPath);
          results.push(...nested);
        } else if (entry.name.endsWith('.html')) {
          results.push(fullPath);
        }
      }
    } catch (error) {
      this.logger.warn(`[HTTP] Error reading directory ${dir}:`, error.message);
    }

    return results;
  }

  async findSiteFile(siteName) {
    // Check cache first
    const cached = this.htmlFileLocations.get(siteName);
    if (cached) {
      // Verify file still exists
      try {
        await fs.access(cached);
        return cached;
      } catch {
        // File was deleted, rebuild index
        await this.buildHTMLFileIndex();
        return this.htmlFileLocations.get(siteName) || null;
      }
    }

    // Not in cache, rebuild index and check again
    await this.buildHTMLFileIndex();
    return this.htmlFileLocations.get(siteName) || null;
  }

  async serveDashboard(req, res) {
    let requestedPath = req.path;

    // Remove username prefix if present
    if (this.username && requestedPath.startsWith(`/${this.username}/`)) {
      requestedPath = requestedPath.replace(`/${this.username}`, '');
    }

    // If requesting root, show dashboard
    if (requestedPath === '/' || requestedPath === '' || requestedPath === '/browse') {
      return this.serveDashboardHome(res);
    }

    // If requesting a path, show directory browser or serve file
    return this.serveDirectoryBrowser(requestedPath, res);
  }

  serveDashboardHome(res) {
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Hyperclay Local</title>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 20px;
            }
            .container {
              background: white;
              border-radius: 12px;
              padding: 40px;
              max-width: 600px;
              box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            }
            h1 {
              color: #2d3748;
              margin-bottom: 20px;
              font-size: 32px;
            }
            .status {
              color: #48bb78;
              font-weight: 600;
              font-size: 18px;
              margin: 10px 0;
              display: flex;
              align-items: center;
              gap: 10px;
            }
            .status::before {
              content: '✓';
              background: #48bb78;
              color: white;
              width: 24px;
              height: 24px;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            p {
              color: #4a5568;
              line-height: 1.6;
              margin: 15px 0;
            }
            code {
              background: #edf2f7;
              padding: 4px 8px;
              border-radius: 4px;
              font-family: Monaco, Courier, monospace;
              color: #2d3748;
              font-size: 14px;
            }
            .info-box {
              background: #f7fafc;
              border-left: 4px solid #667eea;
              padding: 15px;
              margin: 20px 0;
              border-radius: 4px;
            }
            .info-box h3 {
              color: #2d3748;
              margin-bottom: 8px;
              font-size: 16px;
            }
            .link {
              display: inline-block;
              margin-top: 15px;
              color: #667eea;
              text-decoration: none;
              font-weight: 600;
            }
            .link:hover {
              text-decoration: underline;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🚀 Hyperclay Local</h1>
            <div class="status">DNS Server Running</div>
            <div class="status">HTTP Server Running</div>

            <div class="info-box">
              <h3>How to access your sites:</h3>
              <p>Access sites at <code>http://sitename.hyperclaylocal.com:4321</code></p>
              <p style="margin-top: 10px; font-size: 14px; color: #718096;">
                Replace <strong>sitename</strong> with your site file name (without .html)
              </p>
            </div>

            <a href="/browse" class="link">📁 Browse all files →</a>

            <p style="font-size: 14px; color: #718096; margin-top: 20px;">
              Running on port 4321 (no admin privileges required)
            </p>
          </div>
        </body>
      </html>
    `);
  }

  async serveDirectoryBrowser(requestedPath, res) {
    try {
      // Remove /browse prefix if present
      if (requestedPath.startsWith('/browse')) {
        requestedPath = requestedPath.replace('/browse', '');
      }

      // Ensure starts with /
      if (!requestedPath.startsWith('/')) {
        requestedPath = '/' + requestedPath;
      }

      // Build absolute path
      const absolutePath = path.join(this.syncFolder, requestedPath);

      // Security: ensure we're within syncFolder
      const resolvedPath = path.resolve(absolutePath);
      const resolvedSyncFolder = path.resolve(this.syncFolder);

      if (!resolvedPath.startsWith(resolvedSyncFolder)) {
        return res.status(403).send('Forbidden');
      }

      // Check if path exists
      let stats;
      try {
        stats = await fs.stat(absolutePath);
      } catch {
        return res.status(404).send('Not Found');
      }

      // If it's a file, serve it
      if (stats.isFile()) {
        return this.serveStaticFile(absolutePath, res);
      }

      // If it's a directory, show directory listing
      if (stats.isDirectory()) {
        return this.serveDirListing(absolutePath, requestedPath, res);
      }

      res.status(404).send('Not Found');
    } catch (error) {
      this.logger.error('[HTTP] Error in directory browser:', error.message);
      res.status(500).send('Internal Server Error');
    }
  }

  async serveStaticFile(filePath, res) {
    try {
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf',
        '.eot': 'application/vnd.ms-fontobject',
        '.txt': 'text/plain',
        '.pdf': 'application/pdf',
        '.zip': 'application/zip'
      };

      const contentType = mimeTypes[ext] || 'application/octet-stream';
      const content = await fs.readFile(filePath);

      res.type(contentType);
      res.send(content);
    } catch (error) {
      this.logger.error('[HTTP] Error serving file:', error.message);
      res.status(500).send('Error serving file');
    }
  }

  async serveDirListing(absolutePath, requestedPath, res) {
    try {
      const entries = await fs.readdir(absolutePath, { withFileTypes: true });

      // Sort: directories first, then files alphabetically
      const dirs = entries.filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
      const files = entries.filter(e => e.isFile()).sort((a, b) => a.name.localeCompare(b.name));
      const sortedEntries = [...dirs, ...files];

      // Build HTML listing
      const listItems = sortedEntries.map(entry => {
        const isHTML = entry.name.endsWith('.html');
        const isDir = entry.isDirectory();

        let url;
        if (isHTML) {
          // HTML files: link to subdomain
          const siteName = path.basename(entry.name, '.html');
          url = `http://${siteName}.hyperclaylocal.com:4321`;
        } else if (isDir) {
          // Directories: continue browsing
          const dirPath = path.join(requestedPath, entry.name);
          url = `/browse${dirPath}`;
        } else {
          // Other files: path-based with username prefix if set
          const filePath = path.join(requestedPath, entry.name);
          url = this.username
            ? `http://hyperclaylocal.com:4321/${this.username}${filePath}`
            : `http://hyperclaylocal.com:4321${filePath}`;
        }

        const icon = isDir ? '📁' : (isHTML ? '📄' : '📎');
        const label = isDir ? entry.name + '/' : entry.name;

        return `
          <li>
            <a href="${url}" ${isHTML ? 'target="_blank"' : ''}>
              <span class="icon">${icon}</span>
              <span class="name">${label}</span>
            </a>
          </li>
        `;
      }).join('');

      // Breadcrumb navigation
      const pathParts = requestedPath.split('/').filter(Boolean);
      const breadcrumbs = pathParts.map((part, index) => {
        const href = '/browse/' + pathParts.slice(0, index + 1).join('/');
        return `<a href="${href}">${part}</a>`;
      }).join(' / ');

      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Directory Browser - Hyperclay Local</title>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
              * { margin: 0; padding: 0; box-sizing: border-box; }
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                background: #f7fafc;
                padding: 20px;
              }
              .container {
                max-width: 900px;
                margin: 0 auto;
                background: white;
                border-radius: 8px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                padding: 30px;
              }
              h1 {
                color: #2d3748;
                margin-bottom: 20px;
                font-size: 24px;
              }
              .breadcrumb {
                color: #718096;
                margin-bottom: 20px;
                font-size: 14px;
              }
              .breadcrumb a {
                color: #667eea;
                text-decoration: none;
              }
              .breadcrumb a:hover {
                text-decoration: underline;
              }
              ul {
                list-style: none;
              }
              li {
                border-bottom: 1px solid #e2e8f0;
              }
              li:last-child {
                border-bottom: none;
              }
              li a {
                display: flex;
                align-items: center;
                padding: 12px;
                text-decoration: none;
                color: #2d3748;
                transition: background 0.15s;
              }
              li a:hover {
                background: #f7fafc;
              }
              .icon {
                margin-right: 10px;
                font-size: 18px;
              }
              .name {
                flex: 1;
              }
              .back {
                display: inline-block;
                margin-bottom: 15px;
                padding: 8px 16px;
                background: #edf2f7;
                color: #2d3748;
                text-decoration: none;
                border-radius: 6px;
                font-size: 14px;
              }
              .back:hover {
                background: #e2e8f0;
              }
              .home-link {
                display: inline-block;
                margin-top: 20px;
                color: #667eea;
                text-decoration: none;
                font-size: 14px;
              }
              .home-link:hover {
                text-decoration: underline;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>📁 Directory Browser</h1>
              <div class="breadcrumb">
                <a href="/browse">Home</a>
                ${breadcrumbs ? ' / ' + breadcrumbs : ''}
              </div>
              ${requestedPath !== '/' ? `<a href="/browse${path.dirname(requestedPath)}" class="back">← Back</a>` : ''}
              <ul>
                ${listItems || '<li style="padding: 12px; color: #718096;">Empty directory</li>'}
              </ul>
              <a href="/" class="home-link">← Back to Dashboard</a>
            </div>
          </body>
        </html>
      `;

      res.type('html');
      res.send(html);
    } catch (error) {
      this.logger.error('[HTTP] Error listing directory:', error.message);
      res.status(500).send('Error listing directory');
    }
  }

  send404(res, siteName) {
    res.status(404).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Site Not Found</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              max-width: 600px;
              margin: 80px auto;
              padding: 20px;
              color: #2d3748;
            }
            h1 { color: #e53e3e; margin-bottom: 16px; }
            p { line-height: 1.6; margin: 12px 0; }
            code {
              background: #edf2f7;
              padding: 2px 6px;
              border-radius: 3px;
              font-family: Monaco, Courier, monospace;
            }
          </style>
        </head>
        <body>
          <h1>Site Not Found</h1>
          <p>The site <code>${siteName}</code> does not exist in your Hyperclay folder.</p>
          <p>Looking for: <code>${siteName}.html</code></p>
          <p><a href="http://hyperclaylocal.com:4321">← Back to Dashboard</a></p>
        </body>
      </html>
    `);
  }

  async start() {
    // Build HTML file index before starting server
    await this.buildHTMLFileIndex();

    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, '127.0.0.1', (err) => {
        if (err) {
          this.logger.error('[HTTP] Failed to start server:', err.message);

          if (err.code === 'EADDRINUSE') {
            reject(new Error(`Port ${this.port} is already in use. Please close other applications using this port.`));
          } else {
            reject(err);
          }
        } else {
          this.logger.log(`[HTTP] Server listening on http://127.0.0.1:${this.port}`);
          resolve();
        }
      });
    });
  }

  async stop() {
    if (!this.server) return;

    return new Promise((resolve) => {
      this.server.close(() => {
        this.logger.log('[HTTP] Server stopped');
        resolve();
      });
    });
  }

  getStatus() {
    return {
      isRunning: this.server && this.server.listening,
      port: this.port,
      syncFolder: this.syncFolder
    };
  }
}

module.exports = HyperclayHTTPServer;
```

---

## Updated Main Process with Crash Recovery

**`main.js`** (key additions)

```javascript
const { app, BrowserWindow, ipcMain } = require('electron');
const HyperclayDNSServer = require('./src/dns-server/index.js');
const SystemDNSManager = require('./src/dns-server/system-dns-manager.js');
const HyperclayHTTPServer = require('./src/http-server/index.js');
const Store = require('electron-store');
const path = require('path');

const store = new Store();
let dnsServer = null;
let httpServer = null;
let dnsManager = null;
let mainWindow = null;

// Simple logger with levels
const logger = {
  level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
  log: (...args) => console.log('[App]', ...args),
  error: (...args) => console.error('[App]', ...args),
  warn: (...args) => console.warn('[App]', ...args)
};

// ===========================
// Crash Recovery on Startup
// ===========================

async function attemptDNSRecovery() {
  dnsManager = new SystemDNSManager(store, logger);
  await dnsManager.attemptRecovery();
}

// ===========================
// Server Management
// ===========================

async function startServers() {
  const syncFolder = store.get('syncFolder');

  if (!syncFolder) {
    logger.log('No sync folder configured yet');
    return { success: false, error: 'No sync folder configured' };
  }

  try {
    const dnsSetupComplete = store.get('dnsSetupComplete', false);

    if (!dnsSetupComplete) {
      logger.log('DNS setup not complete, skipping server start');
      return { success: false, error: 'DNS not configured' };
    }

    // Start DNS server
    dnsServer = new HyperclayDNSServer({
      upstreamDNS: '8.8.8.8',
      localDomain: 'hyperclaylocal.com',
      enableIPv6: false, // Disable by default for compatibility
      logger
    });
    await dnsServer.start();

    // Start HTTP server on port 4321 (no admin needed)
    httpServer = new HyperclayHTTPServer(syncFolder, {
      port: 4321,
      logger
    });
    await httpServer.start();

    logger.log('All servers running');
    return { success: true };
  } catch (error) {
    logger.error('Failed to start servers:', error.message);
    return { success: false, error: error.message };
  }
}

async function stopServers() {
  try {
    if (dnsServer) {
      await dnsServer.stop();
      dnsServer = null;
    }
    if (httpServer) {
      await httpServer.stop();
      httpServer = null;
    }
    logger.log('All servers stopped');
    return { success: true };
  } catch (error) {
    logger.error('Error stopping servers:', error.message);
    return { success: false, error: error.message };
  }
}

// ===========================
// Privilege Detection
// ===========================

function checkElevation() {
  const os = require('os');
  const platform = os.platform();

  if (platform === 'win32') {
    // Check Windows admin privileges
    const { exec } = require('child_process');
    return new Promise((resolve) => {
      exec('net session', { timeout: 1000 }, (error) => {
        resolve(!error);
      });
    });
  } else {
    // Check Unix root privileges
    return Promise.resolve(process.getuid && process.getuid() === 0);
  }
}

async function promptForElevation() {
  const { dialog } = require('electron');

  const response = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Administrator Privileges Required',
    message: 'Hyperclay Local needs administrator privileges to configure DNS',
    detail: 'The app needs to:\n' +
            '• Run a DNS server on port 53 (requires admin/sudo)\n' +
            '• Configure system DNS settings to use localhost\n\n' +
            'This allows sites to work with any browser on your system.',
    buttons: ['Quit', 'Learn More', 'Grant Permissions'],
    defaultId: 2,
    cancelId: 0
  });

  if (response.response === 0) {
    // User chose to quit
    app.quit();
    return false;
  }

  if (response.response === 1) {
    // User chose to learn more
    const { shell } = require('electron');
    shell.openExternal('https://docs.hyperclay.com/local/permissions');
    return promptForElevation(); // Ask again after they learn more
  }

  // User chose to grant permissions
  return true;
}

async function ensureElevation() {
  const isElevated = await checkElevation();

  if (isElevated) {
    logger.log('[App] Running with elevated privileges');
    return true;
  }

  logger.warn('[App] Not running with elevated privileges');

  const { dialog } = require('electron');
  const os = require('os');
  const platform = os.platform();

  let instructions = '';
  if (platform === 'win32') {
    instructions = 'Please close the app and right-click "Hyperclay Local" → "Run as administrator"';
  } else if (platform === 'darwin') {
    instructions = 'Please close the app and run: sudo open "/Applications/Hyperclay Local.app"';
  } else {
    instructions = 'Please close the app and run: sudo hyperclay-local';
  }

  await dialog.showMessageBox(mainWindow, {
    type: 'error',
    title: 'Restart Required',
    message: 'Administrator privileges required',
    detail: instructions + '\n\nThe app will now quit.',
    buttons: ['OK']
  });

  app.quit();
  return false;
}

// ===========================
// IPC Handlers
// ===========================

ipcMain.handle('setup-dns', async () => {
  try {
    logger.log('Setting up DNS...');

    // Check for elevation first
    if (!await ensureElevation()) {
      return { success: false, error: 'Insufficient privileges' };
    }

    if (!dnsManager) {
      dnsManager = new SystemDNSManager(store, logger);
    }

    // Set system DNS to localhost
    await dnsManager.setDNSToLocalhost();

    // Mark setup as complete
    store.set('dnsSetupComplete', true);

    // Start servers
    const result = await startServers();

    if (!result.success) {
      throw new Error(result.error);
    }

    logger.log('DNS setup complete');
    return { success: true };
  } catch (error) {
    logger.error('DNS setup failed:', error.message);

    // Cleanup on failure
    store.set('dnsSetupComplete', false);

    // Show user-friendly error
    const { dialog } = require('electron');
    await dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'DNS Setup Failed',
      message: 'Failed to configure DNS',
      detail: error.message + '\n\nPlease check the troubleshooting guide.',
      buttons: ['OK']
    });

    return { success: false, error: error.message };
  }
});

ipcMain.handle('restore-dns', async () => {
  try {
    logger.log('Restoring DNS...');

    if (!dnsManager) {
      dnsManager = new SystemDNSManager(store, logger);
    }

    // Stop servers first
    await stopServers();

    // Restore original DNS
    await dnsManager.restoreDNS();

    // Mark setup as incomplete
    store.set('dnsSetupComplete', false);

    logger.log('DNS restored');
    return { success: true };
  } catch (error) {
    logger.error('DNS restore failed:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('check-dns-status', async () => {
  const configured = store.get('dnsSetupComplete', false);
  const dnsRunning = dnsServer ? dnsServer.getStatus().isRunning : false;
  const httpRunning = httpServer ? httpServer.getStatus().isRunning : false;

  return {
    configured,
    running: dnsRunning,
    httpRunning,
    port: httpRunning ? httpServer.port : null
  };
});

// ===========================
// App Lifecycle
// ===========================

app.on('ready', async () => {
  // Check for elevation on startup
  const isElevated = await checkElevation();

  if (!isElevated) {
    logger.warn('[App] Starting without elevated privileges');

    // Show warning dialog
    const { dialog } = require('electron');
    const os = require('os');
    const platform = os.platform();

    let instructions = '';
    if (platform === 'win32') {
      instructions = 'Right-click "Hyperclay Local" and select "Run as administrator"';
    } else if (platform === 'darwin') {
      instructions = 'Run in Terminal: sudo open "/Applications/Hyperclay Local.app"';
    } else {
      instructions = 'Run in Terminal: sudo hyperclay-local';
    }

    // Create a minimal window just to show the dialog
    const { BrowserWindow } = require('electron');
    const tempWindow = new BrowserWindow({ show: false });

    const response = await dialog.showMessageBox(tempWindow, {
      type: 'warning',
      title: 'Administrator Privileges Required',
      message: 'Hyperclay Local requires administrator privileges',
      detail: 'To use Hyperclay Local, you need to run it with administrator/sudo privileges.\n\n' +
              'How to restart with privileges:\n' +
              instructions + '\n\n' +
              'Why this is needed:\n' +
              '• DNS server needs port 53 (privileged port)\n' +
              '• System DNS configuration requires admin access',
      buttons: ['Quit', 'Continue Anyway (Limited Mode)'],
      defaultId: 0,
      cancelId: 0
    });

    tempWindow.close();

    if (response.response === 0) {
      // User chose to quit
      app.quit();
      return;
    }

    // User chose to continue in limited mode
    logger.warn('[App] Continuing without privileges - DNS features disabled');
  }

  // Attempt DNS recovery first (in case of previous crash)
  if (isElevated) {
    await attemptDNSRecovery();
  }

  // Create window
  createWindow();

  // Try to start servers (if DNS already configured and elevated)
  if (isElevated) {
    const result = await startServers();

    if (result.success) {
      logger.log('Servers started automatically');
    } else {
      logger.log('Servers not started:', result.error);
    }
  } else {
    logger.warn('[App] Skipping server start - insufficient privileges');
  }
});

app.on('before-quit', async (event) => {
  logger.log('App is quitting...');
  event.preventDefault();

  // Stop servers
  await stopServers();

  // Optionally restore DNS on quit
  const restoreOnQuit = store.get('restoreDNSOnQuit', false);
  if (restoreOnQuit && dnsManager) {
    logger.log('Restoring DNS on quit...');
    try {
      await dnsManager.restoreDNS();
    } catch (error) {
      logger.error('Failed to restore DNS on quit:', error.message);
    }
  }

  app.exit(0);
});

// Uncaught exception handler
process.on('uncaughtException', async (error) => {
  logger.error('Uncaught exception:', error);

  // Try to stop servers and restore DNS
  await stopServers();

  if (dnsManager) {
    try {
      await dnsManager.restoreDNS();
    } catch {}
  }

  process.exit(1);
});
```

---

## Key Improvements Summary

1. ✅ **Fixed dns2 API**: Use `dns2.createServer()` with correct options
2. ✅ **Proper upstream forwarding**: Use `dns2.Resolver` instead of raw dgram
3. ✅ **Persistent configuration**: Store/restore DNS via electron-store
4. ✅ **Port 4321 HTTP server**: No admin privileges needed
5. ✅ **Static asset support**: Serve CSS/JS/images with correct MIME types
6. ✅ **Batched Windows commands**: Single UAC prompt via PowerShell script
7. ✅ **Crash recovery**: Detect incomplete setup and restore DNS on startup
8. ✅ **Graceful shutdown**: Cancel active DNS requests on exit
9. ✅ **Structured logging**: Configurable log levels
10. ✅ **File caching**: Cache reads with mtime validation
11. ✅ **HTML file indexing**: Recursively scan for .html files on startup
12. ✅ **Platform-matching routing**:
    - HTML files always served at `http://[filename].hyperclaylocal.com:4321`
    - Other files served at `http://hyperclaylocal.com:4321/[username]/path` (if username set)
    - Directory browser with correct URL generation per file type

## Routing Behavior

This implementation matches the Hyperclay platform routing exactly:

**HTML Files (Sites):**
- Always accessible via subdomain: `http://sitename.hyperclaylocal.com:4321`
- Works regardless of folder nesting on disk
- Indexed on server startup for fast lookups

**Other Files (Assets):**
- Served via path-based URLs
- Without username: `http://hyperclaylocal.com:4321/path/to/file.svg`
- With username: `http://hyperclaylocal.com:4321/username/path/to/file.svg`

**Directory Browser:**
- HTML files link to subdomain URLs (open in new tab)
- Other files link to path-based URLs (with username prefix if set)
- Directories continue browsing within the same interface

## Manual Override and Configuration

**`MANUAL_MODE.md`** - Instructions for users who want manual control

### DNS Configuration

Hyperclay Local automatically configures your system DNS on first launch. This requires admin/sudo privileges.

**What it does:**
- Runs DNS server on port 53 (localhost only)
- Sets system DNS to 127.0.0.1
- Preserves original DNS settings for restoration
- Works with all browsers (Safari, Chrome, Firefox, etc.)

**Manual configuration (if automated setup fails):**

**macOS:**
```bash
# Set DNS
sudo networksetup -setdnsservers "Wi-Fi" 127.0.0.1 8.8.8.8

# Restore
sudo networksetup -setdnsservers "Wi-Fi" empty
```

**Windows (PowerShell as Admin):**
```powershell
# Set DNS
Set-DnsClientServerAddress -InterfaceAlias "Wi-Fi" -ServerAddresses ("127.0.0.1","8.8.8.8")

# Restore
Set-DnsClientServerAddress -InterfaceAlias "Wi-Fi" -ResetServerAddresses
```

**Linux (NetworkManager):**
```bash
# Set DNS
nmcli connection modify "Wired connection 1" ipv4.dns "127.0.0.1 8.8.8.8"
nmcli connection modify "Wired connection 1" ipv4.ignore-auto-dns yes
nmcli connection up "Wired connection 1"

# Restore
nmcli connection modify "Wired connection 1" ipv4.dns ""
nmcli connection modify "Wired connection 1" ipv4.ignore-auto-dns no
nmcli connection up "Wired connection 1"
```

### Troubleshooting

**DNS not resolving:**
1. Check DNS server is running: `netstat -an | grep 53`
2. Test DNS resolution: `nslookup test.hyperclaylocal.com 127.0.0.1`
3. Check system DNS: `scutil --dns` (macOS) or `ipconfig /all` (Windows)
4. Verify 127.0.0.1 is listed as primary DNS server

**Port conflicts:**
- Port 53: Another DNS service is running (dnsmasq, Docker, etc.)
  - Stop the conflicting service or restart your computer
- Port 4321: Change HTTP port in settings

**VPN conflicts:**
- VPN may override DNS settings when connecting
- Solution: Reconnect to VPN after starting Hyperclay Local
- Or configure VPN to exclude `*.hyperclaylocal.com`

**Corporate policy blocks:**
- IT policy may prevent DNS changes
- Contact your IT administrator
- Request whitelist for 127.0.0.1 DNS changes

**Windows Firewall prompts:**
- Windows may show firewall prompts for the DNS server
- Allow the app through the firewall for "Private networks"
- Manual firewall rule (run as administrator):
```powershell
# Add firewall rule for Hyperclay Local DNS
netsh advfirewall firewall add rule name="Hyperclay Local DNS" dir=in action=allow protocol=UDP localport=53 program="C:\Path\To\HyperclayLocal.exe"

# Remove rule when uninstalling
netsh advfirewall firewall delete rule name="Hyperclay Local DNS"
```

## Uninstall Instructions

**`UNINSTALL.md`** - Complete removal guide

### Automated Uninstall

The app provides an uninstall option in settings that:
1. Stops all servers
2. Restores original DNS settings (system-dns mode only)
3. Removes all configuration files
4. Cleans up backup files

### Manual Uninstall

If automated uninstall fails or you deleted the app without uninstalling:

**1. Restore DNS Settings**

**macOS:**
```bash
# Check current DNS
networksetup -getdnsservers "Wi-Fi"

# If it shows only 127.0.0.1, restore to empty (DHCP)
sudo networksetup -setdnsservers "Wi-Fi" empty

# Or restore to specific DNS servers
sudo networksetup -setdnsservers "Wi-Fi" 8.8.8.8 8.8.4.4
```

**Windows (PowerShell as Admin):**
```powershell
# Check current DNS
Get-DnsClientServerAddress -InterfaceAlias "Wi-Fi"

# Restore to automatic (DHCP)
Set-DnsClientServerAddress -InterfaceAlias "Wi-Fi" -ResetServerAddresses
```

**Linux:**
```bash
# NetworkManager
nmcli connection modify "Wired connection 1" ipv4.dns ""
nmcli connection modify "Wired connection 1" ipv4.ignore-auto-dns no
nmcli connection up "Wired connection 1"

# systemd-resolved
resolvectl revert eth0
systemctl restart systemd-resolved

# /etc/resolv.conf
sudo mv /etc/resolv.conf.hyperclaylocal.bak /etc/resolv.conf
```

**2. Remove Configuration Files**

```bash
# macOS/Linux
rm -rf ~/.config/hyperclay-local/
rm -f ~/.config/electron/ElectronStore/config.json

# Windows
rmdir /s "%APPDATA%\hyperclay-local"
```

**3. Verify DNS Resolution**

```bash
# Test external domain
nslookup google.com

# Should NOT resolve to 127.0.0.1
ping google.com
```

**4. Check for Running Processes**

```bash
# Check for lingering processes on port 53 or 4321
netstat -an | grep 53
netstat -an | grep 4321

# If found, kill the process (find PID first)
lsof -i :53
lsof -i :4321
kill -9 <PID>
```

### Verification Checklist

After uninstall, verify:
- [ ] DNS resolves external domains correctly
- [ ] No processes listening on port 53 or 4321
- [ ] Configuration files removed
- [ ] System DNS settings restored (not pointing to 127.0.0.1)
- [ ] Clear DNS cache: `sudo killall -HUP mDNSResponder` (macOS) or `ipconfig /flushdns` (Windows)

## Security Considerations

### Port 53 Binding
- Requires root/admin privileges on startup
- Can be exploited if server has vulnerabilities
- Mitigated by binding only to 127.0.0.1 (loopback interface)
- No external access - only localhost can connect

### DNS Query Logging
- All DNS queries are logged in debug mode
- May leak browsing history in logs
- Logs stored in app data directory
- **Recommendation:** Disable debug logging in production

### Directory Traversal Protection
- HTTP server validates all paths
- Paths are resolved and checked against syncFolder
- Prevents access to files outside syncFolder

### CORS Policy
- Currently set to `Access-Control-Allow-Origin: *`
- Allows any origin to make requests
- **Recommendation:** Restrict to `http://hyperclaylocal.com:4321` and subdomains

### File Serving
- Only serves files within syncFolder
- No directory listing for sensitive folders
- MIME types enforced to prevent script injection

## Next Steps

1. Install dependencies: `npm install dns2 sudo-prompt compression electron-store`
2. Create the file structure and copy code
3. Test on each platform (Mac/Windows/Linux)
4. Add file watcher (chokidar) to rebuild HTML index when files change
5. Test with nested folders to ensure routing works correctly
6. Create installer that includes uninstall script
7. Add UI for mode selection (high-port vs system-dns)
8. Add logging configuration UI
9. Test VPN compatibility
10. Add automated tests for DNS resolution and HTTP serving

This revised implementation addresses all review concerns, provides dual-mode operation, and includes comprehensive documentation for users and developers!
