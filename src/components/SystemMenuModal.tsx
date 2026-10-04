import React, { useState, useEffect } from 'react';
import type { ThemeId } from '../types/theme';
import type { ControllerType, GamepadAction } from '../services/gamepad';
import { GamepadManager } from '../services/gamepad';
import { SoundService } from '../services/sound';
import { ControllerButtonBadge } from './ControllerButtonBadge';
import { LiquidGlassLayer } from './LiquidGlassLayer';
import { minimizeApp, closeApp, openUrl, activateSteamOverlay, GITHUB_REPO_URL } from '../services/system';
import { Minus, ExternalLink, Power, X, Terminal, Layers } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentTheme: ThemeId;
  controllerType?: ControllerType;
}

interface MenuItem {
  id: 'minimize' | 'github' | 'steam' | 'exit' | 'cancel';
  title: string;
  desc: string;
  icon: React.ReactNode;
  variant?: 'danger' | 'default';
  action: () => void;
}

export const SystemMenuModal: React.FC<Props> = ({
  isOpen,
  onClose,
  currentTheme,
  controllerType,
}) => {
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  const menuItems: MenuItem[] = [
    {
      id: 'steam',
      title: 'Painel da Steam (Shift+Tab)',
      desc: 'Abre a interface sobreposta da Steam para amigos, chat e configurações',
      icon: <Layers className="w-5 h-5 text-indigo-400" />,
      action: async () => {
        SoundService.playActionConfirm();
        await activateSteamOverlay();
        onClose();
      },
    },
    {
      id: 'minimize',
      title: 'Minimizar Aplicativo',
      desc: 'Oculta a janela e mantém o streaming ativo na barra de tarefas',
      icon: <Minus className="w-5 h-5 text-sky-400" />,
      action: async () => {
        SoundService.playActionConfirm();
        await minimizeApp();
        onClose();
      },
    },
    {
      id: 'github',
      title: 'Repositório GitHub',
      desc: 'Acesse o código, novidades e releases oficiais em github.com/Ak4ai',
      icon: <ExternalLink className="w-5 h-5 text-emerald-400" />,
      action: async () => {
        SoundService.playActionConfirm();
        await openUrl(GITHUB_REPO_URL);
        onClose();
      },
    },
    {
      id: 'exit',
      title: 'Sair do Aplicativo',
      desc: 'Encerra completamente o Stremio For Gamepad e o servidor de mídia',
      icon: <Power className="w-5 h-5 text-rose-400" />,
      variant: 'danger',
      action: async () => {
        SoundService.playBack();
        await closeApp();
      },
    },
    {
      id: 'cancel',
      title: 'Voltar ao Início',
      desc: 'Retoma a navegação no catálogo ou reprodução atual',
      icon: <X className="w-5 h-5 text-zinc-400" />,
      action: () => {
        SoundService.playBack();
        onClose();
      },
    },
  ];

  // Gamepad action handling
  useEffect(() => {
    if (!isOpen) return;

    const handleGamepadAction = (action: GamepadAction) => {
      switch (action) {
        case 'NAV_UP':
          setSelectedIndex((prev) => {
            const next = Math.max(0, prev - 1);
            if (next !== prev) SoundService.playNavTick();
            return next;
          });
          break;

        case 'NAV_DOWN':
          setSelectedIndex((prev) => {
            const next = Math.min(menuItems.length - 1, prev + 1);
            if (next !== prev) SoundService.playNavTick();
            return next;
          });
          break;

        case 'ACTION_A':
          menuItems[selectedIndex]?.action();
          break;

        case 'ACTION_B':
        case 'BUTTON_MENU':
          SoundService.playBack();
          onClose();
          break;
      }
    };

    const unsubscribe = GamepadManager.subscribe(handleGamepadAction);
    return () => unsubscribe();
  }, [isOpen, selectedIndex]);

  // Keyboard navigation fallback
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(0, prev - 1));
        SoundService.playNavTick();
      } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(menuItems.length - 1, prev + 1));
        SoundService.playNavTick();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        menuItems[selectedIndex]?.action();
      } else if (e.key === 'Escape' || e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        SoundService.playBack();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, selectedIndex]);

  if (!isOpen) return null;

  const isPs1 = currentTheme === 'ps1';
  const isOled = currentTheme === 'oled';
  const isLiquidGlass = currentTheme === 'liquid-glass';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/75 backdrop-blur-md animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          SoundService.playBack();
          onClose();
        }
      }}
    >
      <div
        className={`relative w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl transition-all border ${
          isLiquidGlass
            ? 'liquid-glass-detail border-white/20 bg-zinc-950/60'
            : isPs1
            ? 'bg-[#D8D9DF] text-zinc-900 border-4 border-[#8E909A] shadow-[0_12px_40px_rgba(0,0,0,0.8)]'
            : isOled
            ? 'bg-black text-white border-2 border-white/30 shadow-[0_0_50px_rgba(255,255,255,0.1)]'
            : 'bg-zinc-900/95 text-white border-white/15'
        }`}
        style={{
          boxShadow: isLiquidGlass
            ? '0 25px 60px rgba(0, 0, 0, 0.7), inset 0 0 0 1px rgba(255, 255, 255, 0.15)'
            : undefined,
        }}
      >
        {isLiquidGlass && <LiquidGlassLayer />}

        {/* Modal Header */}
        <div
          className={`p-6 border-b flex items-center justify-between ${
            isPs1
              ? 'border-[#8E909A] bg-[#CBCDD4]'
              : 'border-white/10 bg-white/5'
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-2xl flex items-center justify-center shadow-md ${
                isPs1
                  ? 'bg-[#0072CE] text-white'
                  : 'bg-[var(--app-accent)] text-white shadow-[0_4px_16px_var(--app-accent-glow)]'
              }`}
            >
              <Terminal className="w-5 h-5" />
            </div>
            <div>
              <h3
                className={`text-lg font-black uppercase tracking-wider ${
                  isPs1 ? 'text-zinc-900' : 'text-white'
                }`}
              >
                Menu do Sistema
              </h3>
              <p
                className={`text-xs ${
                  isPs1 ? 'text-zinc-600 font-mono' : 'text-zinc-400'
                }`}
              >
                Gerenciamento de Janela e Atalhos Rápidos
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <ControllerButtonBadge button="MENU" label="Fechar" size="sm" currentTheme={currentTheme} />
          </div>
        </div>

        {/* Menu Options List */}
        <div className="p-6 space-y-3">
          {menuItems.map((item, idx) => {
            const isSelected = selectedIndex === idx;

            return (
              <div
                key={item.id}
                onClick={() => {
                  setSelectedIndex(idx);
                  item.action();
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
                className={`relative p-4 rounded-2xl border transition-all cursor-pointer flex items-center justify-between select-none ${
                  isSelected
                    ? isPs1
                      ? 'bg-white border-4 border-[#0072CE] scale-[1.02] shadow-md'
                      : item.variant === 'danger'
                      ? 'bg-rose-950/40 border-2 border-rose-500 scale-[1.02] shadow-[0_0_20px_rgba(244,63,94,0.3)] ring-2 ring-rose-400/50'
                      : 'bg-white/15 border-2 border-white scale-[1.02] shadow-[0_0_24px_var(--app-accent-glow)] ring-2 ring-white/60'
                    : isPs1
                    ? 'bg-[#E5E6EB] border border-[#B0B2BA] hover:bg-white'
                    : 'bg-white/5 border-white/10 hover:border-white/20'
                }`}
              >
                <div className="flex items-center gap-4">
                  <div
                    className={`w-11 h-11 rounded-xl flex items-center justify-center border shadow-sm ${
                      isPs1
                        ? 'bg-[#CBCDD4] border-[#8E909A]'
                        : 'bg-black/30 border-white/10'
                    }`}
                  >
                    {item.icon}
                  </div>
                  <div>
                    <h4
                      className={`text-sm font-bold ${
                        isSelected
                          ? isPs1
                            ? 'text-[#0072CE]'
                            : item.variant === 'danger'
                            ? 'text-rose-300'
                            : 'text-white'
                          : isPs1
                          ? 'text-zinc-800'
                          : 'text-zinc-200'
                      }`}
                    >
                      {item.title}
                    </h4>
                    <p
                      className={`text-[11px] leading-relaxed ${
                        isPs1 ? 'text-zinc-600' : 'text-zinc-400'
                      }`}
                    >
                      {item.desc}
                    </p>
                  </div>
                </div>

                {isSelected && (
                  <div className="shrink-0 flex items-center gap-2">
                    <ControllerButtonBadge button="A" label="Confirmar" size="sm" currentTheme={currentTheme} controllerType={controllerType} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Modal Footer Hints */}
        <div
          className={`px-6 py-4 border-t flex items-center justify-between text-xs ${
            isPs1
              ? 'border-[#8E909A] bg-[#CBCDD4] text-zinc-700'
              : 'border-white/10 bg-black/30 text-zinc-400'
          }`}
        >
          <div className="flex items-center gap-4">
            <ControllerButtonBadge button="DPAD" label="Navegar" size="sm" currentTheme={currentTheme} controllerType={controllerType} />
            <ControllerButtonBadge button="A" label="Selecionar" size="sm" currentTheme={currentTheme} controllerType={controllerType} />
          </div>
          <ControllerButtonBadge button="B" label="Voltar" size="sm" currentTheme={currentTheme} controllerType={controllerType} />
        </div>
      </div>
    </div>
  );
};
