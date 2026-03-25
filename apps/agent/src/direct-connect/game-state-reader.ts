/**
 * Reads game/menu state from Dolphin's spectator port via enet.
 *
 * Uses @slippi/slippi-js DolphinConnection for the enet transport layer.
 * DolphinConnection emits ConnectionEvent.MESSAGE for ALL enet messages,
 * but only handles game_event internally. We intercept menu_event messages
 * ourselves and parse the binary payload using the same layout as libmelee.
 *
 * Menu event binary layout (from libmelee's __handle_slippstream_menu_event):
 *   0x01-0x02: scene (uint16 BE) — determines MenuState
 *   0x03-0x06: player 1 cursor X (float32 BE)
 *   0x07-0x0A: player 1 cursor Y (float32 BE)
 *   ...cursors for players 2-4...
 *   0x23:      ready_to_start (uint8)
 *   0x24:      stage (uint8)
 *   0x25-0x28: controller_status for players 1-4 (uint8 each)
 *   0x29-0x2C: character for players 1-4 (uint8 each)
 *   0x2D-0x30: coin_down for players 1-4 (uint8 each, == 2 means down)
 *   0x31-0x38: stage select cursor X/Y (float32 BE each)
 *   0x39-0x3C: frame (int32 BE)
 *   0x3D:      submenu (uint8)
 *   0x3E:      menu_selection (uint8) — virtual keyboard position
 *   0x3F:      online_costume (uint8)
 *   0x40:      nametag_mode (uint8) — 0x05 = name entry, 0x00 = normal CSS
 */

import { EventEmitter } from 'events';

export enum MenuState {
  PRESS_START = 0,
  CHARACTER_SELECT = 1,
  STAGE_SELECT = 2,
  IN_GAME = 3,
  POSTGAME_SCORES = 4,
  MAIN_MENU = 5,
  SLIPPI_ONLINE_CSS = 6,
  UNKNOWN = 0xff,
}

export enum SubMenu {
  MAIN_MENU_SUBMENU = 0,
  ONEP_MODE_SUBMENU = 1,
  VS_MODE_SUBMENU = 2,
  ONLINE_PLAY_SUBMENU = 8,
  NAME_ENTRY_SUBMENU = 18,
  ONLINE_CSS = 0xfe,
  UNKNOWN_SUBMENU = 0xff,
}

export interface MenuGameState {
  menuState: MenuState;
  submenu: SubMenu;
  menuSelection: number;
  frame: number;
  readyToStart: number;
}

type GameStateReaderEvents = {
  menuState: [MenuGameState];
  connected: [];
  disconnected: [];
  error: [Error];
};

export class GameStateReader extends EventEmitter {
  private dolphinConnection: any = null;
  private connectionModule: any = null;
  private currentState: MenuGameState = {
    menuState: MenuState.UNKNOWN,
    submenu: SubMenu.UNKNOWN_SUBMENU,
    menuSelection: 0,
    frame: 0,
    readyToStart: 0,
  };

  getCurrentState(): MenuGameState {
    return { ...this.currentState };
  }

  async connect(ip = '127.0.0.1', port = 51441): Promise<void> {
    // Dynamic import to handle the enet native dependency gracefully
    const slippiNode = await import('@slippi/slippi-js/node');
    this.connectionModule = slippiNode;

    const { DolphinConnection, ConnectionEvent, ConnectionStatus } = slippiNode;
    const conn = new DolphinConnection();
    this.dolphinConnection = conn;

    conn.on(ConnectionEvent.HANDSHAKE, () => {
      console.log('[game-state-reader] Handshake complete');
      this.emit('connected');
    });

    conn.on(ConnectionEvent.STATUS_CHANGE, (status: any) => {
      if (status === ConnectionStatus.DISCONNECTED) {
        console.log('[game-state-reader] Disconnected');
        this.emit('disconnected');
      }
    });

    // Intercept ALL enet messages, including menu_event which slippi-js ignores
    let messageCount = 0;
    const seenTypes = new Set<string>();
    conn.on(ConnectionEvent.MESSAGE, (message: any) => {
      messageCount++;
      const msgType = message?.type ?? 'unknown';
      if (!seenTypes.has(msgType)) {
        seenTypes.add(msgType);
        console.log(`[game-state-reader] New message type: "${msgType}" (message #${messageCount})`);
      }
      if (messageCount <= 5 || messageCount % 100 === 0) {
        console.log(`[game-state-reader] Message #${messageCount}: type="${msgType}"`);
      }

      if (msgType === 'menu_event' && message.payload) {
        try {
          const data = Buffer.from(message.payload, 'base64');
          this.handleMenuEvent(data);
        } catch (err) {
          console.error('[game-state-reader] Failed to parse menu event:', err);
        }
      }
    });

    conn.on(ConnectionEvent.ERROR, (err: any) => {
      console.error('[game-state-reader] Connection error:', err);
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    });

    console.log(`[game-state-reader] Connecting to ${ip}:${port}...`);
    await conn.connect(ip, port);
  }

  private handleMenuEvent(data: Buffer): void {
    if (data.length < 0x41) return;

    // Scene → MenuState
    const scene = data.readUInt16BE(0x01);
    let menuState: MenuState;

    switch (scene) {
      case 0x0000: menuState = MenuState.PRESS_START; break;
      case 0x0001: menuState = MenuState.MAIN_MENU; break;
      case 0x0002: menuState = MenuState.CHARACTER_SELECT; break;
      case 0x0008: menuState = MenuState.SLIPPI_ONLINE_CSS; break;
      case 0x0102:
      case 0x0108: menuState = MenuState.STAGE_SELECT; break;
      case 0x0202: menuState = MenuState.IN_GAME; break;
      case 0x0402: menuState = MenuState.POSTGAME_SCORES; break;
      default: menuState = MenuState.UNKNOWN; break;
    }

    // Frame
    const frame = data.readInt32BE(0x39);

    // Submenu
    let submenu: SubMenu;
    const rawSubmenu = data.readUInt8(0x3D);
    if (Object.values(SubMenu).includes(rawSubmenu)) {
      submenu = rawSubmenu as SubMenu;
    } else {
      submenu = SubMenu.UNKNOWN_SUBMENU;
    }

    // Menu selection (virtual keyboard position)
    const menuSelection = data.readUInt8(0x3E);

    // Override submenu based on nametag mode flag (Slippi Online CSS specific)
    if (menuState === MenuState.SLIPPI_ONLINE_CSS) {
      const nametagMode = data.readUInt8(0x40);
      if (nametagMode === 0x05) {
        submenu = SubMenu.NAME_ENTRY_SUBMENU;
      } else if (nametagMode === 0x00) {
        submenu = SubMenu.ONLINE_CSS;
      }
    }

    const readyToStart = data.readUInt8(0x23);

    this.currentState = { menuState, submenu, menuSelection, frame, readyToStart };
    this.emit('menuState', this.currentState);
  }

  disconnect(): void {
    if (this.dolphinConnection) {
      try { this.dolphinConnection.disconnect(); } catch {}
      this.dolphinConnection = null;
    }
    this.removeAllListeners();
    console.log('[game-state-reader] Cleaned up');
  }
}
