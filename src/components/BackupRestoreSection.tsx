/**
 * ==============================================================================
 * RESPALDO LOCAL — UI de Export / Import (Ronda 27, §3 del documento-produccion).
 * La lógica pura vive en src/services/backupService.ts (testeable sin React).
 *
 *  - Export: 3 botones (configuración / base de datos / ambas) + casilla explícita
 *    de secretos — descarga INAS_respaldo_<label>_<fecha>.json.
 *  - Import: selector → DRY-RUN con resumen → confirmación (doble si el schoolCode
 *    es OTRA institución) → respaldo automático previo → hidratación → push a la
 *    nube → recarga.
 * ==============================================================================
 */
import { useRef, useState } from 'react';
import {
  Download, Upload, FileJson, ShieldAlert, CheckCircle2, AlertTriangle, Loader2
} from 'lucide-react';
import { AttendanceStorageService } from '../services/attendanceStorage';
import { CloudflareSyncService } from '../services/cloudflareSync';
import {
  buildBackup, validateBackup, downloadBackup,
  type BackupScope
} from '../services/backupService';

const scopeLabel = (s: BackupScope) => s === 'BOTH' ? 'Configuración + Base de datos' : s === 'CONFIG' ? 'Solo configuración' : 'Solo base de datos';

export function BackupRestoreSection() {
  const [busy, setBusy] = useState(false);
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  // DRY-RUN del import (doc §3.2): resumen antes de aplicar — jamás aplicar a ciegas.
  const [dryRun, setDryRun] = useState<{ file: any; sameSchool: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const doExport = (scope: BackupScope) => {
    setBusy(true);
    try {
      const file = buildBackup(scope, includeSecrets);
      downloadBackup(file, scope === 'BOTH' ? 'completo' : scope === 'CONFIG' ? 'configuracion' : 'basededatos');
      setFeedback({
        ok: true,
        message: `Respaldo descargado (${scopeLabel(scope)}${includeSecrets ? ' + secretos' : ''}). Guárdalo en un lugar seguro${includeSecrets ? ' — contiene secretos confidenciales.' : '.'}`
      });
    } catch (e: any) {
      setFeedback({ ok: false, message: `Error al exportar: ${e?.message || e}` });
    }
    setBusy(false);
  };

  const onPickFile = async (f: File | null | undefined) => {
    if (!f) return;
    setFeedback(null);
    try {
      const parsed = JSON.parse(await f.text());
      const err = validateBackup(parsed);
      if (err) { setFeedback({ ok: false, message: err }); return; }
      const current = AttendanceStorageService.getSettings();
      setDryRun({ file: parsed, sameSchool: !parsed.schoolCode || parsed.schoolCode === current.schoolCode });
    } catch {
      setFeedback({ ok: false, message: 'No se pudo leer el archivo (JSON inválido).' });
    }
  };

  const applyImport = async () => {
    if (!dryRun) return;
    setBusy(true);
    try {
      const { file } = dryRun;
      // 1) Respaldo automático del estado actual (BOTH + secretos): permite restaurar
      //    este dispositivo a este instante aunque el import salga mal.
      downloadBackup(buildBackup('BOTH', true), 'auto_antes_de_importar');

      // 2) Hidratación de localStorage por colección (atomicidad por colección).
      const { applyBackup } = await import('../services/backupService');
      applyBackup(file);

      // 3) Push a la nube (el worker acepta snapshot completo — mecanismo de sync verificado).
      const sync = await CloudflareSyncService.performCloudflareSync();

      setBusy(false);
      setDryRun(null);
      setFeedback({
        ok: true,
        message: `Importado. ${sync.success ? 'Nube sincronizada con el estado nuevo.' : `Import local OK pero la nube NO se actualizó (${sync.message}) — pulsa "Sincronizar (Push)" cuando haya conexión.`} Recargando…`
      });
      setTimeout(() => location.reload(), 1800);
    } catch (e: any) {
      setBusy(false);
      setDryRun(null);
      setFeedback({ ok: false, message: `Error durante la importación: ${e?.message || e}. Usa el respaldo automático descargado para restaurar.` });
    }
  };

  const c = dryRun?.file?.counts || {};

  return (
    <div className="p-4 rounded-2xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/60 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-black text-amber-950 dark:text-amber-200">
          <FileJson className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          <span>Respaldo Local (Exportar / Importar)</span>
        </div>
      </div>
      <p className="text-[11px] text-amber-800 dark:text-amber-300">
        Descarga un archivo JSON con la configuración, la base de datos o ambas, y restáuralo en este u otro dispositivo (traslado o copia offline). Importar <b>REEMPLAZA</b> los datos actuales — siempre se descarga un respaldo automático antes de aplicar.
      </p>

      {/* Checkbox de secretos (doc §3.1: NUNCA por defecto) */}
      <label className="flex items-start gap-2 text-[11px] text-amber-900 dark:text-amber-300 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={includeSecrets}
          onChange={(e) => setIncludeSecrets(e.target.checked)}
          className="mt-0.5 accent-amber-600"
        />
        <span><b>Incluir secretos</b> (QR de carnés, token del Worker). El archivo quedará confidencial — no lo compartas. Sin esto, un respaldo de configuración no restaura la validez de los QR impresos.</span>
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => doExport('CONFIG')} disabled={busy}
          className="px-3 py-1.5 bg-white dark:bg-black hover:bg-amber-50 dark:hover:bg-zinc-900 text-amber-900 dark:text-amber-200 rounded-xl text-xs font-bold border border-amber-200 dark:border-amber-900 flex items-center gap-1.5 transition-all disabled:opacity-50">
          <Download className="w-3.5 h-3.5" /><span>Exportar configuración</span>
        </button>
        <button type="button" onClick={() => doExport('DATA')} disabled={busy}
          className="px-3 py-1.5 bg-white dark:bg-black hover:bg-amber-50 dark:hover:bg-zinc-900 text-amber-900 dark:text-amber-200 rounded-xl text-xs font-bold border border-amber-200 dark:border-amber-900 flex items-center gap-1.5 transition-all disabled:opacity-50">
          <Download className="w-3.5 h-3.5" /><span>Exportar base de datos</span>
        </button>
        <button type="button" onClick={() => doExport('BOTH')} disabled={busy}
          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 transition-all disabled:opacity-50">
          <Download className="w-3.5 h-3.5" /><span>Exportar ambas</span>
        </button>
        <button type="button" onClick={() => { setFeedback(null); fileRef.current?.click(); }} disabled={busy}
          className="px-3 py-1.5 bg-slate-800 dark:bg-white hover:bg-slate-700 dark:hover:bg-zinc-200 text-white dark:text-black rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 transition-all disabled:opacity-50">
          <Upload className="w-3.5 h-3.5" /><span>Importar respaldo…</span>
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden"
          onChange={(e) => { onPickFile(e.target.files?.[0]); e.currentTarget.value = ''; }} />
      </div>

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

      {/* DRY-RUN (doc §3.2): resumen + doble confirmación si el schoolCode cambia de identidad */}
      {dryRun && (
        <div className="p-3 rounded-xl bg-white dark:bg-black border border-slate-200 dark:border-zinc-800 space-y-2.5">
          <p className="text-xs font-black text-slate-900 dark:text-white">Resumen del respaldo a importar</p>
          <ul className="text-[11px] text-slate-600 dark:text-slate-400 space-y-0.5">
            <li>• Alcance: <b>{scopeLabel(dryRun.file.scope as BackupScope)}</b>{dryRun.file.includesSecrets ? ' (+ secretos)' : ''}</li>
            {dryRun.file.scope !== 'CONFIG' && (
              <li>• Contiene: <b>{c.students ?? 0}</b> estudiantes, <b>{c.teachers ?? 0}</b> docentes, <b>{c.assignments ?? 0}</b> cátedras, <b>{c.attendance ?? 0}</b> asistencias, <b>{c.excuses ?? 0}</b> excusas</li>
            )}
            <li>• Institución de origen: <b>{dryRun.file.schoolCode || '(sin código)'}</b> · exportado: {String(dryRun.file.exportedAt || '').slice(0, 10)}</li>
          </ul>

          {!dryRun.sameSchool && (
            <div className="p-2 rounded-lg bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900 text-[11px] text-rose-800 dark:text-rose-300 flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <span><b>Este respaldo es de OTRA institución ({dryRun.file.schoolCode}).</b> Importar cambiará la identidad del colegio en este dispositivo y pisará la nube con ese código. Verifica dos veces.</span>
            </div>
          )}

          <p className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
            Importar va a <b>REEMPLAZAR</b> los datos actuales de este dispositivo y de la nube (D1). Se descargará un respaldo automático antes de aplicar.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={applyImport} disabled={busy}
              className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 transition-all disabled:opacity-50">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AlertTriangle className="w-3.5 h-3.5" />}
              <span>{busy ? 'Importando…' : dryRun.sameSchool ? 'Sí, importar y reemplazar' : 'Entiendo — importar de todas formas'}</span>
            </button>
            <button type="button" onClick={() => setDryRun(null)} disabled={busy}
              className="px-3 py-1.5 bg-slate-100 dark:bg-zinc-900 hover:bg-slate-200 dark:hover:bg-zinc-800 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold transition-all">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
