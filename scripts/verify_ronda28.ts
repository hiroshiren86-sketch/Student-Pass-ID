/**
 * Ronda 28 — Suite "Purga de la Nube + Respaldo desde la Nube" (determinista, sin red).
 * Ejecutar: bun scripts/verify_ronda28.ts   (o npx tsx scripts/verify_ronda28.ts)
 *
 * Valida la lógica pura nueva de Ronda 28:
 *   (a) buildBackupFromCloudExport — convierte el volcado completo del Worker
 *       (GET /api/sync/export) en INAS_BACKUP v1: prefiere el snapshot KV (objetos
 *       frontend fieles) y hace fallback a filas D1 snake_case normalizadas;
 *       las excusas SIEMPRE se normalizan desde D1 (normalizeExcuse).
 *   (b) buildEmptyWipeBackup + applyBackup — el borrado local deja TODAS las
 *       colecciones vacías ([] persistido explícito, anti-seed R27), conserva la
 *       estructura de jornada (slots) y NO toca settings (Worker URL/token).
 *   (c) validateBackup acepta el respaldo de origen 'cloud' (compatibilidad del formato).
 */
(() => {
  if (typeof globalThis.localStorage === 'undefined') {
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => void store.clear(),
      get length() { return store.size; },
      key: (i: number) => Array.from(store.keys())[i] ?? null
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

import {
  buildBackupFromCloudExport, buildEmptyWipeBackup, applyBackup, validateBackup, BACKUP_FORMAT
} from '../src/services/backupService';
import { AttendanceStorageService } from '../src/services/attendanceStorage';
import { DEFAULT_SCHEDULE_SLOTS } from '../src/services/mockData';

let passed = 0, failed = 0;
const failures: string[] = [];
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const section = (t: string) => console.log(`\n=== ${t} ===`);

// ----------------------------------------------------------------------------
// Fixtures — volcado del Worker tal como lo devuelve GET /api/sync/export
// ----------------------------------------------------------------------------
const D1_STUDENT_ROW = {
  code: '1000000001',
  document_id: '1000000001',
  document_type: 'TI',
  first_name: 'María',
  last_name: 'Pérez',
  grade: '6°1',
  photo_url: null,
  guardian_name: null,
  guardian_phone: null,
  status: 'ACTIVO',
  created_at: '2026-09-04 10:00:00'
};

const D1_RECORD_ROW = {
  id: '1000000001_2026-09-04_06:30',
  student_code: '1000000001',
  student_name: 'María Pérez',
  document_id: '1000000001',
  grade: '6°1',
  date: '2026-09-04',
  time: '06:31:00',
  status: 'TARDANZA',
  method: 'QR_CAMERA',
  verified_hmac: 1,
  scanned_by: 'DOCENTE',
  scanned_by_name: 'Laura Gómez',
  subject: 'Matemáticas',
  slot_id: 'slot-1',
  notes: null,
  excuse_id: 'exc-1',
  created_at: '2026-09-04 06:31:05'
};

const D1_EXCUSE_ROW = {
  id: 'exc-1',
  student_code: '1000000001',
  student_name: 'María Pérez',
  grade: '6°1',
  start_date: '2026-09-04',
  end_date: '2026-09-05',
  reason: 'CITA_MEDICA',
  notes: 'Control médico',
  status: 'PENDIENTE',
  submitted_by: 'PORTAL_ESTUDIANTE',
  source_attendance_id: null,
  attachment_path: null,
  reviewed_by: null,
  reviewed_at: null,
  reject_reason: null,
  auto_approved: 0,
  audit_hash: 'abc123',
  created_at: '2026-09-04 09:00:00'
};

const D1_SLOT_ROW = {
  id: 'slot-1',
  name: '1ª Hora',
  start_time: '06:30',
  end_time: '07:25',
  type: 'CLASS',
  order_index: 1
};

const KV_SNAPSHOT = {
  syncedAt: '2026-09-05T01:00:00.000Z',
  data: {
    settings: { schoolName: 'I.E. Antonia Santos', schoolCode: 'INAS-ANTONIA-SANTOS-2026' },
    students: [{ code: 'K1', documentId: 'K1', documentType: 'TI', firstName: 'KV', lastName: 'Fuente', grade: '7°2', section: '2', active: true, createdAt: '2026-09-01T00:00:00Z' }],
    teachers: [{ id: 't1', name: 'Docente KV' }],
    records: [{ id: 'r1', studentCode: 'K1', studentDocument: 'K1', studentName: 'KV Fuente', studentGrade: '7°2', studentSection: '2', slotId: 'slot-1', slotName: '1ª Hora', subject: 'Lengua', teacherName: 'D', timestamp: '2026-09-04T06:30:00Z', date: '2026-09-04', time: '06:30:00', type: 'CLASE', status: 'PUNTUAL', method: 'CAMERA', scannedBy: 'DOCENTE', verifiedHmac: true, synced: true }],
    assignments: [{ id: 'a1' }],
    slots: [{ id: 'slot-kv', order: 1, type: 'CLASS', name: 'KV Hora', startTime: '06:30', endTime: '07:25', durationMinutes: 55 }],
    customTemplates: [],
    studentSchedules: {}
  }
};

const exportMixed = { // KV + D1 coexisten (caso real tras cualquier push)
  students: [D1_STUDENT_ROW],
  teachers: [],
  assignments: [],
  slots: [D1_SLOT_ROW],
  records: [D1_RECORD_ROW],
  excuses: [D1_EXCUSE_ROW],
  kvSnapshot: KV_SNAPSHOT
};

const exportSoloD1 = { // KV vacía (post-purga con D1 residual) — fallback total
  students: [D1_STUDENT_ROW],
  teachers: [],
  assignments: [],
  slots: [D1_SLOT_ROW],
  records: [D1_RECORD_ROW],
  excuses: [D1_EXCUSE_ROW],
  kvSnapshot: null
};

// ----------------------------------------------------------------------------
section('(a) buildBackupFromCloudExport — KV preferida, D1 fallback, excusas D1');
const file = buildBackupFromCloudExport(exportMixed, 'INAS-ANTONIA-SANTOS-2026');

ok('formato INAS_BACKUP v1 scope DATA', file.format === BACKUP_FORMAT && file.version === 1 && file.scope === 'DATA');
ok('source marcado como cloud', file.source === 'cloud');
ok('students: gana snapshot KV (1, objeto fiel)', file.counts.students === 1 && (file.data?.students[0] as any).firstName === 'KV');
ok('records: gana snapshot KV', file.counts.attendance === 1 && (file.data?.attendance[0] as any).id === 'r1');
ok('slots: gana snapshot KV', file.counts.slots === 1 && (file.data?.slots[0] as any).id === 'slot-kv');
ok('excuses: SIEMPRE de D1 (1 excusa)', file.counts.excuses === 1 && (file.data?.excuses[0] as any).studentCode === '1000000001');
ok('excusa normalizada camelCase (fechas/nombre)', (file.data?.excuses[0] as any).startDate === '2026-09-04' && (file.data?.excuses[0] as any).studentName === 'María Pérez');
ok('sin config ni secretos (la nube nunca los guarda)', !file.config && file.includesSecrets === false);

const fileD1 = buildBackupFromCloudExport(exportSoloD1, 'INAS-ANTONIA-SANTOS-2026');
const st = fileD1.data?.students[0] as any;
ok('fallback D1: estudiante snake_case → camelCase', st.code === '1000000001' && st.firstName === 'María' && st.lastName === 'Pérez' && st.documentType === 'TI');
ok('fallback D1: sección derivada del grado "6°1" → "1"', st.section === '1' && st.active === true);
const rec = fileD1.data?.attendance[0] as any;
ok('fallback D1: registro mapeado (hmac bool, overlay preservado)', rec.studentCode === '1000000001' && rec.verifiedHmac === true && rec.excuseId === 'exc-1' && rec.scannedByName === 'Laura Gómez');
ok('fallback D1: timestamp sintetizado date+time', rec.timestamp === '2026-09-04T06:31:00');
const slot = fileD1.data?.slots[0] as any;
ok('fallback D1: slot con orden/duración derivada (55 min)', slot.order === 1 && slot.durationMinutes === 55 && slot.startTime === '06:30' && slot.endTime === '07:25');
ok('validateBackup acepta el archivo de origen cloud', validateBackup(JSON.parse(JSON.stringify(fileD1))) === null);

// ----------------------------------------------------------------------------
section('(b) buildEmptyWipeBackup + applyBackup — borrado local anti-seed');
// Estado local con contenido: 1 estudiante + 1 asistencia + cache de excusas
AttendanceStorageService.saveStudents([{
  code: 'X1', documentId: 'X1', firstName: 'Local', lastName: 'Demo', grade: '8°1', section: '1', active: true, createdAt: new Date().toISOString()
} as any]);
AttendanceStorageService.saveAttendance([{
  id: 'lr1', studentCode: 'X1', studentDocument: 'X1', studentName: 'Local Demo', studentGrade: '8°1', studentSection: '1',
  slotId: 'slot-1', slotName: '1ª Hora', subject: 'M', teacherName: 'T', timestamp: new Date().toISOString(),
  date: '2026-09-04', time: '06:30:00', type: 'CLASE', status: 'PUNTUAL', method: 'CAMERA', scannedBy: 'DOCENTE', verifiedHmac: false, synced: false
} as any]);
localStorage.setItem('inas_excuses_cache_v1', JSON.stringify([D1_EXCUSE_ROW]));

const wipe = buildEmptyWipeBackup('INAS-ANTONIA-SANTOS-2026');
ok('wipe: DATA con todas las colecciones vacías', wipe.scope === 'DATA' && wipe.data?.students.length === 0 && wipe.data?.attendance.length === 0 && wipe.data?.excuses.length === 0);
const applied = applyBackup(wipe);
ok('applyBackup aplicó la base de datos', applied.applied.includes('base de datos'));
ok('estudiantes locales → [] persistido', AttendanceStorageService.getStudents().length === 0);
ok('asistencias locales → [] persistido', AttendanceStorageService.getAllAttendance().length === 0);
ok('cache de excusas → []', JSON.parse(localStorage.getItem('inas_excuses_cache_v1') || '[]').length === 0);
ok('slots de jornada PRESERVADOS (no vaciados por el wipe)', AttendanceStorageService.getScheduleSlots().length === DEFAULT_SCHEDULE_SLOTS.length);
const s2 = AttendanceStorageService.getSettings();
ok('settings intactos (Worker URL/token/jornada se conservan)', !!s2.schoolCode && typeof s2.cloudflareWorkerUrl === 'string');

console.log(`\n========================================`);
console.log(`Ronda 28 — ${passed} PASS, ${failed} FAIL`);
if (failed > 0) { console.log('FALLOS:\n - ' + failures.join('\n - ')); process.exit(1); }
console.log('SUITE COMPLETA: OK');
