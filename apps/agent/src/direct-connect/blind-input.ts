/**
 * Blind input — types a connect code on Slippi's virtual keyboard.
 *
 * The user navigates to the code-entry screen manually, then presses a
 * hotkey. This module takes over and types the code at high speed.
 *
 * Virtual keyboard grid (position codes, cursor starts at 45 = 'A'):
 *   A=45 B=40 C=35 D=30 E=25 F=20 G=15 H=10 I=5  J=0
 *   K=46 L=41 M=36 N=31 O=26 P=21 Q=16 R=11 S=6  T=1
 *   U=47 V=42 W=37 X=32 Y=27 Z=22 ' '=17 #=12
 *   0=48 1=43 2=38 3=33 4=28 5=23 6=18 7=13 8=8  9=3
 *
 * Navigation:
 *   RIGHT = position decreases by 5 (next column)
 *   LEFT  = position increases by 5 (prev column)
 *   DOWN  = position increases by 1 (next row)
 *   UP    = position decreases by 1 (prev row)
 */

import { PipeController } from './pipe-controller';

type InputStep =
  | { type: 'stick'; x: number; y: number }
  | { type: 'press'; button: 'A' | 'B' | 'START' }
  | { type: 'release' }
  | { type: 'wait'; ms: number }
  | { type: 'phase'; name: string };

function charToCode(char: string): number {
  const row1 = 'ABCDEFGHIJ';
  const row2 = 'KLMNOPQRST';
  const row4 = '0123456789';

  if (char === '#') return 47 - (9 * 5);

  let col = row1.indexOf(char);
  if (col !== -1) return 45 - (col * 5);

  col = row2.indexOf(char);
  if (col !== -1) return 46 - (col * 5);

  const row3 = 'UVWXYZ';
  col = row3.indexOf(char);
  if (col !== -1) return 47 - (col * 5);

  col = row4.indexOf(char);
  if (col !== -1) return 48 - (col * 5);

  return -1;
}

function posToGrid(pos: number): { row: number; col: number } {
  const col = Math.floor((49 - pos) / 5);
  const row = pos - (45 - col * 5);
  return { row, col };
}

function kbMove(x: number, y: number, holdMs: number, gapMs: number): InputStep[] {
  return [
    { type: 'stick', x, y },
    { type: 'wait', ms: holdMs },
    { type: 'release' },
    { type: 'wait', ms: gapMs },
  ];
}

function computeMovesFromTo(
  from: number, to: number, holdMs: number, gapMs: number,
): InputStep[] {
  if (from === to) return [];
  const steps: InputStep[] = [];
  const f = posToGrid(from);
  const t = posToGrid(to);

  while (f.col < t.col) { steps.push(...kbMove(1, 0.5, holdMs, gapMs)); f.col++; }
  while (f.col > t.col) { steps.push(...kbMove(0, 0.5, holdMs, gapMs)); f.col--; }
  while (f.row < t.row) { steps.push(...kbMove(0.5, 0, holdMs, gapMs)); f.row++; }
  while (f.row > t.row) { steps.push(...kbMove(0.5, 1, holdMs, gapMs)); f.row--; }

  return steps;
}

function tap(button: 'A' | 'B' | 'START', holdMs: number, gapMs: number): InputStep[] {
  return [
    { type: 'press', button },
    { type: 'wait', ms: holdMs },
    { type: 'release' },
    { type: 'wait', ms: gapMs },
  ];
}

// ── Fast code-entry-only sequence ──────────────────────────────────────

const FAST_HOLD = 17;  // 1 frame at 60fps — minimum for Dolphin to register
const FAST_GAP  = 17;

export function generateCodeEntrySequence(connectCode: string): InputStep[] {
  const code = connectCode.toUpperCase();
  const steps: InputStep[] = [];

  steps.push({ type: 'phase', name: 'code_entry' });

  let currentPos = 45; // cursor starts at 'A'

  for (const char of code) {
    const targetCode = charToCode(char);
    if (targetCode === -1) {
      console.error(`[blind-input] Unsupported character: '${char}'`);
      continue;
    }

    steps.push(...computeMovesFromTo(currentPos, targetCode, FAST_HOLD, FAST_GAP));
    steps.push(...tap('A', FAST_HOLD, 34));

    currentPos = targetCode;
  }

  steps.push({ type: 'phase', name: 'submit' });
  steps.push({ type: 'wait', ms: 100 });
  steps.push(...tap('START', 34, 100));
  steps.push(...tap('A', 34, 50));

  return steps;
}

/**
 * Execute a step sequence. Reports phase transitions via callback.
 */
async function runSteps(
  steps: InputStep[],
  controller: PipeController,
  label: string,
  onPhase?: (phase: string) => void,
): Promise<void> {
  const FRAME_MS = 17;

  console.log(`[blind-input] Executing ${steps.length} steps for "${label}"`);

  for (let i = 0; i < steps.length; i++) {
    if (!controller.isConnected()) {
      throw new Error('Controller disconnected during blind input');
    }

    const step = steps[i];

    switch (step.type) {
      case 'phase':
        console.log(`[blind-input] Phase: ${step.name}`);
        onPhase?.(step.name);
        break;

      case 'stick':
        controller.tiltStick('MAIN', step.x, step.y);
        controller.flush();
        await sleep(FRAME_MS);
        break;

      case 'press':
        controller.pressButton(step.button);
        controller.flush();
        await sleep(FRAME_MS);
        break;

      case 'release':
        controller.releaseAll();
        controller.flush();
        await sleep(FRAME_MS);
        break;

      case 'wait': {
        let remaining = step.ms;
        while (remaining > 0) {
          const chunk = Math.min(remaining, 100);
          await sleep(chunk);
          remaining -= chunk;
          if (remaining > 0 && controller.isConnected()) {
            controller.flush();
          }
        }
        break;
      }
    }
  }

  console.log('[blind-input] Sequence complete');
}

export async function executeCodeEntry(
  connectCode: string,
  controller: PipeController,
  onPhase?: (phase: string) => void,
): Promise<void> {
  const steps = generateCodeEntrySequence(connectCode);
  return runSteps(steps, controller, connectCode, onPhase);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
