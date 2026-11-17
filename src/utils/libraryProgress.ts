import type { LibraryItemState } from '../types/account';

/**
 * Stremio stores `timeOffset` and `duration` in milliseconds; the offline sample
 * library uses seconds. Anything past a day of runtime can only be milliseconds.
 */
export function progressSeconds(state?: LibraryItemState): { offset: number; duration: number } {
  const offset = Number(state?.timeOffset) || 0;
  const duration = Number(state?.duration) || 0;
  const scale = offset > 86_400 || duration > 86_400 ? 1000 : 1;
  return { offset: offset / scale, duration: duration / scale };
}

export function isContinueWatching(state?: LibraryItemState): boolean {
  const { offset, duration } = progressSeconds(state);
  return offset > 0 && (duration <= 0 || offset < duration * 0.95);
}

/** 0-100, or 0 without a known duration. */
export function progressPercent(state?: LibraryItemState): number {
  const { offset, duration } = progressSeconds(state);
  return duration > 0 && offset > 0 ? Math.min(100, Math.floor((offset / duration) * 100)) : 0;
}

/** Minutes left, or undefined without progress. */
export function remainingMinutes(state?: LibraryItemState): number | undefined {
  const { offset, duration } = progressSeconds(state);
  return duration > 0 && offset > 0 ? Math.max(1, Math.round((duration - offset) / 60)) : undefined;
}

/**
 * Where to resume `videoId` (seconds). 0 when the saved progress belongs to another
 * episode, is too short to matter or is already at the credits.
 */
export function resumeSecondsFor(state: LibraryItemState | undefined, metaId: string, videoId: string): number {
  if (!state) return 0;
  const sameVideo = state.video_id ? state.video_id === videoId : videoId === metaId;
  if (!sameVideo) return 0;
  const { offset, duration } = progressSeconds(state);
  if (offset < 5 || (duration > 0 && offset > duration * 0.95)) return 0;
  return offset;
}

/** Season/episode of the last watched video (`tt123:2:5`), if it is an episode. */
export function lastEpisodeOf(state?: LibraryItemState): { season: number; episode: number } | null {
  const match = state?.video_id?.match(/:(\d+):(\d+)$/);
  return match ? { season: Number(match[1]), episode: Number(match[2]) } : null;
}
