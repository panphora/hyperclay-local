## Desktop App Code Signing & Packaging with `electron-builder`

Covers:

* **Windows** (Azure Trusted Signing / Managed Signing Services)
* **macOS** (Apple Developer ID + notarization)

Assumes you're using `electron-builder` to generate installers for macOS, Windows, and Linux. `electron-builder` can sign and notarize macOS, and can sign Windows builds (including via Azure Trusted Signing) if you give it the right credentials. ([electron.build][1])

---

## Prerequisites

Install the required npm packages if not already present:

```bash
npm install --save-dev @electron/notarize
```

`electron-builder` should already be installed as a dev dependency.

---

# 1. Windows signing (Azure Trusted Signing)

## What this does

Windows warns/blocklists unsigned apps with “Unknown Publisher” and SmartScreen popups. Signing proves who published the app and that it wasn’t tampered with, which reduces/block removes those scary warnings. ([electron.build][1])

Microsoft now offers **Azure Trusted Signing**, which is a managed signing service (no USB token, no exporting private keys). You create a Trusted Signing account in Azure, register an app, and get credentials. `electron-builder` can then ask Azure to sign your `.exe` / installer at build time. ([electron.build][1])

---

## Step 1. Set up Azure Trusted Signing

1. Create (or use) an Azure subscription.
2. In Azure, create a **Trusted Signing Account**. This gives you a signing “account” and lets you create certificate profiles.
3. Create an **App registration** in Entra ID (formerly Azure AD).
4. Create a **Client Secret** for that app registration.
5. Assign that app registration the role **Trusted Signing Certificate Profile Signer** in your Trusted Signing Account.

   * This lets that app call the signing service. ([electron.build][1])

That gives you:

* **Tenant ID** (Azure AD Tenant)
* **Client ID** (Application / Client ID from the app registration)
* **Client Secret** (the generated secret value)
* **Trusted Signing Account name**
* **Certificate profile name**
* **Endpoint** you chose when creating the certificate profile
* **Publisher name** (CN from the certificate profile — must match exactly) ([electron.build][1])

---

## Step 2. Add Windows signing config to `electron-builder`

In your `package.json` under `"build"`, add a `win` block and include `azureSignOptions`:

```json
"build": {
  "appId": "com.hyperclay.local-server",
  "win": {
    "target": ["nsis"],
    "azureSignOptions": {
      "publisherName": "CN=Hyperclay",
      "endpoint": "https://eus.codesigning.azure.net",
      "certificateProfileName": "HyperclayLocalPublicCertProfile",
      "codeSigningAccountName": "Hyperclay"
    }
  },
  "linux": {
    "target": ["AppImage","deb"]
  },
  "mac": {
    "target": ["dmg","zip"],
    "hardenedRuntime": true,
    "entitlements": "entitlements.plist",
    "entitlementsInherit": "entitlements.plist",
    "gatekeeperAssess": false,
    "category": "public.app-category.developer-tools"
  },
  "afterSign": "build-scripts/notarize.js"
}
```

What those Windows fields mean (must match what you set up in Azure Trusted Signing):

* `publisherName`: must match the certificate CN exactly (e.g., "CN=Hyperclay" - you can find this in your Azure Trusted Signing certificate profile details)
* `endpoint`: the Trusted Signing API endpoint for your cert profile (e.g., "https://eus.codesigning.azure.net" for East US)
* `certificateProfileName`: the profile you created in Azure Trusted Signing
* `codeSigningAccountName`: the Trusted Signing Account name (not the app registration name) ([electron.build][1])

---

## Step 3. Provide Azure auth as env vars

Before you run `npm run dist`, export these in the shell that will run the build:

```bash
export AZURE_TENANT_ID="your-tenant-id"
export AZURE_CLIENT_ID="your-app-registration-client-id"
export AZURE_CLIENT_SECRET="your-client-secret"
```

These map to:

* Tenant ID in Entra ID
* Application (Client) ID of your app registration
* The “Secret value” you generated

This is enough for the common “service principal with secret” auth flow, which `electron-builder` hands off to Microsoft’s signing module under the hood. ([electron.build][1])

You do **not** manually handle .pfx / USB-token certs in this path. Azure holds and applies the cert for you (Managed Signing Service). ([electron.build][1])

---

## Step 4. Build for Windows

Run:

```bash
npm run dist
```

`electron-builder` will:

1. Package your Windows app (e.g. NSIS installer).
2. Call Azure Trusted Signing with the env vars + `azureSignOptions`.
3. Get the signed binary back so the installer/exe is trusted.

You now have a signed Windows installer without touching hardware tokens or EV dongles. ([electron.build][1])

---

# 2. macOS signing + notarization

## What this does

macOS Gatekeeper blocks unsigned / unnotarized apps with scary warnings or prevents launch entirely. To ship outside the App Store, you must:

1. Sign your `.app` with an Apple-issued **Developer ID Application** certificate.
2. Send it to Apple for **notarization**.
3. “Staple” the notarization ticket so it launches cleanly on other Macs. ([electronjs.org][2])

`electron-builder` already knows how to sign, and then we wire in a small script to notarize using your Apple ID credentials. ([electronjs.org][2])

---

## Step 1. Join the Apple Developer Program

You (or your company) must be in the paid Apple Developer Program (~$99/year). Without that you cannot create a Developer ID Application cert or notarize. ([bigbinary.com][3])

---

## Step 2. Create / install the "Developer ID Application" certificate

On a Mac:

1. Sign into Xcode with your Apple Developer account.
2. Xcode → Settings → Accounts → select your team → “Manage Certificates…”.
3. Click ➕ → **Developer ID Application**.

   * This cert is specifically for distributing apps *outside* the Mac App Store. ([bigbinary.com][3])
4. That generates the cert + private key into your **login** keychain.
5. In Keychain Access → My Certificates, right-click the “Developer ID Application: Your Org (TeamID)” entry → Export → save as `.p12` and give it a password. You’ll reuse that for CI, but locally just having it in your login keychain is enough. ([Stack Overflow][4])

You can verify the cert is installed with:

```bash
security find-identity -p codesigning -v
```

You should see “Developer ID Application: …”. ([electronforge.io][5])

---

## Step 3. Add entitlements + hardened runtime

In your project root, create `entitlements.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.app-sandbox</key>
  <false/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
</dict>
</plist>
```

Why this matters:

* Apple requires “hardened runtime” + explicit entitlements for apps you notarize.
* Those entitlements describe what the app can access (microphone, camera, dynamic libraries, etc.).
* `electron-builder` will embed them when signing. ([electronforge.io][5])

---

## Step 4. Add mac config + notarization hook to `electron-builder`

In `package.json` under `"build"` (you already saw Windows above), keep the `mac` block and also add an `afterSign` script that calls Apple’s notary service using `@electron/notarize`:

**`package.json` (excerpt):**

```json
"build": {
  "appId": "com.hyperclay.local-server",
  "mac": {
    "target": ["dmg","zip"],
    "hardenedRuntime": true,
    "entitlements": "entitlements.plist",
    "entitlementsInherit": "entitlements.plist",
    "gatekeeperAssess": false,
    "category": "public.app-category.developer-tools"
  },
  "afterSign": "build-scripts/notarize.js"
}
```

**`build-scripts/notarize.js`:**

```js
const { notarize } = require('@electron/notarize');

exports.default = async function notarizeApp(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;

  return await notarize({
    appBundleId: process.env.MAC_BUNDLE_ID,
    appPath: `${appOutDir}/${appName}.app`,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID
  });
};
```

What’s happening:

* `electron-builder` signs the `.app` using your Developer ID Application cert in your keychain.
* After signing, we call Apple’s notarization service with your Apple ID credentials and team ID.
* Apple scans the app and returns a “notarization ticket.”
* The build then staples that ticket so Gatekeeper will allow it to launch on other Macs without extra steps. ([electronjs.org][2])

---

## Step 5. Export the required env vars on mac before building

```bash
export APPLE_ID="your-apple-developer-login@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="YOUR10CHAR"
export MAC_BUNDLE_ID="com.hyperclay.local-server"
```

Where to get each:

* `APPLE_ID`: the Apple Developer login email you use in Xcode / developer.apple.com.
* `APPLE_APP_SPECIFIC_PASSWORD`: generate this at appleid.apple.com → Security → “Generate app-specific password…”. Apple requires using an app-specific password (not your real password) for automated notarization. ([bigbinary.com][3])
* `APPLE_TEAM_ID`: 10-character Team ID in your Apple Developer membership.
* `MAC_BUNDLE_ID`: your reverse-DNS bundle identifier (must match `appId` and what you sign/notarize). ([bigbinary.com][3])

Because your Developer ID Application cert is already in your local login keychain, you do **not** need to set `CSC_LINK`/`CSC_KEY_PASSWORD` locally. (Those are for CI where you’d import the `.p12`.) ([Stack Overflow][4])

---

## Step 6. Build for macOS (and everything else)

Run:

```bash
npm run dist
```

`electron-builder` will:

1. Package mac `.app` / `.dmg`
2. Sign with your Developer ID Application cert
3. Notarize via Apple
4. Staple the ticket
5. Also build Windows (signed through Azure Trusted Signing) and Linux targets from the same config. ([electron.build][1])

---

# Final mental model

* **Windows:**

  * Set up Azure Trusted Signing (Managed Signing Service) → get Tenant ID, Client ID, Client Secret, plus Trusted Signing account info.
  * Put those into env vars + `win.azureSignOptions`.
  * Build. Windows installer comes out already signed by Microsoft’s managed service, no USB dongle. ([electron.build][1])

* **macOS:**

  * Join Apple Developer Program.
  * Create “Developer ID Application” cert in Xcode, which lands in your login keychain.
  * Add `entitlements.plist`, `mac` config, and `notarize.js`.
  * Export env vars for Apple ID, app-specific password, Team ID, bundle ID.
  * Build. You get a signed + notarized `.dmg` that opens on other Macs without Gatekeeper drama. ([bigbinary.com][3])

[1]: https://www.electron.build/code-signing-win.html?utm_source=chatgpt.com "Windows"
[2]: https://electronjs.org/docs/latest/tutorial/code-signing?utm_source=chatgpt.com "Code Signing"
[3]: https://www.bigbinary.com/blog/code-sign-notorize-mac-desktop-app?utm_source=chatgpt.com "How to code-sign and notarize an Electron application for ..."
[4]: https://stackoverflow.com/questions/14954074/export-development-certificate-as-p12?utm_source=chatgpt.com "Export development certificate as p12"
[5]: https://www.electronforge.io/guides/code-signing/code-signing-macos?utm_source=chatgpt.com "Signing a macOS app"
