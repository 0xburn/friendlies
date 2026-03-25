/**
 * Manages Dolphin configuration for virtual controller pipe input.
 *
 * Writes GCPadNew.ini to map a port to a named pipe device, and
 * sets the corresponding SIDevice in Dolphin.ini to "standard controller" (6).
 *
 * Based on libmelee's Console.setup_dolphin_controller().
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const BOT_PORT = 1;
const PIPE_NAME = `slippibot${BOT_PORT}`;

/** Sits next to GCPadNew.ini in Dolphin's Config folder — not in git, survives app restarts. */
const FRIENDLIES_GCPAD_BACKUP_BASENAME = 'GCPadNew.friendlies-backup.ini';

let savedGCPadContents: string | null = null;

function friendliesGcpadBackupPath(userDir: string): string {
  return path.join(userDir, 'Config', FRIENDLIES_GCPAD_BACKUP_BASENAME);
}

function readFriendliesGcpadBackup(userDir: string): string | null {
  const p = friendliesGcpadBackupPath(userDir);
  if (!fs.existsSync(p)) return null;
  try {
    const s = fs.readFileSync(p, 'utf8');
    return gcpad1IsUserConfig(s) ? s : null;
  } catch {
    return null;
  }
}

function writeFriendliesGcpadBackup(userDir: string, contents: string): void {
  const p = friendliesGcpadBackupPath(userDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, contents, 'utf8');
  fs.renameSync(tmp, p);
}

/** Full GCPadNew.ini snapshot for restore — only on this machine, never in git. */
function getLocalDebugGcpadBackupPath(): string {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(home, 'AppData', 'Roaming', 'friendlies', 'direct-connect-debug', 'GCPadNew.restore.ini');
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'friendlies', 'direct-connect-debug', 'GCPadNew.restore.ini');
  }
  return path.join(home, '.config', 'friendlies', 'direct-connect-debug', 'GCPadNew.restore.ini');
}

function writeLocalDebugGcpadBackup(contents: string): void {
  const p = getLocalDebugGcpadBackupPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, contents, 'utf8');
  console.log(`[direct-connect] Wrote local debug GCPad snapshot: ${p}`);
}

function readLocalDebugGcpadBackup(): string | null {
  const p = getLocalDebugGcpadBackupPath();
  if (!fs.existsSync(p)) return null;
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

/** True if GCPad1 in this file is not our pipe device. */
function gcpad1IsUserConfig(contents: string): boolean {
  const ini = parseIni(contents);
  const device = ini.sections.get(`GCPad${BOT_PORT}`)?.get('Device') ?? '';
  return !device.includes(`Pipe/0/${PIPE_NAME}`);
}

/** Known Slippi / Dolphin netplay User roots (same order as primary resolution). */
function slippiUserDirectoryCandidates(): string[] {
  const home = os.homedir();
  return process.platform === 'win32'
    ? [
        path.join(home, 'AppData', 'Roaming', 'com.project-slippi.dolphin', 'netplay', 'User'),
        path.join(home, 'AppData', 'Roaming', 'Slippi Launcher', 'netplay', 'User'),
        path.join(home, 'AppData', 'Roaming', 'com.project-slippi.dolphin'),
        path.join(home, 'AppData', 'Roaming', 'Slippi Launcher', 'netplay'),
      ]
    : process.platform === 'darwin'
      ? [
          path.join(home, 'Library', 'Application Support', 'com.project-slippi.dolphin', 'netplay', 'User'),
          path.join(home, 'Library', 'Application Support', 'Slippi Launcher', 'netplay', 'User'),
          path.join(home, 'Library', 'Application Support', 'com.project-slippi.dolphin'),
          path.join(home, 'Library', 'Application Support', 'Slippi Launcher', 'netplay'),
        ]
      : [
          path.join(home, '.config', 'com.project-slippi.dolphin', 'netplay', 'User'),
          path.join(home, '.config', 'Slippi Launcher', 'netplay', 'User'),
          path.join(home, '.config', 'SlippiOnline'),
          path.join(home, '.config', 'Slippi Launcher', 'netplay'),
        ];
}

/**
 * Every candidate User dir that already has Config/. Dolphin may load a different
 * one than `-u` depending how it was started — mirror GCPad/Dolphin.ini edits to all.
 */
function allUserDirsWithConfig(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dir of slippiUserDirectoryCandidates()) {
    const key = path.resolve(dir);
    if (seen.has(key)) continue;
    if (fs.existsSync(path.join(dir, 'Config'))) {
      seen.add(key);
      out.push(dir);
    }
  }
  return out;
}

/**
 * Find User roots by scanning for GCPadNew.ini. Stock Dolphin / Faster Melee use
 * `Application Support/<Name>/Config/GCPadNew.ini`; Slippi uses `.../netplay/User/Config/...`.
 * Without this, we only touched Slippi paths while the running app read `~/Library/Application Support/Dolphin`.
 */
function discoverUserDirsWithGcpadNew(): string[] {
  const home = os.homedir();
  const bases =
    process.platform === 'win32'
      ? [path.join(home, 'AppData', 'Roaming')]
      : process.platform === 'darwin'
        ? [path.join(home, 'Library', 'Application Support')]
        : [path.join(home, '.config')];

  const seen = new Set<string>();
  const out: string[] = [];
  const add = (userDir: string) => {
    const k = path.resolve(userDir);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(userDir);
  };

  for (const appSupport of bases) {
    let names: string[];
    try {
      names = fs.readdirSync(appSupport);
    } catch {
      continue;
    }
    for (const name of names) {
      const p = path.join(appSupport, name);
      let st: fs.Stats;
      try {
        st = fs.statSync(p);
      } catch {
        continue;
      }
      if (!st.isDirectory()) continue;

      if (fs.existsSync(path.join(p, 'Config', 'GCPadNew.ini'))) {
        add(p);
        continue;
      }
      const slippiStyle = path.join(p, 'netplay', 'User', 'Config', 'GCPadNew.ini');
      if (fs.existsSync(slippiStyle)) {
        add(path.join(p, 'netplay', 'User'));
      }
    }
  }
  return out;
}

/** Slippi candidates + any other Dolphin install that has GCPadNew.ini on disk. */
function allRelevantUserDirs(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (d: string) => {
    const k = path.resolve(d);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(d);
  };
  for (const d of allUserDirsWithConfig()) add(d);
  for (const d of discoverUserDirsWithGcpadNew()) add(d);
  return out;
}

/**
 * User dirs we mirror GCPad pipe config into. Same list for configure, backup, restore,
 * and stabilize — so restore always targets the files we actually wrote for automation.
 */
function gcpadMirrorUserDirs(): string[] {
  const dirs = allRelevantUserDirs();
  if (dirs.length > 0) return dirs;
  const u = getDolphinUserDir();
  return u ? [u] : [];
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

export function getPipesDir(): string {
  const userDir = getDolphinUserDir();
  if (!userDir) throw new Error('Cannot find Dolphin user directory');
  return path.join(userDir, 'Pipes');
}

export function getPipePath(): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\${PIPE_NAME}`;
  }
  return path.join(getPipesDir(), PIPE_NAME);
}

/**
 * Ensures the named pipe FIFO exists on macOS/Linux.
 * On Windows, the pipe is created when opened by Dolphin.
 */
export function ensurePipeFifo(): void {
  if (process.platform === 'win32') return;

  const pipesDir = getPipesDir();
  fs.mkdirSync(pipesDir, { recursive: true });

  const pipePath = getPipePath();
  if (fs.existsSync(pipePath)) {
    const stat = fs.statSync(pipePath);
    if (stat.isFIFO()) return;
    fs.unlinkSync(pipePath);
  }

  const { execSync } = require('child_process');
  execSync(`mkfifo "${pipePath}"`);
  console.log(`[direct-connect] Created FIFO at ${pipePath}`);
}

/**
 * Simple INI parser/writer that preserves structure well enough for Dolphin configs.
 * configparser-style: [Section] with key = value lines.
 */
function parseIni(content: string): { sections: Map<string, Map<string, string>>; raw: string } {
  const sections = new Map<string, Map<string, string>>();
  let current = '';
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    const sectionMatch = trimmed.match(/^\[(.+)]$/);
    if (sectionMatch) {
      current = sectionMatch[1];
      if (!sections.has(current)) sections.set(current, new Map());
      continue;
    }
    if (current && trimmed && !trimmed.startsWith('#') && !trimmed.startsWith(';')) {
      const eq = trimmed.indexOf('=');
      if (eq > 0) {
        const key = trimmed.slice(0, eq).trimEnd();
        const val = trimmed.slice(eq + 1).trimStart();
        sections.get(current)!.set(key, val);
      }
    }
  }
  return { sections, raw: content };
}

function writeIni(sections: Map<string, Map<string, string>>): string {
  const lines: string[] = [];
  for (const [section, entries] of sections) {
    lines.push(`[${section}]`);
    for (const [key, val] of entries) {
      lines.push(`${key} = ${val}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function configureGCPadInUserDir(userDir: string): void {
  const configDir = path.join(userDir, 'Config');
  fs.mkdirSync(configDir, { recursive: true });

  const iniPath = path.join(configDir, 'GCPadNew.ini');
  let ini: { sections: Map<string, Map<string, string>> };

  if (fs.existsSync(iniPath)) {
    ini = parseIni(fs.readFileSync(iniPath, 'utf8'));
  } else {
    ini = { sections: new Map() };
  }

  const section = `GCPad${BOT_PORT}`;
  if (!ini.sections.has(section)) {
    ini.sections.set(section, new Map());
  }

  const s = ini.sections.get(section)!;
  s.set('Device', `Pipe/0/${PIPE_NAME}`);
  s.set('Buttons/A', 'Button A');
  s.set('Buttons/B', 'Button B');
  s.set('Buttons/X', 'Button X');
  s.set('Buttons/Y', 'Button Y');
  s.set('Buttons/Z', 'Button Z');
  s.set('Buttons/L', 'Button L');
  s.set('Buttons/R', 'Button R');
  s.set('Buttons/Start', 'Button START');
  s.set('Buttons/Threshold', '50.00000000000000');
  s.set('Main Stick/Up', 'Axis MAIN Y +');
  s.set('Main Stick/Down', 'Axis MAIN Y -');
  s.set('Main Stick/Left', 'Axis MAIN X -');
  s.set('Main Stick/Right', 'Axis MAIN X +');
  s.set('Main Stick/Modifier', 'Shift_L');
  s.set('Main Stick/Modifier/Range', '50.000000000000000');
  s.set('Main Stick/Radius', '100.000000000000000');
  s.set('C-Stick/Up', 'Axis C Y +');
  s.set('C-Stick/Down', 'Axis C Y -');
  s.set('C-Stick/Left', 'Axis C X -');
  s.set('C-Stick/Right', 'Axis C X +');
  s.set('C-Stick/Radius', '100.000000000000000');
  s.set('D-Pad/Up', 'Button D_UP');
  s.set('D-Pad/Down', 'Button D_DOWN');
  s.set('D-Pad/Left', 'Button D_LEFT');
  s.set('D-Pad/Right', 'Button D_RIGHT');
  s.set('Triggers/L', 'Button L');
  s.set('Triggers/R', 'Button R');
  s.set('Triggers/L-Analog', 'Axis L -+');
  s.set('Triggers/R-Analog', 'Axis R -+');
  s.set('Triggers/Threshold', '90.00000000000000');

  fs.writeFileSync(iniPath, writeIni(ini.sections));
  console.log(`[direct-connect] Configured GCPadNew.ini [${section}] → Pipe/0/${PIPE_NAME} (${userDir})`);
}

/**
 * Configure GCPadNew.ini pipe on port BOT_PORT in every Slippi User dir that has Config/.
 */
export function configureGCPad(): void {
  const dirs = gcpadMirrorUserDirs();
  if (dirs.length === 0) throw new Error('Cannot find Dolphin user directory');
  console.log(
    `[direct-connect] Mirroring pipe GCPad to ${dirs.length} User dir(s) (Slippi + any Dolphin installs found)`,
  );
  for (const userDir of dirs) {
    configureGCPadInUserDir(userDir);
  }
}

/**
 * Check if Dolphin is already configured for pipe input on port 4.
 * Returns true if both GCPadNew.ini and Dolphin.ini are set up.
 */
export function isDolphinConfigured(): boolean {
  const userDir = getDolphinUserDir();
  if (!userDir) return false;

  try {
    // Check Dolphin.ini has SIDevice3 = 6
    const dolphinIniPath = path.join(userDir, 'Config', 'Dolphin.ini');
    if (!fs.existsSync(dolphinIniPath)) return false;
    const dolphinIni = parseIni(fs.readFileSync(dolphinIniPath, 'utf8'));
    const core = dolphinIni.sections.get('Core');
    if (!core || core.get(`SIDevice${BOT_PORT - 1}`) !== '6') return false;

    // Check GCPadNew.ini has pipe device for port 4
    const gcpadPath = path.join(userDir, 'Config', 'GCPadNew.ini');
    if (!fs.existsSync(gcpadPath)) return false;
    const gcpadIni = parseIni(fs.readFileSync(gcpadPath, 'utf8'));
    const section = gcpadIni.sections.get(`GCPad${BOT_PORT}`);
    if (!section || !section.get('Device')?.includes(PIPE_NAME)) return false;

    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure Dolphin.ini has SIDevice3 set to "6" (standard controller) so port 4 is active.
 * SIDevice indices are 0-based, so port 4 = SIDevice3.
 * This change is PERSISTENT — not restored on cleanup.
 */
export function configureDolphinIni(): void {
  const list = gcpadMirrorUserDirs();
  if (list.length === 0) throw new Error('Cannot find Dolphin user directory');

  for (const userDir of list) {
    const iniPath = path.join(userDir, 'Config', 'Dolphin.ini');
    if (!fs.existsSync(iniPath)) continue;

    const ini = parseIni(fs.readFileSync(iniPath, 'utf8'));
    if (!ini.sections.has('Core')) {
      ini.sections.set('Core', new Map());
    }

    const core = ini.sections.get('Core')!;
    const deviceKey = `SIDevice${BOT_PORT - 1}`;
    const currentValue = core.get(deviceKey);

    if (currentValue !== '6') {
      core.set(deviceKey, '6');
      fs.writeFileSync(iniPath, writeIni(ini.sections));
      console.log(`[direct-connect] Set ${deviceKey} = 6 in Dolphin.ini (was ${currentValue}) (${userDir})`);
    }
  }
}

/**
 * Save GCPadNew.ini before we overwrite GCPad1 with pipe config.
 * If it's already been corrupted by a previous run (Device = pipe), try to
 * load the user's saved controller profile as a fallback.
 */
export function backupControllerConfig(): void {
  const dirs = gcpadMirrorUserDirs();
  if (dirs.length === 0) return;

  for (const userDir of dirs) {
    const gcpadPath = path.join(userDir, 'Config', 'GCPadNew.ini');
    if (!fs.existsSync(gcpadPath)) continue;

    const contents = fs.readFileSync(gcpadPath, 'utf8');
    const ini = parseIni(contents);
    const section = ini.sections.get(`GCPad${BOT_PORT}`);
    const device = section?.get('Device') ?? '';

    if (!device.includes(`Pipe/0/${PIPE_NAME}`)) {
      savedGCPadContents = contents;
      writeLocalDebugGcpadBackup(contents);
      for (const ud of dirs) {
        writeFriendliesGcpadBackup(ud, contents);
      }
      console.log('[direct-connect] Backed up GCPadNew.ini (user config intact)');
      return;
    }
  }

  let iniForProfile: { sections: Map<string, Map<string, string>> } | null = null;
  for (const userDir of dirs) {
    const gcpadPath = path.join(userDir, 'Config', 'GCPadNew.ini');
    if (fs.existsSync(gcpadPath)) {
      iniForProfile = parseIni(fs.readFileSync(gcpadPath, 'utf8'));
      break;
    }
  }

  for (const userDir of dirs) {
    const sidecar = readFriendliesGcpadBackup(userDir);
    if (sidecar) {
      savedGCPadContents = sidecar;
      console.log(`[direct-connect] Using GCPadNew.friendlies-backup.ini (${userDir})`);
      return;
    }
  }

  const localSnap = readLocalDebugGcpadBackup();
  if (localSnap && gcpad1IsUserConfig(localSnap)) {
    savedGCPadContents = localSnap;
    console.log('[direct-connect] Using local debug GCPad snapshot for restore');
    return;
  }

  const firstDir = dirs[0]!;
  const profilePath = path.join(firstDir, 'Config', 'Profiles', 'GCPad', 'B0XX_macOS.ini');
  if (iniForProfile && fs.existsSync(profilePath)) {
    const profile = parseIni(fs.readFileSync(profilePath, 'utf8'));
    const profileSection = profile.sections.get('Profile');
    if (profileSection) {
      const restored = new Map(iniForProfile.sections);
      const restoredGCPad = new Map<string, string>();
      for (const [k, v] of profileSection) {
        restoredGCPad.set(k, v);
      }
      restored.set(`GCPad${BOT_PORT}`, restoredGCPad);
      savedGCPadContents = writeIni(restored);
      console.log('[direct-connect] Built restore config from B0XX_macOS profile');
      return;
    }
  }

  console.warn('[direct-connect] No clean backup available and no profile found');
}

/**
 * Restore [GCPadN] from backup into the same User dirs as configureGCPad (single mirror list).
 */
export function restoreControllerConfig(): void {
  const dirs = gcpadMirrorUserDirs();
  if (dirs.length === 0) return;

  let backupRaw: string | null = savedGCPadContents;
  if (backupRaw === null) {
    for (const userDir of dirs) {
      const sidecar = readFriendliesGcpadBackup(userDir);
      if (sidecar) {
        backupRaw = sidecar;
        console.log(`[direct-connect] Restoring from GCPadNew.friendlies-backup.ini (${userDir})`);
        break;
      }
    }
  }
  if (backupRaw === null) {
    const local = readLocalDebugGcpadBackup();
    if (local && gcpad1IsUserConfig(local)) {
      backupRaw = local;
      console.log('[direct-connect] Restoring from local debug GCPad snapshot');
    }
  }

  if (backupRaw === null) {
    console.warn('[direct-connect] No GCPad restore payload (run direct connect once with a clean Port 1 config to seed backup)');
    return;
  }

  const sectionName = `GCPad${BOT_PORT}`;
  const backupIni = parseIni(backupRaw);
  const restoredSection = backupIni.sections.get(sectionName);
  if (!restoredSection || restoredSection.size === 0) {
    console.warn(`[direct-connect] Backup has no [${sectionName}] section`);
    return;
  }

  savedGCPadContents = null;

  for (const userDir of dirs) {
    const configDir = path.join(userDir, 'Config');
    fs.mkdirSync(configDir, { recursive: true });
    const gcpadPath = path.join(configDir, 'GCPadNew.ini');

    const merged = fs.existsSync(gcpadPath)
      ? parseIni(fs.readFileSync(gcpadPath, 'utf8')).sections
      : new Map(backupIni.sections);
    merged.set(sectionName, new Map(restoredSection));

    const tmpPath = `${gcpadPath}.friendlies-restore.tmp`;
    try {
      fs.writeFileSync(tmpPath, writeIni(merged), 'utf8');
      fs.renameSync(tmpPath, gcpadPath);
    } catch (e: any) {
      console.error(`[direct-connect] Failed to write ${gcpadPath}: ${e.message}`);
      try { fs.unlinkSync(tmpPath); } catch {}
      continue;
    }

    let verifyDevice = '';
    try {
      verifyDevice = parseIni(fs.readFileSync(gcpadPath, 'utf8')).sections.get(sectionName)?.get('Device') ?? '';
    } catch {}

    if (verifyDevice.includes(PIPE_NAME)) {
      console.error(`[direct-connect] After restore, ${gcpadPath} still has pipe: ${verifyDevice}`);
    } else {
      console.log(`[direct-connect] Restored [${sectionName}] — ${verifyDevice || '(missing)'} (${userDir})`);
    }
  }
}

/**
 * Dolphin often re-saves [GCPad1] with the pipe device shortly after the FIFO writer
 * disconnects (in-memory state wins over our first restore). Re-apply restore with
 * short delays until on-disk Device no longer references our pipe, or we hit a cap.
 */
function gcpad1StillPipeInAnyMirroredDir(): boolean {
  const sectionName = `GCPad${BOT_PORT}`;
  const needle = `Pipe/0/${PIPE_NAME}`;
  for (const userDir of gcpadMirrorUserDirs()) {
    const gcpadPath = path.join(userDir, 'Config', 'GCPadNew.ini');
    if (!fs.existsSync(gcpadPath)) continue;
    try {
      const dev =
        parseIni(fs.readFileSync(gcpadPath, 'utf8')).sections.get(sectionName)?.get('Device') ?? '';
      if (dev.includes(needle)) return true;
    } catch {
      continue;
    }
  }
  return false;
}

export async function stabilizeGcpadRestore(): Promise<void> {
  const maxPasses = 10;
  const gapMs = 450;
  for (let i = 0; i < maxPasses; i++) {
    if (i > 0) {
      await new Promise((r) => setTimeout(r, gapMs));
    }
    restoreControllerConfig();
    if (!gcpad1StillPipeInAnyMirroredDir()) {
      if (i > 0) {
        console.log(`[direct-connect] GCPad1 stable (not pipe) after stabilize pass ${i + 1}`);
      }
      return;
    }
    console.warn(
      `[direct-connect] GCPad1 still pipe on disk after pass ${i + 1}, retrying restore...`,
    );
  }
  console.warn(
    '[direct-connect] Could not clear pipe from GCPadNew.ini after retries (Dolphin may keep overwriting while running)',
  );
}

/**
 * Apply pipe + SIDevice config and FIFO. Call {@link backupControllerConfig} first, every run.
 */
export function setupDolphinForDirectConnect(): void {
  const ud = getDolphinUserDir();
  if (ud) console.log(`[direct-connect] Dolphin User directory: ${ud}`);
  configureGCPad();
  configureDolphinIni();
  ensurePipeFifo();
}
