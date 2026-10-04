import React, { useState, useEffect, useRef } from 'react';
import type { StremioUser, StremioAddon } from '../types/account';
import type { ServerStatus } from '../types/stremio';
import { THEMES, type ThemeId } from '../types/theme';
import type { ControllerType, GamepadAction } from '../services/gamepad';
import { GamepadManager } from '../services/gamepad';
import { ControllerButtonBadge } from './ControllerButtonBadge';
import { SettingsService, applyFullscreen } from '../services/settings';
import {
  Settings,
  Palette,
  Gamepad2,
  UserCheck,
  LogIn,
  LogOut,
  RotateCcw,
  Server,
  CheckCircle2,
  Boxes,
  Layers,
  Film,
  Tv,
  Volume2,
  Maximize,
} from 'lucide-react';

import { ThemeLogo } from './ThemeLogo';
import { LiquidGlassLayer } from './LiquidGlassLayer';

interface Props {
  isActive?: boolean;
  currentUser: StremioUser | null;
  currentTheme: ThemeId;
  forcedControllerType: 'auto' | ControllerType;
  serverStatus: ServerStatus;
  controllerName?: string;
  isGamepadActive?: boolean;
  userAddons?: StremioAddon[];
  onThemeChange: (id: ThemeId) => void;
  onControllerTypeChange: (type: 'auto' | ControllerType) => void;
  onOpenLogin: () => void;
  onLogout: () => void;
  onSyncCloud: () => void;
  onSyncAddons?: () => void;
  onCheckServer: () => void;
  onBackToHome: () => void;
}

const THEME_KEYS = Object.keys(THEMES) as ThemeId[];
const CONTROLLER_KEYS: ('auto' | ControllerType)[] = ['auto', 'xbox', 'playstation', 'nintendo', 'steam-deck'];

export const SettingsView: React.FC<Props> = ({
  isActive = true,
  currentUser,
  currentTheme,
  forcedControllerType,
  serverStatus,
  controllerName = '',
  isGamepadActive = false,
  userAddons = [],
  onThemeChange,
  onControllerTypeChange,
  onOpenLogin,
  onLogout,
  onSyncCloud,
  onSyncAddons,
  onCheckServer,
  onBackToHome,
}) => {
  // Focus state: Section (0..5) and Item inside that section
  const [section, setSection] = useState<number>(0);
  const [itemIdx, setItemIdx] = useState<number>(0);
  const [syncingCloud, setSyncingCloud] = useState<boolean>(false);
  const [syncingAddons, setSyncingAddons] = useState<boolean>(false);
  const [fullscreenDefault, setFullscreenDefault] = useState<boolean>(() =>
    SettingsService.isFullscreenDefault()
  );
  const [ptBrDefault, setPtBrDefault] = useState<boolean>(() =>
    SettingsService.isPtBrFilterDefault()
  );
  const [soundFeedback, setSoundFeedback] = useState<boolean>(() =>
    SettingsService.isSoundFeedbackEnabled()
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<(HTMLDivElement | null)[]>([]);

  // State ref for stable access inside gamepad listener
  const stateRef = useRef({
    section,
    itemIdx,
    currentUser,
    userAddons,
    isActive,
    fullscreenDefault,
    ptBrDefault,
    soundFeedback,
  });

  stateRef.current = {
    section,
    itemIdx,
    currentUser,
    userAddons,
    isActive,
    fullscreenDefault,
    ptBrDefault,
    soundFeedback,
  };

  // Gamepad action listener
  useEffect(() => {
    if (!isActive) return;

    const handleGamepadAction = (action: GamepadAction) => {
      const {
        section: curSec,
        itemIdx: curItem,
        currentUser: curUser,
        userAddons: addons,
      } = stateRef.current;

      const getMaxItems = (sec: number) => {
        if (sec === 0) return curUser ? 2 : 1;
        if (sec === 1) return 1 + (addons.length || 0); // 0 is sync button, 1..N are addons
        if (sec === 2) return THEME_KEYS.length;
        if (sec === 3) return CONTROLLER_KEYS.length;
        if (sec === 4) return 6; // 0,1: Tela Cheia, 2,3: Dublagem PT-BR, 4,5: Feedback Sonoro Tátil
        if (sec === 5) return 1; // Server check button
        return 1;
      };

      switch (action) {
        case 'NAV_UP': {
          const nextSec = Math.max(0, curSec - 1);
          setSection(nextSec);
          setItemIdx((prev) => Math.min(prev, getMaxItems(nextSec) - 1));
          break;
        }

        case 'NAV_DOWN': {
          const nextSec = Math.min(5, curSec + 1);
          setSection(nextSec);
          setItemIdx((prev) => Math.min(prev, getMaxItems(nextSec) - 1));
          break;
        }

        case 'NAV_LEFT': {
          setItemIdx((prev) => Math.max(0, prev - 1));
          break;
        }

        case 'NAV_RIGHT': {
          const max = getMaxItems(curSec);
          setItemIdx((prev) => Math.min(max - 1, prev + 1));
          break;
        }

        case 'ACTION_A': {
          if (curSec === 0) {
            // Stremio Account Section
            if (!curUser) {
              onOpenLogin();
            } else {
              if (curItem === 0) {
                setSyncingCloud(true);
                onSyncCloud();
                setTimeout(() => setSyncingCloud(false), 1200);
              } else {
                onLogout();
              }
            }
          } else if (curSec === 1) {
            // Addons Section
            if (curItem === 0 && onSyncAddons) {
              setSyncingAddons(true);
              onSyncAddons();
              setTimeout(() => setSyncingAddons(false), 1200);
            }
          } else if (curSec === 2) {
            // Themes Section
            const th = THEME_KEYS[curItem];
            if (th) onThemeChange(th);
          } else if (curSec === 3) {
            // Controller Layout Section
            const ctrl = CONTROLLER_KEYS[curItem];
            if (ctrl) onControllerTypeChange(ctrl);
          } else if (curSec === 4) {
            // Fullscreen, Audio Dubbing & Tactile Sound Section
            if (curItem === 0 || curItem === 1) {
              const enableFs = curItem === 0;
              SettingsService.setFullscreenDefault(enableFs);
              setFullscreenDefault(enableFs);
              applyFullscreen(enableFs);
            } else if (curItem === 2 || curItem === 3) {
              const enable = curItem === 2;
              SettingsService.setPtBrFilterDefault(enable);
              setPtBrDefault(enable);
            } else if (curItem === 4 || curItem === 5) {
              const enableSound = curItem === 4;
              SettingsService.setSoundFeedbackEnabled(enableSound);
              setSoundFeedback(enableSound);
            }
          } else if (curSec === 5) {
            // Server Section
            onCheckServer();
          }
          break;
        }

        case 'ACTION_B': {
          onBackToHome();
          break;
        }
      }
    };

    const unsubscribe = GamepadManager.subscribe(handleGamepadAction);
    return () => unsubscribe();
  }, [
    isActive,
    onOpenLogin,
    onSyncCloud,
    onSyncAddons,
    onLogout,
    onThemeChange,
    onControllerTypeChange,
    onCheckServer,
    onBackToHome,
  ]);

  // Smooth auto-scroll when section changes
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    if (section === 0) {
      container.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const secEl = sectionRefs.current[section];
    if (secEl) {
      const elTop = secEl.offsetTop - container.offsetTop;
      container.scrollTo({
        top: Math.max(0, elTop - 140),
        behavior: 'smooth',
      });
    }
  }, [section]);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto pt-36 px-12 pb-24 max-w-5xl w-full mx-auto no-scrollbar select-none animate-fade-in"
    >
      {/* Title */}
      <div className="flex items-center justify-between mb-8 border-b border-white/10 pb-6">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-2xl flex items-center justify-center text-white shadow-lg"
            style={{
              backgroundColor: 'var(--app-accent)',
              boxShadow: '0 4px 18px var(--app-accent-glow)',
            }}
          >
            <Settings className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-white uppercase tracking-wide">
              Configurações & Temas
            </h2>
            <p className="text-xs text-zinc-400">
              Personalize o layout visual, conta Stremio, addons sincronizados e controle
            </p>
          </div>
        </div>

        {/* Back hint badge */}
        <div className="flex items-center gap-2">
          <ControllerButtonBadge button="B" label="Voltar ao Início" />
        </div>
      </div>

      <div className="space-y-8">
        {/* SECTION 0: STREMIO ACCOUNT */}
        <div
          ref={(el) => {
            sectionRefs.current[0] = el;
          }}
          className={`app-card-panel rounded-2xl p-6 transition-all duration-200 ${
            section === 0 ? 'border-white/60 ring-2 ring-white/40' : ''
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2.5">
              <UserCheck className="w-5 h-5" style={{ color: 'var(--app-accent)' }} />
              <h3 className="font-bold text-base text-white">Conta Stremio</h3>
            </div>
            {currentUser ? (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-emerald-950/60 text-emerald-400 border border-emerald-800/60 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                CONECTADO
              </span>
            ) : (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-white/10 text-zinc-400 border border-white/10">
                NÃO CONECTADO
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-400 mb-5">
            Sincronize sua biblioteca pessoal, histórico de reprodução e addons instalados direto da nuvem oficial do Stremio.
          </p>

          {currentUser ? (
            <div className="flex flex-wrap items-center justify-between gap-4 app-card-item p-5 rounded-2xl">
              <div>
                <div className="text-sm font-bold text-white flex items-center gap-2">
                  <span>{currentUser.email}</span>
                </div>
                <div className="text-[11px] text-zinc-400 mt-0.5">Sessão ativa na nuvem Stremio</div>
              </div>

              <div className="flex items-center gap-3">
                {/* Sync Button */}
                <button
                  onClick={() => {
                    setSection(0);
                    setItemIdx(0);
                    setSyncingCloud(true);
                    onSyncCloud();
                    setTimeout(() => setSyncingCloud(false), 1200);
                  }}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                    section === 0 && itemIdx === 0
                      ? 'ring-4 ring-white text-white shadow-xl scale-105'
                      : 'border-white/10 bg-white/5 text-zinc-300 hover:text-white'
                  }`}
                  style={
                    section === 0 && itemIdx === 0
                      ? {
                          backgroundColor: 'var(--app-accent)',
                          boxShadow: '0 0 16px var(--app-accent-glow)',
                        }
                      : undefined
                  }
                >
                  <RotateCcw className={`w-3.5 h-3.5 ${syncingCloud ? 'animate-spin' : ''}`} />
                  <span>Sincronizar Nuvem</span>
                </button>

                {/* Disconnect Button */}
                <button
                  onClick={() => {
                    setSection(0);
                    setItemIdx(1);
                    onLogout();
                  }}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                    section === 0 && itemIdx === 1
                      ? 'ring-4 ring-rose-400 bg-rose-900/80 text-white shadow-xl scale-105'
                      : 'border-rose-800/40 bg-rose-950/40 text-rose-300 hover:bg-rose-900/50'
                  }`}
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Desconectar</span>
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => {
                setSection(0);
                setItemIdx(0);
                onOpenLogin();
              }}
              style={{
                backgroundColor: 'var(--app-accent)',
                boxShadow: '0 4px 18px var(--app-accent-glow)',
              }}
              className={`flex items-center gap-2.5 text-white font-bold text-xs px-6 py-3 rounded-2xl transition-all cursor-pointer shadow-lg ${
                section === 0 && itemIdx === 0 ? 'ring-4 ring-white scale-105 shadow-2xl' : 'hover:scale-105'
              }`}
            >
              <LogIn className="w-4 h-4" />
              <span>Conectar Conta Stremio</span>
            </button>
          )}
        </div>

        {/* SECTION 1: ADDONS INSTALADOS (NOVO!) */}
        <div
          ref={(el) => {
            sectionRefs.current[1] = el;
          }}
          className={`app-card-panel rounded-2xl p-6 transition-all duration-200 ${
            section === 1 ? 'border-white/60 ring-2 ring-white/40' : ''
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2.5">
              <Boxes className="w-5 h-5" style={{ color: 'var(--app-accent)' }} />
              <h3 className="font-bold text-base text-white">Addons Instalados na Conta</h3>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-white/10 text-zinc-300 border border-white/10">
                {userAddons.length} Addon(s) Ativo(s)
              </span>

              {/* Sync Addons Button (Item 0) */}
              <button
                onClick={() => {
                  setSection(1);
                  setItemIdx(0);
                  if (onSyncAddons) {
                    setSyncingAddons(true);
                    onSyncAddons();
                    setTimeout(() => setSyncingAddons(false), 1200);
                  }
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                  section === 1 && itemIdx === 0
                    ? 'ring-4 ring-white text-white shadow-xl scale-105'
                    : 'border-white/10 bg-white/5 text-zinc-300 hover:text-white'
                }`}
                style={
                  section === 1 && itemIdx === 0
                    ? {
                        backgroundColor: 'var(--app-accent)',
                        boxShadow: '0 0 16px var(--app-accent-glow)',
                      }
                    : undefined
                }
              >
                <RotateCcw className={`w-3.5 h-3.5 ${syncingAddons ? 'animate-spin' : ''}`} />
                <span>Atualizar Addons</span>
              </button>
            </div>
          </div>
          <p className="text-xs text-zinc-400 mb-5">
            Addons sincronizados da sua conta oficial Stremio. Eles alimentam os catálogos, streams de vídeo e legendas.
          </p>

          {userAddons.length === 0 ? (
            <div className="bg-black/30 border border-white/10 rounded-2xl p-6 text-center text-xs text-zinc-400">
              Nenhum addon sincronizado no momento. Conecte sua conta Stremio acima para sincronizar seus addons pessoais.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {userAddons.map((addon, idx) => {
                const isFocused = section === 1 && itemIdx === idx + 1;
                const catalogsCount = addon.manifest?.catalogs?.length || 0;
                const types = addon.manifest?.types || [];

                return (
                  <div
                    key={`${addon.manifest?.id || 'addon'}-${addon.transportUrl || idx}-${idx}`}
                    onClick={() => {
                      setSection(1);
                      setItemIdx(idx + 1);
                    }}
                    className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between select-none app-card-item ${
                      isFocused
                        ? 'is-focused border-2 border-white scale-[1.02] z-10'
                        : 'border-white/20 hover:border-white/40'
                    }`}
                    style={
                      isFocused
                        ? {
                            boxShadow: '0 0 0 3.5px #ffffff, 0 0 24px var(--app-accent-glow)',
                          }
                        : undefined
                    }
                  >
                    <div>
                      {/* Top row: Logo & Name */}
                      <div className="flex items-center gap-3 mb-2.5">
                        {addon.manifest?.logo ? (
                          <img
                            src={addon.manifest.logo}
                            alt={addon.manifest.name}
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              // If addon logo fails to load (e.g. 403 or 404), hide it gracefully
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                            className="w-9 h-9 rounded-xl object-contain bg-black/40 p-1 border border-white/10"
                          />
                        ) : (
                          <div
                            className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs text-white shadow-sm"
                            style={{ backgroundColor: 'var(--app-accent)' }}
                          >
                            <Layers className="w-5 h-5" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-bold text-white truncate">
                            {addon.manifest?.name || 'Addon Stremio'}
                          </div>
                          <div className="text-[11px] text-zinc-400 font-mono">
                            v{addon.manifest?.version || '1.0.0'}
                          </div>
                        </div>
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50" />
                      </div>

                      {/* Description */}
                      <p className="text-[11px] text-zinc-400 line-clamp-2 leading-relaxed mb-3">
                        {addon.manifest?.description || 'Provedor de catálogos e streams para Stremio.'}
                      </p>
                    </div>

                    {/* Bottom Tags */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-white/10">
                      {types.slice(0, 3).map((t) => (
                        <span
                          key={t}
                          className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-white/10 text-zinc-300"
                        >
                          {t === 'movie' ? (
                            <Film className="w-2.5 h-2.5 inline mr-1" />
                          ) : (
                            <Tv className="w-2.5 h-2.5 inline mr-1" />
                          )}
                          {t}
                        </span>
                      ))}
                      {catalogsCount > 0 && (
                        <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-purple-950/60 border border-purple-800/60 text-purple-300">
                          {catalogsCount} trilho(s)
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* SECTION 2: VISUAL THEME */}
        <div
          ref={(el) => {
            sectionRefs.current[2] = el;
          }}
          className={`app-card-panel rounded-2xl p-6 transition-all duration-200 ${
            section === 2 ? 'border-white/60 ring-2 ring-white/40' : ''
          }`}
        >
          <div className="flex items-center gap-2.5 mb-2">
            <Palette className="w-5 h-5" style={{ color: 'var(--app-accent)' }} />
            <h3 className="font-bold text-base text-white">Tema Visual da Dashboard</h3>
          </div>
          <p className="text-xs text-zinc-400 mb-5">
            Selecione uma paleta. Use esquerda/direita e <ControllerButtonBadge button="A" label="Ativar" size="sm" />.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {THEME_KEYS.map((themeId, idx) => {
              const theme = THEMES[themeId];
              const isSelected = currentTheme === theme.id;
              const isFocused = section === 2 && itemIdx === idx;

              return (
                <div
                  key={theme.id}
                  onClick={() => {
                    setSection(2);
                    setItemIdx(idx);
                    onThemeChange(theme.id);
                  }}
                  className={`relative p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between select-none app-card-item ${isSelected ? 'liquid-glass-detail' : ''} ${
                    isFocused
                      ? 'is-focused border-2 border-white scale-105 z-10'
                      : isSelected
                      ? 'border-white/60 bg-white/10'
                      : 'border-white/20 hover:border-white/40'
                  }`}
                  style={{
                    backgroundColor: isFocused || isSelected ? theme.colors.cardBg : undefined,
                    boxShadow: isFocused ? `0 0 0 3.5px #ffffff, 0 0 24px ${theme.colors.accentGlow}` : undefined,
                  }}
                >
                  {isSelected && <LiquidGlassLayer />}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2.5">
                        <div
                          className="w-8 h-8 rounded-xl flex items-center justify-center border shadow-sm shrink-0"
                          style={{
                            background:
                              theme.id === 'ps1'
                                ? 'rgba(255, 255, 255, 0.2)'
                                : theme.id === 'oled' || theme.id === 'liquid-glass' || theme.id === 'steamos'
                                ? '#0a0a0c'
                                : theme.colors.accent,
                            border:
                              theme.id === 'ps1' ? '2px solid rgba(255, 255, 255, 0.3)' : '1px solid rgba(255, 255, 255, 0.15)',
                          }}
                        >
                          <ThemeLogo
                            theme={theme.id}
                            className={
                              theme.id === 'ps1'
                                ? 'w-5 h-5'
                                : 'w-4 h-4 text-white'
                            }
                          />
                        </div>
                        <div>
                          <span className="font-bold text-sm text-white block leading-tight">
                            {theme.name}
                          </span>
                          {theme.subtitle && (
                            <span className="text-[10px] text-zinc-400 font-mono">
                              {theme.subtitle}
                            </span>
                          )}
                        </div>
                      </div>
                      <div
                        className="w-3.5 h-3.5 rounded-full border border-white/40 shadow-sm shrink-0"
                        style={{ backgroundColor: theme.colors.accent }}
                      />
                    </div>
                    <p className="text-[11px] text-zinc-400 leading-relaxed mb-3">
                      {theme.description}
                    </p>

                    {/* PS1 specific color palette signature */}
                    {theme.id === 'ps1' && (
                      <div className="flex items-center gap-1.5 mb-3 bg-white/15 px-2.5 py-1.5 rounded-lg border-2 border-white text-white shadow-sm">
                        <span className="text-[9px] text-white/90 font-black uppercase tracking-wider">32-Bit:</span>
                        <span className="w-2.5 h-2.5 rounded-full bg-[#FF334B] shadow-[0_0_6px_#FF334B]" title="🔴 Círculo / Confirmar" />
                        <span className="w-2.5 h-2.5 rounded-full bg-[#0072CE] shadow-[0_0_6px_#0072CE]" title="✕ Cross" />
                        <span className="w-2.5 h-2.5 rounded-full bg-[#1DE9B6] shadow-[0_0_6px_#1DE9B6]" title="🔺 Triângulo" />
                        <span className="w-2.5 h-2.5 rounded-full bg-[#FF4081] shadow-[0_0_6px_#FF4081]" title="🟦 Quadrado" />
                        <span className="text-[9px] text-[#00E5FF] font-mono font-black ml-auto flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#00E5FF] shadow-[0_0_6px_#00E5FF]" />
                          DualSense LED
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-white/10">
                    <span
                      className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded"
                      style={{
                        backgroundColor: isSelected ? theme.colors.accent : 'rgba(255,255,255,0.08)',
                        color: isSelected ? (theme.id === 'liquid-glass' ? '#18181b' : '#ffffff') : '#9ca3af',
                      }}
                    >
                      {isSelected ? 'Ativo' : 'Selecionar'}
                    </span>
                    {isFocused && (
                      <span className="text-[10px] text-white font-mono font-bold">
                        (A) Ativar
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* SECTION 3: CONTROLLER LAYOUT */}
        <div
          ref={(el) => {
            sectionRefs.current[3] = el;
          }}
          className={`app-card-panel rounded-2xl p-6 transition-all duration-200 ${
            section === 3 ? 'border-white/60 ring-2 ring-white/40' : ''
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2.5">
              <Gamepad2 className="w-5 h-5" style={{ color: 'var(--app-accent)' }} />
              <h3 className="font-bold text-base text-white">Detecção de Controle & Glifos</h3>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-white/10 text-zinc-300 border border-white/10">
              {isGamepadActive
                ? `Conectado: ${controllerName.slice(0, 24)}`
                : 'Nenhum controle físico (Teclado Ativo)'}
            </span>
          </div>
          <p className="text-xs text-zinc-400 mb-5">
            Detecta automaticamente Xbox, DualSense (PlayStation), Nintendo Switch, Steam Deck ou Teclado, adaptando os botões na tela.
          </p>

          {/* Layout Pills */}
          <div className="mb-5 rounded-xl bg-black/20 p-4 text-xs text-zinc-300">
            <p className="mb-2 font-bold text-white">Atalhos de teclado</p>
            <p>Setas: navegar · Enter: selecionar · Esc: voltar · Q / E: abas · 1 / 2: gatilhos · F: ação secundária · M: menu · F11: alternar tela cheia.</p>
            <p className="mt-2">Na busca, letras digitam: Backspace apaga, Delete limpa, Tab alterna teclado/resultados e Page Up / Page Down mudam o filtro. Tab navega pelos botões nas outras telas.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-6">
            {CONTROLLER_KEYS.map((opt, idx) => {
              const isCurrent = forcedControllerType === opt;
              const isFocused = section === 3 && itemIdx === idx;
              const labels: Record<'auto' | ControllerType, string> = {
                auto: 'Automático (Detectar)',
                xbox: 'Xbox (A, B, X, Y)',
                playstation: 'PlayStation (✕, ◯, ▢, △)',
                nintendo: 'Nintendo Switch',
                'steam-deck': 'Steam Deck (Valve)',
                keyboard: 'Teclado',
              };

              return (
                <button
                  key={opt}
                  onClick={() => {
                    setSection(3);
                    setItemIdx(idx);
                    onControllerTypeChange(opt);
                  }}
                  style={
                    isCurrent
                      ? {
                          backgroundColor: 'var(--app-accent)',
                          boxShadow: '0 2px 10px var(--app-accent-glow)',
                        }
                      : undefined
                  }
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer app-card-item ${
                    isFocused
                      ? 'is-focused border-2 border-white scale-105 text-white z-10'
                      : isCurrent
                      ? 'text-white'
                      : 'border-white/20 text-zinc-300 hover:text-white'
                  }`}
                >
                  {labels[opt]}
                </button>
              );
            })}
          </div>

          {/* Live Preview */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="app-card-panel p-3.5 rounded-xl flex items-center gap-2.5">
              <ControllerButtonBadge button="A" />
              <span className="text-zinc-300">Confirmar / Play</span>
            </div>
            <div className="app-card-panel p-3.5 rounded-xl flex items-center gap-2.5">
              <ControllerButtonBadge button="B" />
              <span className="text-zinc-300">Voltar / Fechar</span>
            </div>
            <div className="app-card-panel p-3.5 rounded-xl flex items-center gap-2.5">
              <ControllerButtonBadge button="X" />
              <span className="text-zinc-300">Mais Detalhes</span>
            </div>
            <div className="app-card-panel p-3.5 rounded-xl flex items-center gap-2.5">
              <ControllerButtonBadge button="Y" />
              <span className="text-zinc-300">Busca Rápida</span>
            </div>
          </div>
        </div>

        {/* SECTION 4: PREFERÊNCIAS DO SISTEMA, TELA CHEIA E ÁUDIO */}
        <div
          ref={(el) => {
            sectionRefs.current[4] = el;
          }}
          className={`app-card-panel rounded-2xl p-6 transition-all duration-200 ${
            section === 4 ? 'border-white/60 ring-2 ring-white/40' : ''
          }`}
        >
          {/* Sub-section 1: Tela Cheia por Padrão */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-purple-500/20 text-purple-400 border border-purple-500/30 flex items-center justify-center">
                <Maximize className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-base text-white">Modo de Exibição & Tela Cheia</h3>
                <p className="text-xs text-zinc-400">
                  Defina se o aplicativo deve abrir por padrão em tela cheia ou modo janela
                </p>
              </div>
            </div>
            <span
              className={`text-xs font-bold px-2.5 py-1 rounded-md border ${
                fullscreenDefault
                  ? 'bg-purple-950/60 text-purple-300 border-purple-800/60'
                  : 'bg-zinc-800 text-zinc-400 border-zinc-700'
              }`}
            >
              {fullscreenDefault ? '🖥️ Tela Cheia Ativa' : '🪟 Modo Janela'}
            </span>
          </div>

          <p className="text-xs text-zinc-400 mb-5">
            Ao ativar, o programa sempre inicia preenchendo 100% do seu monitor ou TV sem molduras do Windows. Você também pode alternar a qualquer momento pressionando <kbd className="px-1.5 py-0.5 rounded bg-white/10 border border-white/20 text-[10px] font-mono text-white">F11</kbd> no teclado.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
            {[
              {
                id: 0,
                active: true,
                title: 'Ativado (Tela Cheia por Padrão)',
                desc: 'Inicia em fullscreen direto, ideal para jogos no sofá, TV ou Steam Deck',
              },
              {
                id: 1,
                active: false,
                title: 'Desativado (Modo Janela / Maximizado)',
                desc: 'Inicia com as bordas e barra de títulos convencionais do Windows',
              },
            ].map((opt) => {
              const isSelected = opt.active ? fullscreenDefault : !fullscreenDefault;
              const isFocused = section === 4 && itemIdx === opt.id;

              return (
                <div
                  key={opt.id}
                  onClick={() => {
                    setSection(4);
                    setItemIdx(opt.id);
                    SettingsService.setFullscreenDefault(opt.active);
                    setFullscreenDefault(opt.active);
                    applyFullscreen(opt.active);
                  }}
                  style={
                    isSelected
                      ? {
                          backgroundColor: 'rgba(168, 85, 247, 0.15)',
                          borderColor: 'rgba(168, 85, 247, 0.5)',
                        }
                      : undefined
                  }
                  className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between app-card-item ${
                    isFocused
                      ? 'is-focused border-2 border-white scale-102 z-10'
                      : isSelected
                      ? 'bg-purple-950/30 border-purple-500/40'
                      : 'border-white/20 hover:border-white/40'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-white flex items-center gap-2">
                      {opt.title}
                    </span>
                    {isSelected && (
                      <span className="w-2.5 h-2.5 rounded-full bg-purple-400 shadow-md shadow-purple-400/50" />
                    )}
                  </div>
                  <span className="text-[11px] text-zinc-400 leading-relaxed">{opt.desc}</span>
                </div>
              );
            })}
          </div>

          {/* Sub-section 2: Preferência de Áudio & Dublagem */}
          <div className="pt-5 border-t border-white/10">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center">
                  <Volume2 className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="font-bold text-sm text-white">Preferência de Áudio & Dublagem (PT-BR)</h4>
                  <p className="text-xs text-zinc-400">
                    Defina o comportamento padrão para detecção de dublagem e áudio nacional nas fontes
                  </p>
                </div>
              </div>
              <span
                className={`text-xs font-bold px-2.5 py-1 rounded-md border ${
                  ptBrDefault
                    ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60'
                    : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                }`}
              >
                {ptBrDefault ? '🇧🇷 Dublado PT-BR Padrão' : 'Todas as Fontes'}
              </span>
            </div>

            <p className="text-xs text-zinc-400 mb-5">
              Ao ativar, a tela de reprodução filtra por padrão releases com [DUBLADO], [DUAL], [PT-BR], MultiDub e bandeira 🇧🇷. Você pode alternar a qualquer momento pressionando (Y) ou (△) no controle.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
              {[
                {
                  id: 2,
                  active: true,
                  title: 'Ativado (Priorizar Dublado PT-BR)',
                  desc: 'Abre a seleção de fontes filtrada apenas em Português / Dual Áudio',
                },
                {
                  id: 3,
                  active: false,
                  title: 'Desativado (Exibir Todas as Fontes)',
                  desc: 'Abre exibindo todas as resoluções e idiomas de áudio disponíveis',
                },
              ].map((opt) => {
                const isSelected = opt.active ? ptBrDefault : !ptBrDefault;
                const isFocused = section === 4 && itemIdx === opt.id;

                return (
                  <div
                    key={opt.id}
                    onClick={() => {
                      setSection(4);
                      setItemIdx(opt.id);
                      SettingsService.setPtBrFilterDefault(opt.active);
                      setPtBrDefault(opt.active);
                    }}
                    style={
                      isSelected
                        ? {
                            backgroundColor: 'rgba(16, 185, 129, 0.15)',
                            borderColor: 'rgba(16, 185, 129, 0.5)',
                          }
                        : undefined
                    }
                    className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between app-card-item ${
                      isFocused
                        ? 'is-focused border-2 border-white scale-102 z-10'
                        : isSelected
                        ? 'bg-emerald-950/30 border-emerald-500/40'
                        : 'border-white/20 hover:border-white/40'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-white flex items-center gap-2">
                        {opt.active && <span>🇧🇷</span>}
                        {opt.title}
                      </span>
                      {isSelected && (
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-md shadow-emerald-400/50" />
                      )}
                    </div>
                    <span className="text-[11px] text-zinc-400 leading-relaxed">{opt.desc}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Sub-section 3: Feedback Sonoro Tátil */}
          <div className="pt-5 border-t border-white/10">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h4 className="font-bold text-sm text-white">Feedback Sonoro Tátil (Navegação)</h4>
                <p className="text-xs text-zinc-400">
                  Reproduz o clique mecânico suave e tátil (48kHz) ao navegar pelos menus com o controle ou teclado
                </p>
              </div>
              <span
                className={`text-xs font-bold px-2.5 py-1 rounded-md border ${
                  soundFeedback
                    ? 'bg-blue-950/60 text-blue-300 border-blue-800/60'
                    : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                }`}
              >
                {soundFeedback ? '🔊 Som Tátil Ativo' : '🔇 Mudo'}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                {
                  id: 4,
                  active: true,
                  title: 'Ativado (Clique Tátil Suave)',
                  desc: 'Resposta sonora imediata a cada troca de foco e seleção no gamepad',
                },
                {
                  id: 5,
                  active: false,
                  title: 'Desativado (Silencioso)',
                  desc: 'Navegação totalmente muda sem efeito de áudio na interface',
                },
              ].map((opt) => {
                const isSelected = opt.active ? soundFeedback : !soundFeedback;
                const isFocused = section === 4 && itemIdx === opt.id;

                return (
                  <div
                    key={opt.id}
                    onClick={() => {
                      setSection(4);
                      setItemIdx(opt.id);
                      SettingsService.setSoundFeedbackEnabled(opt.active);
                      setSoundFeedback(opt.active);
                    }}
                    style={
                      isSelected
                        ? {
                            backgroundColor: 'rgba(59, 130, 246, 0.15)',
                            borderColor: 'rgba(59, 130, 246, 0.5)',
                          }
                        : undefined
                    }
                    className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between app-card-item ${
                      isFocused
                        ? 'is-focused border-2 border-white scale-102 z-10'
                        : isSelected
                        ? 'bg-blue-950/30 border-blue-500/40'
                        : 'border-white/20 hover:border-white/40'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-white flex items-center gap-2">
                        {opt.title}
                      </span>
                      {isSelected && (
                        <span className="w-2.5 h-2.5 rounded-full bg-blue-400 shadow-md shadow-blue-400/50" />
                      )}
                    </div>
                    <span className="text-[11px] text-zinc-400 leading-relaxed">{opt.desc}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* SECTION 5: STREAMING ENGINE */}
        <div
          ref={(el) => {
            sectionRefs.current[5] = el;
          }}
          className={`app-card-panel rounded-2xl p-6 transition-all duration-200 ${
            section === 5 ? 'border-white/60 ring-2 ring-white/40' : ''
          }`}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div
                className={`w-3.5 h-3.5 rounded-full ${
                  serverStatus.isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                }`}
              />
              <h3 className="font-bold text-base text-white">Stremio Streaming Server (Engine)</h3>
            </div>
            <span
              className={`text-xs font-semibold px-2.5 py-1 rounded-md ${
                serverStatus.isOnline
                  ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/60'
                  : 'bg-amber-950/60 text-amber-400 border border-amber-800/60'
              }`}
            >
              {serverStatus.isOnline
                ? `Online (v${serverStatus.version || '4.21.0'})`
                : 'Offline / Inicializando'}
            </span>
          </div>

          <p className="text-xs text-zinc-400 mb-5">
            O motor nativo do Stremio gerencia o streaming P2P e conversão de vídeo em segundo plano na porta 11470.
          </p>

          <button
            onClick={() => {
              setSection(5);
              setItemIdx(0);
              onCheckServer();
            }}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
              section === 5 && itemIdx === 0
                ? 'ring-4 ring-white text-white shadow-xl scale-105'
                : 'border-white/20 bg-white/10 text-zinc-200 hover:text-white'
            }`}
            style={
              section === 5 && itemIdx === 0
                ? {
                    backgroundColor: 'var(--app-accent)',
                    boxShadow: '0 0 16px var(--app-accent-glow)',
                  }
                : undefined
            }
          >
            <Server className="w-4 h-4" />
            <span>Verificar Conexão com o Servidor</span>
          </button>
        </div>
      </div>
    </div>
  );
};
