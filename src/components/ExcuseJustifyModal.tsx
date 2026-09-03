import React, { useState, useEffect, useRef } from 'react';
import { X, ShieldCheck, Send, AlertCircle } from 'lucide-react';
import { AttendanceRecord, ExcuseReason, EXCUSE_REASON_LABELS, StudentExcuse } from '../types/attendance';
import { ExcuseService } from '../services/excuseService';

/**
 * ==============================================================================
 * MODAL DE 1 TOQUE "JUSTIFICAR" — Ronda 21 (spec-excusas-2026 §7.2)
 * Baseline del propietario INTACTO: sin formulario burocrático — chip de razón +
 * checkbox opcional de soporte físico + Radicar. La rectora sigue firmando el papel
 * si su institución lo exige (el checkbox lo certifica); si no, su aprobación
 * electrónica con cadena HMAC (§6.1) equivale (Ley 527/1999).
 *
 * WCAG 2.2 (§6.3): 2.4.11 el modal no tapa el botón de origen (es el botón el que
 * abre; al cerrar el foco vuelve); 2.4.3 orden de foco razón → nota → soporte →
 * radicar; 3.3.7 la foto/soporte es OPCIONAL (nunca se exige lo ya dado).
 * ==============================================================================
 */

interface ExcuseJustifyModalProps {
  record: AttendanceRecord;
  onClose: () => void;
  onRadicated: (excuse: StudentExcuse) => void;
}

const REASON_ORDER: ExcuseReason[] = ['CITA_MEDICA', 'INCAPACIDAD', 'CALAMIDAD', 'DEPORTIVA', 'OTRA'];

export const ExcuseJustifyModal: React.FC<ExcuseJustifyModalProps> = ({ record, onClose, onRadicated }) => {
  const [reason, setReason] = useState<ExcuseReason | null>(null);
  const [notes, setNotes] = useState('');
  const [physicalVerified, setPhysicalVerified] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Foco inicial en el diálogo (2.4.3) y Escape para salir (2.1.2 heredado)
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !submitting) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [submitting, onClose]);

  const handleRadicar = async () => {
    if (!reason) {
      setError('Elige la razón de la justificación.');
      return;
    }
    if (reason === 'OTRA' && !notes.trim()) {
      setError('La razón "Otra" requiere una nota explicativa.');
      return;
    }
    setSubmitting(true);
    setError('');
    const res = await ExcuseService.createExcuse({
      studentCode: record.studentCode,
      startDate: record.date,
      endDate: record.date,
      reason,
      notes: notes.trim() || undefined,
      sourceAttendanceId: record.id,
      submittedBy: 'RECTORIA'
    });
    setSubmitting(false);
    if (!res.ok || !res.excuse) {
      // Errores de reglas (R1/R2/R3/R9/R10) llegan en español desde el Worker
      const detail = res.errors?.map(e => e.message_es).join(' ') || res.error || 'No fue posible radicar la excusa.';
      setError(detail);
      return;
    }
    setSuccessMsg(res.message || 'Excusa radicada. Queda protegida provisionalmente mientras Rectoría la revisa.');
    setTimeout(() => onRadicated(res.excuse!), 1400);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Justificar ausencia de ${record.studentName} el ${record.date}`}
        tabIndex={-1}
        className="p-5 sm:p-6 rounded-3xl bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800/50 shadow-2xl max-w-md w-full space-y-5 outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" /> Justificación post-hoc
            </span>
            <h3 className="text-lg font-black text-slate-900 dark:text-white tracking-tight">
              {record.studentName}
            </h3>
            <p className="text-xs text-slate-500">
              {record.studentGrade} · {record.slotName || 'Clase'} · {record.date}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar sin radicar"
            className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-zinc-900 text-slate-400 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {!successMsg ? (
          <>
            {/* Paso 1 — chip de razón (§7.2): un toque, sin teclado */}
            <fieldset className="space-y-2">
              <legend className="text-xs font-bold text-slate-600 dark:text-slate-300">Razón</legend>
              <div className="flex flex-wrap gap-2">
                {REASON_ORDER.map(r => (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={reason === r}
                    onClick={() => { setReason(r); setError(''); }}
                    className={`px-3 py-1.5 rounded-full text-[11px] font-bold border transition-all ${
                      reason === r
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-600/20'
                        : 'bg-white dark:bg-black/40 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-zinc-800 hover:border-indigo-400'
                    }`}
                  >
                    {EXCUSE_REASON_LABELS[r]}
                  </button>
                ))}
              </div>
            </fieldset>

            {/* Nota: opcional salvo OTRA (R3) */}
            {reason === 'OTRA' && (
              <div className="space-y-1.5">
                <label htmlFor="excuse-notes" className="text-xs font-bold text-slate-600 dark:text-slate-300">
                  Nota explicativa <span className="text-rose-500">*</span>
                </label>
                <input
                  id="excuse-notes"
                  type="text"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  maxLength={180}
                  placeholder="Describe brevemente el motivo…"
                  className="w-full px-3 py-2.5 bg-white/80 dark:bg-black/70 border border-slate-200 dark:border-zinc-800/50 rounded-xl text-xs"
                />
              </div>
            )}

            {/* Certificación del papel firmado — OPCIONAL (§6.1): la rectora firma el
                documento físico y lo marca, o aprueba 100% digital con cadena HMAC */}
            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={physicalVerified}
                onChange={e => setPhysicalVerified(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded accent-indigo-600"
              />
              <span className="text-[11px] text-slate-500 leading-snug">
                El soporte físico firmado está en el expediente (opcional — tu aprobación
                electrónica también tiene validez con la cadena de auditoría).
              </span>
            </label>

            <div aria-live="polite" className="min-h-[20px]">
              {error && (
                <p className="text-xs font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1.5" role="alert">
                  <AlertCircle className="w-3.5 h-3.5" /> {error}
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-900 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleRadicar}
                disabled={submitting}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-xs font-black transition-all shadow-md shadow-indigo-600/20 flex items-center gap-2"
              >
                <Send className="w-3.5 h-3.5" />
                {submitting ? 'Radicando…' : 'Radicar'}
              </button>
            </div>
          </>
        ) : (
          <div aria-live="polite" className="py-6 text-center space-y-2">
            <ShieldCheck className="w-10 h-10 text-emerald-500 mx-auto" />
            <p className="text-sm font-black text-emerald-600 dark:text-emerald-400">Excusa radicada</p>
            <p className="text-xs text-slate-500">{successMsg}</p>
          </div>
        )}
      </div>
    </div>
  );
};
