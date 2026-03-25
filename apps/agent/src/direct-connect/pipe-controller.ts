/**
 * Virtual controller via Dolphin named pipe.
 *
 * Sends GCN controller commands (PRESS, RELEASE, SET, FLUSH) to a named pipe
 * that Dolphin reads as a virtual controller on the configured port.
 *
 * Protocol (one command per line, terminated by \n):
 *   PRESS <button>       — e.g. PRESS A, PRESS START
 *   RELEASE <button>     — e.g. RELEASE A
 *   SET <axis> <x> [y]   — e.g. SET MAIN 0.5 1.0, SET L 0.8
 *   FLUSH                — commit queued inputs for this frame
 *
 * Based on libmelee's Controller class.
 */

import * as fs from 'fs';
import * as net from 'net';
import { getPipePath } from './dolphin-config';

export type Button =
  | 'A' | 'B' | 'X' | 'Y' | 'Z'
  | 'L' | 'R' | 'START'
  | 'D_UP' | 'D_DOWN' | 'D_LEFT' | 'D_RIGHT';

export type Axis = 'MAIN' | 'C' | 'L' | 'R';

export class PipeController {
  private pipe: fs.WriteStream | null = null;
  private windowsPipe: any = null;
  private connected = false;

  async connect(): Promise<void> {
    const pipePath = getPipePath();

    if (process.platform === 'win32') {
      await this.connectWindows(pipePath);
    } else {
      await this.connectUnix(pipePath);
    }

    this.connected = true;
    console.log(`[pipe-controller] Connected to ${pipePath}`);
  }

  private connectUnix(pipePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        reject(err);
      };
      const ok = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      try {
        // Named FIFO: use 'w' (not append). Dolphin opens the read end first.
        this.pipe = fs.createWriteStream(pipePath, {
          flags: 'w',
          encoding: 'utf8',
        });
        this.pipe.on('error', (err) => {
          console.error('[pipe-controller] Pipe error:', err);
          this.connected = false;
          fail(err instanceof Error ? err : new Error(String(err)));
        });
        this.pipe.once('open', () => ok());
        setTimeout(() => {
          if (!settled) {
            fail(new Error('Pipe open timed out — is Dolphin running and configured for pipe input?'));
          }
        }, 10_000);
      } catch (err) {
        fail(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private connectWindows(pipePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const attempts = 5;
      let attempt = 0;

      const tryConnect = () => {
        attempt++;
        const client = net.connect(pipePath, () => {
          this.windowsPipe = client;
          resolve();
        });
        client.on('error', (err) => {
          if (attempt < attempts) {
            setTimeout(tryConnect, 1000);
          } else {
            reject(new Error(`Failed to connect to Windows pipe after ${attempts} attempts: ${err.message}`));
          }
        });
      };

      tryConnect();
    });
  }

  private write(command: string): void {
    if (!this.connected) return;

    if (process.platform === 'win32' && this.windowsPipe) {
      this.windowsPipe.write(command);
    } else if (this.pipe) {
      this.pipe.write(command);
    }
  }

  pressButton(button: Button): void {
    this.write(`PRESS ${button}\n`);
  }

  releaseButton(button: Button): void {
    this.write(`RELEASE ${button}\n`);
  }

  /**
   * Tilt an analog stick. x and y range from 0.0 to 1.0, with 0.5 being neutral.
   */
  tiltStick(axis: 'MAIN' | 'C', x: number, y: number): void {
    this.write(`SET ${axis} ${x.toFixed(4)} ${y.toFixed(4)}\n`);
  }

  /**
   * Set analog shoulder pressure. amount ranges from 0.0 to 1.0.
   */
  pressShoulder(axis: 'L' | 'R', amount: number): void {
    this.write(`SET ${axis} ${amount.toFixed(4)}\n`);
  }

  /**
   * Commit all queued inputs for this frame.
   */
  flush(): void {
    this.write('FLUSH\n');
    if (process.platform !== 'win32' && this.pipe) {
      // Ensure the kernel actually sends the data
      // The pipe.write is already flushed for each write in most cases,
      // but calling cork/uncork can help batch. For simplicity, we rely on
      // the stream's default flush behavior.
    }
  }

  /**
   * Release all buttons and center all sticks. Does NOT flush.
   */
  releaseAll(): void {
    const buttons: Button[] = ['A', 'B', 'X', 'Y', 'Z', 'L', 'R', 'START', 'D_UP', 'D_DOWN', 'D_LEFT', 'D_RIGHT'];
    let cmd = '';
    for (const b of buttons) cmd += `RELEASE ${b}\n`;
    cmd += 'SET MAIN .5 .5\n';
    cmd += 'SET C .5 .5\n';
    cmd += 'SET L 0\n';
    cmd += 'SET R 0\n';
    this.write(cmd);
  }

  disconnect(): void {
    this.connected = false;
    if (this.pipe) {
      try { this.pipe.end(); } catch {}
      this.pipe = null;
    }
    if (this.windowsPipe) {
      try { this.windowsPipe.end(); } catch {}
      this.windowsPipe = null;
    }
    console.log('[pipe-controller] Disconnected');
  }

  isConnected(): boolean {
    return this.connected;
  }
}
