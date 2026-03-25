/**
 * Blind input — pre-computes the FULL input sequence from Dolphin boot
 * through code submission, all without spectator port feedback.
 *
 * Phases:
 *   1. Wait for Melee to boot into the Slippi Online mode select
 *   2. Navigate to "Direct" and select it
 *   3. At CSS, pick a character and press START
 *   4. Type the connect code on the virtual keyboard
 *   5. Press START to submit
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
  const row1 = 'ABCDEFGHIJ';  // cols 0-9
  const row2 = 'KLMNOPQRST';  // cols 0-9
  // Row 3 visual: U V W X Y Z [blank] [blank] [blank] #
  // # is at column 9, blanks at 6-8
  const row4 = '0123456789';   // cols 0-9

  if (char === '#') return 47 - (9 * 5); // col 9, row 2 → position 2

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

/**
 * Emit a single stick-move on the keyboard grid:
 * hold the direction for HOLD_MS, release, wait GAP_MS.
 */
function kbMove(x: number, y: number): InputStep[] {
  return [
    { type: 'stick', x, y },
    { type: 'wait', ms: 80 },
    { type: 'release' },
    { type: 'wait', ms: 80 },
  ];
}

/**
 * Convert a keyboard position code to (row, col).
 * Positions are grouped by column: col 0 = 45-49, col 1 = 40-44, etc.
 */
function posToGrid(pos: number): { row: number; col: number } {
  const col = Math.floor((49 - pos) / 5);
  const row = pos - (45 - col * 5);
  return { row, col };
}

/**
 * Navigate the keyboard grid using (row, col) coordinates.
 * Moves columns first (RIGHT/LEFT), then rows (DOWN/UP).
 * This avoids the wrapping bug where UP from row 0 crosses into
 * the adjacent column in the linear position space.
 */
function computeMovesFromTo(from: number, to: number): InputStep[] {
  if (from === to) return [];
  const steps: InputStep[] = [];
  const f = posToGrid(from);
  const t = posToGrid(to);

  while (f.col < t.col) {
    steps.push(...kbMove(1, 0.5)); // RIGHT
    f.col++;
  }
  while (f.col > t.col) {
    steps.push(...kbMove(0, 0.5)); // LEFT
    f.col--;
  }

  while (f.row < t.row) {
    steps.push(...kbMove(0.5, 0)); // DOWN
    f.row++;
  }
  while (f.row > t.row) {
    steps.push(...kbMove(0.5, 1)); // UP
    f.row--;
  }

  return steps;
}

/**
 * Helper: press a button, release, wait a few frames.
 */
function tap(button: 'A' | 'B' | 'START', holdMs = 50, gapMs = 100): InputStep[] {
  return [
    { type: 'press', button },
    { type: 'wait', ms: holdMs },
    { type: 'release' },
    { type: 'wait', ms: gapMs },
  ];
}

/**
 * Generate the FULL input sequence from Dolphin boot to code submission.
 *
 * Slippi Dolphin boots directly to the Online Play mode select
 * (Ranked / Unranked / Direct / Teams).
 */
export function generateFullSequence(connectCode: string): InputStep[] {
  const code = connectCode.toUpperCase();
  const steps: InputStep[] = [];

  // ──── Phase 1: Wait for Melee to boot ────
  steps.push({ type: 'phase', name: 'boot_wait' });
  steps.push({ type: 'wait', ms: 10_000 });

  // ──── Phase 2: Mode select → navigate to "Direct" ────
  // Slippi Online mode select defaults to "Unranked" (2nd item).
  // One DOWN reaches "Direct" (3rd item).
  steps.push({ type: 'phase', name: 'mode_select' });

  // DOWN once: Unranked → Direct
  steps.push({ type: 'stick', x: 0.5, y: 0 }); // stick down
  steps.push({ type: 'wait', ms: 50 });
  steps.push({ type: 'release' });
  steps.push({ type: 'wait', ms: 200 });

  // Select "Direct"
  steps.push(...tap('A', 50, 500));

  // ──── Phase 3: CSS → pick character, press START ────
  // Wait for CSS to fully load.
  steps.push({ type: 'phase', name: 'css' });
  steps.push({ type: 'wait', ms: 3000 });

  // Move the hand cursor up to reach the character rows (Fox/Falco area)
  steps.push({ type: 'stick', x: 0.5, y: 0.7 });
  steps.push({ type: 'wait', ms: 400 });
  steps.push({ type: 'release' });
  steps.push({ type: 'wait', ms: 300 });

  // Press A to lock in the character
  steps.push(...tap('A', 100, 1500));

  // Press START to proceed to code entry
  steps.push(...tap('START', 100, 500));

  // ──── Phase 4: Code entry — type the connect code ────
  // Wait for the name entry keyboard to fully appear and become responsive.
  steps.push({ type: 'phase', name: 'code_entry' });
  steps.push({ type: 'wait', ms: 3000 });

  let currentPos = 45; // cursor starts at 'A'

  for (const char of code) {
    const targetCode = charToCode(char);
    if (targetCode === -1) {
      console.error(`[blind-input] Unsupported character: '${char}'`);
      continue;
    }

    const moves = computeMovesFromTo(currentPos, targetCode);
    steps.push(...moves);

    // Pause before pressing A, then press to select the character
    steps.push({ type: 'wait', ms: 100 });
    steps.push(...tap('A', 80, 150));

    currentPos = targetCode;
  }

  // ──── Phase 5: Submit the code ────
  steps.push({ type: 'phase', name: 'submit' });
  steps.push({ type: 'wait', ms: 500 });
  // Press START to submit (works from keyboard grid)
  steps.push(...tap('START', 100, 500));
  // Backup: if cursor landed on CONFIRM, press A to activate it
  steps.push(...tap('A', 100, 200));

  return steps;
}

/**
 * Execute a blind input sequence. Reports phase transitions via callback.
 */
export async function executeFullSequence(
  connectCode: string,
  controller: PipeController,
  onPhase?: (phase: string) => void,
): Promise<void> {
  const steps = generateFullSequence(connectCode);
  const FRAME_MS = 17;

  console.log(`[blind-input] Executing ${steps.length} steps for "${connectCode}"`);

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

      case 'wait':
        await sleep(step.ms);
        break;
    }
  }

  console.log('[blind-input] Full sequence complete');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
