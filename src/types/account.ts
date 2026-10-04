export interface StremioUser {
  _id: string;
  email: string;
  avatar?: string;
  fullname?: string;
  premium_expire?: string | null;
  authKey: string;
}

export interface LibraryItemState {
  timeOffset?: number; // seconds watched
  duration?: number;   // total duration seconds
  video_id?: string;   // last watched episode id (e.g. tt1190634:1:1)
  lastWatched?: string;
  timesWatched?: number;
  flagCheck?: number;
}

export interface StremioLibraryItem {
  _id: string;
  name: string;
  type: 'movie' | 'series' | 'channel' | 'tv';
  poster?: string;
  background?: string;
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
  manifest: {
    id: string;
    version: string;
    name: string;
    description?: string;
    logo?: string;
    background?: string;
    types: string[];
    catalogs?: any[];
    resources?: any[];
  };
}
