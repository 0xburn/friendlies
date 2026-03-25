/**
 * Menu navigation state machine — TypeScript port of libmelee's MenuHelper.
 *
 * Handles navigating Melee's menus via virtual controller on port 4:
 *   1. From MAIN_MENU → navigate to Direct Online mode
 *   2. From SLIPPI_ONLINE_CSS + NAME_ENTRY_SUBMENU → enter connect code
 *   3. From PRESS_START → press START
 *
 * The virtual keyboard layout in Melee's nametag entry has positions mapped as:
 *   A-J: target_code = 45 - (col * 5)   → A=45, B=40, C=35, D=30, E=25, F=20, G=15, H=10, I=5, J=0
 *   K-T: target_code = 46 - (col * 5)   → K=46, L=41, M=36, N=31, O=26, P=21, Q=16, R=11, S=6, T=1
 *   U-Z,space,#: target_code = 47-(col*5) → U=47, V=42, W=37, X=32, Y=27, Z=22, ' '=17, #=12
 *   0-9: target_code = 48 - (col * 5)   → 0=48, 1=43, 2=38, 3=33, 4=28, 5=23, 6=18, 7=13, 8=8, 9=3
 *
 * Navigation uses stick movements — the grid wraps in rows of 5.
 */

import { PipeController } from './pipe-controller';
import { MenuGameState, MenuState, SubMenu } from './game-state-reader';

export type NavigationPhase =
  | 'idle'
  | 'navigating_to_direct'
  | 'entering_code'
  | 'code_submitted'
  | 'done'
  | 'error';

export class MenuNavigator {
  private connectCode = '';
  private codeIndex = 0;
  private phase: NavigationPhase = 'idle';
  private inputsLive = false;
  private lastInputFrame = -1;

  getPhase(): NavigationPhase { return this.phase; }

  start(connectCode: string): void {
    this.connectCode = connectCode.toUpperCase();
    this.codeIndex = 0;
    this.phase = 'navigating_to_direct';
    this.inputsLive = false;
    this.lastInputFrame = -1;
    console.log(`[menu-navigator] Starting navigation for code: ${this.connectCode}`);
  }

  /**
   * Called each time a new menu state is received from the spectator port.
   * Decides what controller input to send based on current menu state.
   */
  step(state: MenuGameState, controller: PipeController): void {
    if (this.phase === 'done' || this.phase === 'error' || this.phase === 'idle') return;

    // Skip duplicate frames
    if (state.frame === this.lastInputFrame) return;
    this.lastInputFrame = state.frame;

    if (state.menuState === MenuState.PRESS_START) {
      this.handlePressStart(state, controller);
    } else if (state.menuState === MenuState.MAIN_MENU) {
      this.handleMainMenu(state, controller);
    } else if (state.menuState === MenuState.SLIPPI_ONLINE_CSS) {
      if (state.submenu === SubMenu.NAME_ENTRY_SUBMENU) {
        this.phase = 'entering_code';
        this.handleNameEntry(state, controller);
      } else {
        this.handleOnlineCSS(state, controller);
      }
    } else if (state.menuState === MenuState.IN_GAME) {
      // We're in game — code was accepted, matchmaking connected
      console.log('[menu-navigator] In game — direct connect succeeded');
      this.phase = 'done';
      controller.releaseAll();
      controller.flush();
    }
  }

  /**
   * Press START to get past the title screen.
   */
  private handlePressStart(state: MenuGameState, controller: PipeController): void {
    if (state.frame % 2 === 0) {
      controller.releaseAll();
      controller.flush();
      return;
    }
    controller.pressButton('START');
    controller.flush();
  }

  /**
   * Navigate from main menu into the online direct mode.
   * Ported from libmelee's choose_direct_online().
   */
  private handleMainMenu(state: MenuGameState, controller: PipeController): void {
    if (state.frame % 2 === 0) {
      controller.releaseAll();
      controller.flush();
      return;
    }

    switch (state.submenu) {
      case SubMenu.ONLINE_PLAY_SUBMENU:
        // "Direct" is menu_selection 2 or 3 depending on Slippi version
        if (state.menuSelection === 2 || state.menuSelection === 3) {
          controller.pressButton('A');
        } else {
          controller.tiltStick('MAIN', 0.5, 0);
        }
        break;

      case SubMenu.MAIN_MENU_SUBMENU:
        // First option at main menu — press A to enter it
        controller.pressButton('A');
        break;

      case SubMenu.ONEP_MODE_SUBMENU:
        if (state.menuSelection === 2) {
          controller.pressButton('A');
        } else {
          controller.tiltStick('MAIN', 0.5, 0);
        }
        break;

      case SubMenu.NAME_ENTRY_SUBMENU:
        // Already at name entry from main menu flow
        break;

      default:
        controller.pressButton('B');
        break;
    }

    controller.flush();
  }

  /**
   * From the Slippi Online CSS, we need to navigate into Direct mode.
   * This triggers the name entry submenu.
   *
   * In the online CSS, modes are selected via cursor position + A.
   * Pressing Y toggles the name tag entry for direct codes.
   */
  private handleOnlineCSS(state: MenuGameState, controller: PipeController): void {
    if (state.frame % 2 === 0) {
      controller.releaseAll();
      controller.flush();
      return;
    }

    // Press Y to open the name tag / direct code entry
    // In the Slippi CSS, pressing Y opens the connect code keyboard
    controller.pressButton('Y');
    controller.flush();
  }

  /**
   * Enter the connect code character by character using the virtual keyboard.
   * Ported from libmelee's enter_direct_code().
   */
  private handleNameEntry(state: MenuGameState, controller: PipeController): void {
    // Name entry screen is dead for the first few frames
    if (state.menuSelection !== 45) {
      this.inputsLive = true;
    }

    if (!this.inputsLive) {
      controller.tiltStick('MAIN', 1, 0.5);
      controller.flush();
      return;
    }

    // Release every other frame to avoid input doubling
    if (state.frame % 2 === 0) {
      controller.releaseAll();
      controller.flush();
      return;
    }

    // All characters entered — press START to confirm
    if (this.codeIndex >= this.connectCode.length) {
      console.log('[menu-navigator] Code fully entered, pressing START to confirm');
      controller.pressButton('START');
      controller.flush();
      this.phase = 'code_submitted';
      return;
    }

    const targetChar = this.connectCode[this.codeIndex];
    const targetCode = this.charToKeyboardCode(targetChar);

    if (targetCode === -1) {
      console.error(`[menu-navigator] Unsupported character: '${targetChar}'`);
      this.phase = 'error';
      return;
    }

    const currentPos = state.menuSelection;

    // Already on the target — press A to select
    if (currentPos === targetCode) {
      controller.pressButton('A');
      controller.flush();
      this.codeIndex++;
      console.log(`[menu-navigator] Entered '${targetChar}' (${this.codeIndex}/${this.connectCode.length})`);
      return;
    }

    // Special case: position 57 is a dead spot, move up first
    if (currentPos === 57) {
      controller.tiltStick('MAIN', 0.5, 1);
      controller.flush();
      return;
    }

    // Navigate the virtual keyboard grid
    const diff = Math.abs(targetCode - currentPos);

    if (currentPos <= targetCode - 5) {
      // Target is to the "left" in the grid (higher codes)
      if (diff < 5) {
        controller.tiltStick('MAIN', 0.5, 0); // down
      } else {
        controller.tiltStick('MAIN', 0, 0.5); // left
      }
    } else {
      // Target is to the "right" in the grid (lower codes)
      if (diff < 5) {
        controller.tiltStick('MAIN', 0.5, 1); // up
      } else {
        controller.tiltStick('MAIN', 1, 0.5); // right
      }
    }

    controller.flush();
  }

  /**
   * Map a character to its virtual keyboard grid code.
   * Layout ported from libmelee's enter_direct_code().
   */
  private charToKeyboardCode(char: string): number {
    const row1 = 'ABCDEFGHIJ';
    const row2 = 'KLMNOPQRST';
    const row3 = 'UVWXYZ #';
    const row4 = '0123456789';

    let col = row1.indexOf(char);
    if (col !== -1) return 45 - (col * 5);

    col = row2.indexOf(char);
    if (col !== -1) return 46 - (col * 5);

    col = row3.indexOf(char);
    if (col !== -1) return 47 - (col * 5);

    col = row4.indexOf(char);
    if (col !== -1) return 48 - (col * 5);

    return -1;
  }

  reset(): void {
    this.phase = 'idle';
    this.connectCode = '';
    this.codeIndex = 0;
    this.inputsLive = false;
    this.lastInputFrame = -1;
  }
}
