import React from 'react';
import type { StremioMetaPreview } from '../types/stremio';
import { Star, Clock } from 'lucide-react';
import { FALLBACK_POSTER } from '../utils/posterFallback';

interface Props {
  item: StremioMetaPreview;
  isFocused: boolean;
  onClick: () => void;
}

export const MediaCard: React.FC<Props> = ({ item, isFocused, onClick }) => {
  const posterUrl = item.poster || item.banner || item.background || FALLBACK_POSTER;

  // Calculate watching progress and remaining time
  const progress =
    typeof item.progress === 'number'
      ? item.progress
      : item.state?.duration && item.state.timeOffset
      ? Math.min(100, Math.floor((item.state.timeOffset / item.state.duration) * 100))
      : 0;

  const remainingMinutes =
    typeof item.remainingMinutes === 'number'
      ? item.remainingMinutes
      : item.state?.duration && item.state.timeOffset
      ? Math.max(1, Math.round((item.state.duration - item.state.timeOffset) / 60))
      : null;

  return (
    <div
      onClick={onClick}
      className={`relative flex-shrink-0 w-36 md:w-44 aspect-[2/3] rounded-xl overflow-hidden cursor-pointer transition-all duration-200 select-none ${
        isFocused
          ? 'xbox-focused ring-4 ring-white shadow-2xl'
          : 'border border-white/10 hover:border-white/20 opacity-90'
      }`}
      style={isFocused ? { boxShadow: '0 0 25px var(--app-accent-glow), 0 0 0 3px #ffffff' } : undefined}
    >
      {/* Poster Image */}
      <img
        src={posterUrl}
        alt={item.name}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={(e) => {
          const target = e.target as HTMLImageElement;
          if (target.src !== FALLBACK_POSTER) {
            target.src = FALLBACK_POSTER;
          }
        }}
        className={`w-full h-full object-cover transition-transform duration-300 ${
          isFocused ? 'scale-105' : 'scale-100'
        }`}
      />

      {/* Dark gradient for text readability */}
      <div
        className={`absolute inset-0 bg-gradient-to-t from-black/95 via-black/30 to-transparent transition-opacity duration-200 ${
          isFocused ? 'opacity-100' : 'opacity-80'
        }`}
      />

      {/* Rating badge on top right */}
      {item.imdbRating && (
        <div className="absolute top-2.5 right-2.5 flex items-center gap-1 bg-black/70 backdrop-blur-md border border-white/15 px-2 py-0.5 rounded-md text-[11px] font-bold text-amber-300 z-10">
          <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
          <span>{item.imdbRating}</span>
        </div>
      )}

      {/* Progress Bar & Remaining Time (Same as LibraryView) */}
      {progress > 0 && (
        <div className="media-card-progress absolute bottom-12 left-3 right-3 z-10 pointer-events-none">
          <div className="w-full h-1.5 bg-black/70 rounded-full overflow-hidden border border-white/20">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${progress}%`,
                backgroundColor: 'var(--app-accent)',
                boxShadow: '0 0 8px var(--app-accent-glow)',
              }}
            />
          </div>
          {remainingMinutes && (
            <div className="text-[9px] text-zinc-300 font-medium mt-1 flex items-center gap-1 drop-shadow">
              <Clock className="w-2.5 h-2.5 text-zinc-400" />
              <span>Faltam {remainingMinutes} min</span>
            </div>
          )}
        </div>
      )}

      {/* Bottom Info: Title & Release */}
      <div className="media-card-info absolute bottom-0 left-0 right-0 p-3 z-10">
        <h3 className="text-white font-bold text-sm tracking-tight line-clamp-1 drop-shadow">
          {item.name}
        </h3>
        <div className="flex items-center justify-between text-[11px] text-zinc-400 mt-0.5">
          <span>{item.year || (item.type === 'movie' ? 'Filme' : 'Série')}</span>
          {progress > 0 ? (
            <span className="text-emerald-400 font-bold">{progress}%</span>
          ) : (
            item.genres && item.genres[0] && (
              <span className="text-zinc-500">{item.genres[0]}</span>
            )
          )}
        </div>
      </div>
    </div>
  );
};
