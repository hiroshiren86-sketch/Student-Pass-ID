/**
 * Sonda de rendimiento R58 (F-10) — mide el volumen de localStorage en un escaneo
 * real con el cache de lectura activo. Réplica del método de la auditoría (que midió
 * 9 lecturas y 6.9 MB serializados por escaneo, 61.5 ms en Node, ANTES de la
 * corrección). Ejecutar: TZ=America/Bogota npx tsx scripts/perf-r58-probe.ts
 * (Regla #8: script de verificación — no toca código de la app).
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
  if (typeof (globalThis as any).window === 'undefined') (globalThis as any).window = globalThis;
})();

const { AttendanceStorageService: svc, getCurrentTimeString } = await import('../src/services/attendanceStorage');

// ── Instrumentar localStorage ──
let reads = 0, readBytes = 0, writes = 0, writeBytes = 0;
const origGet = localStorage.getItem.bind(localStorage);
const origSet = localStorage.setItem.bind(localStorage);
(globalThis as any).localStorage.getItem = (k: string) => { reads++; const v = origGet(k); readBytes += v?.length || 0; return v; };
(globalThis as any).localStorage.setItem = (k: string, v: string) => { writes++; writeBytes += v?.length || 0; return origSet(k, v); };

// ── Sembrar 1 500 estudiantes / 15 000 registros (el escenario de la auditoría) ──
const students = Array.from({ length: 1500 }, (_, i) => ({
  code: String(10_000_000 + i), documentId: String(10_000_000 + i),
  firstName: `Nom${i}`, lastName: `Ape${i}`, grade: `${6 + (i % 6)}°${i % 4}`,
  section: '1', active: true, createdAt: new Date().toISOString()
}));
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const [h, m] = getCurrentTimeString().split(':').map(Number);
const start = `${String(Math.max(h - 1, 0)).padStart(2, '0')}:${m}`;
const records = Array.from({ length: 15000 }, (_, i) => ({
  id: `rec-seed-${i}`, studentCode: String(10_000_000 + (i % 1500)),
  studentName: `x`, studentGrade: `${6 + (i % 6)}°1`, date: '2026-01-01',
  slotId: 'slot-perf', time: '07:00', status: 'PUNTUAL', method: 'CAMERA', type: 'CLASE'
}));
svc.saveStudents(students as any);
svc.saveAttendance(records as any);
svc.saveScheduleSlots([{ id: 'slot-perf', order: 1, type: 'CLASS', name: 'Perf', startTime: start, endTime: '23:59', durationMinutes: 60 } as any]);
// Misma convención que verify_ronda43/qa-r46: la guarda de jornada se abre para que
// la sonda corra a cualquier hora real (la producción la deja intacta).
(svc as any).getSchoolDayWindow = () => ({ start: '00:00', end: '23:59', startMin: 0, endMin: 1439 });

// ── Medir UN escaneo (frío y caliente) con carné FIRMADO (modo estricto R58) ──
const cryptoMod = await import('../src/utils/crypto');
const target = students[420];
const signedCard = await cryptoMod.generateStudentQrPayload(target as any, svc.getSettings().qrSecret);
// unicidad: cada medición usa un estudiante distinto (el segundo escaneo del mismo
// estudiante es already_scanned, que no ejercita todo el pipeline de escritura).
const cards = [signedCard,
  await cryptoMod.generateStudentQrPayload(students[421] as any, svc.getSettings().qrSecret),
  await cryptoMod.generateStudentQrPayload(students[422] as any, svc.getSettings().qrSecret)];
let cardIdx = 0;
async function measureScan(label: string) {
  reads = 0; readBytes = 0; writes = 0; writeBytes = 0;
  const t0 = process.hrtime.bigint();
  const res = await svc.registerScan({ scanInput: cards[cardIdx++], method: 'CAMERA' });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`${label}: tipo=${res.type} · ${ms.toFixed(1)} ms · lecturas=${reads} (${(readBytes / 1024 / 1024).toFixed(2)} MB leídos) · escrituras=${writes} (${(writeBytes / 1024 / 1024).toFixed(2)} MB escritos)`);
  return ms;
}
await measureScan('Escaneo #1 (cache frío — parsea 1 vez)');
await measureScan('Escaneo #2 (cache caliente)');
await measureScan('Escaneo #3 (cache caliente)');

// ── Verificación de identidad del cache ──
const a = svc.getStudents();
const b = svc.getStudents();
console.log(`cache: getStudents() devuelve la MISMA referencia (0 re-parseos): ${a === b}`);
const readsAfter10 = (() => { const r0 = reads; for (let i = 0; i < 10; i++) svc.getStudents(); return reads - r0; })();
console.log(`lecturas de localStorage tras 10 getStudents() consecutivos: ${readsAfter10} (antes: 10)`);
