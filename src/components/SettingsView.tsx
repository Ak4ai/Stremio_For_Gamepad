import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import type { StremioUser, StremioAddon } from '../types/account';
import type { ServerStatus } from '../types/stremio';
import { THEMES, type ThemeId } from '../types/theme';
import type { ControllerType, GamepadAction } from '../services/gamepad';
import { GamepadManager } from '../services/gamepad';
import { ControllerButtonBadge } from './ControllerButtonBadge';
import { SettingsService, applyFullscreen } from '../services/settings';
import {
  Boxes,
  ChevronLeft,
  ChevronRight,
  Gamepad2,
  Layers,
  LogIn,
  LogOut,
  Maximize,
  Palette,
  RotateCcw,
  Server,
  Volume2,
  Languages,
} from 'lucide-react';

import { ThemeLogo } from './ThemeLogo';

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
  onManageLocalAddons?: () => void;
  onOpenAddonOptions?: (addon: StremioAddon) => void;
  onCheckServer: () => void;
  onBackToHome: () => void;
}

type SettingsTab = 'general' | 'account' | 'addons';

const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: 'general', label: 'Geral' },
  { id: 'account', label: 'Conta' },
  { id: 'addons', label: 'Addons' },
];

const THEME_KEYS = Object.keys(THEMES) as ThemeId[];
const CONTROLLER_KEYS: ('auto' | ControllerType)[] = ['auto', 'xbox', 'playstation', 'nintendo', 'steam-deck'];
const CONTROLLER_LABELS: Record<'auto' | ControllerType, string> = {
  auto: 'Automático',
  xbox: 'Xbox',
  playstation: 'PlayStation',
  nintendo: 'Nintendo Switch',
  'steam-deck': 'Steam Deck',
  keyboard: 'Teclado',
};

const wrap = (value: number, length: number) => ((value % length) + length) % length;

/**
 * One large row per setting: A runs/toggles it, left/right changes a choice.
 * The right-hand panel explains or previews whatever row has focus.
 */
interface RowDef {
  id: string;
  group?: string;
  icon: ReactNode;
  title: string;
  detail?: string;
  value: ReactNode;
  choice?: boolean;
  danger?: boolean;
  activate?: () => void;
  shift?: (dir: -1 | 1) => void;
  panel: ReactNode;
}

const Pill: React.FC<{ on: boolean; children: ReactNode }> = ({ on, children }) => (
  <span
    className={`px-3 py-1 rounded-full border text-[11px] font-bold tracking-wider ${
      on ? 'text-white border-white/70' : 'text-zinc-400 border-white/15'
    }`}
    style={on ? { backgroundColor: 'color-mix(in srgb, var(--app-accent) 32%, transparent)' } : undefined}
  >
    {children}
  </span>
);

const PanelTitle: React.FC<{ children: ReactNode }> = ({ children }) => (
  <h3 className="m-0 text-xs font-bold uppercase tracking-[0.16em] text-zinc-400">{children}</h3>
);

const Help: React.FC<{ children: ReactNode }> = ({ children }) => (
  <p className="m-0 text-[13px] leading-relaxed text-zinc-400">{children}</p>
);

const Facts: React.FC<{ items: [string, ReactNode][] }> = ({ items }) => (
  <dl className="m-0 grid grid-cols-[110px_minmax(0,1fr)] gap-x-3.5 gap-y-2 text-[13px]">
    {items.map(([label, value]) => (
      <React.Fragment key={label}>
        <dt className="text-zinc-400">{label}</dt>
        <dd className="m-0 font-semibold text-white break-words">{value}</dd>
      </React.Fragment>
    ))}
  </dl>
);

const Preview: React.FC<{ children: ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`rounded-2xl border border-white/10 bg-black/30 p-4 ${className}`}>{children}</div>
);

const ScreenMock: React.FC<{ full: boolean; active: boolean }> = ({ full, active }) => (
  <div
    className={`relative grid place-items-center border-2 text-[11px] transition-colors ${
      full ? 'aspect-[16/10] rounded' : 'aspect-[16/11] w-[82%] mx-auto rounded-lg'
    } ${active ? 'border-white text-white bg-white/10' : 'border-white/15 text-zinc-400 bg-white/5'}`}
  >
    {!full && <b className="absolute inset-x-0 top-0 h-[14%] rounded-t-md bg-white/15" />}
    <span>{full ? 'Tela cheia' : 'Janela'}</span>
  </div>
);

const AddonIcon: React.FC<{ addon: StremioAddon; size?: string }> = ({ addon, size = 'w-6 h-6' }) =>
  addon.manifest?.logo ? (
    <img
      src={addon.manifest.logo}
      alt=""
      referrerPolicy="no-referrer"
      onError={(e) => ((e.target as HTMLElement).style.display = 'none')}
      className={`${size} object-contain`}
    />
  ) : (
    <Layers className={size} />
  );

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
  onManageLocalAddons,
  onOpenAddonOptions,
  onCheckServer,
  onBackToHome,
}) => {
  const [tab, setTab] = useState<SettingsTab>('general');
  const [focus, setFocus] = useState(0);
  const [armed, setArmed] = useState<string | null>(null);
  const [syncingCloud, setSyncingCloud] = useState(false);
  const [syncingAddons, setSyncingAddons] = useState(false);
  const [fullscreenDefault, setFullscreenDefault] = useState(() => SettingsService.isFullscreenDefault());
  const [ptBrDefault, setPtBrDefault] = useState(() => SettingsService.isPtBrFilterDefault());
  const [soundFeedback, setSoundFeedback] = useState(() => SettingsService.isSoundFeedbackEnabled());

  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const theme = THEMES[currentTheme] ?? THEMES[THEME_KEYS[0]];
  const themeIndex = Math.max(0, THEME_KEYS.indexOf(currentTheme));
  const controllerIndex = Math.max(0, CONTROLLER_KEYS.indexOf(forcedControllerType));

  const shiftTheme = (dir: -1 | 1) => onThemeChange(THEME_KEYS[wrap(themeIndex + dir, THEME_KEYS.length)]);
  const shiftController = (dir: -1 | 1) =>
    onControllerTypeChange(CONTROLLER_KEYS[wrap(controllerIndex + dir, CONTROLLER_KEYS.length)]);

  const toggleFullscreen = () => {
    const next = !fullscreenDefault;
    SettingsService.setFullscreenDefault(next);
    setFullscreenDefault(next);
    applyFullscreen(next);
  };
  const togglePtBr = () => {
    const next = !ptBrDefault;
    SettingsService.setPtBrFilterDefault(next);
    setPtBrDefault(next);
  };
  const toggleSound = () => {
    const next = !soundFeedback;
    SettingsService.setSoundFeedbackEnabled(next);
    setSoundFeedback(next);
  };
  const syncCloud = () => {
    setSyncingCloud(true);
    onSyncCloud();
    setTimeout(() => setSyncingCloud(false), 1200);
  };
  const syncAddons = () => {
    if (!onSyncAddons) return;
    setSyncingAddons(true);
    onSyncAddons();
    setTimeout(() => setSyncingAddons(false), 1200);
  };

  const localCount = userAddons.filter((a) => a.local).length;

  const generalRows: RowDef[] = [
    {
      id: 'theme',
      group: 'Aparência',
      icon: <Palette />,
      title: 'Tema',
      detail: theme.subtitle,
      value: theme.name,
      choice: true,
      activate: () => shiftTheme(1),
      shift: shiftTheme,
      panel: (
        <>
          <PanelTitle>Tema</PanelTitle>
          <Preview className="grid gap-3">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl grid place-items-center border border-white/15"
                style={{ background: theme.colors.accent }}
              >
                <ThemeLogo theme={theme.id} className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="text-sm font-bold text-white">{theme.name}</div>
                {theme.subtitle && <div className="text-[11px] font-mono text-zinc-400">{theme.subtitle}</div>}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 rounded-xl p-3" style={{ background: theme.colors.bg }}>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="aspect-[3/4] rounded-lg"
                  style={{
                    background: theme.colors.cardBg,
                    boxShadow: i === 0 ? `0 0 0 3px ${theme.colors.accent}` : undefined,
                  }}
                />
              ))}
            </div>
          </Preview>
          <div className="flex flex-wrap gap-2.5" role="group" aria-label="Temas">
            {THEME_KEYS.map((id) => (
              <button
                key={id}
                type="button"
                aria-label={THEMES[id].name}
                aria-pressed={id === currentTheme}
                onClick={() => onThemeChange(id)}
                className="w-7 h-7 rounded-full border-2 border-white/25 cursor-pointer"
                style={{
                  background: `linear-gradient(135deg, ${THEMES[id].colors.bg} 50%, ${THEMES[id].colors.accent} 50%)`,
                  boxShadow: id === currentTheme ? '0 0 0 3px #ffffff' : undefined,
                }}
              />
            ))}
          </div>
          <Help>{theme.description.replace(/\.?$/, '.')} Use ◀ ▶ para experimentar os temas.</Help>
        </>
      ),
    },
    {
      id: 'controller',
      icon: <Gamepad2 />,
      title: 'Ícones dos botões',
      detail: 'Qual controle aparece nas dicas',
      value: CONTROLLER_LABELS[forcedControllerType],
      choice: true,
      activate: () => shiftController(1),
      shift: shiftController,
      panel: (
        <>
          <PanelTitle>Ícones dos botões</PanelTitle>
          <Preview className="grid gap-3">
            {(
              [
                ['A', 'Confirmar / Assistir'],
                ['B', 'Voltar / Fechar'],
                ['X', 'Ação secundária'],
                ['Y', 'Busca rápida'],
              ] as const
            ).map(([button, label]) => (
              <div key={button} className="flex items-center gap-3.5 text-sm font-semibold text-white">
                <ControllerButtonBadge button={button} />
                <span>{label}</span>
              </div>
            ))}
          </Preview>
          <Facts
            items={[
              ['Controle', isGamepadActive ? controllerName || 'Conectado' : 'Nenhum (teclado)'],
              ['Estilo', forcedControllerType === 'auto' ? 'Automático' : 'Fixo'],
            ]}
          />
          <Help>
            {forcedControllerType === 'auto'
              ? 'Automático: usa o estilo do controle conectado.'
              : 'Fixo: as dicas mostram sempre este estilo, mesmo com outro controle.'}{' '}
            Teclado: setas navegam, Enter seleciona, Esc volta, Q / E trocam de aba, 1 / 2 são os gatilhos, F é a ação
            secundária, M abre o menu e F11 alterna a tela cheia.
          </Help>
        </>
      ),
    },
    {
      id: 'fullscreen',
      icon: <Maximize />,
      title: 'Tela cheia ao abrir',
      detail: 'Também em F11',
      value: <Pill on={fullscreenDefault}>{fullscreenDefault ? 'LIGADA' : 'DESLIGADA'}</Pill>,
      activate: toggleFullscreen,
      panel: (
        <>
          <PanelTitle>Tela cheia ao abrir</PanelTitle>
          <div className="grid grid-cols-2 gap-3 items-center">
            <ScreenMock full={false} active={!fullscreenDefault} />
            <ScreenMock full active={fullscreenDefault} />
          </div>
          <Help>
            {fullscreenDefault
              ? 'Ligada: o app abre ocupando a tela toda, sem bordas do Windows. Ideal para TV, sofá e Steam Deck.'
              : 'Desligada: o app abre numa janela comum.'}{' '}
            Aceite (A) ou aperte F11 para alternar.
          </Help>
        </>
      ),
    },
    {
      id: 'ptbr',
      group: 'Reprodução',
      icon: <Languages />,
      title: 'Priorizar dublado PT-BR',
      detail: 'Filtro inicial da lista de fontes',
      value: <Pill on={ptBrDefault}>{ptBrDefault ? 'LIGADO' : 'DESLIGADO'}</Pill>,
      activate: togglePtBr,
      panel: (
        <>
          <PanelTitle>Priorizar dublado PT-BR</PanelTitle>
          <Facts
            items={[
              ['Ao abrir fontes', ptBrDefault ? 'Só PT-BR / Dual' : 'Todas as fontes'],
              ['Detecta', '[DUBLADO], [DUAL], [PT-BR], MultiDub, 🇧🇷'],
            ]}
          />
          <Help>
            {ptBrDefault
              ? 'Ligado: a lista de fontes já abre filtrada em áudio português ou dual.'
              : 'Desligado: a lista abre com todas as resoluções e idiomas.'}{' '}
            Na tela de fontes, Y alterna o filtro a qualquer momento.
          </Help>
        </>
      ),
    },
    {
      id: 'sound',
      icon: <Volume2 />,
      title: 'Som de navegação',
      detail: 'Clique suave ao mover o foco',
      value: <Pill on={soundFeedback}>{soundFeedback ? 'LIGADO' : 'MUDO'}</Pill>,
      activate: toggleSound,
      panel: (
        <>
          <PanelTitle>Som de navegação</PanelTitle>
          <Help>
            {soundFeedback
              ? 'Ligado: cada troca de foco e seleção toca um clique curto e suave.'
              : 'Mudo: a navegação fica em silêncio.'}{' '}
            Não afeta o áudio dos vídeos.
          </Help>
        </>
      ),
    },
    {
      id: 'server',
      group: 'Sistema',
      icon: <Server />,
      title: 'Servidor de streaming',
      detail: 'Motor do Stremio na porta 11470',
      value: (
        <Pill on={serverStatus.isOnline}>
          {serverStatus.isOnline ? `ONLINE v${serverStatus.version || '?'}` : 'OFFLINE'}
        </Pill>
      ),
      activate: onCheckServer,
      panel: (
        <>
          <PanelTitle>Servidor de streaming</PanelTitle>
          <Facts
            items={[
              ['Estado', serverStatus.isOnline ? 'Online' : 'Offline / iniciando'],
              ['Versão', serverStatus.version || '—'],
              ['Endereço', serverStatus.baseUrl || 'http://127.0.0.1:11470'],
            ]}
          />
          <Help>
            O motor do Stremio roda em segundo plano: baixa torrents, converte vídeo e serve as legendas. Aceite (A)
            para verificar a conexão de novo.
          </Help>
        </>
      ),
    },
  ];

  const accountRows: RowDef[] = currentUser
    ? [
        {
          id: 'sync',
          group: 'Conta Stremio',
          icon: <RotateCcw className={syncingCloud ? 'animate-spin' : ''} />,
          title: 'Sincronizar nuvem',
          detail: currentUser.email,
          value: syncingCloud ? 'Sincronizando…' : 'Sincronizar',
          activate: syncCloud,
          panel: (
            <>
              <PanelTitle>Conta Stremio</PanelTitle>
              <Facts
                items={[
                  ['E-mail', currentUser.email],
                  ['Sessão', 'Ativa'],
                ]}
              />
              <Help>
                Busca de novo a biblioteca, o histórico de reprodução e os addons da sua conta no Stremio.
              </Help>
            </>
          ),
        },
        {
          id: 'logout',
          icon: <LogOut />,
          title: 'Desconectar',
          detail: 'Sai da conta neste aplicativo',
          value: armed === 'logout' ? 'CONFIRMAR' : 'Sair',
          danger: true,
          activate: () => {
            if (armed === 'logout') {
              setArmed(null);
              onLogout();
            } else {
              setArmed('logout');
            }
          },
          panel: (
            <>
              <PanelTitle>Desconectar</PanelTitle>
              <Help>
                Aceite (A) duas vezes para sair. A biblioteca e os addons da conta deixam de aparecer aqui, mas
                continuam salvos no Stremio. As extensões locais continuam instaladas.
              </Help>
            </>
          ),
        },
      ]
    : [
        {
          id: 'login',
          group: 'Conta Stremio',
          icon: <LogIn />,
          title: 'Conectar conta Stremio',
          detail: 'E-mail e senha ou AuthKey',
          value: 'Entrar',
          activate: onOpenLogin,
          panel: (
            <>
              <PanelTitle>Conectar conta Stremio</PanelTitle>
              <Facts items={[['Estado', 'Não conectado']]} />
              <Help>
                Conecte para trazer sua biblioteca, o histórico de “Continuar assistindo” e os addons instalados na
                sua conta. O login é feito direto com os servidores do Stremio.
              </Help>
            </>
          ),
        },
      ];

  const addonRows: RowDef[] = [
    {
      id: 'sync-addons',
      group: 'Gerenciar',
      icon: <RotateCcw className={syncingAddons ? 'animate-spin' : ''} />,
      title: 'Atualizar addons',
      detail: `${userAddons.length} ativos, ${localCount} locais`,
      value: syncingAddons ? 'Atualizando…' : 'Atualizar',
      activate: syncAddons,
      panel: (
        <>
          <PanelTitle>Atualizar addons</PanelTitle>
          <Facts
            items={[
              ['Da conta', userAddons.length - localCount],
              ['Locais', localCount],
            ]}
          />
          <Help>
            Relê os addons da conta Stremio e das extensões locais, e recarrega os catálogos da tela inicial.
          </Help>
        </>
      ),
    },
    {
      id: 'local-addons',
      icon: <Boxes />,
      title: 'Extensões locais',
      detail: 'Instalar de uma pasta, .zip ou repositório',
      value: 'Gerenciar',
      activate: () => onManageLocalAddons?.(),
      panel: (
        <>
          <PanelTitle>Extensões locais</PanelTitle>
          <Help>
            Addons que rodam neste computador, sem servidor. Instale a partir de uma pasta, de um arquivo .zip ou do
            link de um repositório do GitHub. Elas aparecem nas fontes e nos catálogos junto com os addons da conta.
          </Help>
          <Help>Extensões são código que roda no seu PC: instale só as que você confia.</Help>
        </>
      ),
    },
    ...userAddons.map((addon, idx): RowDef => {
      const manifest = addon.manifest;
      const resources = (manifest?.resources || []).map((r: any) => (typeof r === 'string' ? r : r?.name)).filter(Boolean);
      return {
        id: `addon:${idx}`,
        group: idx === 0 ? 'Instalados' : undefined,
        icon: <AddonIcon addon={addon} />,
        title: manifest?.name || 'Addon Stremio',
        detail: manifest?.description,
        value: (
          <span className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-zinc-400">v{manifest?.version || '1.0.0'}</span>
            <Pill on={!!addon.local}>{addon.local ? 'LOCAL' : 'CONTA'}</Pill>
          </span>
        ),
        activate: () => onOpenAddonOptions?.(addon),
        panel: (
          <>
            <PanelTitle>Addon</PanelTitle>
            <Preview className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl grid place-items-center bg-black/40 border border-white/10 p-1 text-zinc-300">
                <AddonIcon addon={addon} size="w-9 h-9" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-bold text-white truncate">{manifest?.name || 'Addon Stremio'}</div>
                <div className="text-[11px] font-mono text-zinc-400">v{manifest?.version || '1.0.0'}</div>
              </div>
            </Preview>
            {manifest?.description && <Help>{manifest.description}</Help>}
            <Facts
              items={[
                ['Origem', addon.local ? 'Extensão local' : 'Conta Stremio'],
                ['Tipos', (manifest?.types || []).join(', ') || '—'],
                ['Recursos', resources.join(', ') || '—'],
                ['Catálogos', manifest?.catalogs?.length || 0],
                ['Configurável', manifest?.behaviorHints?.configurable ? 'Sim' : 'Não'],
              ]}
            />
            <Help>Aceite (A) para configurar ou desinstalar.</Help>
          </>
        ),
      };
    }),
  ];

  const rows = tab === 'general' ? generalRows : tab === 'account' ? accountRows : addonRows;
  const current = Math.min(focus, rows.length - 1);
  const focusedRow = rows[current];

  const switchTab = (dir: -1 | 1) => {
    const index = SETTINGS_TABS.findIndex((t) => t.id === tab);
    setTab(SETTINGS_TABS[wrap(index + dir, SETTINGS_TABS.length)].id);
    setFocus(0);
    setArmed(null);
  };

  // Stable access for the gamepad listener
  const stateRef = useRef({ rows, current, armed, switchTab, onBackToHome });
  stateRef.current = { rows, current, armed, switchTab, onBackToHome };

  useEffect(() => {
    if (!isActive) return;
    const handle = (action: GamepadAction) => {
      const { rows: list, current: cur, armed: pending, switchTab: changeTab, onBackToHome: back } = stateRef.current;
      const row = list[cur];
      if (action !== 'ACTION_A') setArmed(null);

      switch (action) {
        case 'NAV_UP':
          setFocus(Math.max(0, cur - 1));
          break;
        case 'NAV_DOWN':
          setFocus(Math.min(list.length - 1, cur + 1));
          break;
        case 'NAV_LEFT':
          row?.shift?.(-1);
          break;
        case 'NAV_RIGHT':
          row?.shift?.(1);
          break;
        case 'ACTION_A':
          row?.activate?.();
          break;
        case 'TRIGGER_LT':
          changeTab(-1);
          break;
        case 'TRIGGER_RT':
          changeTab(1);
          break;
        case 'ACTION_B':
          if (!pending) back();
          break;
      }
    };
    return GamepadManager.subscribe(handle);
  }, [isActive]);

  // Keep the focused row in view inside the scrolling column
  useEffect(() => {
    rowRefs.current[current]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [current, tab]);

  return (
    <div className="flex-1 min-h-0 flex flex-col w-full max-w-7xl mx-auto pt-32 px-12 pb-24 select-none animate-fade-in">
      <div className="flex items-center justify-center gap-2.5 mb-5 flex-shrink-0" role="tablist" aria-label="Seções das configurações">
        <ControllerButtonBadge button="LT" size="sm" />
        {SETTINGS_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={item.id === tab}
            onClick={() => {
              setTab(item.id);
              setFocus(0);
              setArmed(null);
            }}
            className={`px-4 py-1.5 rounded-full border text-sm font-semibold cursor-pointer transition-colors ${
              item.id === tab ? 'text-white border-transparent' : 'text-zinc-400 border-white/15 hover:text-white'
            }`}
            style={item.id === tab ? { backgroundColor: 'var(--app-accent)' } : undefined}
          >
            {item.label}
          </button>
        ))}
        <ControllerButtonBadge button="RT" size="sm" />
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)_minmax(360px,34%)] gap-8">
        <div className="min-h-0 overflow-y-auto overflow-x-hidden no-scrollbar grid content-start gap-2 px-2 pt-1 pb-8 -mx-2">
          {rows.map((row, idx) => {
            const isFocused = idx === current;
            return (
              <React.Fragment key={row.id}>
                {row.group && (
                  <h2
                    className={`text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-400 mb-0.5 ${
                      idx === 0 ? 'mt-0' : 'mt-3.5'
                    }`}
                  >
                    {row.group}
                  </h2>
                )}
                <button
                  ref={(el) => {
                    rowRefs.current[idx] = el;
                  }}
                  type="button"
                  onClick={() => {
                    setFocus(idx);
                    if (row.id !== 'logout') setArmed(null);
                    row.activate?.();
                  }}
                  className={`grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-4 w-full min-h-[68px] py-2.5 pl-3.5 pr-[18px] rounded-[14px] border text-left cursor-pointer transition-all app-card-item ${
                    isFocused ? 'is-focused border-transparent' : 'border-white/10'
                  }`}
                  style={
                    isFocused
                      ? { boxShadow: 'inset 0 0 0 3px #ffffff, 0 0 22px var(--app-accent-glow)' }
                      : undefined
                  }
                >
                  <span
                    className={`grid place-items-center w-11 h-11 rounded-xl [&>svg]:w-[22px] [&>svg]:h-[22px] ${
                      isFocused ? 'bg-white/10 text-white' : 'bg-white/5 text-zinc-400'
                    }`}
                  >
                    {row.icon}
                  </span>
                  <span className="grid gap-0.5 min-w-0">
                    <strong className="text-[17px] font-semibold text-white truncate">{row.title}</strong>
                    {row.detail && <small className="text-xs text-zinc-400 truncate">{row.detail}</small>}
                  </span>
                  <span
                    className={`flex items-center gap-2 text-base font-semibold whitespace-nowrap ${
                      row.danger ? 'text-rose-300' : 'text-white'
                    }`}
                  >
                    {row.choice && (
                      <ChevronLeft
                        className={`w-4 h-4 ${isFocused ? 'text-white' : 'text-zinc-500'}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setFocus(idx);
                          row.shift?.(-1);
                        }}
                      />
                    )}
                    <span>{row.value}</span>
                    {row.choice && (
                      <ChevronRight
                        className={`w-4 h-4 ${isFocused ? 'text-white' : 'text-zinc-500'}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setFocus(idx);
                          row.shift?.(1);
                        }}
                      />
                    )}
                  </span>
                </button>
              </React.Fragment>
            );
          })}
          {tab === 'addons' && userAddons.length === 0 && (
            <div className="rounded-[14px] border border-white/10 bg-black/20 p-5 text-center text-xs text-zinc-400">
              Nenhum addon ainda. Conecte a conta Stremio ou instale uma extensão local.
            </div>
          )}
        </div>

        <aside
          className="min-h-0 mb-4 overflow-y-auto no-scrollbar rounded-[18px] border border-white/10 app-card-panel"
          aria-live="polite"
        >
          <div key={`${tab}:${focusedRow?.id}`} className="grid content-start gap-4 p-6 animate-fade-in">
            {focusedRow?.panel}
          </div>
        </aside>
      </div>
    </div>
  );
};
