# Blocking Issues – Bundled DNS Server (Revised Plan)

1. **Theory-only implementation**  
   All referenced modules (`src/dns-server`, `system-dns-manager`, `http-server`, setup UI) still live only in the markdown. No source files or wiring exist in the repo, so nothing actually runs. The plan must be materialised into code before it can be evaluated.
   - *Option A*: Create the described modules (DNS server, DNS manager, HTTP server, setup UI), wire them into `main.js`, preload, and renderer, and add integration tests.
   - *Option B*: If development time is limited, start with the protocol-handler fallback (no system changes), then incrementally add the privileged flow in a separate branch.

2. **macOS DNS service detection still brittle**  
   The logic depends on parsing `networksetup` output and falls back to assumptions like “Wi-Fi”. Localised service names or nonstandard interface lists will make DNS updates fail silently, leaving users with half-configured networking. A more robust discovery approach is required.
   - *Option A*: Use `networksetup -listallnetworkservices` and keep only services where `networksetup -getdnsservers` succeeds, independent of localisation.
   - *Option B*: Query `scutil --dns` and map the hardware ports returned by `networksetup -listnetworkserviceorder` to service names; apply DNS only to those currently in use.

3. **Linux NetworkManager unsupported**  
   The plan only covers systemd-resolved and direct `/etc/resolv.conf` writes. On modern distros with NetworkManager, those changes are immediately overwritten, so DNS reverts and full-browser mode breaks. Add an `nmcli` path (or equivalent) before shipping.
   - *Option A*: Detect NetworkManager (`nmcli -t dev status`) and use `nmcli` commands to set DNS on the active connection profiles, then restart networking.
   - *Option B*: Offer a guided manual step (“Open your Network settings and set DNS to 127.0.0.1, 8.8.8.8”) for NetworkManager-based systems if automated configuration proves too risky.

4. **No privilege detection / fallback**  
   Binding to port 53 and editing DNS still proceed without checking for admin rights. When the process lacks elevation, users just see hard errors. Guard these operations with explicit privilege checks and surface a guided fallback when elevation is unavailable.
   - *Option A*: Use platform-specific privilege checks (`process.getuid() === 0` on POSIX, `is-elevated` on Windows) and show a modal offering elevation or protocol-handler fallback before starting DNS/HTTP services.
   - *Option B*: Launch a separate helper process or service that runs with elevated privileges while keeping the main Electron app unprivileged; fall back to in-app protocol mode in environments where elevation is denied.
