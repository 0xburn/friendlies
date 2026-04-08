/**
 * Dolphin configuration helpers for direct connect.
 *
 * Resolves the Slippi Launcher Settings, Dolphin User directory, and Slippi
 * config directory. Reads the Launcher's Settings file to determine Mainline
 * vs Ishiiruka, matching the Launcher's own resolution logic.
 * Injects a connect code into Slippi's direct-codes.json so it appears as
 * the first autocomplete suggestion on the in-game code entry screen.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getSlippiUserJsonPaths } from '../config';
import { getEffectiveLauncherDir } from '../launcher-path';

// ---------------------------------------------------------------------------
// Slippi Launcher Settings — shared by dolphin-config and dolphin-launcher
// ---------------------------------------------------------------------------

export interface LauncherSettings {
  netplayPromotedToStable?: boolean;
  settings?: {
    useNetplayBeta?: boolean;
    isoPath?: string | null;
  };
}

export type DolphinVariant = 'mainline' | 'ishiiruka';

export function getLauncherDir(): string {
  return getEffectiveLauncherDir();
}

export function readLauncherSettings(): LauncherSettings | null {
  try {
    const settingsPath = path.join(getLauncherDir(), 'Settings');
    if (!fs.existsSync(settingsPath)) return null;
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch { return null; }
}

/**
 * Mirrors the Slippi Launcher's DolphinManager.getInstallation() logic:
 *  - promotedToStable || useNetplayBeta → Mainline
 *  - otherwise → Ishiiruka
 */
export function detectDolphinVariant(settings: LauncherSettings | null): { variant: DolphinVariant; betaSuffix: string } {
  const promotedToStable = settings?.netplayPromotedToStable ?? false;
  const useNetplayBeta = settings?.settings?.useNetplayBeta ?? false;

  if (promotedToStable || useNetplayBeta) {
    const betaSuffix = promotedToStable ? '' : '-beta';
    return { variant: 'mainline', betaSuffix };
  }
  return { variant: 'ishiiruka', betaSuffix: '' };
}

// ---------------------------------------------------------------------------
// Dolphin User directory resolution
// ---------------------------------------------------------------------------

/**
 * Build user-directory candidates ordered by what the Launcher settings say.
 *
 * Mainline user dirs (from Slippi Launcher source):
 *   win32:  {launcherDir}/netplay{suffix}/User
 *   darwin: ~/Library/Application Support/com.project-slippi.dolphin/netplay{suffix}/User
 *   linux:  ~/.config/slippi-dolphin/netplay{suffix}
 *
 * Ishiiruka user dirs:
 *   win32:  {launcherDir}/netplay/User
 *   darwin: ~/Library/Application Support/com.project-slippi.dolphin/netplay/User
 *   linux:  ~/.config/SlippiOnline
 */
function slippiUserDirectoryCandidates(): string[] {
  const home = os.homedir();
  const settings = readLauncherSettings();
  const { variant, betaSuffix } = detectDolphinVariant(settings);
  const isMainline = variant === 'mainline';

  const launcherDir = getLauncherDir();

  if (process.platform === 'win32') {
    const primary = path.join(launcherDir, `netplay${betaSuffix}`, 'User');
    const others = [
      path.join(launcherDir, 'netplay', 'User'),
      path.join(launcherDir, 'netplay-beta', 'User'),
    ].filter((p) => p !== primary);
    return [primary, ...others];
  }

  if (process.platform === 'darwin') {
    const configPath = path.join(home, 'Library', 'Application Support', 'com.project-slippi.dolphin');
    const primary = path.join(configPath, `netplay${betaSuffix}`, 'User');
    const others = [
      path.join(configPath, 'netplay', 'User'),
      path.join(configPath, 'netplay-beta', 'User'),
    ].filter((p) => p !== primary);
    return [primary, ...others];
  }

  // Linux: Mainline and Ishiiruka use entirely different paths
  if (isMainline) {
    return [
      path.join(home, '.config', 'slippi-dolphin', `netplay${betaSuffix}`),
      path.join(home, '.config', 'slippi-dolphin', 'netplay'),
      path.join(home, '.config', 'slippi-dolphin', 'netplay-beta'),
      path.join(home, '.config', 'SlippiOnline'),
      path.join(home, '.config', 'Slippi Launcher', 'netplay', 'User'),
    ];
  }
  return [
    path.join(home, '.config', 'SlippiOnline'),
    path.join(home, '.config', 'Slippi Launcher', 'netplay', 'User'),
    path.join(home, '.config', 'slippi-dolphin', 'netplay'),
    path.join(home, '.config', 'slippi-dolphin', 'netplay-beta'),
  ];
}

export function getDolphinUserDir(): string | null {
  const candidates = slippiUserDirectoryCandidates();
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'Config'))) return dir;
  }
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Slippi config directory (where direct-codes.json + user.json live)
// Uses the same path discovery as identity — finds where user.json actually
// exists and puts direct-codes.json next to it.
// ---------------------------------------------------------------------------

function getSlippiConfigDir(): string | null {
  for (const jsonPath of getSlippiUserJsonPaths()) {
    if (fs.existsSync(jsonPath)) {
      const dir = path.dirname(jsonPath);
      console.log(`[direct-connect] Slippi config dir resolved via user.json: ${dir}`);
      return dir;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Direct code injection
// ---------------------------------------------------------------------------

function toFullwidth(str: string): string {
  return [...str].map((ch) => {
    const code = ch.charCodeAt(0);
    if (code >= 0x21 && code <= 0x7E) return String.fromCharCode(code + 0xFEE0);
    return ch;
  }).join('');
}

/**
 * Write a connect code as the most-recent entry in Slippi's direct-codes.json.
 * Dolphin reads this file to populate autocomplete on the code entry screen.
 * Codes are stored in fullwidth Unicode (e.g. MATW#444 → ＭＡＴＷ＃４４４).
 */
export function injectDirectCode(connectCode: string): void {
  const slippiDir = getSlippiConfigDir();
  if (!slippiDir) {
    console.warn('[direct-connect] Cannot find Slippi config directory — skipping code injection');
    return;
  }

  const filePath = path.join(slippiDir, 'direct-codes.json');
  const fullwidthCode = toFullwidth(connectCode.toUpperCase().trim());
  const now = Math.floor(Date.now() / 1000);

  let codes: { connectCode: string; lastPlayed: number }[] = [];
  if (fs.existsSync(filePath)) {
    try {
      codes = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {}
  }

  codes = codes.filter((c) => c.connectCode !== fullwidthCode);
  codes.unshift({ connectCode: fullwidthCode, lastPlayed: now });

  fs.mkdirSync(slippiDir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(codes));
  console.log(`[direct-connect] Injected ${connectCode} as most recent in direct-codes.json`);
}
