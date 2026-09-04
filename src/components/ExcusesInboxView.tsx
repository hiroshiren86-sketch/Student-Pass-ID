import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck, RefreshCw, Check, X, Search, BadgeCheck,
  AlertTriangle, Hourglass, FileWarning, CheckCircle2, Fingerprint, Inbox,
  Image as ImageIcon, CheckCheck, Loader2, Bell, BellOff
} from 'lucide-react';
import { ExcuseStatus, StudentExcuse, EXCUSE_REASON_LABELS } from '../types/attendance';
import { ExcuseService } from '../services/excuseService';
import { ConfirmDialog } from './ConfirmDialog';
import { ExcuseChimePref, SoundService } from '../utils/sound';

/**
 * ==============================================================================
 * BUZÓN DE JUSTIFICACIONES — Ronda 21 (spec-excusas-2026 §7.3)
 * Sección unificada para Rectoría: ambas temporalidades (Portal anticipado +
 * Planilla post-hoc) llegan aquí. Un solo ciclo de vida, un solo buzón, un solo
 * audit (§1). Tarjeta por excusa con Aprobar (1 toque) / Rechazar (motivo
 * obligatorio R6). Minimización §5: aquí SÍ se ve la razón/notes (datos
 * especiales solo para Rectoría — Ley 1581 art. 3(o)).
 *
 * WCAG 2.2 (§6.3): los cambios de estado se anuncian con aria-live="polite";
 * botones con nombre accesible; foco visible en todo el flujo.
 * ==============================================================================
 */

interface ExcusesInboxViewProps {
  reviewedBy: string; // usuario Rectoría de la sesión (queda en reviewed_by + audit)
}

type Filter = 'PENDIENTE' | 'APROBADA' | 'RECHAZADA' | 'ALL';

const STATUS_BADGE: Record<ExcuseStatus, { label: string; cls: string; icon: React.ComponentType<{ className?: string }> }> = {
  PENDIENTE: { label: 'Bajo revisión', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30', icon: Hourglass },
  APROBADA: { label: 'Verificada', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30', icon: BadgeCheck },
  RECHAZADA: { label: 'Rechazada', cls: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30', icon: FileWarning }
};

export const ExcusesInboxView: React.FC<ExcusesInboxViewProps> = ({ reviewedBy }) => {
  const [excuses, setExcuses] = useState<StudentExcuse[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('PENDIENTE');
  // Ronda 25: campanita de nueva excusa — preferencia por dispositivo, ACTIVADA
  // por defecto (petición del propietario). El toggle da feedback inmediato.
  const [chimeOn, setChimeOn] = useState<boolean>(() => ExcuseChimePref.isEnabled());
  const toggleChime = () => {
    const next = !chimeOn;
    setChimeOn(next);
    ExcuseChimePref.setEnabled(next);
    if (next) SoundService.playExcuseChime(); // gesto del usuario → audio desbloqueado
  };
  const [search, setSearch] = useState('');
  const [physical, setPhysical] = useState<Record<string, boolean>>({});
  const [rejecting, setRejecting] = useState<Record<string, string>>({}); // id → motivo tipeado
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [confirmReject, setConfirmReject] = useState<{ id: string; name: string } | null>(null);
  const [chain, setChain] = useState<{ intact?: boolean; signed?: boolean; checked?: number; firstBroken?: string; error?: string } | null>(null);
  // Ronda 22 (P3): visor del soporte fotográfico descifrado (solo RECTORÍA lo pide al Worker)
  const [photo, setPhoto] = useState<{ id: string; name: string; dataUrl: string } | null>(null);
  const [photoLoading, setPhotoLoading] = useState<string | null>(null);
  // Ronda 22 (P3): aprobación por lote (spec §7.3 "1 toque por lote, con confirmación")
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmBulk, setConfirmBulk] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    await ExcuseService.syncFromWorker(); // cache para el auto-cierre, siempre fresca
    const res = await ExcuseService.listFromWorker();
    if (res.ok) setExcuses(res.excuses);
    else setFeedback(`No se pudieron cargar las excusas: ${res.error}`);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Ronda 23 (hallazgo del propietario con 2 teléfonos): el buzón solo cargaba al
  // montar — en otro dispositivo la excusa nueva NO aparecía hasta refrescar a mano.
  // Ahora: sondeo cada 30 s + refresco inmediato cuando la pestaña vuelve a primer
  // plano (visibilitychange). El push (VAPID) complementa, pero la lista siempre
  // muestra la verdad del Worker.
  useEffect(() => {
    const interval = setInterval(() => { load(); }, 30_000);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const pendingCount = excuses.filter(e => e.status === 'PENDIENTE').length;

  const handleApprove = async (ex: StudentExcuse) => {
    setBusyId(ex.id);
    const res = await ExcuseService.decideExcuse(ex.id, {
      status: 'APROBADA',
      reviewedBy,
      reviewedByRole: 'RECTORIA',
      physicalDocumentVerified: !!physical[ex.id]
    });
    setBusyId(null);
    if (res.ok) {
      setFeedback(`APROBADA la excusa de ${ex.studentName}: el registro queda "Excusada (verificada)".`);
      load();
    } else {
      setFeedback(`Error al aprobar: ${res.errors?.map(e => e.message_es).join(' ') || res.error}`);
    }
  };

  const confirmRejectAction = async () => {
    if (!confirmReject) return;
    const id = confirmReject.id;
    const motivo = (rejecting[id] || '').trim();
    if (!motivo) {
      setFeedback('El rechazo exige un motivo que se notificará al estudiante (R6).');
      setConfirmReject(null);
      return;
    }
    setBusyId(id);
    const res = await ExcuseService.decideExcuse(id, {
      status: 'RECHAZADA',
      rejectReason: motivo,
      reviewedBy,
      reviewedByRole: 'RECTORIA'
    });
    setBusyId(null);
    setConfirmReject(null);
    if (res.ok) {
      setFeedback(`RECHAZADA la excusa de ${excuses.find(e => e.id === id)?.studentName || ''}: los registros vuelven a Ausente y el % se recalcula.`);
      setRejecting(prev => ({ ...prev, [id]: '' }));
      load();
    } else {
      setFeedback(`Error al rechazar: ${res.errors?.map(e => e.message_es).join(' ') || res.error}`);
    }
  };

  const handleVerifyChain = async () => {
    setChain(null);
    const res = await ExcuseService.verifyChain();
    setChain(res);
  };

  // Ronda 22 (P3): pedir el soporte descifrado al Worker (rol RECTORÍA) y mostrarlo
  const handleViewPhoto = async (ex: StudentExcuse) => {
    setPhotoLoading(ex.id);
    const res = await ExcuseService.fetchAttachment(ex.id, { role: 'RECTORIA' });
    setPhotoLoading(null);
    if (res.ok && res.dataBase64) {
      setPhoto({ id: ex.id, name: ex.studentName, dataUrl: `data:${res.mime};base64,${res.dataBase64}` });
      setFeedback(`Soporte de ${ex.studentName} descifrado y mostrado (AES-GCM, Ley 1581: acceso restringido a Rectoría).`);
    } else {
      setFeedback(`No se pudo ver el soporte: ${res.error}`);
    }
  };

  // Ronda 22 (P3): aprobar en lote todas las PENDIENTE del filtro actual (con confirmación)
  const bulkApproveAction = async () => {
    setConfirmBulk(false);
    const targets = filtered.filter(e => e.status === 'PENDIENTE');
    if (targets.length === 0) return;
    setBulkBusy(true);
    let ok = 0; const fails: string[] = [];
    for (const ex of targets) {
      const res = await ExcuseService.decideExcuse(ex.id, {
        status: 'APROBADA', reviewedBy, reviewedByRole: 'RECTORIA', physicalDocumentVerified: !!physical[ex.id]
      });
      if (res.ok) ok++; else fails.push(`${ex.studentName}: ${res.errors?.map(e => e.message_es).join(' ') || res.error}`);
    }
    setBulkBusy(false);
    setFeedback(fails.length
      ? `Lote completado: ${ok} aprobadas, ${fails.length} fallidas — ${fails.join(' | ')}`
      : `Lote completado: ${ok} excusa(s) aprobadas y marcadas "Excusada (verificada)".`);
    load();
  };

  const filtered = excuses
    .filter(e => filter === 'ALL' || e.status === filter)
    .filter(e => {
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return (
        e.studentName?.toLowerCase().includes(q) ||
        e.studentCode?.toLowerCase().includes(q) ||
        e.grade?.toLowerCase().includes(q)
      );
    });

  const countOf = (f: Filter) => f === 'ALL' ? excuses.length : excuses.filter(e => e.status === f).length;

  return (
    <div className="space-y-6 animate-fadeIn" id="excuses-inbox-view">
      {/* Cabecera */}
      <div className="glass-panel p-5 sm:p-6 rounded-3xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5" /> Buzón unificado (Portal + Planilla)
          </span>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-0.5">
            Justificaciones
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            {pendingCount > 0
              ? `${pendingCount} excusa(s) bajo revisión — ventana máxima de 72 h antes del auto-aprobo auditable.`
              : 'Sin excusas pendientes. Toda excusa no rechazada protege al estudiante desde su radicación.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleChime}
            aria-pressed={chimeOn}
            aria-label={chimeOn ? 'Campanita activada: suena cuando llega una excusa nueva. Clic para silenciar.' : 'Campanita silenciada. Clic para activarla.'}
            className={`px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border ${chimeOn
              ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30 hover:bg-amber-500/20'
              : 'bg-slate-500/10 text-slate-500 dark:text-slate-400 border-slate-500/30 hover:bg-slate-500/20'}`}
            title={chimeOn
              ? 'Campanita activada: suena cuando llega una excusa nueva (clic para silenciar)'
              : 'Campanita silenciada (clic para activarla)'}
          >
            {chimeOn ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
            {chimeOn ? 'Campanita' : 'Silenciada'}
          </button>
          {pendingCount >= 2 && (
            <button
              onClick={() => setConfirmBulk(true)}
              disabled={bulkBusy}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-md shadow-emerald-600/20"
              title="Aprueba en lote todas las excusas bajo revisión del filtro actual (con confirmación)"
            >
              {bulkBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4" />}
              Aprobar pendientes ({pendingCount})
            </button>
          )}
          <button
            onClick={handleVerifyChain}
            className="px-4 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl text-xs font-bold transition-all hover:opacity-90 flex items-center gap-2"
            title="Verifica la cadena HMAC de auditoría (expediente tamper-evidente, §6.2)"
          >
            <Fingerprint className="w-4 h-4" />
            Verificar expediente
          </button>
          <button
            onClick={load}
            aria-label="Recargar lista de excusas"
            className="p-2.5 rounded-xl border border-slate-200 dark:border-zinc-800/50 hover:bg-slate-100 dark:hover:bg-zinc-900 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 text-slate-500 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Resultado verify-chain (§6.1: expediente verificable en segundos) */}
      {chain && (
        <div aria-live="polite" role="status" className={`glass-panel p-4 rounded-2xl text-xs font-bold flex items-center gap-2 ${
          chain.error ? 'text-amber-600'
          : chain.intact ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-rose-600 dark:text-rose-400'
        }`}>
          {chain.error ? <AlertTriangle className="w-4 h-4" /> : chain.intact ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {chain.error
            ? `No se pudo verificar: ${chain.error}`
            : chain.intact === false
              ? `CADENA ROTA — primer eslabón alterado: ${chain.firstBroken}. Evidencia forense de manipulación (§10.10).`
              : chain.signed
                ? `Expediente ÍNTEGRO: ${chain.checked} evento(s) verificados con HMAC-SHA256 (Ley 527/1999 arts. 21–22).`
                : 'Cadena sin firmar: configura EXCUSE_CHAIN_SECRET en el Worker para auditoría forense.'}
        </div>
      )}

      {/* Feedback de decisiones (aria-live) */}
      <div aria-live="polite" className="min-h-[20px]">
        {feedback && (
          <p className="text-xs font-bold text-slate-600 dark:text-slate-300 px-1" role="status">{feedback}</p>
        )}
      </div>

      {/* Filtros + búsqueda */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por estado">
          {(['PENDIENTE', 'APROBADA', 'RECHAZADA', 'ALL'] as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={`px-3.5 py-2 rounded-xl text-[11px] font-black border transition-all ${
                filter === f
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-600/20'
                  : 'bg-white/80 dark:bg-black/50 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-zinc-800/50 hover:border-indigo-400'
              }`}
            >
              {f === 'ALL' ? 'Todas' : STATUS_BADGE[f].label} ({countOf(f)})
            </button>
          ))}
        </div>
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Estudiante, código o curso…"
            aria-label="Buscar excusas"
            className="w-full pl-10 pr-4 py-2.5 bg-white/80 dark:bg-black/70 border border-slate-200 dark:border-zinc-800/50 rounded-xl text-xs"
          />
        </div>
      </div>

      {/* Lista de tarjetas */}
      {loading ? (
        <div className="py-12 text-center text-slate-400 text-xs">Cargando excusas del Worker…</div>
      ) : filtered.length === 0 ? (
        <div className="glass-panel py-12 rounded-3xl text-center text-slate-400 text-xs space-y-2">
          <Inbox className="w-8 h-8 mx-auto text-slate-300 dark:text-zinc-700" />
          <p>No hay excusas para este filtro.</p>
          <p className="text-[11px]">Las radicaciones del Portal (anticipadas) y de la Planilla (1 toque) aparecen aquí.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map(ex => {
            const badge = STATUS_BADGE[ex.status];
            const BadgeIcon = badge.icon;
            const motivo = rejecting[ex.id] || '';
            return (
              <div key={ex.id} className="glass-panel p-5 rounded-3xl space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <p className="font-black text-slate-900 dark:text-white text-sm">{ex.studentName}</p>
                    <p className="text-[11px] text-slate-500 font-mono">{ex.studentCode} · {ex.grade}</p>
                  </div>
                  <span className={`px-2.5 py-0.5 rounded-full font-bold text-[10px] border inline-flex items-center gap-1 ${badge.cls}`}>
                    <BadgeIcon className="w-3 h-3" /> {badge.label}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span className="block text-slate-400 font-bold uppercase text-[9px]">Fechas</span>
                    <span className="text-slate-700 dark:text-slate-200 font-bold">
                      {ex.startDate === ex.endDate ? ex.startDate : `${ex.startDate} → ${ex.endDate}`}
                    </span>
                  </div>
                  <div>
                    <span className="block text-slate-400 font-bold uppercase text-[9px]">Razón</span>
                    <span className="text-slate-700 dark:text-slate-200 font-bold">{EXCUSE_REASON_LABELS[ex.reason] || ex.reason}</span>
                  </div>
                  <div>
                    <span className="block text-slate-400 font-bold uppercase text-[9px]">Origen</span>
                    <span className="text-slate-700 dark:text-slate-200 font-bold">
                      {ex.submittedBy === 'RECTORIA' ? 'Planilla (1 toque)' : 'Portal estudiante'}
                    </span>
                  </div>
                  <div>
                    <span className="block text-slate-400 font-bold uppercase text-[9px]">Soporte foto</span>
                    {ex.attachmentPath ? (
                      <button
                        onClick={() => handleViewPhoto(ex)}
                        disabled={photoLoading === ex.id}
                        className="text-indigo-600 dark:text-indigo-400 font-bold hover:underline inline-flex items-center gap-1 disabled:opacity-60"
                        aria-label={`Ver soporte fotográfico de ${ex.studentName} (descifrado en el servidor)`}
                      >
                        {photoLoading === ex.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ImageIcon className="w-3 h-3" />}
                        Ver soporte (cifrado)
                      </button>
                    ) : (
                      <span className="text-slate-700 dark:text-slate-200 font-bold">No adjunta</span>
                    )}
                  </div>
                </div>

                {ex.notes && (
                  <p className="text-[11px] text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-black/40 rounded-xl p-3 border border-slate-100 dark:border-zinc-800/50">
                    <span className="font-black">Nota: </span>{ex.notes}
                  </p>
                )}

                {ex.status === 'RECHAZADA' && ex.rejectReason && (
                  <p className="text-[11px] font-bold text-rose-600 dark:text-rose-400 bg-rose-500/10 rounded-xl p-3">
                    Motivo del rechazo: {ex.rejectReason}
                  </p>
                )}

                {/* Huella de auditoría (§6.1): quién y cuándo; auto_72h = ventana R8 */}
                {ex.status !== 'PENDIENTE' && (
                  <p className="text-[10px] text-slate-400 font-mono flex items-center gap-1.5">
                    <Fingerprint className="w-3 h-3" />
                    {ex.autoApproved ? 'AUTO_72H (ventana vencida)' : (ex.reviewedBy || '—')} · {ex.reviewedAt?.replace('T', ' ').slice(0, 16) || '—'}
                    {ex.auditHash ? ` · ${ex.auditHash.slice(0, 10)}…` : ''}
                  </p>
                )}

                {/* Acciones — solo Rectoría decide (R5, enforceado también en el Worker) */}
                {ex.status === 'PENDIENTE' && (
                  <div className="space-y-2.5 pt-1 border-t border-slate-100 dark:border-zinc-800/50">
                    <label className="flex items-start gap-2 cursor-pointer select-none pt-2">
                      <input
                        type="checkbox"
                        checked={!!physical[ex.id]}
                        onChange={e => setPhysical(prev => ({ ...prev, [ex.id]: e.target.checked }))}
                        className="mt-0.5 w-4 h-4 rounded accent-emerald-600"
                      />
                      <span className="text-[11px] text-slate-500 leading-snug">
                        Soporte físico firmado verificado en el expediente (opcional)
                      </span>
                    </label>

                    {motivo !== '' && (
                      <div className="space-y-1">
                        <label htmlFor={`motivo-${ex.id}`} className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                          Motivo del rechazo (obligatorio — se notifica al estudiante)
                        </label>
                        <input
                          id={`motivo-${ex.id}`}
                          type="text"
                          value={motivo}
                          onChange={e => setRejecting(prev => ({ ...prev, [ex.id]: e.target.value }))}
                          maxLength={200}
                          placeholder="Ej: el soporte no corresponde a la fecha indicada…"
                          className="w-full px-3 py-2 bg-white/80 dark:bg-black/70 border border-slate-200 dark:border-zinc-800/50 rounded-xl text-xs"
                        />
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleApprove(ex)}
                        disabled={busyId === ex.id}
                        className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-xs font-black transition-all shadow-md shadow-emerald-600/20 flex items-center justify-center gap-1.5"
                      >
                        <Check className="w-4 h-4" /> Aprobar
                      </button>
                      {motivo === '' ? (
                        <button
                          onClick={() => setRejecting(prev => ({ ...prev, [ex.id]: ' ' }))}
                          className="flex-1 px-4 py-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900 text-xs font-black hover:bg-rose-100 transition-all flex items-center justify-center gap-1.5"
                        >
                          <X className="w-4 h-4" /> Rechazar
                        </button>
                      ) : (
                        <button
                          onClick={() => setConfirmReject({ id: ex.id, name: ex.studentName })}
                          disabled={busyId === ex.id || !motivo.trim()}
                          className="flex-1 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white text-xs font-black transition-all flex items-center justify-center gap-1.5"
                        >
                          <X className="w-4 h-4" /> Confirmar rechazo
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {confirmBulk && (
        <ConfirmDialog
          open
          title="Aprobación por lote"
          message={`¿Aprobar las ${pendingCount} excusa(s) bajo revisión del filtro actual?\n\nCada una queda "Excusada (verificada)" con tu usuario en el expediente (auditoría por excusa). Sin reversas.`}
          confirmLabel={`Sí, aprobar ${pendingCount}`}
          onConfirm={bulkApproveAction}
          onCancel={() => setConfirmBulk(false)}
        />
      )}

      {photo && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Soporte fotográfico de ${photo.name}`}
          onClick={() => setPhoto(null)}
          onKeyDown={e => { if (e.key === 'Escape') setPhoto(null); }}
          tabIndex={-1}
          ref={el => el?.focus()}
        >
          <div className="max-w-2xl w-full space-y-3" onClick={e => e.stopPropagation()}>
            <img src={photo.dataUrl} alt={`Soporte fotográfico de la excusa de ${photo.name}`} className="w-full max-h-[75vh] object-contain rounded-2xl bg-white" />
            <p className="text-[10px] text-slate-300 text-center font-mono">
              Descifrado en memoria (AES-GCM-256) · Solo Rectoría y el estudiante (Ley 1581 art. 3(o)) · La planilla nunca lo muestra
            </p>
            <div className="text-center">
              <button onClick={() => setPhoto(null)} className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold border border-white/20">
                Cerrar (Escape)
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmReject && (
        <ConfirmDialog
          open
          title="Confirmar rechazo"
          message={`¿Rechazar la excusa de ${confirmReject.name}?\n\nLos registros vuelven a "Ausente", el % se recalcula y el estudiante será notificado con el motivo. Sin transiciones en reversa: si es un error, se elimina y se re-radica (queda en auditoría).`}
          confirmLabel="Sí, rechazar"
          onConfirm={confirmRejectAction}
          onCancel={() => setConfirmReject(null)}
        />
      )}
    </div>
  );
};
