export type GamepadAction =
  | 'TOUCHPAD_CLICK'
  | 'NAV_UP'
  | 'NAV_DOWN'
  | 'NAV_LEFT'
  | 'NAV_RIGHT'
  | 'ACTION_A'
  | 'ACTION_B'
  | 'ACTION_X'
  | 'ACTION_Y'
  | 'TRIGGER_LB'
  | 'TRIGGER_RB'
  | 'TRIGGER_LT'
  | 'TRIGGER_RT'
  | 'BUTTON_VIEW'
  | 'BUTTON_MENU';

export type ControllerType = 'xbox' | 'playstation' | 'nintendo' | 'steam-deck' | 'keyboard';

export type GamepadListener = (action: GamepadAction) => void;
export type ControllerChangeListener = (type: ControllerType, name: string) => void;

import { SoundService } from './sound';
import { pulseNativeDualSense } from './dualsenseTouchpad';

export class GamepadManager {
  private static listeners: Set<GamepadListener> = new Set();
  private static typeListeners: Set<ControllerChangeListener> = new Set();
  private static animFrameId: number | null = null;
  private static isRunning = false;

  // Button state tracking for edge detection
  private static prevButtons: boolean[] = [];

  // Repeat rate timers for navigation
  private static navHoldTimers: { [key: string]: { start: number; lastFired: number } } = {};
  private static INITIAL_DELAY = 260; // ms
  private static REPEAT_INTERVAL = 110; // ms
  private static DEADZONE = 0.35;

  public static isConnected = false;
  public static controllerName = '';
  public static activeControllerType: ControllerType = 'keyboard';
  public static forcedType: 'auto' | ControllerType = 'auto';
  private static hidGamepad: Gamepad | null = null;
  private static hidGamepadUpdated = 0;
  private static hidAuthoritative = false;
  private static lastControllerSeen = 0;
  private static polledController = '';

  public static setHidGamepad(gamepad: Gamepad | null, authoritative = false) {
    this.hidGamepad = gamepad;
    this.hidAuthoritative = authoritative;
    this.hidGamepadUpdated = Date.now();
  }

  private static getConnectedGamepads(): Gamepad[] {
    const gamepads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) as Gamepad[] : [];
    if (this.hidGamepad && Date.now() - this.hidGamepadUpdated < 1500) {
      const physical = gamepads.findIndex((pad) => /dualsense|0ce6|0df2/i.test(pad.id));
      if (physical >= 0) {
        // Keep native buttons/axes; some browsers omit the extra touchpad button.
        const original = gamepads[physical];
        // Bluetooth mode changes can leave the browser's snapshot frozen; use the newer report.
        const useHid = this.hidAuthoritative || (Number.isFinite(original.timestamp) && original.timestamp < this.hidGamepad.timestamp);
        const input = useHid ? this.hidGamepad : original;
        const buttons = Array.from(input.buttons);
        const hidTouch = this.hidGamepad.buttons[17];
        if (hidTouch) {
          buttons[17] = buttons[17]?.pressed ? buttons[17] : hidTouch;
          gamepads[physical] = {
            id: original.id, index: original.index, connected: original.connected,
            mapping: original.mapping, timestamp: input.timestamp, axes: input.axes,
            buttons, vibrationActuator: original.vibrationActuator,
          } as Gamepad;
        }
      } else gamepads.push(this.hidGamepad);
    }
    return gamepads;
  }

  /**
   * Start the gamepad polling loop and keyboard listeners
   */
  public static init() {
    if (this.isRunning) return;
    this.isRunning = true;

    // Initialize sound feedback engine
    SoundService.init();

    // Load forced preference if saved (default to 'auto' for dynamic detection)
    const savedType = localStorage.getItem('stremio_deck_controller_forced') as any;
    if (savedType === 'playstation' || savedType === 'nintendo' || savedType === 'xbox' || savedType === 'steam-deck' || savedType === 'keyboard') {
      this.forcedType = savedType;
      this.activeControllerType = savedType;
    } else {
      this.forcedType = 'auto';
    }

    window.addEventListener('gamepadconnected', (e: GamepadEvent) => {
      this.isConnected = true;
      this.controllerName = e.gamepad.id || 'Controle';
      const detected = this.isPlayStationGamepad(e.gamepad) ? 'playstation' : this.detectControllerType(e.gamepad.id);
      if (this.forcedType === 'auto') {
        this.activeControllerType = detected;
      }
      this.emitTypeChange();
      console.log('Gamepad conectado:', e.gamepad.id, 'Tipo:', this.activeControllerType);
      this.pulseHaptic(60, 0.4, 0.4);
    });

    window.addEventListener('gamepaddisconnected', () => {
      // A native disconnect can mean a Bluetooth report-mode change while HID is still alive.
      this.prevButtons = [];
      this.navHoldTimers = {};
      const active = this.getActiveGamepad();
      if (active) {
        this.isConnected = true;
        this.controllerName = active.id;
        if (this.forcedType === 'auto') this.activeControllerType = this.detectControllerType(active.id);
        this.emitTypeChange();
      }
    });

    // Keyboard fallback listener
    window.addEventListener('keydown', (e) => this.handleKeyboard(e));

    this.startLoop();
  }

  public static subscribe(listener: GamepadListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public static subscribeControllerType(listener: ControllerChangeListener): () => void {
    this.typeListeners.add(listener);
    // Emit immediate current state
    listener(this.activeControllerType, this.controllerName);
    return () => {
      this.typeListeners.delete(listener);
    };
  }

  public static setForcedType(type: 'auto' | ControllerType) {
    this.forcedType = type;
    localStorage.setItem('stremio_deck_controller_forced', type);
    if (type !== 'auto') {
      this.activeControllerType = type;
    } else {
      const activeGp = this.getActiveGamepad();
      if (activeGp && this.isPlayStationGamepad(activeGp)) {
        this.activeControllerType = 'playstation';
      } else {
        this.updateDetectedType(this.controllerName);
      }
    }
    this.emitTypeChange();
  }

  private static updateDetectedType(id: string) {
    if (this.forcedType !== 'auto') {
      this.activeControllerType = this.forcedType;
    } else {
      this.activeControllerType = this.detectControllerType(id);
    }
    this.emitTypeChange();
  }

  private static emitTypeChange() {
    for (const listener of this.typeListeners) {
      try { listener(this.activeControllerType, this.controllerName); }
      catch (error) { console.error('Falha ao atualizar o controle:', error); }
    }
  }

  public static markKeyboardActive() {
    if (this.forcedType === 'auto' && this.activeControllerType !== 'keyboard') {
      this.activeControllerType = 'keyboard';
      this.emitTypeChange();
    }
  }

  public static markGamepadActive(type: ControllerType) {
    if (this.forcedType === 'auto' && this.activeControllerType !== type) {
      this.activeControllerType = type;
      this.emitTypeChange();
    }
  }

  /**
   * Check if a Gamepad object is a PlayStation controller via ID or vendorId/productId
   */
  public static isPlayStationGamepad(gp: Gamepad): boolean {
    if (!gp) return false;
    const anyGp = gp as any;
    if (anyGp.vendorId === '054c' || anyGp.vendorId === 0x054c || anyGp.vendorId === 1356) return true;
    if (anyGp.productId === '0ce6' || anyGp.productId === 0x0ce6 || anyGp.productId === 3302) return true;
    return this.detectControllerType(gp.id) === 'playstation';
  }

  /**
   * Intelligently parses hardware VendorID / ProductID and model string
   */
  public static detectControllerType(id: string): ControllerType {
    if (!id) return 'keyboard';
    const lower = id.toLowerCase();

    // Sony PlayStation (DualSense VID 054c PID 0ce6/0df2, DualShock 4 PID 05c4/09cc)
    if (
      lower.includes('054c') ||
      lower.includes('0ce6') ||
      lower.includes('0df2') ||
      lower.includes('05c4') ||
      lower.includes('09cc') ||
      lower.includes('1356') ||
      lower.includes('dualsense') ||
      lower.includes('dual sense') ||
      lower.includes('dualshock') ||
      lower.includes('dual shock') ||
      lower.includes('playstation') ||
      lower.includes('ps5') ||
      lower.includes('ps4') ||
      lower.includes('ps3') ||
      lower.includes('sony') ||
      lower.includes('wireless controller') ||
      lower.includes('controle sem fio') ||
      lower.includes('controlador de jogo') ||
      lower.includes('compativel') ||
      lower.includes('compatível') ||
      lower.includes('hid-compliant') ||
      (lower.includes('controlador') && lower.includes('hid')) ||
      (lower.includes('controle') && lower.includes('hid'))
    ) {
      return 'playstation';
    }

    // Nintendo (Switch Pro, Joy-Con VID 057e)
    if (
      lower.includes('057e') ||
      lower.includes('2009') ||
      lower.includes('nintendo') ||
      lower.includes('switch') ||
      lower.includes('joy-con') ||
      lower.includes('pro controller')
    ) {
      return 'nintendo';
    }

    // Valve Steam Deck (VID 28de, "Steam Deck", "Valve", "Neptune")
    if (
      lower.includes('28de') ||
      lower.includes('steam deck') ||
      lower.includes('steamdeck') ||
      lower.includes('valve') ||
      lower.includes('neptune')
    ) {
      return 'steam-deck';
    }

    // Default to Xbox for Windows XInput (VID 045e or generic)
    return 'xbox';
  }

  private static emit(action: GamepadAction) {
    try {
    if (
      action === 'NAV_UP' ||
      action === 'NAV_DOWN' ||
      action === 'NAV_LEFT' ||
      action === 'NAV_RIGHT'
    ) {
      SoundService.playNavTick();
    } else if (action === 'ACTION_A') {
      SoundService.playActionConfirm();
    } else if (action === 'ACTION_B') {
      SoundService.playBack();
    } else if (action === 'TRIGGER_LB' || action === 'TRIGGER_RB') {
      SoundService.playTabSwitch();
    }

    } catch (error) { console.debug('Feedback do controle indisponível:', error); }
    for (const listener of this.listeners) {
      try { listener(action); }
      catch (error) { console.error('Falha ao processar comando do controle:', action, error); }
    }
  }

  /**
   * Return the primary active gamepad (prioritizing PlayStation DualSense or actively manipulated pad)
   */
  public static getActiveGamepad(): Gamepad | null {
    const rawGamepads = this.getConnectedGamepads();
    if (rawGamepads.length === 0) return null;
    const psGamepad = rawGamepads.find((g) => this.detectControllerType(g.id) === 'playstation');
    const active = rawGamepads.find(
      (g) =>
        g.buttons.some((b) => b.pressed || b.value > 0.2) ||
        Math.abs(g.axes[0] || 0) > this.DEADZONE ||
        Math.abs(g.axes[1] || 0) > this.DEADZONE ||
        Math.abs(g.axes[2] || 0) > this.DEADZONE ||
        Math.abs(g.axes[3] || 0) > this.DEADZONE
    );
    return active || psGamepad || rawGamepads[0];
  }

  /**
   * Rumble feedback
   */
  public static pulseHaptic(duration = 40, weak = 0.3, strong = 0.2) {
    try {
      const gp = this.getActiveGamepad();
      if (gp && this.isPlayStationGamepad(gp) && typeof pulseNativeDualSense === 'function' && pulseNativeDualSense(duration, weak, strong)) return;
      if (gp && 'vibrationActuator' in gp && (gp as any).vibrationActuator) {
        const effect = (gp as any).vibrationActuator.playEffect('dual-rumble', {
          startDelay: 0,
          duration,
          weakMagnitude: weak,
          strongMagnitude: strong,
        });
        // Bluetooth/browser support can fail asynchronously; input must keep running.
        effect?.catch?.(() => {});
      }
    } catch {
      // Haptics not supported
    }
  }

  private static startLoop() {
    const loop = (timestamp: number) => {
      try { this.poll(timestamp); }
      catch (error) { console.error('Falha na leitura do controle:', error); }
      finally { if (this.isRunning) this.animFrameId = requestAnimationFrame(loop); }
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  public static stop() {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.isRunning = false;
  }

  private static poll(now: number) {
    const rawGamepads = this.getConnectedGamepads();

    if (rawGamepads.length === 0) {
      this.prevButtons = [];
      this.navHoldTimers = {};
      this.polledController = '';
      if (this.isConnected && Date.now() - this.lastControllerSeen > 2000) {
        this.isConnected = false;
        this.controllerName = '';
        if (this.forcedType === 'auto') this.activeControllerType = 'keyboard';
        this.emitTypeChange();
      }
      return;
    }

    // Check if ANY connected gamepad is PlayStation (DualSense, DualShock, etc.)
    const psGamepad = rawGamepads.find((g) => this.isPlayStationGamepad(g));

    // Find the actively manipulated gamepad, or default to psGamepad or first connected
    const activeGp =
      rawGamepads.find(
        (g) =>
          g.buttons.some((b) => b.pressed || b.value > 0.25) ||
          Math.abs(g.axes[0] || 0) > this.DEADZONE ||
          Math.abs(g.axes[1] || 0) > this.DEADZONE
      ) ||
      psGamepad ||
      rawGamepads[0];

    const gp = activeGp;
    this.lastControllerSeen = Date.now();
    const identity = `${gp.id}:${gp.index}`;
    if (identity !== this.polledController) {
      this.prevButtons = [];
      this.navHoldTimers = {};
      this.polledController = identity;
    }

    const detectedType = this.detectControllerType(gp.id);
    const isInUse = gp.buttons.some((button) => button.pressed || button.value > 0.25) ||
      gp.axes.some((axis) => Math.abs(axis) > this.DEADZONE);

    if (
      !this.isConnected ||
      this.controllerName !== gp.id ||
      (isInUse && this.forcedType === 'auto' && this.activeControllerType !== detectedType)
    ) {
      this.isConnected = true;
      this.controllerName = gp.id || 'Controle';
      if (this.forcedType === 'auto' && isInUse) {
        this.activeControllerType = detectedType;
        this.emitTypeChange();
      } else if (this.forcedType !== 'auto') {
        this.activeControllerType = this.forcedType;
        this.emitTypeChange();
      }
    }

    const axisX = gp.axes[0] || 0;
    const axisY = gp.axes[1] || 0;

    const rawUp = (gp.buttons[12] && gp.buttons[12].pressed) || axisY < -this.DEADZONE;
    const rawDown = (gp.buttons[13] && gp.buttons[13].pressed) || axisY > this.DEADZONE;
    const rawLeft = (gp.buttons[14] && gp.buttons[14].pressed) || axisX < -this.DEADZONE;
    const rawRight = (gp.buttons[15] && gp.buttons[15].pressed) || axisX > this.DEADZONE;

    this.handleDirectionRepeat('NAV_UP', rawUp, now);
    this.handleDirectionRepeat('NAV_DOWN', rawDown, now);
    this.handleDirectionRepeat('NAV_LEFT', rawLeft, now);
    this.handleDirectionRepeat('NAV_RIGHT', rawRight, now);

    // Action button checks (edge triggered)
    this.checkButton(gp, 0, 'ACTION_A');
    this.checkButton(gp, 1, 'ACTION_B');
    this.checkButton(gp, 2, 'ACTION_X');
    this.checkButton(gp, 3, 'ACTION_Y');
    this.checkButton(gp, 4, 'TRIGGER_LB');
    this.checkButton(gp, 5, 'TRIGGER_RB');
    this.checkButton(gp, 6, 'TRIGGER_LT');
    this.checkButton(gp, 7, 'TRIGGER_RT');
    this.checkButton(gp, 8, 'BUTTON_VIEW');
    if (this.isPlayStationGamepad(gp)) this.checkButton(gp, 17, 'TOUCHPAD_CLICK');
    this.checkButton(gp, 9, 'BUTTON_MENU');
  }

  private static checkButton(gp: Gamepad, index: number, action: GamepadAction) {
    const btn = gp.buttons[index];
    if (!btn) return;

    // For analog triggers (LT / RT, indices 6 and 7), require an intentional deep pull (> 0.65)
    // rather than the browser's default hair-trigger pressed state (~0.05) to eliminate
    // accidental resting-finger triggers while pressing shoulder bumpers (L1 / R1).
    const isPressed = (index === 6 || index === 7)
      ? (btn.value > 0.65)
      : Boolean(btn.pressed);

    const wasPressed = this.prevButtons[index] || false;

    if (isPressed && !wasPressed) {
      this.emit(action);
      this.pulseHaptic(30, 0.2, 0.2);
    }
    this.prevButtons[index] = isPressed;
  }

  private static handleDirectionRepeat(action: GamepadAction, isPressed: boolean, now: number) {
    if (!isPressed) {
      delete this.navHoldTimers[action];
      return;
    }

    if (!this.navHoldTimers[action]) {
      this.navHoldTimers[action] = { start: now, lastFired: now };
      this.emit(action);
      this.pulseHaptic(20, 0.15, 0);
    } else {
      const { start, lastFired } = this.navHoldTimers[action];
      if (now - start > this.INITIAL_DELAY && now - lastFired > this.REPEAT_INTERVAL) {
        this.navHoldTimers[action].lastFired = now;
        this.emit(action);
        this.pulseHaptic(15, 0.1, 0);
      }
    }
  }

  private static handleKeyboard(e: KeyboardEvent) {
    if (e.isTrusted !== false) this.markKeyboardActive();
    if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.altKey || e.metaKey) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.emit('ACTION_B');
      }
      return;
    }
    // Let focused buttons use their own click handler instead of confirming the selected card.
    if (target?.closest?.('button, a[href]') && (e.key === 'Enter' || e.key === ' ')) return;
    if (e.repeat && !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'W', 'a', 'A', 's', 'S', 'd', 'D'].includes(e.key)) return;

    switch (e.key) {
      case 'ArrowUp':
      case 'w':
      case 'W':
        e.preventDefault();
        this.emit('NAV_UP');
        break;
      case 'ArrowDown':
      case 's':
      case 'S':
        e.preventDefault();
        this.emit('NAV_DOWN');
        break;
      case 'ArrowLeft':
      case 'a':
      case 'A':
        e.preventDefault();
        this.emit('NAV_LEFT');
        break;
      case 'ArrowRight':
      case 'd':
      case 'D':
        e.preventDefault();
        this.emit('NAV_RIGHT');
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        this.emit('ACTION_A');
        break;
      case 'Escape':
      case 'Backspace':
        e.preventDefault();
        this.emit('ACTION_B');
        break;
      case 'x':
      case 'X':
        this.emit('ACTION_X');
        break;
      case 'y':
      case 'Y':
        this.emit('ACTION_Y');
        break;
      case 'q':
      case 'Q':
      case 'PageUp':
        e.preventDefault();
        this.emit('TRIGGER_LB');
        break;
      case 'e':
      case 'E':
      case 'PageDown':
        e.preventDefault();
        this.emit('TRIGGER_RB');
        break;
      case '1':
      case '[':
      case 'z':
      case 'Z':
        this.emit('TRIGGER_LT');
        break;
      case '2':
      case ']':
      case 'c':
      case 'C':
        this.emit('TRIGGER_RT');
        break;
      case 'Tab':
        // Tab remains native focus navigation; F opens the contextual secondary action.
        return;
      case 'f':
      case 'F':
        e.preventDefault();
        this.emit('BUTTON_VIEW');
        break;
      case 'm':
      case 'M':
        this.emit('BUTTON_MENU');
        break;
    }
  }
}
