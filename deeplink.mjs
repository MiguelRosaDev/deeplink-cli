#!/usr/bin/env node
/**
 * deeplink-cli (Zero-Dependency, Node.js 18+)
 *
 * A modern, cross-platform CLI tool to test, verify, inspect, and scaffold
 * Deep Links, iOS Universal Links, and Android App Links.
 *
 * Features:
 *  - Trigger & test deep links on iOS Simulators & Android Devices/Emulators
 *  - Verify remote `apple-app-site-association` (AASA) & `assetlinks.json` endpoints
 *  - Audit local project manifests (AndroidManifest.xml, Info.plist, Entitlements)
 *  - Scaffold production-ready AASA and assetlinks.json configuration files
 *  - Preset management via local `deeplink.config.json`
 *  - Auto-detection of Xcode developer directory and Android SDK / ADB
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── ANSI Terminal Colors ────────────────────────────────────────────────────
const isTTY = process.stdout.isTTY;
const c = {
  reset: isTTY ? '\x1b[0m' : '',
  bold: isTTY ? '\x1b[1m' : '',
  dim: isTTY ? '\x1b[2m' : '',
  red: isTTY ? '\x1b[31m' : '',
  green: isTTY ? '\x1b[32m' : '',
  yellow: isTTY ? '\x1b[33m' : '',
  blue: isTTY ? '\x1b[34m' : '',
  magenta: isTTY ? '\x1b[35m' : '',
  cyan: isTTY ? '\x1b[36m' : '',
  gray: isTTY ? '\x1b[90m' : '',
};

// ─── Environment & Tool Resolvers ────────────────────────────────────────────
export function resolveAdbPath() {
  if (process.env.ADB_PATH && fs.existsSync(process.env.ADB_PATH)) {
    return process.env.ADB_PATH;
  }

  // 1. Check if adb is on PATH
  try {
    const whichRes = execSync('which adb', { stdio: ['pipe', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
    if (whichRes && fs.existsSync(whichRes)) return whichRes;
  } catch {
    // Continue fallback
  }

  // 2. Check standard environment variables
  const sdkRoots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    path.join(os.homedir(), 'Library', 'Android', 'sdk'), // macOS
    path.join(os.homedir(), 'Android', 'Sdk'), // Linux
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : null, // Windows
  ].filter(Boolean);

  for (const root of sdkRoots) {
    const candidate = path.join(root, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

export function resolveXcodeDeveloperDir() {
  if (process.env.DEVELOPER_DIR && fs.existsSync(process.env.DEVELOPER_DIR)) {
    return process.env.DEVELOPER_DIR;
  }

  // Check if standard xcrun simctl works
  try {
    const check = spawnSync('xcrun', ['simctl', 'help'], { stdio: ['pipe', 'pipe', 'ignore'] });
    if (check.status === 0) return null; // Standard xcode-select works fine
  } catch {
    // Fall back
  }

  // Common macOS Xcode locations
  const candidates = [
    '/Applications/Xcode.app/Contents/Developer',
    '/Applications/Xcode-beta.app/Contents/Developer',
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

export function runSimctl(args) {
  const devDir = resolveXcodeDeveloperDir();
  const env = { ...process.env };
  if (devDir) {
    env.DEVELOPER_DIR = devDir;
  }
  return spawnSync('xcrun', ['simctl', ...args], { env, encoding: 'utf8' });
}

export function runAdb(args) {
  const adb = resolveAdbPath();
  if (!adb) {
    throw new Error(
      'Android Debug Bridge (adb) was not found.\n' +
        'Please install the Android SDK or ensure platform-tools is added to PATH.'
    );
  }
  return spawnSync(adb, args, { encoding: 'utf8' });
}

// ─── Device Discovery ────────────────────────────────────────────────────────
export function getConnectedAndroidDevices() {
  const adb = resolveAdbPath();
  if (!adb) return [];

  try {
    const res = runAdb(['devices', '-l']);
    if (res.status !== 0 || !res.stdout) return [];

    const lines = res.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    const devices = [];

    for (const line of lines.slice(1)) {
      if (line.startsWith('* daemon')) continue;
      const parts = line.split(/\s+/);
      if (parts.length >= 2) {
        const id = parts[0];
        const status = parts[1];
        const modelMatch = line.match(/model:([^\s]+)/);
        const productMatch = line.match(/product:([^\s]+)/);
        const model = modelMatch ? modelMatch[1].replace(/_/g, ' ') : productMatch ? productMatch[1] : 'Android Device';
        const isEmulator = id.startsWith('emulator-');

        devices.push({
          platform: 'android',
          id,
          name: `${model} (${id})`,
          status,
          isEmulator,
        });
      }
    }
    return devices;
  } catch {
    return [];
  }
}

export function getIOSSimulators({ bootedOnly = false } = {}) {
  try {
    const res = runSimctl(['list', 'devices', '-j']);
    if (res.status !== 0 || !res.stdout) return [];

    const data = JSON.parse(res.stdout);
    const devicesByRuntime = data.devices || {};
    const result = [];

    for (const [runtime, devList] of Object.entries(devicesByRuntime)) {
      if (!Array.isArray(devList)) continue;
      const runtimeName = runtime.replace(/^com\.apple\.CoreSimulator\.SimRuntime\./, '').replace(/-/g, ' ');

      for (const dev of devList) {
        if (!dev.isAvailable) continue;
        const isBooted = dev.state === 'Booted';
        if (bootedOnly && !isBooted) continue;

        result.push({
          platform: 'ios',
          id: dev.udid,
          name: `${dev.name} [${runtimeName}]`,
          state: dev.state,
          isBooted,
        });
      }
    }

    return result;
  } catch {
    return [];
  }
}

export function listAllDevices() {
  const android = getConnectedAndroidDevices();
  const ios = getIOSSimulators();
  return { android, ios };
}

// ─── Configuration Loader ────────────────────────────────────────────────────
export function findConfigPath(customPath) {
  if (customPath) return path.resolve(customPath);
  if (process.env.DEEPLINK_CONFIG_PATH) return path.resolve(process.env.DEEPLINK_CONFIG_PATH);

  const candidates = [
    path.resolve(process.cwd(), 'deeplink.config.json'),
    path.resolve(process.cwd(), '.deeplink.config.json'),
    path.resolve(__dirname, 'deeplink.config.json'),
    path.resolve(__dirname, 'deeplink.config.example.json'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.resolve(process.cwd(), 'deeplink.config.json');
}

export function loadConfig(options = {}) {
  const configPath = findConfigPath(options.configPath);
  let fileConfig = {};

  if (fs.existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (err) {
      throw new Error(`Error reading configuration file (${configPath}): ${err.message}`);
    }
  }

  return {
    configPath,
    ios: fileConfig.ios || {},
    android: fileConfig.android || {},
    presets: fileConfig.presets || {},
  };
}

// ─── Deep Link Tester (open / test) ──────────────────────────────────────────
export async function openDeepLink(targetInput, options = {}) {
  const config = loadConfig({ configPath: options.configPath });
  const dryRun = Boolean(options.dryRun);

  // Check if target is a preset
  let url = targetInput;
  if (config.presets && config.presets[targetInput]) {
    url = config.presets[targetInput];
    console.log(`${c.dim}Using preset "${targetInput}": ${url}${c.reset}`);
  }

  if (!url) {
    throw new Error('A valid Deep Link URL or configured preset name is required.');
  }

  const platform = (options.platform || 'all').toLowerCase();
  const targetDevice = options.device;
  const packageName = options.package || config.android?.packageName;
  const results = [];

  // 1. Handle Android
  if (platform === 'all' || platform === 'android') {
    const devices = getConnectedAndroidDevices().filter((d) => d.status === 'device');

    if (devices.length === 0) {
      results.push({
        platform: 'android',
        status: 'skipped',
        message: 'No connected Android devices or running emulators found.',
      });
    } else {
      const selectedDevices = targetDevice
        ? devices.filter((d) => d.id === targetDevice)
        : devices;

      for (const dev of selectedDevices) {
        const adbArgs = ['-s', dev.id, 'shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', url];
        if (packageName) {
          adbArgs.push(packageName);
        }

        if (dryRun) {
          results.push({
            platform: 'android',
            device: dev.name,
            dryRun: true,
            command: `adb ${adbArgs.join(' ')}`,
          });
        } else {
          try {
            const res = runAdb(adbArgs);
            const output = res.stdout || res.stderr || '';
            const isError = res.status !== 0 || output.includes('Error:');

            results.push({
              platform: 'android',
              device: dev.name,
              id: dev.id,
              status: isError ? 'failed' : 'success',
              output: output.trim(),
            });
          } catch (err) {
            results.push({
              platform: 'android',
              device: dev.name,
              status: 'failed',
              error: err.message,
            });
          }
        }
      }
    }
  }

  // 2. Handle iOS
  if (platform === 'all' || platform === 'ios') {
    if (process.platform !== 'darwin') {
      results.push({
        platform: 'ios',
        status: 'skipped',
        message: 'iOS Simulator testing is only supported on macOS.',
      });
    } else {
      const bootedSimulators = getIOSSimulators({ bootedOnly: true });

      if (bootedSimulators.length === 0) {
        results.push({
          platform: 'ios',
          status: 'skipped',
          message: 'No booted iOS simulators found. Launch an iOS Simulator or run with an explicit device UDID.',
        });
      } else {
        const selectedSims = targetDevice
          ? bootedSimulators.filter((s) => s.id === targetDevice)
          : bootedSimulators;

        for (const sim of selectedSims) {
          const simArgs = ['openurl', sim.id, url];

          if (dryRun) {
            results.push({
              platform: 'ios',
              device: sim.name,
              dryRun: true,
              command: `xcrun simctl ${simArgs.join(' ')}`,
            });
          } else {
            const res = runSimctl(simArgs);
            const output = res.stdout || res.stderr || '';
            const isError = res.status !== 0;

            results.push({
              platform: 'ios',
              device: sim.name,
              id: sim.id,
              status: isError ? 'failed' : 'success',
              output: isError ? output.trim() : 'Link opened in iOS Simulator.',
            });
          }
        }
      }
    }
  }

  return { url, results };
}

// ─── Remote Associated Domain Verifier (verify / check) ──────────────────────
export function extractDomainAndPath(inputUrl) {
  let domain = inputUrl;
  let testPath = '/';

  try {
    const parsed = new URL(inputUrl.includes('://') ? inputUrl : `https://${inputUrl}`);
    domain = parsed.hostname;
    testPath = parsed.pathname || '/';
  } catch {
    domain = inputUrl.replace(/^https?:\/\//, '').split('/')[0];
  }

  return { domain, testPath };
}

export async function verifyRemoteDeepLinks(targetInput, options = {}) {
  const { domain, testPath } = extractDomainAndPath(targetInput);
  const results = {
    domain,
    testPath,
    ios: { checked: false },
    android: { checked: false },
  };

  // ── 1. Check iOS Universal Links (apple-app-site-association) ───────────────
  const aasaUrls = [
    `https://${domain}/.well-known/apple-app-site-association`,
    `https://${domain}/apple-app-site-association`,
  ];

  for (const url of aasaUrls) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (deeplink-cli)' },
        redirect: 'manual', // Apple strictly disallows redirects for AASA!
      });

      const isRedirect = res.status >= 300 && res.status < 400;
      const contentType = res.headers.get('content-type') || '';
      const text = await res.text();
      let parsedJson = null;
      let jsonError = null;

      try {
        parsedJson = JSON.parse(text);
      } catch (err) {
        jsonError = err.message;
      }

      const hasApplinks = parsedJson && (parsedJson.applinks || parsedJson.activitycontinuation);
      const details = parsedJson?.applinks?.details || [];

      // Extract registered app IDs and paths
      const appIds = [];
      const paths = [];

      if (Array.isArray(details)) {
        for (const item of details) {
          if (item.appIDs) appIds.push(...item.appIDs);
          if (item.appID) appIds.push(item.appID);
          if (Array.isArray(item.paths)) paths.push(...item.paths);
          if (Array.isArray(item.components)) {
            for (const comp of item.components) {
              if (comp['/']) paths.push(comp['/']);
            }
          }
        }
      } else if (typeof details === 'object' && details !== null) {
        // Legacy or dictionary format
        for (const [k, v] of Object.entries(details)) {
          appIds.push(k);
          if (v && Array.isArray(v.paths)) paths.push(...v.paths);
        }
      }

      // Check if testPath matches
      let pathMatches = false;
      if (paths.length > 0) {
        pathMatches = paths.some((pattern) => {
          if (pattern === '*') return true;
          if (pattern.endsWith('*')) return testPath.startsWith(pattern.slice(0, -1));
          return testPath === pattern;
        });
      }

      results.ios = {
        checked: true,
        url,
        status: res.status,
        isRedirect,
        redirectLocation: isRedirect ? res.headers.get('location') : null,
        contentType,
        validJson: parsedJson !== null,
        jsonError,
        hasApplinks: Boolean(hasApplinks),
        appIds: [...new Set(appIds)],
        paths: [...new Set(paths)],
        pathMatches,
      };

      if (res.status === 200 && parsedJson) break; // Found valid AASA
    } catch (err) {
      results.ios = {
        checked: true,
        url,
        error: err.message,
      };
    }
  }

  // ── 2. Check Android App Links (assetlinks.json) ───────────────────────────
  const assetlinksUrl = `https://${domain}/.well-known/assetlinks.json`;
  try {
    const res = await fetch(assetlinksUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (deeplink-cli)' },
    });

    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();
    let parsedJson = null;
    let jsonError = null;

    try {
      parsedJson = JSON.parse(text);
    } catch (err) {
      jsonError = err.message;
    }

    const isArray = Array.isArray(parsedJson);
    const packages = [];
    const fingerprints = [];

    if (isArray) {
      for (const statement of parsedJson) {
        const target = statement.target || {};
        if (target.namespace === 'android_app') {
          if (target.package_name) packages.push(target.package_name);
          if (Array.isArray(target.sha256_cert_fingerprints)) {
            fingerprints.push(...target.sha256_cert_fingerprints);
          }
        }
      }
    }

    results.android = {
      checked: true,
      url: assetlinksUrl,
      status: res.status,
      contentType,
      validJson: isArray,
      jsonError,
      packages: [...new Set(packages)],
      fingerprints: [...new Set(fingerprints)],
    };
  } catch (err) {
    results.android = {
      checked: true,
      url: assetlinksUrl,
      error: err.message,
    };
  }

  return results;
}

// ─── Local Mobile Project Manifest Auditor ───────────────────────────────────
export function auditProjectDeepLinks(rootDir = process.cwd()) {
  const findings = {
    android: [],
    ios: [],
    generic: [],
  };

  function scanDir(dir, depth = 0) {
    if (depth > 6) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', '.git', 'build', 'dist', 'DerivedData', '.gradle'].includes(entry.name)) {
          continue;
        }
        scanDir(fullPath, depth + 1);
      } else if (entry.isFile()) {
        const lowerName = entry.name.toLowerCase();

        // 1. Android Manifest
        if (lowerName === 'androidmanifest.xml') {
          try {
            const content = fs.readFileSync(fullPath, 'utf8');
            const intentFilterRegex = /<intent-filter\b[^>]*>([\s\S]*?)<\/intent-filter>/gi;
            let match;

            while ((match = intentFilterRegex.exec(content)) !== null) {
              const filterBody = match[1];
              const isView = /android:name="android\.intent\.action\.VIEW"/i.test(filterBody);
              const isDefault = /android:name="android\.intent\.category\.DEFAULT"/i.test(filterBody);
              const isBrowsable = /android:name="android\.intent\.category\.BROWSABLE"/i.test(filterBody);
              const hasAutoVerify = /android:autoVerify="true"/i.test(match[0]);

              if (isView) {
                const dataTags = [];
                const dataRegex = /<data\b([^>]*)\/>/gi;
                let dataMatch;
                while ((dataMatch = dataRegex.exec(filterBody)) !== null) {
                  const attrs = dataMatch[1];
                  const scheme = attrs.match(/android:scheme="([^"]+)"/)?.[1];
                  const host = attrs.match(/android:host="([^"]+)"/)?.[1];
                  const pathPrefix = attrs.match(/android:pathPrefix="([^"]+)"/)?.[1];
                  dataTags.push({ scheme, host, pathPrefix });
                }

                findings.android.push({
                  file: path.relative(rootDir, fullPath),
                  autoVerify: hasAutoVerify,
                  isBrowsable,
                  isDefault,
                  data: dataTags,
                });
              }
            }
          } catch {
            // Ignore read errors
          }
        }

        // 2. iOS Entitlements (*.entitlements)
        if (lowerName.endsWith('.entitlements')) {
          try {
            const content = fs.readFileSync(fullPath, 'utf8');
            if (content.includes('com.apple.developer.associated-domains')) {
              const domains = [];
              const stringRegex = /<string>([^<]+)<\/string>/gi;
              let sm;
              while ((sm = stringRegex.exec(content)) !== null) {
                if (sm[1].startsWith('applinks:') || sm[1].startsWith('webcredentials:')) {
                  domains.push(sm[1]);
                }
              }
              findings.ios.push({
                file: path.relative(rootDir, fullPath),
                type: 'associated-domains',
                domains,
              });
            }
          } catch {
            // Ignore
          }
        }

        // 3. iOS Info.plist (URL Schemes)
        if (lowerName === 'info.plist') {
          try {
            const content = fs.readFileSync(fullPath, 'utf8');
            if (content.includes('CFBundleURLTypes')) {
              const schemes = [];
              const schemeRegex = /<key>CFBundleURLSchemes<\/key>[\s\S]*?<array>([\s\S]*?)<\/array>/gi;
              let schemeMatch;
              while ((schemeMatch = schemeRegex.exec(content)) !== null) {
                const inner = schemeMatch[1];
                const strRegex = /<string>([^<]+)<\/string>/gi;
                let s;
                while ((s = strRegex.exec(inner)) !== null) {
                  schemes.push(s[1]);
                }
              }
              if (schemes.length > 0) {
                findings.ios.push({
                  file: path.relative(rootDir, fullPath),
                  type: 'url-schemes',
                  schemes,
                });
              }
            }
          } catch {
            // Ignore
          }
        }

        // 4. Cordova config.xml
        if (lowerName === 'config.xml') {
          try {
            const content = fs.readFileSync(fullPath, 'utf8');
            if (content.includes('UniversalLinks') || content.includes('ionic-plugin-deeplinks') || content.includes('app-link')) {
              findings.generic.push({
                file: path.relative(rootDir, fullPath),
                type: 'cordova-config',
                summary: 'Detected deep link / Universal Links plugin configurations in config.xml',
              });
            }
          } catch {
            // Ignore
          }
        }
      }
    }
  }

  scanDir(rootDir, 0);
  return findings;
}

// ─── Scaffolder / Generator (generate) ───────────────────────────────────────
export function generateAasa({ teamId = 'TEAMID123', bundleId = 'com.example.app', paths = ['/checkout/*', '/item/*'] } = {}) {
  const fullAppId = `${teamId}.${bundleId}`;
  return {
    applinks: {
      apps: [],
      details: [
        {
          appID: fullAppId,
          paths: Array.isArray(paths) ? paths : [paths],
          components: [
            {
              '/': paths[0] || '/*',
              comment: 'Matches deep links for primary app routes',
            },
          ],
        },
      ],
    },
    webcredentials: {
      apps: [fullAppId],
    },
  };
}

export function generateAssetLinks({
  packageName = 'com.example.app',
  fingerprints = ['14:6D:E9:DE:0F:73:C7:CE:00:E9:73:C7:CE:00:E9:73:C7:CE:00:E9:73:C7:CE:00:E9:73:C7:CE:00:E9:73:C7'],
} = {}) {
  return [
    {
      relation: [
        'delegate_permission/common.handle_all_urls',
        'delegate_permission/common.get_login_creds',
      ],
      target: {
        namespace: 'android_app',
        package_name: packageName,
        sha256_cert_fingerprints: Array.isArray(fingerprints) ? fingerprints : [fingerprints],
      },
    },
  ];
}

// ─── Formatting & CLI Output ─────────────────────────────────────────────────
function printHelp() {
  console.log(`
${c.bold}${c.cyan}🚀 deeplink-cli${c.reset} — Mobile Deep Links, Universal Links & App Links Toolkit

${c.bold}TESTING & RUNTIME:${c.reset}
  ${c.green}open${c.reset} <url | preset> [--platform ios|android|all] [--device <id>] [--package <name>] [--dry-run]
      Trigger and open a deep link, Universal Link, or App Link on active devices/simulators.
      (Alias: ${c.dim}test${c.reset})

  ${c.green}devices${c.reset}
      Discover and list running iOS simulators and connected Android ADB devices.

${c.bold}REMOTE DOMAIN VERIFICATION:${c.reset}
  ${c.green}verify${c.reset} <domain | url>
      Validate remote ${c.bold}apple-app-site-association${c.reset} and ${c.bold}assetlinks.json${c.reset} files:
      checks HTTP status 200, redirects (disallowed by Apple), SSL, JSON format, and route matching.
      (Alias: ${c.dim}check${c.reset})

${c.bold}LOCAL PROJECT AUDIT:${c.reset}
  ${c.green}audit${c.reset} [projectPath]
      Inspect local mobile projects (Android Manifest, iOS Entitlements, Info.plist, Cordova config.xml)
      for valid intent-filters, autoVerify, BROWSABLE categories, and associated domains.
      (Alias: ${c.dim}inspect${c.reset})

${c.bold}SCAFFOLDING & CONFIG:${c.reset}
  ${c.green}generate${c.reset} [aasa | assetlinks | all] [--team-id <id>] [--bundle-id <id>] [--package <name>] [--out <dir>]
      Scaffold production-ready ${c.bold}apple-app-site-association${c.reset} and ${c.bold}assetlinks.json${c.reset} files.
      (Alias: ${c.dim}scaffold${c.reset})

  ${c.green}init${c.reset}
      Create a local ${c.bold}deeplink.config.json${c.reset} with saved presets and default package/bundle IDs.

${c.bold}GLOBAL FLAGS:${c.reset}
  ${c.yellow}--dry-run${c.reset}       Preview the command to be executed without launching on devices.
  ${c.yellow}--json${c.reset}          Output raw JSON results (ideal for CI/CD pipelines & automated tests).
  ${c.yellow}--config <path>${c.reset} Use a specific configuration file.
`);
}

// ─── CLI Entrypoint ──────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  const positional = [];
  const flags = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else if (arg === '-h') {
      flags.help = true;
    } else if (arg === '-j') {
      flags.json = true;
    } else {
      positional.push(arg);
    }
  }

  const command = positional[0] || 'help';
  const args = positional.slice(1);

  if (command === 'help' || flags.help) {
    printHelp();
    return;
  }

  switch (command) {
    // ── 1. DEVICES ─────────────────────────────────────────────────────────
    case 'devices': {
      const { android, ios } = listAllDevices();

      if (flags.json) {
        console.log(JSON.stringify({ android, ios }, null, 2));
        return;
      }

      console.log(`\n${c.bold}${c.cyan}📱 DETECTED MOBILE DEVICES & SIMULATORS${c.reset}`);
      console.log(`${c.gray}${'═'.repeat(64)}${c.reset}`);

      console.log(`\n${c.bold}🤖 Android Devices / Emulators (${android.length}):${c.reset}`);
      if (android.length === 0) {
        console.log(`  ${c.dim}(No connected Android devices found. Ensure USB debugging is enabled)${c.reset}`);
      } else {
        for (const dev of android) {
          const statusColor = dev.status === 'device' ? c.green : c.yellow;
          console.log(`  • ${c.bold}${dev.name}${c.reset} [ID: ${dev.id}] - ${statusColor}${dev.status}${c.reset}`);
        }
      }

      const bootedIos = ios.filter((s) => s.isBooted);
      console.log(`\n${c.bold}🍎 iOS Simulators (Booted: ${bootedIos.length} | Available: ${ios.length}):${c.reset}`);
      if (bootedIos.length === 0) {
        console.log(`  ${c.dim}(No booted iOS simulators found. Run "open -a Simulator" to start one)${c.reset}`);
      } else {
        for (const sim of bootedIos) {
          console.log(`  • ${c.bold}${sim.name}${c.reset} [UDID: ${sim.id}] - ${c.green}BOOTED${c.reset}`);
        }
      }
      break;
    }

    // ── 2. OPEN / TEST DEEP LINK ──────────────────────────────────────────
    case 'open':
    case 'test': {
      const target = args[0] || flags.url;
      if (!target) {
        throw new Error('Please provide a deep link URL or preset name: deeplink open <url|preset>');
      }

      const { url, results } = await openDeepLink(target, {
        platform: flags.platform,
        device: flags.device,
        package: flags.package,
        dryRun: flags['dry-run'],
        configPath: flags.config,
      });

      if (flags.json) {
        console.log(JSON.stringify({ url, results }, null, 2));
        return;
      }

      console.log(`\n${c.bold}Target URL:${c.reset} ${c.cyan}${url}${c.reset}\n`);

      for (const res of results) {
        const platBadge = res.platform === 'ios' ? `${c.bold}🍎 iOS${c.reset}` : `${c.bold}🤖 Android${c.reset}`;

        if (res.dryRun) {
          console.log(`${platBadge} [${res.device}] ${c.yellow}(Dry-Run)${c.reset}:`);
          console.log(`  ${c.gray}$ ${res.command}${c.reset}`);
        } else if (res.status === 'success') {
          console.log(`${platBadge} [${res.device}] ${c.green}✔ SUCCESS${c.reset}`);
          if (res.output) console.log(`  ${c.dim}${res.output.replace(/\n/g, ' ')}${c.reset}`);
        } else if (res.status === 'skipped') {
          console.log(`${platBadge} ${c.yellow}⚠ SKIPPED:${c.reset} ${res.message}`);
        } else {
          console.log(`${platBadge} [${res.device || '-'}] ${c.red}✖ FAILED:${c.reset} ${res.error || res.output}`);
        }
      }
      break;
    }

    // ── 3. VERIFY REMOTE DOMAIN (AASA / ASSETLINKS) ────────────────────────
    case 'verify':
    case 'check': {
      const target = args[0];
      if (!target) {
        throw new Error('Please provide a domain or deep link URL: deeplink verify <domain|url>');
      }

      console.log(`\n${c.bold}🔍 Verifying Associated Domain Configuration for:${c.reset} ${c.cyan}${target}${c.reset}`);
      console.log(`${c.gray}${'═'.repeat(68)}${c.reset}`);

      const report = await verifyRemoteDeepLinks(target);

      if (flags.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      // iOS AASA Report
      console.log(`\n${c.bold}🍎 iOS Universal Links (apple-app-site-association):${c.reset}`);
      const ios = report.ios;
      if (ios.error) {
        console.log(`  ${c.red}✖ Request failed:${c.reset} ${ios.error} (${ios.url})`);
      } else if (ios.checked) {
        const statusColor = ios.status === 200 ? c.green : c.red;
        console.log(`  • Endpoint: ${ios.url}`);
        console.log(`  • HTTP Status: ${statusColor}${ios.status}${c.reset}`);

        if (ios.isRedirect) {
          console.log(`    ${c.red}✖ REDIRECT DETECTED -> ${ios.redirectLocation}${c.reset}`);
          console.log(`    ${c.yellow}⚠️ Warning: Apple strictly disallows redirects for AASA files!${c.reset}`);
        }

        console.log(`  • Content-Type: ${ios.contentType || '-'}`);
        console.log(`  • Valid JSON: ${ios.validJson ? `${c.green}Yes${c.reset}` : `${c.red}No (${ios.jsonError})${c.reset}`}`);

        if (ios.appIds?.length > 0) {
          console.log(`  • Registered App IDs (${ios.appIds.length}): ${c.bold}${ios.appIds.join(', ')}${c.reset}`);
        }
        if (ios.paths?.length > 0) {
          console.log(`  • Supported Routes (${ios.paths.length}): ${ios.paths.slice(0, 6).join(', ')}${ios.paths.length > 6 ? '...' : ''}`);
        }
        if (report.testPath !== '/') {
          const matchColor = ios.pathMatches ? c.green : c.yellow;
          console.log(`  • Path Match for "${report.testPath}": ${matchColor}${ios.pathMatches ? '✔ MATCHED' : 'NOT MATCHED'}${c.reset}`);
        }
      }

      // Android AssetLinks Report
      console.log(`\n${c.bold}🤖 Android App Links (assetlinks.json):${c.reset}`);
      const android = report.android;
      if (android.error) {
        console.log(`  ${c.red}✖ Request failed:${c.reset} ${android.error} (${android.url})`);
      } else if (android.checked) {
        const statusColor = android.status === 200 ? c.green : c.red;
        console.log(`  • Endpoint: ${android.url}`);
        console.log(`  • HTTP Status: ${statusColor}${android.status}${c.reset}`);
        console.log(`  • Content-Type: ${android.contentType || '-'}`);
        console.log(`  • Valid JSON Array: ${android.validJson ? `${c.green}Yes${c.reset}` : `${c.red}No${c.reset}`}`);

        if (android.packages?.length > 0) {
          console.log(`  • Registered Package(s): ${c.bold}${android.packages.join(', ')}${c.reset}`);
        }
        if (android.fingerprints?.length > 0) {
          console.log(`  • SHA-256 Fingerprints (${android.fingerprints.length}):`);
          for (const fp of android.fingerprints.slice(0, 3)) {
            console.log(`    - ${c.dim}${fp}${c.reset}`);
          }
        }
      }
      break;
    }

    // ── 4. AUDIT LOCAL PROJECT ─────────────────────────────────────────────
    case 'audit':
    case 'inspect': {
      const targetDir = path.resolve(args[0] || process.cwd());
      console.log(`\n${c.bold}🕵️  Auditing Mobile Project Deep Link Configurations in:${c.reset}`);
      console.log(`  ${c.cyan}${targetDir}${c.reset}\n`);

      const findings = auditProjectDeepLinks(targetDir);

      if (flags.json) {
        console.log(JSON.stringify(findings, null, 2));
        return;
      }

      console.log(`${c.bold}🤖 Android Manifest Findings (${findings.android.length}):${c.reset}`);
      if (findings.android.length === 0) {
        console.log(`  ${c.dim}(No deep link intent-filters found in AndroidManifest.xml)${c.reset}`);
      } else {
        for (const item of findings.android) {
          console.log(`  📄 ${c.bold}${item.file}${c.reset}:`);
          console.log(`     - autoVerify: ${item.autoVerify ? `${c.green}true (App Links active)${c.reset}` : `${c.yellow}false (Standard custom scheme)${c.reset}`}`);
          console.log(`     - BROWSABLE: ${item.isBrowsable ? `${c.green}Yes${c.reset}` : `${c.red}Missing!${c.reset}`}`);
          console.log(`     - DEFAULT: ${item.isDefault ? `${c.green}Yes${c.reset}` : `${c.red}Missing!${c.reset}`}`);
          for (const d of item.data) {
            console.log(`     - Scheme: ${c.cyan}${d.scheme || '*'}${c.reset} | Host: ${c.bold}${d.host || '*'}${c.reset} | PathPrefix: ${d.pathPrefix || '/'}`);
          }
        }
      }

      console.log(`\n${c.bold}🍎 iOS Entitlements & Info.plist Findings (${findings.ios.length}):${c.reset}`);
      if (findings.ios.length === 0) {
        console.log(`  ${c.dim}(No associated-domains or URL schemes found in iOS project files)${c.reset}`);
      } else {
        for (const item of findings.ios) {
          console.log(`  📄 ${c.bold}${item.file}${c.reset} [${item.type}]:`);
          if (item.domains) {
            console.log(`     - Associated Domains: ${c.green}${item.domains.join(', ')}${c.reset}`);
          }
          if (item.schemes) {
            console.log(`     - Custom URL Schemes: ${c.cyan}${item.schemes.join(', ')}${c.reset}`);
          }
        }
      }

      if (findings.generic.length > 0) {
        console.log(`\n${c.bold}🧩 Hybrid / Framework Configurations (${findings.generic.length}):${c.reset}`);
        for (const g of findings.generic) {
          console.log(`  📄 ${c.bold}${g.file}${c.reset}: ${g.summary}`);
        }
      }
      break;
    }

    // ── 5. GENERATE / SCAFFOLD AASA OR ASSETLINKS ──────────────────────────
    case 'generate':
    case 'scaffold': {
      const type = (args[0] || flags.type || 'all').toLowerCase();
      const outDir = path.resolve(flags.out || process.cwd());

      const teamId = flags['team-id'] || 'TEAMID123';
      const bundleId = flags['bundle-id'] || 'com.example.app';
      const packageName = flags.package || 'com.example.app';
      const rawPaths = flags.paths ? flags.paths.split(',').map((p) => p.trim()) : ['/checkout/*', '/item/*'];
      const rawFp = flags.sha256 ? [flags.sha256] : undefined;

      fs.mkdirSync(outDir, { recursive: true });

      if (type === 'all' || type === 'aasa' || type === 'apple') {
        const aasaData = generateAasa({ teamId, bundleId, paths: rawPaths });
        const aasaPath = path.join(outDir, 'apple-app-site-association');
        fs.writeFileSync(aasaPath, JSON.stringify(aasaData, null, 2) + '\n', 'utf8');
        console.log(`${c.green}✔ Created iOS AASA file:${c.reset} ${aasaPath}`);
      }

      if (type === 'all' || type === 'assetlinks' || type === 'android') {
        const assetlinksData = generateAssetLinks({ packageName, fingerprints: rawFp });
        const assetlinksPath = path.join(outDir, 'assetlinks.json');
        fs.writeFileSync(assetlinksPath, JSON.stringify(assetlinksData, null, 2) + '\n', 'utf8');
        console.log(`${c.green}✔ Created Android assetlinks.json file:${c.reset} ${assetlinksPath}`);
      }
      break;
    }

    // ── 6. INIT CONFIG ─────────────────────────────────────────────────────
    case 'init': {
      const targetPath = path.resolve(process.cwd(), 'deeplink.config.json');
      const defaultConfig = {
        ios: {
          bundleId: flags['bundle-id'] || 'com.example.app',
          teamId: flags['team-id'] || 'TEAMID123',
        },
        android: {
          packageName: flags.package || 'com.example.app',
        },
        presets: {
          home: 'myapp://home',
          profile: 'myapp://profile/user-42',
          checkout: 'https://example.com/checkout?promo=WELCOME',
        },
      };

      fs.writeFileSync(targetPath, JSON.stringify(defaultConfig, null, 2) + '\n', 'utf8');
      console.log(`${c.green}✔ Created deeplink.config.json template at:${c.reset} ${targetPath}`);
      break;
    }

    default:
      throw new Error(`Unknown command: "${command}". Run "./deeplink.mjs help" for available commands.`);
  }
}

// Run CLI
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((err) => {
    console.error(`\n${c.red}${c.bold}✖ Error:${c.reset} ${err.message}\n`);
    process.exit(1);
  });
}
