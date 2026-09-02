/**
 * Ronda 18 — Restauración del snapshot de producción (INAS-ANTONIA-SANTOS-2026).
 * El roundtrip de prueba sobrescribió el snapshot demo del 1/9 con datos de test.
 * Esta restauración repone el ecosistema DEMO completo (50 estudiantes + docentes +
 * settings + slots) bajo el schoolCode real, dejando la nube coherente para las
 * terminales del colegio.
 * Ejecutar: bun scripts/restore_production_snapshot.ts
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

const { AttendanceStorageService } = await import('../src/services/attendanceStorage');
const { CloudflareSyncService } = await import('../src/services/cloudflareSync');

const WORKER_URL = 'https://inas-attendance-worker.hiroshiren86.workers.dev';

// 1. Ecosistema demo completo
AttendanceStorageService.resetToDemo();
const students = AttendanceStorageService.getStudents();
const records = AttendanceStorageService.getAllAttendance();
const teachers = AttendanceStorageService.getTeachers();
console.log(`Ecosistema demo local: ${students.length} estudiantes, ${teachers.length} docentes, ${records.length} registros.`);

// 2. URL del worker de producción
AttendanceStorageService.saveSettings({ ...AttendanceStorageService.getSettings(), cloudflareWorkerUrl: WORKER_URL }, false);

// 3. Push de restauración (schoolCode real del ecosistema demo)
const push = await CloudflareSyncService.performCloudflareSync();
console.log(`PUSH de restauración: success=${push.success}`);
console.log(`  mensaje: ${push.message}`);
console.log(`  estudiantes=${push.syncedStudentsCount}, registros=${push.syncedRecordsCount}`);

// 4. Verificación: pull inmediato (desde la misma máquina) y comparación
const pull = await CloudflareSyncService.pullFromCloudflare();
console.log(`PULL de verificación: success=${pull.success}`);
const pulledStudents = (pull.data as any)?.students?.length ?? 0;
console.log(`  estudiantes en snapshot: ${pulledStudents}`);
if (push.success && pulledStudents === students.length) {
  console.log('✅ SNAPSHOT DE PRODUCCIÓN RESTAURADO (ecosistema demo coherente).');
  process.exit(0);
} else {
  console.log('❌ La restauración no quedó coherente — revisar manualmente.');
  process.exit(1);
}
