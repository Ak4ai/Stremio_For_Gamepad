import type { StremioMetaPreview } from '../types/stremio';
import { imdbArtwork } from './metadata';

type Status = 'idle' | 'loading' | 'ready' | 'failed';
type Entry = { status: Status; image?: HTMLImageElement };
const images = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();
const queue: string[] = [];
let active = 0;

export function mediaLogoUrl(item: StremioMetaPreview): string | undefined {
  return item.logo || imdbArtwork('logo', item.id);
}
export function logoImageStatus(url?: string): Status {
  return url ? images.get(url)?.status || 'idle' : 'idle';
}
export function markLogoImageFailed(url: string): void {
  const entry = images.get(url);
  if (entry) { entry.status = 'failed'; entry.image = undefined; notify(url); }
}
export function subscribeLogoImage(url: string | undefined, listener: () => void): () => void {
  if (!url) return () => {};
  const subscribers = listeners.get(url) || new Set();
  subscribers.add(listener); listeners.set(url, subscribers);
  return () => { subscribers.delete(listener); if (!subscribers.size) listeners.delete(url); };
}
function notify(url: string) { listeners.get(url)?.forEach((listener) => listener()); }
function drain() {
  while (active < 4 && queue.length) {
    const url = queue.shift()!;
    const entry = images.get(url)!;
    active++;
    const image = new Image();
    entry.image = image;
    image.referrerPolicy = 'no-referrer';
    image.decoding = 'async';
    let finished = false;
    const finish = (status: Status) => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      image.onload = image.onerror = null;
      entry.status = status;
      if (status === 'failed') entry.image = undefined;
      active--; notify(url);
      // Keep decoded neighboring logos ready, with a bounded memory cache.
      if (images.size > 64) {
        for (const [key, value] of images) {
          if (images.size <= 64) break;
          if (value.status !== 'loading' && !listeners.has(key)) images.delete(key);
        }
      }
      drain();
    };
    const timer = setTimeout(() => finish('failed'), 10_000);
    image.onerror = () => finish('failed');
    image.onload = () => {
      if (typeof image.decode === 'function') void image.decode().then(() => finish('ready'), () => finish('failed'));
      else finish('ready');
    };
    image.src = url;
  }
}
export function preloadLogoImage(url?: string, priority = false): void {
  if (!url || typeof Image === 'undefined') return;
  if (images.has(url)) {
    const index = queue.indexOf(url);
    if (priority && index > 0) { queue.splice(index, 1); queue.unshift(url); }
    return;
  }
  images.set(url, { status: 'loading' });
  if (priority) queue.unshift(url); else queue.push(url);
  notify(url); drain();
}
