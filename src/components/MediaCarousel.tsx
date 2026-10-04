import React, { useRef, useEffect } from 'react';
import type { StremioMetaPreview } from '../types/stremio';
import { MediaCard } from './MediaCard';

interface Props {
  title: string;
  items: StremioMetaPreview[];
  isRowActive: boolean;
  focusedColIndex: number;
  onSelect: (item: StremioMetaPreview) => void;
  onItemFocus?: (item: StremioMetaPreview) => void;
}

export const MediaCarousel: React.FC<Props> = ({
  title,
  items,
  isRowActive,
  focusedColIndex,
  onSelect,
  onItemFocus,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  // PURE HORIZONTAL SCROLL - Never triggers vertical parent scroll
  useEffect(() => {
    if (isRowActive && cardRefs.current[focusedColIndex] && containerRef.current) {
      const activeCard = cardRefs.current[focusedColIndex];
      const container = containerRef.current;

      const cardLeft = activeCard.offsetLeft;
      const cardWidth = activeCard.offsetWidth;
      const containerWidth = container.offsetWidth;

      // Keep focused card centered horizontally in viewport
      const targetLeft = cardLeft - containerWidth / 2 + cardWidth / 2;

      container.scrollTo({
        left: Math.max(0, targetLeft),
        behavior: 'smooth',
      });

      if (items[focusedColIndex] && onItemFocus) {
        onItemFocus(items[focusedColIndex]);
      }
    }
  }, [isRowActive, focusedColIndex, items, onItemFocus]);

  if (!items || items.length === 0) return null;

  return (
    <div className="w-full py-1 select-none">
      {/* Row Header */}
      <div className="px-12 mb-2 flex items-center justify-between">
        <h2 className="text-lg font-black tracking-wide text-zinc-100 uppercase flex items-center gap-2.5">
          {title}
          {isRowActive && (
            <span
              className="w-2 h-2 rounded-full animate-ping inline-block"
              style={{ backgroundColor: 'var(--app-accent)' }}
            />
          )}
        </h2>
        <span className="text-xs text-zinc-500 font-semibold tracking-wider">
          {isRowActive ? `${focusedColIndex + 1} / ${items.length}` : ''}
        </span>
      </div>

      {/* Horizontal Scroll Track (Isolated from vertical page scroll) */}
      <div
        ref={containerRef}
        className="flex items-center gap-5 px-12 overflow-x-auto scroll-smooth py-3 no-scrollbar"
      >
        {items.map((item, index) => {
          const isFocused = isRowActive && focusedColIndex === index;
          return (
            <div
              key={`${item.id}-${index}`}
              ref={(el) => {
                cardRefs.current[index] = el;
              }}
              className="flex-shrink-0"
            >
              <MediaCard
                item={item}
                isFocused={isFocused}
                onClick={() => onSelect(item)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};
