import React from 'react';
import type { ControllerType } from '../services/gamepad';
import { GamepadManager } from '../services/gamepad';
import { ThemeService } from '../services/theme';
import type { ThemeId } from '../types/theme';
import { LiquidGlassLayer } from './LiquidGlassLayer';

import xboxA from '../assets/prompts/xbox_a.svg';
import xboxB from '../assets/prompts/xbox_b.svg';
import xboxX from '../assets/prompts/xbox_x.svg';
import xboxY from '../assets/prompts/xbox_y.svg';

import psCross from '../assets/prompts/ps_cross.svg';
import psCircle from '../assets/prompts/ps_circle.svg';
import psSquare from '../assets/prompts/ps_square.svg';
import psTriangle from '../assets/prompts/ps_triangle.svg';

import ps1Cross from '../assets/prompts/ps1_cross.svg';
import ps1Circle from '../assets/prompts/ps1_circle.svg';
import ps1Square from '../assets/prompts/ps1_square.svg';
import ps1Triangle from '../assets/prompts/ps1_triangle.svg';
import ps1L1 from '../assets/prompts/ps1_l1.svg';
import ps1R1 from '../assets/prompts/ps1_r1.svg';
import ps1L2 from '../assets/prompts/ps1_l2.svg';
import ps1R2 from '../assets/prompts/ps1_r2.svg';

import switchA from '../assets/prompts/switch_a.svg';
import switchB from '../assets/prompts/switch_b.svg';
import switchX from '../assets/prompts/switch_x.svg';
import switchY from '../assets/prompts/switch_y.svg';
import deckA from '../assets/prompts/steam-deck/a.svg';
import deckB from '../assets/prompts/steam-deck/b.svg';
import deckX from '../assets/prompts/steam-deck/x.svg';
import deckY from '../assets/prompts/steam-deck/y.svg';
import deckLB from '../assets/prompts/steam-deck/lb.svg';
import deckRB from '../assets/prompts/steam-deck/rb.svg';
import deckLT from '../assets/prompts/steam-deck/lt.svg';
import deckRT from '../assets/prompts/steam-deck/rt.svg';
import deckDpad from '../assets/prompts/steam-deck/dpad.svg';
import deckView from '../assets/prompts/steam-deck/view.svg';
import deckMenu from '../assets/prompts/steam-deck/menu.svg';

export type ControllerButton =
  | 'A'
  | 'B'
  | 'X'
  | 'Y'
  | 'LB'
  | 'RB'
  | 'LT'
  | 'RT'
  | 'DPAD'
  | 'VIEW'
  | 'MENU';

const STEAM_DECK_BUTTON_SVGS: Record<ControllerButton, string> = {
  A: deckA, B: deckB, X: deckX, Y: deckY,
  LB: deckLB, RB: deckRB, LT: deckLT, RT: deckRT,
  DPAD: deckDpad, VIEW: deckView, MENU: deckMenu,
};

const BUTTON_SVGS: Record<ControllerType, Partial<Record<ControllerButton, string>>> = {
  xbox: {
    A: xboxA,
    B: xboxB,
    X: xboxX,
    Y: xboxY,
  },
  playstation: {
    A: psCross,
    B: psCircle,
    X: psSquare,
    Y: psTriangle,
  },
  nintendo: {
    A: switchA,
    B: switchB,
    X: switchX,
    Y: switchY,
  },
  'steam-deck': STEAM_DECK_BUTTON_SVGS,
  keyboard: {},
};

const PS1_BUTTON_SVGS: Partial<Record<ControllerButton, string>> = {
  A: ps1Cross,
  B: ps1Circle,
  X: ps1Square,
  Y: ps1Triangle,
  LB: ps1L1,
  RB: ps1R1,
  LT: ps1L2,
  RT: ps1R2,
};

interface Props {
  button: ControllerButton;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  controllerType?: ControllerType;
  currentTheme?: ThemeId;
  keyboardLabel?: string;
  glass?: boolean;
}

export const ControllerButtonBadge: React.FC<Props> = ({
  button,
  label,
  keyboardLabel,
  size = 'md',
  controllerType,
  currentTheme: propTheme,
  glass = false,
}) => {
  const [activeType, setActiveType] = React.useState<ControllerType>(
    controllerType || GamepadManager.activeControllerType
  );
  const [internalTheme, setInternalTheme] = React.useState<ThemeId>(() =>
    ThemeService.getTheme()
  );

  React.useEffect(() => {
    const unsubTheme = ThemeService.subscribe((theme) => {
      setInternalTheme(theme);
    });
    return unsubTheme;
  }, []);

  React.useEffect(() => {
    if (controllerType) {
      setActiveType(controllerType);
      return;
    }
    const unsub = GamepadManager.subscribeControllerType((type) => {
      setActiveType(type);
    });
    return unsub;
  }, [controllerType]);

  const currentTheme = propTheme || internalTheme;
  const isPs1Mode = currentTheme === 'ps1';
  const steamDeckSvg =
    activeType === 'steam-deck' || (currentTheme === 'steamos' && activeType === 'xbox')
      ? STEAM_DECK_BUTTON_SVGS[button]
      : undefined;

  // PS1 theme: always use classic PS1 SVGs. All other themes: use controller-type SVGs from BUTTON_SVGS.
  const svgSrc =
    steamDeckSvg || (activeType !== 'keyboard' && isPs1Mode && PS1_BUTTON_SVGS[button]
      ? PS1_BUTTON_SVGS[button]
      : activeType !== 'keyboard'
      ? BUTTON_SVGS[activeType]?.[button]
      : undefined);

  if (svgSrc) {
    // Optical scale based on L1/R1 pill height:
    const svgSizeClass = {
      sm: 'w-6 h-6 min-w-6',
      md: 'w-7 h-7 min-w-7',
      lg: 'w-9 h-9 min-w-9',
    }[size];

    return (
      <div className={`inline-flex items-center gap-1.5 select-none leading-none ${glass ? 'liquid-glass-detail' : ''}`}>
        {glass && <LiquidGlassLayer />}
        <img
          src={svgSrc}
          alt={`${steamDeckSvg ? 'steam-deck' : isPs1Mode ? 'ps1' : activeType}-${button}`}
          className={`${svgSizeClass} aspect-square object-contain pointer-events-none drop-shadow-md select-none transition-transform hover:scale-105 shrink-0`}
          draggable={false}
        />
        {label && (
          <span
            className={`text-xs font-semibold tracking-wide leading-none select-none ${
              isPs1Mode ? 'text-zinc-200' : 'text-zinc-300'
            }`}
          >
            {label}
          </span>
        )}
      </div>
    );
  }

  // Determine Glyph and Styling according to Controller Type and PS1 theme
  const renderGlyph = () => {
    if (isPs1Mode && activeType !== 'keyboard') {
      switch (button) {
        case 'A':
          return {
            symbol: '✕',
            style: 'bg-[#D8D9DF] text-[#0072CE] border-[#8E909A] font-black shadow-sm',
          };
        case 'B':
          return {
            symbol: '◯',
            style: 'bg-[#D8D9DF] text-[#FF334B] border-[#8E909A] font-black shadow-sm',
          };
        case 'X':
          return {
            symbol: '▢',
            style: 'bg-[#D8D9DF] text-[#FF4081] border-[#8E909A] font-black shadow-sm',
          };
        case 'Y':
          return {
            symbol: '△',
            style: 'bg-[#D8D9DF] text-[#1DE9B6] border-[#8E909A] font-black shadow-sm',
          };
        case 'LB':
          return {
            symbol: 'L1',
            style: 'bg-[#D8D9DF] text-[#1D1E22] border-[#8E909A] font-bold shadow-sm',
          };
        case 'RB':
          return {
            symbol: 'R1',
            style: 'bg-[#D8D9DF] text-[#1D1E22] border-[#8E909A] font-bold shadow-sm',
          };
        case 'LT':
          return {
            symbol: 'L2',
            style: 'bg-[#D8D9DF] text-[#1D1E22] border-[#8E909A] font-bold shadow-sm',
          };
        case 'RT':
          return {
            symbol: 'R2',
            style: 'bg-[#D8D9DF] text-[#1D1E22] border-[#8E909A] font-bold shadow-sm',
          };
        case 'VIEW':
          return {
            symbol: 'Select',
            style: 'bg-[#D8D9DF] text-[#1D1E22] border-[#8E909A] text-[10px] font-bold shadow-sm',
          };
        case 'MENU':
          return {
            symbol: 'Start',
            style: 'bg-[#D8D9DF] text-[#1D1E22] border-[#8E909A] text-[10px] font-bold shadow-sm',
          };
        default:
          return {
            symbol: 'D-Pad',
            style: 'bg-[#D8D9DF] text-[#1D1E22] border-[#8E909A] text-[10px] font-bold shadow-sm',
          };
      }
    }

    switch (activeType) {
      case 'playstation':
        switch (button) {
          case 'A':
            return { symbol: '✕', style: 'bg-[#0072CE] text-white border-[#0072CE]/60 font-black' };
          case 'B':
            return { symbol: '◯', style: 'bg-[#FF334B] text-white border-[#FF334B]/60 font-black' };
          case 'X':
            return { symbol: '▢', style: 'bg-[#FF4081] text-white border-[#FF4081]/60 font-black' };
          case 'Y':
            return { symbol: '△', style: 'bg-[#1DE9B6] text-zinc-950 border-[#1DE9B6]/60 font-black' };
          case 'LB':
            return { symbol: 'L1', style: 'bg-zinc-800 text-zinc-200 border-zinc-600 font-bold' };
          case 'RB':
            return { symbol: 'R1', style: 'bg-zinc-800 text-zinc-200 border-zinc-600 font-bold' };
          case 'LT':
            return { symbol: 'L2', style: 'bg-zinc-800 text-zinc-200 border-zinc-600 font-bold' };
          case 'RT':
            return { symbol: 'R2', style: 'bg-zinc-800 text-zinc-200 border-zinc-600 font-bold' };
          case 'VIEW':
            return { symbol: 'Share', style: 'bg-zinc-800 text-zinc-300 border-zinc-600 text-[10px]' };
          case 'MENU':
            return { symbol: 'Options', style: 'bg-zinc-800 text-zinc-300 border-zinc-600 text-[10px]' };
          default:
            return { symbol: 'D-Pad', style: 'bg-zinc-800 text-zinc-300 border-zinc-600 text-[10px]' };
        }

      case 'nintendo':
        switch (button) {
          case 'A':
            return { symbol: 'A', style: 'bg-red-600 text-white border-red-400 font-black' };
          case 'B':
            return { symbol: 'B', style: 'bg-amber-500 text-black border-amber-300 font-black' };
          case 'X':
            return { symbol: 'X', style: 'bg-blue-600 text-white border-blue-400 font-black' };
          case 'Y':
            return { symbol: 'Y', style: 'bg-emerald-600 text-white border-emerald-400 font-black' };
          case 'LB':
            return { symbol: 'L', style: 'bg-zinc-800 text-zinc-200 border-zinc-600 font-bold' };
          case 'RB':
            return { symbol: 'R', style: 'bg-zinc-800 text-zinc-200 border-zinc-600 font-bold' };
          case 'LT':
            return { symbol: 'ZL', style: 'bg-zinc-800 text-zinc-200 border-zinc-600 font-bold' };
          case 'RT':
            return { symbol: 'ZR', style: 'bg-zinc-800 text-zinc-200 border-zinc-600 font-bold' };
          case 'VIEW':
            return { symbol: '−', style: 'bg-zinc-800 text-zinc-300 border-zinc-600' };
          case 'MENU':
            return { symbol: '+', style: 'bg-zinc-800 text-zinc-300 border-zinc-600' };
          default:
            return { symbol: 'D-Pad', style: 'bg-zinc-800 text-zinc-300 border-zinc-600 text-[10px]' };
        }

      case 'steam-deck':
        switch (button) {
          case 'A':
            return { symbol: 'A', style: 'bg-[#1a1f29] text-zinc-100 border-zinc-500 font-black' };
          case 'B':
            return { symbol: 'B', style: 'bg-[#1a1f29] text-rose-400 border-zinc-500 font-black' };
          case 'X':
            return { symbol: 'X', style: 'bg-[#1a1f29] text-sky-400 border-zinc-500 font-black' };
          case 'Y':
            return { symbol: 'Y', style: 'bg-[#1a1f29] text-amber-300 border-zinc-500 font-black' };
          case 'LB':
          case 'RB':
          case 'LT':
          case 'RT':
            return { symbol: button, style: 'bg-zinc-800 text-zinc-300 font-bold border-zinc-600' };
          case 'VIEW':
            return { symbol: 'View', style: 'bg-zinc-800 text-zinc-300 border-zinc-600 text-[10px]' };
          case 'MENU':
            return { symbol: 'Menu', style: 'bg-zinc-800 text-zinc-300 border-zinc-600 text-[10px]' };
          default:
            return { symbol: 'D-Pad', style: 'bg-zinc-800 text-zinc-300 border-zinc-600 text-[10px]' };
        }

      case 'keyboard':
        switch (button) {
          case 'A':
            return { symbol: 'Enter', style: 'bg-zinc-800 text-zinc-200 border-zinc-600 text-[10px]' };
          case 'B':
            return { symbol: 'Esc', style: 'bg-zinc-800 text-zinc-200 border-zinc-600 text-[10px]' };
          case 'X':
            return { symbol: 'X', style: 'bg-zinc-800 text-zinc-200 border-zinc-600 font-bold' };
          case 'Y':
            return { symbol: 'Y', style: 'bg-zinc-800 text-zinc-200 border-zinc-600 font-bold' };
          case 'LB':
            return { symbol: 'Q', style: 'bg-zinc-800 text-zinc-200 border-zinc-600 font-bold' };
          case 'RB':
            return { symbol: 'E', style: 'bg-zinc-800 text-zinc-200 border-zinc-600 font-bold' };
          case 'LT':
            return { symbol: '1', style: 'bg-zinc-800 text-zinc-200 border-zinc-600 text-[10px]' };
          case 'RT':
            return { symbol: '2', style: 'bg-zinc-800 text-zinc-200 border-zinc-600 text-[10px]' };
          case 'VIEW':
            return { symbol: 'F', style: 'bg-zinc-800 text-zinc-200 border-zinc-600 text-[10px]' };
          case 'MENU':
            return { symbol: 'M', style: 'bg-zinc-800 text-zinc-200 border-zinc-600 text-[10px]' };
          default:
            return { symbol: 'Setas', style: 'bg-zinc-800 text-zinc-200 border-zinc-600 text-[10px]' };
        }

      case 'xbox':
      default:
        switch (button) {
          case 'A':
            return { symbol: 'A', style: 'bg-emerald-600 text-white font-black border-emerald-400' };
          case 'B':
            return { symbol: 'B', style: 'bg-rose-600 text-white font-black border-rose-400' };
          case 'X':
            return { symbol: 'X', style: 'bg-sky-600 text-white font-black border-sky-400' };
          case 'Y':
            return { symbol: 'Y', style: 'bg-amber-500 text-black font-black border-amber-300' };
          case 'LB':
          case 'RB':
          case 'LT':
          case 'RT':
            return { symbol: button, style: 'bg-zinc-800 text-zinc-300 font-bold border-zinc-600' };
          default:
            return { symbol: button, style: 'bg-zinc-800 text-zinc-300 font-medium border-zinc-600' };
        }
    }
  };

  const glyph = renderGlyph();
  const symbol = activeType === 'keyboard' && keyboardLabel ? keyboardLabel : glyph.symbol;
  const style = glyph.style;
  const isRound = ['A', 'B', 'X', 'Y'].includes(button) && activeType !== 'keyboard';

  const roundSizeClasses = {
    sm: 'w-6 h-6 text-xs',
    md: 'w-7 h-7 text-xs',
    lg: 'w-9 h-9 text-sm',
  }[size];

  const pillSizeClasses = {
    sm: 'h-5 px-1.5 text-[10px] min-w-5',
    md: 'h-6 px-2 text-[11px] min-w-6',
    lg: 'h-7 px-2.5 text-xs min-w-7',
  }[size];

  return (
    <div className={`inline-flex items-center gap-1.5 select-none leading-none ${glass ? 'liquid-glass-detail' : ''}`}>
      {glass && <LiquidGlassLayer />}
      <span
        className={`inline-flex items-center justify-center border shadow-sm transition-all text-center leading-none ${
          isRound ? `rounded-full aspect-square ${roundSizeClasses}` : `rounded-md ${pillSizeClasses}`
        } ${style}`}
      >
        <span className="flex items-center justify-center text-center leading-none select-none">
          {symbol}
        </span>
      </span>
      {label && (
        <span
          className={`text-xs font-semibold tracking-wide leading-none ${
            isPs1Mode ? 'text-zinc-200' : 'text-zinc-300'
          }`}
        >
          {label}
        </span>
      )}
    </div>
  );
};

// Backward compatibility alias
export const XboxButtonBadge = ControllerButtonBadge;
export type XboxButtonType = ControllerButton;
