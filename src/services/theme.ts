import { THEMES, type ThemeId, type ThemeDefinition } from '../types/theme';

export class ThemeService {
  private static activeTheme: ThemeId = 'stremio';
  private static listeners: ((theme: ThemeId) => void)[] = [];

  public static init() {
    const saved = localStorage.getItem('stremio_deck_theme') as ThemeId | null;
    if (saved && THEMES[saved]) {
      this.setTheme(saved);
    } else {
      this.setTheme('stremio');
    }
  }

  public static getTheme(): ThemeId {
    return this.activeTheme;
  }

  public static getThemeDefinition(id?: ThemeId): ThemeDefinition {
    return THEMES[id || this.activeTheme] || THEMES.stremio;
  }

  public static subscribe(callback: (theme: ThemeId) => void): () => void {
    this.listeners.push(callback);
    callback(this.activeTheme);
    return () => {
      this.listeners = this.listeners.filter((cb) => cb !== callback);
    };
  }

  public static setTheme(id: ThemeId) {
    if (!THEMES[id]) return;
    this.activeTheme = id;
    localStorage.setItem('stremio_deck_theme', id);

    const theme = THEMES[id];
    const root = document.documentElement;

    root.setAttribute('data-theme', id);
    root.style.setProperty('--app-bg', theme.colors.bg);
    root.style.setProperty('--app-card-bg', theme.colors.cardBg);
    root.style.setProperty('--app-accent', theme.colors.accent);
    root.style.setProperty('--app-accent-glow', theme.colors.accentGlow);
    root.style.setProperty('--app-accent-secondary', theme.colors.accentSecondary);
    root.style.setProperty('--app-header-bg', theme.colors.headerBg);

    // Always reset PS1-exclusive vars first so they never bleed into other themes
    root.style.removeProperty('--app-ps1-light-grey');
    root.style.removeProperty('--app-ps1-light-border');

    if (theme.colors.border) {
      root.style.setProperty('--app-border', theme.colors.border);
    }
    if (theme.colors.textPrimary) {
      root.style.setProperty('--app-text-primary', theme.colors.textPrimary);
    }
    if (theme.colors.textMuted) {
      root.style.setProperty('--app-text-muted', theme.colors.textMuted);
    }
    if (theme.colors.consoleLightGrey) {
      root.style.setProperty('--app-ps1-light-grey', theme.colors.consoleLightGrey);
    }
    if (theme.colors.consoleLightBorder) {
      root.style.setProperty('--app-ps1-light-border', theme.colors.consoleLightBorder);
    }
    if (theme.colors.removeColor) {
      root.style.setProperty('--app-remove-color', theme.colors.removeColor);
    }

    // Always set --app-focus-border explicitly so focus rings never carry over from a previous theme.
    // PS1 uses white; all others use their accent color.
    root.style.setProperty(
      '--app-focus-border',
      id === 'ps1' ? 'rgba(255, 255, 255, 0.85)' : theme.colors.accent
    );

    // Button accents
    if (theme.colors.circle) {
      root.style.setProperty('--ps-circle', theme.colors.circle);
    }
    if (theme.colors.cross) {
      root.style.setProperty('--ps-cross', theme.colors.cross);
    }
    if (theme.colors.triangle) {
      root.style.setProperty('--ps-triangle', theme.colors.triangle);
    }
    if (theme.colors.square) {
      root.style.setProperty('--ps-square', theme.colors.square);
    }

    [...this.listeners].forEach((cb) => {
      try {
        cb(id);
      } catch (err) {
        console.error('Erro no listener de tema:', err);
      }
    });
  }
}
