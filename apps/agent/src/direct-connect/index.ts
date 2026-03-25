/**
 * DirectConnectService — full automated direct connect.
 *
 * One button click does everything:
 *   1. Configure Dolphin INIs + FIFO (if needed)
 *   2. Kill existing Dolphin (to ensure fresh config)
 *   3. Launch Dolphin with Melee
 *   4. Connect virtual controller pipe
 *   5. Navigate menus blindly: mode select → Direct → CSS → code entry
 *   6. Type the connect code and submit
 */

import { EventEmitter } from 'events';
import {
  backupControllerConfig,
  setupDolphinForDirectConnect,
  isDolphinConfigured,
  ensurePipeFifo,
  stabilizeGcpadRestore,
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
      // Always snapshot restore payload first. If we skip this when already on pipe,
      // savedGCPadContents stays empty and "restore" is a no-op or wrong.
      backupControllerConfig();

      // Step 1: Ensure Dolphin is configured for pipe input
      const alreadyConfigured = isDolphinConfigured();
      if (!alreadyConfigured) {
        this.setStatus('configuring', 'Configuring Dolphin for virtual controller...');
        setupDolphinForDirectConnect();
      } else {
        ensurePipeFifo();
      }

      // Step 2: Kill existing Dolphin so it picks up fresh config
      if (await isDolphinRunning()) {
        this.setStatus('launching', 'Restarting Dolphin...');
        await killDolphin();
        // Brief pause after kill before relaunch
        await sleep(1000);
      }

      // Step 3: Launch Dolphin with Melee
      this.setStatus('launching', 'Launching Dolphin with Melee...');
      launchDolphin();

      // Step 4: Connect the pipe (blocks until Dolphin opens the FIFO)
      this.setStatus('connecting_pipe', 'Waiting for Dolphin to start...');
      this.controller = new PipeController();
      await this.controller.connect();

      // Step 5: Execute the full blind navigation + code entry
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

      // Step 6: Done — code submitted, restore user's controller config
      this.setStatus('waiting_for_match', `Code entered! Searching for ${code}...`, code);
      console.log('[direct-connect] Full sequence complete, restoring controller config');

      this.cleanupPipe();
      await stabilizeGcpadRestore();

      await sleep(2000);
      this.setStatus('connected', `Code submitted for ${code}`, code);

    } catch (err: any) {
      this.setStatus('error', `Failed: ${err.message}`);
      this.cleanupPipe();
      await stabilizeGcpadRestore();
      throw err;
    } finally {
      this.active = false;
    }
  }

  stop(): void {
    this.cleanupPipe();
    void stabilizeGcpadRestore();
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
