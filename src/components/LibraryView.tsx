import React, { useState, useEffect, useRef } from 'react';
import type { StremioLibraryItem, StremioUser } from '../types/account';
import { AccountService } from '../services/account';
import { ControllerButtonBadge } from './ControllerButtonBadge';
import { LiquidGlassRail } from './LiquidGlassRail';
import { GamepadManager, type GamepadAction } from '../services/gamepad';
import { SoundService } from '../services/sound';
import { ThemeService } from '../services/theme';
import type { ThemeId } from '../types/theme';
import {
  Bookmark,
  Play,
  RotateCcw,
  Film,
  Tv,
  LogIn,
  LogOut,
  UserCheck,
  Star,
  CheckCircle2,
  Clock,
  Sparkles,
} from 'lucide-react';
import type { StremioMetaPreview } from '../types/stremio';
import { FALLBACK_POSTER } from '../utils/posterFallback';

interface Props {
  isActive?: boolean;
  user?: StremioUser | null;
  onSelectItem: (item: StremioMetaPreview) => void;
  onOpenLogin: () => void;
  onBackToHome?: () => void;
}

export type LibraryFilter = 'all' | 'unwatched' | 'watching' | 'movies' | 'series';

const FILTER_TABS: { id: LibraryFilter; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'unwatched', label: 'Não Vistos' },
  { id: 'watching', label: 'Continuar Assistindo' },
  { id: 'movies', label: 'Filmes' },
  { id: 'series', label: 'Séries' },
];

export const LibraryView: React.FC<Props> = ({
  isActive = true,
  user: propUser,
  onSelectItem,
  onOpenLogin,
  onBackToHome,
}) => {
  const [library, setLibrary] = useState<StremioLibraryItem[]>([]);
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [user, setUser] = useState(propUser || AccountService.getUser());
  const [lastSyncStr, setLastSyncStr] = useState(AccountService.getLastSyncDisplay());
  const [currentTheme, setCurrentTheme] = useState<ThemeId>(() => ThemeService.getTheme());

  useEffect(() => {
    return ThemeService.subscribe(setCurrentTheme);
  }, []);

  const isPs1 = currentTheme === 'ps1';

  // Gamepad navigation zones: 'filters' | 'grid'
  const [navZone, setNavZone] = useState<'filters' | 'grid'>('grid');
  const [focusedFilterIdx, setFocusedFilterIdx] = useState(0);
  const [focusedGridIdx, setFocusedGridIdx] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const gridItemRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Fetch library
  const fetchLibrary = async (forceRefresh: boolean = false) => {
    if (forceRefresh) setSyncing(true);
    else setLoading(true);

    setUser(AccountService.getUser());
    const items = await AccountService.getLibrary(forceRefresh);
    setLibrary(items);
    setLastSyncStr(AccountService.getLastSyncDisplay());

    setLoading(false);
    setSyncing(false);
  };

  useEffect(() => {
    setUser(propUser || AccountService.getUser());
    fetchLibrary();
  }, [propUser]);

  // Subscribe to account changes
  useEffect(() => {
    const unsub = AccountService.subscribe(() => {
      fetchLibrary(true);
    });
    return () => unsub();
  }, []);

  const handleLogout = () => {
    AccountService.logout();
    setUser(null);
    fetchLibrary();
  };

  // Filtered items
  const filteredItems = library.filter((item) => {
    if (filter === 'movies') return item.type === 'movie';
    if (filter === 'series') return item.type === 'series';
    if (filter === 'watching') {
      const offset = item.state?.timeOffset || 0;
      const dur = item.state?.duration || 1;
      return offset > 0 && offset < dur * 0.95;
    }
    if (filter === 'unwatched') {
      const offset = item.state?.timeOffset || 0;
      const timesWatched = item.state?.timesWatched || 0;
      return offset === 0 && timesWatched === 0;
    }
    return true;
  });

  // Calculate live dynamic columns from rendered grid items
  const getGridColumnCount = (): number => {
    if (gridItemRefs.current.length < 2) return 1;
    const first = gridItemRefs.current[0];
    if (!first) return 6;
    const firstTop = first.offsetTop;
    let count = 0;
    for (let i = 0; i < gridItemRefs.current.length; i++) {
      const el = gridItemRefs.current[i];
      if (el && Math.abs(el.offsetTop - firstTop) < 15) {
        count++;
      } else {
        break;
      }
    }
    return Math.max(1, count);
  };

  // Keep state refs for gamepad callback
  const stateRef = useRef({
    navZone,
    focusedFilterIdx,
    focusedGridIdx,
    filteredItems,
    filter,
    isActive,
  });

  stateRef.current = {
    navZone,
    focusedFilterIdx,
    focusedGridIdx,
    filteredItems,
    filter,
    isActive,
  };

  // Gamepad listener inside LibraryView
  useEffect(() => {
    if (!isActive) return;

    const handleGamepadAction = (action: GamepadAction) => {
      const {
        navZone: curZone,
        focusedFilterIdx: fIdx,
        focusedGridIdx: gIdx,
        filteredItems: items,
        filter: curFilter,
      } = stateRef.current;

      // Quick filter cycle using Triggers LT / RT
      if (action === 'TRIGGER_LT') {
        const curIdx = FILTER_TABS.findIndex((t) => t.id === curFilter);
        const nextIdx = (curIdx - 1 + FILTER_TABS.length) % FILTER_TABS.length;
        SoundService.playTabSwitch();
        setFilter(FILTER_TABS[nextIdx].id);
        setFocusedGridIdx(0);
        return;
      }
      if (action === 'TRIGGER_RT') {
        const curIdx = FILTER_TABS.findIndex((t) => t.id === curFilter);
        const nextIdx = (curIdx + 1) % FILTER_TABS.length;
        SoundService.playTabSwitch();
        setFilter(FILTER_TABS[nextIdx].id);
        setFocusedGridIdx(0);
        return;
      }

      if (curZone === 'filters') {
        switch (action) {
          case 'NAV_LEFT':
            setFocusedFilterIdx((prev) => Math.max(0, prev - 1));
            break;
          case 'NAV_RIGHT':
            setFocusedFilterIdx((prev) => Math.min(FILTER_TABS.length - 1, prev + 1));
            break;
          case 'NAV_DOWN':
            if (items.length > 0) {
              setNavZone('grid');
              setFocusedGridIdx(0);
            }
            break;
          case 'ACTION_A': {
            const selected = FILTER_TABS[fIdx];
            if (selected) {
              if (curFilter !== selected.id) {
                SoundService.playTabSwitch();
              }
              setFilter(selected.id);
              setFocusedGridIdx(0);
              setNavZone('grid');
            }
            break;
          }
          case 'ACTION_B':
            if (onBackToHome) onBackToHome();
            break;
        }
      } else {
        // In Grid Zone
        const cols = getGridColumnCount();

        switch (action) {
          case 'NAV_LEFT':
            setFocusedGridIdx((prev) => Math.max(0, prev - 1));
            break;

          case 'NAV_RIGHT':
            setFocusedGridIdx((prev) => Math.min(items.length - 1, prev + 1));
            break;

          case 'NAV_UP':
            if (gIdx < cols) {
              // Jump up to filter tabs
              setNavZone('filters');
              const ratio = gIdx / Math.max(1, cols);
              setFocusedFilterIdx(
                Math.min(FILTER_TABS.length - 1, Math.floor(ratio * FILTER_TABS.length))
              );
            } else {
              setFocusedGridIdx((prev) => Math.max(0, prev - cols));
            }
            break;

          case 'NAV_DOWN':
            if (gIdx + cols < items.length) {
              setFocusedGridIdx((prev) => prev + cols);
            } else if (gIdx < items.length - 1) {
              // Clamp to last item
              setFocusedGridIdx(items.length - 1);
            }
            break;

          case 'ACTION_A': {
            const target = items[gIdx];
            if (target) {
              const metaPreview: StremioMetaPreview = {
                id: target._id,
                name: target.name,
                type: target.type,
                poster: target.poster,
                year: target.year,
                imdbRating: target.imdbRating,
                genres: target.genres,
              };
              onSelectItem(metaPreview);
            }
            break;
          }

          case 'ACTION_X': {
            const target = items[gIdx];
            if (target) {
              const metaPreview: StremioMetaPreview = {
                id: target._id,
                name: target.name,
                type: target.type,
                poster: target.poster,
                year: target.year,
                imdbRating: target.imdbRating,
                genres: target.genres,
              };
              GamepadManager.pulseHaptic(60, 0.45, 0.45);
              AccountService.toggleLibraryItem(metaPreview).then(() => {
                fetchLibrary(false);
              });
            }
            break;
          }

          case 'ACTION_B':
            setNavZone('filters');
            break;
        }
      }
    };

    const unsubscribe = GamepadManager.subscribe(handleGamepadAction);
    return () => unsubscribe();
  }, [isActive, onBackToHome, onSelectItem]);

  // Smooth container scrolling that never jitters or cuts off cards
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    if (navZone === 'filters') {
      container.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      const el = gridItemRefs.current[focusedGridIdx];
      if (el) {
        const elTop = el.offsetTop - container.offsetTop;
        const elBottom = elTop + el.offsetHeight;
        const viewTop = container.scrollTop;
        const viewBottom = viewTop + container.clientHeight;

        if (elTop < viewTop + 140) {
          container.scrollTo({ top: Math.max(0, elTop - 140), behavior: 'smooth' });
        } else if (elBottom > viewBottom - 100) {
          container.scrollTo({
            top: elBottom - container.clientHeight + 100,
            behavior: 'smooth',
          });
        }
      }
    }
  }, [focusedGridIdx, navZone]);

  const watchingCount = library.filter(
    (i) => (i.state?.timeOffset || 0) > 0 && (i.state?.timeOffset || 0) < (i.state?.duration || 1) * 0.95
  ).length;

  const unwatchedCount = library.filter(
    (i) => (i.state?.timeOffset || 0) === 0 && (i.state?.timesWatched || 0) === 0
  ).length;

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto pt-28 px-12 pb-24 select-none animate-fade-in no-scrollbar"
    >
      {/* Top Header & Account Status */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8 border-b border-white/10 pb-6">
        <div>
          <div className="flex items-center gap-3 mb-1.5">
            <div
              className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg"
              style={{
                backgroundColor: 'var(--app-accent)',
                boxShadow: '0 4px 18px var(--app-accent-glow)',
              }}
            >
              <Bookmark className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-3xl font-black text-white tracking-tight uppercase">
              Minha Biblioteca
            </h1>
          </div>
          <p className="text-xs text-zinc-400">
            {user
              ? `Conectado como ${user.email} • ${lastSyncStr}`
              : 'Biblioteca local • Conecte sua conta Stremio para sincronizar nuvem, histórico e addons'}
          </p>
        </div>

        {/* Account & Sync Controls */}
        <div className="flex items-center gap-3">
          {user ? (
            <div
              className={`flex items-center gap-3 rounded-2xl p-2 pl-4 transition-all ${
                isPs1
                  ? 'bg-white/15 border-2 border-white backdrop-blur-xl shadow-lg'
                  : 'bg-white/5 border border-white/10'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs text-white"
                  style={{ backgroundColor: 'var(--app-accent)' }}
                >
                  <UserCheck className="w-4 h-4" />
                </div>
                <div className="text-left mr-2">
                  <div className="text-xs font-bold text-white max-w-[150px] truncate">
                    {user.email.split('@')[0]}
                  </div>
                  <div className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="w-2.5 h-2.5" />
                    Nuvem Conectada
                  </div>
                </div>
              </div>

              {/* Sync Button */}
              <button
                onClick={() => fetchLibrary(true)}
                disabled={syncing}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-white rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  isPs1
                    ? 'bg-white/15 hover:bg-white/25 border-2 border-white'
                    : 'bg-white/10 hover:bg-white/20 border border-white/10'
                }`}
                title="Sincronizar com a Nuvem Stremio"
              >
                <RotateCcw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                <span>{syncing ? 'Sincronizando...' : 'Sincronizar'}</span>
              </button>

              {/* Logout Button */}
              <button
                onClick={handleLogout}
                className="p-1.5 text-zinc-400 hover:text-rose-400 rounded-xl hover:bg-rose-500/10 transition-colors cursor-pointer"
                title="Desconectar conta"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={onOpenLogin}
              style={{
                backgroundColor: 'var(--app-accent)',
                boxShadow: isPs1
                  ? '0 4px 20px rgba(0,0,0,0.35), 0 0 16px rgba(255,255,255,0.35)'
                  : '0 4px 18px var(--app-accent-glow)',
              }}
              className={`flex items-center gap-2.5 text-white font-bold text-xs px-5 py-3 rounded-2xl transition-transform hover:scale-105 cursor-pointer shadow-xl ${
                isPs1 ? 'border-2 border-white/30' : ''
              }`}
            >
              <LogIn className="w-4 h-4" />
              <span>Conectar Conta Stremio</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter Tabs & Quick Controller Switcher */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div className="liquid-glass-rail relative isolate flex items-center gap-2.5">
          <LiquidGlassRail selected={filter} />
          {FILTER_TABS.map((tab, idx) => {
            const isTabActive = filter === tab.id;
            const isFocused = navZone === 'filters' && focusedFilterIdx === idx;
            const count =
              tab.id === 'all'
                ? library.length
                : tab.id === 'unwatched'
                ? unwatchedCount
                : tab.id === 'watching'
                ? watchingCount
                : library.filter((i) => i.type === tab.id).length;

            return (
              <button
                key={tab.id}
                data-glass-tab={tab.id}
                data-glass-active={isTabActive}
                onClick={() => {
                  if (filter !== tab.id) {
                    SoundService.playTabSwitch();
                  }
                  setFilter(tab.id);
                  setFocusedFilterIdx(idx);
                  setFocusedGridIdx(0);
                  setNavZone('grid');
                }}
                onMouseEnter={() => {
                  setFocusedFilterIdx(idx);
                }}
                style={
                  isTabActive
                    ? {
                        backgroundColor: 'var(--app-accent)',
                        border: isPs1 ? '2px solid rgba(255, 255, 255, 0.35)' : undefined,
                        boxShadow: isPs1
                          ? '0 2px 16px rgba(0, 114, 206, 0.4), 0 0 12px rgba(255, 255, 255, 0.2)'
                          : '0 2px 14px var(--app-accent-glow)',
                      }
                    : isPs1
                    ? {
                        border: '2px solid rgba(255, 255, 255, 0.2)',
                      }
                    : undefined
                }
                className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
                  isTabActive
                    ? 'text-white'
                    : isPs1
                    ? 'bg-white/10 text-white hover:bg-white/20 hover:border-white/40'
                    : 'bg-white/5 border border-white/10 text-zinc-400 hover:text-white'
                } ${isFocused ? 'ring-4 ring-white scale-105 z-10' : ''}`}
              >
                <span>{tab.label}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-black/40 font-mono text-zinc-300">
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Gamepad Trigger cycle hint */}
        <div
          className={`hidden md:flex items-center gap-2 text-xs px-3 py-1.5 rounded-xl backdrop-blur-md ${
            isPs1
              ? 'bg-white/15 border-2 border-white text-white shadow-md'
              : 'text-zinc-400 bg-white/5 border border-white/10'
          }`}
        >
          <ControllerButtonBadge button="LT" currentTheme={currentTheme} />
          <ControllerButtonBadge button="RT" currentTheme={currentTheme} />
          <span className="text-[11px] font-bold">Trocar Categoria</span>
        </div>
      </div>

      {/* Library Grid */}
      {loading ? (
        <div className="py-24 text-center text-zinc-400 text-sm font-semibold flex flex-col items-center gap-3">
          <Sparkles className="w-6 h-6 animate-spin" style={{ color: 'var(--app-accent)' }} />
          <span>Carregando sua biblioteca...</span>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="py-24 text-center text-zinc-400 text-sm bg-white/5 border border-white/10 rounded-3xl p-8 max-w-xl mx-auto flex flex-col items-center gap-4">
          <Bookmark className="w-10 h-10 text-zinc-600" />
          <div>
            <div className="font-bold text-base text-white mb-1">Nenhum título encontrado</div>
            <p className="text-xs text-zinc-400">
              {filter === 'watching'
                ? 'Você não possui nenhum título em andamento no momento.'
                : 'Esta categoria da sua biblioteca está vazia.'}
            </p>
          </div>
          {!user && (
            <button
              onClick={onOpenLogin}
              style={{ backgroundColor: 'var(--app-accent)' }}
              className="mt-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white hover:scale-105 transition-transform cursor-pointer"
            >
              Conectar Conta para Sincronizar
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
          {filteredItems.map((item, idx) => {
            const isFocused = navZone === 'grid' && focusedGridIdx === idx;
            const progress =
              item.state?.duration && item.state.timeOffset
                ? Math.min(100, Math.floor((item.state.timeOffset / item.state.duration) * 100))
                : 0;

            const remainingMinutes =
              item.state?.duration && item.state.timeOffset
                ? Math.max(1, Math.round((item.state.duration - item.state.timeOffset) / 60))
                : null;

            const metaPreview: StremioMetaPreview = {
              id: item._id,
              name: item.name,
              type: item.type,
              poster: item.poster,
              year: item.year,
              imdbRating: item.imdbRating,
              genres: item.genres,
            };

            return (
              <div
                key={item._id}
                ref={(el) => {
                  gridItemRefs.current[idx] = el;
                }}
                onClick={() => onSelectItem(metaPreview)}
                onMouseEnter={() => {
                  setNavZone('grid');
                  setFocusedGridIdx(idx);
                }}
                className={`group relative aspect-[2/3] rounded-2xl overflow-hidden cursor-pointer transition-all duration-200 select-none ${
                  isFocused
                    ? 'ring-4 ring-white shadow-2xl scale-105 z-20'
                    : 'border border-white/10 hover:border-white/30 opacity-90'
                }`}
                style={
                  isFocused
                    ? {
                        boxShadow: '0 0 28px var(--app-accent-glow), 0 0 0 3px #ffffff',
                      }
                    : undefined
                }
              >
                {/* Poster Image */}
                <img
                  src={item.poster || (item._id?.startsWith('tt') ? `https://images.metahub.space/poster/medium/${item._id}/img` : FALLBACK_POSTER)}
                  alt={item.name}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    if (target.src !== FALLBACK_POSTER) {
                      target.src = FALLBACK_POSTER;
                    }
                  }}
                  className="w-full h-full object-cover"
                />

                {/* Gradient Shadows */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/30 to-black/20" />

                {/* Rating Badge */}
                {item.imdbRating && (
                  <div className="absolute top-2.5 right-2.5 flex items-center gap-1 bg-black/80 backdrop-blur-md px-2 py-0.5 rounded-md text-[10px] font-bold text-amber-300 border border-white/10">
                    <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                    <span>{item.imdbRating}</span>
                  </div>
                )}

                {/* Series Episode Badge */}
                {item.state?.video_id && (
                  <div className="absolute top-2.5 left-2.5 bg-black/80 backdrop-blur-md px-2 py-0.5 rounded-md text-[10px] font-semibold text-zinc-300 border border-white/10">
                    {item.state.video_id}
                  </div>
                )}

                {/* Progress Bar & Remaining Time */}
                {progress > 0 && (
                  <div className="media-card-progress absolute bottom-12 left-3 right-3">
                    <div className="w-full h-1.5 bg-black/60 rounded-full overflow-hidden border border-white/15">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${progress}%`,
                          backgroundColor: 'var(--app-accent)',
                        }}
                      />
                    </div>
                    {remainingMinutes && (
                      <div className="text-[9px] text-zinc-400 mt-1 flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5 text-zinc-400" />
                        <span>Faltam {remainingMinutes} min</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Bottom Title & Type */}
                <div className="media-card-info absolute bottom-0 left-0 right-0 p-3">
                  <div className="text-white text-xs font-bold truncate drop-shadow">
                    {item.name}
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-zinc-400 mt-0.5">
                    <span>{item.year || (item.type === 'movie' ? 'Filme' : 'Série')}</span>
                    {progress > 0 ? (
                      <span className="text-emerald-400 font-semibold">{progress}%</span>
                    ) : (
                      <span>
                        {item.type === 'movie' ? (
                          <Film className="w-3 h-3 inline" />
                        ) : (
                          <Tv className="w-3 h-3 inline" />
                        )}
                      </span>
                    )}
                  </div>
                </div>

                {/* Focus Active Play Glyph */}
                {isFocused && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div
                      className="w-12 h-12 rounded-full flex items-center justify-center text-white shadow-2xl scale-95 animate-pulse"
                      style={{
                        backgroundColor: 'var(--app-accent)',
                        boxShadow: '0 0 20px var(--app-accent-glow)',
                      }}
                    >
                      <Play className="w-6 h-6 fill-white ml-0.5" />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
