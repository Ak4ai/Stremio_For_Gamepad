import { useEffect, useId, useRef, useState } from 'react';
import { ThemeService } from '../services/theme';
import { createStudioGlassMaps } from '../utils/studioGlass';

export function LiquidGlassLayer({ radius }: { radius?: number }) {
  const [theme, setTheme] = useState(() => ThemeService.getTheme());
  const host = useRef<HTMLSpanElement>(null);
  const id = `studio-glass-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [glass, setGlass] = useState<{ width: number; height: number; radius: number; displacement: string; rim: string }>();
  useEffect(() => ThemeService.subscribe(setTheme), []);
  useEffect(() => {
    if (theme !== 'liquid-glass' || !host.current) return;
    const element = host.current;
    let visible = false, timer = 0;
    const update = () => {
      if (!visible) return;
      const width = Math.round(element.clientWidth), height = Math.round(element.clientHeight);
      const inheritedRadius = parseFloat(getComputedStyle(element.parentElement!).borderTopLeftRadius);
      const r = radius ?? (Number.isFinite(inheritedRadius) ? inheritedRadius : 16);
      if (!width || !height) return;
      setGlass(previous => previous?.width === width && previous.height === height && previous.radius === r
        ? previous : { width, height, radius: r, ...createStudioGlassMaps(width, height, r) });
    };
    const visibility = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) update();
    }, { rootMargin: '80px' });
    const resize = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(update, 50);
    });
    visibility.observe(element); resize.observe(element);
    return () => { visibility.disconnect(); resize.disconnect(); window.clearTimeout(timer); };
  }, [theme, radius]);
  if (theme !== 'liquid-glass') return null;
  return <span ref={host} className="liquid-glass-layer" aria-hidden="true" data-studio-glass="true">
    {glass && <>
      <svg className="liquid-glass-definitions" aria-hidden="true">
        <defs><filter id={id} x="0" y="0" width={glass.width} height={glass.height} filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="0.45" result="soft" />
          <feImage href={glass.displacement} x="0" y="0" width={glass.width} height={glass.height} preserveAspectRatio="none" result="normals" />
          <feDisplacementMap in="soft" in2="normals" scale="32" xChannelSelector="R" yChannelSelector="G" />
        </filter></defs>
      </svg>
      <span className="liquid-glass-refraction" style={{ backdropFilter: `url("#${id}") saturate(1.08)`, WebkitBackdropFilter: `url("#${id}") saturate(1.08)` }} />
      <span className="liquid-glass-rim" style={{ backgroundImage: `url("${glass.rim}")` }} />
    </>}
  </span>;
}
