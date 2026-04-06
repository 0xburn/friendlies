/**
 * DirectConnectService — inject a connect code and launch Dolphin.
 *
 * Writes the target code into Slippi's direct-codes.json so it appears as
 * the first autocomplete suggestion on the in-game code entry screen, then
 * launches (or relaunches) Dolphin with Melee.
 */

import { EventEmitter } from 'events';
import { injectDirectCode } from './dolphin-config';
import { isDolphinRunning, killDolphin, launchDolphin } from './dolphin-launcher';

export type DirectConnectStatus =
  | 'idle'
  | 'configuring'
  | 'launching'
  | 'ready'
  | 'error'
  | 'cancelled';

export interface DirectConnectStatusEvent {
  status: DirectConnectStatus;
  message: string;
  connectCode?: string;
}

export class DirectConnectService extends EventEmitter {
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
      this.setStatus('configuring', `Setting ${code} as most recent direct code...`, code);
      injectDirectCode(code);

      if (await isDolphinRunning()) {
        this.setStatus('launching', 'Restarting Dolphin...', code);
        await killDolphin();
        await sleep(1000);
      }

      this.setStatus('launching', 'Launching Dolphin with Melee...', code);
      launchDolphin();

      await sleep(1500);
      this.setStatus('ready', `Dolphin launched: go to Direct Connect, ${code} is pre-filled!`, code);

    } catch (err: any) {
      this.setStatus('error', `Failed: ${err.message}`);
      throw err;
    } finally {
      this.active = false;
    }
  }

  stop(): void {
    this.active = false;
    if (this.currentStatus !== 'error' && this.currentStatus !== 'ready') {
      this.setStatus('cancelled', 'Direct connect cancelled');
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
