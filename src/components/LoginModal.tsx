import React, { useState, useEffect } from 'react';
import { AccountService } from '../services/account';
import { ControllerButtonBadge } from './ControllerButtonBadge';
import { GamepadManager, type GamepadAction } from '../services/gamepad';
import { KeyRound, Mail, Lock, Sparkles, CheckCircle2, AlertCircle, ShieldCheck } from 'lucide-react';

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

export const LoginModal: React.FC<Props> = ({ onClose, onSuccess }) => {
  const [mode, setMode] = useState<'credentials' | 'authKey'>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authKey, setAuthKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Gamepad listener for modal
  useEffect(() => {
    const handleGamepadAction = (action: GamepadAction) => {
      if (action === 'TRIGGER_LB' || action === 'TRIGGER_RB') {
        setMode((prev) => (prev === 'credentials' ? 'authKey' : 'credentials'));
        setError(null);
      }
      if (action === 'ACTION_B') {
        onClose();
      }
    };

    const unsubscribe = GamepadManager.subscribe(handleGamepadAction);
    return () => unsubscribe();
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === 'credentials') {
        if (!email.trim() || !password.trim()) {
          setError('Preencha seu email e senha da conta Stremio');
          setLoading(false);
          return;
        }
        const res = await AccountService.login(email.trim(), password);
        if (res.success) {
          onSuccess();
        } else {
          setError(res.error || 'Credenciais inválidas no servidor Stremio');
        }
      } else {
        if (!authKey.trim()) {
          setError('Insira uma chave AuthKey válida');
          setLoading(false);
          return;
        }
        const res = await AccountService.loginWithAuthKey(authKey.trim());
        if (res.success) {
          onSuccess();
        } else {
          setError(res.error || 'Chave AuthKey inválida ou expirada');
        }
      }
    } catch (err: any) {
      setError(err.message || 'Erro inesperado na conexão');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-2xl p-6 select-none animate-fade-in">
      <div className="w-full max-w-lg app-card-panel rounded-3xl p-8 shadow-2xl relative overflow-hidden">
        {/* Glow ambient background */}
        <div
          className="absolute -top-24 -right-24 w-64 h-64 rounded-full blur-3xl opacity-20 pointer-events-none"
          style={{ backgroundColor: 'var(--app-accent)' }}
        />

        {/* Top Header */}
        <div className="flex items-center justify-between border-b border-white/20 pb-4 mb-6">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-2xl flex items-center justify-center text-white shadow-lg"
              style={{
                backgroundColor: 'var(--app-accent)',
                boxShadow: '0 4px 18px var(--app-accent-glow)',
              }}
            >
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-white uppercase tracking-wide">
                Conectar Conta Stremio
              </h2>
              <span className="text-[11px] text-zinc-400">
                Sincronize sua biblioteca, histórico e addons
              </span>
            </div>
          </div>

          <div className="cursor-pointer" onClick={onClose}>
            <ControllerButtonBadge button="B" label="Fechar" />
          </div>
        </div>

        {/* Mode Selector Tabs with LB/RB hints */}
        <div className="flex items-center gap-2 mb-6 app-card-panel p-1 rounded-2xl">
          <button
            type="button"
            onClick={() => {
              setMode('credentials');
              setError(null);
            }}
            style={
              mode === 'credentials'
                ? {
                    backgroundColor: 'var(--app-accent)',
                    boxShadow: '0 2px 10px var(--app-accent-glow)',
                  }
                : undefined
            }
            className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2 ${
              mode === 'credentials' ? 'text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <ControllerButtonBadge button="LB" />
            <span>Email e Senha</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('authKey');
              setError(null);
            }}
            style={
              mode === 'authKey'
                ? {
                    backgroundColor: 'var(--app-accent)',
                    boxShadow: '0 2px 10px var(--app-accent-glow)',
                  }
                : undefined
            }
            className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2 ${
              mode === 'authKey' ? 'text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <span>Chave AuthKey</span>
            <ControllerButtonBadge button="RB" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="flex items-center gap-2.5 p-3 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-300 text-xs font-medium">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {mode === 'credentials' ? (
            <>
              <div>
                <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1.5">
                  Email Stremio
                </label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                  <input
                    type="email"
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="seuemail@exemplo.com"
                    className="w-full app-input-box rounded-xl pl-10 pr-4 py-3 text-xs text-white placeholder:text-zinc-400 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1.5">
                  Senha
                </label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full app-input-box rounded-xl pl-10 pr-4 py-3 text-xs text-white placeholder:text-zinc-400 focus:outline-none"
                  />
                </div>
              </div>
            </>
          ) : (
            <div>
              <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1.5">
                Chave AuthKey do Stremio
              </label>
              <textarea
                rows={3}
                autoFocus
                value={authKey}
                onChange={(e) => setAuthKey(e.target.value)}
                placeholder="Cole sua chave de autenticação do Stremio..."
                className="w-full app-input-box rounded-xl p-3 text-xs font-mono text-white placeholder:text-zinc-400 focus:outline-none"
              />
              <span className="block text-[11px] text-zinc-500 mt-1">
                A AuthKey é encontrada nas configurações ou cookies de login do Stremio Web.
              </span>
            </div>
          )}

          {/* Secure official API badge */}
          <div className="flex items-center gap-2 text-[11px] text-zinc-400 bg-white/5 border border-white/5 p-2.5 rounded-xl">
            <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span>Autenticação direta e segura com os servidores oficiais `api.strem.io`</span>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={loading}
              style={{
                backgroundColor: 'var(--app-accent)',
                boxShadow: '0 4px 18px var(--app-accent-glow)',
              }}
              className="w-full py-3.5 rounded-xl font-bold text-white text-xs uppercase tracking-wider transition-all hover:scale-[1.01] cursor-pointer flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Sparkles className="w-4 h-4 animate-spin" />
                  <span>Autenticando & Sincronizando...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Conectar e Sincronizar</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
