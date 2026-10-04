import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { LiquidGlassLayer } from './LiquidGlassLayer';
import Hls from 'hls.js';
import type { StremioMetaDetail, StremioMetaPreview, StremioStream, StremioSubtitle } from '../types/stremio';
import { StremioService } from '../services/stremio';
import { SettingsService } from '../services/settings';
import { ControllerButtonBadge } from './ControllerButtonBadge';
import { GamepadManager, type GamepadAction } from '../services/gamepad';
import { parseStream } from '../utils/streamParser';
import { adjacentEpisodes, preferredEpisodeStream } from '../utils/episodeNavigation';
import {
  formatLanguageName,
  getFallbackSubtitles,
  parseSubtitleDetails,
  type GroupedSubtitleOption,
  type SubtitleCue,
  parseSubtitlesToCues,
} from '../utils/subtitleHelper';
import {
  Volume2,
  Volume1,
  VolumeX,
  Subtitles,
  Check,
  X,
  Sparkles,
  Sun,
  SunMedium,
  Moon,
  Rewind,
  FastForward,
  Play,
  SkipBack,
  SkipForward,
} from 'lucide-react';

interface Props {
  stream: StremioStream;
  meta: StremioMetaPreview;
  streamId?: string;
  onExit: () => void;
  availableStreams?: StremioStream[];
  onEpisodeChange?: (stream: StremioStream, streamId: string, streams: StremioStream[]) => void;
}

interface AudioTrackOption {
  id: string;
  label: string;
  sublabel?: string;
  isPtBr: boolean;
  trackIndex: number;
  streamId?: string;
  enabled?: boolean;
}

export const VideoPlayer: React.FC<Props> = ({
  stream: initialStream,
  meta,
  streamId,
  onExit,
  onEpisodeChange,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  // Active Stream (fixed to selected file - no stream swapping)
  const [resolvedStream, setResolvedStream] = useState(initialStream);
  const currentStream = resolvedStream;
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [needsInteraction, setNeedsInteraction] = useState(false);
  const volumeRef = useRef(1);
  const resumeTimeRef = useRef(0);
  const [playbackAttempt, setPlaybackAttempt] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isBuffering, setIsBuffering] = useState(true);
  const [pauseControl, setPauseControl] = useState(1);
  const [episodeVideos, setEpisodeVideos] = useState<StremioMetaDetail['videos']>((meta as StremioMetaDetail).videos);
  const [episodeChanging, setEpisodeChanging] = useState(false);
  const [episodeError, setEpisodeError] = useState<string | null>(null);
  const episodeRequestRef = useRef(0);
  const episodeBusyRef = useRef(false);
  const neighbors = useMemo(() => adjacentEpisodes(episodeVideos, streamId), [episodeVideos, streamId]);
  const currentEpisode = useMemo(() => {
    const video = episodeVideos?.find((entry) => entry.id === streamId);
    if (video && Number.isInteger(video.season) && Number.isInteger(video.episode)) return video;
    const parts = meta.type === 'series' ? streamId?.match(/:(\d+):(\d+)$/) : null;
    return parts ? { season: Number(parts[1]), episode: Number(parts[2]) } : null;
  }, [episodeVideos, streamId, meta.type]);
  useEffect(() => {
    let cancelled = false;
    if (meta.type === 'series' && onEpisodeChange && !(meta as StremioMetaDetail).videos) {
      void StremioService.getMeta(meta.type, meta.id).then((detail) => { if (!cancelled) setEpisodeVideos(detail?.videos); });
    }
    return () => { cancelled = true; episodeRequestRef.current++; };
  }, [meta, onEpisodeChange]);
  const changeEpisode = useCallback(async (direction: -1 | 1) => {
    const target = direction < 0 ? neighbors.previous : neighbors.next;
    if (!target || !onEpisodeChange || episodeBusyRef.current) return;
    episodeBusyRef.current = true;
    setEpisodeChanging(true); setEpisodeError(null);
    const request = ++episodeRequestRef.current;
    try {
      const streams = await StremioService.getStreams(meta.type, target.id);
      if (request !== episodeRequestRef.current) return;
      const stream = preferredEpisodeStream(streams, currentStream);
      if (!stream) { setEpisodeError('Nenhuma fonte disponível para este episódio.'); return; }
      try { localStorage.setItem(`stremio_last_ep_${meta.id}`, JSON.stringify({ season: target.season, episode: target.episode })); } catch {}
      onEpisodeChange(stream, target.id, streams);
    } catch {
      if (request === episodeRequestRef.current) setEpisodeError('Não foi possível carregar o episódio. Tente novamente.');
    } finally {
      if (request === episodeRequestRef.current) { episodeBusyRef.current = false; setEpisodeChanging(false); }
    }
  }, [neighbors, onEpisodeChange, meta, currentStream]);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showOsd, setShowOsd] = useState(true);
  const osdTimerRef = useRef<number | null>(null);

  // Torrent engine and swarm tracking state
  const [engineReady, setEngineReady] = useState<boolean>(!currentStream.infoHash);
  const [engineStatus, setEngineStatus] = useState<string>(
    currentStream.infoHash ? 'Conectando aos rastreadores e enxame de peers...' : 'Iniciando transmissão...'
  );
  const [peerCount, setPeerCount] = useState<number>(0);
  const [downloadSpeed, setDownloadSpeed] = useState<number>(0);

  // Modals: 'none' | 'audio' | 'subtitles'
  const [activeModal, setActiveModal] = useState<'none' | 'audio' | 'subtitles'>('none');
  const [modalFocusIndex, setModalFocusIndex] = useState<number>(0);

  // Internal Audio Tracks of the active file (loaded dynamically from container / HLS manifest)
  const [availableAudioTracks, setAvailableAudioTracks] = useState<AudioTrackOption[]>([]);
  const [selectedTrackIndex, setSelectedTrackIndex] = useState<number>(0);
  const hasMultipleAudio = availableAudioTracks.length > 1;
  const hasUserSelectedAudioRef = useRef<boolean>(false);
  const probedAudioStreamsRef = useRef<any[]>([]);

  // Subtitles
  const [subtitles, setSubtitles] = useState<StremioSubtitle[]>([]);
  const [selectedSubId, setSelectedSubId] = useState<string | null>(null);
  const [activeCueText, setActiveCueText] = useState<string | null>(null);
  const [subtitleBackground, setSubtitleBackground] = useState(() => SettingsService.getSubtitleAppearance().background);
  const [subtitleSize, setSubtitleSize] = useState(() => SettingsService.getSubtitleAppearance().size);
  const playbackControlsRef = useRef<HTMLDivElement>(null);
  const [subtitleBottom, setSubtitleBottom] = useState(180);
  const subtitleAppearanceRef = useRef({ background: subtitleBackground, size: subtitleSize });
  const toggleSubtitleBackground = useCallback(() => {
    const appearance = subtitleAppearanceRef.current;
    appearance.background = !appearance.background;
    setSubtitleBackground(appearance.background);
    SettingsService.setSubtitleAppearance(appearance.background, appearance.size);
  }, []);
  const adjustSubtitleSize = useCallback((delta: number) => {
    const appearance = subtitleAppearanceRef.current;
    appearance.size = Math.max(70, Math.min(180, appearance.size + delta));
    setSubtitleSize(appearance.size);
    SettingsService.setSubtitleAppearance(appearance.background, appearance.size);
  }, []);
  useEffect(() => {
    const controls = playbackControlsRef.current;
    if (!controls) return;
    const position = () => setSubtitleBottom(Math.max(80, window.innerHeight - controls.getBoundingClientRect().top + 24));
    position();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(position);
    observer?.observe(controls);
    window.addEventListener('resize', position);
    return () => { observer?.disconnect(); window.removeEventListener('resize', position); };
  }, []);
  const [loadingSub, setLoadingSub] = useState<boolean>(false);
  const activeCuesRef = useRef<SubtitleCue[]>([]);

  // Subtitle Language Filter Tab: 'all' | 'por' | 'eng' | 'other'
  type SubtitleLangFilter = 'all' | 'por' | 'eng' | 'other';
  const [subLangFilter, setSubLangFilter] = useState<SubtitleLangFilter>('all');

  // Drawer Scroll Containers and Item Refs
  const audioScrollRef = useRef<HTMLDivElement>(null);
  const subtitleScrollRef = useRef<HTMLDivElement>(null);
  const audioItemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const subtitleItemRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Audio Tracks
  const [activeAudioLabel, setActiveAudioLabel] = useState<string>('Áudio Original');

  // Volume State (L1 / R1)
  const [volume, setVolume] = useState<number>(1.0);
  const [showVolumeHud, setShowVolumeHud] = useState<boolean>(false);
  const volumeTimerRef = useRef<number | null>(null);

  // Brightness State (RT)
  const [brightness, setBrightness] = useState<number>(100);
  const [showBrightnessHud, setShowBrightnessHud] = useState<boolean>(false);
  const brightnessTimerRef = useRef<number | null>(null);

  // Seek / Scrub State (LT)
  const [seekFeedback, setSeekFeedback] = useState<{
    type: 'rewind' | 'forward';
    seconds: number;
    cumulative?: number;
  } | null>(null);
  const seekFeedbackTimerRef = useRef<number | null>(null);

  // Safety timestamp to completely isolate volume adjustments from accidental trigger seeks
  const lastVolumeTimeRef = useRef<number>(0);

  const resetOsdTimer = useCallback(() => {
    setShowOsd(true);
    if (osdTimerRef.current) clearTimeout(osdTimerRef.current);
    // Keep OSD visible while modal drawer is open OR while playback is paused
    if (activeModal === 'none' && isPlaying) {
      osdTimerRef.current = window.setTimeout(() => {
        setShowOsd(false);
      }, 5000);
    }
  }, [activeModal, isPlaying]);

  const togglePlayPause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            setIsPlaying(true);
            setNeedsInteraction(false);
          })
          .catch((err) => {
            console.warn('Falha ao despausar vídeo:', err);
          });
      }
    } else {
      video.pause();
      setIsPlaying(false);
    }
    resetOsdTimer();
    GamepadManager.pulseHaptic(20, 0.2, 0.2);
  }, [resetOsdTimer]);

  const adjustVolume = useCallback((delta: number) => {
    lastVolumeTimeRef.current = Date.now();
    setVolume((prev) => {
      const next = Math.min(1.0, Math.max(0.0, Math.round((prev + delta) * 100) / 100));
      if (videoRef.current) {
        videoRef.current.volume = next;
        videoRef.current.muted = next === 0;
      }
      return next;
    });
    setShowVolumeHud(true);
    setShowBrightnessHud(false);
    if (volumeTimerRef.current) clearTimeout(volumeTimerRef.current);
    volumeTimerRef.current = window.setTimeout(() => {
      setShowVolumeHud(false);
    }, 2200);
    GamepadManager.pulseHaptic(25, 0.2, 0.2);
  }, []);

  const cycleBrightness = useCallback(() => {
    const presets = [100, 115, 130, 150, 40, 60, 80];
    setBrightness((prev) => {
      const currentIdx = presets.indexOf(prev);
      const next = currentIdx === -1 ? 100 : presets[(currentIdx + 1) % presets.length];
      return next;
    });
    setShowBrightnessHud(true);
    setShowVolumeHud(false);
    if (brightnessTimerRef.current) clearTimeout(brightnessTimerRef.current);
    brightnessTimerRef.current = window.setTimeout(() => {
      setShowBrightnessHud(false);
    }, 2200);
    GamepadManager.pulseHaptic(25, 0.2, 0.2);
  }, []);

  const updateActiveSubtitle = useCallback((nowSec: number) => {
    const cues = activeCuesRef.current;
    if (cues.length === 0) {
      setActiveCueText((prev) => (prev !== null ? null : prev));
      return;
    }
    const match = cues.find((c) => nowSec >= c.start && nowSec <= c.end);
    const nextText = match ? match.text : null;
    setActiveCueText((prev) => (prev !== nextText ? nextText : prev));
  }, []);

  const triggerSeek = useCallback((seconds: number) => {
    // If volume was adjusted within 450ms, discard seek to eliminate accidental resting trigger brushes
    if (Date.now() - lastVolumeTimeRef.current < 450) {
      return;
    }
    if (!videoRef.current) return;
    const v = videoRef.current;
    const newTime = Math.min(v.duration || 0, Math.max(0, v.currentTime + seconds));
    v.currentTime = newTime;
    setCurrentTime(newTime);

    setSeekFeedback((prev) => {
      const type = seconds >= 0 ? 'forward' : 'rewind';
      const prevCumul = prev && prev.type === type ? (prev.cumulative || 0) : 0;
      return {
        type,
        seconds: Math.abs(seconds),
        cumulative: prevCumul + Math.abs(seconds),
      };
    });

    if (seekFeedbackTimerRef.current) clearTimeout(seekFeedbackTimerRef.current);
    seekFeedbackTimerRef.current = window.setTimeout(() => {
      setSeekFeedback(null);
    }, 1400);

    updateActiveSubtitle(newTime);
    resetOsdTimer();
    GamepadManager.pulseHaptic(25, 0.2, 0.2);
  }, [resetOsdTimer, updateActiveSubtitle]);

  const directVideoUrl = useMemo(() => StremioService.buildPlaybackUrl(currentStream), [currentStream]);

  useEffect(() => { volumeRef.current = volume; }, [volume]);

  const unlockAudio = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.muted = volume === 0;
      videoRef.current.volume = volume;
    }
  }, [volume]);

  // Keep OSD visible while a modal drawer is open or playback state changes
  useEffect(() => {
    if (activeModal !== 'none' || !isPlaying) {
      setShowOsd(true);
      if (osdTimerRef.current) clearTimeout(osdTimerRef.current);
    } else {
      resetOsdTimer();
    }
  }, [activeModal, isPlaying, resetOsdTimer]);

  // Load Subtitles from OpenSubtitles v3 and Addons
  useEffect(() => {
    let isMounted = true;
    const queryId = streamId || meta.id;
    StremioService.getSubtitles(meta.type, queryId).then((subs) => {
      if (!isMounted) return;
      if (subs.length > 0) {
        setSubtitles(subs);
      } else {
        setSubtitles(getFallbackSubtitles());
      }
    });

    return () => {
      isMounted = false;
    };
  }, [meta, streamId]);

  // Process and group subtitles: Portuguese first, then English, then others
  const parsedSubtitles = useMemo(() => {
    const ptSubs: StremioSubtitle[] = [];
    const enSubs: StremioSubtitle[] = [];
    const othersByLang: Record<string, StremioSubtitle[]> = {};

    subtitles.forEach((s) => {
      const code = (s.lang || 'other').toLowerCase();
      if (/por|pob|pt|br/.test(code)) {
        ptSubs.push(s);
      } else if (/eng|en/.test(code)) {
        enSubs.push(s);
      } else {
        if (!othersByLang[code]) othersByLang[code] = [];
        othersByLang[code].push(s);
      }
    });

    const result: GroupedSubtitleOption[] = [];

    ptSubs.forEach((sub, idx) => {
      result.push(parseSubtitleDetails(sub, idx));
    });

    enSubs.forEach((sub, idx) => {
      result.push(parseSubtitleDetails(sub, idx));
    });

    Object.values(othersByLang).forEach((list) => {
      list.forEach((sub, idx) => {
        result.push(parseSubtitleDetails(sub, idx));
      });
    });

    return result;
  }, [subtitles]);

  // Filtered by selected language tab
  const displayedSubtitles = useMemo(() => {
    if (subLangFilter === 'all') return parsedSubtitles;
    if (subLangFilter === 'por') {
      return parsedSubtitles.filter((s) => /por|pob|pt|br/.test(s.langGroup));
    }
    if (subLangFilter === 'eng') {
      return parsedSubtitles.filter((s) => /eng|en/.test(s.langGroup));
    }
    return parsedSubtitles.filter((s) => !/por|pob|pt|br|eng|en/.test(s.langGroup));
  }, [parsedSubtitles, subLangFilter]);

  const ptCount = useMemo(
    () => parsedSubtitles.filter((s) => /por|pob|pt|br/.test(s.langGroup)).length,
    [parsedSubtitles]
  );
  const enCount = useMemo(
    () => parsedSubtitles.filter((s) => /eng|en/.test(s.langGroup)).length,
    [parsedSubtitles]
  );
  const otherCount = Math.max(0, parsedSubtitles.length - ptCount - enCount);

  // Auto-scroll inside active flyout drawer when focus index changes
  useEffect(() => {
    if (activeModal === 'audio') {
      const el = audioItemRefs.current[modalFocusIndex];
      if (el) {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    } else if (activeModal === 'subtitles') {
      const el = subtitleItemRefs.current[modalFocusIndex];
      if (el) {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [modalFocusIndex, activeModal, subLangFilter]);

  // Detect internal audio tracks from HTMLMediaElement.audioTracks (if Hls.js hasn't populated them)
  const detectAudioTracks = useCallback(() => {
    const v = videoRef.current as any;
    if (!v) return;

    if (hlsRef.current) return;

    const tracks: AudioTrackOption[] = [];

    if (v.audioTracks && v.audioTracks.length > 0) {
      for (let i = 0; i < v.audioTracks.length; i++) {
        const t = v.audioTracks[i];
        const lang = (t.language || '').toLowerCase();
        const rawLabel = t.label || (lang ? formatLanguageName(lang) : `Faixa ${i + 1}`);
        const isPt = /por|pob|pt|br/i.test(lang) || /portugu[eê]s|dublad/i.test(rawLabel);

        let displayLabel = rawLabel;
        if (isPt) {
          displayLabel = `🇧🇷 ${rawLabel.replace(/^(🇧🇷|\s)+/, '')}`;
          if (!/dublad|dual|portugu/i.test(displayLabel)) {
            displayLabel += ' (Dublado PT-BR)';
          }
        } else {
          displayLabel = `🌐 ${rawLabel.replace(/^(🌐|\s)+/, '')}`;
        }

        tracks.push({
          id: t.id || `audio-track-${i}`,
          label: displayLabel,
          sublabel: lang
            ? `Idioma: ${lang.toUpperCase()}${t.kind ? ` • ${t.kind}` : ''}`
            : t.kind
            ? `Tipo: ${t.kind}`
            : undefined,
          isPtBr: isPt,
          trackIndex: i,
          enabled: Boolean(t.enabled),
        });
      }
    }

    if (tracks.length > 0) {
      setAvailableAudioTracks(tracks);
      const active = (hasUserSelectedAudioRef.current ? tracks.find((t) => t.enabled) : tracks.find((t) => t.isPtBr)) || tracks.find((t) => t.enabled) || tracks[0];
      setSelectedTrackIndex(active.trackIndex);
      setActiveAudioLabel(active.label);
      if (v.audioTracks) {
        for (let i = 0; i < v.audioTracks.length; i++) {
          if (v.audioTracks[i].enabled !== (i === active.trackIndex)) v.audioTracks[i].enabled = i === active.trackIndex;
        }
      }
    }
  }, []);

  const parsedTorrent = useMemo(() => parseStream(currentStream), [currentStream]);

  // Unified Audio Track builder merging HLS manifest, ffprobe stream info, and container tags
  const updateAudioTracks = useCallback(
    (hlsTracks: any[] = [], probedStreams: any[] = []) => {
      const count = hlsTracks.length;
      if (count === 0) return;

      const tracks: AudioTrackOption[] = [];

      for (let idx = 0; idx < count; idx++) {
        const hls = hlsTracks[idx];
        const probed = probedStreams[idx];

        const lang = (probed?.language || probed?.lang || hls?.lang || '').toLowerCase().trim();
        const rawTitle = (probed?.title || probed?.label || hls?.name || '').trim();
        const codec = (probed?.codec || probed?.codec_name || '').toUpperCase().trim();
        const channels = probed?.channels
          ? probed.channels === 6
            ? '5.1'
            : probed.channels === 8
            ? '7.1'
            : probed.channels === 2
            ? 'Estéreo'
            : `${probed.channels}.0`
          : '';

        let isPt =
          /por|pob|pt|br/i.test(lang) ||
          /portugu[eê]s|dublad|pt-?br/i.test(rawTitle);

        // Contextual inference for untagged Brazilian dual-audio releases
        if (!isPt && parsedTorrent.isPtBr && count >= 2) {
          const otherIdx = idx === 0 ? 1 : 0;
          const otherLang = (probedStreams[otherIdx]?.language || probedStreams[otherIdx]?.lang || hlsTracks[otherIdx]?.lang || '').toLowerCase();
          const otherTitle = (probedStreams[otherIdx]?.title || probedStreams[otherIdx]?.label || hlsTracks[otherIdx]?.name || '').toLowerCase();
          if (/eng|en|original|french|fre|spa/i.test(otherLang) || /ingl[eê]s|original/i.test(otherTitle)) {
            if (!lang || lang === 'und' || /dub|audio/i.test(rawTitle)) {
              isPt = true;
            }
          }
        }

        let label = '';
        if (isPt) {
          label = '🇧🇷 Português';
          if (rawTitle && !/portugu/i.test(rawTitle)) {
            label += ` (${rawTitle})`;
          } else {
            label += ' (Dublado PT-BR)';
          }
        } else if (/eng|en/i.test(lang) || /ingl[eê]s|english|original/i.test(rawTitle)) {
          label = '🇺🇸 Inglês';
          if (rawTitle && !/ingl/i.test(rawTitle)) {
            label += ` (${rawTitle})`;
          } else {
            label += ' (Original)';
          }
        } else if (/spa|es/i.test(lang) || /espanhol|spanish/i.test(rawTitle)) {
          label = `🇪🇸 Espanhol${rawTitle ? ` (${rawTitle})` : ''}`;
        } else if (/jpn|ja/i.test(lang) || /japon[eê]s|japanese/i.test(rawTitle)) {
          label = `🇯🇵 Japonês${rawTitle ? ` (${rawTitle})` : ''}`;
        } else if (/fre|fra|fr/i.test(lang) || /franc[eê]s|french/i.test(rawTitle)) {
          label = `🇫🇷 Francês${rawTitle ? ` (${rawTitle})` : ''}`;
        } else if (/ger|deu|de/i.test(lang) || /alem[aã]o|german/i.test(rawTitle)) {
          label = `🇩🇪 Alemão${rawTitle ? ` (${rawTitle})` : ''}`;
        } else if (/ita|it/i.test(lang) || /italiano|italian/i.test(rawTitle)) {
          label = `🇮🇹 Italiano${rawTitle ? ` (${rawTitle})` : ''}`;
        } else if (/rus|ru/i.test(lang) || /russo|russian/i.test(rawTitle)) {
          label = `🇷🇺 Russo${rawTitle ? ` (${rawTitle})` : ''}`;
        } else {
          label = `🌐 ${rawTitle || (lang ? formatLanguageName(lang) : `Faixa ${idx + 1}`)}`;
        }

        const sublabelParts = [
          lang ? `Idioma: ${lang.toUpperCase()}` : null,
          codec ? `Codec: ${codec}` : null,
          channels ? `Canais: ${channels}` : null,
          probed?.default ? 'Padrão' : null,
        ].filter(Boolean);

        tracks.push({
          id: `audio-track-${idx}`,
          label,
          sublabel: sublabelParts.length > 0 ? sublabelParts.join(' • ') : undefined,
          isPtBr: isPt,
          trackIndex: idx,
          streamId: `audio${idx}`,
          enabled: idx === 0,
        });
      }

      setAvailableAudioTracks(tracks);

      // Auto-prioritize PT-BR track if user hasn't explicitly chosen one
      if (!hasUserSelectedAudioRef.current) {
        const ptTrack = tracks.find((t) => t.isPtBr);
        if (ptTrack) {
          setSelectedTrackIndex(ptTrack.trackIndex);
          setActiveAudioLabel(ptTrack.label);
          if (
            hlsRef.current &&
            hlsRef.current.audioTracks &&
            hlsRef.current.audioTracks.length > ptTrack.trackIndex &&
            hlsRef.current.audioTrack !== ptTrack.trackIndex
          ) {
            hlsRef.current.audioTrack = ptTrack.trackIndex;
          }
        } else if (tracks.length > 0) {
          const curIdx =
            hlsRef.current && hlsRef.current.audioTrack >= 0 ? hlsRef.current.audioTrack : 0;
          setSelectedTrackIndex(curIdx);
          setActiveAudioLabel(tracks[curIdx]?.label || tracks[0].label);
        }
      }
    },
    [parsedTorrent.isPtBr]
  );

  // Resolve the actual torrent file before constructing any playback URL.
  useEffect(() => {
    let cancelled = false;
    setResolvedStream(initialStream);
    setEngineReady(!initialStream.infoHash || !!initialStream.url);
    setPlaybackError(null);
    setNeedsInteraction(false);
    setAvailableAudioTracks([]);
    hasUserSelectedAudioRef.current = false;
    probedAudioStreamsRef.current = [];
    if (!initialStream.infoHash || initialStream.url) return;
    setEngineStatus('Obtendo metadados do torrent...');
    const parts = streamId?.split(':');
    const seriesInfo = parts && parts.length >= 3
      ? { season: Number(parts[parts.length - 2]), episode: Number(parts[parts.length - 1]) }
      : undefined;
    void StremioService.createTorrentEngine(initialStream, seriesInfo).then((data) => {
      if (cancelled) return;
      const idx = initialStream.fileIdx ?? data?.guessedFileIdx;
      if (!Number.isInteger(idx) || (idx as number) < 0) {
        setPlaybackError('Não foi possível identificar o arquivo do torrent. Escolha outra fonte ou tente novamente.');
        setIsBuffering(false);
        return;
      }
      setResolvedStream({ ...initialStream, fileIdx: idx });
      setEngineStatus('Preparando vídeo e áudio...');
      setEngineReady(true);
    });
    return () => { cancelled = true; };
  }, [initialStream, streamId, playbackAttempt]);

  useEffect(() => {
    if (!currentStream.infoHash || !engineReady) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const stats = await StremioService.getTorrentStats(currentStream.infoHash!, currentStream.fileIdx);
      if (cancelled) return;
      setPeerCount(stats?.peers ?? 0);
      setDownloadSpeed(stats?.downloadSpeed ?? 0);
      timer = setTimeout(poll, 2000);
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [currentStream, engineReady]);

  // One owner for media, HLS, retries and cleanup, including HTTP sources.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !engineReady) return;
    let cancelled = false;
    let hls: Hls | null = null;
    let retries = 0;
    let mediaRetries = 0;
    let converted = false;
    let failed = false;
    let waitingForInteraction = false;
    let hasPlayed = false;
    let playGeneration = 0;
    const hlsVideoUrl = StremioService.buildHlsPlaybackUrl(currentStream, crypto.randomUUID());
    let retryTimer: ReturnType<typeof setTimeout>;
    let lastProgress = Date.now();
    let lastTime = -1;
    setPlaybackError(null);
    setNeedsInteraction(false);
    setIsBuffering(true);
    const fail = (message: string) => {
      if (cancelled) return;
      failed = true;
      setPlaybackError(message);
      setIsBuffering(false);
      video.pause();
    };
    const play = () => {
      if (cancelled) return;
      const generation = ++playGeneration;
      video.volume = volumeRef.current;
      video.muted = volumeRef.current === 0;
      void video.play().then(() => {
        if (!cancelled && generation === playGeneration) { waitingForInteraction = false; setNeedsInteraction(false); }
      }).catch((error: DOMException) => {
        if (cancelled || generation !== playGeneration || error.name === 'AbortError') return;
        if (error.name === 'NotAllowedError') {
          waitingForInteraction = true;
          setNeedsInteraction(true);
          setIsBuffering(false);
        } else if (!converted) {
          startHls();
        } else {
          fail('Não foi possível reproduzir esta fonte. Tente novamente ou escolha outra transmissão.');
        }
      });
    };
    const startHls = () => {
      if (cancelled || converted) return;
      converted = true;
      playGeneration++;
      resumeTimeRef.current = video.currentTime || resumeTimeRef.current;
      video.pause();
      video.removeAttribute('src');
      video.load();
      setIsBuffering(true);
      setEngineStatus('Preparando transmissão com áudio compatível...');
      if (Hls.isSupported()) {
        hls = new Hls({ enableWorker: true, backBufferLength: 30,
          startPosition: resumeTimeRef.current || -1,
          manifestLoadingTimeOut: 30000, fragLoadingTimeOut: 30000 });
        hlsRef.current = hls;
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (cancelled || !hls) return;
          updateAudioTracks(hls.audioTracks, probedAudioStreamsRef.current);
          play();
        });
        hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_, data) => {
          if (!cancelled) updateAudioTracks(data.audioTracks, probedAudioStreamsRef.current);
        });
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (cancelled || !data.fatal) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR && retries++ < 3) {
            clearTimeout(retryTimer);
            retryTimer = setTimeout(() => hls?.startLoad(), 1500 * retries);
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRetries++ < 2) {
            hls?.recoverMediaError();
          } else {
            fail('O motor não conseguiu preparar esta transmissão. Tente novamente ou escolha outra fonte.');
          }
        });
        hls.attachMedia(video);
        hls.loadSource(hlsVideoUrl);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = hlsVideoUrl;
        play();
      } else {
        fail('Este navegador não suporta a reprodução HLS necessária para esta fonte.');
      }
    };
    const onError = () => {
      if (!converted) startHls();
      else fail('Falha ao decodificar o vídeo ou áudio desta transmissão.');
    };
    const onMetadata = () => {
      if (resumeTimeRef.current > 0 && Number.isFinite(video.duration)) {
        video.currentTime = Math.min(resumeTimeRef.current, video.duration);
        resumeTimeRef.current = 0;
      }
    };
    video.addEventListener('error', onError);
    video.addEventListener('loadedmetadata', onMetadata);
    const onPlaying = () => { waitingForInteraction = false; setNeedsInteraction(false); };
    video.addEventListener('playing', onPlaying);
    const interaction = () => { if (waitingForInteraction && !failed) play(); };
    window.addEventListener('pointerdown', interaction);
    window.addEventListener('keydown', interaction);
    if (!directVideoUrl) fail('Esta fonte não contém um endereço de reprodução válido.');
    else if (currentStream.infoHash || currentStream.behaviorHints?.notWebReady || /\.(mkv|m3u8)(?:$|[?#])/i.test(directVideoUrl)) startHls();
    else {
      void StremioService.probeMedia(currentStream).then((probe) => {
        if (cancelled) return;
        const audio = probe?.streams.filter((track: any) => track.track === 'audio' || track.codec_type === 'audio') || [];
        probedAudioStreamsRef.current = audio;
        const needsConversion = audio.length > 1 || audio.some((track: any) =>
          !['aac', 'mp3', 'opus', 'vorbis'].includes(String(track.codec || track.codec_name).toLowerCase()) || track.channels > 2);
        if (needsConversion) startHls();
        else { video.src = directVideoUrl; play(); }
      });
    }
    const watchdog = setInterval(() => {
      if (cancelled || failed || waitingForInteraction || video.ended) return;
      if (!video.paused) hasPlayed = true;
      if (hasPlayed && video.paused) { lastProgress = Date.now(); return; }
      if (video.currentTime !== lastTime) { lastTime = video.currentTime; lastProgress = Date.now(); }
      if (Date.now() - lastProgress > 60000) {
        if (!converted) { lastProgress = Date.now(); startHls(); }
        else fail('A transmissão ficou sem receber dados. Verifique a conexão ou escolha outra fonte.');
      }
    }, 5000);
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      clearInterval(watchdog);
      window.removeEventListener('pointerdown', interaction);
      window.removeEventListener('keydown', interaction);
      video.removeEventListener('error', onError);
      video.removeEventListener('loadedmetadata', onMetadata);
      video.removeEventListener('playing', onPlaying);
      hls?.destroy();
      hlsRef.current = null;
      if (converted) StremioService.releaseHlsSession(hlsVideoUrl);
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [currentStream, engineReady, directVideoUrl, updateAudioTracks, playbackAttempt]);

  // Apply volume changes dynamically without interrupting stream
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
      videoRef.current.muted = volume === 0;
    }
  }, [volume]);

  // Parse current stream for initial audio label
  useEffect(() => {
    const parsed = parseStream(currentStream);
    if (parsed.isPtBr) {
      setActiveAudioLabel(parsed.dubTag || 'Português (Dublado 🇧🇷)');
    } else {
      setActiveAudioLabel(parsed.audioInfo ? `Original (${parsed.audioInfo})` : 'Áudio Original');
    }
  }, [currentStream]);

  // Hook audioTracks events from video element
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const el = video as any;

    const handleTracks = () => {
      detectAudioTracks();
    };

    if (el.audioTracks) {
      el.audioTracks.addEventListener('addtrack', handleTracks);
      el.audioTracks.addEventListener('removetrack', handleTracks);
      el.audioTracks.addEventListener('change', handleTracks);
    }

    detectAudioTracks();

    return () => {
      if (el.audioTracks) {
        el.audioTracks.removeEventListener('addtrack', handleTracks);
        el.audioTracks.removeEventListener('removetrack', handleTracks);
        el.audioTracks.removeEventListener('change', handleTracks);
      }
    };
  }, [detectAudioTracks]);

  // Close audio modal if file does not have multiple audio tracks
  useEffect(() => {
    if (activeModal === 'audio' && !hasMultipleAudio) {
      setActiveModal('none');
    }
  }, [activeModal, hasMultipleAudio]);

  // Handle Switch Audio Track (supports Hls and native HTML5 audioTracks)
  const selectAudioOption = (opt: AudioTrackOption) => {
    hasUserSelectedAudioRef.current = true;
    setSelectedTrackIndex(opt.trackIndex);
    setActiveAudioLabel(opt.label);
    setActiveModal('none');
    GamepadManager.pulseHaptic(25, 0.2, 0.2);

    if (hlsRef.current && hlsRef.current.audioTracks && hlsRef.current.audioTracks.length > 0) {
      if (hlsRef.current.audioTrack !== opt.trackIndex) {
        hlsRef.current.audioTrack = opt.trackIndex;
      }
    } else if (videoRef.current) {
      const v = videoRef.current as any;
      let switchedNatively = false;
      if (v.audioTracks && v.audioTracks.length > opt.trackIndex) {
        for (let i = 0; i < v.audioTracks.length; i++) {
          v.audioTracks[i].enabled = i === opt.trackIndex;
        }
        switchedNatively = true;
      }

      if (!switchedNatively) {
        setPlaybackError('A troca de áudio não está disponível nesta fonte.');
      }
    }
  };

  // Handle Switch Subtitle (Zero-stall custom overlay)
  const selectSubtitle = async (sub: StremioSubtitle | null) => {
    if (!sub) {
      setSelectedSubId(null);
      activeCuesRef.current = [];
      setActiveCueText(null);
      setActiveModal('none');
      return;
    }

    setSelectedSubId(sub.id);
    setActiveModal('none');

    if (sub.url) {
      setLoadingSub(true);
      try {
        let text = '';
        // 1. Try local Stremio server built-in proxy & encoding converter
        try {
          const proxyUrl = `http://127.0.0.1:11470/subtitles.vtt?from=${encodeURIComponent(sub.url)}`;
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3500);
          const res = await fetch(proxyUrl, { signal: controller.signal });
          clearTimeout(timeoutId);
          if (res.ok) {
            text = await res.text();
          }
        } catch {
          // Proxy unreachable or timeout, fallback to direct
        }

        // 2. Direct fetch fallback
        if (!text) {
          try {
            const directRes = await fetch(sub.url);
            if (directRes.ok) {
              text = await directRes.text();
            }
          } catch {
            // direct fetch failed (e.g. CORS or network error)
          }
        }

        if (text) {
          const cues = parseSubtitlesToCues(text);
          activeCuesRef.current = cues;
          if (videoRef.current) {
            updateActiveSubtitle(videoRef.current.currentTime);
          }
        }
      } catch (err) {
        console.warn('Erro ao carregar legenda:', err);
      } finally {
        setLoadingSub(false);
      }
    }
  };

  // State ref for stable access in Gamepad listener
  const stateRef = useRef({
    toggleSubtitleBackground, adjustSubtitleSize,
    pauseControl, episodeChanging, neighbors, changeEpisode, onEpisodeChange,
    playbackError,
    needsInteraction,
    activeModal,
    modalFocusIndex,
    availableAudioTracks,
    selectedTrackIndex,
    hasMultipleAudio,
    subtitles,
    displayedSubtitles,
    subLangFilter,
    videoRef,
    selectAudioOption,
    selectSubtitle,
    onExit,
    adjustVolume,
    cycleBrightness,
    triggerSeek,
    togglePlayPause,
    showBrightnessHud,
    showVolumeHud,
    brightness,
    volume,
    unlockAudio,
    setSubLangFilter,
    setModalFocusIndex,
    setActiveModal,
  });

  stateRef.current = {
    toggleSubtitleBackground, adjustSubtitleSize,
    pauseControl, episodeChanging, neighbors, changeEpisode, onEpisodeChange,
    playbackError,
    needsInteraction,
    activeModal,
    modalFocusIndex,
    availableAudioTracks,
    selectedTrackIndex,
    hasMultipleAudio,
    subtitles,
    displayedSubtitles,
    subLangFilter,
    videoRef,
    selectAudioOption,
    selectSubtitle,
    onExit,
    adjustVolume,
    cycleBrightness,
    triggerSeek,
    togglePlayPause,
    showBrightnessHud,
    showVolumeHud,
    brightness,
    volume,
    unlockAudio,
    setSubLangFilter,
    setModalFocusIndex,
    setActiveModal,
  };

  // Continuous Trigger Scrub & Right Analog Stick Brightness Polling Loop
  useEffect(() => {
    let animId: number;
    let ltHoldStart: number | null = null;
    let rtHoldStart: number | null = null;
    let lastHoldAdvance = 0;
    let lastBrightnessAdjust = 0;
    let prevR3Pressed = false;

    const pollGamepad = () => {
      const gp = GamepadManager.getActiveGamepad();

      if (gp && activeModal === 'none' && videoRef.current) {
        const now = Date.now();

        // 1. Right Analog Stick Y Axis (gp.axes[3]) -> Brightness Adjust
        const rightStickY = gp.axes[3] || 0;
        if (Math.abs(rightStickY) > 0.35) {
          if (now - lastBrightnessAdjust > 120) {
            lastBrightnessAdjust = now;
            const delta = rightStickY < 0 ? 5 : -5;
            setBrightness((prev) => Math.max(30, Math.min(160, prev + delta)));
            setShowBrightnessHud(true);
            if (brightnessTimerRef.current) clearTimeout(brightnessTimerRef.current);
            brightnessTimerRef.current = window.setTimeout(() => {
              setShowBrightnessHud(false);
            }, 1400);
          }
        }

        // 2. Right Stick Click (R3 / gp.buttons[11]) -> Cycle Brightness Presets
        const r3Button = gp.buttons[11];
        const isR3Pressed = Boolean(r3Button && (r3Button.pressed || r3Button.value > 0.5));
        if (isR3Pressed && !prevR3Pressed) {
          cycleBrightness();
        }
        prevR3Pressed = isR3Pressed;

        // 3. LT (button 6) Continuous Rewind Hold - require intentional deep pull (> 0.70)
        // and ignore if volume was touched in the last 500ms
        const ltButton = gp.buttons[6];
        const isLtPressed = Boolean(ltButton && ltButton.value > 0.70);
        if (isLtPressed && (now - lastVolumeTimeRef.current > 500)) {
          if (ltHoldStart === null) {
            ltHoldStart = now;
          } else if (now - ltHoldStart > 350) {
            if (now - lastHoldAdvance > 200) {
              lastHoldAdvance = now;
              triggerSeek(-15);
            }
          }
        } else {
          ltHoldStart = null;
        }

        // 4. RT (button 7) Continuous Fast-Forward Hold
        const rtButton = gp.buttons[7];
        const isRtPressed = Boolean(rtButton && rtButton.value > 0.70);
        if (isRtPressed && (now - lastVolumeTimeRef.current > 500)) {
          if (rtHoldStart === null) {
            rtHoldStart = now;
          } else if (now - rtHoldStart > 350) {
            if (now - lastHoldAdvance > 200) {
              lastHoldAdvance = now;
              triggerSeek(15);
            }
          }
        } else {
          rtHoldStart = null;
        }
      }

      animId = requestAnimationFrame(pollGamepad);
    };

    animId = requestAnimationFrame(pollGamepad);
    return () => {
      cancelAnimationFrame(animId);
    };
  }, [activeModal, cycleBrightness, triggerSeek]);

  // Central Gamepad Action Listener for Video Player
  useEffect(() => {
    const handleGamepadAction = (action: GamepadAction) => {
      const {
        activeModal: curModal,
        modalFocusIndex: curIdx,
        availableAudioTracks: curAudioTracks,
        selectedTrackIndex: curSelectedTrackIndex,
        hasMultipleAudio: curHasMultipleAudio,
        displayedSubtitles: curDisplayedSubs,
        subLangFilter: curFilter,
        videoRef: vRef,
        selectAudioOption: handleAudio,
        selectSubtitle: handleSub,
        onExit: handleExit,
        adjustVolume: handleAdjustVolume,
        triggerSeek: handleSeek,
        togglePlayPause: handleTogglePlayPause,
        showBrightnessHud: curBrightnessHud,
        setSubLangFilter: updateSubLangFilter,
        setModalFocusIndex: updateModalFocusIndex,
        setActiveModal: updateActiveModal,
      } = stateRef.current;

      const video = vRef.current;
      resetOsdTimer();

      if (stateRef.current.playbackError || stateRef.current.needsInteraction) {
        if (action === 'ACTION_B') handleExit();
        if (action === 'ACTION_A') {
          if (stateRef.current.playbackError) {
            resumeTimeRef.current = video?.currentTime || 0;
            setPlaybackAttempt((attempt) => attempt + 1);
          } else {
            handleTogglePlayPause();
          }
        }
        return;
      }

      // Ensure audio is unmuted and at correct volume on any controller interaction
      if (video) {
        if (video.muted && stateRef.current.volume > 0) {
          video.muted = false;
        }
        if (video.volume === 0 && stateRef.current.volume > 0) {
          video.volume = stateRef.current.volume;
        }
      }

      // ==========================================
      // A) MODAL DRAWER IS OPEN (AUDIO OR SUBTITLES)
      // ==========================================
      if (curModal !== 'none') {
        const totalItems =
          curModal === 'audio' ? curAudioTracks.length : 1 + curDisplayedSubs.length; // 1 is "Desativada"

        switch (action) {
          case 'ACTION_B':
            // Dismiss drawer, stay in video
            updateActiveModal('none');
            break;

          case 'NAV_UP':
            updateModalFocusIndex((prev) => Math.max(0, prev - 1));
            break;

          case 'NAV_DOWN':
            updateModalFocusIndex((prev) => Math.min(totalItems - 1, prev + 1));
            break;

          case 'NAV_LEFT':
          case 'TRIGGER_LT':
            if (curModal === 'subtitles') {
              const tabs: SubtitleLangFilter[] = ['all', 'por', 'eng', 'other'];
              const curIdxTab = tabs.indexOf(curFilter);
              const nextIdxTab = (curIdxTab - 1 + tabs.length) % tabs.length;
              updateSubLangFilter(tabs[nextIdxTab]);
              updateModalFocusIndex(0);
            }
            break;

          case 'NAV_RIGHT':
          case 'TRIGGER_RT':
            if (curModal === 'subtitles') {
              const tabs: SubtitleLangFilter[] = ['all', 'por', 'eng', 'other'];
              const curIdxTab = tabs.indexOf(curFilter);
              const nextIdxTab = (curIdxTab + 1) % tabs.length;
              updateSubLangFilter(tabs[nextIdxTab]);
              updateModalFocusIndex(0);
            }
            break;

          case 'ACTION_X':
            if (curModal === 'subtitles' && curHasMultipleAudio) {
              updateActiveModal('audio');
              updateModalFocusIndex(curSelectedTrackIndex);
            }
            break;

          case 'ACTION_Y':
            if (curModal === 'audio') {
              updateActiveModal('subtitles');
              updateModalFocusIndex(0);
            } else if (curModal === 'subtitles') {
              stateRef.current.toggleSubtitleBackground();
            }
            break;

          case 'TRIGGER_LB':
          case 'TRIGGER_RB':
            if (curModal === 'subtitles') stateRef.current.adjustSubtitleSize(action === 'TRIGGER_LB' ? -10 : 10);
            break;

          case 'ACTION_A':
            if (curModal === 'audio') {
              const opt = curAudioTracks[curIdx];
              if (opt) handleAudio(opt);
            } else if (curModal === 'subtitles') {
              if (curIdx === 0) {
                handleSub(null); // Off
              } else {
                const subItem = curDisplayedSubs[curIdx - 1];
                if (subItem) handleSub(subItem.sub);
              }
            }
            break;
        }
        return;
      }

      // ==========================================
      // B) NORMAL PLAYBACK (NO MODAL OPEN)
      // ==========================================
      if (!video) return;

      // Paused controls own the arrows; seek/volume navigation resumes with playback.
      if (video.paused) {
        if (['NAV_LEFT', 'NAV_RIGHT', 'NAV_UP', 'NAV_DOWN'].includes(action)) {
          if (!stateRef.current.episodeChanging) {
            const direction = action === 'NAV_LEFT' || action === 'NAV_UP' ? -1 : 1;
            const state = stateRef.current;
            const minimum = state.onEpisodeChange && state.neighbors.previous ? 0 : 1;
            const maximum = state.onEpisodeChange && state.neighbors.next ? 2 : 1;
            const next = Math.max(minimum, Math.min(maximum, state.pauseControl + direction));
            state.pauseControl = next; setPauseControl(next);
          }
          return;
        }
        if (action === 'ACTION_A') {
          if (stateRef.current.episodeChanging) return;
          const selection = stateRef.current.pauseControl;
          if (selection === 1) handleTogglePlayPause();
          else void stateRef.current.changeEpisode(selection === 0 ? -1 : 1);
          return;
        }
      }

      switch (action) {
        case 'ACTION_A':
          handleTogglePlayPause();
          break;

        case 'ACTION_B':
          handleExit();
          break;

        case 'ACTION_X':
          // Toggle Audio / Dubbing Flyout se houver múltiplas faixas; senão, fallback de Play/Pause
          if (curHasMultipleAudio) {
            updateActiveModal('audio');
            updateModalFocusIndex(curSelectedTrackIndex);
          } else {
            handleTogglePlayPause();
          }
          break;

        case 'ACTION_Y':
          // Toggle Subtitles Flyout
          updateActiveModal('subtitles');
          updateModalFocusIndex(0);
          break;

        case 'TRIGGER_LT':
          // Left Trigger: Retrocede 15s no toque
          handleSeek(-15);
          break;

        case 'TRIGGER_RT':
          // Right Trigger: Avança 15s no toque
          handleSeek(15);
          break;

        case 'TRIGGER_LB':
          // L1: Diminuir volume
          handleAdjustVolume(-0.1);
          break;

        case 'TRIGGER_RB':
          // R1: Aumentar volume
          handleAdjustVolume(0.1);
          break;

        case 'NAV_LEFT':
          handleSeek(-10);
          break;

        case 'NAV_RIGHT':
          handleSeek(10);
          break;

        case 'NAV_UP':
          if (curBrightnessHud) {
            setBrightness((prev) => Math.min(160, prev + 5));
            setShowBrightnessHud(true);
          } else {
            handleAdjustVolume(0.05);
          }
          break;

        case 'NAV_DOWN':
          if (curBrightnessHud) {
            setBrightness((prev) => Math.max(30, prev - 5));
            setShowBrightnessHud(true);
          } else {
            handleAdjustVolume(-0.05);
          }
          break;
      }
    };

    const unsubscribe = GamepadManager.subscribe(handleGamepadAction);
    return () => {
      unsubscribe();
      if (osdTimerRef.current) clearTimeout(osdTimerRef.current);
    };
  }, []);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    const h = Math.floor(m / 60);
    if (h > 0) {
      return `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      onMouseMove={resetOsdTimer}
      onClick={resetOsdTimer}
      className="fixed inset-0 z-50 bg-black flex items-center justify-center overflow-hidden select-none"
    >
      {/* HTML5 Video Element (Decoupled from track DOM mutations to prevent Chromium media stalls) */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={volume === 0}
        onPlay={() => {
          setIsPlaying(true);
          if (videoRef.current) {
            if (videoRef.current.muted) videoRef.current.muted = volumeRef.current === 0;
            if (videoRef.current.volume === 0 && volume > 0) videoRef.current.volume = volume;
          }
        }}
        onPause={() => { setIsPlaying(false); stateRef.current.pauseControl = 1; setPauseControl(1); }}
        onTimeUpdate={() => {
          if (videoRef.current) {
            const cur = videoRef.current.currentTime;
            setCurrentTime(cur);
            updateActiveSubtitle(cur);
          }
        }}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => setIsBuffering(false)}
        onLoadedMetadata={() => {
          if (videoRef.current) {
            setDuration(videoRef.current.duration);
            videoRef.current.volume = volume;
            videoRef.current.muted = volumeRef.current === 0;
            detectAudioTracks();
          }
        }}
        onCanPlay={() => {
          setIsBuffering(false);
          if (videoRef.current) {
            videoRef.current.volume = volume;
            videoRef.current.muted = volumeRef.current === 0;
          }
          detectAudioTracks();
        }}
        onEnded={onExit}
        className="w-full h-full object-contain transition-[filter] duration-150"
        style={{ filter: brightness !== 100 ? `brightness(${brightness}%)` : undefined }}
      />

      {(playbackError || needsInteraction) && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-black/85 px-8 text-center">
          <p className="text-white">{playbackError || 'O navegador bloqueou a reprodução com áudio. Abra pelo Start-Stremio-Deck.bat para reproduzir pelo controle, ou clique em Reproduzir.'}</p>
          <button autoFocus className="rounded-xl bg-white px-6 py-3 text-black font-bold" onClick={() => {
            if (playbackError) { resumeTimeRef.current = videoRef.current?.currentTime || 0; setPlaybackAttempt((n) => n + 1); }
            else { void videoRef.current?.play().then(() => setNeedsInteraction(false)).catch(() => {}); }
          }}>{playbackError ? 'Tentar novamente' : 'Reproduzir'}</button>
          <button className="text-white underline" onClick={onExit}>Voltar às fontes</button>
        </div>
      )}

      {/* High-Contrast TV Subtitles Overlay (Zero-stall, high readability) */}
      {activeCueText && (
        <div className="absolute left-0 right-0 z-30 flex justify-center pointer-events-none px-8 select-none transition-[bottom] duration-200 motion-reduce:transition-none" style={{ bottom: showOsd ? subtitleBottom : 80 }}>
          <div
            className={`text-center max-w-4xl text-white font-bold leading-snug px-5 py-2 rounded-2xl ${subtitleBackground ? 'bg-black/75 backdrop-blur-[3px] border border-white/10 shadow-2xl' : 'bg-transparent'}`}
            style={{
              textShadow:
                '0 2px 4px rgba(0,0,0,0.9), 0 0 10px rgba(0,0,0,0.9), -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000',
              whiteSpace: 'pre-line',
              fontSize: `clamp(${24 * subtitleSize / 100}px, ${2 * subtitleSize / 100}vw, ${30 * subtitleSize / 100}px)`,
            }}
          >
            {activeCueText}
          </div>
        </div>
      )}

      {/* Loading & Buffering Overlay */}
      {isBuffering && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/80 backdrop-blur-md pointer-events-none animate-fade-in">
          <div className="relative mb-5">
            <div className="w-16 h-16 rounded-full border-4 border-white/10 animate-spin" style={{ borderTopColor: 'var(--app-accent)' }} />
            <div className="absolute inset-0 flex items-center justify-center">
              <Play className="w-6 h-6 ml-0.5" style={{ color: 'var(--app-accent)', fill: 'color-mix(in srgb, var(--app-accent) 40%, transparent)' }} />
            </div>
          </div>
          <h2 className="text-xl font-black text-white tracking-wide mb-1 text-center px-6 truncate max-w-2xl">
            {meta?.name || 'Iniciando Transmissão'}
          </h2>
          {currentEpisode && (
            <p className="text-xs font-bold mb-2" style={{ color: 'var(--app-accent)' }}>
              Temporada {currentEpisode.season} · Episódio {currentEpisode.episode}
            </p>
          )}
          <p className="text-xs font-semibold text-zinc-400 animate-pulse text-center px-4 max-w-lg">
            {engineStatus || parsedTorrent.cleanTitle || 'Conectando ao stream e iniciando reprodução...'}
          </p>
          {currentStream.infoHash && (
            <div className="mt-3 flex items-center gap-3">
              <span className="px-3 py-1 rounded-xl text-xs font-bold bg-white/10 border border-white/15 flex items-center gap-1.5" style={{ color: 'var(--app-accent)' }}>
                <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--app-accent)' }} />
                {peerCount > 0 ? `${peerCount} peers conectados` : 'Buscando peers...'}
              </span>
              {downloadSpeed > 0 && (
                <span className="px-3 py-1 rounded-xl text-xs font-bold bg-white/10 border border-white/15 text-zinc-300">
                  {(downloadSpeed / 1024 / 1024).toFixed(1)} MB/s
                </span>
              )}
            </div>
          )}
          {parsedTorrent.audioBadge && (
            <div className="mt-3 px-3 py-1 rounded-xl text-xs font-bold bg-white/10 border border-white/15 text-zinc-200">
              {parsedTorrent.audioBadge.label}
            </div>
          )}
        </div>
      )}

      {/* Paused Center Badge Overlay */}
      {!isPlaying && !isBuffering && activeModal === 'none' && !playbackError && !needsInteraction && (
        <div
          className="absolute inset-0 z-30 flex flex-col gap-5 items-center justify-center pointer-events-none animate-fade-in"
        >
          <div role="group" aria-label="Controles de pausa" className="flex items-center gap-7 pointer-events-auto drop-shadow-2xl">
            {[{ label: 'Episódio anterior', icon: SkipBack, enabled: !!onEpisodeChange && !!neighbors.previous },
              { label: 'Continuar', icon: Play, enabled: true },
              { label: 'Próximo episódio', icon: SkipForward, enabled: !!onEpisodeChange && !!neighbors.next }].map((control, index) => {
              const Icon = control.icon;
              return <button key={control.label} aria-label={control.label} aria-current={pauseControl === index ? 'true' : undefined}
                disabled={!control.enabled || episodeChanging}
                onClick={() => { if (index === 1) togglePlayPause(); else void changeEpisode(index === 0 ? -1 : 1); }}
                className={`player-pause-control flex flex-col items-center justify-center gap-3 disabled:opacity-25 disabled:cursor-default ${index === 1 ? 'w-36 h-36' : 'w-28 h-28'}`}>
                <Icon className={index === 1 ? 'w-14 h-14 ml-1' : 'w-9 h-9'} />
                <span className="text-xs font-bold">{control.label}</span>
              </button>;
            })}
          </div>
          <div className="flex items-center gap-2.5 px-4 py-2 rounded-full bg-black/60 backdrop-blur-sm border border-white/10 text-white">
            <ControllerButtonBadge button="A" size="sm" />
            <span className="text-xs font-bold">{episodeChanging ? 'Carregando episódio...' : 'Confirmar'}</span>
          </div>
          {episodeError && <p role="alert" className="text-sm text-white bg-black/70 rounded-xl px-4 py-2">{episodeError}</p>}
        </div>
      )}

      {/* Floating HUD: Luminosidade Indicator */}
      {showBrightnessHud && (
        <div className="fixed top-12 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3.5 px-6 py-3 rounded-2xl app-card-panel backdrop-blur-xl shadow-2xl text-white animate-fade-in pointer-events-none">
          {brightness > 100 ? (
            <Sun className="w-5 h-5 text-amber-400 animate-pulse" />
          ) : brightness < 70 ? (
            <Moon className="w-5 h-5 text-indigo-400" />
          ) : (
            <SunMedium className="w-5 h-5 text-amber-300" />
          )}
          <div className="flex flex-col gap-1.5 min-w-[150px]">
            <div className="flex items-center justify-between text-xs font-bold">
              <span className="text-zinc-300">Luminosidade (RT)</span>
              <span className="text-amber-400 font-mono">{brightness}%</span>
            </div>
            <div className="w-full h-1.5 bg-white/15 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-500 to-yellow-300 rounded-full transition-all duration-150"
                style={{ width: `${Math.min(100, Math.max(0, ((brightness - 30) / 130) * 100))}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Floating HUD: Volume Indicator */}
      {showVolumeHud && (
        <div className="fixed top-12 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3.5 px-6 py-3 rounded-2xl app-card-panel backdrop-blur-xl shadow-2xl text-white animate-fade-in pointer-events-none">
          {volume === 0 ? (
            <VolumeX className="w-5 h-5 text-rose-400" />
          ) : volume < 0.5 ? (
            <Volume1 className="w-5 h-5" style={{ color: 'var(--app-accent)' }} />
          ) : (
            <Volume2 className="w-5 h-5" style={{ color: 'var(--app-accent)' }} />
          )}
          <div className="flex flex-col gap-1.5 min-w-[150px]">
            <div className="flex items-center justify-between text-xs font-bold">
              <span className="text-zinc-300">Volume</span>
              <ControllerButtonBadge button="LB" size="sm" />
              <ControllerButtonBadge button="RB" size="sm" />
              <span className="font-mono" style={{ color: 'var(--app-accent)' }}>{Math.round(volume * 100)}%</span>
            </div>
            <div className="w-full h-1.5 bg-white/15 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-150"
                style={{ width: `${volume * 100}%`, background: 'var(--app-accent)', boxShadow: '0 0 6px color-mix(in srgb, var(--app-accent) 50%, transparent)' }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Floating HUD: Seek Feedback Indicator */}
      {seekFeedback && (
        <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-2.5 rounded-2xl app-card-panel backdrop-blur-xl shadow-2xl text-white font-bold text-sm animate-fade-in pointer-events-none">
          {seekFeedback.type === 'rewind' ? (
            <Rewind className="w-5 h-5 text-sky-400 animate-pulse" />
          ) : (
            <FastForward className="w-5 h-5 animate-pulse" style={{ color: 'var(--app-accent)' }} />
          )}
          <span className="font-mono text-base">
            {seekFeedback.type === 'rewind' ? '-' : '+'}
            {seekFeedback.cumulative || seekFeedback.seconds}s
          </span>
          <span className="text-xs text-zinc-400 font-normal">
            ({formatTime(currentTime)})
          </span>
        </div>
      )}

      {/* Subtitle Loading Notification */}
      {loadingSub && (
        <div className="absolute top-10 right-10 z-40 flex items-center gap-2 px-4 py-2 rounded-xl bg-black/80 text-xs font-bold animate-pulse" style={{ border: '1px solid color-mix(in srgb, var(--app-accent) 50%, transparent)', color: 'var(--app-accent)' }}>
          <Sparkles className="w-4 h-4 animate-spin" />
          <span>Sincronizando Legenda...</span>
        </div>
      )}

      {/* On-Screen Display (OSD) Overlay */}
      <div
        className={`absolute inset-0 flex flex-col justify-between p-10 bg-gradient-to-t from-black/95 via-transparent to-black/85 transition-opacity duration-300 ${
          showOsd ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Top OSD Bar: Title & Quick Track Indicators */}
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-widest flex items-center gap-2" style={{ color: 'var(--app-accent)' }}>
              <span className="w-2 h-2 rounded-full animate-ping" style={{ background: 'var(--app-accent)' }} />
              Reproduzindo
            </span>
            <h2 className="text-2xl lg:text-3xl font-black text-white tracking-tight mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span>{meta.name}</span>
              {currentEpisode && <span className="text-base lg:text-lg font-semibold tracking-normal text-zinc-300" aria-label={`Temporada ${currentEpisode.season}, episódio ${currentEpisode.episode}`}>
                T{currentEpisode.season} · E{currentEpisode.episode}
              </span>}
            </h2>
            <div className="text-xs text-zinc-400 mt-0.5">
              {currentStream.name || 'Stream de Alta Resolução'}
            </div>
          </div>

          {/* Top Right: Audio & Subtitle Badges */}
          <div className="flex items-center gap-3">
            {/* Audio Indicator */}
            <div
              onClick={
                hasMultipleAudio
                  ? () => {
                      setActiveModal('audio');
                      setModalFocusIndex(selectedTrackIndex);
                    }
                  : undefined
              }
              className={`liquid-glass-detail liquid-glass-control flex items-center gap-2 bg-black/70 backdrop-blur-md px-3.5 py-1.5 rounded-xl border border-white/10 transition-all ${
                hasMultipleAudio
                  ? 'hover:border-white/30 cursor-pointer'
                  : 'opacity-85 cursor-default'
              }`}
            >
            <LiquidGlassLayer />
              <Volume2 className="w-4 h-4" style={{ color: 'var(--app-accent)' }} />
              <span className="text-xs font-bold text-zinc-200">{activeAudioLabel}</span>
              {hasMultipleAudio && (
                <span className="text-[10px] font-semibold text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded border border-purple-500/20">
                  {availableAudioTracks.length} faixas
                </span>
              )}
            </div>

            {/* Subtitle Indicator */}
            <div
              onClick={() => {
                setActiveModal('subtitles');
                setModalFocusIndex(0);
              }}
              className={`liquid-glass-detail liquid-glass-control flex items-center gap-2 backdrop-blur-md px-3.5 py-1.5 rounded-xl border cursor-pointer transition-all ${
                selectedSubId
                  ? ''
                  : 'bg-black/70 border-white/10 text-zinc-400 hover:border-white/30'
              }`}
              style={selectedSubId ? {
                background: 'color-mix(in srgb, var(--app-accent) 8%, #000)',
                borderColor: 'color-mix(in srgb, var(--app-accent) 50%, transparent)',
                color: 'color-mix(in srgb, var(--app-accent) 80%, #fff)',
              } : undefined}
            >
            <LiquidGlassLayer />
              <Subtitles className="w-4 h-4" />
              <span className="text-xs font-bold">
                {selectedSubId
                  ? `Legenda: ${
                      subtitles.find((s) => s.id === selectedSubId)?.lang?.toUpperCase() || 'Ativa'
                    }`
                  : 'Legenda: Desativada'}
              </span>
            </div>

            {/* Luminosidade Indicator */}
            <div
              onClick={cycleBrightness}
              className="liquid-glass-detail liquid-glass-control flex items-center gap-2 bg-black/70 backdrop-blur-md px-3.5 py-1.5 rounded-xl border border-white/10 hover:border-amber-400/40 cursor-pointer transition-all"
            >
            <LiquidGlassLayer />
              <Sun className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-bold text-zinc-200">{brightness}%</span>
            </div>

            {/* Volume Indicator */}
            <div
              onClick={() => adjustVolume(volume >= 1.0 ? -0.5 : 0.2)}
              className="liquid-glass-detail liquid-glass-control flex items-center gap-2 bg-black/70 backdrop-blur-md px-3.5 py-1.5 rounded-xl border border-white/10 cursor-pointer transition-all hover:border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)]"
            >
            <LiquidGlassLayer />
              {volume === 0 ? (
                <VolumeX className="w-4 h-4 text-rose-400" />
              ) : volume < 0.5 ? (
                <Volume1 className="w-4 h-4" style={{ color: 'var(--app-accent)' }} />
              ) : (
                <Volume2 className="w-4 h-4" style={{ color: 'var(--app-accent)' }} />
              )}
              <span className="text-xs font-bold text-zinc-200">{Math.round(volume * 100)}%</span>
            </div>
          </div>
        </div>

        {/* Bottom OSD Bar: Timeline & Controller HUD Buttons */}
        <div ref={playbackControlsRef} className="player-controls-surface liquid-glass-surface flex flex-col gap-4">
          {/* Progress Bar */}
          <div className="w-full flex items-center gap-4">
            <span className="text-xs font-mono font-semibold text-zinc-300">
              {formatTime(currentTime)}
            </span>
            <div className="flex-1 h-2 bg-white/20 rounded-full overflow-hidden relative cursor-pointer">
              <div
                className="h-full rounded-full transition-all duration-100"
                style={{ width: `${progressPercent}%`, background: 'var(--app-accent)', boxShadow: '0 0 6px color-mix(in srgb, var(--app-accent) 50%, transparent)' }}
              />
            </div>
            <span className="text-xs font-mono font-semibold text-zinc-400">
              {formatTime(duration)}
            </span>
          </div>

          {/* Controller Hints & Action Buttons */}
          <div className="flex flex-wrap items-center justify-between pt-3 border-t border-white/10 gap-4">
            <div className="flex items-center gap-5">
              {/* Play / Pause */}
              <div
                onClick={togglePlayPause}
                className="flex items-center gap-2 cursor-pointer"
              >
                <ControllerButtonBadge button="A" size="sm" />
                <span className="text-xs font-bold text-zinc-200">
                  {isPlaying ? 'Pausar' : 'Reproduzir'}
                </span>
              </div>

              {/* Trocar Dublagem / Áudio Button - APENAS SE HOUVER MÚLTIPLAS FAIXAS NO ARQUIVO */}
              {hasMultipleAudio && (
                <button
                  onClick={() => {
                    setActiveModal('audio');
                    setModalFocusIndex(selectedTrackIndex);
                  }}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 cursor-pointer transition-all"
                >
                  <ControllerButtonBadge button="X" size="sm" />
                  <Volume2 className="w-3.5 h-3.5 ml-0.5" style={{ color: 'var(--app-accent)' }} />
                  <span className="text-xs font-bold text-white">Trocar Dublagem</span>
                </button>
              )}

              {/* Trocar Legenda Button */}
              <button
                onClick={() => {
                  setActiveModal('subtitles');
                  setModalFocusIndex(0);
                }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 cursor-pointer transition-all"
              >
                <ControllerButtonBadge button="Y" size="sm" />
                <Subtitles className="w-3.5 h-3.5 ml-0.5" style={{ color: 'var(--app-accent)' }} />
                <span className="text-xs font-bold text-white">Trocar Legenda</span>
              </button>

              {/* Controller Hints */}
              <div className="hidden lg:flex items-center gap-2 text-zinc-300 text-xs">
                <ControllerButtonBadge button="LT" size="sm" />
                <span className="font-semibold text-zinc-300">-15s</span>
              </div>
              <div className="hidden lg:flex items-center gap-2 text-zinc-300 text-xs">
                <ControllerButtonBadge button="RT" size="sm" />
                <span className="font-semibold text-zinc-300">+15s</span>
              </div>
              <div
                onClick={cycleBrightness}
                className="hidden lg:flex items-center gap-2 text-zinc-300 text-xs cursor-pointer hover:text-white"
              >
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-[10px] font-bold text-zinc-200">
                  R-Stick ↕
                </span>
                <Sun className="w-3.5 h-3.5 text-amber-400" />
                <span className="font-semibold text-zinc-300">Brilho ({brightness}%)</span>
              </div>
              <div className="hidden lg:flex items-center gap-2 text-zinc-300 text-xs">
                <ControllerButtonBadge button="LB" size="sm" />
                <ControllerButtonBadge button="RB" size="sm" />
                <span className="font-semibold text-zinc-300">Vol ({Math.round(volume * 100)}%)</span>
              </div>
            </div>

            {/* Exit Player Button */}
            <div onClick={onExit} className="flex items-center gap-2 cursor-pointer">
              <ControllerButtonBadge button="B" label="Sair do Player" size="sm" />
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================= */}
      {/* FLYOUT DRAWER 1: TROCAR DUBLAGEM / FAIXAS DE ÁUDIO (X)     */}
      {/* ========================================================= */}
      {activeModal === 'audio' && hasMultipleAudio && (
        <div className="absolute inset-0 z-50 flex items-center justify-end bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md h-full app-drawer p-6 flex flex-col justify-between shadow-2xl overflow-hidden">
            <div className="flex flex-col flex-1 min-h-0">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-white/20 pb-4 mb-4 flex-shrink-0">
                <div className="flex items-center gap-3">
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center shadow-lg"
                    style={{
                      background: 'color-mix(in srgb, var(--app-accent) 20%, transparent)',
                      color: 'var(--app-accent)',
                      border: '1px solid color-mix(in srgb, var(--app-accent) 40%, transparent)',
                      boxShadow: '0 0 14px color-mix(in srgb, var(--app-accent) 20%, transparent)',
                    }}
                  >
                    <Volume2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-white uppercase tracking-wider">
                      Faixas de Áudio
                    </h3>
                    <p className="text-[11px] text-zinc-400">
                      Áudios embutidos no arquivo em reprodução
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setActiveModal('none')}
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-white bg-white/5 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Options Rail */}
              <div
                ref={audioScrollRef}
                className="flex-1 overflow-y-auto px-2.5 py-2 space-y-2.5 no-scrollbar scroll-smooth"
              >
                {availableAudioTracks.map((opt, idx) => {
                  const isFocused = modalFocusIndex === idx;
                  const isCurrent = selectedTrackIndex === opt.trackIndex;

                  return (
                    <div
                      key={opt.id}
                      ref={(el) => {
                        audioItemRefs.current[idx] = el;
                      }}
                      onClick={() => selectAudioOption(opt)}
                      style={
                        isFocused
                          ? {
                              borderColor: 'var(--app-focus-border, var(--app-accent))',
                              boxShadow: '0 0 0 3px var(--app-focus-border, var(--app-accent)), 0 0 20px var(--app-accent-glow)',
                            }
                          : isCurrent
                          ? {
                              borderColor: 'color-mix(in srgb, var(--app-accent) 50%, transparent)',
                              background: 'color-mix(in srgb, var(--app-accent) 10%, transparent)',
                            }
                          : undefined
                      }
                      className={`p-3.5 rounded-xl border transition-all duration-150 cursor-pointer flex items-center justify-between app-card-item ${
                        isFocused
                          ? 'is-focused border-2'
                          : isCurrent
                          ? 'border'
                          : 'border-white/15 hover:border-white/30'
                      }`}
                    >
                      <div className="min-w-0 flex-1 pr-2">
                        <div className="flex items-center gap-2 text-xs font-bold text-white mb-0.5 truncate">
                          {opt.label}
                        </div>
                        {opt.sublabel && (
                          <div className="text-[11px] text-zinc-400 truncate">{opt.sublabel}</div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        {isCurrent && (
                          <span
                            style={{
                              color: 'var(--app-accent)',
                              background: 'color-mix(in srgb, var(--app-accent) 12%, transparent)',
                              borderColor: 'color-mix(in srgb, var(--app-accent) 35%, transparent)',
                            }}
                            className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md border"
                          >
                            <Check className="w-3.5 h-3.5" />
                            Ativo
                          </span>
                        )}
                        {isFocused && <ControllerButtonBadge button="A" size="sm" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Drawer Footer Hints */}
            <div className="pt-4 border-t border-white/10 flex items-center justify-between text-xs text-zinc-400 flex-shrink-0">
              <div className="flex items-center gap-4">
                <ControllerButtonBadge button="A" label="Confirmar" size="sm" />
                <ControllerButtonBadge button="B" label="Fechar" size="sm" />
                <ControllerButtonBadge button="Y" label="Legendas" size="sm" />
              </div>
              <span className="text-[11px] text-zinc-500 font-medium">D-Pad ↑↓</span>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* FLYOUT DRAWER 2: TROCAR LEGENDA (Y)                       */}
      {/* ========================================================= */}
      {activeModal === 'subtitles' && (
        <div className="absolute inset-0 z-50 flex items-center justify-end bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md h-full app-drawer p-6 flex flex-col justify-between shadow-2xl overflow-hidden">
            <div className="flex flex-col flex-1 min-h-0">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-white/20 pb-4 mb-3 flex-shrink-0">
                <div className="flex items-center gap-3">
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center shadow-lg"
                    style={{
                      background: 'color-mix(in srgb, var(--app-accent) 20%, transparent)',
                      color: 'var(--app-accent)',
                      border: '1px solid color-mix(in srgb, var(--app-accent) 40%, transparent)',
                      boxShadow: '0 0 14px color-mix(in srgb, var(--app-accent) 20%, transparent)',
                    }}
                  >
                    <Subtitles className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-white uppercase tracking-wider">
                      Legendas & Idiomas
                    </h3>
                    <p className="text-[11px] text-zinc-400">
                      OpenSubtitles v3 e Addons da Conta
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setActiveModal('none')}
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-white bg-white/5 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Language Filter Tabs (LT / RT) */}
              <div className="mb-3 space-y-3 flex-shrink-0">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <button type="button" aria-pressed={subtitleBackground} onClick={toggleSubtitleBackground}
                    className="flex items-center gap-2 text-white hover:text-zinc-300">
                    <ControllerButtonBadge button="Y" size="sm" />
                    <span>Fundo: {subtitleBackground ? 'Ativado' : 'Desativado'}</span>
                  </button>
                  <div className="flex items-center gap-2 text-white" role="group" aria-label="Tamanho da legenda">
                    <button type="button" aria-label="Diminuir tamanho da legenda" disabled={subtitleSize <= 70} onClick={() => adjustSubtitleSize(-10)} className="disabled:opacity-30">
                      <ControllerButtonBadge button="LB" size="sm" />
                    </button>
                    <span className="font-semibold tabular-nums min-w-10 text-center">{subtitleSize}%</span>
                    <button type="button" aria-label="Aumentar tamanho da legenda" disabled={subtitleSize >= 180} onClick={() => adjustSubtitleSize(10)} className="disabled:opacity-30">
                      <ControllerButtonBadge button="RB" size="sm" />
                    </button>
                  </div>
                </div>
                <div className="text-center py-2 rounded-xl bg-white/5 overflow-hidden" aria-label="Prévia da legenda">
                  <span className={`inline-block px-3 py-1 rounded-lg font-bold text-white ${subtitleBackground ? 'bg-black/75' : ''}`}
                    style={{ fontSize: `${16 * subtitleSize / 100}px`, textShadow: '0 1px 3px black, 0 0 5px black' }}>
                    Prévia da legenda
                  </span>
                </div>
              </div>
              <div className="app-card-panel flex items-center gap-1.5 p-1 rounded-xl mb-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setSubLangFilter('all');
                    setModalFocusIndex(0);
                  }}
                  style={
                    subLangFilter === 'all'
                      ? {
                          backgroundColor: 'var(--app-accent)',
                          boxShadow: '0 2px 10px var(--app-accent-glow)',
                        }
                      : undefined
                  }
                  className={`flex-1 py-1 px-2 rounded-lg text-xs font-bold transition-all text-center ${
                    subLangFilter === 'all'
                      ? 'text-white'
                      : 'text-zinc-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  Todas ({parsedSubtitles.length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSubLangFilter('por');
                    setModalFocusIndex(0);
                  }}
                  style={
                    subLangFilter === 'por'
                      ? {
                          backgroundColor: 'var(--app-accent)',
                          boxShadow: '0 2px 10px var(--app-accent-glow)',
                        }
                      : undefined
                  }
                  className={`flex-1 py-1 px-2 rounded-lg text-xs font-bold transition-all text-center flex items-center justify-center gap-1 ${
                    subLangFilter === 'por'
                      ? 'text-white'
                      : 'text-zinc-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <span>🇧🇷</span>
                  <span>PT-BR</span>
                  {ptCount > 0 && <span className="text-[10px] opacity-80">({ptCount})</span>}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSubLangFilter('eng');
                    setModalFocusIndex(0);
                  }}
                  style={
                    subLangFilter === 'eng'
                      ? {
                          backgroundColor: 'var(--app-accent)',
                          boxShadow: '0 2px 10px var(--app-accent-glow)',
                        }
                      : undefined
                  }
                  className={`flex-1 py-1 px-2 rounded-lg text-xs font-bold transition-all text-center flex items-center justify-center gap-1 ${
                    subLangFilter === 'eng'
                      ? 'text-white'
                      : 'text-zinc-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <span>🇺🇸</span>
                  <span>EN</span>
                  {enCount > 0 && <span className="text-[10px] opacity-80">({enCount})</span>}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSubLangFilter('other');
                    setModalFocusIndex(0);
                  }}
                  style={
                    subLangFilter === 'other'
                      ? {
                          backgroundColor: 'var(--app-accent)',
                          boxShadow: '0 2px 10px var(--app-accent-glow)',
                        }
                      : undefined
                  }
                  className={`flex-1 py-1 px-2 rounded-lg text-xs font-bold transition-all text-center ${
                    subLangFilter === 'other'
                      ? 'text-white'
                      : 'text-zinc-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  Outros ({otherCount})
                </button>
              </div>

              {/* Gamepad hint for switching tabs */}
              <div className="flex items-center justify-between text-[11px] text-zinc-400 px-1 mb-2 flex-shrink-0">
                <span className="flex items-center gap-1.5">
                  <ControllerButtonBadge button="LT" size="sm" />
                  <ControllerButtonBadge button="RT" size="sm" />
                  <span className="text-zinc-400 font-medium">Trocar Idioma</span>
                </span>
                <span className="text-zinc-500">
                  {displayedSubtitles.length} {displayedSubtitles.length === 1 ? 'opção' : 'opções'}
                </span>
              </div>

              {/* Subtitles Options Rail */}
              <div
                ref={subtitleScrollRef}
                className="flex-1 overflow-y-auto px-2.5 py-2 space-y-2.5 no-scrollbar scroll-smooth"
              >
                {/* Option 0: Desativada */}
                <div
                  ref={(el) => {
                    subtitleItemRefs.current[0] = el;
                  }}
                  onClick={() => selectSubtitle(null)}
                  style={
                    modalFocusIndex === 0
                      ? {
                          borderColor: 'var(--app-focus-border, var(--app-accent))',
                          boxShadow: '0 0 0 3px var(--app-focus-border, var(--app-accent)), 0 0 20px var(--app-accent-glow)',
                        }
                      : selectedSubId === null
                      ? {
                          borderColor: 'color-mix(in srgb, var(--app-accent) 50%, transparent)',
                          background: 'color-mix(in srgb, var(--app-accent) 10%, transparent)',
                        }
                      : undefined
                  }
                  className={`p-3.5 rounded-xl border transition-all duration-150 cursor-pointer flex items-center justify-between app-card-item ${
                    modalFocusIndex === 0
                      ? 'is-focused border-2'
                      : selectedSubId === null
                      ? 'border'
                      : 'border-white/15 hover:border-white/30'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <VolumeX className="w-4 h-4 text-zinc-400" />
                    <div>
                      <div className="text-xs font-bold text-white">Desativada</div>
                      <div className="text-[11px] text-zinc-400">Sem legendas na tela</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {selectedSubId === null && (
                      <span
                        style={{
                          color: 'var(--app-accent)',
                          background: 'color-mix(in srgb, var(--app-accent) 12%, transparent)',
                          borderColor: 'color-mix(in srgb, var(--app-accent) 35%, transparent)',
                        }}
                        className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md border"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Desativada
                      </span>
                    )}
                    {modalFocusIndex === 0 && <ControllerButtonBadge button="A" size="sm" />}
                  </div>
                </div>

                {/* Subtitle list */}
                {displayedSubtitles.map((item, idx) => {
                  const itemIndex = idx + 1;
                  const isFocused = modalFocusIndex === itemIndex;
                  const isSelected = selectedSubId === item.sub.id;

                  return (
                    <div
                      key={item.sub.id ? `${item.sub.id}-${idx}` : idx}
                      ref={(el) => {
                        subtitleItemRefs.current[itemIndex] = el;
                      }}
                      onClick={() => selectSubtitle(item.sub)}
                      style={
                        isFocused
                          ? {
                              borderColor: '#ffffff',
                              boxShadow: '0 0 0 3.5px #ffffff, 0 0 20px var(--app-accent-glow)',
                            }
                          : undefined
                      }
                      className={`p-3.5 rounded-xl border transition-all duration-150 cursor-pointer flex items-center justify-between app-card-item ${
                        isFocused
                          ? 'is-focused border-2 border-white'
                          : isSelected
                          ? 'bg-emerald-950/40 border-emerald-500/50'
                          : 'border-white/20 hover:border-white/40'
                      }`}
                    >
                      <div className="min-w-0 flex-1 pr-2">
                        {/* Title and tags */}
                        <div className="flex items-center gap-1.5 flex-wrap mb-1">
                          <span className="text-xs font-bold text-white truncate">
                            {item.displayTitle}
                          </span>
                          {item.releaseTag && (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-purple-300 border border-purple-500/30">
                              {item.releaseTag}
                            </span>
                          )}
                          {item.isHearingImpaired && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30">
                              CC / HI
                            </span>
                          )}
                        </div>

                        {/* File / Source details */}
                        <div className="text-[11px] text-zinc-400 truncate flex items-center gap-1.5">
                          <span className="text-zinc-500">[{item.sourceTag}]</span>
                          <span className="truncate">{item.sub.subtitleFileName || item.sub.url}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        {isSelected && (
                          <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20">
                            <Check className="w-3.5 h-3.5" />
                            Ativa
                          </span>
                        )}
                        {isFocused && <ControllerButtonBadge button="A" size="sm" />}
                      </div>
                    </div>
                  );
                })}

                {displayedSubtitles.length === 0 && (
                  <div className="py-8 text-center text-xs text-zinc-500">
                    Nenhuma legenda disponível para este filtro.
                  </div>
                )}
              </div>
            </div>

            {/* Drawer Footer Hints */}
            <div className="pt-4 border-t border-white/10 flex items-center justify-between text-xs text-zinc-400 flex-shrink-0">
              <div className="flex items-center gap-4">
                <ControllerButtonBadge button="A" label="Selecionar" size="sm" />
                <ControllerButtonBadge button="B" label="Fechar" size="sm" />
                {hasMultipleAudio && (
                  <ControllerButtonBadge button="X" label="Áudio" size="sm" />
                )}
              </div>
              <span className="text-[11px] text-zinc-500 font-medium">D-Pad ↑↓</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
