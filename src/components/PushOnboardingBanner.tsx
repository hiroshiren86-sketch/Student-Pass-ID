/**
 * ==============================================================================
 * BANNER DE ACTIVACIÓN DE NOTIFICACIONES — Ronda 24 (petición propietario)
 * "las notificaciones push no están habilitadas, a mí no me pide permiso".
 *
 * Causa: la activación vivía enterrada en Ajustes y los navegadores solo pueden
 * pedir permiso con un gesto del usuario (clic). Este banner lo hace visible en
 * la primera línea del panel, con un clic → Notification.requestPermission().
 *
 * Estados (veracidad WCAG):
 *  - soportado + permiso 'default' + sin suscripción → banner con botón Activar.
 *  - permiso 'denied' → NO se molesta con el banner (Ajustes explica cómo revertir).
 *  - no soportado (iOS Safari sin instalar a inicio) → NO banner; Ajustes explica.
 *  - suscrito → nada.
 *  - descartado por el usuario → bandera por dispositivo (localStorage), y el
 *    banner no vuelve a molestar (sigue disponible en Ajustes).
 * ==============================================================================
 */
import { useEffect, useState } from 'react';
import { Bell, BellRing, X } from 'lucide-react';
import { enablePush, getPushStatus } from '../services/pushService';

const DISMISS_KEY = 'inas_push_banner_dismissed_v1';

export function PushOnboardingBanner({ variant = 'rectoria' }: { variant?: 'rectoria' | 'portal' }) {
  const [status, setStatus] = useState<{ supported: boolean; permission: NotificationPermission | 'unsupported'; subscribed: boolean } | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    let alive = true;
    getPushStatus().then(s => { if (alive) setStatus(s); });
    return () => { alive = false; };
  }, []);

  const visible = status !== null && status.supported && status.permission === 'default' && !status.subscribed && !dismissed && !feedback?.ok;
  if (!visible) return null;

  const handleEnable = async () => {
    setBusy(true);
    const res = await enablePush();
    setFeedback({ ok: res.ok, message: res.message });
    setBusy(false);
    setStatus(await getPushStatus());
  };

  const handleDismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* prescindible */ }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-4 p-3.5 rounded-2xl border border-indigo-200 dark:border-indigo-800/60 bg-gradient-to-r from-indigo-50 via-white to-indigo-50/60 dark:from-indigo-950/40 dark:via-zinc-950 dark:to-indigo-950/20 flex flex-col sm:flex-row sm:items-center gap-3 shadow-sm"
    >
      <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-sm">
        <BellRing className="w-4.5 h-4.5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-black text-slate-900 dark:text-white">
          {variant === 'rectoria' ? 'Entérate al instante de las excusas nuevas' : 'Recibe el veredicto de tus justificaciones al instante'}
        </p>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium leading-snug">
          Activa las notificaciones de este dispositivo — el navegador te pedirá permiso. Sin esto, una excusa puede esperar horas sin revisión.
        </p>
        {feedback && (
          <p className={`text-[11px] font-bold mt-1 ${feedback.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
            {feedback.message}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={handleEnable}
          disabled={busy}
          className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm"
        >
          <Bell className="w-3.5 h-3.5" />
          {busy ? 'Activando…' : 'Activar notificaciones'}
        </button>
        <button
          onClick={handleDismiss}
          aria-label="Descartar aviso de notificaciones"
          className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
