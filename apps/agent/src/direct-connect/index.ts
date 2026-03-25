/**
 * DirectConnectService — full automated direct connect.
 *
 * One button click does everything:
 *   1. Copy Dolphin User dir to a temp location
 *   2. Configure pipe controller in the TEMP copy (real config never touched)
 *   3. Kill existing Dolphin, launch with `-u tempDir`
 *   4. Connect virtual controller pipe, navigate menus, type code
 *   5. Cleanup: disconnect pipe, delete temp dir
 *
 * The user's real GCPadNew.ini is never modified. When Dolphin is next launched
 * normally (without our temp dir), it reads the original keyboard config.
 */

import { EventEmitter } from 'events';
import {
  setupDolphinForDirectConnect,
  cleanupTempUserDir,
  getTempUserDir,
} from './dolphin-config';
import { isDolphinRunning, killDolphin, launchDolphin } from './dolphin-launcher';
import { PipeController } from './pipe-controller';
import { executeFullSequence } from './blind-input';

export type DirectConnectStatus =
  | 'idle'
  | 'configuring'
  | 'launching'
  | 'connecting_pipe'
  | 'navigating_menus'
  | 'entering_code'
  | 'waiting_for_match'
  | 'connected'
  | 'error'
  | 'cancelled';

export interface DirectConnectStatusEvent {
  status: DirectConnectStatus;
  message: string;
  connectCode?: string;
}

export class DirectConnectService extends EventEmitter {
  private controller: PipeController | null = null;
  private active = false;
  private currentStatus: DirectConnectStatus = 'idle';

  isActive(): boolean { return this.active; }
  getStatus(): DirectConnectStatus { return this.currentStatus; }

  async start(connectCode: string): Promise<void> {
    if (this.active) {
      throw new Error('Direct connect already in progress');
    }

    this.active = true;
    const code = connectCode.toUpperCase().trim();

    try {
      // Step 1: Create temp dir with pipe config (real config untouched)
      this.setStatus('configuring', 'Preparing temp Dolphin config...');
      const tempDir = setupDolphinForDirectConnect();

      // Step 2: Kill existing Dolphin so it picks up the temp config
      if (await isDolphinRunning()) {
        this.setStatus('launching', 'Restarting Dolphin...');
        await killDolphin();
        await sleep(1000);
      }

      // Step 3: Launch Dolphin with the temp user dir
      this.setStatus('launching', 'Launching Dolphin with Melee...');
      launchDolphin(tempDir);

      // Step 4: Connect the pipe
      this.setStatus('connecting_pipe', 'Waiting for Dolphin to start...');
      this.controller = new PipeController();
      await this.controller.connect();

      // Immediately set neutral so Dolphin doesn't read default 0,0 as a held direction
      this.controller.releaseAll();
      this.controller.flush();

      // Step 5: Blind navigation + code entry
      this.setStatus('navigating_menus', 'Navigating menus...', code);

      await executeFullSequence(code, this.controller, (phase) => {
        switch (phase) {
          case 'boot_wait':
            this.setStatus('navigating_menus', 'Waiting for Melee to boot...', code);
            break;
          case 'mode_select':
            this.setStatus('navigating_menus', 'Selecting Direct mode...', code);
            break;
          case 'css':
            this.setStatus('navigating_menus', 'Picking character...', code);
            break;
          case 'code_entry':
            this.setStatus('entering_code', `Typing code ${code}...`, code);
            break;
          case 'submit':
            this.setStatus('entering_code', 'Submitting code...', code);
            break;
        }
      });

      // Step 6: Done — disconnect pipe, clean temp dir
      this.setStatus('waiting_for_match', `Code entered! Searching for ${code}...`, code);
      console.log('[direct-connect] Full sequence complete');
      this.cleanupPipe();
      cleanupTempUserDir();

      await sleep(2000);
      this.setStatus('connected', `Code submitted for ${code}`, code);

    } catch (err: any) {
      this.setStatus('error', `Failed: ${err.message}`);
      this.cleanupPipe();
      cleanupTempUserDir();
      throw err;
    } finally {
      this.active = false;
    }
  }

  stop(): void {
    this.cleanupPipe();
    cleanupTempUserDir();
    this.active = false;
    if (this.currentStatus !== 'error' && this.currentStatus !== 'connected'
        && this.currentStatus !== 'waiting_for_match') {
      this.setStatus('cancelled', 'Direct connect cancelled');
    }
  }

  private cleanupPipe(): void {
    if (this.controller) {
      try {
        this.controller.releaseAll();
        this.controller.flush();
        this.controller.disconnect();
      } catch {}
      this.controller = null;
    }
  }

  private setStatus(status: DirectConnectStatus, message: string, connectCode?: string): void {
    this.currentStatus = status;
    console.log(`[direct-connect] ${status}: ${message}`);
    this.emit('status', { status, message, connectCode } as DirectConnectStatusEvent);
  }
}

let directConnectService: DirectConnectService | null = null;

export function getDirectConnectService(): DirectConnectService {
  if (!directConnectService) {
    directConnectService = new DirectConnectService();
  }
  return directConnectService;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
