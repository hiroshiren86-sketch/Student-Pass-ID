/**
 * ==============================================================================
 * PURGA DE LA NUBE (D1 + KV) — UI de Ajustes → Sync y Seguridad (Ronda 28).
 *
 * Petición textual del propietario: "en Ajustes → Sincronización y Seguridad
 * podemos dejar un interruptor o botón que elimine los datos demo de la nube…
 * pero tampoco hay que hacerlo al azar porque si rompe las cosas".
 *
 * Barreras del flujo (nada al azar):
 *   1. Solo Rol Rectoría (el portal no ve esta tarjeta).
 *   2. Requiere Worker URL + Token (AUTH_TOKEN) configurados — sin token el
 *      Worker responde 401 y el rate limit del Worker es 3 purgas/hora/IP.
 *   3. COPIA PREVIA INNEGOCIABLE: descarga el volcado completo de la nube
 *      (GET /api/sync/export — TODAS las filas D1, sin el recorte de 500 del
 *      snapshot) como INAS_respaldo_nube_antes_de_purgar_<fecha>.json. Si la
 *      copia falla, la purga queda BLOQUEADA (no se borra lo que no se respaldó).
 *   4. Confirmación tipeada: el usuario debe escribir PURGAR (patrón GitHub).
 *   5. Reporte honesto: filas borradas por tabla + claves KV eliminadas.
 *   6. Opcional (casilla): dejar también ESTE dispositivo en blanco — si no,
 *      el auto-sync volverá a subir el estado local en ≤ intervalo (se avisa).
 * ==============================================================================
 */
import { useMemo, useState } from 'react';
import {
  CloudCog, Download, Trash2, ShieldAlert, CheckCircle2, AlertTriangle, Loader2, Info
} from 'lucide-react';
import { AttendanceStorageService } from '../services/attendanceStorage';
import { CloudflareSyncService, type CloudPurgeReport } from '../services/cloudflareSync';
import {
  buildBackupFromCloudExport, buildEmptyWipeBackup, applyBackup, downloadBackup
} from '../services/backupService';

/** Rol efectivo del dispositivo (misma fuente que pushService — Ronda 24). */
function isPortalRole(): boolean {
  try {
    const flag = localStorage.getItem('inas_push_role_v1');
    if (flag === 'PORTAL') return true;
    const raw = localStorage.getItem('inas_user_session_v5');
    const session = raw ? JSON.parse(raw) : null;
    return !!session && session.role === 'ESTUDIANTE_ACUDIENTE';
  } catch {
    return false;
  }
}

const tableLabels: Record<string, string> = {
  attendance_records: 'Asistencias',
  student_excuses: 'Excusas',
  students: 'Estudiantes',
  teachers: 'Docentes',
  schedule_assignments: 'Cátedras',
  schedule_slots: 'Bloques de jornada',
  sync_snapshots: 'Snapshots de sync',
  push_subscriptions: 'Suscripciones push',
  audit_logs: 'Registros de auditoría'
};

export function CloudPurgeSection() {
  const portal = useMemo(isPortalRole, []);
  const [busy, setBusy] = useState<'' | 'export' | 'backup' | 'purge'>('');
  const [panelOpen, setPanelOpen] = useState(false);
  const [preBackup, setPreBackup] = useState<{ ok: boolean; counts: Record<string, number>; message: string } | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [wipeLocalToo, setWipeLocalToo] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [report, setReport] = useState<CloudPurgeReport | null>(null);

  const settings = AttendanceStorageService.getSettings();
  const hasUrl = !!(settings.cloudflareWorkerUrl || '').trim();
  const hasToken = !!(settings.cloudflareApiToken || '').trim();

  if (portal) return null;

  /** Paso 1 del flujo destructivo: copia completa de la nube (bloquea si falla). */
  const runPreBackup = async (): Promise<boolean> => {
    setBusy('backup');
    try {
      const res = await CloudflareSyncService.fetchCloudExport();
      if (!res.ok || !res.data) {
        setPreBackup({ ok: false, counts: {}, message: res.message });
        return false;
      }
      const schoolCode = AttendanceStorageService.getSettings().schoolCode || '';
      const file = buildBackupFromCloudExport(res.data, schoolCode);
      downloadBackup(file, 'nube_antes_de_purgar');
      setPreBackup({ ok: true, counts: file.counts, message: 'Copia de la nube descargada. Guárdala en un lugar seguro.' });
      return true;
    } finally {
      setBusy('');
    }
  };

  const doExport = async () => {
    setFeedback(null);
    setBusy('export');
    try {
      const res = await CloudflareSyncService.fetchCloudExport();
      if (!res.ok || !res.data) {
        setFeedback({ ok: false, message: res.message });
      } else {
        const schoolCode = AttendanceStorageService.getSettings().schoolCode || '';
        const file = buildBackupFromCloudExport(res.data, schoolCode);
        downloadBackup(file, 'nube');
        const c = file.counts;
        setFeedback({
          ok: true,
          message: `Copia completa de la nube descargada: ${c.students} estudiantes, ${c.teachers} docentes, ${c.attendance} asistencias, ${c.excuses} excusas, ${c.slots} bloques.`
        });
      }
    } catch (e: any) {
      setFeedback({ ok: false, message: `Error al exportar la nube: ${e?.message || e}` });
    }
    setBusy('');
  };

  const openPanel = async () => {
    setFeedback(null);
    setReport(null);
    setConfirmText('');
    setPreBackup(null);
    setPanelOpen(true);
    await runPreBackup();
  };

  const doPurge = async () => {
    if (confirmText !== 'PURGAR' || !preBackup?.ok) return;
    setBusy('purge');
    try {
      const res = await CloudflareSyncService.purgeCloudData(
        `AJUSTES:${AttendanceStorageService.getSettings().schoolCode || 'INAS'}`
      );
      if (!res.ok || !res.report) {
        setFeedback({ ok: false, message: res.message });
        setBusy('');
        return;
      }
      setReport(res.report);
      setPanelOpen(false);
      if (wipeLocalToo) {
        // Borrado local opcional (patrón anti-seed R27): [] persistido explícito,
        // sin tocar settings ni la estructura de jornada. Recarga para refrescar todo.
        applyBackup(buildEmptyWipeBackup(AttendanceStorageService.getSettings().schoolCode || ''));
        setTimeout(() => location.reload(), 2200);
      }
    } catch (e: any) {
      setFeedback({ ok: false, message: `Error durante la purga: ${e?.message || e}` });
    }
    setBusy('');
  };

  const canPurge = preBackup?.ok && confirmText === 'PURGAR' && busy === '';

  return (
    <div className="p-4 rounded-2xl bg-rose-50/70 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/60 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-black text-rose-950 dark:text-rose-200">
          <CloudCog className="w-4 h-4 text-rose-600 dark:text-rose-400" />
          <span>Purga de la Nube (D1 + KV)</span>
        </div>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-rose-200/70 dark:bg-rose-900/60 text-rose-800 dark:text-rose-200">
          Zona sensible
        </span>
      </div>

      <p className="text-[11px] text-rose-800 dark:text-rose-300">
        Descarga una copia completa de la nube (todas las tablas, sin recortes) o elimina <b>TODOS</b> los
        datos de la nube — útil para limpiar datos demo antes de la matrícula real. La purga exige token,
        copia previa descargada y confirmación tipeada; el Worker además la limita a 3 por hora.
      </p>

      {!hasUrl && (
        <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-[11px] text-amber-800 dark:text-amber-300 flex items-start gap-2">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>Configura primero la URL del Worker (arriba) para usar estas funciones.</span>
        </div>
      )}
      {hasUrl && !hasToken && (
        <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-[11px] text-amber-800 dark:text-amber-300 flex items-start gap-2">
          <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>Sin el <b>Token de Acceso (AUTH_TOKEN)</b> el Worker rechazará ambas operaciones con 401 — así protege la nube un dispositivo sin credenciales.</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={doExport} disabled={busy !== '' || !hasUrl}
          className="px-3 py-1.5 bg-white dark:bg-black hover:bg-rose-50 dark:hover:bg-zinc-900 text-rose-900 dark:text-rose-200 rounded-xl text-xs font-bold border border-rose-200 dark:border-rose-900 flex items-center gap-1.5 transition-all disabled:opacity-50">
          {busy === 'export' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          <span>Descargar copia de la nube</span>
        </button>
        <button type="button" onClick={openPanel} disabled={busy !== '' || !hasUrl || !hasToken}
          className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 transition-all disabled:opacity-50"
          title="Requiere token + copia previa + confirmación tipeada">
          <Trash2 className="w-3.5 h-3.5" />
          <span>Purgar datos de la nube…</span>
        </button>
      </div>

      {/* Panel destructivo: copia previa automática + confirmación tipeada */}
      {panelOpen && (
        <div className="p-3 rounded-xl bg-white dark:bg-black border border-rose-200 dark:border-rose-900 space-y-2.5">
          <p className="text-xs font-black text-slate-900 dark:text-white flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4 text-rose-600" />
            Eliminar TODOS los datos de la nube
          </p>

          {busy === 'backup' && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Descargando copia completa de la nube antes de permitir la purga…
            </p>
          )}

          {preBackup && !preBackup.ok && (
            <div className="p-2 rounded-lg bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900 text-[11px] text-rose-800 dark:text-rose-300 space-y-2">
              <span className="flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span><b>La purga queda BLOQUEADA:</b> {preBackup.message}</span>
              </span>
              <button type="button" onClick={runPreBackup} disabled={busy !== ''}
                className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-50">
                <Download className="w-3 h-3" /><span>Reintentar copia</span>
              </button>
            </div>
          )}

          {preBackup?.ok && (
            <>
              <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-900 text-[11px] text-emerald-800 dark:text-emerald-300 flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  Copia previa descargada (<b>INAS_respaldo_nube_antes_de_purgar_…json</b>): {preBackup.counts.students ?? 0} estudiantes,{' '}
                  {preBackup.counts.attendance ?? 0} asistencias, {preBackup.counts.excuses ?? 0} excusas. Con este archivo puedes
                  restaurar el estado actual en cualquier dispositivo.
                </span>
              </div>

              <ul className="text-[11px] text-slate-600 dark:text-slate-400 space-y-0.5">
                <li>• Se eliminan: estudiantes, asistencias, excusas, docentes, cátedras, snapshots, auditoría y suscripciones push (D1) + todas las claves KV.</li>
                <li>• La cadena HMAC de excusas reinicia en GENESIS con la próxima excusa real (igual que la purga manual de la Ronda 27).</li>
                <li>• Cada dispositivo deberá reactivar sus notificaciones.</li>
              </ul>

              <label className="flex items-start gap-2 text-[11px] text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                <input type="checkbox" checked={wipeLocalToo} onChange={(e) => setWipeLocalToo(e.target.checked)}
                  className="mt-0.5 accent-rose-600" />
                <span>
                  <b>También dejar este dispositivo en blanco</b> (recomendado si su contenido es demo). Si NO lo marcas y este
                  dispositivo tiene datos, el auto-sync los volverá a subir a la nube en ≤ {settings.cloudflareSyncIntervalMinutes || 5} min.
                </span>
              </label>

              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">
                  Escribe PURGAR para habilitar la eliminación
                </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="PURGAR"
                  autoComplete="off"
                  className="w-full bg-white dark:bg-black border border-rose-200 dark:border-rose-900 text-slate-900 dark:text-white text-xs px-2.5 py-2 rounded-xl outline-none font-mono"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={doPurge} disabled={!canPurge}
                  className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 transition-all disabled:opacity-40">
                  {busy === 'purge' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  <span>{busy === 'purge' ? 'Purgando…' : 'Sí, eliminar todo de la nube'}</span>
                </button>
                <button type="button" onClick={() => { setPanelOpen(false); setPreBackup(null); }} disabled={busy !== ''}
                  className="px-3 py-1.5 bg-slate-100 dark:bg-zinc-900 hover:bg-slate-200 dark:hover:bg-zinc-800 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold transition-all">
                  Cancelar
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Reporte de purga exitosa */}
      {report && (
        <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 space-y-2">
          <p className="text-xs font-black text-emerald-900 dark:text-emerald-200 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" /> Nube purgada correctamente
          </p>
          <ul className="text-[11px] text-emerald-800 dark:text-emerald-300 space-y-0.5">
            {Object.entries(report.tables).map(([t, n]) => (
              <li key={t}>• {tableLabels[t] || t}: <b>{n}</b> fila(s) eliminada(s)</li>
            ))}
            <li>• Claves KV borradas: <b>{report.kvDeleted.length}</b>{report.kvDeleted.length > 0 && ` (${report.kvDeleted.slice(0, 3).join(', ')}${report.kvDeleted.length > 3 ? '…' : ''})`}</li>
          </ul>
          <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
            {wipeLocalToo
              ? 'Este dispositivo también quedó en blanco. Recargando…'
              : 'Recuerda: si este dispositivo conserva datos, el auto-sync los volverá a subir en el próximo intervalo (usa la casilla de borrado local la próxima vez si lo quieres vacío).'}
          </p>
        </div>
      )}

      {feedback && (
        <div className={`p-2.5 rounded-xl text-xs font-medium border flex items-start gap-2 ${
          feedback.ok
            ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 text-emerald-800 dark:text-emerald-300'
            : 'bg-rose-50 dark:bg-rose-950/60 border-rose-200 text-rose-800 dark:text-rose-300'
        }`}>
          {feedback.ok ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
          <span>{feedback.message}</span>
        </div>
      )}
    </div>
  );
}
