export const GITHUB_REPO_URL = 'https://github.com/Ak4ai/Stremio_For_Gamepad';

function getTauriInvoker(): ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null {
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
