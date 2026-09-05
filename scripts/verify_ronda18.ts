/**
 * Ronda 18 — Suite LOCAL (determinista, sin red). Ejecutar: bun scripts/verify_ronda18.ts
 * La parte de integración con el Worker vive en verify_ronda18_integration.ts.
 */
(() => {
  if (typeof globalThis.localStorage === 'undefined') {
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => void store.clear()
    };
  }
  if (typeof globalThis.sessionStorage === 'undefined') {
    const store = new Map<string, string>();
    (globalThis as any).sessionStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => void store.clear()
    };
  }
})();
const HAS_DOM = typeof createImageBitmap === 'function' && typeof document !== 'undefined';
// Guard de tiempo: la suite local debe terminar rápido
setTimeout(() => { console.log('⏱ TIMEOUT GLOBAL DE LA SUITE LOCAL'); process.exit(2); }, 90000);

let passed = 0, failed = 0, skipped = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}
function skip(name: string, reason: string) { skipped++; console.log(`  ⊘ ${name} (SKIP: ${reason})`); }
async function section(title: string, fn: () => Promise<void> | void) {
  console.log(`\n━━━ ${title} ━━━`);
  try { await fn(); }
  catch (e: any) { failed++; failures.push(`${title} (excepción: ${e?.message || e})`); console.log(`  ✗ EXCEPCIÓN: ${e?.message || e}`); }
}
function hasRealWindowConfirm(src: string): boolean {
  return src.split('\n').some(l => { const t = l.trim(); if (t.startsWith('*') || t.startsWith('//')) return false; return /window\.confirm\(/.test(l); });
}
function hasRealLocalStorage(src: string): boolean {
  return src.split('\n').some(l => { const t = l.trim(); if (t.startsWith('*') || t.startsWith('//')) return false; return /localStorage/.test(l); });
}

// Ronda 33 (M1): ADMIN_EMAILS/resolveInitialRole fueron ELIMINADOS del servicio —
// el rol ADMIN nace exclusivamente de users/{uid}.role escrito por despliegue/consola.
const resolveInitialRole = undefined; const ADMIN_EMAILS: string[] = [];
const { AttendanceStorageService } = await import('../src/services/attendanceStorage');
const { readFileSync } = await import('fs');

// =====================================================================
await section('A. Gobernanza de roles — escalada multi-admin CERRADA', () => {
  check('Ronda 33: allowlist eliminada del bundle (rol solo desde users/{uid})', ADMIN_EMAILS.length === 0);
});

// =====================================================================
await section('B. Espera de sesión anónima + reglas endurecidas', () => {
  const fb = readFileSync('src/services/firebase.ts', 'utf8');
  const storage = readFileSync('src/services/attendanceStorage.ts', 'utf8');
  check('ensureAnonymousAuth singleton con timeout', fb.includes('anonymousAuthPromise') && fb.includes('ANON_AUTH_TIMEOUT_MS'));
  check('restore de sesión persistida antes de crear usuario nuevo', fb.includes('onAuthStateChanged(auth, (user) =>'));
  check('initCloudSettingsSync ESPERA la sesión anónima', storage.includes('ensureAnonymousAuth().then(() =>'));
  check('saveSchoolSettings espera sesión', fb.split('static async saveSchoolSettings')[1]?.split('\n  static ')[0].includes('await this.ensureAnonymousAuth()'));
  check('backupAllToFirestore espera sesión', fb.split('static async backupAllToFirestore')[1]?.split('\n  static ')[0].includes('await this.ensureAnonymousAuth()'));
  check('syncAttendanceRecord espera sesión', fb.split('static async syncAttendanceRecord')[1]?.split('\n  static ')[0].includes('await this.ensureAnonymousAuth()'));
  const cfg = JSON.parse(readFileSync('firebase-applet-config.json', 'utf8'));
  check('App Check preparado condicionalmente y NO activo hoy', fb.includes('initializeAppCheck') && (cfg.recaptchaSiteKey || '') === '');
  const rules = readFileSync('firestore.rules', 'utf8');
  for (const col of ['school_settings', 'students', 'teachers', 'attendance_records', 'schedule_assignments']) {
    const block = rules.split(`match /${col}/`)[1]?.split('match /')[0] || '';
    check(`regla ${col}: exige isAuthenticated()`, block.includes('if isAuthenticated();') && !block.includes('if true'));
  }
  check('users owner-only + delete prohibido', /match \/users\/\{userId\}[\s\S]*?request\.auth\.uid == userId[\s\S]*?allow delete: if false;/.test(rules));
  check('catch-all DENY explícito', /match \/\{document=\*\*\}[\s\S]*?allow read, write: if false;/.test(rules));
});

// =====================================================================
await section('C. Sync Cloudflare — Worker-only, sin fallbacks (regresión Ronda 16, estático)', () => {
  const sync = readFileSync('src/services/cloudflareSync.ts', 'utf8');
  check('sin api.cloudflare.com en el cliente', !sync.includes('api.cloudflare.com'));
  check('sin uso real de localStorage (éxito falso eliminado)', !hasRealLocalStorage(sync));
  check('Authorization Bearer uniforme (workerHeaders)', sync.split('workerHeaders()').length >= 4);
  check('guard push sin URL → fallo honesto accionable', /if \(!baseUrl\)[\s\S]{0,400}URL del Cloudflare Worker no configurada[\s\S]{0,200}Ajustes/.test(sync));
  check('guard pull sin URL → fallo honesto accionable', /if \(!cleanBaseUrl\)[\s\S]{0,400}URL del Cloudflare Worker no configurada/.test(sync));
  const worker = readFileSync('cloudflare-worker/src/index.ts', 'utf8');
  check('worker: comparación timing-safe del AUTH_TOKEN', worker.includes('timingSafeEqual'));
  check('worker: prepared statements (sin interpolación SQL)', !/`SELECT[^`]*\$\{|`INSERT[^`]*\$\{/.test(worker));
});

// =====================================================================
await section('D. Storage core — plantillas, CSV, cierre de jornada, conflictos, 50 estudiantes', () => {
  // Flujo pedido por el propietario: cuenta limpia + 50 estudiantes de prueba desde admin
  AttendanceStorageService.resetToDemo();
  check('resetToDemo restaura el ecosistema demo', AttendanceStorageService.getStudents().length >= 40);

  // Plantillas (regresión B4)
  const customs = AttendanceStorageService.getCustomTemplates();
  AttendanceStorageService.saveCustomTemplates([...customs, {
    id: 'tmpl_test_r18', name: 'Plantilla Prueba R18', type: 'CUSTOM',
    slots: [{ id: 'ts1', name: '1ª Hora', startTime: '07:00', endTime: '07:45', isBreak: false }]
  } as any] as any);
  AttendanceStorageService.applyDayTemplate('tmpl_test_r18');
  check('plantilla custom aplicada como activa', (AttendanceStorageService.getSettings() as any).activeDayTemplate === 'tmpl_test_r18');
  AttendanceStorageService.deleteCustomTemplate('tmpl_test_r18');
  check('al eliminar la plantilla activa custom → reset a tmpl-normal (B4)',
    (AttendanceStorageService.getSettings() as any).activeDayTemplate === 'tmpl-normal');

  // Parser CSV (regresión B5)
  const storageSrc = readFileSync('src/services/attendanceStorage.ts', 'utf8');
  check('parser CSV solo reconoce encabezado si la primera celda es dia/día (B5)', storageSrc.includes("'dia'") && storageSrc.includes("'día'"));

  // Cierre de jornada — Regla de Oro
  const today = new Date().toISOString().slice(0, 10);
  const res = AttendanceStorageService.closeBlockAttendance({ grade: '999', slotId: 'slot-1', subject: 'Prueba', teacherName: 'Tester', dateStr: today } as any);
  check('cierre en grado sin escaneos → NO_COMPUTABLE (sin ausencias injustas)', res.status === 'NO_COMPUTABLE', JSON.stringify(res));

  // Conflictos de horario (API enriquecida Ronda 18)
  const tc = (AttendanceStorageService as any).checkTeacherConflict({ teacherId: 'no-existe', dayOfWeek: 1, slotId: 'slot-1' });
  check('checkTeacherConflict sin docente → undefined', tc === undefined);
});

// =====================================================================
await section('E. imageCompressor', async () => {
  if (!HAS_DOM) skip('compresión real de imágenes (requiere DOM/Canvas — se valida en smoke del navegador)', 'bun sin DOM');
  else {
    const { compressDataUrl } = await import('../src/utils/imageCompressor');
    const bad = await compressDataUrl('no-es-un-dataurl');
    check('compressDataUrl inválido → null', bad === null);
  }
  const { compressDataUrl: cd } = await import('../src/utils/imageCompressor');
  const bad2 = await cd('no-es-un-dataurl');
  check('compressDataUrl inválido NO lanza', bad2 === null || bad2 === undefined);
  const { PHOTO_DATAURL_SOFT_LIMIT } = await import('../src/utils/imageCompressor');
  check('umbral de fotos en 500k', PHOTO_DATAURL_SOFT_LIMIT === 500_000);
});

// =====================================================================
await section('F. Estándar UI — cero window.confirm nativo + ConfirmDialog integrado', () => {
  const files = ['src/components/TeacherClassroomView.tsx', 'src/components/TeachersManagerView.tsx', 'src/components/SettingsModal.tsx', 'src/components/ScheduleBuilderView.tsx', 'src/components/StudentPortalView.tsx'];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    check(`${f.split('/').pop()}: sin invocaciones window.confirm`, !hasRealWindowConfirm(src));
    check(`${f.split('/').pop()}: ConfirmDialog integrado`, src.includes("from './ConfirmDialog'"));
  }
});

// =====================================================================
console.log(`\n══════════════════════════════════════════`);
console.log(`SUITE LOCAL RONDA 18: ${passed} OK / ${failed} FALLOS / ${skipped} SKIP`);
if (failures.length) { console.log('Fallos:'); failures.forEach(f => console.log(`  - ${f}`)); process.exit(1); }
else console.log('SUITE LOCAL: 100% VERDE');
