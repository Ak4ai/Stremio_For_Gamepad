import type { StremioAddon } from '../types/account';
import { getTauriInvoker } from './system';

/** Local extension managed by the desktop app (an addon process on 127.0.0.1). */
export interface LocalAddonInfo {
  id: string;
  name: string;
  version: string;
  source: string;
  enabled: boolean;
  running: boolean;
  url: string | null;
  lastError: string | null;
}

const MANIFEST_TTL_MS = 60_000;
/** After a manifest could not be read, don't make every request wait for it again. */
const FAILURE_BACKOFF_MS = 30_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const invoke = getTauriInvoker();
  if (!invoke) throw new Error('Extensões locais só funcionam no aplicativo desktop.');
  return (await invoke(cmd, args)) as T;
}

export class LocalAddonService {
  private static infos: LocalAddonInfo[] = [];
  private static loaded: StremioAddon[] = [];
  private static manifests = new Map<string, { addon: StremioAddon; time: number }>();
  private static failedUntil = new Map<string, number>();
  private static inflight: Promise<StremioAddon[]> | null = null;

  public static isAvailable(): boolean {
    return getTauriInvoker() !== null;
  }

  /** Extensions installed on this machine (last known state). */
  public static getInfos(): LocalAddonInfo[] {
    return this.infos;
  }

  /** Running extensions whose manifest was read, shaped like account addons. */
  public static getAddons(): StremioAddon[] {
    return this.loaded;
  }

  public static async list(): Promise<LocalAddonInfo[]> {
    if (!this.isAvailable()) return [];
    try {
      this.infos = await call<LocalAddonInfo[]>('local_addons_list');
    } catch (err) {
      console.warn('[local-addons] list failed', err);
    }
    return this.infos;
  }

  private static async readManifest(url: string, deadline: number): Promise<StremioAddon | null> {
    const cached = this.manifests.get(url);
    if (cached && Date.now() - cached.time < MANIFEST_TTL_MS) return cached.addon;
    if ((this.failedUntil.get(url) ?? 0) > Date.now()) return null;

    // The extension may still be booting (some call their API before listening): retry until the deadline.
    do {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
        clearTimeout(timer);
        if (res.ok) {
          const manifest = await res.json();
          if (manifest && manifest.id) {
            const addon: StremioAddon = { transportUrl: url, manifest, local: true };
            this.manifests.set(url, { addon, time: Date.now() });
            this.failedUntil.delete(url);
            return addon;
          }
        }
      } catch {
        // not listening yet
      }
      if (Date.now() < deadline) await sleep(500);
    } while (Date.now() < deadline);
    this.failedUntil.set(url, Date.now() + FAILURE_BACKOFF_MS);
    return null;
  }

  /**
   * Re-reads the running extensions and their manifests. Concurrent calls share one run;
   * `maxWaitMs` bounds how long an extension that is still starting is waited for.
   */
  public static refresh(maxWaitMs = 8000): Promise<StremioAddon[]> {
    if (!this.isAvailable()) return Promise.resolve([]);
    if (this.inflight) return this.inflight;

    this.inflight = (async () => {
      const infos = await this.list();
      const deadline = Date.now() + maxWaitMs;
      const targets = infos.filter((info) => info.enabled && info.running && info.url);
      const addons = await Promise.all(targets.map((info) => this.readManifest(info.url as string, deadline)));
      this.loaded = addons.filter((addon): addon is StremioAddon => addon !== null);
      return this.loaded;
    })().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /** `source`: folder path, `.zip` path, GitHub repository link or `.zip` link. */
  public static async install(source: string): Promise<LocalAddonInfo> {
    const info = await call<LocalAddonInfo>('local_addons_install', { source });
    this.manifests.clear();
    await this.refresh();
    return info;
  }

  public static async setEnabled(id: string, enabled: boolean): Promise<void> {
    this.infos = await call<LocalAddonInfo[]>('local_addons_set_enabled', { id, enabled });
    this.manifests.clear();
    await this.refresh();
  }

  public static async remove(id: string): Promise<void> {
    this.infos = await call<LocalAddonInfo[]>('local_addons_remove', { id });
    this.manifests.clear();
    await this.refresh(0);
  }

  public static async browse(kind: 'folder' | 'zip'): Promise<string | null> {
    return (await call<string | null>('local_addons_browse', { kind })) ?? null;
  }

  public static async getLog(id: string): Promise<string> {
    return call<string>('local_addons_log', { id });
  }
}
