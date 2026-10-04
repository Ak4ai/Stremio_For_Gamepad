export type ThemeId = 'stremio' | 'ps1' | 'playstation' | 'xbox' | 'nintendo' | 'oled' | 'steamos' | 'liquid-glass';

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  subtitle?: string;
  description: string;
  colors: {
    bg: string;
    cardBg: string;
    accent: string;
    accentGlow: string;
    accentSecondary: string;
    headerBg: string;
    border?: string;
    textPrimary?: string;
    textMuted?: string;
    removeColor: string;
    consoleLightGrey?: string;
    consoleLightBorder?: string;
    circle?: string;
    cross?: string;
    triangle?: string;
    square?: string;
  };
}

export const THEMES: Record<ThemeId, ThemeDefinition> = {
  steamos: {
    id: 'steamos',
    name: 'SteamOS',
    subtitle: 'Deck · Graphite & Blue',
    description: 'Grafite, azul elétrico e foco bem definido para navegar com o controle.',
    colors: {
      bg: '#10151c',
      cardBg: 'rgba(35, 45, 58, 0.94)',
      accent: '#1a9fff',
      accentGlow: 'rgba(26, 159, 255, 0.35)',
      accentSecondary: '#66c0f4',
      headerBg: 'rgba(20, 27, 36, 0.96)',
      border: 'rgba(126, 158, 189, 0.22)',
      textPrimary: '#f5f8fc',
      textMuted: '#a4b3c4',
      removeColor: '#ff657a',
    },
  },
  'liquid-glass': {
    id: 'liquid-glass',
    name: 'Liquid Glass',
    subtitle: 'Vidro · Luz & Profundidade',
    description: 'Preto translúcido com blur e vidro discreto nos seletores ativos.',
    colors: {
      bg: '#09090b',
      cardBg: 'rgba(18, 18, 20, 0.58)',
      accent: '#f4f4f5',
      accentGlow: 'rgba(255, 255, 255, 0.12)',
      accentSecondary: '#a1a1aa',
      headerBg: 'rgba(8, 8, 10, 0.64)',
      border: 'rgba(255, 255, 255, 0.1)',
      textPrimary: '#ffffff',
      textMuted: '#a1a1aa',
      removeColor: '#ff8093',
    },
  },
  stremio: {
    id: 'stremio',
    name: 'Stremio Clássico',
    subtitle: 'Violeta Stremio',
    description: 'Paleta original roxa e violeta profunda do Stremio',
    colors: {
      bg: '#0e091e',
      cardBg: 'rgba(30, 20, 58, 0.75)',
      accent: '#7b5bf5',
      accentGlow: 'rgba(123, 91, 245, 0.45)',
      accentSecondary: '#5a35ea',
      headerBg: 'rgba(14, 9, 30, 0.85)',
      border: 'rgba(255, 255, 255, 0.1)',
      textPrimary: '#ffffff',
      textMuted: '#9ca3af',
      removeColor: '#f43f5e',
    },
  },
  ps1: {
    id: 'ps1',
    name: 'PlayStation 1 Retrô',
    subtitle: 'Cyberpunk Retrô / 90s Industrial',
    description: 'Cinza chumbo industrial escuro do PS1 clássico com bordas brancas estilizadas e botões 32-bit',
    colors: {
      bg: '#1D1E22',
      cardBg: 'rgba(44, 46, 53, 0.90)',
      accent: '#0072CE',
      accentGlow: 'rgba(255, 255, 255, 0.65)',
      accentSecondary: '#FFFFFF',
      headerBg: 'rgba(29, 30, 34, 0.96)',
      border: 'rgba(255, 255, 255, 0.3)',
      textPrimary: '#FFFFFF',
      textMuted: '#8C92A4',
      removeColor: '#FF334B',
      consoleLightGrey: '#D8D9DF',
      consoleLightBorder: 'rgba(255, 255, 255, 0.3)',
      circle: '#FF334B',
      cross: '#0072CE',
      triangle: '#1DE9B6',
      square: '#FF4081',
    },
  },
  playstation: {
    id: 'playstation',
    name: 'PlayStation 5',
    subtitle: 'DualSense Navy',
    description: 'Azul vibrante DualSense com tons navy escuro e curvas futuristas',
    colors: {
      bg: '#080d1a',
      cardBg: 'rgba(18, 28, 52, 0.75)',
      accent: '#006FCD',
      accentGlow: 'rgba(0, 111, 205, 0.45)',
      accentSecondary: '#00439c',
      headerBg: 'rgba(8, 13, 26, 0.85)',
      border: 'rgba(255, 255, 255, 0.1)',
      textPrimary: '#ffffff',
      textMuted: '#9ca3af',
      removeColor: '#ff4d6d',
    },
  },
  xbox: {
    id: 'xbox',
    name: 'Xbox Series X|S',
    subtitle: 'Carbon Green',
    description: 'Verde Xbox clássico com visual escuro carbon e alto contraste',
    colors: {
      bg: '#0a0b0e',
      cardBg: 'rgba(26, 29, 36, 0.75)',
      accent: '#107C10',
      accentGlow: 'rgba(16, 124, 16, 0.45)',
      accentSecondary: '#0e6b0e',
      headerBg: 'rgba(10, 11, 14, 0.85)',
      border: 'rgba(255, 255, 255, 0.1)',
      textPrimary: '#ffffff',
      textMuted: '#9ca3af',
      removeColor: '#e81123',
    },
  },
  nintendo: {
    id: 'nintendo',
    name: 'Nintendo Switch',
    subtitle: 'Neon Red & Cyan',
    description: 'Vermelho vibrante dos Joy-Cons com contraste esportivo portátil',
    colors: {
      bg: '#111215',
      cardBg: 'rgba(30, 32, 38, 0.85)',
      accent: '#E60012',
      accentGlow: 'rgba(230, 0, 18, 0.45)',
      accentSecondary: '#00C3E3',
      headerBg: 'rgba(17, 18, 21, 0.92)',
      border: '#383b42',
      textPrimary: '#F4F5F7',
      textMuted: '#8C92A4',
      removeColor: '#e60012',
    },
  },
  oled: {
    id: 'oled',
    name: 'OLED Midnight',
    subtitle: 'Pure Black Cinema',
    description: 'Preto puro absoluto com acentos monocromáticos de alto contraste',
    colors: {
      bg: '#000000',
      cardBg: 'rgba(20, 20, 20, 0.85)',
      accent: '#e5e7eb',
      accentGlow: 'rgba(255, 255, 255, 0.3)',
      accentSecondary: '#9ca3af',
      headerBg: 'rgba(0, 0, 0, 0.9)',
      border: 'rgba(255, 255, 255, 0.12)',
      textPrimary: '#ffffff',
      textMuted: '#9ca3af',
      removeColor: '#ff3333',
    },
  },
};
