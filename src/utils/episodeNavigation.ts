import type { StremioMetaDetail, StremioStream } from '../types/stremio';
import { parseStream } from './streamParser';

export function adjacentEpisodes(videos: StremioMetaDetail['videos'], currentId?: string) {
  const ordered = [...(videos || [])].filter((video) => Number.isInteger(video.season) && Number.isInteger(video.episode))
    .sort((a, b) => a.season - b.season || a.episode - b.episode);
  const index = ordered.findIndex((video) => video.id === currentId);
  return { previous: index > 0 ? ordered[index - 1] : undefined,
    next: index >= 0 ? ordered[index + 1] : undefined };
}

export function preferredEpisodeStream(streams: StremioStream[], current: StremioStream) {
  const original = parseStream(current);
  const score = (stream: StremioStream) => {
    const parsed = parseStream(stream);
    return (current.behaviorHints?.bingeGroup && stream.behaviorHints?.bingeGroup === current.behaviorHints.bingeGroup ? 100 : 0)
      + (parsed.isPtBr === original.isPtBr ? 40 : 0)
      + (parsed.addonName === original.addonName ? 10 : 0)
      + (parsed.resolution === original.resolution ? 5 : 0);
  };
  return streams.filter((stream) => stream.url || stream.infoHash).sort((a, b) => score(b) - score(a))[0];
}
