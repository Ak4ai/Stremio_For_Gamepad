import { useEffect, useRef, useState } from 'react';
import { ThemeService } from '../services/theme';
import { keyboardGelSpring } from '../utils/keyboardNavigation';
import { LiquidGlassLayer } from './LiquidGlassLayer';

export function LiquidGlassRail({ selected }: { selected: string }) {
  const [theme, setTheme] = useState(() => ThemeService.getTheme());
  const bubble = useRef<HTMLSpanElement>(null);
  const motion = useRef<Animation | null>(null);
  const previous = useRef<{ left: number; top: number; width: number; height: number } | null>(null);
  useEffect(() => ThemeService.subscribe(setTheme), []);
  useEffect(() => () => motion.current?.cancel(), []);
  useEffect(() => {
    if (theme !== 'liquid-glass') { motion.current?.cancel(); previous.current = null; return; }
    if (!bubble.current) return;
    const element = bubble.current, parent = element.parentElement!;
    const update = () => {
      const target = parent.querySelector<HTMLElement>(`[data-glass-tab="${selected}"]`);
      if (!target) return;
      const bounds = parent.getBoundingClientRect(), rect = target.getBoundingClientRect();
      const next = { left: rect.left - bounds.left - 2, top: rect.top - bounds.top - 2, width: rect.width + 4, height: rect.height + 4 };
      const old = previous.current;
      const current = element.getBoundingClientRect();
      motion.current?.cancel();
      Object.assign(element.style, { left: `${next.left}px`, top: `${next.top}px`, width: `${next.width}px`, height: `${next.height}px`, opacity: '1' });
      if (old && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const dx = current.left - bounds.left - next.left, dy = current.top - bounds.top - next.top;
        const distance = Math.hypot(dx, dy);
        const frames: Keyframe[] = [];
        for (let i = 0; i <= 30; i++) {
          const t = i / 30, spring = i === 30 ? 1 : keyboardGelSpring(t * 0.48);
          const pull = Math.sin(Math.PI * t) * Math.min(0.14, distance / 1200);
          frames.push({ transform: `translate3d(${dx * (1 - spring)}px,${dy * (1 - spring)}px,0) scale(${1 + (current.width / next.width - 1) * (1 - spring) + pull},${1 + (current.height / next.height - 1) * (1 - spring) - pull * 0.3})`, offset: t });
        }
        motion.current = element.animate(frames, { duration: 480, easing: 'linear' });
      }
      previous.current = next;
    };
    update();
    const resize = new ResizeObserver(update);
    resize.observe(parent);
    return () => resize.disconnect();
  }, [selected, theme]);
  if (theme !== 'liquid-glass') return null;
  return <span ref={bubble} className="liquid-glass-selection" aria-hidden="true"><LiquidGlassLayer radius={14} /></span>;
}
