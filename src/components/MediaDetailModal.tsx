import React, { useEffect, useState, useRef, useMemo } from 'react';
import { LiquidGlassLayer } from './LiquidGlassLayer';
import type { StremioMetaDetail, StremioMetaPreview, StremioStream } from '../types/stremio';
import { StremioService } from '../services/stremio';
import { GamepadManager, type GamepadAction } from '../services/gamepad';
import { SettingsService } from '../services/settings';
import { SoundService } from '../services/sound';
import { ThemeService } from '../services/theme';
import { ControllerButtonBadge } from './ControllerButtonBadge';
import { parseStream, type ParsedStream } from '../utils/streamParser';
import { FALLBACK_POSTER } from '../utils/posterFallback';
import { AccountService } from '../services/account';
import {
  Play,
  Star,
  Calendar,
  Clock,
  Radio,
  Users,
  Sparkles,
  Volume2,
  HardDrive,
  Tv,
  BookmarkPlus,
  BookmarkCheck,
} from 'lucide-react';

interface Props {
  preview: StremioMetaPreview;
  onClose: () => void;
  onPlayStream: (
    stream: StremioStream,
    meta: StremioMetaPreview,
    allStreams?: StremioStream[],
    streamId?: string
  ) => void;
  focusRow?: number;
  focusCol?: number;
  onToggleLibrary: (item: StremioMetaPreview) => Promise<boolean | undefined>;
  isActive?: boolean;
}

export type DetailStep = 'seasons' | 'episodes' | 'streams';

export const MediaDetailModal: React.FC<Props> = ({
  preview,
  onClose,
  onPlayStream,
  onToggleLibrary,
  isActive = true,
}) => {
  const [inLibrary, setInLibrary] = useState(() => AccountService.isInLibrary(preview.id));
  const [savingLibrary, setSavingLibrary] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const libraryBusyRef = useRef(false);
  const toggleLibrary = async () => {
    if (libraryBusyRef.current) return;
    libraryBusyRef.current = true;
    setSavingLibrary(true);
    setLibraryError(null);
    try {
      const added = await onToggleLibrary(detail || preview);
      if (typeof added === 'boolean') setInLibrary(added);
      else setLibraryError('Não foi possível atualizar a biblioteca. Tente novamente.');
    } catch {
      setLibraryError('Não foi possível atualizar a biblioteca. Tente novamente.');
    } finally {
      libraryBusyRef.current = false;
      setSavingLibrary(false);
    }
  };
  const [detail, setDetail] = useState<StremioMetaDetail | null>(null);
  const [rawStreams, setRawStreams] = useState<StremioStream[]>([]);
  const [loadingStreams, setLoadingStreams] = useState(true);

  // Audio / Language Filter: default from Settings, toggleable with ACTION_Y
  const [isPtBrOnly, setIsPtBrOnly] = useState<boolean>(() =>
    SettingsService.isPtBrFilterDefault()
  );

  // Focused item index in the currently visible rail (seasons, episodes, or streams)
  const [focusedIndex, setFocusedIndex] = useState<number>(0);

  // Track active theme for conditional styling (pill glassmorphism, card colors)
  const [activeTheme, setActiveTheme] = useState(() => ThemeService.getTheme());
  useEffect(() => {
    const unsub = ThemeService.subscribe((t) => setActiveTheme(t));
    return unsub;
  }, []);
  const isPs1 = activeTheme === 'ps1';

  // Check saved episode in localStorage
  const savedKey = `stremio_last_ep_${preview.id}`;
  const initialSaved = useMemo(() => {
    try {
      const raw = localStorage.getItem(savedKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.season === 'number' && typeof parsed?.episode === 'number') {
          return parsed as { season: number; episode: number };
        }
      }
    } catch {}
    return null;
  }, [savedKey]);

  // Selected Season and Episode for Series
  const [selectedSeason, setSelectedSeason] = useState<number>(() => initialSaved?.season || 1);
  const [selectedEpisode, setSelectedEpisode] = useState<number>(() => initialSaved?.episode || 1);

  // Active navigation step:
  // If movie -> 'streams'
  // If series with saved episode -> 'streams' directly!
  // If series without saved episode -> 'seasons'
  const [step, setStep] = useState<DetailStep>(() => {
    if (preview.type !== 'series') return 'streams';
    if (initialSaved) return 'streams';
    return 'seasons';
  });

  const saveLastEp = (season: number, episode: number) => {
    try {
      localStorage.setItem(savedKey, JSON.stringify({ season, episode }));
    } catch {}
  };

  const handleClose = () => {
    SoundService.playBack();
    onClose();
  };

  const leftColumnRef = useRef<HTMLElement>(null);
  const streamItemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const seasonItemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const episodeItemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Load detailed metadata
  useEffect(() => {
    let isMounted = true;
    StremioService.getMeta(preview.type, preview.id).then((data) => {
      if (isMounted && data) {
        setDetail(data);

        // If no saved episode and it's a series:
        if (!initialSaved && (preview.type === 'series' || (data.videos && data.videos.length > 0))) {
          const sSet = new Set<number>();
          data.videos?.forEach((v) => {
            if (typeof v.season === 'number' && v.season > 0) sSet.add(v.season);
          });
          const seasonList = Array.from(sSet);
          if (seasonList.length <= 1) {
            // Only 1 season -> jump directly to episode selection!
            setStep('episodes');
            if (data.videos && data.videos.length > 0) {
              setSelectedSeason(data.videos[0].season || 1);
              setSelectedEpisode(data.videos[0].episode || 1);
            }
          } else {
            // Multiple seasons -> start with season selection
            setStep('seasons');
          }
        }
      }
    });
    return () => {
      isMounted = false;
    };
  }, [preview, initialSaved]);

  const isSeries = preview.type === 'series' || Boolean(detail?.videos && detail.videos.length > 0);

  // Compute available seasons
  const seasons = useMemo(() => {
    if (!detail?.videos || detail.videos.length === 0) return [1];
    const s = new Set<number>();
    detail.videos.forEach((v) => {
      if (typeof v.season === 'number' && v.season > 0) s.add(v.season);
    });
    const list = Array.from(s).sort((a, b) => a - b);
    return list.length > 0 ? list : [1];
  }, [detail]);

  // Episodes for currently selected season
  const episodesInSeason = useMemo(() => {
    if (!detail?.videos || detail.videos.length === 0) return [];
    return detail.videos
      .filter((v) => (v.season || 1) === selectedSeason)
      .sort((a, b) => (a.episode || 1) - (b.episode || 1));
  }, [detail, selectedSeason]);

  const maxEpisode = useMemo(() => {
    if (episodesInSeason.length === 0) return 24;
    return episodesInSeason[episodesInSeason.length - 1].episode || 1;
  }, [episodesInSeason]);

  const currentEpisodeData = useMemo(() => {
    return episodesInSeason.find((e) => e.episode === selectedEpisode) || episodesInSeason[0];
  }, [episodesInSeason, selectedEpisode]);

  // Load stream sources for movie or series episode
  useEffect(() => {
    if (step !== 'streams') return;

    let isMounted = true;
    setLoadingStreams(true);
    setRawStreams([]);

    const streamId =
      preview.type === 'series'
        ? `${preview.id}:${selectedSeason}:${selectedEpisode}`
        : preview.id;

    StremioService.getStreams(preview.type, streamId, (partialList) => {
      if (!isMounted) return;
      if (partialList.length > 0) {
        setRawStreams(partialList);
        setLoadingStreams(false);
      }
    })
      .then((streamList) => {
        if (!isMounted) return;

        setRawStreams(streamList);
        setLoadingStreams(false);
        setFocusedIndex(0);
      })
      .catch(() => {
        if (isMounted) setLoadingStreams(false);
      });

    return () => {
      isMounted = false;
    };
  }, [preview, selectedSeason, selectedEpisode, step]);

  // Parse all loaded streams
  const parsedAllStreams: ParsedStream[] = useMemo(() => {
    return rawStreams.map((s) => parseStream(s));
  }, [rawStreams]);

  // Visible streams filtered by PT-BR when active
  const visibleStreams: ParsedStream[] = useMemo(() => {
    if (!isPtBrOnly) return parsedAllStreams;
    return parsedAllStreams.filter((s) => s.isPtBr);
  }, [parsedAllStreams, isPtBrOnly]);

  const ptBrCount = useMemo(() => {
    return parsedAllStreams.filter((s) => s.isPtBr).length;
  }, [parsedAllStreams]);

  // Auto-scroll when focusedIndex or step changes
  useEffect(() => {
    if (step === 'streams') {
      const el = streamItemRefs.current[focusedIndex];
      if (el) {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    } else if (step === 'seasons') {
      const el = seasonItemRefs.current[focusedIndex];
      if (el) {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    } else if (step === 'episodes') {
      const el = episodeItemRefs.current[focusedIndex];
      if (el) {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [focusedIndex, step]);

  // Analog Stick Smooth Scrolling Loop:
  // Right Stick (RS / axis 3) -> scrolls LEFT column (Details / Synopsis / Cast)
  // Left Stick (LS / axis 1) -> scrolls RIGHT column (Sources Rail)
  useEffect(() => {
    let animId: number;
    const DEADZONE = 0.16;
    const SCROLL_SPEED = 22;

    const pollAnalogSticks = () => {
      const gp = GamepadManager.getActiveGamepad();

      if (gp) {
        // Right stick (axes[3]): scroll LEFT column
        const rightStickY = gp.axes[3] || 0;
        if (leftColumnRef.current && Math.abs(rightStickY) > DEADZONE) {
          const sign = Math.sign(rightStickY);
          const factor = (Math.abs(rightStickY) - DEADZONE) / (1 - DEADZONE);
          leftColumnRef.current.scrollTop += sign * factor * SCROLL_SPEED;
        }

        // Left stick (axes[1]): scroll RIGHT column
        const leftStickY = gp.axes[1] || 0;
        if (scrollContainerRef.current && Math.abs(leftStickY) > DEADZONE) {
          const sign = Math.sign(leftStickY);
          const factor = (Math.abs(leftStickY) - DEADZONE) / (1 - DEADZONE);
          scrollContainerRef.current.scrollTop += sign * factor * SCROLL_SPEED;
        }
      }

      animId = requestAnimationFrame(pollAnalogSticks);
    };

    animId = requestAnimationFrame(pollAnalogSticks);
    return () => {
      cancelAnimationFrame(animId);
    };
  }, []);

  // Gamepad action listener for Edge-to-Edge Source Selection Blade
  const stateRef = useRef({
    toggleLibrary,
    step,
    focusedIndex,
    visibleStreams,
    rawStreams,
    isPtBrOnly,
    detail,
    preview,
    isSeries,
    seasons,
    episodesInSeason,
    selectedSeason,
    selectedEpisode,
    maxEpisode,
    onClose,
    onPlayStream,
    setStep,
    setFocusedIndex,
    setSelectedSeason,
    setSelectedEpisode,
    saveLastEp,
  });

  stateRef.current = {
    toggleLibrary,
    step,
    focusedIndex,
    visibleStreams,
    rawStreams,
    isPtBrOnly,
    detail,
    preview,
    isSeries,
    seasons,
    episodesInSeason,
    selectedSeason,
    selectedEpisode,
    maxEpisode,
    onClose,
    onPlayStream,
    setStep,
    setFocusedIndex,
    setSelectedSeason,
    setSelectedEpisode,
    saveLastEp,
  };

  useEffect(() => {
    if (!isActive) return;
    const handleGamepad = (action: GamepadAction) => {
      const {
        step: curStep,
        focusedIndex: curIdx,
        visibleStreams: curStreams,
        rawStreams: curRawStreams,
        isPtBrOnly: curFilter,
        detail: curDetail,
        preview: curMeta,
        isSeries: curIsSeries,
        seasons: curSeasons,
        episodesInSeason: curEpisodes,
        selectedSeason: curSeason,
        selectedEpisode: curEp,
        maxEpisode: curMaxEp,
        onClose: handleClose,
        onPlayStream: handlePlay,
        setStep: updateStep,
        setFocusedIndex: updateFocusedIndex,
        setSelectedSeason: updateSelectedSeason,
        setSelectedEpisode: updateSelectedEpisode,
        saveLastEp: doSaveLastEp,
      } = stateRef.current;

      switch (action) {
        case 'BUTTON_VIEW':
          void stateRef.current.toggleLibrary();
          break;
        case 'ACTION_B':
          // B SEMPRE volta para o catálogo
          handleClose();
          break;

        case 'ACTION_X':
          // X / Quadrado volta um passo de seleção (temporada ou episódio)
          if (curStep === 'streams') {
            if (curIsSeries) {
              SoundService.playBack();
              updateStep('episodes');
              const epIdx = curEpisodes.findIndex((e) => e.episode === curEp);
              updateFocusedIndex(epIdx >= 0 ? epIdx : 0);
            }
          } else if (curStep === 'episodes') {
            if (curSeasons.length > 1) {
              SoundService.playBack();
              updateStep('seasons');
              const sIdx = curSeasons.indexOf(curSeason);
              updateFocusedIndex(sIdx >= 0 ? sIdx : 0);
            }
          }
          break;

        case 'ACTION_Y':
          if (curStep === 'streams') {
            setIsPtBrOnly(!curFilter);
            updateFocusedIndex(0);
          }
          break;

        // ==========================================
        // L1 / R1 (LB / RB): Trocar Temporadas
        // ==========================================
        case 'TRIGGER_LB':
          if (curStep === 'streams' && curIsSeries && curSeasons.length > 1) {
            const idx = curSeasons.indexOf(curSeason);
            const prevSeason = curSeasons[(idx - 1 + curSeasons.length) % curSeasons.length];
            updateSelectedSeason(prevSeason);
            updateSelectedEpisode(1);
            doSaveLastEp(prevSeason, 1);
          } else if (curStep === 'streams' && !curIsSeries) {
            updateFocusedIndex((prev) => Math.max(0, prev - 4));
          }
          break;

        case 'TRIGGER_RB':
          if (curStep === 'streams' && curIsSeries && curSeasons.length > 1) {
            const idx = curSeasons.indexOf(curSeason);
            const nextSeason = curSeasons[(idx + 1) % curSeasons.length];
            updateSelectedSeason(nextSeason);
            updateSelectedEpisode(1);
            doSaveLastEp(nextSeason, 1);
          } else if (curStep === 'streams' && !curIsSeries) {
            updateFocusedIndex((prev) =>
              Math.min(curStreams.length > 0 ? curStreams.length - 1 : 0, prev + 4)
            );
          }
          break;

        // ==========================================
        // LT / RT (L2 / R2): Trocar Episódios
        // ==========================================
        case 'TRIGGER_LT':
          if (curStep === 'streams' && curIsSeries) {
            const prevEp = Math.max(1, curEp - 1);
            updateSelectedEpisode(prevEp);
            doSaveLastEp(curSeason, prevEp);
          }
          break;

        case 'TRIGGER_RT':
          if (curStep === 'streams' && curIsSeries) {
            const nextEp = Math.min(curMaxEp, curEp + 1);
            updateSelectedEpisode(nextEp);
            doSaveLastEp(curSeason, nextEp);
          }
          break;

        case 'NAV_UP': {
          const gp = GamepadManager.getActiveGamepad();
          const leftStickY = gp?.axes[1] || 0;
          if (Math.abs(leftStickY) < 0.3) {
            updateFocusedIndex((prev) => Math.max(0, prev - 1));
          }
          break;
        }

        case 'NAV_DOWN': {
          const gp = GamepadManager.getActiveGamepad();
          const leftStickY = gp?.axes[1] || 0;
          if (Math.abs(leftStickY) < 0.3) {
            if (curStep === 'seasons') {
              updateFocusedIndex((prev) =>
                Math.min(Math.max(0, curSeasons.length - 1), prev + 1)
              );
            } else if (curStep === 'episodes') {
              updateFocusedIndex((prev) =>
                Math.min(Math.max(0, curEpisodes.length - 1), prev + 1)
              );
            } else if (curStep === 'streams') {
              updateFocusedIndex((prev) =>
                Math.min(Math.max(0, curStreams.length - 1), prev + 1)
              );
            }
          }
          break;
        }

        case 'ACTION_A':
          if (curStep === 'seasons') {
            const chosenSeason = curSeasons[curIdx] || 1;
            updateSelectedSeason(chosenSeason);
            updateSelectedEpisode(1);
            updateStep('episodes');
            updateFocusedIndex(0);
          } else if (curStep === 'episodes') {
            const chosenEpObj = curEpisodes[curIdx];
            const chosenEp = chosenEpObj?.episode || curIdx + 1;
            updateSelectedEpisode(chosenEp);
            doSaveLastEp(curSeason, chosenEp);
            updateStep('streams');
            updateFocusedIndex(0);
          } else if (curStep === 'streams') {
            if (curStreams.length > 0 && curStreams[curIdx]) {
              const currentStreamId = curIsSeries
                ? `${curMeta.id}:${curSeason}:${curEp}`
                : curMeta.id;
              doSaveLastEp(curSeason, curEp);
              handlePlay(
                curStreams[curIdx].stream,
                curDetail || curMeta,
                curRawStreams,
                currentStreamId
              );
            }
          }
          break;
      }
    };

    const unsubscribe = GamepadManager.subscribe(handleGamepad);
    return () => unsubscribe();
  }, [isActive]);

  const bgImage = preview.background || preview.banner || preview.poster;

  return (
    <div className="fixed inset-0 w-screen h-screen z-50 app-modal-bg bg-[var(--app-bg)] text-[var(--app-text-primary,#ffffff)] flex flex-col overflow-hidden select-none animate-fade-in">
      {/* Immersive Edge-to-Edge Backdrop Wallpaper */}
      {bgImage && (
        <div
          className="absolute inset-0 bg-cover bg-center opacity-25 scale-105 pointer-events-none transition-all duration-700"
          style={{ backgroundImage: `url('${bgImage}')` }}
        >
          <div className="absolute inset-0 bg-gradient-to-t from-[var(--app-bg)] via-[var(--app-bg)]/85 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-[var(--app-bg)] via-[var(--app-bg)]/90 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-b from-[var(--app-bg)]/80 via-transparent to-[var(--app-bg)]" />
        </div>
      )}

      {/* Top Console Navigation Bar — transparent overlay like home header */}
      <header className="liquid-glass-surface relative z-20 grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-3 items-center px-10 py-4 min-h-[64px]">
        {/* Left: Back button & Breadcrumb */}
        <div className="flex flex-wrap items-center gap-4">
          {/* Button B: Sempre Catálogo */}
          <button
            onClick={handleClose}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl app-card-item text-xs font-bold transition-all cursor-pointer"
          >
            <ControllerButtonBadge button="B" size="sm" />
            <span className="text-zinc-200">Catálogo</span>
          </button>

          {/* Button X: Voltar Passo Anterior (se série) */}
          {isSeries && step === 'streams' && (
            <button
              onClick={() => {
                SoundService.playBack();
                setStep('episodes');
                const epIdx = episodesInSeason.findIndex((e) => e.episode === selectedEpisode);
                setFocusedIndex(epIdx >= 0 ? epIdx : 0);
              }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl app-card-item text-xs font-bold transition-all cursor-pointer"
            >
              <ControllerButtonBadge button="X" size="sm" />
              <span className="text-zinc-200">Trocar Episódio</span>
            </button>
          )}

          {isSeries && step === 'episodes' && seasons.length > 1 && (
            <button
              onClick={() => {
                SoundService.playBack();
                setStep('seasons');
                const sIdx = seasons.indexOf(selectedSeason);
                setFocusedIndex(sIdx >= 0 ? sIdx : 0);
              }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl app-card-item text-xs font-bold transition-all cursor-pointer"
            >
              <ControllerButtonBadge button="X" size="sm" />
              <span className="text-zinc-200">Trocar Temporada</span>
            </button>
          )}
          <div className="h-4 w-[1px] bg-white/20" />
          <span className="text-xs font-black tracking-widest text-zinc-300 uppercase">
            {step === 'seasons'
              ? '1. Seleção de Temporada'
              : step === 'episodes'
              ? `2. Seleção de Episódio (Temporada ${selectedSeason})`
              : 'Seleção de Fontes'}
          </span>
        </div>

        {/* Center: Season & Episode pill — same glassmorphism as home center nav */}
        {isSeries && step === 'streams' && (
          <div
            className={`liquid-glass-detail liquid-glass-control col-start-1 2xl:col-start-2 row-start-2 2xl:row-start-1 justify-self-center max-w-full flex flex-wrap justify-center items-center gap-3 px-4 py-1.5 rounded-2xl shadow-2xl backdrop-blur-2xl z-10 animate-fade-in transition-all ${
              isPs1
                ? 'bg-white/10 border-2 border-white/25'
                : 'bg-black/40 border border-white/10'
            }`}
            style={
              isPs1
                ? { boxShadow: '0 12px 32px rgba(0,0,0,0.35), 0 0 20px rgba(255,255,255,0.12)' }
                : undefined
            }
          >
            <LiquidGlassLayer />
            {/* Season Selector: L1 / R1 */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const idx = seasons.indexOf(selectedSeason);
                  const prev = seasons[(idx - 1 + seasons.length) % seasons.length];
                  setSelectedSeason(prev);
                  setSelectedEpisode(1);
                  saveLastEp(prev, 1);
                }}
                title="Temporada Anterior (L1 / LB)"
                className="hover:scale-110 active:scale-95 transition-transform cursor-pointer"
              >
                <ControllerButtonBadge button="LB" size="sm" />
              </button>

              <div className="px-3 py-1 rounded-xl bg-white/10 text-xs font-black text-white flex items-center gap-1.5 shadow-inner">
                <span className="text-zinc-400 font-semibold">Temporada</span>
                <span style={{ color: 'var(--app-accent)' }} className="font-black text-sm">{selectedSeason}</span>
                <span className="text-[10px] text-zinc-500 font-normal">/ {seasons.length}</span>
              </div>

              <button
                onClick={() => {
                  const idx = seasons.indexOf(selectedSeason);
                  const next = seasons[(idx + 1) % seasons.length];
                  setSelectedSeason(next);
                  setSelectedEpisode(1);
                  saveLastEp(next, 1);
                }}
                title="Próxima Temporada (R1 / RB)"
                className="hover:scale-110 active:scale-95 transition-transform cursor-pointer"
              >
                <ControllerButtonBadge button="RB" size="sm" />
              </button>
            </div>

            <div className="h-4 w-[1px] bg-white/20" />

            {/* Episode Selector: LT / RT */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const prev = Math.max(1, selectedEpisode - 1);
                  setSelectedEpisode(prev);
                  saveLastEp(selectedSeason, prev);
                }}
                title="Episódio Anterior (LT / L2)"
                className="hover:scale-110 active:scale-95 transition-transform cursor-pointer"
              >
                <ControllerButtonBadge button="LT" size="sm" />
              </button>

              <div className="px-3 py-1 rounded-xl bg-white/10 text-xs font-black text-white flex items-center gap-2 max-w-[280px] truncate shadow-inner">
                <span className="text-zinc-400 font-semibold">Ep.</span>
                <span style={{ color: 'var(--app-accent)' }} className="font-black text-sm">{selectedEpisode}</span>
                {currentEpisodeData?.title && (
                  <span className="text-zinc-300 font-medium text-[11px] truncate">
                    — {currentEpisodeData.title}
                  </span>
                )}
              </div>

              <button
                onClick={() => {
                  const next = Math.min(maxEpisode, selectedEpisode + 1);
                  setSelectedEpisode(next);
                  saveLastEp(selectedSeason, next);
                }}
                title="Próximo Episódio (RT / R2)"
                className="hover:scale-110 active:scale-95 transition-transform cursor-pointer"
              >
                <ControllerButtonBadge button="RT" size="sm" />
              </button>
            </div>
          </div>
        )}

        {/* Right: Quick Filter Status & Button (Y) or Series Indicator */}
        <div className="col-start-1 2xl:col-start-3 row-start-3 2xl:row-start-1 justify-self-end flex flex-wrap justify-end items-center gap-3">
          <button
            type="button"
            onClick={() => void toggleLibrary()}
            disabled={savingLibrary}
            aria-pressed={inLibrary}
            className="liquid-glass-detail flex items-center gap-2 px-3 py-2 rounded-xl app-card-item text-xs font-bold text-white disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <LiquidGlassLayer />
            {inLibrary ? <BookmarkCheck className="w-4 h-4" /> : <BookmarkPlus className="w-4 h-4" />}
            <span>{savingLibrary ? 'Salvando...' : inLibrary ? 'Remover da biblioteca' : 'Adicionar à biblioteca'}</span>
            <ControllerButtonBadge button="VIEW" size="sm" />
          </button>
          {libraryError && <span role="alert" className="text-xs text-red-300">{libraryError}</span>}

          {step === 'streams' ? (
            <button
              onClick={() => {
                setIsPtBrOnly(!isPtBrOnly);
                setFocusedIndex(0);
              }}
              style={
                isPtBrOnly
                  ? {
                      borderColor: 'color-mix(in srgb, var(--app-accent) 60%, transparent)',
                      boxShadow: '0 0 16px color-mix(in srgb, var(--app-accent) 25%, transparent)',
                      background: 'color-mix(in srgb, var(--app-accent) 15%, transparent)',
                    }
                  : undefined
              }
              className={`liquid-glass-detail flex items-center gap-2.5 px-3.5 py-1.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                isPtBrOnly
                  ? 'border'
                  : 'bg-white/5 border-white/10 text-zinc-400 hover:text-white'
              }`}
            >
              <LiquidGlassLayer />
              <ControllerButtonBadge button="Y" size="sm" />
              <span className="flex items-center gap-1.5">
                Filtro Dublado:
                {isPtBrOnly ? (
                  <span style={{ color: 'var(--app-accent)' }} className="font-black flex items-center gap-1">
                    ATIVO 🇧🇷
                  </span>
                ) : (
                  <span className="text-zinc-400">TODAS AS FONTES</span>
                )}
              </span>
            </button>
          ) : (
            <div className="px-3 py-1 rounded-xl bg-white/5 border border-white/10 text-xs font-bold text-zinc-300">
              {isSeries ? 'Série' : 'Filme'}
            </div>
          )}
        </div>
      </header>

      {/* Main Full-Screen Split View */}
      <main className="relative z-10 flex-1 flex flex-col md:flex-row overflow-hidden px-10 py-6 gap-8">
        {/* LEFT COLUMN: Media Details & Hero Preview (40% width) */}
        <section
          ref={leftColumnRef}
          className="w-full md:w-[40%] flex flex-col justify-between overflow-y-auto no-scrollbar pr-2 scroll-smooth"
        >
          <div>
            {/* Poster Frame */}
            <div className="relative w-48 aspect-[2/3] rounded-2xl overflow-hidden border-2 border-white/40 shadow-2xl mb-5 group">
              <img
                src={preview.poster || bgImage || FALLBACK_POSTER}
                alt={preview.name}
                referrerPolicy="no-referrer"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  if (target.src !== FALLBACK_POSTER) {
                    target.src = FALLBACK_POSTER;
                  }
                }}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
              <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-[11px] font-bold text-white">
                <span className="px-2 py-0.5 rounded bg-black/60 border border-white/20 uppercase">
                  {preview.type === 'series' ? 'Série' : 'Filme'}
                </span>
                {preview.imdbRating && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/80 text-black font-black">
                    ★ {preview.imdbRating}
                  </span>
                )}
              </div>
            </div>

            {/* Badges Row */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {preview.imdbRating && (
                <div className="flex items-center gap-1 px-2.5 py-1 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-lg text-xs font-bold">
                  <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                  <span>IMDb {preview.imdbRating}</span>
                </div>
              )}
              {preview.year && (
                <div className="flex items-center gap-1 px-2.5 py-1 app-card-panel rounded-lg text-xs font-semibold text-zinc-300">
                  <Calendar className="w-3 h-3 text-zinc-400" />
                  <span>{preview.year}</span>
                </div>
              )}
              {detail?.runtime && (
                <div className="flex items-center gap-1 px-2.5 py-1 app-card-panel rounded-lg text-xs font-semibold text-zinc-300">
                  <Clock className="w-3 h-3 text-zinc-400" />
                  <span>{detail.runtime}</span>
                </div>
              )}
              {preview.genres?.slice(0, 3).map((g) => (
                <span
                  key={g}
                  className="px-2.5 py-1 app-card-panel rounded-lg text-xs font-semibold text-zinc-300"
                >
                  {g}
                </span>
              ))}
            </div>

            {/* Title */}
            <h1 className="text-3xl lg:text-4xl font-black text-white tracking-tight mb-3">
              {preview.name}
            </h1>

            {/* Step/Episode Context Banner */}
            {isSeries && (
              <div
                style={{
                  color: 'var(--app-accent)',
                  background: 'color-mix(in srgb, var(--app-accent) 12%, transparent)',
                  borderColor: 'color-mix(in srgb, var(--app-accent) 35%, transparent)',
                }}
                className="flex items-center gap-2 mb-3 text-xs font-bold border px-3 py-1.5 rounded-xl max-w-xl"
              >
                <Tv className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="truncate">
                  {step === 'seasons'
                    ? `Visualizando Temporadas (${seasons.length} disponíveis)`
                    : step === 'episodes'
                    ? `Temporada ${selectedSeason} — Selecione o Episódio`
                    : `T${selectedSeason} : Ep.${selectedEpisode} ${
                        currentEpisodeData?.title ? `— ${currentEpisodeData.title}` : ''
                      }`}
                </span>
              </div>
            )}

            {/* Synopsis */}
            <p className="text-zinc-300 text-xs lg:text-sm leading-relaxed mb-6 line-clamp-5 max-w-xl">
              {step === 'streams' && currentEpisodeData?.overview
                ? currentEpisodeData.overview
                : preview.description || detail?.description || 'Carregando sinopse completa...'}
            </p>

            {/* Cast Info */}
            {detail?.cast && detail.cast.length > 0 && (
              <div className="flex items-center gap-2 text-xs text-zinc-400 mb-4 app-card-panel p-3 rounded-xl max-w-xl">
                <Users className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                <span className="font-semibold text-zinc-300">Elenco:</span>
                <span className="truncate text-zinc-400">{detail.cast.slice(0, 4).join(', ')}</span>
              </div>
            )}
          </div>

          {/* Quick Info Box */}
          <div className="app-card-panel p-4 rounded-2xl max-w-xl mt-4">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span className="flex items-center gap-1.5">
                <Volume2 className="w-3.5 h-3.5" style={{ color: 'var(--app-accent)' }} />
                Fontes Dubladas: <strong className="text-white">{ptBrCount}</strong>
              </span>
              <span>
                Total de Fontes: <strong className="text-white">{parsedAllStreams.length}</strong>
              </span>
            </div>
          </div>
        </section>

        {/* RIGHT COLUMN: Step Views (Seasons / Episodes / Streams) */}
        <section className="flex-1 flex flex-col overflow-hidden">
          {/* STEP 1: SEASON SELECTION */}
          {step === 'seasons' && (
            <>
              <div className="mb-3 px-1">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2.5">
                    <Tv className="w-4 h-4" style={{ color: 'var(--app-accent)' }} />
                    <h2 className="text-sm font-black uppercase tracking-wider text-white">
                      Escolha a Temporada ({seasons.length})
                    </h2>
                  </div>
                  <span className="text-xs text-zinc-400 font-semibold hidden md:inline">
                    Navegue com D-Pad e selecione com (A)
                  </span>
                </div>
                <p className="text-xs text-zinc-400">
                  Selecione a temporada para visualizar a lista de episódios.
                </p>
              </div>

              <div
                ref={scrollContainerRef}
                className="flex-1 overflow-y-auto px-3 py-2 space-y-3 no-scrollbar"
              >
                {seasons.map((seasonNum, idx) => {
                  const isFocused = focusedIndex === idx;
                  const isSelected = selectedSeason === seasonNum;
                  const epCount =
                    detail?.videos?.filter((v) => (v.season || 1) === seasonNum).length || 0;

                  return (
                    <div
                      key={seasonNum}
                      ref={(el) => {
                        seasonItemRefs.current[idx] = el;
                      }}
                      onClick={() => {
                        setSelectedSeason(seasonNum);
                        setSelectedEpisode(1);
                        setStep('episodes');
                        setFocusedIndex(0);
                      }}
                      style={
                        isFocused
                          ? {
                              borderColor: 'var(--app-focus-border, var(--app-accent))',
                              boxShadow:
                                '0 0 0 3px var(--app-focus-border, var(--app-accent)), 0 0 24px var(--app-accent-glow)',
                            }
                          : isSelected
                          ? {
                              borderColor: 'color-mix(in srgb, var(--app-accent) 60%, transparent)',
                              background: 'color-mix(in srgb, var(--app-accent) 12%, transparent)',
                            }
                          : undefined
                      }
                      className={`p-4 rounded-2xl border transition-all duration-150 cursor-pointer flex items-center justify-between app-card-item ${
                        isFocused
                          ? 'is-focused border-2'
                          : isSelected
                          ? 'border'
                          : 'border-white/15 hover:border-white/30'
                      }`}
                    >
                      <div className="flex items-center gap-3.5">
                        <div
                          style={{
                            background: 'color-mix(in srgb, var(--app-accent) 18%, transparent)',
                            color: 'var(--app-accent)',
                            borderColor: 'color-mix(in srgb, var(--app-accent) 40%, transparent)',
                          }}
                          className="w-11 h-11 rounded-xl border flex items-center justify-center font-black text-base"
                        >
                          {seasonNum}
                        </div>
                        <div>
                          <div className="text-sm font-bold text-white">
                            Temporada {seasonNum}
                          </div>
                          <div className="text-xs text-zinc-400">
                            {epCount > 0 ? `${epCount} episódios disponíveis` : 'Episódios da temporada'}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {isSelected && (
                          <span
                            style={{
                              color: 'var(--app-accent)',
                              background: 'color-mix(in srgb, var(--app-accent) 12%, transparent)',
                              borderColor: 'color-mix(in srgb, var(--app-accent) 35%, transparent)',
                            }}
                            className="text-xs font-bold px-2.5 py-1 rounded-lg border"
                          >
                            Selecionada
                          </span>
                        )}
                        {isFocused && <ControllerButtonBadge button="A" label="Selecionar" size="sm" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}


          {/* STEP 2: EPISODE SELECTION */}
          {step === 'episodes' && (
            <>
              <div className="mb-3 px-1">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2.5">
                    <Play className="w-4 h-4" style={{ color: 'var(--app-accent)' }} />
                    <h2 className="text-sm font-black uppercase tracking-wider text-white">
                      Temporada {selectedSeason} — Episódios ({episodesInSeason.length})
                    </h2>
                  </div>
                  {seasons.length > 1 && (
                    <button
                      onClick={() => {
                        setStep('seasons');
                        const sIdx = seasons.indexOf(selectedSeason);
                        setFocusedIndex(sIdx >= 0 ? sIdx : 0);
                      }}
                      style={{ color: 'var(--app-accent)' }}
                      className="text-xs hover:text-white underline cursor-pointer font-bold transition-colors"
                    >
                      Trocar temporada (B)
                    </button>
                  )}
                </div>
                <p className="text-xs text-zinc-400">
                  Selecione o episódio para consultar as fontes de reprodução.
                </p>
              </div>

              <div
                ref={scrollContainerRef}
                className="flex-1 overflow-y-auto px-3 py-2 space-y-3 no-scrollbar"
              >
                {episodesInSeason.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-64 text-zinc-400 gap-3">
                    <Sparkles className="w-6 h-6 animate-spin" style={{ color: 'var(--app-accent)' }} />
                    <span className="text-sm font-bold">Carregando episódios da temporada...</span>
                  </div>
                ) : (
                  episodesInSeason.map((ep, idx) => {
                    const isFocused = focusedIndex === idx;
                    const isSelected = selectedEpisode === ep.episode;
                    const isSaved =
                      initialSaved?.season === selectedSeason && initialSaved?.episode === ep.episode;

                    return (
                      <div
                        key={ep.id ? `${ep.id}-${idx}` : idx}
                        ref={(el) => {
                          episodeItemRefs.current[idx] = el;
                        }}
                        onClick={() => {
                          const epNum = ep.episode || idx + 1;
                          setSelectedEpisode(epNum);
                          saveLastEp(selectedSeason, epNum);
                          setStep('streams');
                          setFocusedIndex(0);
                        }}
                        style={
                          isFocused
                            ? {
                                borderColor: 'var(--app-focus-border, var(--app-accent))',
                                boxShadow:
                                  '0 0 0 3px var(--app-focus-border, var(--app-accent)), 0 0 24px var(--app-accent-glow)',
                              }
                            : isSelected
                            ? {
                                borderColor: 'color-mix(in srgb, var(--app-accent) 60%, transparent)',
                                background: 'color-mix(in srgb, var(--app-accent) 12%, transparent)',
                              }
                            : undefined
                        }
                        className={`p-4 rounded-2xl border transition-all duration-150 cursor-pointer flex items-center justify-between gap-4 app-card-item ${
                          isFocused
                            ? 'is-focused border-2'
                            : isSelected
                            ? 'border'
                            : 'border-white/15 hover:border-white/30'
                        }`}
                      >
                        <div className="flex items-center gap-3.5 min-w-0 flex-1">
                          <div
                            style={{
                              background: 'color-mix(in srgb, var(--app-accent) 18%, transparent)',
                              color: 'var(--app-accent)',
                              borderColor: 'color-mix(in srgb, var(--app-accent) 40%, transparent)',
                            }}
                            className="w-10 h-10 rounded-xl border flex items-center justify-center font-black text-sm flex-shrink-0"
                          >
                            E{ep.episode || idx + 1}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-0.5">
                              <h3 className="text-sm font-bold text-white truncate">
                                {ep.title || `Episódio ${ep.episode || idx + 1}`}
                              </h3>
                              {isSaved && (
                                <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">
                                  Último Visto
                                </span>
                              )}
                            </div>
                            {ep.overview && (
                              <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">
                                {ep.overview}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          {isFocused && (
                            <ControllerButtonBadge button="A" label="Ver Fontes" size="sm" />
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}


          {/* STEP 3: STREAMS SELECTION */}
          {step === 'streams' && (
            <>
                {/* Rail Header with Filter Notice */}
              <div className="mb-2 px-1">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2.5">
                    <Radio className="w-4 h-4 animate-pulse" style={{ color: 'var(--app-accent)' }} />
                    <h2 className="text-sm font-black uppercase tracking-wider text-white">
                      Fontes Disponíveis ({visibleStreams.length})
                    </h2>
                  </div>
                  <span className="text-xs text-zinc-400 font-semibold hidden md:inline">
                    Selecione com D-Pad e confirme com (A)
                  </span>
                </div>

                {/* Filter banner */}
                {isPtBrOnly && (
                  <div
                    style={{
                      color: 'var(--app-accent)',
                      background: 'color-mix(in srgb, var(--app-accent) 12%, transparent)',
                      borderColor: 'color-mix(in srgb, var(--app-accent) 40%, transparent)',
                    }}
                    className="flex items-center justify-between px-3.5 py-2 rounded-xl border text-xs animate-fade-in"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-base">🇧🇷</span>
                      <span className="font-semibold">
                        Exibindo apenas transmissões com dublagem / áudio em Português
                      </span>
                    </div>
                    <button
                      onClick={() => setIsPtBrOnly(false)}
                      style={{ color: 'var(--app-accent)' }}
                      className="text-[11px] underline hover:text-white cursor-pointer ml-3 font-bold transition-colors"
                    >
                      Exibir todas
                    </button>
                  </div>
                )}
              </div>

              {/* Scrollable Stream Sources List with Gutter Padding to Prevent Focus Clipping */}
              <div
                ref={scrollContainerRef}
                className="flex-1 overflow-y-auto px-3 py-2 space-y-3.5 no-scrollbar"
              >
                {loadingStreams ? (
                  <div className="flex flex-col items-center justify-center h-64 text-zinc-400 gap-3">
                    <Sparkles className="w-6 h-6 animate-spin" style={{ color: 'var(--app-accent)' }} />
                    <span className="text-sm font-bold">Buscando torrents e streams via Addons...</span>
                    <span className="text-xs text-zinc-500">
                      {isSeries
                        ? `Consultando episódio T${selectedSeason}:E${selectedEpisode}`
                        : 'Consultando Torrentio e addons comunitários'}
                    </span>
                  </div>
                ) : visibleStreams.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-64 text-center p-8 bg-white/5 border border-white/10 rounded-2xl mx-1">
                    <Volume2 className="w-10 h-10 text-zinc-500 mb-3" />
                    <h3 className="text-base font-bold text-white mb-1">
                      {isPtBrOnly
                        ? 'Nenhuma fonte com áudio PT-BR encontrada'
                        : 'Nenhuma fonte encontrada para este episódio/título'}
                    </h3>
                    <p className="text-xs text-zinc-400 max-w-md mb-5">
                      {isPtBrOnly
                        ? 'Não foram localizados torrents com tags [DUBLADO], [DUAL] ou [PT-BR] para esta seleção.'
                        : 'Tente alternar o episódio ou verificar outros addons comunitários.'}
                    </p>

                    {isPtBrOnly && (
                      <button
                        onClick={() => {
                          setIsPtBrOnly(false);
                          setFocusedIndex(0);
                        }}
                        style={{
                          backgroundColor: 'var(--app-accent)',
                          boxShadow: '0 4px 14px var(--app-accent-glow)',
                        }}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white cursor-pointer transition-all hover:scale-105"
                      >
                        <ControllerButtonBadge button="Y" size="sm" />
                        <span>Ver Todas as Fontes Disponíveis ({parsedAllStreams.length})</span>
                      </button>
                    )}
                  </div>
                ) : (
                  visibleStreams.map((item, idx) => {
                    const isFocused = focusedIndex === idx;

                    // Color coding for resolution
                    const is4k = item.resolution === '4K';
                    const is1080p = item.resolution === '1080p';

                    return (
                      <div
                        key={idx}
                        ref={(el) => {
                          streamItemRefs.current[idx] = el;
                        }}
                        onClick={() => {
                          const currentStreamId = isSeries
                            ? `${preview.id}:${selectedSeason}:${selectedEpisode}`
                            : preview.id;
                          saveLastEp(selectedSeason, selectedEpisode);
                          onPlayStream(item.stream, detail || preview, rawStreams, currentStreamId);
                        }}
                        style={
                          isFocused
                            ? {
                                borderColor: 'var(--app-focus-border, var(--app-accent))',
                                boxShadow:
                                  '0 0 0 3px var(--app-focus-border, var(--app-accent)), 0 0 24px var(--app-accent-glow), 0 8px 24px rgba(0,0,0,0.85)',
                              }
                            : undefined
                        }
                        className={`relative mx-1 p-4 rounded-2xl border transition-all duration-150 cursor-pointer flex items-center justify-between gap-4 app-card-item ${
                          isFocused
                            ? 'is-focused border-2 z-10'
                            : 'border-white/15 hover:border-white/30'
                        }`}
                      >
                        {/* Glowing Left Neon Indicator when Focused */}
                        {isFocused && (
                          <div
                            style={{
                              background: 'var(--app-accent)',
                              boxShadow: '0 0 12px color-mix(in srgb, var(--app-accent) 90%, transparent)',
                            }}
                            className="absolute left-0 top-3 bottom-3 w-1.5 rounded-r-full"
                          />
                        )}

                        {/* Left: Play Icon & Badges */}
                        <div className="flex items-center gap-4 min-w-0 flex-1 pl-1">
                          <div
                            style={isFocused ? { backgroundColor: 'var(--app-accent)' } : undefined}
                            className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${
                              isFocused
                                ? 'text-white shadow-lg'
                                : 'bg-zinc-800 text-zinc-400 group-hover:text-white'
                            }`}
                          >
                            <Play className="w-4 h-4 fill-current ml-0.5" />
                          </div>

                          <div className="min-w-0 flex-1">
                            {/* Badges Line */}
                            <div className="flex flex-wrap items-center gap-2 mb-1.5">
                              {/* Resolution Badge */}
                              <span
                                className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider ${
                                  is4k
                                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                    : is1080p
                                    ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40'
                                    : 'bg-zinc-700/50 text-zinc-300 border border-zinc-600/50'
                                }`}
                              >
                                {item.resolutionBadge}
                              </span>

                              {/* Audio / Dubbing Badge (Dual Áudio, Multi Áudio, Dublado, Original) */}
                              {item.audioBadge && (
                                <span
                                  className={`px-2 py-0.5 rounded-md text-[10px] font-black tracking-wider flex items-center gap-1 shadow-sm ${
                                    item.audioBadge.type === 'dual'
                                      ? 'bg-purple-500/25 text-purple-200 border border-purple-500/50 shadow-purple-500/20'
                                      : item.audioBadge.type === 'multi'
                                      ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-500/50 shadow-cyan-500/20'
                                      : item.audioBadge.type === 'ptbr'
                                      ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/45 shadow-emerald-500/20'
                                      : 'bg-zinc-800 text-zinc-300 border border-zinc-700/60'
                                  }`}
                                >
                                  {item.audioBadge.label}
                                </span>
                              )}

                              {/* Addon Provider */}
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-white/5 text-zinc-400 border border-white/10">
                                {item.addonName}
                              </span>

                              {/* Codec */}
                              {item.videoCodec && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-black/40 text-zinc-400">
                                  {item.videoCodec}
                                </span>
                              )}

                              {/* Audio channels */}
                              {item.audioInfo && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-black/40 text-zinc-400">
                                  {item.audioInfo}
                                </span>
                              )}
                            </div>

                            {/* Title */}
                            <div className="text-xs lg:text-sm font-bold text-zinc-200 truncate leading-snug">
                              {item.cleanTitle}
                            </div>

                            {/* Seeders & File Size details */}
                            <div className="flex items-center gap-4 text-[11px] text-zinc-400 mt-1">
                              {item.seeds !== null && (
                                <span style={{ color: 'var(--app-accent)' }} className="flex items-center gap-1 font-semibold">
                                  <span
                                    style={{ background: 'var(--app-accent)' }}
                                    className="w-1.5 h-1.5 rounded-full"
                                  />
                                  {item.seeds} seeds
                                </span>
                              )}
                              {item.size && (
                                <span className="flex items-center gap-1 text-zinc-400">
                                  <HardDrive className="w-3 h-3 text-zinc-500" />
                                  {item.size}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Right: Controller Action Hint when Focused */}
                        {isFocused && (
                          <div className="flex-shrink-0 flex items-center gap-2 pl-2">
                            <ControllerButtonBadge button="A" label="Reproduzir" size="sm" />
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

            </>
          )}
        </section>
      </main>

      {/* Bottom Console Hints HUD */}
      <footer className="relative z-20 flex flex-wrap items-center justify-between px-10 py-3.5 border-t app-header-bar text-xs gap-4">
        <div className="flex flex-wrap items-center gap-6">
          {step === 'seasons' && (
            <>
              <ControllerButtonBadge glass button="A" label="Selecionar Temporada" size="sm" />
              <ControllerButtonBadge glass button="B" label="Catálogo" size="sm" />
              <div className="hidden md:flex items-center gap-2 text-zinc-400 text-[11px]">
                <span className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 font-bold">
                  D-Pad ↑↓
                </span>
                <span>Navegar Temporadas</span>
              </div>
            </>
          )}

          {step === 'episodes' && (
            <>
              <ControllerButtonBadge glass button="A" label="Ver Fontes do Episódio" size="sm" />
              <ControllerButtonBadge glass button="B" label="Catálogo" size="sm" />
              {seasons.length > 1 && (
                <ControllerButtonBadge glass button="X" label="Trocar Temporada" size="sm" />
              )}
              <div className="hidden md:flex items-center gap-2 text-zinc-400 text-[11px]">
                <span className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 font-bold">
                  D-Pad ↑↓
                </span>
                <span>Navegar Episódios</span>
              </div>
            </>
          )}

          {step === 'streams' && (
            <>
              <ControllerButtonBadge glass button="A" label="Reproduzir Fonte" size="sm" />
              <ControllerButtonBadge glass button="B" label="Catálogo" size="sm" />
              {isSeries && (
                <ControllerButtonBadge glass button="X" label="Trocar Episódio" size="sm" />
              )}
              <ControllerButtonBadge glass
                button="Y"
                label={isPtBrOnly ? 'Desativar Filtro Dublado' : 'Filtrar Dublado (PT-BR)'}
                size="sm"
              />

              {/* Series Controller Shortcuts in Footer */}
              {isSeries && (
                <>
                  <div className="liquid-glass-detail flex items-center gap-1.5 text-zinc-300 text-xs">
            <LiquidGlassLayer />
                    <ControllerButtonBadge button="LB" size="sm" />
                    <ControllerButtonBadge button="RB" label="Temporadas" size="sm" />
                  </div>
                  <div className="liquid-glass-detail flex items-center gap-1.5 text-zinc-300 text-xs">
            <LiquidGlassLayer />
                    <ControllerButtonBadge button="LT" size="sm" />
                    <ControllerButtonBadge button="RT" label="Episódios" size="sm" />
                  </div>
                </>
              )}

              <div className="hidden md:flex items-center gap-2 text-zinc-400 text-[11px]">
                <span className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 font-bold">
                  D-Pad ↑↓
                </span>
                <span>Navegar Fontes</span>
              </div>
            </>
          )}

          <div className="hidden lg:flex items-center gap-4 text-zinc-400 text-[11px] border-l border-white/10 pl-4">
            <div className="flex items-center gap-1.5">
              <span className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 font-bold text-zinc-200">
                RS ↑↓
              </span>
              <span>Rolar Detalhes</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 font-bold text-zinc-200">
                LS ↑↓
              </span>
              <span>Rolar Lista</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 text-zinc-500 font-bold text-[11px]">
          <span>STREMIO 10-FOOT BLADE</span>
        </div>
      </footer>
    </div>
  );
};
