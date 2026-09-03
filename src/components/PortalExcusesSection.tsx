import React, { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, Plus, Hourglass, BadgeCheck, FileWarning, Ban, CalendarDays, Camera } from 'lucide-react';
import {
  StudentExcuse, ExcuseReason, ExcuseStatus, EXCUSE_REASON_LABELS
} from '../types/attendance';
import { ExcuseService } from '../services/excuseService';
import { bogotaToday } from '../utils/bogotaDate';
import { compressImageFile } from '../utils/imageCompressor';

/**
 * ==============================================================================
 * "MIS JUSTIFICACIONES" — Portal del estudiante/acudiente (spec-excusas-2026 §7.1)
 * Radicación ANTICIPADA (Escudo, fechas futuras — R1: start ≥ mañana). 3 pasos de
 * un toque: chip de razón → fechas rápidas → Radicar. Sin formularios largos.
 * R4: una vez radicada NO se edita ni retira (solo Rectoría decide).
 * La protección provisional rige desde el primer segundo (§1.1): el aviso lo dice
 * con la verdad — "protegida mientras Rectoría no la rechace".
 * Ronda 22 (P3): foto del soporte OPCIONAL (WCAG 3.3.7) — se comprime en el
 * dispositivo y se sube tras radicar; el Worker la cifra AES-GCM-256 y solo la
 * ven Rectoría y el estudiante (Ley 1581 art. 3(o)).
 * ==============================================================================
 */

interface PortalExcusesSectionProps {
  studentCode: string;
}

const REASON_ORDER: ExcuseReason[] = ['CITA_MEDICA', 'INCAPACIDAD', 'CALAMIDAD', 'DEPORTIVA', 'OTRA'];

const STATUS_UI: Record<ExcuseStatus, { label: string; cls: string; icon: React.ComponentType<{ className?: string }> }> = {
  PENDIENTE: { label: 'Bajo revisión', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30', icon: Hourglass },
  APROBADA: { label: 'Verificada', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30', icon: BadgeCheck },
  RECHAZADA: { label: 'Rechazada', cls: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30', icon: FileWarning }
};

export const PortalExcusesSection: React.FC<PortalExcusesSectionProps> = ({ studentCode }) => {
  const [excuses, setExcuses] = useState<StudentExcuse[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [reason, setReason] = useState<ExcuseReason | null>(null);
  const [notes, setNotes] = useState('');
  const [rangeMode, setRangeMode] = useState(false);
  const [singleDate, setSingleDate] = useState('');
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  // Ronda 22 (P3): soporte fotográfico opcional — comprimido en el dispositivo
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoName, setPhotoName] = useState('');

  const tomorrow = bogotaToday(1);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await ExcuseService.listFromWorker({ studentCode });
    if (res.ok) setExcuses(res.excuses);
    else {
      // Sin Worker: cache local (última sincronización) para que el expediente no quede vacío
      setExcuses(ExcuseService.getCachedExcuses().filter(e => e.studentCode === studentCode));
    }
    setLoading(false);
  }, [studentCode]);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => {
    setReason(null); setNotes(''); setRangeMode(false);
    setSingleDate(''); setRangeStart(''); setRangeEnd('');
    setPhotoFile(null); setPhotoName('');
  };

  const canSubmit = !!reason && (reason !== 'OTRA' || notes.trim().length > 0) &&
    (rangeMode ? !!rangeStart && !!rangeEnd && rangeStart <= rangeEnd : !!singleDate);

  const handleRadicar = async () => {
    if (!reason || !canSubmit) return;
    setSubmitting(true);
    setFeedback(null);
    const startDate = rangeMode ? rangeStart : singleDate;
    const endDate = rangeMode ? rangeEnd : singleDate;
    const res = await ExcuseService.createExcuse({
      studentCode,
      startDate,
      endDate,
      reason,
      notes: notes.trim() || undefined,
      submittedBy: 'PORTAL_ESTUDIANTE'
    });
    setSubmitting(false);
    if (!res.ok || !res.excuse) {
      setFeedback({ ok: false, msg: res.errors?.map(e => e.message_es).join(' ') || res.error || 'No fue posible radicar la excusa.' });
      return;
    }
    // Ronda 22 (P3): si hay foto del soporte, se comprime y se sube cifrada (best-effort:
    // la excusa ya está radicada y protegida; un fallo de la foto NO revierte nada)
    let photoMsg = '';
    if (photoFile) {
      try {
        const dataUrl = await compressImageFile(photoFile, 780, 1040, 0.6);
        const b64 = dataUrl.split(',')[1] || '';
        const up = await ExcuseService.uploadAttachment(res.excuse.id, {
          studentCode, dataBase64: b64, mime: 'image/jpeg'
        });
        photoMsg = up.ok ? ' Foto del soporte adjuntada y cifrada.' : ` La excusa está radicada, pero la foto no se pudo subir: ${up.error}`;
      } catch {
        photoMsg = ' La excusa está radicada, pero la foto no se pudo procesar.';
      }
    }
    setFeedback({ ok: true, msg: 'Excusa radicada. Rectoría la revisará en un máximo de 72 h: tu registro queda protegido mientras no sea rechazada.' + photoMsg });
    resetForm();
    setShowNew(false);
    load();
  };

  return (
    <div className="glass-panel rounded-3xl p-5 sm:p-6 space-y-4" id="portal-excuses-section">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-zinc-800/50 pb-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          <h3 className="text-base font-black text-slate-900 dark:text-white">
            Mis Justificaciones
          </h3>
        </div>
        {!showNew && (
          <button
            onClick={() => { setShowNew(true); setFeedback(null); }}
            className="px-4 py-2 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-600/20 inline-flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> Nueva justificación
          </button>
        )}
      </div>

      <div aria-live="polite" className="min-h-[18px]">
        {feedback && (
          <p role="status" className={`text-xs font-bold ${feedback.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
            {feedback.msg}
          </p>
        )}
      </div>

      {/* Radicación anticipada — 3 pasos de un toque (§7.1) */}
      {showNew && (
        <div className="space-y-4 bg-slate-50 dark:bg-black/40 rounded-2xl p-4 border border-slate-100 dark:border-zinc-800/50">
          {/* Paso 1 — razón */}
          <div className="space-y-2">
            <p className="text-xs font-black text-slate-600 dark:text-slate-300">1 · ¿Por qué?</p>
            <div className="flex flex-wrap gap-2">
              {REASON_ORDER.map(r => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={reason === r}
                  onClick={() => setReason(r)}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-bold border transition-all ${
                    reason === r
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-md shadow-emerald-600/20'
                      : 'bg-white dark:bg-black/40 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-zinc-800 hover:border-emerald-400'
                  }`}
                >
                  {EXCUSE_REASON_LABELS[r]}
                </button>
              ))}
            </div>
            {reason === 'OTRA' && (
              <input
                type="text"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                maxLength={180}
                placeholder="Explica brevemente el motivo (obligatorio para 'Otra')…"
                aria-label="Nota explicativa obligatoria para la razón Otra"
                className="w-full px-3 py-2.5 bg-white/80 dark:bg-black/70 border border-slate-200 dark:border-zinc-800/50 rounded-xl text-xs"
              />
            )}
          </div>

          {/* Paso 2 — fechas rápidas (un solo día o rango) */}
          <div className="space-y-2">
            <p className="text-xs font-black text-slate-600 dark:text-slate-300">2 · ¿Cuándo?</p>
            <div className="flex gap-2" role="group" aria-label="Modo de fechas">
              <button
                type="button"
                aria-pressed={!rangeMode}
                onClick={() => setRangeMode(false)}
                className={`px-3 py-1.5 rounded-full text-[11px] font-bold border transition-all ${!rangeMode ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-black/40 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-zinc-800'}`}
              >
                Un solo día
              </button>
              <button
                type="button"
                aria-pressed={rangeMode}
                onClick={() => setRangeMode(true)}
                className={`px-3 py-1.5 rounded-full text-[11px] font-bold border transition-all ${rangeMode ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-black/40 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-zinc-800'}`}
              >
                Varios días (rango)
              </button>
            </div>
            {!rangeMode ? (
              <input
                type="date"
                value={singleDate}
                min={tomorrow}
                onChange={e => setSingleDate(e.target.value)}
                aria-label="Fecha de la justificación (solo futura)"
                className="px-3 py-2.5 bg-white/80 dark:bg-black/70 border border-slate-200 dark:border-zinc-800/50 rounded-xl text-xs font-bold"
              />
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={rangeStart}
                  min={tomorrow}
                  onChange={e => setRangeStart(e.target.value)}
                  aria-label="Fecha inicial del rango"
                  className="px-3 py-2.5 bg-white/80 dark:bg-black/70 border border-slate-200 dark:border-zinc-800/50 rounded-xl text-xs font-bold"
                />
                <span className="text-xs text-slate-400">→</span>
                <input
                  type="date"
                  value={rangeEnd}
                  min={rangeStart || tomorrow}
                  onChange={e => setRangeEnd(e.target.value)}
                  aria-label="Fecha final del rango"
                  className="px-3 py-2.5 bg-white/80 dark:bg-black/70 border border-slate-200 dark:border-zinc-800/50 rounded-xl text-xs font-bold"
                />
              </div>
            )}
            <p className="text-[10px] text-slate-400 flex items-center gap-1">
              <CalendarDays className="w-3 h-3" /> Solo fechas futuras: la justificación de una ausencia
              ya registrada la hace Rectoría desde la planilla.
            </p>
          </div>

          {/* Ronda 22 (P3): soporte fotográfico opcional — cifrado en el Worker */}
          <div className="space-y-1.5">
            <label htmlFor="portal-excuse-photo" className="text-xs font-black text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
              <Camera className="w-3.5 h-3.5" /> Foto del soporte (opcional)
            </label>
            <input
              id="portal-excuse-photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={e => { const f = e.target.files?.[0] || null; setPhotoFile(f); setPhotoName(f ? f.name : ''); }}
              className="block w-full text-[11px] text-slate-500 dark:text-slate-400 file:mr-3 file:py-2 file:px-3 file:rounded-xl file:border-0 file:text-[11px] file:font-bold file:bg-indigo-50 dark:file:bg-indigo-950/60 file:text-indigo-700 dark:file:text-indigo-300 hover:file:bg-indigo-100 cursor-pointer"
            />
            {photoName && <p className="text-[10px] text-slate-400">Seleccionada: {photoName} — se cifra en el servidor; solo Rectoría y tú pueden verla.</p>}
          </div>

          {/* Paso 3 — radicar */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              onClick={handleRadicar}
              disabled={!canSubmit || submitting}
              className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-black transition-all shadow-md shadow-emerald-600/20 inline-flex items-center gap-1.5"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              {submitting ? 'Radicando…' : '3 · Radicar'}
            </button>
            <button
              onClick={() => { setShowNew(false); resetForm(); }}
              className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-900 transition-colors"
            >
              Cancelar
            </button>
            <span className="text-[10px] text-slate-400 w-full sm:w-auto">
              Una vez radicada no se puede editar ni retirar (decisión de Rectoría).
            </span>
          </div>
        </div>
      )}

      {/* Lista del expediente propio */}
      {loading ? (
        <p className="py-6 text-center text-slate-400 text-xs">Cargando tus justificaciones…</p>
      ) : excuses.length === 0 ? (
        <p className="py-6 text-center text-slate-400 text-xs">
          Aún no tienes justificaciones radicadas. Si vas a faltar (cita médica, incapacidad…),
          radícala aquí ANTES y tu registro quedará protegido desde el cierre del día.
        </p>
      ) : (
        <div className="space-y-2.5">
          {[...excuses]
            .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
            .map(ex => {
              const ui = STATUS_UI[ex.status];
              const Icon = ui.icon;
              return (
                <div key={ex.id} className="p-4 rounded-2xl bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800/50 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-bold text-xs text-slate-900 dark:text-white">
                      {ex.startDate === ex.endDate ? ex.startDate : `${ex.startDate} → ${ex.endDate}`}
                      <span className="text-slate-400 font-normal"> · {EXCUSE_REASON_LABELS[ex.reason] || ex.reason}</span>
                    </p>
                    <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] border inline-flex items-center gap-1 ${ui.cls}`}>
                      <Icon className="w-3 h-3" /> {ui.label}
                    </span>
                  </div>
                  {ex.status === 'RECHAZADA' && ex.rejectReason && (
                    <p className="text-[11px] font-bold text-rose-600 dark:text-rose-400 bg-rose-500/10 rounded-xl p-2.5">
                      Motivo de Rectoría: {ex.rejectReason}
                    </p>
                  )}
                  {ex.status === 'PENDIENTE' && (
                    <p className="text-[10px] text-slate-400">
                      Protegida provisionalmente: tu asistencia no cuenta como falta mientras Rectoría la revisa.
                    </p>
                  )}
                </div>
              );
            })}
          <p className="text-[10px] text-slate-400 flex items-center gap-1 pt-1">
            <Ban className="w-3 h-3" /> Las excusas radicadas no se editan ni se retiran; si algo está mal,
            pide a Rectoría la revisión o eliminación (queda en la auditoría).
          </p>
        </div>
      )}
    </div>
  );
};
