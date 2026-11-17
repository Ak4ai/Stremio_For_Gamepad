import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GamepadManager, type GamepadAction } from '../services/gamepad';
import { LocalAddonService, type LocalAddonInfo } from '../services/localAddons';
import { ControllerButtonBadge } from './ControllerButtonBadge';
import {
  AlertCircle,
  Boxes,
  CheckCircle2,
  FileArchive,
  FolderOpen,
  Link2,
  Loader2,
  Power,
  ScrollText,
  Trash2,
} from 'lucide-react';

interface Props {
  onClose: () => void;
  /** Called after an install, toggle or removal so the app can reload its catalogs. */
  onChanged: () => void;
}

type Message = { kind: 'ok' | 'error'; text: string };

// Fixed rows above the installed list: folder, zip, link
const ACTION_ROWS = 3;
const ROW_FOLDER = 0;
const ROW_ZIP = 1;
const ROW_LINK = 2;

const errorText = (err: unknown): string =>
  typeof err === 'string' ? err : err instanceof Error ? err.message : 'Erro inesperado.';

export const LocalAddonsModal: React.FC<Props> = ({ onClose, onChanged }) => {
  const [infos, setInfos] = useState<LocalAddonInfo[]>(LocalAddonService.getInfos());
  const [focus, setFocus] = useState(0);
  const [source, setSource] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [logFor, setLogFor] = useState<{ id: string; text: string } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const available = LocalAddonService.isAvailable();

  const reload = useCallback(async () => {
    setInfos(await LocalAddonService.list());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const install = useCallback(async (from: string) => {
    const value = from.trim();
    if (!value || busy) return;
    setMessage(null);
    setBusy('Instalando extensão…');
    try {
      const info = await LocalAddonService.install(value);
      setMessage({ kind: 'ok', text: `"${info.name}" instalada e ativada.` });
      setSource('');
      onChanged();
    } catch (err) {
      setMessage({ kind: 'error', text: errorText(err) });
    } finally {
      setBusy(null);
      await reload();
    }
  }, [busy, onChanged, reload]);

  const browse = useCallback(async (kind: 'folder' | 'zip') => {
    if (busy) return;
    try {
      const picked = await LocalAddonService.browse(kind);
      if (picked) await install(picked);
    } catch (err) {
      setMessage({ kind: 'error', text: errorText(err) });
    }
  }, [busy, install]);

  const toggle = useCallback(async (info: LocalAddonInfo) => {
    if (busy) return;
    setMessage(null);
    setBusy(info.enabled ? 'Desativando…' : 'Ativando…');
    try {
      await LocalAddonService.setEnabled(info.id, !info.enabled);
      onChanged();
    } catch (err) {
      setMessage({ kind: 'error', text: errorText(err) });
    } finally {
      setBusy(null);
      await reload();
    }
  }, [busy, onChanged, reload]);

  const remove = useCallback(async (info: LocalAddonInfo) => {
    if (busy) return;
    setBusy('Removendo…');
    try {
      await LocalAddonService.remove(info.id);
      setMessage({ kind: 'ok', text: `"${info.name}" removida.` });
      setFocus((prev) => Math.min(prev, ACTION_ROWS + Math.max(0, infos.length - 2)));
      onChanged();
    } catch (err) {
      setMessage({ kind: 'error', text: errorText(err) });
    } finally {
      setBusy(null);
      setConfirmRemove(null);
      await reload();
    }
  }, [busy, infos.length, onChanged, reload]);

  const showLog = useCallback(async (info: LocalAddonInfo) => {
    if (logFor?.id === info.id) {
      setLogFor(null);
      return;
    }
    const text = await LocalAddonService.getLog(info.id).catch(() => '');
    setLogFor({ id: info.id, text: text || '(o log está vazio)' });
  }, [logFor]);

  const stateRef = useRef({ focus, infos, editing, busy, source, confirmRemove });
  stateRef.current = { focus, infos, editing, busy, source, confirmRemove };

  useEffect(() => {
    const handle = (action: GamepadAction) => {
      const { focus: cur, infos: list, editing: typing, source: text, confirmRemove: pending } = stateRef.current;
      const last = ACTION_ROWS + list.length - 1;
      const addon = cur >= ACTION_ROWS ? list[cur - ACTION_ROWS] : undefined;

      if (action === 'ACTION_B') {
        if (typing) inputRef.current?.blur();
        else onClose();
        return;
      }
      if (typing) return;

      if (action !== 'ACTION_X') setConfirmRemove(null);

      switch (action) {
        case 'NAV_UP':
          setFocus(Math.max(0, cur - 1));
          break;
        case 'NAV_DOWN':
          setFocus(Math.min(last, cur + 1));
          break;
        case 'ACTION_A':
          if (cur === ROW_FOLDER) void browse('folder');
          else if (cur === ROW_ZIP) void browse('zip');
          else if (cur === ROW_LINK) {
            if (text.trim()) void install(text);
            else inputRef.current?.focus();
          } else if (addon) void toggle(addon);
          break;
        case 'ACTION_Y':
          if (cur === ROW_LINK) inputRef.current?.focus();
          else if (addon) void showLog(addon);
          break;
        case 'ACTION_X':
          if (!addon) break;
          if (pending === addon.id) void remove(addon);
          else setConfirmRemove(addon.id);
          break;
      }
    };
    return GamepadManager.subscribe(handle);
  }, [browse, install, onClose, remove, showLog, toggle]);

  const rowClass = (index: number) =>
    `flex items-center gap-3 p-4 rounded-2xl border transition-all app-card-item ${
      focus === index ? 'is-focused border-2 border-white scale-[1.01]' : 'border-white/15'
    }`;
  const rowStyle = (index: number): React.CSSProperties | undefined =>
    focus === index ? { boxShadow: '0 0 0 3px #ffffff, 0 0 22px var(--app-accent-glow)' } : undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-2xl p-6 select-none animate-fade-in">
      <div className="w-full max-w-2xl max-h-full overflow-y-auto no-scrollbar app-card-panel rounded-3xl p-8 shadow-2xl relative">
        <div className="flex items-center justify-between border-b border-white/20 pb-4 mb-5">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-2xl flex items-center justify-center text-white shadow-lg"
              style={{ backgroundColor: 'var(--app-accent)', boxShadow: '0 4px 18px var(--app-accent-glow)' }}
            >
              <Boxes className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-white uppercase tracking-wide">Extensões Locais</h2>
              <span className="text-[11px] text-zinc-400">Addons que rodam neste computador, sem servidor</span>
            </div>
          </div>
          <div className="cursor-pointer" onClick={onClose}>
            <ControllerButtonBadge button="B" label="Fechar" />
          </div>
        </div>

        {!available && (
          <div className="flex items-center gap-2.5 p-3 mb-4 rounded-xl bg-amber-950/60 border border-amber-800 text-amber-300 text-xs font-medium">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>Disponível apenas no aplicativo desktop.</span>
          </div>
        )}

        {message && (
          <div
            className={`flex items-start gap-2.5 p-3 mb-4 rounded-xl border text-xs font-medium ${
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
            <span className="whitespace-pre-wrap break-words min-w-0">{message.text}</span>
          </div>
        )}

        {busy && (
          <div className="flex items-center gap-2.5 p-3 mb-4 rounded-xl bg-white/5 border border-white/10 text-zinc-200 text-xs font-medium">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>{busy}</span>
          </div>
        )}

        <h3 className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-2">Instalar</h3>
        <div className="space-y-2.5 mb-6">
          <div className={`${rowClass(ROW_FOLDER)} cursor-pointer`} style={rowStyle(ROW_FOLDER)}
            onClick={() => { setFocus(ROW_FOLDER); void browse('folder'); }}>
            <FolderOpen className="w-5 h-5 text-zinc-300" />
            <div className="flex-1">
              <div className="text-sm font-bold text-white">De uma pasta</div>
              <div className="text-[11px] text-zinc-400">A pasta com o package.json e o arquivo principal da extensão</div>
            </div>
            <ControllerButtonBadge button="A" size="sm" />
          </div>

          <div className={`${rowClass(ROW_ZIP)} cursor-pointer`} style={rowStyle(ROW_ZIP)}
            onClick={() => { setFocus(ROW_ZIP); void browse('zip'); }}>
            <FileArchive className="w-5 h-5 text-zinc-300" />
            <div className="flex-1">
              <div className="text-sm font-bold text-white">De um arquivo .zip</div>
              <div className="text-[11px] text-zinc-400">Um pacote baixado ou exportado de uma extensão</div>
            </div>
            <ControllerButtonBadge button="A" size="sm" />
          </div>

          <div className={rowClass(ROW_LINK)} style={rowStyle(ROW_LINK)} onClick={() => setFocus(ROW_LINK)}>
            <Link2 className="w-5 h-5 text-zinc-300 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-white mb-1.5">De um link</div>
              <input
                ref={inputRef}
                type="text"
                value={source}
                disabled={!!busy}
                onChange={(e) => setSource(e.target.value)}
                onFocus={() => { setEditing(true); setFocus(ROW_LINK); }}
                onBlur={() => setEditing(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    inputRef.current?.blur();
                    void install(source);
                  }
                }}
                placeholder="https://github.com/usuario/repositorio  ou  link .zip"
                spellCheck={false}
                className="w-full app-input-box rounded-xl px-3 py-2 text-xs text-white placeholder:text-zinc-500 focus:outline-none"
              />
              <div className="text-[11px] text-zinc-400 mt-1.5">
                Repositório do GitHub (usa a última release, ou o código do repositório), link .zip ou caminho no disco
              </div>
            </div>
            <ControllerButtonBadge button="A" label={source.trim() ? 'Instalar' : 'Digitar'} size="sm" />
          </div>
        </div>

        <h3 className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-2">
          Instaladas ({infos.length})
        </h3>
        {infos.length === 0 ? (
          <div className="bg-black/30 border border-white/10 rounded-2xl p-5 text-center text-xs text-zinc-400">
            Nenhuma extensão instalada ainda.
          </div>
        ) : (
          <div className="space-y-2.5">
            {infos.map((info, idx) => {
              const index = ACTION_ROWS + idx;
              const status = !info.enabled ? 'Desativada' : info.running ? 'Em execução' : 'Parada';
              const statusColor = !info.enabled ? 'bg-zinc-500' : info.running ? 'bg-emerald-500' : 'bg-rose-500';
              return (
                <div key={info.id}>
                  <div className={`${rowClass(index)} cursor-pointer`} style={rowStyle(index)}
                    onClick={() => { setFocus(index); void toggle(info); }}>
                    <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusColor}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-white truncate">
                        {info.name} <span className="text-[11px] font-mono text-zinc-400">v{info.version}</span>
                      </div>
                      <div className="text-[11px] text-zinc-400 truncate">{status} · {info.source}</div>
                    </div>
                    {confirmRemove === info.id ? (
                      <span className="text-[11px] font-bold text-rose-300">Pressione X de novo para remover</span>
                    ) : (
                      focus === index && (
                        <div className="flex items-center gap-2 text-[11px] text-zinc-300">
                          <Power className="w-3.5 h-3.5" />
                          <ControllerButtonBadge button="A" size="sm" />
                          <ScrollText className="w-3.5 h-3.5" />
                          <ControllerButtonBadge button="Y" size="sm" />
                          <Trash2 className="w-3.5 h-3.5" />
                          <ControllerButtonBadge button="X" size="sm" />
                        </div>
                      )
                    )}
                  </div>
                  {info.enabled && !info.running && info.lastError && (
                    <pre className="mt-1.5 p-3 rounded-xl bg-rose-950/40 border border-rose-900 text-[10px] leading-relaxed text-rose-200 whitespace-pre-wrap break-words">
                      {info.lastError}
                    </pre>
                  )}
                  {logFor?.id === info.id && (
                    <pre className="mt-1.5 p-3 rounded-xl bg-black/50 border border-white/10 text-[10px] leading-relaxed text-zinc-300 whitespace-pre-wrap break-words max-h-48 overflow-y-auto no-scrollbar">
                      {logFor.text}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 mt-6 pt-4 border-t border-white/10 text-[11px] text-zinc-400">
          <span>Extensões são código que roda no seu computador: instale só as que você confia.</span>
        </div>
      </div>
    </div>
  );
};
