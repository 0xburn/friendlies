/**
 * Manages Dolphin configuration for virtual controller pipe input.
 *
 * Uses the same approach as libmelee: copy the user's Dolphin home to a temp
 * directory, modify GCPadNew.ini there, and launch Dolphin with `-u tempDir`.
 * The user's real config is NEVER modified. Cleanup just deletes the temp dir.
 *
 * Based on libmelee's Console.setup_dolphin_controller() + tmp_home_directory.
 * See: https://github.com/vladfi1/libmelee/blob/master/melee/console.py
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const BOT_PORT = 1;
const PIPE_NAME = `slippibot${BOT_PORT}`;

let tempUserDir: string | null = null;

// ---------------------------------------------------------------------------
// Temp directory lifecycle
// ---------------------------------------------------------------------------

/**
 * Create a temp copy of the real Dolphin User directory. All pipe config edits
 * go here; the real dir is never touched. Returns the temp User dir path.
 */
export function createTempUserDir(): string {
  cleanupTempUserDir();

  const realDir = getDolphinUserDir();
  if (!realDir) throw new Error('Cannot find Dolphin user directory');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'friendlies-dolphin-'));
  const dest = path.join(tmp, 'User');

  copyDirSyncSkipFifos(realDir, dest);

  tempUserDir = dest;
  console.log(`[direct-connect] Created temp User dir: ${dest} (copied from ${realDir})`);
  return dest;
}

/** Get the current temp User dir (null if none active). */
export function getTempUserDir(): string | null {
  return tempUserDir;
}

/** Delete the temp directory. Safe to call multiple times. */
export function cleanupTempUserDir(): void {
  if (!tempUserDir) return;
  const root = path.dirname(tempUserDir);
  try {
    fs.rmSync(root, { recursive: true, force: true });
    console.log(`[direct-connect] Cleaned up temp dir: ${root}`);
  } catch (e: any) {
    console.warn(`[direct-connect] Failed to clean temp dir ${root}: ${e.message}`);
  }
  tempUserDir = null;
}

function copyDirSyncSkipFifos(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSyncSkipFifos(srcPath, destPath);
    } else if (entry.isSymbolicLink()) {
      fs.symlinkSync(fs.readlinkSync(srcPath), destPath);
    } else {
      try {
        const stat = fs.statSync(srcPath);
        if (stat.isFIFO()) continue;
      } catch { /* skip unreadable */ continue; }
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ---------------------------------------------------------------------------
// Real user directory resolution
// ---------------------------------------------------------------------------

function slippiUserDirectoryCandidates(): string[] {
  const home = os.homedir();
  return process.platform === 'win32'
    ? [
        path.join(home, 'AppData', 'Roaming', 'com.project-slippi.dolphin', 'netplay', 'User'),
        path.join(home, 'AppData', 'Roaming', 'Slippi Launcher', 'netplay', 'User'),
      ]
    : process.platform === 'darwin'
      ? [
          path.join(home, 'Library', 'Application Support', 'com.project-slippi.dolphin', 'netplay', 'User'),
          path.join(home, 'Library', 'Application Support', 'Slippi Launcher', 'netplay', 'User'),
        ]
      : [
          path.join(home, '.config', 'com.project-slippi.dolphin', 'netplay', 'User'),
          path.join(home, '.config', 'Slippi Launcher', 'netplay', 'User'),
          path.join(home, '.config', 'SlippiOnline'),
        ];
}

export function getDolphinUserDir(): string | null {
  for (const dir of slippiUserDirectoryCandidates()) {
    if (fs.existsSync(path.join(dir, 'Config'))) return dir;
  }
  for (const dir of slippiUserDirectoryCandidates()) {
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Pipe + config setup (writes to temp dir only)
// ---------------------------------------------------------------------------

/**
 * The directory Dolphin should use for Pipes. When a temp dir is active we
 * use that; otherwise fall back to the real dir so FIFO creation still works.
 */
export function getPipesDir(): string {
  const base = tempUserDir ?? getDolphinUserDir();
  if (!base) throw new Error('Cannot find Dolphin user directory');
  return path.join(base, 'Pipes');
}

export function getPipePath(): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\${PIPE_NAME}`;
  }
  return path.join(getPipesDir(), PIPE_NAME);
}

export function ensurePipeFifo(): void {
  if (process.platform === 'win32') return;

  const pipesDir = getPipesDir();
  fs.mkdirSync(pipesDir, { recursive: true });

  const pipePath = getPipePath();
  if (fs.existsSync(pipePath)) {
    try {
      const stat = fs.statSync(pipePath);
      if (stat.isFIFO()) return;
    } catch { /* fall through to recreate */ }
    fs.unlinkSync(pipePath);
  }

  const { execSync } = require('child_process');
  execSync(`mkfifo "${pipePath}"`);
  console.log(`[direct-connect] Created FIFO at ${pipePath}`);
}

// ---------------------------------------------------------------------------
// INI helpers
// ---------------------------------------------------------------------------

function parseIni(content: string): Map<string, Map<string, string>> {
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
        sections.get(current)!.set(trimmed.slice(0, eq).trimEnd(), trimmed.slice(eq + 1).trimStart());
      }
    }
  }
  return sections;
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

// ---------------------------------------------------------------------------
// Configure GCPadNew.ini + Dolphin.ini in the temp dir
// ---------------------------------------------------------------------------

/**
 * Read the user's existing keyboard bindings for Port 1 from the real config.
 * Returns a map of binding key → keyboard expression (e.g. "Buttons/A" → "A").
 */
function readUserKeyboardBindings(): Map<string, string> {
  const realDir = getDolphinUserDir();
  if (!realDir) return new Map();
  const gcpadPath = path.join(realDir, 'Config', 'GCPadNew.ini');
  if (!fs.existsSync(gcpadPath)) return new Map();

  const sections = parseIni(fs.readFileSync(gcpadPath, 'utf8'));
  const section = sections.get(`GCPad${BOT_PORT}`);
  if (!section) return new Map();

  const device = section.get('Device') ?? '';
  if (device.includes('Pipe/0/')) return new Map();

  return section;
}

/**
 * Build a combined expression: pipe input OR keyboard input.
 * Both sides are backtick-quoted for the expression parser.
 * Strips any existing backticks from the keyboard binding to avoid nesting.
 */
function combinedExpr(pipeBinding: string, kbDevice: string, kbBinding: string): string {
  if (!kbBinding) return pipeBinding;
  const cleanKb = kbBinding.replace(/`/g, '');
  return `\`${pipeBinding}\` | \`${kbDevice}:${cleanKb}\``;
}

function configureGCPadInDir(userDir: string): void {
  const configDir = path.join(userDir, 'Config');
  fs.mkdirSync(configDir, { recursive: true });

  const iniPath = path.join(configDir, 'GCPadNew.ini');
  const sections = fs.existsSync(iniPath)
    ? parseIni(fs.readFileSync(iniPath, 'utf8'))
    : new Map<string, Map<string, string>>();

  const userBindings = readUserKeyboardBindings();
  const kbDevice = userBindings.get('Device') ?? '';
  const kb = (key: string) => userBindings.get(key) ?? '';

  const section = `GCPad${BOT_PORT}`;
  sections.set(section, new Map());

  const s = sections.get(section)!;
  s.set('Device', `Pipe/0/${PIPE_NAME}`);

  s.set('Buttons/A', combinedExpr('Button A', kbDevice, kb('Buttons/A')));
  s.set('Buttons/B', combinedExpr('Button B', kbDevice, kb('Buttons/B')));
  s.set('Buttons/X', combinedExpr('Button X', kbDevice, kb('Buttons/X')));
  s.set('Buttons/Y', combinedExpr('Button Y', kbDevice, kb('Buttons/Y')));
  s.set('Buttons/Z', combinedExpr('Button Z', kbDevice, kb('Buttons/Z')));
  s.set('Buttons/L', combinedExpr('Button L', kbDevice, kb('Buttons/L')));
  s.set('Buttons/R', combinedExpr('Button R', kbDevice, kb('Buttons/R')));
  s.set('Buttons/Start', combinedExpr('Button START', kbDevice, kb('Buttons/Start')));
  s.set('Buttons/Threshold', '50');

  s.set('Main Stick/Up', combinedExpr('Axis MAIN Y +', kbDevice, kb('Main Stick/Up')));
  s.set('Main Stick/Down', combinedExpr('Axis MAIN Y -', kbDevice, kb('Main Stick/Down')));
  s.set('Main Stick/Left', combinedExpr('Axis MAIN X -', kbDevice, kb('Main Stick/Left')));
  s.set('Main Stick/Right', combinedExpr('Axis MAIN X +', kbDevice, kb('Main Stick/Right')));
  s.set('Main Stick/Radius', '100');

  s.set('C-Stick/Up', combinedExpr('Axis C Y +', kbDevice, kb('C-Stick/Up')));
  s.set('C-Stick/Down', combinedExpr('Axis C Y -', kbDevice, kb('C-Stick/Down')));
  s.set('C-Stick/Left', combinedExpr('Axis C X -', kbDevice, kb('C-Stick/Left')));
  s.set('C-Stick/Right', combinedExpr('Axis C X +', kbDevice, kb('C-Stick/Right')));
  s.set('C-Stick/Radius', '100');

  s.set('D-Pad/Up', combinedExpr('Button D_UP', kbDevice, kb('D-Pad/Up')));
  s.set('D-Pad/Down', combinedExpr('Button D_DOWN', kbDevice, kb('D-Pad/Down')));
  s.set('D-Pad/Left', combinedExpr('Button D_LEFT', kbDevice, kb('D-Pad/Left')));
  s.set('D-Pad/Right', combinedExpr('Button D_RIGHT', kbDevice, kb('D-Pad/Right')));

  s.set('Triggers/L', combinedExpr('Button L', kbDevice, kb('Triggers/L')));
  s.set('Triggers/R', combinedExpr('Button R', kbDevice, kb('Triggers/R')));
  s.set('Triggers/L-Analog', combinedExpr('Axis L +', kbDevice, kb('Triggers/L-Analog')));
  s.set('Triggers/R-Analog', combinedExpr('Axis R +', kbDevice, kb('Triggers/R-Analog')));
  s.set('Triggers/Threshold', '90');

  fs.writeFileSync(iniPath, writeIni(sections));
  console.log(`[direct-connect] Configured [${section}] → Pipe + keyboard combined in temp dir`);
}

function configureDolphinIniInDir(userDir: string): void {
  const iniPath = path.join(userDir, 'Config', 'Dolphin.ini');
  if (!fs.existsSync(iniPath)) return;

  const sections = parseIni(fs.readFileSync(iniPath, 'utf8'));
  if (!sections.has('Core')) sections.set('Core', new Map());

  const core = sections.get('Core')!;
  const deviceKey = `SIDevice${BOT_PORT - 1}`;
  if (core.get(deviceKey) !== '6') {
    core.set(deviceKey, '6');
    fs.writeFileSync(iniPath, writeIni(sections));
    console.log(`[direct-connect] Set ${deviceKey} = 6 in temp Dolphin.ini`);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Full setup: create temp dir, configure pipe controller + SIDevice, create FIFO.
 * Returns the temp User dir path (pass to Dolphin via `-u`).
 */
export function setupDolphinForDirectConnect(): string {
  const tmpDir = createTempUserDir();
  configureGCPadInDir(tmpDir);
  configureDolphinIniInDir(tmpDir);
  ensurePipeFifo();
  return tmpDir;
}
