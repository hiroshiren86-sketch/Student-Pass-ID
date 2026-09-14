import { useState } from 'react';
import { KeyRound, ShieldAlert, X } from 'lucide-react';

/**
 * R66 (fix del bug "la clave queda pegada") — modal de SINCRONIZACIÓN DE CUENTA.
 *
 * Contexto del bug (reproducido en E2E contra producción, 14/09/2026): cuando
 * Rectoría cambia el PIN/clave temporal de un usuario CON cuenta de acceso,
 * el provisioner (patrón de instancia secundaria) necesita firmar con la clave
 * ANTERIOR de la cuenta para aplicar la nueva. Esa clave anterior solo la
 * conoce el terminal que la asignó por última vez (la clave en claro JAMÁS
 * viaja en el snapshot — viaja su verifier HMAC). Un terminal nuevo, o uno
 * cuya clave local quedó desfasada, no puede sincronizar → la FICHA publicaba
 * el PIN nuevo (verifier) mientras la CUENTA Firebase conservaba la vieja →
 * el estudiante/docente no podía entrar con la clave nueva desde un
 * dispositivo limpio, y el portal no podía realinear (trampa completa).
 *
 * Este modal hace el flujo HONESTO y REPARABLE (Regla 6: cero éxitos falsos):
 *   · La ficha ya quedó con el PIN nuevo (se informa).
 *   · Se pide la CLAVE ACTUAL de la cuenta (la que Rectoría comunicó al
 *     usuario — p. ej. la clave institucional vigente) y se reintenta la
 *     sincronización con ella, sin cerrar la sesión de Rectoría.
 *   · "Dejar pendiente" es una decisión explícita e informada: la cuenta
 *     seguirá con la clave anterior hasta que se realinee.
 */
interface AccountSyncModalProps {
  open: boolean;
  /** Nombre completo del usuario (para el mensaje). */
  who: string;
  /** Identificador técnico que se muestra (código o correo). */
  ident: string;
  kind: 'estudiante' | 'docente';
  /** Motivo de la falla original (para el texto). */
  reason: 'unknown_old' | 'mismatch' | 'error';
  detail?: string;
  busy: boolean;
  /** Reintenta la sincronización con la clave actual que Rectoría escriba. */
  onSubmit: (currentPassword: string) => void;
  /** Cierra el modal dejando la cuenta pendiente de realinear. */
  onSkip: () => void;
  /** Error del último reintento (se muestra dentro del modal). */
  error?: string | null;
}

export default function AccountSyncModal({
  open, who, ident, kind, reason, detail, busy, onSubmit, onSkip, error
}: AccountSyncModalProps) {
  const [current, setCurrent] = useState('');
  if (!open) return null;

  const reasonText = reason === 'unknown_old'
    ? 'este terminal no conoce la clave anterior de esa cuenta (cada terminal solo recuerda la última clave que él mismo asignó; las claves nunca viajan a la nube en claro, solo su verificador criptográfico)'
    : reason === 'mismatch'
      ? 'la clave anterior registrada en esta ficha no coincide con la que la cuenta tiene vigente (divergencia histórica)'
      : 'un error de red o de Firebase interrumpió la sincronización';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
      <div className="p-6 rounded-3xl bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800/50 shadow-2xl max-w-lg w-full space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-zinc-800/50 pb-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-500" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Cuenta pendiente de sincronizar
            </h3>
          </div>
          <button
            onClick={onSkip}
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:text-white dark:hover:bg-slate-800"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-2.5 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
          <p>
            La ficha de <span className="font-bold text-slate-800 dark:text-slate-200">{who}</span> ({ident}) quedó
            guardada con la nueva clave, pero la <span className="font-bold">cuenta de acceso</span> de ese
            {' '}{kind} no se pudo sincronizar automáticamente: {reasonText}.
          </p>
          <p>
            Mientras no se sincronice, el {kind} seguirá entrando con la <span className="font-bold">clave anterior</span> de
            su cuenta desde un dispositivo nuevo, aunque la ficha muestre la nueva.
          </p>
          <p className="text-slate-500 dark:text-slate-500">
            Para completar el cambio ahora, escriba la <span className="font-bold">clave ACTUAL de la cuenta</span> (la que
            el {kind} usa hoy para entrar — la que Rectoría le entregó):
          </p>
        </div>

        <form
          className="space-y-3"
          onSubmit={(e) => { e.preventDefault(); if (current.trim()) onSubmit(current.trim()); }}
        >
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Clave actual de la cuenta de {who.split(' ')[0]}
            </label>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                autoFocus
                autoComplete="off"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                placeholder="La clave con la que entra hoy…"
                className="w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-black border border-slate-200 dark:border-zinc-800/50 rounded-2xl text-xs font-mono text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>
          </div>

          {error && (
            <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-[11px] font-bold text-rose-700 dark:text-rose-300 leading-relaxed">
              {error}
            </div>
          )}
          {detail && !error && (
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-zinc-800 text-[10px] text-slate-500 dark:text-slate-500 leading-relaxed">
              Detalle del intento automático: {detail}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={onSkip}
              className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50"
            >
              Dejar pendiente
            </button>
            <button
              type="submit"
              disabled={busy || !current.trim()}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/25 flex items-center gap-1.5"
            >
              <KeyRound className="w-3.5 h-3.5" />
              {busy ? 'Sincronizando…' : 'Sincronizar cuenta'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
