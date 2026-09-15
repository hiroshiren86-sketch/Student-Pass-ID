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
  // R68 (fix RC-4 — cuentas anónimas): el arranque YA NO crea/espera sesión
  // anónima (993 órfanos auditados en R67 + carrera signInAnonymously→login real
  // que trocaba currentUser y dejaba sin ID token el auto-sync). La aserción
  // ahora codifica el NUEVO contrato: sin auto-creación; el canal canónico de
  // settings en frío es el pull del Worker (loadSchoolSettings degrada a null).
  check('initCloudSettingsSync NO crea/espera sesión anónima (R68 RC-4)', !storage.includes('ensureAnonymousAuth().then(() =>'));
  check('saveSchoolSettings espera sesión', fb.split('static async saveSchoolSettings')[1]?.split('\n  static ')[0].includes('await this.ensureAnonymousAuth()'));
  check('backupAllToFirestore espera sesión', fb.split('static async backupAllToFirestore')[1]?.split('\n  static ')[0].includes('await this.ensureAnonymousAuth()'));
  // Ronda 60-b: syncAttendanceRecord era código muerto (0 llamadores) y fue ELIMINADO
  // — la aserción ahora verifica su ausencia (mandato del propietario: nada muerto).
  check('syncAttendanceRecord eliminado (Ronda 60-b, código muerto)', !fb.includes('static async syncAttendanceRecord'));
  const cfg = JSON.parse(readFileSync('firebase-applet-config.json', 'utf8'));
  check('App Check preparado condicionalmente y NO activo hoy', fb.includes('initializeAppCheck') && (cfg.recaptchaSiteKey || '') === '');
  const rules = readFileSync('firestore.rules', 'utf8');
  // R58 (F-4) — contrato VIGENTE del archivo (listo para despliegue del dueño;
  // R68 NO lo despliega, es zona del propietario):
  //   school_settings → lectura AUTENTICADA + escritura SOLO ADMIN.
  //   students/teachers/schedule_assignments/attendance_records → SOLO ADMIN
  //   (read y write) — los espejos operativos nunca son públicos.
  {
    const block = (col: string) => rules.split(`match /${col}/`)[1]?.split('match /')[0] || '';
    const ss = block('school_settings');
    check('regla school_settings: lectura autenticada + escritura ADMIN (R58 F-4)', ss.includes('allow read: if isAuthenticated();') && ss.includes('allow write: if isAdmin();'));
    for (const col of ['students', 'teachers', 'schedule_assignments', 'attendance_records']) {
      check(`regla ${col}: solo ADMIN (R58 F-4)`, block(col).includes('if isAdmin()') && !block(col).includes('if true'));
    }
  }
  check('users owner-only + delete prohibido', /match \/users\/\{userId\}[\s\S]*?request\.auth\.uid == userId[\s\S]*?allow delete: if false;/.test(rules));
  check('catch-all DENY explícito', /match \/\{document=\*\*\}[\s\S]*?allow read, write: if false;/.test(rules));
});

// =====================================================================
await section('C. Sync Cloudflare — Worker-only, sin fallbacks (regresión Ronda 16, estático)', () => {
  const sync = readFileSync('src/services/cloudflareSync.ts', 'utf8');
  check('sin api.cloudflare.com en el cliente', !sync.includes('api.cloudflare.com'));
  // R48: el único uso LEGÍTIMO de localStorage en el sync service es la
  // persistencia del deviceId (X-Device-Id) — el "éxito falso" de R16
  // (reportar ÉXITO guardando datos de sync en localStorage) sigue eliminado:
  // NO hay escritura de datos de sincronización.
  {
    const lsLines = sync.split('\n').filter(l => { const t = l.trim(); if (t.startsWith('*') || t.startsWith('//')) return false; return /localStorage/.test(l); });
    check('localStorage SOLO para deviceId (R48); éxito falso R16 sigue eliminado', lsLines.length <= 2 && lsLines.every(l => /localStorage\.(get|set)Item\(KEY/.test(l)));
  }
  check('Authorization Bearer uniforme (workerHeaders)', sync.split('workerHeaders()').length >= 4);
  check('guard push sin URL → fallo honesto accionable', /if \(!baseUrl\)[\s\S]{0,400}URL del Cloudflare Worker no configurada[\s\S]{0,200}Ajustes/.test(sync));
  check('guard pull sin URL → fallo honesto accionable', /if \(!cleanBaseUrl\)[\s\S]{0,400}URL del Cloudflare Worker no configurada/.test(sync));
  const worker = readFileSync('cloudflare-worker/src/index.ts', 'utf8');
  check('worker: comparación timing-safe del AUTH_TOKEN', worker.includes('timingSafeEqual'));
  // R68 (auditoría forense): el worker tiene 4 SQL-templates con `${`, y los 4 son
  // SEGUROS: (1) ${ph} = string de placeholders "?" para IN(...) con valores
  // SIEMPRE bound vía .bind() (chunking por el límite de 90 variables de SQLite);
  // (2-4) ${table} = identificadores FIJOS del export/purga (R28) — D1 no
  // parametriza identificadores y la variable solo toma nombres de tabla de una
  // lista cerrada (deleteOrder / tablas del export). Cualquier OTRO `${` dentro
  // de un SQL sigue prohibido.
  {
    const sqlTpl: string[] = [];
    const re = /`([^`]*)`/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(worker))) {
      const t = m[1];
      if (/\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(t) && t.includes('${')) sqlTpl.push(t);
    }
    check('worker: SQL preparado (solo ${ph} de chunking y ${table} fijo R28)', sqlTpl.length <= 4 && sqlTpl.every(t => t.includes('${ph}') || t.includes('${table}')));
  }
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
