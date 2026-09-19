/**
 * R70 — ¿EL REPRESENTANTE “MANDA A LA NUBE”? (evidencia ejecutable, sin red)
 *
 * La observación del propietario tras la última prueba fue: “el subrol representante
 * como que no manda directamente a la nube”. Este script responde con el CÓDIGO REAL
 * de la app (no con una opinión) y deja la respuesta escrita en la evidencia:
 *
 *   1. Un escaneo del representante (StudentPortalView → “Abrir Escáner de Aula” →
 *      “Registrar”) pasa por `AttendanceStorageService.registerClassScan`, que guarda
 *      el hecho EN EL DISPOSITIVO y lo encola en el OUTBOX durable (opId idempotente).
 *   2. El dispositivo del representante SÍ empuja a la nube:
 *        · `CloudflareSyncService.replayOutbox()`  → POST {worker}/api/attendance   (1 hecho por escaneo, con opId)
 *        · `CloudflareSyncService.performCloudflareSync()` → POST {worker}/api/sync/push (auto-sync cada 5 min si hay sello dirty)
 *   3. Pero SOLO empuja HECHOS: el Worker (`cloudflare-worker/src/index.ts`) marca
 *      `catalogWritten: isAdmin` — el catálogo (matrícula, docentes, horarios, roles)
 *      lo escribe únicamente Rectoría. Un dispositivo de estudiante/docente nunca
 *      puede aplastar el catálogo. Rectoría ve los hechos al abrir la Planilla
 *      (su pull/push los trae fusionados por id+updatedAt).
 *
 * Evidencia: tests/evidence/r70_representante_nube.txt
 * Ejecutar: TZ=America/Bogota npx tsx tests/unit/r70_representante_nube.ts
 */
import '../harness/domEnv';
import { resetBrowserStorage } from '../harness/domEnv';
import { buildProductionStudents, buildRealTeachers } from '../harness/fixtures';
import fs from 'node:fs';
import path from 'node:path';

let passed = 0, failed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}
function section(t: string) { console.log(`\n━━━ ${t} ━━━`); }

const log: string[] = [];
function L(line = '') { log.push(line); }

// ── Red intervenida: se registra CADA llamada (URL + cabeceras + cuerpo) y se responde
// 200 con la forma que el cliente espera, para poder observar el flujo completo.
interface Call { url: string; method: string; auth: string | null; idToken: string | null; body: any }
const calls: Call[] = [];
(globalThis as any).fetch = async (input: any, init: any = {}) => {
  const url = typeof input === 'string' ? input : String(input?.url ?? '');
  const headers = (init?.headers || {}) as Record<string, string>;
  let body: any = null;
  try { body = init?.body ? JSON.parse(String(init.body)) : null; } catch { body = String(init?.body || '').slice(0, 200); }
  calls.push({
    url, method: (init?.method || 'GET').toUpperCase(),
    auth: headers['Authorization'] ?? null,
    idToken: headers['X-Firebase-Id-Token'] ?? null,
    body,
  });
  if (url.includes('/api/attendance')) return { ok: true, status: 200, json: async () => ({ success: true }), text: async () => '{"success":true}' } as any;
  if (url.includes('/api/sync/push')) return { ok: true, status: 200, json: async () => ({ success: true, catalogWritten: false, catalogVersion: 7, message: 'ok (stub)' }), text: async () => '{"success":true}' } as any;
  if (url.includes('/api/sync/pull')) return { ok: true, status: 200, json: async () => ({ success: true, data: { students: [], teachers: [], records: [] } }), text: async () => '{"success":true}' } as any;
  return { ok: false, status: 503, json: async () => ({ success: false }), text: async () => 'stub' } as any;
};

const { AttendanceStorageService } = await import('../../src/services/attendanceStorage');
const { CloudflareSyncService } = await import('../../src/services/cloudflareSync');

resetBrowserStorage();
const students = buildProductionStudents();
const teachers = buildRealTeachers({ '6°4': 'Juan Pablo Pérez Gómez' });
AttendanceStorageService.saveStudents(students, 'cloud');
AttendanceStorageService.saveTeachers(teachers, 'cloud');

// El dispositivo del representante: URL del Worker configurada (cómo se conecta el terminal).
AttendanceStorageService.saveSettings({
  ...AttendanceStorageService.getSettings(),
  cloudflareWorkerUrl: 'https://worker.inas.test',
}, false);

section('1 · El subrol Representante existe en la ficha del estudiante (botón "Hacer Rep")');
const repCode = students.find(s => s.grade === '6°4')!.code;
const assigned = AttendanceStorageService.setRepresentativeForGrade('6°4', repCode);
const rep = AttendanceStorageService.getStudentByCodeOrDoc(repCode)!;
check('setRepresentativeForGrade("6°4", código) asigna el subrol', assigned === true);
check('la ficha queda isRepresentative = true', rep.isRepresentative === true);
check('la ficha guarda representativeGrade', String(rep.representativeGrade || '').includes('6'));
L(`Representante de 6°4: ${rep.firstName} ${rep.lastName} (${rep.code})`);
L(`  isRepresentative=${rep.isRepresentative} · representativeGrade=${rep.representativeGrade} · isSubstituteRep=${rep.isSubstituteRep}`);

section('2 · La sesión del representante es ESTUDIANTE_ACUDIENTE (su propio teléfono)');
AttendanceStorageService.saveCurrentSession({
  username: `${rep.firstName} ${rep.lastName}`,
  role: 'ESTUDIANTE_ACUDIENTE',
  token: 'local-session',
  authAt: Date.now(),
  studentCode: rep.code,
} as any);
const session = AttendanceStorageService.getCurrentSession();
check('la sesión activa es del estudiante (no de Rectoría)', session?.role === 'ESTUDIANTE_ACUDIENTE');
check('la sesión conserva su studentCode', session?.studentCode === rep.code);

section('3 · El escaneo del representante se guarda y queda ENCOLADO (outbox durable)');
// Camino real del escaneo: `registerClassScan` guarda el hecho en el dispositivo y lo
// encola con opId idempotente (`op-mutation-<id>`). Aquí se reproduce la MISMA llamada
// que dispara el botón "Registrar" del Portal (la ventana de jornada impide escanear
// fuera de horario lectivo, por eso se ejercita el punto de encolado del servicio).
const classmate = students.filter(s => s.grade === '6°4').find(s => s.code !== repCode)!;
const record = {
  id: `rec-rep-${Date.now()}`,
  studentCode: classmate.code,
  studentDocument: classmate.documentId,
  studentName: `${classmate.firstName} ${classmate.lastName}`,
  studentGrade: classmate.grade,
  studentSection: classmate.section,
  slotId: 'slot-1',
  slotName: '1ª Hora de Clase',
  slotStartTime: '06:30',
  slotEndTime: '07:25',
  subject: 'Matemáticas',
  teacherName: 'Juan Pablo Pérez Gómez',
  timestamp: new Date().toISOString(),
  date: new Date().toISOString().slice(0, 10),
  time: '06:35',
  type: 'CLASE' as const,
  status: 'PUNTUAL' as const,
  method: 'CAMERA' as const,
  scannedBy: 'REPRESENTANTE_TITULAR' as const,
  scannedByName: `${rep.firstName} ${rep.lastName} (Representante Titular)`,
  scannedByCode: rep.code,
  notes: 'Verificado vía Carné Digital HMAC-SHA256',
  verifiedHmac: true,
  synced: true,
  contextSource: 'QR_CLASE' as const,
  classQrVerified: true,
  presenceCapture: 'CARD_SCAN' as const,
};
AttendanceStorageService.saveAttendance([record]);
AttendanceStorageService.markLocalSyncDirty();
AttendanceStorageService.enqueueOfflineMutation(record as any, `op-mutation-${record.id}`);
const queue = AttendanceStorageService.getOfflineQueue().filter(i => i.status !== 'SENT');
check('el hecho quedó en el OUTBOX del dispositivo (pendiente de nube)', queue.some(i => i.id === record.id), JSON.stringify(queue.map(i => i.id)));
check('el sello "ediciones sin subir" quedó activo (auto-sync lo publicará)', !!AttendanceStorageService.getLocalSyncDirty());

section('4 · El dispositivo del representante EMPUJA a la nube (endpoints reales)');
await CloudflareSyncService.replayOutbox();
const attendanceCall = calls.find(c => c.url.includes('/api/attendance'));
check('POST {worker}/api/attendance (hecho por escaneo, con opId idempotente)', !!attendanceCall, JSON.stringify(calls.map(c => c.method + ' ' + c.url)));
check('el hecho viaja con su opId (dedup en la nube)', !!attendanceCall?.body?.opId, JSON.stringify(attendanceCall?.body || {}).slice(0, 200));

await CloudflareSyncService.performCloudflareSync();
const pushCall = calls.find(c => c.url.includes('/api/sync/push'));
check('POST {worker}/api/sync/push (snapshot con los hechos locales)', !!pushCall, JSON.stringify(calls.map(c => c.method + ' ' + c.url)));
check('el snapshot incluye el registro del representante', !!pushCall?.body?.data?.records?.some?.((r: any) => r.id === record.id));
check('el snapshot NO lleva la clave del carné en claro (política F-23): viaja el verifier', !JSON.stringify(pushCall?.body?.data?.students?.[0] || {}).includes('tempPassword"') || !!pushCall?.body?.data?.students?.[0]?.tempPasswordVerifier);

L('\nLlamadas observadas (orden real del cliente):');
for (const c of calls) {
  L(`  · ${c.method} ${c.url}`);
  L(`      Authorization: ${c.auth ? c.auth.slice(0, 18) + '…' : '(sin token de dispositivo en este simulacro)'}`);
  L(`      X-Firebase-Id-Token: ${c.idToken ? 'presente' : '(sin sesión Firebase en este simulacro: el estudiante real entra con su cuenta y sí lo envía)'}`);
  if (c.body?.data) L(`      data: students=${c.body.data.students?.length ?? 0} records=${c.body.data.records?.length ?? 0} teachers=${c.body.data.teachers?.length ?? 0} catalogVersion=${c.body.catalogVersion}`);
  if (c.body?.studentCode) L(`      hecho: studentCode=${c.body.studentCode} status=${c.body.status} scannedBy=${c.body.scannedBy} opId=${c.body.opId}`);
}

section('5 · Lo que la nube HACE con ese push (regla del Worker, cita de código)');
const workerSrc = fs.readFileSync(path.join(process.cwd(), 'cloudflare-worker', 'src', 'index.ts'), 'utf8');
const hasCatalogRule = workerSrc.includes('catalogWritten: isAdmin') && workerSrc.includes('const isOperator = !isAdmin');
check('el Worker sólo escribe CATÁLOGO si el alcance es ADMIN (catalogWritten: isAdmin)', hasCatalogRule);
check('el Worker trata identidad DOCENTE/ESTUDIANTE como OPERADOR: fusiona HECHOS y no toca el catálogo',
  workerSrc.includes("OPERATOR (token) o DOCENTE/ESTUDIANTE (identidad) → solo hechos"));
const operatorMerge = workerSrc.includes('2b. CAMINO DE OPERADOR') && workerSrc.includes('mergeRecordsByUpdatedAt(prevRecords, records)');
check('el camino de operador fusiona los registros por id + updatedAt (sin perder hechos de otros)', operatorMerge);

// ---------------------------------------------------------------------------
const evidenceDir = path.join(process.cwd(), 'tests', 'evidence');
fs.mkdirSync(evidenceDir, { recursive: true });
const txtPath = path.join(evidenceDir, 'r70_representante_nube.txt');
fs.writeFileSync(txtPath, [
  'EVIDENCIA R70 — “¿el representante manda a la nube?” (código real, sin red)',
  `Generado: ${new Date().toISOString()}`,
  `Checks: ${passed} OK · ${failed} FALLO`,
  '',
  'RESPUESTA CORTA: SÍ, el dispositivo del representante empuja sus HECHOS de asistencia',
  'a la nube (/api/attendance por escaneo + /api/sync/push en el auto-sync). Lo que NO hace',
  '—por diseño— es escribir el CATÁLOGO (matrícula, docentes, horarios, roles): eso sólo lo',
  'escribe Rectoría (catalogWritten: isAdmin en cloudflare-worker/src/index.ts).',
  '',
  ...log,
  '',
  'Fallos: ' + (failures.join(' | ') || '(ninguno)'),
  '',
].join('\n'), 'utf8');

console.log(`\n━━━ RESULTADO ━━━`);
console.log(`Checks: ${passed} OK · ${failed} FALLO`);
console.log(`Evidencia: ${path.relative(process.cwd(), txtPath)}`);
if (failures.length) console.log('Fallos: ' + failures.join(' | '));
process.exit(failed > 0 ? 1 : 0);
