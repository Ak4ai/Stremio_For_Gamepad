import type { StremioAddon } from '../types/account';
import type { StremioMetaDetail } from '../types/stremio';

export function imdbArtwork(kind: 'poster' | 'background' | 'logo', id: string): string | undefined {
  return /^tt\d+$/.test(id) ? `https://images.metahub.space/${kind}/medium/${id}/img` : undefined;
}

export function supportsMeta(addon: StremioAddon, type: string, id: string): boolean {
  const manifest = addon.manifest;
  return (manifest.resources || []).some((resource: any) => {
    const name = typeof resource === 'string' ? resource : resource?.name;
    if (name !== 'meta') return false;
    const types = typeof resource === 'object' ? resource.types ?? manifest.types : manifest.types;
    const prefixes = typeof resource === 'object' ? resource.idPrefixes ?? manifest.idPrefixes : manifest.idPrefixes;
    return Array.isArray(types) && types.includes(type)
      && (!Array.isArray(prefixes) || prefixes.some((prefix: string) => id.startsWith(prefix)));
  });
}

export class MetadataService {
  private static cache = new Map<string, { meta: StremioMetaDetail | null; expires: number }>();
  private static pending = new Map<string, Promise<StremioMetaDetail | null>>();

  static getMeta(type: string, id: string, addons: StremioAddon[]): Promise<StremioMetaDetail | null> {
    const providers = addons.filter((addon) => addon.transportUrl && supportsMeta(addon, type, id))
      .map((addon) => addon.transportUrl.replace(/\/manifest\.json(?:\?.*)?$/, '').replace(/\/$/, ''));
    if (/^tt\d+$/.test(id)) providers.unshift('https://v3-cinemeta.strem.io');
    // Public compatibility fallback for saved Kitsu entries whose addon is
    // missing from a stale collection. No account, API key or ID conversion.
    if (/^kitsu:\d+$/.test(id)) providers.push('https://anime-kitsu.strem.fun');
    const urls = [...new Set(providers)].map((base) => `${base}/meta/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`);
    const key = JSON.stringify([type, id, urls]);
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return Promise.resolve(cached.meta);
    const pending = this.pending.get(key);
    if (pending) return pending;
    const task = (async () => {
      let meta: StremioMetaDetail | null = null;
      let artworkFallback = false;
      for (const url of urls) {
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(4500) });
          if (!response.ok) continue;
          const data = await response.json();
          if (data.meta?.id === id && typeof data.meta.name === 'string') { meta = data.meta; break; }
        } catch { /* Try the next compatible provider. */ }
      }
      if (!meta && /^kitsu:\d+$/.test(id)) {
        try {
          const response = await fetch(`https://kitsu.app/api/edge/anime/${id.slice(6)}`, {
            signal: AbortSignal.timeout(4500), headers: { Accept: 'application/vnd.api+json' },
          });
          if (response.ok) {
            const data = await response.json();
            const attributes = data.data?.attributes;
            if (String(data.data?.id) === id.slice(6) && attributes?.canonicalTitle) {
              meta = { id, type: type as StremioMetaDetail['type'], name: attributes.canonicalTitle,
                poster: attributes.posterImage?.large || attributes.posterImage?.original || attributes.posterImage?.medium,
                background: attributes.coverImage?.original || attributes.coverImage?.large || attributes.coverImage?.medium,
                description: attributes.synopsis || attributes.description,
                year: attributes.startDate?.slice(0, 4) };
              artworkFallback = true;
            }
          }
        } catch { /* Keep the saved card when both providers are offline. */ }
      }
      // The artwork API does not supply the addon's playable episode IDs.
      // Retry the addon soon so a transient outage cannot cache an incomplete
      // series detail response for the whole session.
      this.cache.set(key, { meta, expires: Date.now() + (meta && !artworkFallback ? 30 * 60_000 : 30_000) });
      return meta;
    })().finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }
}
