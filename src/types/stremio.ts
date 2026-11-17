export interface StremioMetaPreview {
  id: string;
  type: 'movie' | 'series' | 'anime' | 'channel' | 'tv';
  name: string;
  poster?: string;
  banner?: string;
  background?: string;
  logo?: string;
  description?: string;
  releaseInfo?: string;
  year?: string | number;
  imdbRating?: string;
  genres?: string[];
  progress?: number;
  remainingMinutes?: number;
  state?: any;
}

export interface StremioMetaDetail extends StremioMetaPreview {
  runtime?: string;
  cast?: string[];
  director?: string[];
  videos?: Array<{
    id: string;
    title: string;
    released: string;
    thumbnail?: string;
    episode: number;
    season: number;
    overview?: string;
  }>;
}

export interface StremioStream {
  name?: string;
  title?: string;
  infoHash?: string;
  fileIdx?: number;
  sources?: string[];
  announce?: string[];
  url?: string;
  /** Opens in the browser instead of playing (e.g. an addon asking the user to sign in). */
  externalUrl?: string;
  /** Addon that returned this stream (set by the app). `order` follows the installed addon order. */
  origin?: { key: string; name: string; order: number };
  behaviorHints?: {
    bingeGroup?: string;
    notWebReady?: boolean;
    proxyHeaders?: {
      request?: Record<string, string>;
      response?: Record<string, string>;
    };
  };
}

export interface StremioSubtitle {
  id: string;
  url: string;
  lang: string;
  subtitleFileName?: string;
}

export interface StremioCatalogResponse {
  metas: StremioMetaPreview[];
}

export interface ServerStatus {
  isOnline: boolean;
  version?: string;
  baseUrl: string;
}
