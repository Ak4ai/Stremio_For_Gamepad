import type { StremioUser, StremioLibraryItem, StremioAddon, RawLibraryItem } from '../types/account';
import type { StremioMetaPreview } from '../types/stremio';
import { MetadataService } from './metadata';
import { LocalAddonService } from './localAddons';
import { isContinueWatching, lastEpisodeOf, resumeSecondsFor } from '../utils/libraryProgress';

const STREMIO_API_URL = 'https://api.strem.io/api';
const USER_STORAGE_KEY = 'stremio_deck_user';
const LIBRARY_CACHE_KEY = 'stremio_deck_library_cache';
const ADDONS_CACHE_KEY = 'stremio_deck_user_addons';
const LAST_SYNC_KEY = 'stremio_deck_last_sync';

type AccountChangeListener = (user: StremioUser | null) => void;
type LibraryChangeListener = () => void;

/** When a screen asks for the library, re-read the cloud copy if it is older than this. */
const LIBRARY_MAX_AGE_MS = 2 * 60 * 1000;

export class AccountService {
  private static currentUser: StremioUser | null = null;
  private static userLibrary: StremioLibraryItem[] = [];
  private static userAddons: StremioAddon[] = [];
  private static lastSyncTime: number = 0;
  private static listeners: Set<AccountChangeListener> = new Set();
  private static libraryListeners: Set<LibraryChangeListener> = new Set();
  private static removedLocalIds: Set<string> = new Set();
  private static addedLocalItems: Map<string, StremioLibraryItem> = new Map();

  public static init() {
    const savedUser = localStorage.getItem(USER_STORAGE_KEY);
    if (savedUser) {
      try {
        this.currentUser = JSON.parse(savedUser);
      } catch {
        this.currentUser = null;
      }
    }

    const savedLibrary = localStorage.getItem(LIBRARY_CACHE_KEY);
    if (savedLibrary) {
      try {
        this.userLibrary = JSON.parse(savedLibrary);
      } catch {
        this.userLibrary = [];
      }
    }

    const savedAddons = localStorage.getItem(ADDONS_CACHE_KEY);
    if (savedAddons) {
      try {
        this.userAddons = JSON.parse(savedAddons);
      } catch {
        this.userAddons = [];
      }
    }

    const savedSync = localStorage.getItem(LAST_SYNC_KEY);
    if (savedSync) {
      this.lastSyncTime = parseInt(savedSync, 10) || 0;
    }
  }

  public static subscribe(listener: AccountChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private static notify() {
    this.listeners.forEach((fn) => fn(this.currentUser));
  }

  public static getUser(): StremioUser | null {
    if (!this.currentUser) {
      const savedUser = localStorage.getItem(USER_STORAGE_KEY);
      if (savedUser) {
        try {
          this.currentUser = JSON.parse(savedUser);
        } catch {
          this.currentUser = null;
        }
      }
    }
    return this.currentUser;
  }

  public static isLoggedIn(): boolean {
    return !!this.getUser()?.authKey;
  }

  public static getLastSyncDisplay(): string {
    if (!this.lastSyncTime) return 'Nunca sincronizado';
    const elapsedMinutes = Math.floor((Date.now() - this.lastSyncTime) / 60000);
    if (elapsedMinutes < 1) return 'Sincronizado agora';
    if (elapsedMinutes === 1) return 'Sincronizado há 1 minuto';
    if (elapsedMinutes < 60) return `Sincronizado há ${elapsedMinutes} minutos`;
    const hours = Math.floor(elapsedMinutes / 60);
    return `Sincronizado há ${hours}h`;
  }

  /**
   * Check if a media preview is present in the active user library
   */
  public static isInLibrary(id: string): boolean {
    if (!id) return false;
    if (this.removedLocalIds.has(id)) return false;
    if (this.addedLocalItems.has(id)) return true;
    return this.userLibrary.some((item) => item._id === id && !item.removed);
  }

  /**
   * Add or remove a title from the library, updating local cache and Stremio Cloud Datastore
   */
  public static async toggleLibraryItem(meta: StremioMetaPreview): Promise<boolean> {
    const isCurrentlyIn = this.isInLibrary(meta.id);
    const user = this.getUser();

    if (isCurrentlyIn) {
      // Remove from library
      this.removedLocalIds.add(meta.id);
      this.addedLocalItems.delete(meta.id);
      this.userLibrary = this.userLibrary.filter((item) => item._id !== meta.id);
      localStorage.setItem(LIBRARY_CACHE_KEY, JSON.stringify(this.userLibrary));
      this.notify();

      if (user?.authKey) {
        try {
          // Flag the stored item instead of replacing it: its progress and watched episodes stay.
          const raw = await this.fetchRawLibraryItem(meta.id);
          if (raw) await this.putRawLibraryItem({ ...raw, removed: true, temp: false });
        } catch (err) {
          console.warn('Erro ao remover do Stremio Cloud Datastore:', err);
        }
      }

      return false;
    } else {
      // Add to library
      this.removedLocalIds.delete(meta.id);
      const newItem: StremioLibraryItem = {
        _id: meta.id,
        name: meta.name,
        type: meta.type,
        poster:
          meta.poster ||
          (meta.id.startsWith('tt')
            ? `https://images.metahub.space/poster/medium/${meta.id}/img`
            : undefined),
        background:
          meta.background ||
          (meta.id.startsWith('tt')
            ? `https://images.metahub.space/background/medium/${meta.id}/img`
            : undefined),
        year: meta.year,
        imdbRating: meta.imdbRating,
        genres: meta.genres || [],
        logo: meta.logo,
        description: meta.description,
        // Something already being watched keeps its progress when it is added.
        state: this.userLibrary.find((item) => item._id === meta.id)?.state ?? {
          timeOffset: 0,
          duration: 0,
          timesWatched: 0,
          lastWatched: new Date().toISOString(),
        },
        temp: false,
        removed: false,
        _updatedAt: new Date().toISOString(),
      };

      this.addedLocalItems.set(meta.id, newItem);
      this.userLibrary = [newItem, ...this.userLibrary.filter((item) => item._id !== meta.id)];
      localStorage.setItem(LIBRARY_CACHE_KEY, JSON.stringify(this.userLibrary));
      this.notify();

      if (user?.authKey) {
        try {
          const raw = (await this.fetchRawLibraryItem(meta.id)) ?? this.newRawLibraryItem(meta);
          await this.putRawLibraryItem({ ...raw, removed: false, temp: false });
        } catch (err) {
          console.warn('Erro ao salvar no Stremio Cloud Datastore:', err);
        }
      }

      return true;
    }
  }

  private static async datastore(route: 'datastoreGet' | 'datastorePut', body: Record<string, unknown>): Promise<any> {
    const res = await fetch(`${STREMIO_API_URL}/${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data?.error) throw new Error(data.error.message || `${route} falhou`);
    return data?.result;
  }

  /** The library item exactly as Stremio stores it, or null (not saved yet / signed out). */
  public static async fetchRawLibraryItem(id: string): Promise<RawLibraryItem | null> {
    const authKey = this.getUser()?.authKey;
    if (!authKey) return null;
    const result = await this.datastore('datastoreGet', { authKey, collection: 'libraryItem', ids: [id], all: false });
    return Array.isArray(result) ? (result.find((item: RawLibraryItem) => item?._id === id) ?? null) : null;
  }

  /** Stores a full item; `_mtime` is bumped so every Stremio client takes this version. */
  public static async putRawLibraryItem(item: RawLibraryItem): Promise<void> {
    const authKey = this.getUser()?.authKey;
    if (!authKey) return;
    item._mtime = new Date().toISOString();
    await this.datastore('datastorePut', { authKey, collection: 'libraryItem', changes: [item] });
  }

  /** A complete new item in Stremio's format (not in the library: shows only in Continue Watching). */
  public static newRawLibraryItem(meta: { id: string; type: string; name: string; poster?: string }): RawLibraryItem {
    const now = new Date().toISOString();
    return {
      _id: meta.id,
      name: meta.name,
      type: meta.type,
      poster: meta.poster ?? null,
      posterShape: 'poster',
      removed: true,
      temp: true,
      _ctime: now,
      _mtime: now,
      state: {
        lastWatched: null,
        timeWatched: 0,
        timeOffset: 0,
        overallTimeWatched: 0,
        timesWatched: 0,
        flaggedWatched: 0,
        duration: 0,
        video_id: null,
        watched: null,
        noNotif: false,
      },
      behaviorHints: { defaultVideoId: null, featuredVideoId: null, hasScheduledVideos: false },
    };
  }

  private static mapRawItem(item: RawLibraryItem): StremioLibraryItem {
    return {
      _id: item._id,
      name: item.name || 'Título sem nome',
      type: (item.type as StremioLibraryItem['type']) || 'movie',
      poster:
        item.poster ||
        (item._id.startsWith('tt') ? `https://images.metahub.space/poster/medium/${item._id}/img` : undefined),
      background:
        item.background ||
        (item._id.startsWith('tt') ? `https://images.metahub.space/background/medium/${item._id}/img` : undefined),
      year: item.year,
      imdbRating: item.imdbRating,
      genres: Array.isArray(item.genres) ? item.genres : [],
      logo: item.logo,
      description: item.description,
      state: item.state || {},
      removed: !!item.removed,
      temp: !!item.temp,
      _updatedAt: item._mtime || item._updatedAt,
    };
  }

  /** Shows a stored item locally right away (Continue Watching, resume point). */
  public static applyRawLibraryItem(item: RawLibraryItem) {
    const existing = this.userLibrary.find((entry) => entry._id === item._id);
    const mapped = this.mapRawItem(item);
    const others = this.userLibrary.filter((entry) => entry._id !== item._id);
    // Keep artwork and metadata already enriched for this title.
    const next = existing
      ? { ...existing, state: mapped.state, removed: mapped.removed, temp: mapped.temp, _updatedAt: mapped._updatedAt }
      : mapped;
    this.userLibrary = !item.removed || item.temp ? [next, ...others] : others;
    localStorage.setItem(LIBRARY_CACHE_KEY, JSON.stringify(this.userLibrary));
    this.libraryListeners.forEach((fn) => fn());
  }

  /** Fires when progress or library membership changes locally. */
  public static subscribeLibrary(listener: LibraryChangeListener): () => void {
    this.libraryListeners.add(listener);
    return () => this.libraryListeners.delete(listener);
  }

  /** Library items plus titles only being watched (Stremio's Continue Watching rule). */
  public static getWatchingItems(): StremioLibraryItem[] {
    return this.userLibrary.filter((item) => isContinueWatching(item.state));
  }

  /** Seconds to resume `videoId` at, from the synced library (0 = start). */
  public static getResumeSeconds(metaId: string, videoId: string): number {
    return resumeSecondsFor(this.userLibrary.find((item) => item._id === metaId)?.state, metaId, videoId);
  }

  /** Last watched episode recorded in Stremio for a series. */
  public static getLastEpisode(metaId: string): { season: number; episode: number } | null {
    return lastEpisodeOf(this.userLibrary.find((item) => item._id === metaId)?.state);
  }

  /**
   * Log into Stremio official API with email and password
   */
  public static async login(email: string, password: string): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await fetch(`${STREMIO_API_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (data.error) {
        return { success: false, error: data.error.message || 'Falha ao autenticar no Stremio' };
      }

      if (data.result && data.result.authKey) {
        const user: StremioUser = {
          _id: data.result.user?._id || 'user_id',
          email: data.result.user?.email || email,
          fullname: data.result.user?.fullname,
          avatar: data.result.user?.avatar,
          authKey: data.result.authKey,
        };

        this.currentUser = user;
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));

        // Auto-sync Cloud Library and User Addons
        await Promise.allSettled([this.syncLibrary(), this.syncAddons()]);
        this.notify();

        return { success: true };
      }

      return { success: false, error: 'Resposta inesperada dos servidores do Stremio' };
    } catch (err: any) {
      return { success: false, error: err.message || 'Erro de conexão com os servidores do Stremio' };
    }
  }

  /**
   * Login directly with an AuthKey
   */
  public static async loginWithAuthKey(authKey: string): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await fetch(`${STREMIO_API_URL}/getUser`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authKey }),
      });

      const data = await res.json();
      if (data.error) {
        return { success: false, error: 'Chave AuthKey inválida ou expirada' };
      }

      if (data.result) {
        const user: StremioUser = {
          _id: data.result._id || 'user_id',
          email: data.result.email || 'Conta Stremio',
          fullname: data.result.fullname,
          avatar: data.result.avatar,
          authKey,
        };

        this.currentUser = user;
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));

        // Auto-sync Cloud Library and User Addons
        await Promise.allSettled([this.syncLibrary(), this.syncAddons()]);
        this.notify();

        return { success: true };
      }

      return { success: false, error: 'Não foi possível validar a chave' };
    } catch (err: any) {
      return { success: false, error: err.message || 'Erro de conexão' };
    }
  }

  /**
   * Disconnect account and clear session
   */
  public static logout() {
    this.currentUser = null;
    this.userLibrary = [];
    this.userAddons = [];
    this.lastSyncTime = 0;
    localStorage.removeItem(USER_STORAGE_KEY);
    localStorage.removeItem(LIBRARY_CACHE_KEY);
    localStorage.removeItem(ADDONS_CACHE_KEY);
    localStorage.removeItem(LAST_SYNC_KEY);
    this.notify();
  }

  /**
   * Sync and return user's saved Library items from Stremio Cloud Datastore
   */
  public static async syncLibrary(): Promise<StremioLibraryItem[]> {
    const user = this.getUser();

    if (!user?.authKey) {
      return this.getLocalOrFallbackLibrary();
    }

    try {
      const res = await fetch(`${STREMIO_API_URL}/datastoreGet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authKey: user.authKey,
          collection: 'libraryItem',
          all: true,
        }),
      });

      const data = await res.json();

      if (data.result && Array.isArray(data.result)) {
        // Library items, plus titles watched outside the library (`temp`), which Stremio
        // lists in Continue Watching. `getLibrary` hides the latter.
        let parsedItems: StremioLibraryItem[] = data.result
          .filter((item: RawLibraryItem) => item?._id && (!item.removed || item.temp) && !this.removedLocalIds.has(item._id))
          .map((item: RawLibraryItem) => this.mapRawItem(item));

        // Merge any locally added items not yet present in datastoreGet
        for (const [id, localItem] of this.addedLocalItems.entries()) {
          if (!this.removedLocalIds.has(id) && !parsedItems.some((p) => p._id === id)) {
            parsedItems.unshift(localItem);
          }
        }

        // Sort items: items with progress first, then by lastWatched / updatedAt
        parsedItems.sort((a, b) => {
          const aIsWatching = isContinueWatching(a.state);
          const bIsWatching = isContinueWatching(b.state);

          if (aIsWatching && !bIsWatching) return -1;
          if (!aIsWatching && bIsWatching) return 1;

          // If both or neither are watching, compare timestamps
          const timeA = new Date(a.state?.lastWatched || a._updatedAt || 0).getTime();
          const timeB = new Date(b.state?.lastWatched || b._updatedAt || 0).getTime();
          return timeB - timeA;
        });

        this.userLibrary = parsedItems;
        this.lastSyncTime = Date.now();
        localStorage.setItem(LIBRARY_CACHE_KEY, JSON.stringify(this.userLibrary));
        localStorage.setItem(LAST_SYNC_KEY, this.lastSyncTime.toString());
        return this.userLibrary;
      }

      return this.getLocalOrFallbackLibrary();
    } catch (err) {
      console.warn('Erro ao sincronizar com Stremio Cloud Datastore:', err);
      return this.getLocalOrFallbackLibrary();
    }
  }

  /**
   * Get Library (cached or synced)
   */
  public static async getLibrary(forceRefresh: boolean = false): Promise<StremioLibraryItem[]> {
    let items: StremioLibraryItem[];
    const stale = Date.now() - this.lastSyncTime > LIBRARY_MAX_AGE_MS;
    if (forceRefresh || (this.isLoggedIn() && (this.userLibrary.length === 0 || stale))) {
      items = await this.syncLibrary();
    } else {
      items = this.userLibrary.length > 0 ? this.userLibrary : this.getLocalOrFallbackLibrary();
    }
    // Titles only being watched are not in the library (they appear in Continue Watching).
    return items.filter((item) => !item.removed);
  }

  public static async enrichLibrary(items: StremioLibraryItem[]): Promise<StremioLibraryItem[]> {
    const enriched = [...items];
    let next = 0;
    let changed = false;
    // Limit requests for third-party metadata while preserving every entry,
    // ID and progress record, including when a provider is offline.
    await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        const item = items[index];
        if (item.poster && (/^tt\d+$/.test(item._id) || (item.logo && item.description))) continue;
        const meta = await MetadataService.getMeta(item.type, item._id, this.getUserAddons());
        if (!meta) continue;
        enriched[index] = {
          ...item,
          name: !item.name || item.name === 'Título sem nome' ? meta.name : item.name,
          poster: meta.poster || item.poster,
          background: meta.background || meta.banner || item.background,
          logo: meta.logo || item.logo,
          description: meta.description || item.description,
          year: meta.year || meta.releaseInfo || item.year,
          genres: meta.genres || item.genres,
          imdbRating: meta.imdbRating || item.imdbRating,
        };
        changed = true;
      }
    }));
    if (changed && this.userLibrary === items) {
      this.userLibrary = enriched;
      localStorage.setItem(LIBRARY_CACHE_KEY, JSON.stringify(enriched));
    }
    return enriched;
  }

  /**
   * Sync user installed addons from Stremio Cloud
   */
  public static async syncAddons(): Promise<StremioAddon[]> {
    const user = this.getUser();
    const payload = user?.authKey
      ? { type: 'AddonCollectionGet', authKey: user.authKey }
      : { type: 'AddonCollectionGet' };

    try {
      const res = await fetch(`${STREMIO_API_URL}/addonCollectionGet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (data.result && Array.isArray(data.result.addons)) {
        this.userAddons = data.result.addons;
        localStorage.setItem(ADDONS_CACHE_KEY, JSON.stringify(this.userAddons));
        return this.userAddons;
      }
    } catch (err) {
      console.warn('Erro ao sincronizar addons do usuário:', err);
    }
    return this.userAddons;
  }

  /**
   * Remove an addon from the Stremio account (same as "Uninstall" in the official app).
   * Reads the collection fresh first so a change made elsewhere is not overwritten.
   */
  public static async uninstallAddon(transportUrl: string): Promise<{ success: boolean; error?: string }> {
    const authKey = this.getUser()?.authKey;
    if (!authKey) return { success: false, error: 'Conecte sua conta Stremio para remover addons da conta.' };

    const post = async (route: string, body: Record<string, unknown>) => {
      const res = await fetch(`${STREMIO_API_URL}/${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return res.json();
    };

    try {
      const current = await post('addonCollectionGet', { type: 'AddonCollectionGet', authKey });
      const addons: Array<StremioAddon> | undefined = current?.result?.addons;
      if (!Array.isArray(addons)) return { success: false, error: 'Não consegui ler os addons da conta.' };

      const target = addons.find((a) => a.transportUrl === transportUrl);
      if (!target) return { success: false, error: 'Esse addon não está mais na sua conta.' };
      if (target.flags?.protected) return { success: false, error: 'Este addon é protegido e não pode ser removido.' };

      const remaining = addons.filter((a) => a.transportUrl !== transportUrl);
      const saved = await post('addonCollectionSet', { type: 'AddonCollectionSet', authKey, addons: remaining });
      if (saved?.error) {
        return { success: false, error: saved.error.message || 'O Stremio recusou a remoção.' };
      }

      this.userAddons = remaining;
      localStorage.setItem(ADDONS_CACHE_KEY, JSON.stringify(remaining));
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Erro de conexão com os servidores do Stremio' };
    }
  }

  /** Account addons plus the local extensions running in the app. */
  public static getUserAddons(): StremioAddon[] {
    return [...this.getAccountAddons(), ...LocalAddonService.getAddons()];
  }

  /** Addons synced from the Stremio account only. */
  public static getAccountAddons(): StremioAddon[] {
    if (this.userAddons.length > 0) {
      return this.userAddons;
    }
    const savedAddons = localStorage.getItem(ADDONS_CACHE_KEY);
    if (savedAddons) {
      try {
        this.userAddons = JSON.parse(savedAddons);
        return this.userAddons;
      } catch {
        // Fallback
      }
    }
    return [];
  }

  /**
   * Curated offline/preview library with progress bars and badges
   */
  public static getLocalOrFallbackLibrary(): StremioLibraryItem[] {
    const cached = localStorage.getItem(LIBRARY_CACHE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.userLibrary = parsed;
          return parsed;
        }
      } catch {
        // Fallback
      }
    }

    const defaults: StremioLibraryItem[] = [
      {
        _id: 'tt15239678',
        name: 'Duna: Parte 2',
        type: 'movie',
        poster: 'https://images.metahub.space/poster/medium/tt15239678/img',
        background: 'https://images.metahub.space/background/medium/tt15239678/img',
        year: 2024,
        imdbRating: '8.6',
        genres: ['Ficção Científica', 'Aventura'],
        state: {
          timeOffset: 5400,
          duration: 9960,
          lastWatched: 'Ontem',
        },
      },
      {
        _id: 'tt1190634',
        name: 'The Boys',
        type: 'series',
        poster: 'https://images.metahub.space/poster/medium/tt1190634/img',
        background: 'https://images.metahub.space/background/medium/tt1190634/img',
        year: '2019-',
        imdbRating: '8.7',
        genres: ['Ação', 'Comédia'],
        state: {
          timeOffset: 2400,
          duration: 3600,
          video_id: 'Temporada 4, Ep. 3',
          lastWatched: 'Há 3 dias',
        },
      },
      {
        _id: 'tt12637874',
        name: 'Fallout',
        type: 'series',
        poster: 'https://images.metahub.space/poster/medium/tt12637874/img',
        background: 'https://images.metahub.space/background/medium/tt12637874/img',
        year: '2024-',
        imdbRating: '8.4',
        genres: ['Ação', 'Aventura'],
        state: {
          timeOffset: 3200,
          duration: 3600,
          video_id: 'Temporada 1, Ep. 8',
          lastWatched: 'Semana passada',
        },
      },
      {
        _id: 'tt15398776',
        name: 'Oppenheimer',
        type: 'movie',
        poster: 'https://images.metahub.space/poster/medium/tt15398776/img',
        background: 'https://images.metahub.space/background/medium/tt15398776/img',
        year: 2023,
        imdbRating: '8.9',
        genres: ['Biografia', 'Drama'],
        state: {
          timeOffset: 10800,
          duration: 10800,
          lastWatched: 'Finalizado',
        },
      },
      {
        _id: 'tt0816692',
        name: 'Interestelar',
        type: 'movie',
        poster: 'https://images.metahub.space/poster/medium/tt0816692/img',
        background: 'https://images.metahub.space/background/medium/tt0816692/img',
        year: 2014,
        imdbRating: '8.7',
        genres: ['Ficção Científica'],
        state: {
          timeOffset: 1800,
          duration: 10140,
          lastWatched: 'Há 2 semanas',
        },
      },
      {
        _id: 'tt6263850',
        name: 'Deadpool & Wolverine',
        type: 'movie',
        poster: 'https://images.metahub.space/poster/medium/tt6263850/img',
        background: 'https://images.metahub.space/background/medium/tt6263850/img',
        year: 2024,
        imdbRating: '7.8',
        genres: ['Ação', 'Comédia'],
        state: {
          timeOffset: 7200,
          duration: 7600,
          lastWatched: 'Ontem',
        },
      },
    ];

    this.userLibrary = defaults;
    return defaults;
  }
}
