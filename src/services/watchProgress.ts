import type { RawLibraryItem } from '../types/account';
import { AccountService } from './account';
import { resumeSecondsFor } from '../utils/libraryProgress';

/** Save to the Stremio cloud at most this often while playing (pause and exit save at once). */
const PUT_INTERVAL_MS = 30_000;
/** Opening a video and leaving right away doesn't touch the saved progress. */
const MIN_WATCHED_SEC = 3;
/** Same thresholds as stremio-core: counts as watched / reached the credits. */
const WATCHED_THRESHOLD = 0.7;
const CREDITS_THRESHOLD = 0.9;

export interface WatchTarget {
  id: string;
  type: string;
  name: string;
  poster?: string;
}

/**
 * Progress of one playback, kept in sync with the user's Stremio library the way the
 * official app does: position, duration, current episode and time watched, in
 * milliseconds, on the stored item (other fields of the item are left untouched).
 */
export class WatchSession {
  private readonly remote: Promise<RawLibraryItem | null>;
  private item: RawLibraryItem | null = null;
  private position: { time: number; duration: number } | null = null;
  private watchedSec = 0;
  private pendingWatchedMs = 0;
  private lastSaveAt = 0;
  private dirty = false;
  private queue: Promise<void> = Promise.resolve();
  private readonly target: WatchTarget;
  private readonly videoId: string;

  constructor(target: WatchTarget, videoId: string) {
    this.target = target;
    this.videoId = videoId;
    this.remote = AccountService.fetchRawLibraryItem(target.id).catch(() => null);
  }

  /** Resume point stored in the cloud for this video (seconds, 0 = start). */
  async remoteResumeSeconds(): Promise<number> {
    const raw = await this.remote;
    return resumeSecondsFor(raw?.state, this.target.id, this.videoId);
  }

  /** Every `timeupdate` while playing; `watchedDeltaSec` is real playback since the last call. */
  tick(timeSec: number, durationSec: number, watchedDeltaSec: number) {
    if (!(durationSec > 0) || !Number.isFinite(durationSec) || timeSec < 1) return;
    this.position = { time: timeSec, duration: durationSec };
    this.watchedSec += watchedDeltaSec;
    this.pendingWatchedMs += watchedDeltaSec * 1000;
    if (this.watchedSec < MIN_WATCHED_SEC) return;
    this.dirty = true;
    if (Date.now() - this.lastSaveAt > PUT_INTERVAL_MS) void this.save(false);
  }

  /** Save now (pause, exit, end of video). `final` = this playback is over. */
  save(final: boolean): Promise<void> {
    if (!this.dirty || !this.position) return this.queue;
    this.dirty = false;
    this.lastSaveAt = Date.now();
    const { time, duration } = this.position;
    const watchedMs = Math.round(this.pendingWatchedMs);
    this.pendingWatchedMs = 0;

    this.queue = this.queue.then(async () => {
      if (!this.item) {
        const remote = await this.remote;
        this.item = remote ? structuredClone(remote) : AccountService.newRawLibraryItem(this.target);
      }
      const item = this.item;
      const state = (item.state ??= {});

      // Another episode than the stored one: its counters start over.
      if (state.video_id !== this.videoId) {
        state.video_id = this.videoId;
        state.timeWatched = 0;
        state.flaggedWatched = 0;
      }
      const durationMs = Math.round(duration * 1000);
      let offsetMs = Math.round(time * 1000);
      state.duration = durationMs;
      state.timeWatched = (Number(state.timeWatched) || 0) + watchedMs;
      state.overallTimeWatched = (Number(state.overallTimeWatched) || 0) + watchedMs;
      state.timesWatched = Number(state.timesWatched) || 0;
      if (!state.flaggedWatched && state.timeWatched > durationMs * WATCHED_THRESHOLD) {
        state.flaggedWatched = 1;
        state.timesWatched += 1;
      }
      // Left at the credits: finished, so it leaves Continue Watching.
      if (final && offsetMs > durationMs * CREDITS_THRESHOLD) offsetMs = 0;
      state.timeOffset = offsetMs;
      state.lastWatched = new Date().toISOString();
      state.noNotif ??= false;
      // A title removed from the library still shows in Continue Watching while it is watched.
      if (item.removed) item.temp = true;

      AccountService.applyRawLibraryItem(item);
      try {
        await AccountService.putRawLibraryItem(item);
      } catch (err) {
        console.warn('[progresso] não foi possível salvar no Stremio:', err);
        this.dirty = true;
      }
    });
    return this.queue;
  }
}
