import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import type { StremioMetaPreview, StremioStream, ServerStatus } from './types/stremio';
import { StremioService } from './services/stremio';
import { GamepadManager, type GamepadAction, type ControllerType } from './services/gamepad';
import { ThemeService } from './services/theme';
import type { ThemeId } from './types/theme';
import { XboxHeader, TABS, type NavTab } from './components/XboxHeader';
import { XboxFooterHints, type HintAction } from './components/XboxFooterHints';
import { BookmarkCheck, BookmarkMinus } from 'lucide-react';
import { HeroSpotlight } from './components/HeroSpotlight';
import { MediaCarousel } from './components/MediaCarousel';
import { MediaDetailModal } from './components/MediaDetailModal';
import { VideoPlayer } from './components/VideoPlayer';
import { SearchModal } from './components/SearchModal';
import { LibraryView } from './components/LibraryView';
import { LoginModal } from './components/LoginModal';
import { SettingsView } from './components/SettingsView';
import { AccountService } from './services/account';
import { SettingsService, applyFullscreen } from './services/settings';
import { SoundService } from './services/sound';
import { subscribeDualSenseTouchpad } from './services/dualsenseTouchpad';
import type { StremioAddon } from './types/account';

interface CatalogRow {
  id: string;
  title: string;
  items: StremioMetaPreview[];
}

export default function App() {
  // Navigation & Tabs
  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [serverStatus, setServerStatus] = useState<ServerStatus>({
    isOnline: false,
    baseUrl: 'http://127.0.0.1:11470',
  });

  // Gamepad & Controller Type
  const [isGamepadActive, setIsGamepadActive] = useState(false);
  const [controllerName, setControllerName] = useState('');
  const [forcedControllerType, setForcedControllerType] = useState<'auto' | ControllerType>('auto');

  // Theme State
  const [currentTheme, setCurrentTheme] = useState<ThemeId>('stremio');

  // Catalog State
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Focus Navigation State
  const [activeRowIndex, setActiveRowIndex] = useState(0);
  const [activeColIndex, setActiveColIndex] = useState(0);
  const [rowColMemory, setRowColMemory] = useState<{ [rowId: string]: number }>({});

  // Modals & Overlays
  const [selectedMeta, setSelectedMeta] = useState<StremioMetaPreview | null>(null);
  const [modalFocusRow, setModalFocusRow] = useState(0);
  const [modalFocusCol, setModalFocusCol] = useState(0);

  const [playingStream, setPlayingStream] = useState<StremioStream | null>(null);
  const [playingMeta, setPlayingMeta] = useState<StremioMetaPreview | null>(null);
  const [playingStreams, setPlayingStreams] = useState<StremioStream[]>([]);
  const [playingStreamId, setPlayingStreamId] = useState<string | null>(null);
  const handleEpisodeChange = useCallback((stream: StremioStream, id: string, streams: StremioStream[]) => {
    setPlayingStream(stream); setPlayingStreamId(id); setPlayingStreams(streams);
  }, []);

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState(AccountService.getUser());
  const [userAddons, setUserAddons] = useState<StremioAddon[]>(AccountService.getUserAddons());

  // Settings custom state
  const [customServerUrl] = useState('http://127.0.0.1:11470');

  // Toast Notification HUD
  const [toast, setToast] = useState<{ message: string; type: 'add' | 'remove' } | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (message: string, type: 'add' | 'remove') => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast({ message, type });
    toastTimeoutRef.current = setTimeout(() => {
      setToast(null);
    }, 2400);
  };

  const handleToggleLibrary = async (item: StremioMetaPreview) => {
    try {
      GamepadManager.pulseHaptic(60, 0.45, 0.45);
      const added = await AccountService.toggleLibraryItem(item);
      if (added) {
        showToast(`"${item.name}" adicionado à sua Biblioteca`, 'add');
      } else {
        showToast(`"${item.name}" removido da sua Biblioteca`, 'remove');
      }
      return added;
    } catch (err) {
      console.error('Erro ao alternar biblioteca:', err);
    }
  };

  // Refs for stable access inside gamepad callback
  const stateRef = useRef({
    activeTab,
    selectedMeta,
    modalFocusRow,
    modalFocusCol,
    playingStream,
    isSearchOpen,
    isLoginModalOpen,
    activeRowIndex,
    activeColIndex,
    rowColMemory,
  });

  stateRef.current = {
    activeTab,
    selectedMeta,
    modalFocusRow,
    modalFocusCol,
    playingStream,
    isSearchOpen,
    isLoginModalOpen,
    activeRowIndex,
    activeColIndex,
    rowColMemory,
  };

  // Guard against concurrent duplicate catalog fetches
  const isCatalogLoadingRef = useRef(false);

  // Initialize Theme, Account, Gamepad Manager, Settings and check Server
  useEffect(() => {
    ThemeService.init();
    setCurrentTheme(ThemeService.getTheme());

    AccountService.init();
    setCurrentUser(AccountService.getUser());

    SettingsService.init();
    const shouldFullscreen = SettingsService.isFullscreenDefault();
    applyFullscreen(shouldFullscreen);

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F11') {
        e.preventDefault();
        const next = !SettingsService.isFullscreenDefault();
        SettingsService.setFullscreenDefault(next);
        applyFullscreen(next);
        showToast(
          next ? 'Modo Tela Cheia Ativado' : 'Modo Janela Ativado',
          next ? 'add' : 'remove'
        );
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);

    GamepadManager.init();
    const stopDualSense = subscribeDualSenseTouchpad(() => {}, (pad) => GamepadManager.setHidGamepad(pad, true));
    setForcedControllerType(GamepadManager.forcedType);

    const unsubController = GamepadManager.subscribeControllerType((_type, name) => {
      setControllerName(name);
      setIsGamepadActive(GamepadManager.isConnected);
    });

    const checkEngine = async () => {
      const status = await StremioService.checkServer();
      setServerStatus(status);
    };
    checkEngine();
    const serverInterval = setInterval(checkEngine, 15000);

    const unsubAccount = AccountService.subscribe((user) => {
      setCurrentUser(user);
    });

    // Initial Catalog Load
    loadCatalogs();

    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
      stopDualSense();
      unsubController();
      unsubAccount();
      clearInterval(serverInterval);
    };
  }, []);

  const handleThemeChange = (id: ThemeId) => {
    ThemeService.setTheme(id);
    setCurrentTheme(id);
  };

  const handleControllerTypeChange = (type: 'auto' | ControllerType) => {
    GamepadManager.setForcedType(type);
    setForcedControllerType(type);
  };

  const loadCatalogs = async (forceRefresh: boolean = false) => {
    if (isCatalogLoadingRef.current) return;
    isCatalogLoadingRef.current = true;
    setLoading(true);

    try {
      const isLogged = AccountService.isLoggedIn();
      const initialRows: CatalogRow[] = [];

      // 1. Fetch User Library (from cloud datastore if logged in, or cached)
      const libraryItems = await AccountService.getLibrary(forceRefresh);

      // 1a. Continue Watching Row (items with progress)
      const watchingItems = libraryItems
        .filter((item) => {
          const offset = item.state?.timeOffset || 0;
          const dur = item.state?.duration || 1;
          return offset > 0 && offset < dur * 0.95;
        })
        .map((item): StremioMetaPreview => {
          const progress =
            item.state?.duration && item.state.timeOffset
              ? Math.min(100, Math.floor((item.state.timeOffset / item.state.duration) * 100))
              : 0;
          const remainingMinutes =
            item.state?.duration && item.state.timeOffset
              ? Math.max(1, Math.round((item.state.duration - item.state.timeOffset) / 60))
              : undefined;
          return {
            id: item._id,
            name: item.name,
            type: item.type,
            poster: item.poster || `https://images.metahub.space/poster/medium/${item._id}/img`,
            background: item.background || `https://images.metahub.space/background/medium/${item._id}/img`,
            year: item.year,
            imdbRating: item.imdbRating,
            genres: item.genres,
            progress,
            remainingMinutes,
            state: item.state,
          };
        });

      if (watchingItems.length > 0) {
        initialRows.push({
          id: 'continue-watching',
          title: '▶ Continuar Assistindo',
          items: watchingItems,
        });
      }

      // 1b. My Library Row (Apenas os Não Vistos)
      const unwatchedLibraryMetas = libraryItems
        .filter((item) => {
          const offset = item.state?.timeOffset || 0;
          const timesWatched = item.state?.timesWatched || 0;
          return offset === 0 && timesWatched === 0;
        })
        .map((item): StremioMetaPreview => ({
          id: item._id,
          name: item.name,
          type: item.type,
          poster: item.poster || `https://images.metahub.space/poster/medium/${item._id}/img`,
          background: item.background || `https://images.metahub.space/background/medium/${item._id}/img`,
          year: item.year,
          imdbRating: item.imdbRating,
          genres: item.genres,
        }));

      if (unwatchedLibraryMetas.length > 0) {
        initialRows.push({
          id: 'my-library-row',
          title: '⭐ Minha Biblioteca (Não Vistos)',
          items: unwatchedLibraryMetas,
        });
      }

      // 2. Fetch Cinemeta Popular Rows immediately so UI renders in < 300ms
      const [popularMovies, popularSeries, topMovies] = await Promise.all([
        StremioService.getCatalog('movie', undefined, 0),
        StremioService.getCatalog('series', undefined, 0),
        StremioService.getCatalog('movie', 'Top', 0),
      ]);

      if (popularMovies && popularMovies.length > 0) {
        initialRows.push({ id: 'popular-movies', title: 'Filmes em Destaque', items: popularMovies });
      }
      if (popularSeries && popularSeries.length > 0) {
        initialRows.push({ id: 'popular-series', title: 'Séries Populares', items: popularSeries });
      }
      if (topMovies && topMovies.length > 0) {
        initialRows.push({ id: 'top-movies', title: 'Mais Bem Avaliados', items: topMovies });
      }

      // Render initial rows immediately without blocking!
      setRows(initialRows);
      setLoading(false);

      // 3. In background: Fetch user-installed addons catalogs (ONLY movie / series)
      let addons = isLogged ? AccountService.getUserAddons() : [];
      if (addons.length === 0) {
        addons = await AccountService.syncAddons();
      }
      setUserAddons(addons);

      for (const addon of addons) {
        const catalogs = addon.manifest?.catalogs || [];
        for (const cat of catalogs) {
          // Strictly only movie/series. Ignore 'other' and catalogs requiring search terms
          if (cat.type !== 'movie' && cat.type !== 'series') continue;
          if (cat.extraRequired && cat.extraRequired.length > 0) continue;

          // Asynchronous non-blocking fetch
          StremioService.getAddonCatalog(addon.transportUrl, cat.type, cat.id)
            .then((items) => {
              if (items && items.length > 0) {
                const typeLabel = cat.type === 'movie' ? 'Filmes' : 'Séries';
                const title = cat.name ? `${cat.name} (${typeLabel})` : `${addon.manifest.name} - ${typeLabel}`;
                const rowId = `${addon.manifest.id || 'addon'}-${cat.type}-${cat.id}`;
                setRows((prev) => {
                  if (prev.some((r) => r.id === rowId)) return prev;
                  return [...prev, { id: rowId, title, items }];
                });
              }
            })
            .catch(() => {});
        }
      }
    } catch (e) {
      console.error('Error loading catalogs:', e);
    } finally {
      isCatalogLoadingRef.current = false;
      setLoading(false);
    }
  };

  // Filtered rows depending on active tab
  const visibleRows = useMemo(() => {
    if (activeTab === 'movies') {
      return rows
        .map((r) => {
          if (r.id === 'continue-watching') {
            const movieItems = r.items.filter((item) => item.type === 'movie');
            if (movieItems.length === 0) return null;
            return { ...r, items: movieItems };
          }
          return r;
        })
        .filter((r): r is CatalogRow => Boolean(r))
        .filter(
          (r) =>
            r.id === 'continue-watching' ||
            r.id.includes('movie') ||
            r.title.toLowerCase().includes('filme')
        );
    }

    if (activeTab === 'series') {
      return rows
        .map((r) => {
          if (r.id === 'continue-watching') {
            const seriesItems = r.items.filter((item) => item.type === 'series');
            if (seriesItems.length === 0) return null;
            return { ...r, items: seriesItems };
          }
          return r;
        })
        .filter((r): r is CatalogRow => Boolean(r))
        .filter(
          (r) =>
            r.id === 'continue-watching' ||
            r.id.includes('series') ||
            r.title.toLowerCase().includes('série')
        );
    }

    // activeTab === 'home' -> mostra todas as fileiras e o Continuar Assistindo sem restrições
    return rows;
  }, [rows, activeTab]);

  // Current focused item for the Hero Spotlight
  const currentFocusedItem = useMemo(() => {
    if (visibleRows.length === 0) return null;
    const r = visibleRows[activeRowIndex] || visibleRows[0];
    if (!r || !r.items || r.items.length === 0) return null;
    return r.items[activeColIndex] || r.items[0];
  }, [visibleRows, activeRowIndex, activeColIndex]);

  // Central Gamepad Action Dispatcher
  useEffect(() => {
    const handleGamepadAction = (action: GamepadAction) => {
      const {
        activeTab: curTab,
        selectedMeta: curModal,
        playingStream: curPlayer,
        isSearchOpen: curSearch,
        isLoginModalOpen: curLogin,
        activeRowIndex: rIdx,
        activeColIndex: cIdx,
      } = stateRef.current;

      // 1. If Video Player is active, player handles its own actions
      if (curPlayer) return;

      // 2. Modals Dismiss on B
      if (curLogin) {
        if (action === 'ACTION_B') {
          setIsLoginModalOpen(false);
        }
        return;
      }

      // 2. Search Modal Navigation (handled directly by SearchModal)
      if (curSearch) {
        return;
      }

      // 3. Detail Screen Navigation (handled by MediaDetailModal full-screen blade)
      if (curModal) {
        return;
      }

      // 4. Tab Navigation (LB / RB / L1 / R1)
      if (action === 'TRIGGER_LB') {
        const curIdx = TABS.findIndex((t) => t.id === curTab);
        const nextIdx = (curIdx - 1 + TABS.length) % TABS.length;
        setActiveTab(TABS[nextIdx].id);
        setActiveRowIndex(0);
        setActiveColIndex(0);
        return;
      }
      if (action === 'TRIGGER_RB') {
        const curIdx = TABS.findIndex((t) => t.id === curTab);
        const nextIdx = (curIdx + 1) % TABS.length;
        setActiveTab(TABS[nextIdx].id);
        setActiveRowIndex(0);
        setActiveColIndex(0);
        return;
      }

      // 5. Global Actions
      if (action === 'ACTION_Y') {
        setIsSearchOpen(true);
        return;
      }

      // 6. Dashboard Grid Spatial Navigation
      if (curTab === 'home' || curTab === 'movies' || curTab === 'series') {
        const currentFiltered = visibleRows;
        if (currentFiltered.length === 0) return;

        switch (action) {
          case 'NAV_UP': {
            const nextRowIdx = Math.max(0, rIdx - 1);
            if (nextRowIdx !== rIdx) {
              setActiveRowIndex(nextRowIdx);
              const nextRow = currentFiltered[nextRowIdx];
              if (nextRow && nextRow.items.length > 0) {
                const memCol = stateRef.current.rowColMemory[nextRow.id] ?? 0;
                setActiveColIndex(Math.min(nextRow.items.length - 1, memCol));
              }
            }
            break;
          }

          case 'NAV_DOWN': {
            const nextRowIdx = Math.min(currentFiltered.length - 1, rIdx + 1);
            if (nextRowIdx !== rIdx) {
              setActiveRowIndex(nextRowIdx);
              const nextRow = currentFiltered[nextRowIdx];
              if (nextRow && nextRow.items.length > 0) {
                const memCol = stateRef.current.rowColMemory[nextRow.id] ?? 0;
                setActiveColIndex(Math.min(nextRow.items.length - 1, memCol));
              }
            }
            break;
          }

          case 'NAV_LEFT': {
            const currentRow = currentFiltered[rIdx];
            if (currentRow) {
              const newCol = Math.max(0, cIdx - 1);
              setActiveColIndex(newCol);
              setRowColMemory((prev) => ({ ...prev, [currentRow.id]: newCol }));
            }
            break;
          }

          case 'NAV_RIGHT': {
            const currentRow = currentFiltered[rIdx];
            if (currentRow) {
              const newCol = Math.min(currentRow.items.length - 1, cIdx + 1);
              setActiveColIndex(newCol);
              setRowColMemory((prev) => ({ ...prev, [currentRow.id]: newCol }));
            }
            break;
          }

          case 'ACTION_A': {
            const row = currentFiltered[rIdx];
            if (row && row.items[cIdx]) {
              setSelectedMeta(row.items[cIdx]);
              setModalFocusRow(0);
              setModalFocusCol(0);
            }
            break;
          }

          case 'ACTION_X': {
            const row = currentFiltered[rIdx];
            if (row && row.items[cIdx]) {
              handleToggleLibrary(row.items[cIdx]);
            }
            break;
          }
        }
      }
    };

    const unsubscribe = GamepadManager.subscribe(handleGamepadAction);
    return () => unsubscribe();
  }, [visibleRows]);

  // All catalog items flat array for search
  const allItems = useMemo(() => {
    const map = new Map<string, StremioMetaPreview>();
    rows.forEach((r) => r.items.forEach((item) => map.set(item.id, item)));
    return Array.from(map.values());
  }, [rows]);

  // Compute whether focused item is already saved in user's library
  const isFocusedInLibrary = useMemo(() => {
    if (!currentFocusedItem) return false;
    return AccountService.isInLibrary(currentFocusedItem.id);
  }, [currentFocusedItem, rows, toast]);

  const activeFooterHints: HintAction[] = useMemo(() => {
    if (selectedMeta) {
      return [
        { button: 'A', label: 'Assistir / Selecionar' },
        { button: 'B', label: 'Voltar ao Catálogo' },
        { button: 'DPAD', label: 'Trocar Opção' },
      ];
    }
    if (activeTab === 'library') {
      return [
        { button: 'A', label: 'Assistir / Fontes' },
        { button: 'X', label: 'Remover da Biblioteca' },
        { button: 'LT', label: '' },
        { button: 'RT', label: 'Filtrar' },
        { button: 'LB', label: '' },
        { button: 'RB', label: 'Trocar Aba' },
      ];
    }
    if (activeTab === 'settings') {
      return [
        { button: 'A', label: 'Selecionar' },
        { button: 'LB', label: '' },
        { button: 'RB', label: 'Trocar Aba' },
      ];
    }
    return [
      { button: 'A', label: 'Assistir / Fontes' },
      {
        button: 'X',
        label: isFocusedInLibrary ? 'Remover da Biblioteca' : 'Salvar na Biblioteca',
      },
      { button: 'Y', label: 'Buscar' },
      { button: 'LB', label: '' },
      { button: 'RB', label: 'Trocar Aba' },
    ];
  }, [selectedMeta, activeTab, isFocusedInLibrary]);

  return (
    <div
      style={{ backgroundColor: 'var(--app-bg)' }}
      className="app-dashboard relative w-screen h-screen text-zinc-100 flex flex-col overflow-hidden select-none transition-colors duration-300"
    >
      {/* Top Header: Logo on left, Centered Tabs, Clock on right */}
      <XboxHeader
        activeTab={activeTab}
        currentTheme={currentTheme}
        onTabChange={(tab) => {
          if (tab !== activeTab) {
            SoundService.playTabSwitch();
          }
          setActiveTab(tab);
          setActiveRowIndex(0);
          setActiveColIndex(0);
        }}
      />

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {activeTab === 'home' || activeTab === 'movies' || activeTab === 'series' ? (
          <div className="relative w-full h-full flex flex-col overflow-hidden">
            {/* Pinned Cinematic Hero Spotlight (ALWAYS VISIBLE AT TOP) */}
            <HeroSpotlight
              item={currentFocusedItem}
              isInLibrary={isFocusedInLibrary}
              onPlay={(item) => setSelectedMeta(item)}
              onToggleLibrary={(item) => handleToggleLibrary(item)}
            />

            {/* Netflix-style Sliding Carousel Stack (active row always brought to top slot) */}
            <div className="relative flex-1 overflow-hidden -mt-4 z-20">
              {loading ? (
                <div className="px-12 py-12 text-zinc-500 font-semibold text-sm animate-pulse">
                  Conectando aos Addons e carregando trilhos...
                </div>
              ) : visibleRows.length === 0 ? (
                <div className="px-12 py-12 text-zinc-500">Nenhum título encontrado nesta categoria.</div>
              ) : (
                <div
                  className="transition-transform duration-400 ease-[cubic-bezier(0.16,1,0.3,1)] flex flex-col"
                  style={{
                    transform: `translate3d(0, -${activeRowIndex * 330}px, 0)`,
                  }}
                >
                  {visibleRows.map((row, rIdx) => {
                    const isFocused = activeRowIndex === rIdx;
                    return (
                      <div
                        key={row.id}
                        className="h-[330px] flex-shrink-0"
                        style={{
                          opacity: isFocused ? 1 : 0.3,
                          transform: isFocused ? 'scale(1)' : 'scale(0.985)',
                          transformOrigin: 'left center',
                          transition: 'opacity 0.28s ease, transform 0.28s ease',
                        }}
                      >
                        <MediaCarousel
                          title={row.title}
                          items={row.items}
                          isRowActive={isFocused}
                          focusedColIndex={activeColIndex}
                          onSelect={(item) => setSelectedMeta(item)}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : activeTab === 'library' ? (
          <LibraryView
            isActive={
              activeTab === 'library' &&
              !selectedMeta &&
              !isSearchOpen &&
              !isLoginModalOpen &&
              !playingStream
            }
            user={currentUser}
            onSelectItem={(item) => setSelectedMeta(item)}
            onOpenLogin={() => setIsLoginModalOpen(true)}
            onBackToHome={() => setActiveTab('home')}
          />
        ) : (
          /* Settings Tab */
          <SettingsView
            isActive={
              activeTab === 'settings' &&
              !selectedMeta &&
              !isSearchOpen &&
              !isLoginModalOpen &&
              !playingStream
            }
            currentUser={currentUser}
            currentTheme={currentTheme}
            forcedControllerType={forcedControllerType}
            serverStatus={serverStatus}
            controllerName={controllerName}
            isGamepadActive={isGamepadActive}
            onThemeChange={handleThemeChange}
            onControllerTypeChange={handleControllerTypeChange}
            onOpenLogin={() => setIsLoginModalOpen(true)}
            onLogout={() => {
              AccountService.logout();
              setCurrentUser(null);
            }}
            onSyncCloud={() => {
              AccountService.syncLibrary();
              AccountService.syncAddons();
              loadCatalogs(true);
            }}
            userAddons={userAddons}
            onSyncAddons={async () => {
              const a = await AccountService.syncAddons();
              setUserAddons(a);
              loadCatalogs(true);
            }}
            onCheckServer={async () => {
              const res = await StremioService.checkServer(customServerUrl);
              setServerStatus(res);
            }}
            onBackToHome={() => {
              SoundService.playBack();
              setActiveTab('home');
            }}
          />
        )}
      </main>

      {/* Bottom Controller Hints */}
      {!selectedMeta && !playingStream && (
        <XboxFooterHints hints={activeFooterHints} currentTheme={currentTheme} />
      )}

      {/* Detail Overlay Blade */}
      {selectedMeta && (
        <MediaDetailModal
          isActive={!playingStream}
          onToggleLibrary={handleToggleLibrary}
          preview={selectedMeta}
          focusRow={modalFocusRow}
          focusCol={modalFocusCol}
          onClose={() => {
            SoundService.playBack();
            setSelectedMeta(null);
          }}
          onPlayStream={(stream, meta, all, streamId) => {
            setPlayingStream(stream);
            setPlayingMeta(meta);
            if (all) setPlayingStreams(all);
            if (streamId) setPlayingStreamId(streamId);
          }}
        />
      )}

      {/* Video Player */}
      {playingStream && playingMeta && (
        <VideoPlayer
          key={playingStreamId || playingMeta.id}
          stream={playingStream}
          meta={playingMeta}
          streamId={playingStreamId || playingMeta.id}
          availableStreams={playingStreams}
          onEpisodeChange={handleEpisodeChange}
          onExit={() => {
            SoundService.playBack();
            setPlayingStream(null);
            setPlayingMeta(null);
            setPlayingStreams([]);
            setPlayingStreamId(null);
          }}
        />
      )}

      {/* Search Overlay */}
      {isSearchOpen && (
        <SearchModal
          onClose={() => {
            SoundService.playBack();
            setIsSearchOpen(false);
          }}
          onSelectItem={(item) => {
            setIsSearchOpen(false);
            setSelectedMeta(item);
          }}
          allCatalogItems={allItems}
        />
      )}

      {/* Login Overlay */}
      {isLoginModalOpen && (
        <LoginModal
          onClose={() => {
            SoundService.playBack();
            setIsLoginModalOpen(false);
          }}
          onSuccess={() => {
            setIsLoginModalOpen(false);
            const user = AccountService.getUser();
            setCurrentUser(user);
            loadCatalogs(true);
          }}
        />
      )}

      {/* Floating HUD Toast Notification */}
      {toast && (
        <div
          className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-6 py-3.5 rounded-2xl bg-zinc-900/95 backdrop-blur-xl shadow-2xl text-white font-semibold text-sm animate-fade-in pointer-events-none"
          style={{
            border: '2px solid',
            borderColor: toast.type === 'add' ? '#10b981' : 'var(--app-remove-color, #FF334B)',
            boxShadow:
              toast.type === 'add'
                ? '0 0 25px rgba(16, 185, 129, 0.4)'
                : '0 0 25px color-mix(in srgb, var(--app-remove-color, #FF334B) 40%, transparent)',
          }}
        >
          {toast.type === 'add' ? (
            <BookmarkCheck className="w-5 h-5 text-emerald-400 flex-shrink-0 animate-bounce" />
          ) : (
            <BookmarkMinus
              className="w-5 h-5 flex-shrink-0"
              style={{ color: 'var(--app-remove-color, #FF334B)' }}
            />
          )}
          <span className="truncate max-w-md">{toast.message}</span>
        </div>
      )}
    </div>
  );
}
