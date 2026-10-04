import React from 'react';
import { XboxButtonBadge, type XboxButtonType } from './XboxButtonBadge';
import { ThemeService } from '../services/theme';
import { LiquidGlassLayer } from './LiquidGlassLayer';
import type { ThemeId } from '../types/theme';

export interface HintAction {
  button: XboxButtonType;
  label: string;
}

interface Props {
  hints?: HintAction[];
  currentTheme?: ThemeId;
}

export const XboxFooterHints: React.FC<Props> = ({ hints, currentTheme: propTheme }) => {
  const [internalTheme, setInternalTheme] = React.useState<ThemeId>(() =>
    ThemeService.getTheme()
  );

  React.useEffect(() => {
    return ThemeService.subscribe((theme) => {
      setInternalTheme(theme);
    });
  }, []);

  const currentTheme = propTheme || internalTheme;
  const isPs1 = currentTheme === 'ps1';

  const defaultHints: HintAction[] = [
    { button: 'A', label: 'Assistir / Fontes' },
    { button: 'X', label: 'Biblioteca (+/-)' },
    { button: 'Y', label: 'Buscar' },
    { button: 'LB', label: '' },
    { button: 'RB', label: 'Trocar Aba' },
  ];

  // Group adjacent hints like LB + RB -> [LB, RB] "Trocar Aba", LT + RT -> [LT, RT] "Filtrar"
  const groupedHints = React.useMemo(() => {
    const list: { buttons: XboxButtonType[]; label: string }[] = [];
    const raw = hints && hints.length > 0 ? hints : defaultHints;

    for (let i = 0; i < raw.length; i++) {
      const cur = raw[i];
      const next = raw[i + 1];

      // Merge paired shoulder/trigger button shortcuts (e.g. LB + RB -> Trocar Aba)
      if (
        next &&
        ((cur.button === 'LB' && next.button === 'RB') ||
          (cur.button === 'LT' && next.button === 'RT') ||
          (!cur.label && next.label))
      ) {
        list.push({
          buttons: [cur.button, next.button],
          label: next.label || cur.label || (cur.button === 'LB' ? 'Trocar Aba' : 'Filtrar'),
        });
        i++; // skip next since it's merged
      } else {
        list.push({
          buttons: [cur.button],
          label: cur.label,
        });
      }
    }
    return list;
  }, [hints]);

  return (
    <footer
      className={`app-footer-hints fixed bottom-0 left-0 right-0 h-14 px-12 flex items-center justify-between z-30 select-none transition-all ${
        isPs1 ? 'border-t-0' : 'border-t backdrop-blur-md'
      }`}
      style={
        isPs1
          ? {
              background:
                'linear-gradient(to top, rgba(29, 30, 34, 0.98) 0%, rgba(29, 30, 34, 0.82) 40%, rgba(29, 30, 34, 0.35) 75%, rgba(29, 30, 34, 0) 100%)',
              borderTop: 'none',
            }
          : {
              background:
                'linear-gradient(to top, rgba(0, 0, 0, 0.95) 0%, rgba(0, 0, 0, 0.7) 100%)',
              borderColor: 'rgba(255, 255, 255, 0.05)',
            }
      }
    >
      <div className="flex items-center gap-2.5 md:gap-3 flex-wrap">
        {groupedHints.map((hint, idx) => (
          <div
            key={idx}
            className={`footer-hint relative isolate flex items-center gap-2 transition-all px-2.5 py-1 rounded-xl ${
              isPs1
                ? 'bg-white/10 hover:bg-white/15 border-2 border-white/25 backdrop-blur-xl shadow-sm'
                : 'bg-white/5 border border-white/10'
            }`}
            style={
              isPs1
                ? {
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25), 0 0 6px rgba(255, 255, 255, 0.08)',
                  }
                : undefined
            }
          >
            <LiquidGlassLayer radius={12} />
            <div className="flex items-center gap-1">
              {hint.buttons.map((btn, bIdx) => (
                <XboxButtonBadge key={bIdx} button={btn} currentTheme={currentTheme} size="sm" />
              ))}
            </div>
            {hint.label && (
              <span
                className={`text-xs font-semibold tracking-wide select-none ${
                  isPs1 ? 'text-white' : 'text-zinc-300'
                }`}
              >
                {hint.label}
              </span>
            )}
          </div>
        ))}
      </div>

      <div
        className={`flex items-center gap-2 text-xs ${
          isPs1 ? 'text-white font-semibold' : 'text-zinc-500 font-medium'
        }`}
      >
        <span>Use D-Pad ou Analógico para navegar</span>
      </div>
    </footer>
  );
};
