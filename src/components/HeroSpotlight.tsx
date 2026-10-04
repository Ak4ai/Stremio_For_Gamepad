import React, { useState, useEffect } from 'react';
import { LiquidGlassLayer } from './LiquidGlassLayer';
import type { StremioMetaPreview } from '../types/stremio';
import { Star, Film, Tv, Calendar, Bookmark, BookmarkMinus } from 'lucide-react';
import { ControllerButtonBadge } from './ControllerButtonBadge';
import { ThemeService } from '../services/theme';
import type { ThemeId } from '../types/theme';

interface Props {
  item: StremioMetaPreview | null;
  isInLibrary?: boolean;
  onPlay: (item: StremioMetaPreview) => void;
  onToggleLibrary?: (item: StremioMetaPreview) => void;
  onDetails?: (item: StremioMetaPreview) => void;
}

export const HeroSpotlight: React.FC<Props> = ({
  item,
  isInLibrary = false,
  onPlay,
  onToggleLibrary,
  onDetails,
}) => {
  const [currentTheme, setCurrentTheme] = useState<ThemeId>(() => ThemeService.getTheme());

  useEffect(() => {
    return ThemeService.subscribe((t) => setCurrentTheme(t));
  }, []);

  const isPs1 = currentTheme === 'ps1';

  if (!item) {
    return (
      <div className="relative w-full h-[48vh] min-h-[350px] max-h-[440px] flex items-center px-12 bg-black/40 flex-shrink-0">
        <div className="text-zinc-600 animate-pulse text-sm">Carregando catálogo...</div>
      </div>
    );
  }

  const bgImage = item.background || item.banner || item.poster;

  return (
    <div className="relative w-full h-[48vh] min-h-[350px] max-h-[440px] px-12 pt-24 pb-4 flex flex-col justify-end overflow-hidden select-none flex-shrink-0">
      {/* Background Backdrop with Multi-Directional Fades */}
      {bgImage && (
        <div
          key={item.id}
          className="absolute inset-0 bg-cover bg-center transition-all duration-700 ease-out scale-105 animate-fade-in"
          style={{
            backgroundImage: `url('${bgImage}')`,
          }}
        >
          {/* Top Subtle Shadow for Header Legibility */}
          <div className="absolute top-0 left-0 right-0 h-28 bg-gradient-to-b from-black/75 via-black/25 to-transparent pointer-events-none" />

          {/* Left Dark Gradient for Typography Legibility */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'linear-gradient(to right, var(--app-bg) 0%, color-mix(in srgb, var(--app-bg) 80%, transparent) 45%, transparent 100%)',
            }}
          />

          {/* Bottom Seamless Fade into Carousel Rows */}
          <div
            className="absolute bottom-0 left-0 right-0 h-40 pointer-events-none"
            style={{
              background: 'linear-gradient(to top, var(--app-bg) 0%, var(--app-bg) 20%, color-mix(in srgb, var(--app-bg) 85%, transparent) 60%, transparent 100%)',
            }}
          />
        </div>
      )}

      {/* Content overlay */}
      <div className="relative z-10 max-w-3xl">
        {/* Badges / Meta row */}
        <div className="flex items-center gap-2.5 text-xs mb-2">
          {item.imdbRating && (
            <div
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md font-bold text-[11px] backdrop-blur-md ${
                isPs1
                  ? 'bg-white/10 text-white border border-white/25 shadow-sm'
                  : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
              }`}
            >
              <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
              <span>{item.imdbRating}</span>
            </div>
          )}

          {item.year && (
            <div
              className={`flex items-center gap-1 px-2 py-0.5 rounded-md font-semibold text-[11px] backdrop-blur-md ${
                isPs1
                  ? 'bg-white/10 text-white border border-white/25 shadow-sm'
                  : 'bg-black/40 text-zinc-300 border border-white/10'
              }`}
            >
              <Calendar className="w-3 h-3 text-zinc-300" />
              <span>{item.year}</span>
            </div>
          )}

          <div
            className={`flex items-center gap-1 px-2 py-0.5 rounded-md font-semibold text-[11px] uppercase backdrop-blur-md ${
              isPs1
                ? 'bg-white/10 text-white border border-white/25 shadow-sm'
                : 'bg-black/40 text-zinc-300 border border-white/10'
            }`}
          >
            {item.type === 'movie' ? <Film className="w-3 h-3" /> : <Tv className="w-3 h-3" />}
            <span>{item.type === 'movie' ? 'Filme' : 'Série'}</span>
          </div>

          {item.genres &&
            item.genres.slice(0, 3).map((genre) => (
              <span
                key={genre}
                className={`font-medium px-2 py-0.5 rounded-md text-[11px] backdrop-blur-md ${
                  isPs1
                    ? 'bg-white/10 text-white border border-white/25 shadow-sm'
                    : 'bg-black/40 text-zinc-300 border border-white/10'
                }`}
              >
                {genre}
              </span>
            ))}
        </div>

        {/* Title */}
        <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight drop-shadow-lg line-clamp-1 mb-2">
          {item.name}
        </h1>

        {/* Synopsis */}
        <p className="text-xs md:text-sm text-zinc-300/90 line-clamp-2 leading-relaxed mb-4 drop-shadow-md max-w-2xl">
          {item.description || 'Nenhuma descrição disponível para este título.'}
        </p>

        {/* Quick action buttons row */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => onPlay(item)}
            style={{
              backgroundColor: 'var(--app-accent)',
              boxShadow: isPs1
                ? '0 4px 20px rgba(0, 0, 0, 0.35), 0 0 16px rgba(0, 114, 206, 0.4)'
                : '0 4px 18px var(--app-accent-glow)',
            }}
            className={`liquid-glass-detail liquid-glass-control flex items-center gap-2 text-white font-bold px-5 py-2.5 rounded-xl transition-transform hover:scale-105 cursor-pointer shadow-lg text-xs ${
              isPs1 ? 'border-2 border-white/30' : 'border border-white/20'
            }`}
          >
            <LiquidGlassLayer />
            <ControllerButtonBadge button="A" size="sm" currentTheme={currentTheme} />
            <span>Assistir / Fontes</span>
          </button>

          <button
            onClick={() => {
              if (onToggleLibrary) onToggleLibrary(item);
              else if (onDetails) onDetails(item);
            }}
            style={
              isInLibrary
                ? {
                    backgroundColor: 'color-mix(in srgb, var(--app-remove-color, #FF334B) 22%, transparent)',
                    borderColor: 'var(--app-remove-color, #FF334B)',
                    color: 'var(--app-remove-color, #FF334B)',
                    boxShadow: '0 0 18px color-mix(in srgb, var(--app-remove-color, #FF334B) 40%, transparent)',
                  }
                : undefined
            }
            className={`liquid-glass-detail liquid-glass-control flex items-center gap-2 font-bold px-4 py-2.5 rounded-xl backdrop-blur-md transition-all cursor-pointer shadow-md text-xs ${
              isInLibrary
                ? 'border-2'
                : isPs1
                ? 'bg-white/10 hover:bg-white/20 text-white border-2 border-white/30 shadow-lg'
                : 'bg-black/40 hover:bg-white/15 text-zinc-200 border border-white/15'
            }`}
          >
            <LiquidGlassLayer />
            <ControllerButtonBadge button="X" size="sm" currentTheme={currentTheme} />
            {isInLibrary ? (
              <span className="flex items-center gap-1.5 font-bold">
                <BookmarkMinus
                  className="w-3.5 h-3.5"
                  style={{ color: 'var(--app-remove-color, #FF334B)' }}
                />
                <span style={{ color: 'var(--app-remove-color, #FF334B)' }}>Remover da Biblioteca</span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5 font-bold">
                <Bookmark className="w-3.5 h-3.5 text-zinc-300" />
                <span>Adicionar à Biblioteca</span>
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
