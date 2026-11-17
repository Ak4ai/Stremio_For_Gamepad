export const GITHUB_REPO_URL = 'https://github.com/Ak4ai/Stremio_For_Gamepad';

export function getTauriInvoker(): ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null {
  const win = window as unknown as {
    __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
    __TAURI__?: { core?: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } };
  };

  if (win.__TAURI_INTERNALS__?.invoke) {
    return win.__TAURI_INTERNALS__.invoke;
  }
  if (win.__TAURI__?.core?.invoke) {
    return win.__TAURI__.core.invoke;
  }
  return null;
}

export async function minimizeApp(): Promise<void> {
  try {
    const invoke = getTauriInvoker();
    if (invoke) {
      await invoke('minimize_app');
      return;
    }
  } catch (err) {
    console.warn('Erro ao minimizar app via Tauri:', err);
  }
}

export async function closeApp(): Promise<void> {
  try {
    const invoke = getTauriInvoker();
    if (invoke) {
      await invoke('close_app');
      return;
    }
  } catch (err) {
    console.warn('Erro ao fechar app via Tauri:', err);
  }
  window.close();
}

export async function openUrl(url: string): Promise<void> {
  try {
    const invoke = getTauriInvoker();
    if (invoke) {
      await invoke('open_in_browser', { url });
      return;
    }
  } catch (err) {
    console.warn('Erro ao abrir URL via Tauri:', err);
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

let overlayRequest: Promise<boolean> | null = null;
let lastOverlayRequestTime = 0;
let lastOverlayResult = false;

export function activateSteamOverlay(toggle = false): Promise<boolean> {
  if (overlayRequest) return overlayRequest;
  const now = Date.now();
  if (now - lastOverlayRequestTime < 1500) {
    return Promise.resolve(lastOverlayResult);
  }
  lastOverlayRequestTime = now;
  overlayRequest = requestSteamOverlay(toggle).then((result) => { lastOverlayResult = result; return result; })
    .finally(() => { overlayRequest = null; });
  return overlayRequest;
}

async function requestSteamOverlay(toggle: boolean): Promise<boolean> {
  let activated = false;
  try {
    const invoke = getTauriInvoker();
    if (invoke) {
      activated = (await invoke('activate_steam_overlay', { toggle })) as boolean;
    }
  } catch (err) {
    console.warn('Erro ao acionar overlay da Steam via Tauri:', err);
  }
  if (!activated) window.dispatchEvent(new Event('steam-overlay-unavailable'));
  return activated;
}

export function installSteamOverlayShortcut(): () => void {
  if (!getTauriInvoker()) return () => {};
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Tab' || !event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) void activateSteamOverlay(true);
  };
  window.addEventListener('keydown', onKeyDown, true);
  return () => window.removeEventListener('keydown', onKeyDown, true);
}

export async function isSteamRunning(): Promise<boolean> {
  try {
    const invoke = getTauriInvoker();
    if (invoke) {
      return (await invoke('is_steam_running')) as boolean;
    }
  } catch (err) {
    console.warn('Erro ao checar status da Steam:', err);
  }
  return false;
}
