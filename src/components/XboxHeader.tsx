import React, { useEffect, useState } from 'react';
import { LiquidGlassLayer } from './LiquidGlassLayer';
import { ControllerButtonBadge } from './ControllerButtonBadge';
import { ThemeLogo } from './ThemeLogo';
import { LiquidGlassRail } from './LiquidGlassRail';
import type { ThemeId } from '../types/theme';

export type NavTab = 'home' | 'movies' | 'series' | 'library' | 'settings';

interface Props {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  currentTheme?: ThemeId;
}

export const TABS: { id: NavTab; label: string; symbol?: string; color?: string; textColor?: string }[] = [
  { id: 'home', label: 'INÍCIO', symbol: '✕', color: '#0072CE', textColor: 'text-white font-black' },
  { id: 'movies', label: 'FILMES', symbol: '△', color: '#1DE9B6', textColor: 'text-zinc-950 font-black' },
  { id: 'series', label: 'SÉRIES', symbol: '▢', color: '#FF4081', textColor: 'text-white font-black' },
  { id: 'library', label: 'BIBLIOTECA', symbol: '◯', color: '#FF334B', textColor: 'text-white font-black' },
  { id: 'settings', label: 'CONFIGURAÇÕES', symbol: '✦', color: '#00E5FF', textColor: 'text-zinc-950 font-black' },
];

export const XboxHeader: React.FC<Props> = ({
  activeTab,
  onTabChange,
  currentTheme = 'stremio',
}) => {
  const [time, setTime] = useState<string>('');
  const isPs1 = currentTheme === 'ps1';

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(
        now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 10000);
    return () => clearInterval(interval);
  }, []);

  const getThemeLabel = (th: ThemeId) => {
    switch (th) {
      case 'steamos':
        return 'STEAMOS';
      case 'liquid-glass':
        return 'LIQUID GLASS';
      case 'ps1':
        return 'PS1 RETRÔ';
      case 'playstation':
        return 'PS5';
      case 'xbox':
        return 'XBOX';
      case 'nintendo':
        return 'SWITCH';
      case 'oled':
        return 'OLED';
      default:
        return 'STREMIO';
    }
  };

  return (
    <header className="absolute top-0 left-0 right-0 h-24 px-12 flex items-center justify-between bg-transparent select-none z-40 pointer-events-none">
      {/* Left: Pixel-perfect Theme & Console Emblem */}
      <div className="flex items-center pointer-events-auto">
        <div
          onClick={() => onTabChange('settings')}
          className={`liquid-glass-detail liquid-glass-control ${currentTheme === 'stremio' ? 'w-40 h-14' : 'w-11 h-11'} rounded-[14px] flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95 cursor-pointer relative overflow-hidden group ${
            isPs1
              ? 'bg-white/10 hover:bg-white/15 border-2 border-white/25 backdrop-blur-xl shadow-xl'
              : 'border shadow-lg'
          }`}
          style={
            isPs1
              ? {
                  boxShadow:
                    '0 4px 20px rgba(0, 0, 0, 0.35), 0 0 16px rgba(255, 255, 255, 0.15)',
                }
              : {
                  backgroundColor:
                    currentTheme === 'stremio' ? 'transparent' : currentTheme === 'oled' || currentTheme === 'liquid-glass' || currentTheme === 'steamos' ? 'var(--app-header-bg)' : 'var(--app-accent)',
                  borderColor:
                    currentTheme === 'stremio' ? 'transparent' : currentTheme === 'oled'
                      ? '#2e2e34'
                      : 'rgba(255, 255, 255, 0.15)',
                  boxShadow: currentTheme === 'stremio' ? 'none' : '0 4px 24px var(--app-accent-glow)',
                }
          }
          title={`Tema: ${getThemeLabel(currentTheme)}`}
        >
            <LiquidGlassLayer />
          <div className="flex items-center justify-center transition-transform group-hover:scale-110 relative z-10">
            <ThemeLogo
              theme={currentTheme}
              className={
                currentTheme === 'stremio'
                  ? 'w-40 h-14'
                  : isPs1
                  ? 'w-6 h-6'
                  : currentTheme === 'playstation'
                  ? 'w-5 h-5 text-white'
                  : currentTheme === 'xbox'
                  ? 'w-5 h-5 text-white'
                  : currentTheme === 'nintendo'
                  ? 'w-5 h-5 text-white'
                  : currentTheme === 'oled'
                  ? 'w-5 h-5 text-white'
                  : 'w-5 h-5 text-white'
              }
            />
          </div>
        </div>
      </div>

      {/* Center: Strictly Centered Tab Navigation with Glassmorphism & Stylized Thick White Border */}
      <div
        className={`liquid-glass-surface absolute left-1/2 -translate-x-1/2 flex items-center gap-3 px-2 py-1.5 rounded-2xl shadow-2xl backdrop-blur-2xl pointer-events-auto transition-all ${
          isPs1
            ? 'bg-white/10 border-2 border-white/25'
            : 'bg-black/40 border border-white/10'
        }`}
        style={
          isPs1
            ? {
                boxShadow:
                  '0 12px 32px rgba(0, 0, 0, 0.35), 0 0 20px rgba(255, 255, 255, 0.12)',
              }
            : undefined
        }
      >
        <div className="flex items-center justify-center">
          <ControllerButtonBadge button="LB" currentTheme={currentTheme} />
        </div>

        <nav className="liquid-glass-rail relative isolate flex items-center gap-1">
          <LiquidGlassRail selected={activeTab} />
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;

            if (isPs1) {
              const activeColor = tab.color || '#0072CE';
              const textClass = isActive ? tab.textColor || 'text-white' : 'text-white/80 hover:text-white hover:bg-white/15';

              return (
                <button
                  key={tab.id}
                  onClick={() => onTabChange(tab.id)}
                  style={
                    isActive
                      ? {
                          backgroundColor: activeColor,
                          border: '2px solid rgba(255, 255, 255, 0.35)',
                          boxShadow: `0 2px 16px ${activeColor}bb, 0 0 14px rgba(255, 255, 255, 0.25)`,
                        }
                      : undefined
                  }
                  className={`h-8 px-4 flex items-center justify-center gap-1.5 text-xs font-black tracking-wider transition-all rounded-xl cursor-pointer leading-none ${textClass}`}
                >
                  {tab.symbol && (
                    <span
                      className={`text-[11px] leading-none ${
                        isActive ? 'opacity-100 font-black' : 'opacity-60'
                      }`}
                    >
                      {tab.symbol}
                    </span>
                  )}
                  <span>{tab.label}</span>
                </button>
              );
            }

            return (
              <button
                key={tab.id}
                data-glass-tab={tab.id}
                data-glass-active={isActive}
                onClick={() => onTabChange(tab.id)}
                style={
                  isActive
                    ? {
                        backgroundColor: currentTheme === 'liquid-glass' ? 'rgba(225, 241, 255, 0.15)' : 'var(--app-accent)',
                        boxShadow: '0 2px 14px var(--app-accent-glow)',
                      }
                    : undefined
                }
                className={`relative isolate h-8 px-4 flex items-center justify-center text-xs font-black tracking-widest transition-all rounded-xl cursor-pointer leading-none ${
                  isActive
                    ? 'text-white'
                    : 'text-zinc-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="flex items-center justify-center">
          <ControllerButtonBadge button="RB" currentTheme={currentTheme} />
        </div>
      </div>

      {/* Right: Active Theme Pill + Digital Clock (Stylized Thick White Border) */}
      <div className="flex items-center pointer-events-auto gap-2.5">
        <div
          onClick={() => onTabChange('settings')}
          className={`liquid-glass-detail liquid-glass-control h-9 px-3 flex items-center gap-2 text-xs font-black tracking-wider rounded-xl backdrop-blur-2xl shadow-lg leading-none cursor-pointer transition-all ${
            isPs1
              ? 'bg-white/10 hover:bg-white/15 border-2 border-white/25 text-white'
              : 'bg-black/40 border border-white/10 text-zinc-300'
          }`}
          style={isPs1 ? { boxShadow: '0 4px 14px rgba(0, 0, 0, 0.25), 0 0 12px rgba(255, 255, 255, 0.1)' } : undefined}
        >
            <LiquidGlassLayer />
          {isPs1 ? (
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#1DE9B6] shadow-[0_0_4px_#1DE9B6]" title="△" />
              <span className="w-1.5 h-1.5 rounded-full bg-[#FF4081] shadow-[0_0_4px_#FF4081]" title="▢" />
              <span className="w-1.5 h-1.5 rounded-full bg-[#0072CE] shadow-[0_0_4px_#0072CE]" title="✕" />
              <span className="w-1.5 h-1.5 rounded-full bg-[#FF334B] shadow-[0_0_4px_#FF334B]" title="◯" />
            </div>
          ) : (
            <span
              className="w-2 h-2 rounded-full shadow-sm"
              style={{
                backgroundColor: 'var(--app-accent)',
                boxShadow: '0 0 8px var(--app-accent)',
              }}
            />
          )}
          <span className="text-[10px] uppercase font-black text-white tracking-wider">
            {getThemeLabel(currentTheme)}
          </span>
        </div>

        <div
          className={`liquid-glass-detail liquid-glass-control h-9 px-4 flex items-center justify-center font-mono text-sm font-black tracking-wider rounded-xl backdrop-blur-2xl shadow-lg leading-none ${
            isPs1
              ? 'bg-white/10 border-2 border-white/25 text-white'
              : 'bg-black/40 border border-white/10 text-zinc-200'
          }`}
          style={isPs1 ? { boxShadow: '0 4px 14px rgba(0, 0, 0, 0.25), 0 0 12px rgba(255, 255, 255, 0.1)' } : undefined}
        >
            <LiquidGlassLayer />
          <span>{time}</span>
        </div>
      </div>
    </header>
  );
};
