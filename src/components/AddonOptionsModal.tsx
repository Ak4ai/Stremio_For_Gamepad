import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { StremioAddon } from '../types/account';
import { AccountService } from '../services/account';
import { LocalAddonService } from '../services/localAddons';
import { GamepadManager, type GamepadAction } from '../services/gamepad';
import { openUrl } from '../services/system';
import { ControllerButtonBadge } from './ControllerButtonBadge';
import { AlertCircle, CheckCircle2, Layers, Loader2, Settings2, Trash2, X } from 'lucide-react';

interface Props {
  addon: StremioAddon;
  onClose: () => void;
  /** Called after the addon was removed so the app can reload its catalogs. */
  onChanged: () => void;
}

type OptionId = 'configure' | 'uninstall' | 'close';
type Message = { kind: 'ok' | 'error'; text: string };

/** Same convention as the official app: `<transport>/manifest.json` -> `<transport>/configure`. */
const configureUrl =(addon: StremioAddon): string =>
  addon.transportUrl.replace(/manifest\.json(?=$|\?)/, 'configure');

const errorText = (err: unknown): string =>
  typeof err === 'string' ? err : err instanceof Error ? err.message : 'Erro inesperado.';

export const AddonOptionsModal: React.FC<Props> = ({ addon, onClose, onChanged }) => {
  const [focus, setFocus] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  const isLocal = !!addon.local;
  const canConfigure = !!addon.manifest?.behaviorHints?.configurable;
  const canUninstall = isLocal || !addon.flags?.protected;

  const options: { id: OptionId; label: string; hint?: string }[] = [];
  if (canConfigure) {
    options.push({ id: 'configure', label: 'Configurar', hint: 'Abre a página de configuração do addon no navegador' });
  }
  if (canUninstall) {
    options.push({
      id: 'uninstall',
      label: confirming ? 'Confirmar: desinstalar' : 'Desinstalar',
      hint: isLocal
        ? 'Remove a extensão deste computador'
        : confirming
          ? 'Remove o addon da sua conta Stremio em todos os dispositivos'
          : 'Remove o addon da sua conta Stremio',
    });
  }
  options.push({ id: 'close', label: 'Fechar' });

  const uninstall = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      if (isLocal) {
        const info = LocalAddonService.getInfos().find((i) => i.url === addon.transportUrl);
        if (!info) throw new Error('Não encontrei essa extensão instalada.');
        await LocalAddonService.remove(info.id);
      } else {
        const res = await AccountService.uninstallAddon(addon.transportUrl);
        if (!res.success) throw new Error(res.error || 'Não foi possível desinstalar.');
      }
      onChanged();
      onClose();
    } catch (err) {
      setMessage({ kind: 'error', text: errorText(err) });
      setConfirming(false);
      setBusy(false);
    }
  }, [addon.transportUrl, isLocal, onChanged, onClose]);

  const choose = useCallback((id: OptionId) => {
    if (busy) return;
    if (id === 'close') {
      onClose();
    } else if (id === 'configure') {
      void openUrl(configureUrl(addon));
      setMessage({ kind: 'ok', text: 'Página de configuração aberta no navegador.' });
    } else if (confirming) {
      void uninstall();
    } else {
      setConfirming(true);
    }
  }, [addon, busy, confirming, onClose, uninstall]);

  const stateRef = useRef({ focus, options, choose, confirming });
  stateRef.current = { focus, options, choose, confirming };

  useEffect(() => {
    const handle = (action: GamepadAction) => {
      const { focus: cur, options: list, choose: pick, confirming: asking } = stateRef.current;
      switch (action) {
        case 'NAV_UP':
          setFocus(Math.max(0, cur - 1));
          setConfirming(false);
          break;
        case 'NAV_DOWN':
          setFocus(Math.min(list.length - 1, cur + 1));
          setConfirming(false);
          break;
        case 'ACTION_A':
          if (list[cur]) pick(list[cur].id);
          break;
        case 'ACTION_B':
          if (asking) setConfirming(false);
          else onClose();
          break;
      }
    };
    return GamepadManager.subscribe(handle);
  }, [onClose]);

  const manifest = addon.manifest;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-2xl p-6 select-none animate-fade-in">
      <div className="w-full max-w-md app-card-panel rounded-3xl p-7 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          {manifest?.logo ? (
            <img
              src={manifest.logo}
              alt={manifest.name}
              referrerPolicy="no-referrer"
              onError={(e) => ((e.target as HTMLElement).style.display = 'none')}
              className="w-12 h-12 rounded-xl object-contain bg-black/40 p-1 border border-white/10"
            />
          ) : (
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center text-white"
              style={{ backgroundColor: 'var(--app-accent)' }}
            >
              <Layers className="w-6 h-6" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-base font-black text-white truncate">{manifest?.name || 'Addon Stremio'}</div>
            <div className="flex items-center gap-2 text-[11px] text-zinc-400">
              <span className="font-mono">v{manifest?.version || '1.0.0'}</span>
              <span className="px-1.5 py-0.5 rounded bg-white/10 font-bold uppercase tracking-wider text-[9px] text-zinc-300">
                {isLocal ? 'Local' : 'Conta'}
              </span>
            </div>
          </div>
        </div>

        {manifest?.description && (
          <p className="text-[11px] text-zinc-400 leading-relaxed line-clamp-3 mb-4">{manifest.description}</p>
        )}

        {message && (
          <div
            className={`flex items-start gap-2.5 p-3 mb-3 rounded-xl border text-xs font-medium ${
              message.kind === 'ok'
                ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
                : 'bg-rose-950/60 border-rose-800 text-rose-300'
            }`}
          >
            {message.kind === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
            )}
            <span className="min-w-0 break-words">{message.text}</span>
          </div>
        )}

        <div className="space-y-2">
          {options.map((option, idx) => {
            const isFocused = focus === idx;
            const danger = option.id === 'uninstall';
            const Icon = option.id === 'configure' ? Settings2 : danger ? Trash2 : X;
            return (
              <button
                key={option.id}
                type="button"
                disabled={busy}
                onClick={() => {
                  setFocus(idx);
                  choose(option.id);
                }}
                className={`w-full flex items-center gap-3 p-3.5 rounded-2xl border text-left transition-all cursor-pointer app-card-item ${
                  isFocused ? 'is-focused border-2 border-white scale-[1.02]' : 'border-white/15'
                }`}
                style={
                  isFocused
                    ? { boxShadow: '0 0 0 3px #ffffff, 0 0 22px var(--app-accent-glow)' }
                    : undefined
                }
              >
                {busy && danger ? (
                  <Loader2 className="w-4 h-4 animate-spin text-zinc-300" />
                ) : (
                  <Icon className={`w-4 h-4 ${danger ? 'text-rose-400' : 'text-zinc-300'}`} />
                )}
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-bold ${danger ? 'text-rose-300' : 'text-white'}`}>{option.label}</div>
                  {option.hint && isFocused && <div className="text-[11px] text-zinc-400">{option.hint}</div>}
                </div>
                {isFocused && <ControllerButtonBadge button="A" size="sm" />}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-end mt-5 pt-4 border-t border-white/10">
          <div className="cursor-pointer" onClick={onClose}>
            <ControllerButtonBadge button="B" label={confirming ? 'Cancelar' : 'Fechar'} />
          </div>
        </div>
      </div>
    </div>
  );
};
