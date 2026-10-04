import type {
  StremioCatalogResponse,
  StremioMetaDetail,
  StremioMetaPreview,
  StremioStream,
  StremioSubtitle,
  ServerStatus,
} from '../types/stremio';
import { AccountService } from './account';

const STREAMING_SERVER_URL = 'http://127.0.0.1:11470';
const CINEMETA_URL = 'https://v3-cinemeta.strem.io';
const TORRENTIO_URL = 'https://torrentio.strem.fun';

export class StremioService {
  private static serverStatus: ServerStatus = {
    isOnline: false,
    baseUrl: STREAMING_SERVER_URL,
  };

  private static hostQueues = new Map<string, Promise<void>>();
  private static addonCatalogCache = new Map<string, { items: StremioMetaPreview[]; time: number }>();
  /** Hosts permanently blocked this session after 429 on both direct + proxy — backed by sessionStorage */
  private static _rateLimitedHosts: Set<string> | null = null;
  /** In-flight stream/catalog fetches per URL to prevent StrictMode duplicate requests */
  private static inFlightFetches = new Map<string, Promise<any>>();

  private static get rateLimitedHosts(): Set<string> {
    if (!this._rateLimitedHosts) {
      try {
        const stored = sessionStorage.getItem('stremio_rl_hosts');
        this._rateLimitedHosts = stored ? new Set(JSON.parse(stored)) : new Set();
      } catch {
        this._rateLimitedHosts = new Set();
      }
    }
    return this._rateLimitedHosts;
  }

  private static markRateLimited(url: string): void {
    try {
      const host = new URL(url).host;
      this.rateLimitedHosts.add(host);
      sessionStorage.setItem('stremio_rl_hosts', JSON.stringify([...this.rateLimitedHosts]));
    } catch {}
  }

  private static isRateLimited(url: string): boolean {
    try { return this.rateLimitedHosts.has(new URL(url).host); } catch { return false; }
  }

  /**
   * Convert any external URL into a locally proxied request through Stremio's native engine
   */
  public static toServerProxyUrl(targetUrl: string): string {
    try {
      const u = new URL(targetUrl);
      return `${STREAMING_SERVER_URL}/proxy/d=${encodeURIComponent(u.origin)}/${u.pathname.replace(/^\//, '')}${u.search}`;
    } catch {
      return targetUrl;
    }
  }

  /**
   * Stagger and rate-limit requests per domain to avoid bursting community addons
   */
  public static async politeHostFetch(url: string, timeoutMs: number = 5000): Promise<Response | null> {
    try {
      const host = new URL(url).host;

      // Space out requests to the same host domain by at least 150ms
      const lastPromise = this.hostQueues.get(host) || Promise.resolve();
      let finishQueue: () => void = () => {};
      const currentQueue = new Promise<void>((resolve) => {
        finishQueue = resolve;
      });
      this.hostQueues.set(host, currentQueue);

      await lastPromise;
      await new Promise((r) => setTimeout(r, 150));

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        return res;
      } catch {
        clearTimeout(timer);
        return null;
      } finally {
        finishQueue();
      }
    } catch {
      return null;
    }
  }

  /**
   * Check if local Stremio Streaming Server is running
   */
  public static async checkServer(targetUrl?: string): Promise<ServerStatus> {
    const urls = targetUrl ? [targetUrl] : [`${STREAMING_SERVER_URL}/stats.json`];

    for (const url of urls) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1200);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          this.serverStatus = {
            isOnline: true,
            version: data.version || '0.1.0',
            baseUrl: STREAMING_SERVER_URL,
          };
          return this.serverStatus;
        }
      } catch {
        // Try next candidate
      }
    }

    this.serverStatus.isOnline = false;
    return this.serverStatus;
  }

  /**
   * Fetch a catalog row from Cinemeta (Official Stremio Addon)
   */
  public static async getCatalog(
    type: 'movie' | 'series',
    genre?: string,
    skip: number = 0
  ): Promise<StremioMetaPreview[]> {
    try {
      const url = genre
        ? `${CINEMETA_URL}/catalog/${type}/top/genre=${encodeURIComponent(genre)}&skip=${skip}.json`
        : `${CINEMETA_URL}/catalog/${type}/top/skip=${skip}.json`;

      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch catalog: ${res.status}`);
      const data: StremioCatalogResponse = await res.json();
      return data.metas || [];
    } catch (err) {
      console.warn('Cinemeta fetch failed, using fallback catalog data:', err);
      return this.getFallbackCatalog(type);
    }
  }

  /**
   * Fetch catalog from any Stremio addon via standard addon protocol
   */
  public static async getAddonCatalog(
    transportUrl: string,
    type: string,
    catalogId: string,
    skip: number = 0
  ): Promise<StremioMetaPreview[]> {
    // Strictly ignore non-media catalogs (such as 'other', internal scrapers, etc.)
    if (type !== 'movie' && type !== 'series') {
      return [];
    }

    const cacheKey = `${transportUrl}|${type}|${catalogId}|${skip}`;
    const cached = this.addonCatalogCache.get(cacheKey);
    if (cached && Date.now() - cached.time < 5 * 60 * 1000) {
      return cached.items;
    }

    try {
      const baseUrl = transportUrl.replace('/manifest.json', '');
      const url = skip > 0
        ? `${baseUrl}/catalog/${type}/${catalogId}/skip=${skip}.json`
        : `${baseUrl}/catalog/${type}/${catalogId}.json`;

      // Skip if host is permanently rate-limited this session
      if (StremioService.isRateLimited(url)) return [];

      // Deduplicate concurrent requests (React StrictMode double-invoke)
      const inflight = StremioService.inFlightFetches.get(url);
      if (inflight) return (await inflight)?.metas ? [] : [];

      // Try direct first, proxy fallback on 429 or failure
      let res: Response | null = null;
      const fetchTask = (async () => {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 5500);
          const directRes = await fetch(url, { signal: controller.signal });
          clearTimeout(timer);

          if (directRes.ok) {
            res = directRes;
          } else if (directRes.status === 429 || directRes.status >= 400) {
            const proxied = StremioService.toServerProxyUrl(url);
            const pCtrl = new AbortController();
            const pTimer = setTimeout(() => pCtrl.abort(), 4000);
            const pRes = await fetch(proxied, { signal: pCtrl.signal });
            clearTimeout(pTimer);
            if (pRes.ok) res = pRes;
            else if (pRes.status === 429) StremioService.markRateLimited(url);
          }
        } catch {
          try {
            const proxied = StremioService.toServerProxyUrl(url);
            const pCtrl = new AbortController();
            const pTimer = setTimeout(() => pCtrl.abort(), 4000);
            const pRes = await fetch(proxied, { signal: pCtrl.signal });
            clearTimeout(pTimer);
            if (pRes.ok) res = pRes;
            else if (pRes.status === 429) StremioService.markRateLimited(url);
          } catch { res = null; }
        } finally {
          StremioService.inFlightFetches.delete(url);
        }
        return res;
      })();

      StremioService.inFlightFetches.set(url, fetchTask);
      const resolvedRes = await fetchTask;

      if (!resolvedRes || !resolvedRes.ok) return [];


      const data: StremioCatalogResponse = await resolvedRes.json();
      const items = (data.metas || []).map((m) => ({
        id: m.id,
        name: m.name,
        type: m.type,
        poster: m.poster || (m.id.startsWith('tt') ? `https://images.metahub.space/poster/medium/${m.id}/img` : undefined),
        background: m.background || (m.id.startsWith('tt') ? `https://images.metahub.space/background/medium/${m.id}/img` : undefined),
        year: m.year,
        imdbRating: m.imdbRating,
        genres: m.genres,
        description: m.description,
      }));

      if (items.length > 0) {
        this.addonCatalogCache.set(cacheKey, { items, time: Date.now() });
      }
      return items;
    } catch {
      return [];
    }
  }

  /**
   * Search titles across Cinemeta and installed user addons with deduplication
   */
  public static async searchCatalog(
    query: string,
    filterType: 'all' | 'movie' | 'series' = 'all'
  ): Promise<StremioMetaPreview[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const searchPromises: Promise<StremioMetaPreview[]>[] = [];

    // 1. Cinemeta Movies
    if (filterType === 'all' || filterType === 'movie') {
      searchPromises.push(
        fetch(`${CINEMETA_URL}/catalog/movie/top/search=${encodeURIComponent(trimmed)}.json`)
          .then(async (res) => {
            if (!res.ok) return [];
            const data: StremioCatalogResponse = await res.json();
            return (data.metas || []).map((m) => ({
              ...m,
              type: 'movie' as const,
              poster: m.poster || (m.id.startsWith('tt') ? `https://images.metahub.space/poster/medium/${m.id}/img` : undefined),
            }));
          })
          .catch(() => [])
      );
    }

    // 2. Cinemeta Series
    if (filterType === 'all' || filterType === 'series') {
      searchPromises.push(
        fetch(`${CINEMETA_URL}/catalog/series/top/search=${encodeURIComponent(trimmed)}.json`)
          .then(async (res) => {
            if (!res.ok) return [];
            const data: StremioCatalogResponse = await res.json();
            return (data.metas || []).map((m) => ({
              ...m,
              type: 'series' as const,
              poster: m.poster || (m.id.startsWith('tt') ? `https://images.metahub.space/poster/medium/${m.id}/img` : undefined),
            }));
          })
          .catch(() => [])
      );
    }

    // 3. User Addons supporting search
    try {
      const userAddons = AccountService.getUserAddons();
      for (const addon of userAddons) {
        if (!addon.transportUrl || !addon.manifest?.catalogs) continue;
        for (const cat of addon.manifest.catalogs) {
          const canSearch = (cat.extra || []).some((e: any) => e.name === 'search');
          if (canSearch && (filterType === 'all' || filterType === cat.type)) {
            const baseUrl = addon.transportUrl.replace('/manifest.json', '');
            const endpoint = `${baseUrl}/catalog/${cat.type}/${cat.id}/search=${encodeURIComponent(trimmed)}.json`;
            searchPromises.push(
              fetch(endpoint)
                .then(async (res) => {
                  if (!res.ok) return [];
                  const data: StremioCatalogResponse = await res.json();
                  return (data.metas || []).map((m) => ({
                    ...m,
                    poster: m.poster || (m.id.startsWith('tt') ? `https://images.metahub.space/poster/medium/${m.id}/img` : undefined),
                  }));
                })
                .catch(() => [])
            );
          }
        }
      }
    } catch {
      // Ignored
    }

    try {
      const results = await Promise.allSettled(searchPromises);
      const all: StremioMetaPreview[] = [];
      const seen = new Set<string>();

      for (const r of results) {
        if (r.status === 'fulfilled' && Array.isArray(r.value)) {
          for (const item of r.value) {
            if (item && item.id && !seen.has(item.id)) {
              seen.add(item.id);
              all.push(item);
            }
          }
        }
      }

      return all;
    } catch {
      return [];
    }
  }

  /**
   * Fetch full details for a movie or series
   */
  public static async getMeta(type: string, id: string): Promise<StremioMetaDetail | null> {
    try {
      const res = await fetch(`${CINEMETA_URL}/meta/${type}/${id}.json`);
      if (!res.ok) throw new Error(`Failed to fetch meta: ${res.status}`);
      const data = await res.json();
      return data.meta || null;
    } catch (err) {
      console.warn('Error fetching meta:', err);
      return null;
    }
  }

  /**
   * Fetch subtitles from OpenSubtitles v3, official Stremio endpoints, and user installed addons
   */
  public static async getSubtitles(type: string, id: string): Promise<StremioSubtitle[]> {
    const subtitlePromises: Promise<StremioSubtitle[]>[] = [];

    // 1. OpenSubtitles v3 (Primary official Stremio endpoint)
    subtitlePromises.push(
      fetch(`https://opensubtitles-v3.strem.io/subtitles/${type}/${id}.json`)
        .then(async (res) => {
          if (!res.ok) return [];
          const data = await res.json();
          return (data.subtitles || []) as StremioSubtitle[];
        })
        .catch(() => [])
    );



    // 3. Query all user-installed addons with 'subtitles' resource
    try {
      const userAddons = AccountService.getUserAddons();
      for (const addon of userAddons) {
        if (!addon.transportUrl) continue;

        // Skip legacy OpenSubtitles v1 (lacks CORS headers and is superseded by v3 queried above)
        if (
          addon.transportUrl.includes('opensubtitles.strem.io') &&
          !addon.transportUrl.includes('opensubtitles-v3')
        ) {
          continue;
        }

        const resList = addon.manifest?.resources || [];
        const canSubtitle = resList.some((r: any) =>
          r === 'subtitles' || (typeof r === 'object' && r.name === 'subtitles')
        );

        if (canSubtitle) {
          const baseUrl = addon.transportUrl.replace('/manifest.json', '');
          const endpoint = `${baseUrl}/subtitles/${type}/${id}.json`;
          
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 3500);

          subtitlePromises.push(
            fetch(endpoint, { signal: controller.signal })
              .then(async (res) => {
                clearTimeout(timer);
                if (!res.ok) return [];
                const data = await res.json();
                return (data.subtitles || []).map((sub: StremioSubtitle) => ({
                  ...sub,
                  subtitleFileName: sub.subtitleFileName
                    ? `${sub.subtitleFileName} [${addon.manifest.name}]`
                    : `[${addon.manifest.name}]`,
                }));
              })
              .catch(() => {
                clearTimeout(timer);
                return [];
              })
          );
        }
      }
    } catch {
      // Ignored
    }

    try {
      const results = await Promise.allSettled(subtitlePromises);
      const allSubs: StremioSubtitle[] = [];
      const seen = new Set<string>();

      for (const r of results) {
        if (r.status === 'fulfilled' && Array.isArray(r.value)) {
          for (const s of r.value) {
            const key = s.id || s.url;
            if (key && !seen.has(key)) {
              seen.add(key);
              allSubs.push(s);
            }
          }
        }
      }

      return allSubs;
    } catch (err) {
      console.warn('Error fetching subtitles:', err);
      return [];
    }
  }

  private static streamsCache = new Map<string, { streams: StremioStream[]; time: number }>();

  /**
   * Fetch available video streams across installed addons and Torrentio
   * Includes strict timeouts, memory caching, and progressive updates.
   */
  public static async getStreams(
    type: string,
    id: string,
    onProgress?: (streams: StremioStream[]) => void
  ): Promise<StremioStream[]> {
    const cacheKey = `${type}:${id}`;
    const cached = this.streamsCache.get(cacheKey);
    // Cache valid for 5 minutes
    if (cached && Date.now() - cached.time < 5 * 60 * 1000) {
      if (onProgress) onProgress(cached.streams);
      return cached.streams;
    }

    const allStreams: StremioStream[] = [];
    const seen = new Set<string>();

    const addStreams = (incoming: StremioStream[]) => {
      let added = false;
      for (const s of incoming) {
        const key = s.infoHash ? `${s.infoHash}-${s.fileIdx ?? 0}` : s.url || s.title || '';
        if (key && !seen.has(key)) {
          seen.add(key);
          allStreams.push(s);
          added = true;
        }
      }
      if (added && onProgress) {
        onProgress([...allStreams]);
      }
    };

    const fetchJsonTimeout = async (url: string, timeoutMs: number = 5500): Promise<any> => {
      // Skip if host is permanently rate-limited this session
      if (StremioService.isRateLimited(url)) return null;

      // Deduplicate concurrent requests to the same URL (e.g. React StrictMode double-invoke)
      const inflight = StremioService.inFlightFetches.get(url);
      if (inflight) return inflight;

      const task = (async () => {
        try {
          // 1. Direct fetch with strict timeout
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          const res = await fetch(url, { signal: controller.signal });
          clearTimeout(timer);

          if (res.ok) return await res.json();

          // 2. If 429 or error, retry via local Stremio server proxy
          if (res.status === 429 || res.status >= 400) {
            const proxiedUrl = StremioService.toServerProxyUrl(url);
            const pCtrl = new AbortController();
            const pTimer = setTimeout(() => pCtrl.abort(), 4000);
            const pRes = await fetch(proxiedUrl, { signal: pCtrl.signal });
            clearTimeout(pTimer);
            if (pRes.ok) return await pRes.json();
            if (pRes.status === 429) StremioService.markRateLimited(url);
          }
          return null;
        } catch {
          // 3. Fallback on CORS / network error to local proxy
          try {
            const proxiedUrl = StremioService.toServerProxyUrl(url);
            const pCtrl = new AbortController();
            const pTimer = setTimeout(() => pCtrl.abort(), 4000);
            const pRes = await fetch(proxiedUrl, { signal: pCtrl.signal });
            clearTimeout(pTimer);
            if (pRes.ok) return await pRes.json();
            if (pRes.status === 429) StremioService.markRateLimited(url);
          } catch {}
          return null;
        } finally {
          StremioService.inFlightFetches.delete(url);
        }
      })();

      StremioService.inFlightFetches.set(url, task);
      return task;
    };

    const streamTasks: Promise<void>[] = [];

    // 1. Primary fast provider: Torrentio (7500ms timeout)
    const torrentioTask = fetchJsonTimeout(`${TORRENTIO_URL}/stream/${type}/${id}.json`, 7500)
      .then((data) => {
        if (data && Array.isArray(data.streams)) {
          addStreams(data.streams);
        }
      })
      .catch(() => {});
    streamTasks.push(torrentioTask);

    // 2. Query user installed addons with 'stream' resource (5000ms timeout)
    try {
      const userAddons = AccountService.getUserAddons();
      for (const addon of userAddons) {
        if (!addon.transportUrl || addon.transportUrl.includes('torrentio.strem.fun')) continue;
        const resList = addon.manifest?.resources || [];
        const canStream = resList.some((r: any) =>
          r === 'stream' || (typeof r === 'object' && r.name === 'stream')
        );

        if (canStream) {
          const baseUrl = addon.transportUrl.replace('/manifest.json', '');
          const endpoint = `${baseUrl}/stream/${type}/${id}.json`;
          const addonTask = fetchJsonTimeout(endpoint, 5000)
            .then((data) => {
              if (data && Array.isArray(data.streams)) {
                const formatted = data.streams.map((s: StremioStream) => ({
                  ...s,
                  name: s.name ? `${addon.manifest.name}\n${s.name}` : addon.manifest.name,
                }));
                addStreams(formatted);
              }
            })
            .catch(() => {});
          streamTasks.push(addonTask);
        }
      }
    } catch {
      // Ignored
    }

    try {
      await Promise.allSettled(streamTasks);
      if (allStreams.length > 0) {
        this.streamsCache.set(cacheKey, { streams: allStreams, time: Date.now() });
      }
      return allStreams;
    } catch (err) {
      console.warn('Error fetching streams:', err);
      return allStreams;
    }
  }

  /**
   * Comprehensive list of high-speed public BitTorrent trackers
   */
  public static readonly DEFAULT_TRACKERS: string[] = [
    'tracker:udp://tracker.opentrackr.org:1337/announce',
    'tracker:udp://open.demonii.com:1337/announce',
    'tracker:udp://open.stealth.si:80/announce',
    'tracker:udp://tracker.torrent.eu.org:451/announce',
    'tracker:udp://explodie.org:6969/announce',
    'tracker:udp://exodus.desync.com:6969/announce',
    'tracker:udp://tracker2.dler.org:80/announce',
    'tracker:udp://tracker.qu.ax:6969/announce',
    'tracker:udp://tracker.dler.org:6969/announce',
    'tracker:udp://torrentclub.online:54123/announce',
    'tracker:udp://ipv4announce.sktorrent.eu:6969/announce',
    'tracker:udp://bittorrent-tracker.e-n-c-r-y-p-t.net:1337/announce',
    'tracker:https://tracker.zhuqiy.com:443/announce',
  ];

  /**
   * Extract and normalize all trackers for a stream, including DHT and defaults
   */
  public static getTorrentSources(stream: StremioStream): string[] {
    const rawSources = [
      ...(stream.sources || []),
      ...(stream.announce || []),
      ...this.DEFAULT_TRACKERS,
    ];
    if (stream.infoHash) {
      rawSources.unshift(`dht:${stream.infoHash.toLowerCase()}`);
    }
    const formatted = rawSources.map((s) =>
      s.startsWith('tracker:') || s.startsWith('dht:') ? s : `tracker:${s}`
    );
    return Array.from(new Set(formatted));
  }

  /**
   * Pre-creates and warms the torrent engine with swarm trackers via Stremio EngineFS API
   */
  public static async createTorrentEngine(
    stream: StremioStream,
    seriesInfo?: { season?: number; episode?: number }
  ): Promise<{ files?: any[]; name?: string; guessedFileIdx?: number } | null> {
    if (!stream.infoHash) return null;
    const infoHash = stream.infoHash.toLowerCase();
    const sources = this.getTorrentSources(stream);

    const body: Record<string, any> = {
      torrent: { infoHash },
      peerSearch: {
        sources,
        min: 40,
        max: 200,
      },
    };

    if (stream.fileIdx === null || stream.fileIdx === undefined || !isFinite(stream.fileIdx)) {
      body.guessFileIdx = {};
      if (seriesInfo) {
        if (typeof seriesInfo.season === 'number') body.guessFileIdx.season = seriesInfo.season;
        if (typeof seriesInfo.episode === 'number') body.guessFileIdx.episode = seriesInfo.episode;
      }
    } else {
      body.guessFileIdx = false;
    }

    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 60000);
      const res = await fetch(`${STREAMING_SERVER_URL}/${infoHash}/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      }).finally(() => clearTimeout(tid));
      if (res.ok) {
        return await res.json();
      }
    } catch (err) {
      console.warn('Erro ao inicializar torrent engine:', err);
    }
    return null;
  }

  /**
   * Get real-time stats for an active torrent
   */
  public static async getTorrentStats(
    infoHash: string,
    fileIdx?: number
  ): Promise<{
    peers?: number;
    unchoked?: number;
    downloadSpeed?: number;
    streamProgress?: number;
    files?: any[];
    name?: string;
  } | null> {
    try {
      const ih = infoHash.toLowerCase();
      const endpoint =
        fileIdx !== undefined
          ? `${STREAMING_SERVER_URL}/${ih}/${fileIdx}/stats.json`
          : `${STREAMING_SERVER_URL}/${ih}/stats.json`;
      const res = await fetch(endpoint, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // Ignored
    }
    return null;
  }

  /**
   * Build playable streaming URL using the local Stremio engine with full swarm tracker query string
   */
  public static buildPlaybackUrl(stream: StremioStream): string {
    if (stream.url) {
      const headers = stream.behaviorHints?.proxyHeaders;
      if (headers) {
        // Match stremio-core: let the native engine send headers browsers cannot set.
        const target = new URL(stream.url);
        const params = new URLSearchParams({ d: target.origin });
        for (const [name, value] of Object.entries(headers.request || {})) params.append('h', `${name}:${value}`);
        for (const [name, value] of Object.entries(headers.response || {})) params.append('r', `${name}:${value}`);
        return `${STREAMING_SERVER_URL}/proxy/${params}/${target.pathname.replace(/^\//, '')}${target.search}`;
      }
      return stream.url;
    }
    if (stream.infoHash) {
      const idx = stream.fileIdx !== undefined ? stream.fileIdx : 0;
      const sources = this.getTorrentSources(stream);
      const params = new URLSearchParams();
      for (const s of sources) {
        params.append('tr', s);
      }
      return `${STREAMING_SERVER_URL}/${stream.infoHash.toLowerCase()}/${idx}?${params.toString()}`;
    }
    return '';
  }

  /**
   * Build HLS streaming URL using local Stremio engine (with real-time audio transcoding and multiple track switching)
   * Uses Stremio's native HLS v2 engine (/hlsv2/:id/master.m3u8?mediaURL=...)
   */
  public static buildHlsPlaybackUrl(stream: StremioStream, sessionId?: string): string {
    const direct = this.buildPlaybackUrl(stream);
    if (!direct) return '';
    if (/\.m3u8(?:$|[?#])/i.test(direct)) return direct;
    // Restrict passthrough to dependable browser codecs; convert AC3/DTS and surround to AAC stereo.
    const params = new URLSearchParams({ mediaURL: direct, videoCodecs: 'h264', audioCodecs: 'aac', maxAudioChannels: '2' });
    return `${STREAMING_SERVER_URL}/hlsv2/${encodeURIComponent(sessionId || 'playback')}/master.m3u8?${params}`;
  }

  public static releaseHlsSession(playbackUrl: string): void {
    if (!playbackUrl.startsWith(`${STREAMING_SERVER_URL}/hlsv2/`)) return;
    const endpoint = playbackUrl.split('/master.m3u8')[0];
    void fetch(`${endpoint}/destroy`, { method: 'GET', signal: AbortSignal.timeout(3000) }).catch(() => {});
  }

  /**
   * Inspect codecs and channel counts through the same probe endpoint as Stremio's player.
   */
  public static async probeMedia(
    stream: StremioStream
  ): Promise<{ streams: any[]; duration?: number; container?: string } | null> {
    const target = this.buildPlaybackUrl(stream);
    if (!target) return null;
    try {
      const response = await fetch(
        `${STREAMING_SERVER_URL}/hlsv2/probe?${new URLSearchParams({ mediaURL: target })}`,
        { signal: AbortSignal.timeout(12000) }
      );
      if (!response.ok) return null;
      const result = await response.json();
      return Array.isArray(result?.streams) ? result : null;
    } catch {
      return null;
    }
  }

  /**
   * Build transcode URL with audio track selection using local Stremio engine
   */
  public static buildTranscodeUrl(
    stream: StremioStream,
    _audioTrackId?: string | number,
    _offsetSeconds: number = 0
  ): string {
    return this.buildHlsPlaybackUrl(stream);
  }

  /**
   * Fallback curated titles for instant offline rendering & styling
   */
  private static getFallbackCatalog(type: 'movie' | 'series'): StremioMetaPreview[] {
    if (type === 'movie') {
      return [
        {
          id: 'tt15239678',
          type: 'movie',
          name: 'Duna: Parte 2',
          year: 2024,
          imdbRating: '8.6',
          genres: ['Ficção Científica', 'Aventura'],
          description: 'Paul Atreides se une a Chani e aos Fremen enquanto busca vingança contra os conspiradores que destruíram sua família.',
          poster: 'https://images.metahub.space/poster/medium/tt15239678/img',
          background: 'https://images.metahub.space/background/medium/tt15239678/img',
        },
        {
          id: 'tt15398776',
          type: 'movie',
          name: 'Oppenheimer',
          year: 2023,
          imdbRating: '8.9',
          genres: ['Biografia', 'Drama', 'História'],
          description: 'A história do físico americano J. Robert Oppenheimer, seu papel no Projeto Manhattan e o desenvolvimento da bomba atômica.',
          poster: 'https://images.metahub.space/poster/medium/tt15398776/img',
          background: 'https://images.metahub.space/background/medium/tt15398776/img',
        },
        {
          id: 'tt6263850',
          type: 'movie',
          name: 'Deadpool & Wolverine',
          year: 2024,
          imdbRating: '7.8',
          genres: ['Ação', 'Comédia', 'Ficção'],
          description: 'Wolverine se recupera de seus ferimentos quando cruza o caminho do tagarela Deadpool para derrotar um inimigo comum.',
          poster: 'https://images.metahub.space/poster/medium/tt6263850/img',
          background: 'https://images.metahub.space/background/medium/tt6263850/img',
        },
        {
          id: 'tt11315808',
          type: 'movie',
          name: 'Godzilla Minus One',
          year: 2023,
          imdbRating: '8.3',
          genres: ['Ação', 'Ficção Científica'],
          description: 'No Japão pós-guerra, uma nova ameaça catastrófica surge das profundezas do oceano.',
          poster: 'https://images.metahub.space/poster/medium/tt11315808/img',
          background: 'https://images.metahub.space/background/medium/tt11315808/img',
        },
        {
          id: 'tt0816692',
          type: 'movie',
          name: 'Interestelar',
          year: 2014,
          imdbRating: '8.7',
          genres: ['Ficção Científica', 'Drama'],
          description: 'Uma equipe de exploradores viaja através de um buraco de minhoca no espaço, na tentativa de garantir a sobrevivência da humanidade.',
          poster: 'https://images.metahub.space/poster/medium/tt0816692/img',
          background: 'https://images.metahub.space/background/medium/tt0816692/img',
        },
      ];
    }

    return [
      {
        id: 'tt1190634',
        type: 'series',
        name: 'The Boys',
        year: '2019-',
        imdbRating: '8.7',
        genres: ['Ação', 'Comédia', 'Drama'],
        description: 'Um grupo de vigilantes se propõe a derrotar super-heróis corruptos que abusam de seus superpoderes.',
        poster: 'https://images.metahub.space/poster/medium/tt1190634/img',
        background: 'https://images.metahub.space/background/medium/tt1190634/img',
      },
      {
        id: 'tt12637874',
        type: 'series',
        name: 'Fallout',
        year: '2024-',
        imdbRating: '8.4',
        genres: ['Ação', 'Aventura', 'Drama'],
        description: 'Em um futuro pós-apocalíptico de Los Angeles, os cidadãos devem viver em abrigos subterrâneos para se proteger de radiação e mutantes.',
        poster: 'https://images.metahub.space/poster/medium/tt12637874/img',
        background: 'https://images.metahub.space/background/medium/tt12637874/img',
      },
      {
        id: 'tt3581920',
        type: 'series',
        name: 'The Last of Us',
        year: '2023-',
        imdbRating: '8.8',
        genres: ['Ação', 'Aventura', 'Drama'],
        description: 'Joel e Ellie, uma dupla conectada pela dureza do mundo em que vivem, enfrentam monstros e sobreviventes brutais.',
        poster: 'https://images.metahub.space/poster/medium/tt3581920/img',
        background: 'https://images.metahub.space/background/medium/tt3581920/img',
      },
      {
        id: 'tt15523010',
        type: 'series',
        name: 'X-Men 97',
        year: '2024-',
        imdbRating: '8.9',
        genres: ['Animação', 'Ação', 'Aventura'],
        description: 'Um bando de mutantes usa seus dons misteriosos para proteger um mundo que os odeia e teme.',
        poster: 'https://images.metahub.space/poster/medium/tt15523010/img',
        background: 'https://images.metahub.space/background/medium/tt15523010/img',
      },
    ];
  }
}
