import React, { useEffect, useState } from 'react';
import { X, Radio } from 'lucide-react';
import { AttendanceStorageService } from '../services/attendanceStorage';
import { ActiveClassContext } from '../types/attendance';

/**
 * Ronda 19 — QR de Clase: chip de "clase activa" para los 3 puntos de escaneo
 * (terminal ScanHub, representante, aula docente). Se suscribe al storage y se
 * auto-refresca cada 20 s para detectar la expiración del bloque (anti-replay).
 * Renderiza null cuando no hay clase activa.
 */
export const ActiveClassBanner: React.FC<{ onClear?: () => void }> = ({ onClear }) => {
  const [activeClass, setActiveClass] = useState<ActiveClassContext | null>(
    () => AttendanceStorageService.getActiveClass()
  );

  useEffect(() => {
    const refresh = () => setActiveClass(AttendanceStorageService.getActiveClass());
    refresh();
    const unsub = AttendanceStorageService.subscribe(refresh);
    const tick = window.setInterval(refresh, 20000);
    return () => {
      unsub();
      window.clearInterval(tick);
    };
  }, []);

  if (!activeClass) return null;

  return (
    <div
      className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl border border-indigo-300 dark:border-indigo-800 bg-indigo-50/90 dark:bg-indigo-950/50 animate-fadeIn"
      role="status"
      aria-label="Clase activa en este dispositivo"
    >
      <Radio className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0 animate-pulse" />
      <div className="flex-1 min-w-0 text-[11px] leading-snug">
        <span className="font-black text-indigo-700 dark:text-indigo-300 uppercase tracking-wide">Clase activa: </span>
        <span className="font-bold text-slate-700 dark:text-slate-200">
          {activeClass.subject} · {activeClass.grade} · {activeClass.slotName} ({activeClass.slotStartTime}–{activeClass.slotEndTime})
        </span>
        <span className="text-slate-500 dark:text-slate-400"> — los escaneos de {activeClass.grade} se vinculan a esta materia hasta las {activeClass.slotEndTime}.</span>
      </div>
      <button
        type="button"
        onClick={() => { AttendanceStorageService.clearActiveClass(); onClear?.(); }}
        className="p-1.5 rounded-lg text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-200 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 shrink-0"
        aria-label="Cancelar clase activa"
        title="Cancelar clase activa"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
