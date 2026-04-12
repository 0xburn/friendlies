/**
 * Finds, launches, and kills Slippi Dolphin.
 *
 * Dolphin executable is resolved by reading the Slippi Launcher's Settings
 * file to determine whether the user is on Mainline or Ishiiruka, then
 * looking in the correct install folder. Falls back to scanning if Settings
 * can't be read.
 *
 * Melee ISO path is read from the Launcher Settings, then Dolphin.ini.
 */

import { execFile, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  type DolphinVariant,
  getDolphinUserDir,
  getLauncherDir,
  readLauncherSettings,
  detectDolphinVariant,
} from './dolphin-config';
import { DOLPHIN_PROCESS_NAMES } from '../config';
import { directLog } from '../logger';

const find = require('find-process') as (
  type: 'name',
  name: string,
  strict?: boolean,
) => Promise<Array<{ name: string; pid: number }>>;

// ---------------------------------------------------------------------------
// Dolphin executable resolution
// ---------------------------------------------------------------------------

function scanDirForFile(dir: string, match: (name: string) => boolean): string | null {
  try {
    if (!fs.existsSync(dir)) return null;
    const hit = fs.readdirSync(dir).find(match);
    return hit ? path.join(dir, hit) : null;
  } catch { return null; }
}

/**
 * Find the Dolphin executable inside the given install folder, using the
 * same filename conventions the Slippi Launcher uses for each variant.
 */
function findExeInFolder(folder: string, variant: DolphinVariant): string | null {
  if (!fs.existsSync(folder)) return null;

  if (process.platform === 'win32') {
    // Both variants scan for any file ending in Dolphin.exe
    const exe = scanDirForFile(folder, (f) => /dolphin\.exe$/i.test(f));
    return exe;
  }

  if (process.platform === 'darwin') {
    if (variant === 'mainline') {
      const p = path.join(folder, 'Slippi_Dolphin.app', 'Contents', 'MacOS', 'Slippi_Dolphin');
      return fs.existsSync(p) ? p : null;
    }
    const p = path.join(folder, 'Slippi Dolphin.app', 'Contents', 'MacOS', 'Slippi Dolphin');
    return fs.existsSync(p) ? p : null;
  }

  // Linux
  if (variant === 'mainline') {
    const appImage = scanDirForFile(folder, (f) =>
      (f.startsWith('Slippi_Netplay') && f.endsWith('.AppImage')) || f === 'dolphin-emu',
    );
    if (appImage) return appImage;
    const squash = path.join(folder, 'squashfs-root', 'usr', 'bin', 'dolphin-emu');
    return fs.existsSync(squash) ? squash : null;
  }
  // Ishiiruka
  const appImage = scanDirForFile(folder, (f) =>
    (f.startsWith('Slippi_Online') && f.endsWith('.AppImage')) || f === 'dolphin-emu',
  );
  if (appImage) return appImage;
  const legacy = path.join(folder, 'Slippi_Dolphin');
  return fs.existsSync(legacy) ? legacy : null;
}

export function getDolphinExePath(): string | null {
  const launcherDir = getLauncherDir();
  const settings = readLauncherSettings();
  const { variant, betaSuffix } = detectDolphinVariant(settings);
  const folder = path.join(launcherDir, `netplay${betaSuffix}`);

  console.log(`[dolphin-launcher] Detected variant=${variant}, folder=netplay${betaSuffix}`);
  directLog.info(`Detected variant=${variant}, folder=netplay${betaSuffix}`);

  // Primary: honor the Launcher's configured variant & folder
  const primary = findExeInFolder(folder, variant);
  if (primary) return primary;

  // If the settings-based lookup failed, try the other variant in the same
  // folder — handles edge cases where the binary name doesn't match our
  // expectation (e.g. a manual install).
  const otherVariant: DolphinVariant = variant === 'mainline' ? 'ishiiruka' : 'mainline';
  const secondary = findExeInFolder(folder, otherVariant);
  if (secondary) {
    console.warn(`[dolphin-launcher] Expected ${variant} but found ${otherVariant} exe in ${folder}`);
    directLog.warn(`Expected ${variant} but found ${otherVariant} exe in ${folder}`);
    return secondary;
  }

  // Last resort: try the alternate folder (netplay-beta if we tried netplay, etc.)
  const altSuffix = betaSuffix === '' ? '-beta' : '';
  const altFolder = path.join(launcherDir, `netplay${altSuffix}`);
  for (const v of [variant, otherVariant] as DolphinVariant[]) {
    const fallback = findExeInFolder(altFolder, v);
    if (fallback) {
      console.warn(`[dolphin-launcher] Fell back to netplay${altSuffix} (${v})`);
      directLog.warn(`Fell back to netplay${altSuffix} (${v})`);
      return fallback;
    }
  }

  // Linux system-package fallback
  if (process.platform === 'linux') {
    const systemPaths = [
      '/usr/bin/slippi-dolphin',
      '/usr/bin/dolphin-emu',
      '/usr/local/bin/slippi-dolphin',
      '/usr/local/bin/dolphin-emu',
      path.join(os.homedir(), '.local', 'bin', 'Slippi_Dolphin'),
      path.join(os.homedir(), '.local', 'bin', 'slippi-dolphin'),
    ];
    for (const p of systemPaths) {
      if (fs.existsSync(p)) return p;
    }
  }

  return null;
}

function getSlippiLauncherIsoPath(): string | null {
  const settings = readLauncherSettings();
  const isoPath = settings?.settings?.isoPath;
  if (isoPath && typeof isoPath === 'string' && fs.existsSync(isoPath)) {
    console.log(`[dolphin-launcher] ISO from Slippi Launcher settings: ${isoPath}`);
    directLog.info(`ISO from Slippi Launcher settings: ${isoPath}`);
    return isoPath;
  }
  return null;
}

function readIniValue(content: string, key: string): string | null {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith(key)) {
      const eq = trimmed.indexOf('=');
      if (eq > 0) {
        const val = trimmed.slice(eq + 1).trim();
        if (val && fs.existsSync(val)) return val;
      }
    }
  }
  return null;
}

const MELEE_PATTERNS = /melee|gale01|ssbm/i;

export function getMeleeIsoPath(): string | null {
  // Best source: Slippi Launcher's configured ISO path
  const launcherIso = getSlippiLauncherIsoPath();
  if (launcherIso) return launcherIso;

  const userDir = getDolphinUserDir();
  if (!userDir) return null;

  const iniPath = path.join(userDir, 'Config', 'Dolphin.ini');
  if (!fs.existsSync(iniPath)) return null;
  const content = fs.readFileSync(iniPath, 'utf8');

  // Prefer ISOPath0 (configured game directory entry)
  const isoPath0 = readIniValue(content, 'ISOPath0');
  if (isoPath0) return isoPath0;

  // LastFilename only if it looks like Melee (not Uncle Punch, training packs, etc.)
  const lastFile = readIniValue(content, 'LastFilename');
  if (lastFile && MELEE_PATTERNS.test(path.basename(lastFile))) return lastFile;

  // Last resort: return LastFilename even if it doesn't match, better than nothing
  if (lastFile) {
    console.warn(`[dolphin-launcher] LastFilename doesn't look like Melee: ${lastFile}`);
    directLog.warn(`LastFilename doesn't look like Melee: ${lastFile}`);
    return lastFile;
  }

  return null;
}

export async function isDolphinRunning(): Promise<boolean> {
  try {
    const results = await Promise.all(
      DOLPHIN_PROCESS_NAMES.map((name) => find('name', name, false).catch(() => [] as any[])),
    );
    for (const r of results) {
      if (r.length > 0) return true;
    }
  } catch {}
  return false;
}

export async function getDolphinPids(): Promise<number[]> {
  const pids: number[] = [];
  try {
    const results = await Promise.all(
      DOLPHIN_PROCESS_NAMES.map((name) => find('name', name, false).catch(() => [] as any[])),
    );
    for (const r of results) {
      for (const proc of r) pids.push(proc.pid);
    }
  } catch {}
  return [...new Set(pids)];
}

export async function killDolphin(): Promise<void> {
  const pids = await getDolphinPids();
  if (pids.length === 0) return;

  console.log(`[dolphin-launcher] Killing Dolphin PIDs: ${pids.join(', ')}`);
  directLog.info(`Killing Dolphin PIDs: ${pids.join(', ')}`);
  for (const pid of pids) {
    try { process.kill(pid, 'SIGTERM'); } catch {}
  }

  // Wait for processes to exit (up to 5 seconds)
  for (let i = 0; i < 25; i++) {
    await sleep(200);
    const remaining = await getDolphinPids();
    if (remaining.length === 0) {
      console.log('[dolphin-launcher] Dolphin stopped');
      directLog.info('Dolphin stopped');
      return;
    }
  }

  // Force kill if still running
  const stubborn = await getDolphinPids();
  for (const pid of stubborn) {
    try { process.kill(pid, 'SIGKILL'); } catch {}
  }
  await sleep(500);
  console.log('[dolphin-launcher] Dolphin force-killed');
  directLog.info('Dolphin force-killed');
}

export function launchDolphin(overrideUserDir?: string): void {
  const exePath = getDolphinExePath();
  if (!exePath) throw new Error('Cannot find Slippi Dolphin executable');

  const isoPath = getMeleeIsoPath();
  if (!isoPath) throw new Error('Cannot find Melee ISO (check Dolphin.ini LastFilename)');

  const userDir = overrideUserDir ?? getDolphinUserDir();

  // -b -e matches Slippi Launcher DolphinInstance (batch + execute); -u is Friendlies-specific.
  const args = ['-b', '-e', isoPath];
  if (userDir) {
    args.push('-u', userDir);
  }

  console.log(`[dolphin-launcher] Launching: "${exePath}" ${args.map(a => `"${a}"`).join(' ')}`);
  directLog.info(`Launching: "${exePath}" ${args.map(a => `"${a}"`).join(' ')}`);

  // macOS: use execFile to avoid spawn deadlocks in Dolphin's rendering
  // (matches how the Slippi Launcher handles this)
  if (process.platform === 'darwin') {
    const child = execFile(exePath, args, { maxBuffer: 100 * 1000 * 1000 });
    child.unref();
  } else {
    // Windows/Linux: plain spawn like Slippi Launcher (no detached) — detached spawn on Windows
    // was associated with bad fullscreen/focus (DWM compositing, visible cursor, click sounds).
    const child = spawn(exePath, args);
    child.stderr?.on('data', () => {});
    child.unref();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
