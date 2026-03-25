/**
 * Finds, launches, and kills Slippi Dolphin.
 *
 * Dolphin executable is located via known install paths.
 * Melee ISO path is read from Dolphin.ini (LastFilename / ISOPath0).
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getDolphinUserDir } from './dolphin-config';
import { DOLPHIN_PROCESS_NAMES } from '../config';

const find = require('find-process') as (
  type: 'name',
  name: string,
  strict?: boolean,
) => Promise<Array<{ name: string; pid: number }>>;

export function getDolphinExePath(): string | null {
  const home = os.homedir();

  const candidates: string[] =
    process.platform === 'win32'
      ? [
          path.join(home, 'AppData', 'Roaming', 'Slippi Launcher', 'netplay', 'Slippi Dolphin.exe'),
          path.join(home, 'AppData', 'Local', 'Programs', 'Slippi Launcher', 'netplay', 'Slippi Dolphin.exe'),
        ]
      : process.platform === 'darwin'
        ? [
            path.join(home, 'Library', 'Application Support', 'Slippi Launcher', 'netplay',
              'Slippi Dolphin.app', 'Contents', 'MacOS', 'Slippi Dolphin'),
            '/Applications/Slippi Dolphin.app/Contents/MacOS/Slippi Dolphin',
          ]
        : [
            path.join(home, '.config', 'Slippi Launcher', 'netplay', 'Slippi_Dolphin'),
            path.join(home, '.config', 'Slippi Launcher', 'netplay', 'squashfs-root', 'usr', 'bin', 'dolphin-emu'),
          ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function getMeleeIsoPath(): string | null {
  const userDir = getDolphinUserDir();
  if (!userDir) return null;

  const iniPath = path.join(userDir, 'Config', 'Dolphin.ini');
  if (!fs.existsSync(iniPath)) return null;

  const content = fs.readFileSync(iniPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('LastFilename')) {
      const eq = trimmed.indexOf('=');
      if (eq > 0) {
        const val = trimmed.slice(eq + 1).trim();
        if (val && fs.existsSync(val)) return val;
      }
    }
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('ISOPath0')) {
      const eq = trimmed.indexOf('=');
      if (eq > 0) {
        const val = trimmed.slice(eq + 1).trim();
        if (val && fs.existsSync(val)) return val;
      }
    }
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
  for (const pid of pids) {
    try { process.kill(pid, 'SIGTERM'); } catch {}
  }

  // Wait for processes to exit (up to 5 seconds)
  for (let i = 0; i < 25; i++) {
    await sleep(200);
    const remaining = await getDolphinPids();
    if (remaining.length === 0) {
      console.log('[dolphin-launcher] Dolphin stopped');
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
}

export function launchDolphin(): void {
  const exePath = getDolphinExePath();
  if (!exePath) throw new Error('Cannot find Slippi Dolphin executable');

  const isoPath = getMeleeIsoPath();
  if (!isoPath) throw new Error('Cannot find Melee ISO (check Dolphin.ini LastFilename)');

  const userDir = getDolphinUserDir();

  const args = ['-e', isoPath];
  if (userDir) {
    args.push('-u', userDir);
  }

  console.log(`[dolphin-launcher] Launching: "${exePath}" ${args.map(a => `"${a}"`).join(' ')}`);

  const child = spawn(exePath, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
