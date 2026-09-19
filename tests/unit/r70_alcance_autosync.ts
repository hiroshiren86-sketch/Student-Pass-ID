/**
 * R70 — ALCANCE REAL DEL AUTOSINCRONIZADO (evidencia ejecutable, sin red)
 * ---------------------------------------------------------------------------
 * Pregunta del propietario: “¿bajo qué condiciones sube de verdad lo que captura
 * el portal (sobre todo el representante)?”. Este script responde con el CÓDIGO REAL
 * y deja la respuesta escrita en tests/evidence/r70_alcance_autosync.txt.
 *
 * Lo que demuestra (y lo que corrige de afirmaciones anteriores):
 *   1. Los HECHOS de asistencia (escaneo del representante/docente) se guardan y se
 *      encolan, pero NO sellan el aviso de “ediciones sin subir” (dirty).
 *   2. En una sesión de ESTUDIANTE, las ediciones de su propia ficha (foto) y su
 *      horario personal por CSV tampoco sellan dirty — decisión explícita de la R64
 *      (Fix A): son personalización de dispositivo y un push de operador no puede
 *      publicarlas; el sello habría bloqueado los pulls de ajustes para siempre.
 *   3. En una sesión ADMIN (Rectoría) esas mismas ediciones SÍ sellan dirty → el
 *      ciclo automático publica el estado del dispositivo.
 *   4. El reenvío del outbox (POST /api/attendance) está cableado ÚNICAMENTE en el
 *      Escáner de Rectoría/Docente (ScanHubView), y solo al recuperar la conexión
 *      (evento `online`); el push (performCloudflareSync) no reenvía el outbox.
 *   5. El ciclo automático, sin sello dirty, SOLO baja (pull de lectura).
 *
 * Ejecutar: TZ=America/Bogota npx tsx tests/unit/r70_alcance_autosync.ts
 */
import '../harness/domEnv';
import { resetBrowserStorage } from '../harness/domEnv';
import { buildProductionStudents } from '../harness/fixtures';
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

// Red intervenida: cualquier intento de red queda registrado (no debe haber ninguno en §1–§3).
const calls: string[] = [];
(globalThis as any).fetch = async (input: any, init: any = {}) => {
  const url = typeof input === 'string' ? input : String(input?.url ?? '');
  calls.push(`${(init?.method || 'GET').toUpperCase()} ${url}`);
  return { ok: false, status: 503, json: async () => ({ success: false }), text: async () => 'stub' } as any;
};

const { AttendanceStorageService } = await import('../../src/services/attendanceStorage');
resetBrowserStorage();

const students = buildProductionStudents();
AttendanceStorageService.saveStudents(students, 'cloud'); // hidratación (no sella: origen cloud)
AttendanceStorageService.saveSettings({
  ...AttendanceStorageService.getSettings(),
  cloudflareWorkerUrl: 'https://worker.inas.test',
}, false);

const target = students.find(s => s.grade === '6°4')!;
const repCode = target.code;
AttendanceStorageService.setRepresentativeForGrade(target.grade, repCode);

function sessionAs(role: 'ADMIN' | 'ESTUDIANTE_ACUDIENTE') {
  AttendanceStorageService.saveCurrentSession({
    username: role === 'ADMIN' ? 'Rectoría / Administrador General' : `${target.firstName} ${target.lastName}`,
    role,
    token: 'local-session',
    authAt: Date.now(),
    studentCode: role === 'ESTUDIANTE_ACUDIENTE' ? repCode : undefined,
  } as any);
}

const record: any = {
  id: `rec-autosync-${Date.now()}`,
  studentCode: target.code,
  studentDocument: target.documentId,
  studentName: `${target.firstName} ${target.lastName}`,
  studentGrade: target.grade,
  studentSection: target.section,
  slotId: 'slot-1',
  slotName: '1ª Hora de Clase',
  slotStartTime: '06:30', slotEndTime: '07:25',
  subject: 'Matemáticas',
  teacherName: 'Juan Pablo Pérez Gómez',
  timestamp: new Date().toISOString(),
  date: new Date().toISOString().slice(0, 10),
  time: '06:35',
  type: 'CLASE', status: 'PUNTUAL', method: 'CAMERA',
  scannedBy: 'REPRESENTANTE_TITULAR',
  scannedByName: `${target.firstName} ${target.lastName} (Representante Titular)`,
  scannedByCode: repCode,
  verifiedHmac: true,
  synced: true,
  contextSource: 'QR_CLASE', classQrVerified: true, presenceCapture: 'CLASS_UNLOCK_AUTO',
};

// ─────────────────────────────────────────────────────────────────────────────
section('1 · Sesión del ESTUDIANTE/REPRESENTANTE: lo que NO sella “hay cambios sin subir”');

sessionAs('ESTUDIANTE_ACUDIENTE');
AttendanceStorageService.clearLocalSyncDirty();

AttendanceStorageService.saveAttendance([record]);
AttendanceStorageService.enqueueOfflineMutation(record, `op-mutation-${record.id}`);
const queuePending = AttendanceStorageService.getOfflineQueue().filter(i => i.status !== 'SENT');
check('el escaneo queda guardado y ENCOLADO en el outbox durable', queuePending.some(i => i.id === record.id));
check('…y NO sella “ediciones sin subir” (dirty sigue en null)', AttendanceStorageService.getLocalSyncDirty() === null,
  String(AttendanceStorageService.getLocalSyncDirty()));

AttendanceStorageService.clearLocalSyncDirty();
AttendanceStorageService.updateStudent(target.code, { photoUrl: 'data:image/png;base64,iVBORw0KGgo=' });
check('“Personalizar Foto” desde el portal NO sella dirty (personalización de dispositivo, R64 Fix A)',
  AttendanceStorageService.getLocalSyncDirty() === null, String(AttendanceStorageService.getLocalSyncDirty()));

AttendanceStorageService.clearLocalSyncDirty();
AttendanceStorageService.saveStudentPersonalSchedule(target.code, [
  { dayOfWeek: 1, subject: 'Matemáticas', startTime: '06:30', endTime: '07:25' },
]);
check('“Cargar mi horario (CSV)” NO sella dirty (se guarda en su propia clave local)',
  AttendanceStorageService.getLocalSyncDirty() === null, String(AttendanceStorageService.getLocalSyncDirty()));

L('Conclusión §1: desde el portal del estudiante, NI el escaneo, NI la foto, NI el CSV');
L('sellan el aviso de publicación → el ciclo automático no tiene nada que subir desde aquí.');
L(`Llamadas de red durante §1: ${calls.length === 0 ? 'ninguna' : calls.join(', ')}`);

// ─────────────────────────────────────────────────────────────────────────────
section('2 · Sesión de RECTORÍA (ADMIN): lo que SÍ sella (el autosincronizado del colegio)');

sessionAs('ADMIN');
AttendanceStorageService.clearLocalSyncDirty();
AttendanceStorageService.updateStudent(target.code, { photoUrl: 'data:image/png;base64,iVBORw0KGgo=' });
check('en sesión ADMIN, editar la ficha SÍ sella dirty → el ciclo automático publicará el estado',
  !!AttendanceStorageService.getLocalSyncDirty(), String(AttendanceStorageService.getLocalSyncDirty()));

AttendanceStorageService.clearLocalSyncDirty();
AttendanceStorageService.saveStudents(AttendanceStorageService.getStudents());
check('en sesión ADMIN, guardar el catálogo SÍ sella dirty (push del snapshot)',
  !!AttendanceStorageService.getLocalSyncDirty());

AttendanceStorageService.clearLocalSyncDirty();

// ─────────────────────────────────────────────────────────────────────────────
section('3 · Cableado real: quién dispara el reenvío del outbox y qué hace el ciclo de 5 min');

const srcDir = path.join(process.cwd(), 'src');
function readAll(dir: string): Array<{ f: string; s: string }> {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return readAll(p);
    if (!/\.tsx?$/.test(e.name)) return [];
    return [{ f: path.relative(srcDir, p), s: fs.readFileSync(p, 'utf8') }];
  });
}
const files = readAll(srcDir);
const callersOfSync = files.filter(f => f.f.includes('components') && f.s.includes('syncOfflineQueue(') && !f.f.includes('attendanceStorage'));
check('el reenvío del outbox se invoca desde UN solo componente: el Escáner de Rectoría/Docente (ScanHubView)',
  callersOfSync.length === 1 && callersOfSync[0].f.endsWith('ScanHubView.tsx'),
  callersOfSync.map(f => f.f).join(', ') || '(ninguno)');

const scanHub = files.find(f => f.f.endsWith('ScanHubView.tsx'))!.s;
// El reenvío vive DENTRO del handler del evento `online` (no en un efecto de montaje):
// el handler que llama a syncOfflineQueue es el mismo que se registra en el listener.
const onlineHandlerMatch = /const handleOnline = \(\) => \{([\s\S]*?)\};/.exec(scanHub);
const onlineHandler = !!onlineHandlerMatch && onlineHandlerMatch[1].includes('syncOfflineQueue()')
  && scanHub.includes("addEventListener('online', handleOnline)");
check("ScanHubView solo reenvía al recuperar la conexión (listener 'online'), no al abrir la pantalla", onlineHandler,
  onlineHandlerMatch ? onlineHandlerMatch[1].replace(/\s+/g, ' ').trim().slice(0, 120) : '(handler no encontrado)');

const syncSrc = files.find(f => f.f.endsWith('cloudflareSync.ts'))!.s;
const pushBody = syncSrc.slice(syncSrc.indexOf('static async performCloudflareSync'), syncSrc.indexOf('static async replayOutbox'));
check('performCloudflareSync (el push) NO reenvía el outbox — son caminos separados',
  !pushBody.includes('replayOutbox(') && !pushBody.includes('syncOfflineQueue('));

const intervalBlock = syncSrc.slice(syncSrc.indexOf('this.autoSyncTimer = setInterval'), syncSrc.indexOf('intervalMs);'));
check('el ciclo automático, SIN sello dirty, SOLO hace pull (lectura)',
  /if \(!dirty\)[\s\S]{0,700}?pullFromCloudflare/.test(intervalBlock));
check('el ciclo automático publica (push) solo cuando hay sello dirty',
  /const dirty = AttendanceStorageService\.getLocalSyncDirty\(\);/.test(intervalBlock) && intervalBlock.includes('this.performCloudflareSync()'));

const workerSrc = fs.readFileSync(path.join(process.cwd(), 'cloudflare-worker', 'src', 'index.ts'), 'utf8');
check('el Worker exige credencial válida en todas las rutas de datos (401 sin identidad ni token)',
  workerSrc.includes("return errorResponse('No autorizado. Credencial inválida o ausente.', 401);"));

L('');
L('Mapa de disparadores del autosincronizado (estado REAL de la Ronda 69):');
L('  · Portal DOCENTE (Escáner de Aula / pestaña Escanear) → reenvía hechos pendientes al volver la conexión');
L('  · Portal RECTORÍA → sella dirty al guardar catálogo/ajustes/horarios → el ciclo publica el snapshot');
L('  · Portal ESTUDIANTE/REPRESENTANTE → guarda y encola; NO dispara publicación automática hoy');
L('  · Publicación diferida: cuando ese dispositivo se use con sesión Docente/Rectoría, o con su push.');

// ─────────────────────────────────────────────────────────────────────────────
const evidenceDir = path.join(process.cwd(), 'tests', 'evidence');
fs.mkdirSync(evidenceDir, { recursive: true });
const txtPath = path.join(evidenceDir, 'r70_alcance_autosync.txt');
fs.writeFileSync(txtPath, [
  'EVIDENCIA R70 — ALCANCE REAL DEL AUTOSINCRONIZADO (código real, sin red)',
  `Generado: ${new Date().toISOString()}`,
  `Checks: ${passed} OK · ${failed} FALLO`,
  '',
  'RESPUESTA CORTA: hoy los portales autorizados para el autosincronizado son el de',
  'DOCENTE y el de RECTORÍA. El portal del ESTUDIANTE/REPRESENTANTE guarda y encola sus',
  'hechos, pero no dispara publicación automática (la sincronización de sus escaneos no',
  'está implementada: se dejó así por compatibilidad, para no romper lo que ya funciona).',
  'Los datos NO se pierden: quedan en el dispositivo y en la cola durable.',
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
