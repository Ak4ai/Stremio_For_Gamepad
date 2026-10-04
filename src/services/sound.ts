import { SettingsService } from './settings';

export class SoundService {
  private static audioCtx: AudioContext | null = null;
  private static tickBuffer: AudioBuffer | null = null;
  private static tabBuffer: AudioBuffer | null = null;
  private static backBuffer: AudioBuffer | null = null;
  private static keyboardBuffer: AudioBuffer | null = null;
  private static confirmBuffer: AudioBuffer | null = null;

  private static lastPlayTime = 0;
  private static MIN_INTERVAL = 38; // ms throttle for continuous holding
  private static isInitialized = false;

  private static getContext(): AudioContext | null {
    if (!this.audioCtx) {
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtxClass) {
        this.audioCtx = new AudioCtxClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  public static init() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // Lazily unlock and warm up AudioContext on first user interaction
    const unlock = () => {
      const ctx = this.getContext();
      if (ctx) {
        this.buildBuffers(ctx);
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }
      }
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('pointerdown', unlock);
    };

    window.addEventListener('keydown', unlock, { once: true, passive: true });
    window.addEventListener('pointerdown', unlock, { once: true, passive: true });
  }

  /**
   * Pre-synthesizes the full suite of tactile audio buffers:
   * 1. NavTick: 32ms warm navigation tick (320Hz -> 190Hz)
   * 2. TabSwitch: 38ms smooth card slide (240Hz -> 400Hz)
   * 3. Back: 36ms gentle descending return (270Hz -> 135Hz)
   * 4. KeyboardNav: 18ms snappy micro-haptic (380Hz -> 266Hz)
   * 5. Confirm: 38ms affirmative pop (440Hz -> 286Hz)
   */
  private static buildBuffers(ctx: AudioContext) {
    if (this.tickBuffer && this.tabBuffer && this.backBuffer && this.keyboardBuffer && this.confirmBuffer) {
      return;
    }

    const sampleRate = ctx.sampleRate || 48000;

    // 1. Navigation Tactile Tick (menus, cards, lists)
    const tickDuration = 0.032;
    const tickSamples = Math.floor(sampleRate * tickDuration);
    const tBuffer = ctx.createBuffer(1, tickSamples, sampleRate);
    const tData = tBuffer.getChannelData(0);
    for (let i = 0; i < tickSamples; i++) {
      const t = i / sampleRate;
      const progress = t / tickDuration;
      const attack = progress < 0.06 ? Math.sin((progress / 0.06) * (Math.PI / 2)) : 1.0;
      const freq = 320.0 * (1.0 - progress * 0.40);
      const decay = Math.exp(-progress * 5.0) * attack;
      tData[i] = Math.sin(2.0 * Math.PI * freq * t) * decay * 0.70;
    }
    this.tickBuffer = tBuffer;

    // 2. Tab Switch (LB / RB, header tabs, categories)
    const tabDuration = 0.038;
    const tabSamples = Math.floor(sampleRate * tabDuration);
    const tabBuf = ctx.createBuffer(1, tabSamples, sampleRate);
    const tabData = tabBuf.getChannelData(0);
    for (let i = 0; i < tabSamples; i++) {
      const t = i / sampleRate;
      const progress = t / tabDuration;
      const attack = progress < 0.08 ? Math.sin((progress / 0.08) * (Math.PI / 2)) : 1.0;
      const freq = 240.0 + progress * 160.0; // gentle upward glide
      const decay = Math.exp(-progress * 4.2) * attack;
      tabData[i] = Math.sin(2.0 * Math.PI * freq * t) * decay * 0.65;
    }
    this.tabBuffer = tabBuf;

    // 3. Back / Return (closing modals, source selection back to catalog, B button)
    const backDuration = 0.036;
    const backSamples = Math.floor(sampleRate * backDuration);
    const bBuf = ctx.createBuffer(1, backSamples, sampleRate);
    const bData = bBuf.getChannelData(0);
    for (let i = 0; i < backSamples; i++) {
      const t = i / sampleRate;
      const progress = t / backDuration;
      const attack = progress < 0.06 ? Math.sin((progress / 0.06) * (Math.PI / 2)) : 1.0;
      const freq = 270.0 * (1.0 - progress * 0.50); // downward pitch
      const decay = Math.exp(-progress * 4.8) * attack;
      bData[i] = Math.sin(2.0 * Math.PI * freq * t) * decay * 0.70;
    }
    this.backBuffer = bBuf;

    // 4. Virtual Keyboard Navigation & Typing (ultra-fast, tactile micro-tap)
    const keyDuration = 0.018;
    const keySamples = Math.floor(sampleRate * keyDuration);
    const keyBuf = ctx.createBuffer(1, keySamples, sampleRate);
    const keyData = keyBuf.getChannelData(0);
    for (let i = 0; i < keySamples; i++) {
      const t = i / sampleRate;
      const progress = t / keyDuration;
      const attack = progress < 0.08 ? Math.sin((progress / 0.08) * (Math.PI / 2)) : 1.0;
      const freq = 380.0 * (1.0 - progress * 0.30);
      const decay = Math.exp(-progress * 7.5) * attack;
      keyData[i] = Math.sin(2.0 * Math.PI * freq * t) * decay * 0.60;
    }
    this.keyboardBuffer = keyBuf;

    // 5. Action Confirm (A button, affirmative select)
    const confirmDuration = 0.038;
    const confirmSamples = Math.floor(sampleRate * confirmDuration);
    const cBuffer = ctx.createBuffer(1, confirmSamples, sampleRate);
    const cData = cBuffer.getChannelData(0);
    for (let i = 0; i < confirmSamples; i++) {
      const t = i / sampleRate;
      const progress = t / confirmDuration;
      const attack = progress < 0.05 ? Math.sin((progress / 0.05) * (Math.PI / 2)) : 1.0;
      const freq = 440.0 * (1.0 - progress * 0.35);
      const decay = Math.exp(-progress * 4.8) * attack;
      cData[i] = Math.sin(2.0 * Math.PI * freq * t) * decay * 0.55;
    }
    this.confirmBuffer = cBuffer;
  }

  private static playBuffer(buffer: AudioBuffer | null, volume = 0.8) {
    if (!SettingsService.isSoundFeedbackEnabled()) return;

    try {
      const ctx = this.getContext();
      if (!ctx) return;

      if (!buffer) {
        this.buildBuffers(ctx);
      }
      if (!buffer) return;

      const source = ctx.createBufferSource();
      source.buffer = buffer;

      const gain = ctx.createGain();
      gain.gain.value = volume;

      source.connect(gain);
      gain.connect(ctx.destination);
      source.start();
    } catch {
      // Audio playback suppressed by host
    }
  }

  /**
   * Plays the standard tactile tick feedback (card/item navigation)
   */
  public static playNavTick() {
    const now = performance.now();
    if (now - this.lastPlayTime < this.MIN_INTERVAL) return;
    this.lastPlayTime = now;

    if (!this.tickBuffer) {
      const ctx = this.getContext();
      if (ctx) this.buildBuffers(ctx);
    }
    this.playBuffer(this.tickBuffer, 0.85);
  }

  /**
   * Plays the tab/category switch sound (LB / RB, Top Tabs, Seasons)
   */
  public static playTabSwitch() {
    if (!this.tabBuffer) {
      const ctx = this.getContext();
      if (ctx) this.buildBuffers(ctx);
    }
    this.playBuffer(this.tabBuffer, 0.80);
  }

  /**
   * Plays the retreat/back/close sound (B button, Escape, Return to Catalog)
   */
  public static playBack() {
    if (!this.backBuffer) {
      const ctx = this.getContext();
      if (ctx) this.buildBuffers(ctx);
    }
    this.playBuffer(this.backBuffer, 0.85);
  }

  /**
   * Plays the micro-tactile key tap sound (Virtual Keyboard Navigation & Typing)
   */
  public static playKeyboardNav() {
    if (!this.keyboardBuffer) {
      const ctx = this.getContext();
      if (ctx) this.buildBuffers(ctx);
    }
    this.playBuffer(this.keyboardBuffer, 0.70);
  }

  /**
   * Plays confirmation pop on action selection
   */
  public static playActionConfirm() {
    if (!this.confirmBuffer) {
      const ctx = this.getContext();
      if (ctx) this.buildBuffers(ctx);
    }
    this.playBuffer(this.confirmBuffer, 0.70);
  }
}
