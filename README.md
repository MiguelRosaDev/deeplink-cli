# 🚀 deeplink-cli

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green.svg)](https://nodejs.org/)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-0-success.svg)](package.json)

A modern, zero-dependency CLI & SDK to test, verify, inspect, and scaffold mobile **Deep Links**, **iOS Universal Links**, and **Android App Links**.

Works seamlessly with any mobile framework: **Native iOS (Swift/ObjC)**, **Native Android (Kotlin/Java)**, **Flutter**, **React Native**, **Cordova**, and **Capacitor**.

---

## ⚡ Key Capabilities

* **📱 Multi-Platform Link Launcher**: Fire custom schemes (`myapp://...`), Universal Links, and App Links on active iOS Simulators (`xcrun simctl`) and Android devices / emulators (`adb`) with a single command.
* **🔍 Remote Domain Verifier**: Validate your live `apple-app-site-association` (AASA) and `assetlinks.json` endpoints. Checks HTTP status 200, catches illegal redirects (which Apple rejects!), validates SSL, content-types, JSON structure, and tests route matching.
* **🕵️ Mobile Project Manifest Auditor**: Scan local source directories (`AndroidManifest.xml`, `Info.plist`, `*.entitlements`, `config.xml`) to catch common configuration bugs before deployment (missing `android:autoVerify="true"`, missing `BROWSABLE` category, or missing associated domain entitlements).
* **🛠️ Associated Domain Scaffolder**: Generate production-ready, standardized AASA and `assetlinks.json` files in seconds.
* **Zero External Dependencies**: Powered purely by native Node.js 18+ (ESM + built-in `fetch`).

---

## 📦 Installation & Quick Setup

Clone the repository and run directly:

```bash
git clone https://github.com/MiguelRosaDev/deeplink-cli.git
cd deeplink-cli
chmod +x deeplink.mjs
```

> **Tip:** Run `npm link` inside the repo directory to make `deeplink` available globally in your terminal:
> ```bash
> npm link
> deeplink --help
> ```

---

## 📖 Command Reference

### 1. Discover Running Devices & Simulators
List booted iOS simulators and connected Android devices/emulators:
```bash
./deeplink.mjs devices
```

---

### 2. Trigger & Test Deep Links (`open` / `test`)
Open any custom scheme or HTTP(S) deep link on your devices:

```bash
# Open on all active/booted devices (both iOS Simulator & Android)
./deeplink.mjs open "myapp://profile/user-42"

# Target only iOS Simulators
./deeplink.mjs open "https://example.com/item/100" --platform ios

# Target only Android devices/emulators
./deeplink.mjs open "https://example.com/checkout?promo=SAVE20" --platform android

# Target a specific Android package (prevents the OS app-picker chooser)
./deeplink.mjs open "https://example.com/order/5" --package com.example.app

# Target a specific device by UDID / ADB Serial
./deeplink.mjs open "myapp://settings" --device emulator-5554

# Preview command without executing
./deeplink.mjs open "myapp://cart" --dry-run
```

---

### 3. Verify Remote Domain Configuration (`verify` / `check`)
Inspect remote `.well-known` endpoints for iOS Universal Links and Android App Links:

```bash
# Verify domain files (AASA & assetlinks.json)
./deeplink.mjs verify "example.com"

# Verify domain AND test if a specific route matches the AASA paths
./deeplink.mjs verify "https://example.com/checkout/order-99"
```

**What it validates:**
* **iOS (`apple-app-site-association`)**:
  * HTTP status (must be `200`).
  * **Redirect check** (Apple strictly fails if the server returns 301/302 redirects!).
  * Content-Type header (`application/json`).
  * Valid JSON structure and `applinks.details` schema.
  * Extracted App IDs (`<TeamID>.<BundleID>`) and supported path patterns.
  * Route matching for the specified link path.
* **Android (`assetlinks.json`)**:
  * HTTP status `200` and `application/json`.
  * Valid JSON statement list with `namespace: android_app`.
  * Package names and SHA-256 certificate fingerprints.

---

### 4. Audit Local Project Manifests (`audit` / `inspect`)
Audit local mobile project source trees for deep link configurations:

```bash
# Audit the current working directory
./deeplink.mjs audit

# Audit a specific mobile project directory
./deeplink.mjs audit /path/to/my-mobile-app
```

**What it detects:**
* **Android**: Intent filters in `AndroidManifest.xml` (`android.intent.action.VIEW`, `DEFAULT`, `BROWSABLE`, `android:autoVerify="true"`, schemes, hosts, and paths). Flags missing categories.
* **iOS**: Associated domain entitlements (`com.apple.developer.associated-domains` with `applinks:...`) and custom schemes in `Info.plist` (`CFBundleURLSchemes`).
* **Hybrid / Frameworks**: Deep link plugin settings in Cordova/Capacitor `config.xml`.

---

### 5. Scaffold Associated Domain Files (`generate` / `scaffold`)
Generate standard files ready to upload to your web server:

```bash
# Generate both iOS AASA and Android assetlinks.json in the current directory
./deeplink.mjs generate all \
  --team-id "ABCDE12345" \
  --bundle-id "com.example.app" \
  --package "com.example.app" \
  --paths "/item/*,/checkout/*" \
  --sha256 "14:6D:E9:DE:0F:73:C7:CE:00:E9:73:C7:CE:00:E9:73:C7:CE:00:E9:73:C7:CE:00:E9:73:C7:CE:00:E9:73:C7"

# Generate only apple-app-site-association into a specific directory
./deeplink.mjs generate aasa --team-id "ABCDE12345" --bundle-id "com.example.app" --out ./public/.well-known
```

---

### 6. Link Presets & Configuration (`deeplink.config.json`)

Initialize a configuration file to save frequently tested links and default identifiers:

```bash
./deeplink.mjs init
```

Edit `deeplink.config.json`:
```json
{
  "ios": {
    "bundleId": "com.example.app",
    "teamId": "ABCDE12345"
  },
  "android": {
    "packageName": "com.example.app"
  },
  "presets": {
    "home": "myapp://home",
    "profile": "myapp://profile/user-42",
    "checkout": "https://example.com/checkout?promo=WELCOME"
  }
}
```

Now you can open deep links simply using preset names:
```bash
./deeplink.mjs open checkout
./deeplink.mjs open profile
```

---

## 💻 Programmatic SDK Usage

You can also import functions in Node.js scripts or test suites:

```javascript
import {
  openDeepLink,
  verifyRemoteDeepLinks,
  auditProjectDeepLinks,
  listAllDevices,
} from './deeplink.mjs';

// 1. Discover devices
const { android, ios } = listAllDevices();
console.log(`Connected Android: ${android.length}, Booted iOS: ${ios.filter(d => d.isBooted).length}`);

// 2. Open link on booted simulator / device
await openDeepLink('myapp://dashboard', { platform: 'all' });

// 3. Verify remote domain setup
const report = await verifyRemoteDeepLinks('https://example.com/cart');
console.log('iOS AASA valid:', report.ios.validJson);
console.log('Android AssetLinks valid:', report.android.validJson);
```

---

## 📄 License

Distributed under the [MIT License](LICENSE).
