/**
 * R70 — ¿EL ESTUDIANTE VE LA ASISTENCIA QUE REGISTRA EL DOCENTE? (simulación de 2 dispositivos)
 * ---------------------------------------------------------------------------------------------
 * Pregunta del propietario: “si un docente escanea su asistencia, ¿el estudiante lo verá en su
 * perfil automáticamente?”. Este ensayo responde con el CÓDIGO REAL del cliente y con la función
 * REAL `filterSnapshotByRole` del Worker, sobre una nube simulada (stub) que respeta el contrato
 * de los dos canales:
 *
 *   · `POST /api/attendance`  → escribe SOLO en la tabla D1 `attendance_records` (no en el snapshot)
 *   · `POST /api/sync/push`   → fusiona los hechos locales EN EL SNAPSHOT (lo que se reparte)
 *   · `GET  /api/sync/pull`   → sirve el SNAPSHOT ya filtrado por rol (solo sus propios hechos)
 *
 * Lo que demuestra:
 *   F1. El escaneo del docente llega a D1 por el outbox, pero NO al snapshot → el teléfono del
 *       estudiante, aunque haga pull, todavía NO lo ve.
 *   F2. El pull del estudiante trae SOLO sus propios registros (privacidad) y sus ajustes sin
 *       `qrSecret`, y CONSERVA lo que el estudiante tenga local (unión por id, no reemplazo).
 *   F3. Cuando el dispositivo del docente publica un snapshot (push de operador), el hecho entra
 *       al snapshot; recién entonces el pull del estudiante lo muestra.
 *
 * Ejecutar: TZ=America/Bogota npx tsx tests/unit/r70_flujo_docente_estudiante.ts
 */
import '../harness/domEnv';
import { resetBrowserStorage } from '../harness/domEnv';
import { buildProductionStudents } from '../harness/fixtures';
import fs from 'node:fs';
import path from 'node:path';
import { filterSnapshotByRole } from '../../cloudflare-worker/src/authz';
import { FirebaseService } from '../../src/services/firebase';

let passed = 0, failed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}
function section(t: string) { console.log(`\n━━━ ${t} ━━━`); }
const log: string[] = [];
const L = (s = '') => log.push(s);

const WORKER_URL = 'https://worker.inas.test';
const OPERATOR_TOKEN = 'op-token-de-prueba';

const { AttendanceStorageService } = await import('../../src/services/attendanceStorage');
const { CloudflareSyncService } = await import('../../src/services/cloudflareSync');

// ── Nube simulada (stub fiel al CONTRATO del Worker, no a su implementación completa) ──
const cloud: { snapshot: any; d1: Map<string, any>; catalogVersion: number } = {
  snapshot: null,
  d1: new Map(),
  catalogVersion: 7,
};
const calls: string[] = [];
let device = ''; // dispositivo activo (para la identidad simulada del estudiante)

const studentsAll = buildProductionStudents().map(s => ({ ...s, photoUrl: undefined }));
const student = studentsAll.find(s => String(s.grade).includes('6') && s.section) || studentsAll[0];
const classmate = studentsAll.find(s => s.code !== student.code && s.grade === student.grade)!;

cloud.snapshot = {
  settings: { schoolName: 'INAS', schoolCode: 'INAS_2026', qrSecret: 'SECRETO-INSTITUCIONAL', dailyStartTime: '06:30' },
  students: studentsAll,
  teachers: [],
  records: [],
  tombstones: [],
};

(globalThis as any).fetch = async (input: any, init: any = {}) => {
  const url = typeof input === 'string' ? input : String(input?.url ?? '');
  const method = (init?.method || 'GET').toUpperCase();
  const headers: any = init?.headers || {};
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  calls.push(`${method} ${url}`);
  const token = String(headers['Authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  const json = (obj: any) => ({ ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) });

  if (url.endsWith('/api/attendance') && method === 'POST') {
    cloud.d1.set(body.id, body);
    return json({ success: true, id: body.id });
  }
  if (url.endsWith('/api/sync/push') && method === 'POST') {
    const incoming = Array.isArray(body?.data?.records) ? body.data.records : [];
    if (token === OPERATOR_TOKEN) {
      // Camino OPERADOR: fusiona hechos, conserva el catálogo vigente (igual que el Worker real).
      const byId = new Map(cloud.snapshot.records.map((r: any) => [r.id, r]));
      for (const r of incoming) byId.set(r.id, { ...r, serverUpdatedAt: new Date().toISOString() });
      cloud.snapshot = { ...cloud.snapshot, records: Array.from(byId.values()) };
      return json({ success: true, catalogVersion: cloud.catalogVersion, catalogWritten: false, recordsMerged: incoming.length });
    }
    // Camino ADMIN (no se ejercita en este ensayo salvo que el token sea admin): reemplaza catálogo.
    cloud.snapshot = { ...body.data, records: incoming };
    cloud.catalogVersion++;
    return json({ success: true, catalogVersion: cloud.catalogVersion, catalogWritten: true });
  }
  if (url.includes('/api/sync/pull') && method === 'GET') {
    // Identidad simulada: el dispositivo del estudiante manda su ID token de Firebase (se parchea
    // `getCurrentIdToken` más abajo); el del docente no manda identidad y usa su token de operador.
    const authz = headers['X-Firebase-Id-Token']
      ? { source: 'identity', role: 'ESTUDIANTE_ACUDIENTE', linkedStudentCode: student.code, canWriteCatalog: false }
      : { source: 'token', role: 'OPERATOR', canWriteCatalog: false };
    // FILTRO REAL DEL WORKER (no una copia):
    const data = filterSnapshotByRole(cloud.snapshot, authz as any);
    return json({ success: true, source: 'STUB', syncedAt: new Date().toISOString(), catalogVersion: cloud.catalogVersion, data });
  }
  throw new Error(`stub sin ruta: ${method} ${url}`);
};

// El estudiante real entra con su cuenta Firebase (LoginScreen); aquí se simula por dispositivo.
(FirebaseService as any).getCurrentIdToken = async () => (device === 'estudiante' ? 'stub-id-token-estudiante' : null);

// ── Dos “teléfonos”: cada uno con su propio localStorage (se guarda/restaura al cambiar) ──
const devices = new Map<string, Record<string, string>>();
function useDevice(name: string) {
  if (device) {
    const snap: Record<string, string> = {};
    const ls = globalThis.localStorage;
    for (let i = 0; i < ls.length; i++) { const k = ls.key(i)!; snap[k] = ls.getItem(k)!; }
    devices.set(device, snap);
  }
  resetBrowserStorage();
  const saved = devices.get(name);
  if (saved) for (const [k, v] of Object.entries(saved)) globalThis.localStorage.setItem(k, v);
  // Dos teléfonos simulados en el MISMO proceso comparten la memoria del servicio: hay que
  // invalidar el cache de lectura (R58 F-10) para que cada “teléfono” lea SU localStorage.
  (AttendanceStorageService as any).invalidateReadCaches();
  device = name;
}

// ─────────────────────────────────────────────────────────────────────────────
section('F1 · El escaneo del DOCENTE llega a D1, pero todavía NO al snapshot');

useDevice('docente');
AttendanceStorageService.saveSettings({
  ...AttendanceStorageService.getSettings(),
  cloudflareWorkerUrl: WORKER_URL,
  cloudflareOperatorToken: OPERATOR_TOKEN,
  cloudflareApiToken: '',
} as any, false);
AttendanceStorageService.saveStudents(studentsAll as any, 'cloud');
AttendanceStorageService.saveCurrentSession({
  username: 'Docente de Prueba', role: 'DOCENTE', token: 'local-session', authAt: Date.now(),
} as any);

const docenteRecord: any = {
  id: `rec-docente-${Date.now()}`,
  studentCode: student.code,
  studentDocument: student.documentId,
  studentName: `${student.firstName} ${student.lastName}`,
  studentGrade: student.grade,
  studentSection: student.section,
  slotId: 'slot-1', slotName: '1ª Hora de Clase', slotStartTime: '06:30', slotEndTime: '07:25',
  subject: 'Matemáticas', teacherName: 'Docente de Prueba',
  timestamp: new Date().toISOString(), date: new Date().toISOString().slice(0, 10), time: '06:35',
  type: 'CLASE', status: 'PUNTUAL', method: 'CAMERA',
  scannedBy: 'DOCENTE', scannedByName: 'Docente de Prueba',
  verifiedHmac: true, synced: true, contextSource: 'HORA',
};
AttendanceStorageService.saveAttendance([docenteRecord]);
AttendanceStorageService.enqueueOfflineMutation(docenteRecord);
await CloudflareSyncService.replayOutbox();
check('el escaneo del docente quedó en D1 (POST /api/attendance)', cloud.d1.has(docenteRecord.id));
check('el snapshot de la nube sigue SIN registros (el outbox no escribe el snapshot)', cloud.snapshot.records.length === 0,
  `records=${cloud.snapshot.records.length}`);

// ─────────────────────────────────────────────────────────────────────────────
section('F2 · El teléfono del ESTUDIANTE hace pull: no ve el escaneo, y solo recibe lo suyo');

useDevice('estudiante');
AttendanceStorageService.saveSettings({
  ...AttendanceStorageService.getSettings(),
  cloudflareWorkerUrl: WORKER_URL,
  cloudflareOperatorToken: '',
  cloudflareApiToken: '',
} as any, false);
AttendanceStorageService.saveStudents([] as any, 'cloud');
AttendanceStorageService.saveCurrentSession({
  username: `${student.firstName} ${student.lastName}`,
  role: 'ESTUDIANTE_ACUDIENTE', token: 'local-session', authAt: Date.now(), studentCode: student.code,
} as any);

const pull1 = await CloudflareSyncService.pullFromCloudflare();
check('el pull del estudiante responde OK', pull1.success === true, pull1.message);
const localAfterPull1 = AttendanceStorageService.getAllAttendance();
check('el estudiante todavía NO ve la asistencia que registró el docente (aún no está en el snapshot)',
  !localAfterPull1.some(r => r.id === docenteRecord.id), `locales=${localAfterPull1.length}`);

// El filtro REAL del Worker, sobre un snapshot que SÍ trae hechos de dos estudiantes:
const snapWithRecords = { ...cloud.snapshot, records: [docenteRecord, { ...docenteRecord, id: 'rec-companero', studentCode: classmate.code }] };
const seenByStudent = filterSnapshotByRole(snapWithRecords, {
  source: 'identity', role: 'ESTUDIANTE_ACUDIENTE', linkedStudentCode: student.code, canWriteCatalog: false,
} as any);
check('el filtro del Worker entrega al estudiante SOLO sus propios hechos (no los del compañero)',
  seenByStudent.records.length === 1 && seenByStudent.records[0].studentCode === student.code);
check('el snapshot que recibe el estudiante NO lleva el qrSecret institucional',
  (seenByStudent.settings as any).qrSecret === undefined && (seenByStudent.settings as any).legacyQrSecret === undefined);
check('el estudiante no recibe fichas de docentes', Array.isArray(seenByStudent.teachers) && seenByStudent.teachers.length === 0);

// Un hecho local del representante (escaneo a un compañero) NO debe perderse al hacer pull:
const localRepRecord: any = { ...docenteRecord, id: 'rec-rep-local', studentCode: classmate.code, scannedBy: 'REPRESENTANTE_TITULAR' };
AttendanceStorageService.saveAttendance([...AttendanceStorageService.getAllAttendance(), localRepRecord]);

// ─────────────────────────────────────────────────────────────────────────────
section('F3 · El dispositivo del DOCENTE publica el snapshot: ahora sí el estudiante lo recibe');

useDevice('docente');
const push = await CloudflareSyncService.performCloudflareSync();
check('el push del docente (token de operador) fue exitoso', push.success === true, push.message);
check('el hecho del docente ya está EN EL SNAPSHOT (canal que reparte el pull)',
  cloud.snapshot.records.some((r: any) => r.id === docenteRecord.id), `records=${cloud.snapshot.records.length}`);
check('el push de operador NO reemplazó el catálogo del snapshot (sigue con los 80 estudiantes)',
  cloud.snapshot.students.length === studentsAll.length, `students=${cloud.snapshot.students.length}`);

useDevice('estudiante');
const pull2 = await CloudflareSyncService.pullFromCloudflare();
check('segundo pull del estudiante OK', pull2.success === true, pull2.message);
const localAfterPull2 = AttendanceStorageService.getAllAttendance();
check('AHORA el estudiante SÍ ve en su perfil la asistencia registrada por el docente',
  localAfterPull2.some(r => r.id === docenteRecord.id));
const recibido = localAfterPull2.find(r => r.id === docenteRecord.id);
check('el registro llega con el estado y la materia correctos',
  recibido?.status === 'PUNTUAL' && recibido?.subject === 'Matemáticas', JSON.stringify({ status: recibido?.status, subject: recibido?.subject }));
check('el hecho local del representante sobrevivió al pull (unión por id, no reemplazo)',
  localAfterPull2.some(r => r.id === 'rec-rep-local'));
check('el estudiante NO recibió el hecho del compañero que el filtro del Worker oculta',
  !localAfterPull2.some(r => r.id === 'rec-companero'));

L('');
L('Flujo verificado (dos dispositivos, nube simulada):');
L('  1) Docente escanea  → outbox → POST /api/attendance → fila en D1  (el snapshot NO cambia)');
L('  2) Estudiante hace pull → NO ve el escaneo (el snapshot no lo tiene)');
L('  3) Docente publica snapshot (push de operador) → el hecho entra al snapshot');
L('  4) Estudiante hace pull → AHORA sí lo ve en “Historial de Clases Registradas”');
L('  Nota: el pull del estudiante es automático cada 5 min (initAutoSync, sin dirty) y en cada login;');
L('        el push del docente solo ocurre si su dispositivo tiene ediciones selladas (dirty) o un push manual.');

// ─────────────────────────────────────────────────────────────────────────────
const evidenceDir = path.join(process.cwd(), 'tests', 'evidence');
fs.mkdirSync(evidenceDir, { recursive: true });
const txtPath = path.join(evidenceDir, 'r70_flujo_docente_estudiante.txt');
fs.writeFileSync(txtPath, [
  'EVIDENCIA R70 — ¿el estudiante ve la asistencia que registra el docente? (2 dispositivos, sin red)',
  `Generado: ${new Date().toISOString()}`,
  `Checks: ${passed} OK · ${failed} FALLO`,
  '',
  'RESPUESTA CORTA: el pull del estudiante es automático, pero el escaneo del docente NO entra',
  'al canal que reparte el pull (el snapshot) hasta que algún dispositivo publique un push.',
  'Por eso hoy puede tardar: llega a D1 (exportaciones/métricas) mucho antes que al perfil del estudiante.',
  '',
  ...log,
  '',
  'Llamadas observadas:',
  ...calls.map(c => '  · ' + c),
  '',
  'Fallos: ' + (failures.join(' | ') || '(ninguno)'),
  '',
].join('\n'), 'utf8');

console.log(`\n━━━ RESULTADO ━━━`);
console.log(`Checks: ${passed} OK · ${failed} FALLO`);
console.log(`Evidencia: ${path.relative(process.cwd(), txtPath)}`);
if (failures.length) console.log('Fallos: ' + failures.join(' | '));
process.exit(failed > 0 ? 1 : 0);
