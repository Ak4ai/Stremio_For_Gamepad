import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { StremioMetaPreview } from '../types/stremio';
import { logoImageStatus, markLogoImageFailed, mediaLogoUrl, preloadLogoImage, subscribeLogoImage } from '../services/logoImages';

export function MediaTitle({ item, className, as: Heading = 'h1', logoHeight = 96 }: {
  item: StremioMetaPreview; className?: string; as?: 'h1' | 'h2'; logoHeight?: number;
}) {
  const logo = mediaLogoUrl(item);
  const subscribe = useCallback((listener: () => void) => subscribeLogoImage(logo, listener), [logo]);
  const snapshot = useCallback(() => logoImageStatus(logo), [logo]);
  const status = useSyncExternalStore(subscribe, snapshot, () => 'idle');
  const [fallbackUrl, setFallbackUrl] = useState<string>();
  useEffect(() => {
    preloadLogoImage(logo, true);
    const timer = setTimeout(() => setFallbackUrl(logo), 650);
    return () => clearTimeout(timer);
  }, [logo]);
  const pending = Boolean(logo && status !== 'ready' && status !== 'failed' && fallbackUrl !== logo);
  return (
    <Heading className={className} aria-label={item.name}>
      {logo && status === 'ready' ? (
        <img src={logo} alt={item.name} referrerPolicy="no-referrer"
          decoding="async" style={{ height: logoHeight }}
          onError={() => markLogoImageFailed(logo)}
          className="block max-w-[min(420px,100%)] w-auto object-contain object-left drop-shadow-lg" />
      ) : pending ? (
        <span className="flex items-center" style={{ height: logoHeight }} aria-hidden="true">
          <span className="block h-6 w-48 max-w-full rounded-lg bg-white/5 animate-pulse" />
        </span>
      ) : item.name}
    </Heading>
  );
}
