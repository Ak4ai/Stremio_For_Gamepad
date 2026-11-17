export interface StremioUser {
  _id: string;
  email: string;
  avatar?: string;
  fullname?: string;
  premium_expire?: string | null;
  authKey: string;
}

export interface LibraryItemState {
  timeOffset?: number; // position; Stremio stores ms (use utils/libraryProgress to read it)
  duration?: number;   // total duration; Stremio stores ms
  video_id?: string;   // last watched episode id (e.g. tt1190634:1:1)
  lastWatched?: string;
  timesWatched?: number;
  flagCheck?: number;
}

/**
 * A library item exactly as Stremio's datastore holds it. Writes start from this
 * so fields the app doesn't use (watched bitfield, behaviorHints...) are kept.
 */
export type RawLibraryItem = {
  _id: string;
  name?: string;
  type?: string;
  removed?: boolean;
  temp?: boolean;
  _mtime?: string;
  state?: Record<string, any>;
} & Record<string, any>;

export interface StremioLibraryItem {
  _id: string;
  name: string;
  type: 'movie' | 'series' | 'anime' | 'channel' | 'tv';
  poster?: string;
  background?: string;
  logo?: string;
  description?: string;
  year?: string | number;
  imdbRating?: string;
  genres?: string[];
  state?: LibraryItemState;
  temp?: boolean;
  removed?: boolean;
  _updatedAt?: string;
}

export interface StremioAddon {
  transportUrl: string;
  /** Set for extensions installed in the app (running on this machine). */
  local?: boolean;
  /** Account flags: protected addons (e.g. Cinemeta) cannot be uninstalled. */
  flags?: { protected?: boolean; official?: boolean };
  manifest: {
    id: string;
    version: string;
    name: string;
    description?: string;
    logo?: string;
    background?: string;
    types: string[];
    idPrefixes?: string[];
    catalogs?: any[];
    resources?: any[];
    behaviorHints?: { configurable?: boolean; configurationRequired?: boolean };
  };
}
