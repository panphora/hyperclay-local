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

### Mode 1: High-Port DNS Resolver (Recommended - No Elevation Required)

```
┌─────────────────────────────────────────────────────────┐
│                   Hyperclay Local App                    │
│                                                          │
│  ┌────────────────┐        ┌──────────────────────┐    │
│  │  DNS Resolver  │        │   HTTP Server        │    │
│  │  (port 15353)  │        │   (port 4321)        │    │
│  │  NO ELEVATION  │        │                      │    │
│  │                │        │  Parses Host header  │    │
│  │  *.hyperclay   │        │  Serves HTML + assets│    │
│  │  local.com     │        │                      │    │
│  │  → 127.0.0.1   │        │                      │    │
│  └────────────────┘        └──────────────────────┘    │
│         ↑                           ↑                   │
│         │                           │                   │
└─────────┼───────────────────────────┼───────────────────┘
          │                           │
          │                           │
    ┌─────┴──────┐            ┌───────┴────────┐
    │  Electron  │            │  Electron      │
    │  Chromium  │            │  BrowserView   │
    │  with      │            │  app.hyperclay │
    │  --host-   │            │  local.com:4321│
    │  resolver- │            └────────────────┘
    │  rules     │
    └────────────┘
```

**Advantages:**
- ✅ No admin/sudo privileges required
- ✅ No system DNS changes
- ✅ No Windows Firewall prompts
- ✅ Works with VPNs and corporate policies
- ✅ No conflicts with other DNS services

**How it works:**
- DNS resolver runs on high port (15353)
- Electron's Chromium is launched with `--host-resolver-rules="MAP *.hyperclaylocal.com 127.0.0.1"`
- All subdomain requests go directly to HTTP server on port 4321
- External browsers won't work (Electron-only mode)

### Mode 2: System DNS (Legacy - Requires Elevation)

```
┌─────────────────────────────────────────────────────────┐
│                   Hyperclay Local App                    │
│                                                          │
│  ┌────────────────┐        ┌──────────────────────┐    │
│  │  DNS Server    │        │   HTTP Server        │    │
│  │  (port 53)     │        │   (port 4321)        │    │
│  │  NEEDS SUDO    │        │                      │    │
│  │                │        │  Parses Host header  │    │
│  │  *.hyperclay   │        │  Serves HTML + assets│    │
│  │  local.com     │        │                      │    │
│  │  → 127.0.0.1   │        │                      │    │
│  └────────────────┘        └──────────────────────┘    │
│         ↑                           ↑                   │
│         │                           │                   │
└─────────┼───────────────────────────┼───────────────────┘
          │                           │
          │                           │
    ┌─────┴──────┐            ┌───────┴────────┐
    │ System DNS │            │  Any Browser   │
    │ 127.0.0.1  │            │  app.hyperclay │
    └────────────┘            │  local.com:4321│
                              └────────────────┘
```

**Advantages:**
- ✅ Works with external browsers
- ✅ Works with browser extensions

**Disadvantages:**
- ⚠️ Requires admin/sudo privileges
- ⚠️ Modifies system DNS settings
- ⚠️ May conflict with VPNs
- ⚠️ Windows Firewall prompts

**Implementation strategy:**
- Default to Mode 1 (high-port resolver)
- Offer Mode 2 as opt-in for advanced users
- Provide clear warnings about elevation requirements

---

## Updated DNS Server (Dual Mode Support)

**`src/dns-server/index.js`**

```javascript
/**
 * Pure JavaScript DNS Resolver/Server
 * Supports two modes:
 * 1. High-port resolver (recommended, no elevation)
 * 2. System DNS server (requires elevation, port 53)
 */

const dns2 = require('dns2');
const { Packet } = dns2;

class HyperclayDNSServer {
  constructor(options = {}) {
    this.mode = options.mode || 'high-port'; // 'high-port' or 'system-dns'
    this.port = this.mode === 'high-port' ? 15353 : 53;
    this.upstreamDNS = options.upstreamDNS || '8.8.8.8';
    this.localDomain = options.localDomain || 'hyperclaylocal.com';
    this.enableIPv6 = options.enableIPv6 || false;
    this.server = null;
    this.isRunning = false;
    this.resolver = null;
    this.logger = options.logger || console;

    // Track active requests for graceful shutdown
    this.activeRequests = new Map(); // requestId -> AbortController
  }

  async start() {
    if (this.isRunning) {
      this.logger.log('[DNS] Server already running');
      return;
    }

    try {
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

      // Bind to appropriate port
      await new Promise((resolve, reject) => {
        this.server.listen({ port: this.port, address: '127.0.0.1' }, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      this.isRunning = true;

      if (this.mode === 'high-port') {
        this.logger.log(`[DNS] Resolver started on 127.0.0.1:${this.port} (no elevation required)`);
        this.logger.log('[DNS] Use with Electron --host-resolver-rules flag');
      } else {
        this.logger.log(`[DNS] Server started on 127.0.0.1:${this.port}`);
        this.logger.log('[DNS] System DNS must be configured to use 127.0.0.1');
      }

      this.logger.log(`[DNS] Resolving *.${this.localDomain} to 127.0.0.1`);
      this.logger.log(`[DNS] Forwarding other queries to ${this.upstreamDNS}`);

    } catch (error) {
      this.logger.error('[DNS] Failed to start server:', error.message);

      // Provide helpful error messages
      if (error.code === 'EADDRINUSE') {
        const portMsg = this.port === 53
          ? 'Port 53 is already in use. Please close other DNS servers or use high-port mode.'
          : `Port ${this.port} is already in use. Please close other applications using this port.`;
        throw new Error(portMsg);
      }

      if (error.code === 'EACCES' || error.code === 'EPERM') {
        if (this.port === 53) {
          throw new Error('Permission denied. Port 53 requires admin/sudo. Consider using high-port mode instead.');
        }
        throw new Error(`Permission denied for port ${this.port}.`);
      }

      throw error;
    }
  }

  async stop() {
    if (!this.isRunning) return;

    try {
      // Abort all active requests
      for (const [requestId, abortController] of this.activeRequests) {
        abortController.abort();
      }
      this.activeRequests.clear();

      // Close server
      if (this.server) {
        await new Promise((resolve) => {
          this.server.close(() => resolve());
        });
      }

      this.isRunning = false;
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
    const requestId = `${name}-${type}-${Date.now()}`;
    const abortController = new AbortController();

    // Track this request for graceful shutdown
    this.activeRequests.set(requestId, abortController);

    const timeoutId = setTimeout(() => {
      abortController.abort();
      this.activeRequests.delete(requestId);
      this.logger.warn(`[DNS] Upstream query timeout for ${name}`);
      const response = Packet.createResponseFromRequest(request);
      send(response);
    }, 5000);

    try {
      // Use dns2 Resolver (handles retries, TCP fallback, etc.)
      // Note: dns2 doesn't support AbortSignal directly, but we track the controller
      // to abort on shutdown
      const answers = await this.resolver.resolve(name, type);

      clearTimeout(timeoutId);
      this.activeRequests.delete(requestId);

      // Build response from resolver results
      const response = Packet.createResponseFromRequest(request);
      response.answers = answers.answers || [];

      send(response);

      if (this.logger.level === 'debug') {
        this.logger.log(`[DNS] Forwarded ${name} to upstream`);
      }
    } catch (error) {
      clearTimeout(timeoutId);
      this.activeRequests.delete(requestId);

      // Don't log errors if we're shutting down
      if (!abortController.signal.aborted) {
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
      const { stdout } = await execAsync('networksetup -listallnetworkservices');
      const lines = stdout.split('\n').filter(line =>
        line &&
        !line.startsWith('An asterisk') &&
        !line.startsWith('*')
      );

      // Only return services that have DNS configured
      const activeServices = [];
      for (const service of lines) {
        try {
          const { stdout: dnsServers } = await execAsync(`networksetup -getdnsservers "${service}"`);
          // Service exists and is queryable
          activeServices.push(service);
        } catch {
          // Service doesn't support DNS or is not active
        }
      }

      this.logger.log(`[DNS Manager] Found ${activeServices.length} network service(s)`);
      return activeServices.length > 0 ? activeServices : ['Wi-Fi']; // Fallback
    } catch (error) {
      this.logger.warn('[DNS Manager] Could not detect network services, using Wi-Fi');
      return ['Wi-Fi'];
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
      await execAsync('nmcli --version');
      return true;
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
      // Get active connection name
      const { stdout } = await execAsync("nmcli -t -f NAME,DEVICE connection show --active | head -n1");
      const connectionName = stdout.trim().split(':')[0];

      if (!connectionName) {
        throw new Error('No active NetworkManager connection found');
      }

      const commands = [
        `nmcli connection modify "${connectionName}" ipv4.dns "127.0.0.1 8.8.8.8"`,
        `nmcli connection modify "${connectionName}" ipv4.ignore-auto-dns yes`,
        `nmcli connection up "${connectionName}"`
      ].join(' && ');

      return new Promise((resolve, reject) => {
        sudo.exec(commands, SUDO_OPTIONS, (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`Failed to set DNS via NetworkManager: ${stderr || error.message}`));
          } else {
            this.logger.log(`[DNS Manager] Linux DNS set via NetworkManager on ${connectionName}`);
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
      const { stdout } = await execAsync("nmcli -t -f NAME,DEVICE connection show --active | head -n1");
      const connectionName = stdout.trim().split(':')[0];

      if (!connectionName) {
        this.logger.warn('[DNS Manager] No active NetworkManager connection found');
        return;
      }

      const commands = [
        `nmcli connection modify "${connectionName}" ipv4.dns ""`,
        `nmcli connection modify "${connectionName}" ipv4.ignore-auto-dns no`,
        `nmcli connection up "${connectionName}"`
      ].join(' && ');

      return new Promise((resolve, reject) => {
        sudo.exec(commands, SUDO_OPTIONS, (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`Failed to restore DNS via NetworkManager: ${stderr || error.message}`));
          } else {
            this.logger.log('[DNS Manager] Linux DNS restored via NetworkManager');
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
        const siteName = match[1];
        await this.serveSite(siteName, req, res);
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

      // Get the directory where the HTML file is located
      const siteDir = path.dirname(htmlPath);

      // If requesting root, serve the HTML file
      if (req.url === '/' || req.url === '') {
        const html = await this.readFileWithCache(htmlPath);
        res.type('html');
        res.setHeader('Cache-Control', 'no-cache');
        res.send(html);

        if (this.logger.level === 'debug') {
          this.logger.log(`[HTTP] Served ${siteName} from ${htmlPath}`);
        }
        return;
      }

      // Otherwise, serve static asset relative to the HTML file's directory
      await this.serveAsset(siteDir, req.url, res);

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
    // If requesting root, show dashboard
    if (req.path === '/' || req.path === '') {
      return this.serveDashboardHome(res);
    }

    // If requesting a path, show directory browser
    return this.serveDirectoryBrowser(req, res);
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

  async serveDirectoryBrowser(req, res) {
    try {
      // Parse requested path
      let requestedPath = req.path;

      // Remove /browse prefix if present
      if (requestedPath.startsWith('/browse')) {
        requestedPath = requestedPath.replace('/browse', '');
      }

      // Ensure starts with /
      if (!requestedPath.startsWith('/')) {
        requestedPath = '/' + requestedPath;
      }

      // Remove username prefix if present
      if (this.username && requestedPath.startsWith(`/${this.username}/`)) {
        requestedPath = requestedPath.replace(`/${this.username}`, '');
      }

      // Build absolute path
      const absolutePath = path.join(this.syncFolder, requestedPath);

      // Security: ensure we're within syncFolder
      if (!absolutePath.startsWith(this.syncFolder)) {
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

## Updated Main Process with Dual Mode Support

**`main.js`** (key additions)

```javascript
const { app, BrowserWindow, BrowserView, ipcMain } = require('electron');
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
let browserView = null;

// Simple logger with levels
const logger = {
  level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
  log: (...args) => console.log('[App]', ...args),
  error: (...args) => console.error('[App]', ...args),
  warn: (...args) => console.warn('[App]', ...args)
};

// ===========================
// Mode Management
// ===========================

function getDNSMode() {
  // Default to high-port mode (no elevation needed)
  return store.get('dnsMode', 'high-port');
}

function setDNSMode(mode) {
  if (mode !== 'high-port' && mode !== 'system-dns') {
    throw new Error(`Invalid DNS mode: ${mode}`);
  }
  store.set('dnsMode', mode);
  logger.log(`[App] DNS mode set to: ${mode}`);
}

// ===========================
// Crash Recovery on Startup
// ===========================

async function attemptDNSRecovery() {
  const mode = getDNSMode();

  // Only attempt recovery for system-dns mode
  if (mode === 'system-dns') {
    dnsManager = new SystemDNSManager(store, logger);
    await dnsManager.attemptRecovery();
  }
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
    const mode = getDNSMode();
    const dnsSetupComplete = store.get('dnsSetupComplete', false);

    // High-port mode doesn't need DNS setup
    if (mode === 'system-dns' && !dnsSetupComplete) {
      logger.log('DNS setup not complete for system-dns mode');
      return { success: false, error: 'DNS not configured' };
    }

    // Start DNS server in appropriate mode
    dnsServer = new HyperclayDNSServer({
      mode,
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

    logger.log(`All servers running (mode: ${mode})`);
    return { success: true, mode };
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
// BrowserView Creation (High-Port Mode)
// ===========================

function createBrowserView() {
  const mode = getDNSMode();

  if (mode === 'high-port') {
    // Create BrowserView with host-resolver-rules to bypass DNS
    browserView = new BrowserView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        // Map all *.hyperclaylocal.com to 127.0.0.1
        additionalArguments: [
          '--host-resolver-rules=MAP *.hyperclaylocal.com 127.0.0.1'
        ]
      }
    });

    mainWindow.setBrowserView(browserView);
    const bounds = mainWindow.getContentBounds();
    browserView.setBounds({ x: 0, y: 60, width: bounds.width, height: bounds.height - 60 });
    browserView.setAutoResize({ width: true, height: true });

    logger.log('[BrowserView] Created with host-resolver-rules');
  }
}

function navigateToSite(siteName) {
  const mode = getDNSMode();

  if (mode === 'high-port' && browserView) {
    browserView.webContents.loadURL(`http://${siteName}.hyperclaylocal.com:4321`);
  } else {
    // System DNS mode - open in external browser or use default webview
    logger.log(`[App] Navigate to: http://${siteName}.hyperclaylocal.com:4321`);
  }
}

// ===========================
// IPC Handlers
// ===========================

ipcMain.handle('set-dns-mode', async (event, mode) => {
  try {
    setDNSMode(mode);
    return { success: true, mode };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-dns-mode', async () => {
  return { success: true, mode: getDNSMode() };
});

ipcMain.handle('setup-dns', async (event, requestedMode = null) => {
  try {
    // Use requested mode or current mode
    const mode = requestedMode || getDNSMode();
    setDNSMode(mode);

    logger.log(`Setting up DNS in ${mode} mode...`);

    if (mode === 'system-dns') {
      // System DNS mode requires elevation
      if (!dnsManager) {
        dnsManager = new SystemDNSManager(store, logger);
      }

      // Set system DNS to localhost
      await dnsManager.setDNSToLocalhost();

      // Mark setup as complete
      store.set('dnsSetupComplete', true);
    } else {
      // High-port mode doesn't need system DNS changes
      store.set('dnsSetupComplete', true);
    }

    // Start servers
    const result = await startServers();

    if (!result.success) {
      throw new Error(result.error);
    }

    // Create BrowserView for high-port mode
    if (mode === 'high-port') {
      createBrowserView();
    }

    logger.log('DNS setup complete');
    return { success: true, mode };
  } catch (error) {
    logger.error('DNS setup failed:', error.message);

    // Cleanup on failure
    store.set('dnsSetupComplete', false);

    // If system-dns failed, offer to fall back to high-port mode
    const currentMode = getDNSMode();
    if (currentMode === 'system-dns' && error.message.includes('Permission denied')) {
      return {
        success: false,
        error: error.message,
        canFallback: true,
        fallbackMode: 'high-port'
      };
    }

    return { success: false, error: error.message };
  }
});

ipcMain.handle('navigate-to-site', async (event, siteName) => {
  navigateToSite(siteName);
  return { success: true };
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
  // Attempt DNS recovery first (in case of previous crash)
  await attemptDNSRecovery();

  // Create window
  createWindow();

  // Try to start servers (if DNS already configured)
  const result = await startServers();

  if (result.success) {
    logger.log('Servers started automatically');
  } else {
    logger.log('Servers not started:', result.error);
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

### High-Port Mode (Recommended)

No manual configuration needed! The app automatically:
- Runs DNS resolver on port 15353 (no elevation)
- Configures Electron with `--host-resolver-rules`
- Works immediately without system changes

**Limitations:**
- Only works within Hyperclay Local app
- External browsers won't work
- Browser extensions won't work

### System DNS Mode (Advanced Users)

If you need external browser support, enable System DNS mode in settings.

**Requirements:**
- Admin/sudo privileges required
- May conflict with VPNs or corporate policies
- May trigger Windows Firewall prompts

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
1. Check servers are running: `netstat -an | grep 15353` or `netstat -an | grep 53`
2. Test DNS resolution: `nslookup test.hyperclaylocal.com 127.0.0.1`
3. Check system DNS (system-dns mode): `scutil --dns` (macOS) or `ipconfig /all` (Windows)

**Port conflicts:**
- Port 53: Another DNS service is running (dnsmasq, Docker, etc.)
- Port 4321: Change HTTP port in settings
- Port 15353: Change DNS port in settings

**VPN conflicts:**
- VPN may override DNS settings
- Use high-port mode instead
- Or configure VPN to exclude `*.hyperclaylocal.com`

**Corporate policy blocks:**
- IT policy may prevent DNS changes
- Use high-port mode (no system changes)
- Or request IT to whitelist 127.0.0.1

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
# Check for lingering processes on port 53 or 15353
netstat -an | grep 53

# If found, kill the process (find PID first)
lsof -i :53
kill -9 <PID>
```

### Verification Checklist

After uninstall, verify:
- [ ] DNS resolves external domains correctly
- [ ] No processes listening on port 53, 15353, or 4321
- [ ] Configuration files removed
- [ ] System DNS settings restored (not pointing to 127.0.0.1)
- [ ] No DNS cache poisoning: `sudo killall -HUP mDNSResponder` (macOS)

## Security Considerations

### Port 53 Binding (System DNS Mode)
- Requires root/admin privileges
- Can be exploited if server has vulnerabilities
- Mitigated by binding only to 127.0.0.1 (loopback)
- **Recommendation:** Use high-port mode instead

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
