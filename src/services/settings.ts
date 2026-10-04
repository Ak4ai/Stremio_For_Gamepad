export interface AppSettings {
  fullscreenDefault: boolean;
  filterPtBrDefault: boolean;
  soundFeedbackEnabled: boolean;
  subtitleBackground: boolean;
  subtitleSize: number;
}

const SETTINGS_KEY = 'stremio_gamepad_settings';

export class SettingsService {
  private static settings: AppSettings = {
    fullscreenDefault: true,
    filterPtBrDefault: false,
    soundFeedbackEnabled: true,
    subtitleBackground: true,
    subtitleSize: 100,
  };

  private static listeners: Set<(settings: AppSettings) => void> = new Set();

  public static init() {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        this.settings = {
          ...this.settings,
          ...parsed,
        };
      }
    } catch (e) {
      console.warn('Erro ao carregar configurações locais:', e);
    }
  }

  public static getSettings(): AppSettings {
    return { ...this.settings };
  }

  public static getSubtitleAppearance() {
    const size = Number(this.settings.subtitleSize);
    return { background: this.settings.subtitleBackground !== false,
      size: Number.isFinite(size) ? Math.max(70, Math.min(180, size)) : 100 };
  }

  public static setSubtitleAppearance(background: boolean, size: number) {
    this.settings.subtitleBackground = background;
    this.settings.subtitleSize = Number.isFinite(size) ? Math.max(70, Math.min(180, size)) : 100;
    this.save();
  }

  public static isFullscreenDefault(): boolean {
    return this.settings.fullscreenDefault ?? true;
  }

  public static setFullscreenDefault(enabled: boolean) {
    this.settings.fullscreenDefault = enabled;
    this.save();
  }

  public static toggleFullscreenDefault(): boolean {
    this.settings.fullscreenDefault = !this.isFullscreenDefault();
    this.save();
    return this.settings.fullscreenDefault;
  }

  public static isPtBrFilterDefault(): boolean {
    return this.settings.filterPtBrDefault;
  }

  public static setPtBrFilterDefault(enabled: boolean) {
    this.settings.filterPtBrDefault = enabled;
    this.save();
  }

  public static togglePtBrFilterDefault(): boolean {
    this.settings.filterPtBrDefault = !this.settings.filterPtBrDefault;
    this.save();
    return this.settings.filterPtBrDefault;
  }

  public static isSoundFeedbackEnabled(): boolean {
    return this.settings.soundFeedbackEnabled ?? true;
  }

  public static setSoundFeedbackEnabled(enabled: boolean) {
    this.settings.soundFeedbackEnabled = enabled;
    this.save();
  }

  public static toggleSoundFeedback(): boolean {
    this.settings.soundFeedbackEnabled = !this.isSoundFeedbackEnabled();
    this.save();
    return this.settings.soundFeedbackEnabled;
  }

  public static subscribe(listener: (settings: AppSettings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private static save() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
      this.listeners.forEach((l) => l(this.settings));
    } catch (e) {
      console.warn('Erro ao salvar configurações:', e);
    }
  }
}

export async function applyFullscreen(enable: boolean): Promise<void> {
  // 1. Try Tauri native window invoke
  try {
    const tauri =
      (window as unknown as { __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__ ||
      (window as unknown as { __TAURI__?: { core?: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } } }).__TAURI__?.core;

    if (tauri && typeof tauri.invoke === 'function') {
      await tauri.invoke('set_fullscreen', { fullscreen: enable });
      return;
    }
  } catch (e) {
    console.debug('Tauri set_fullscreen invoke not available:', e);
  }

  // 2. Web Fullscreen fallback
  try {
    if (enable) {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
    } else {
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
      }
    }
  } catch (e) {
    console.debug('Web fullscreen request error:', e);
  }
}
