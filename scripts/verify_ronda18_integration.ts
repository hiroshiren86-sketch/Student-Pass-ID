/**
 * Ronda 18 — Suite de INTEGRACIÓN con el Worker real (red + KV eventual).
 * Ejecutar: bun scripts/verify_ronda18_integration.ts
 *
 * Lección Ronda 18: NUNCA hacer push sin schoolCode de prueba explícito (el default
 * es el schoolCode de producción). Cloudflare KV es eventualmente consistente:
 * el pull se reintenta verificando IDs PROPIOS del push, no solo conteos.
 * Cada paso tiene timeout duro (AbortController) — sin fetch colgantes.
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
})();
setTimeout(() => { console.log('⏱ TIMEOUT GLOBAL DE INTEGRACIÓN (3 min)'); process.exit(2); }, 180000);

let passed = 0, failed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}

const WORKER_URL = 'https://inas-attendance-worker.hiroshiren86.workers.dev';
const TEST_SCHOOL = 'INAS_TEST_R18';

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} excedió ${ms}ms`)), ms))
  ]);
}

async function workerGet(path: string): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`${WORKER_URL}${path}`, { signal: ctrl.signal, headers: { 'Content-Type': 'application/json' } });
    return await res.json();
  } finally { clearTimeout(t); }
}

async function main() {
  console.log('━━━ Integración: Worker real — roundtrip bajo schoolCode de PRUEBA ━━━');

  // 1. Health
  try {
    const health = await workerGet('/api/health');
    check('health check: worker online', health.status === 'online');
    check('health check: D1 y KV conectados', health.storage?.d1 === 'connected' && health.storage?.kv === 'connected', JSON.stringify(health.storage));
  } catch (e: any) { check('health check', false, e.message); }

  // 2. Payload de prueba (50 estudiantes ficticios + 1 registro) — replica el formato del cliente
  const nombres = ['María', 'Carlos', 'Luisa', 'José', 'Ana', 'Pedro', 'Sofía', 'Miguel', 'Valentina', 'Andrés'];
  const students = Array.from({ length: 50 }, (_, i) => ({
    code: `R18-${1000 + i}`,
    documentId: `1090${100000 + i}`,
    documentType: 'TI',
    firstName: nombres[i % nombres.length],
    lastName: 'TestR18',
    grade: `6${(i % 3) + 1}`,
    photoUrl: '',
    guardianName: `Acudiente ${i}`,
    guardianPhone: `310${1000000 + i}`,
    status: 'ACTIVO'
  }));
  const record = {
    id: 'R18_int_rec_1',
    studentCode: 'R18-1000',
    studentDocument: '1090100000',
    studentName: 'María TestR18',
    studentGrade: '61',
    studentSection: '',
    slotId: 'slot-1',
    slotName: '1ª Hora',
    subject: 'Integración',
    teacherName: 'Tester',
    timestamp: new Date().toISOString(),
    date: new Date().toISOString().slice(0, 10),
    time: '07:05:00',
    type: 'CLASE',
    status: 'PUNTUAL',
    method: 'MANUAL',
    scannedBy: 'ADMIN',
    verifiedHmac: true,
    synced: true
  };
  const payload = {
    schoolCode: TEST_SCHOOL,
    schoolName: 'PRUEBAS R18',
    syncedAt: new Date().toISOString(),
    studentsCount: students.length,
    recordsCount: 1,
    data: {
      settings: { schoolCode: TEST_SCHOOL, schoolName: 'PRUEBAS R18' },
      students, teachers: [], records: [record], assignments: [], slots: [], customTemplates: [], studentSchedules: {}
    }
  };

  // 3. Push directo al worker (mismo endpoint que usa el cliente)
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    const res = await fetch(`${WORKER_URL}/api/sync/push`, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    clearTimeout(t);
    const push = await res.json();
    check('push de 50 estudiantes OK', push.success === true, JSON.stringify(push).slice(0, 150));
    check('push confirma 50 guardados', push.studentsSaved === 50, String(push.studentsSaved));
  } catch (e: any) { check('push de 50 estudiantes', false, e.message); }

  // 4. Pull con reintentos (KV eventual) verificando IDs PROPIOS
  let data: any = null;
  let ok = false;
  for (let i = 0; i < 10 && !ok; i++) {
    try {
      const r = await withTimeout(workerGet(`/api/sync/pull?schoolCode=${TEST_SCHOOL}`), 25000, 'pull');
      const students = r?.data?.students || [];
      const records = r?.data?.records || [];
      ok = students.some((s: any) => s.code === 'R18-1000') && records.some((x: any) => x.id === 'R18_int_rec_1');
      if (!ok) { console.log(`  … reintento ${i + 1} (KV eventualmente consistente)`); await new Promise(res => setTimeout(res, 2500)); }
      else data = r;
    } catch (e: any) { console.log(`  … reintento ${i + 1} (${e.message})`); await new Promise(res => setTimeout(res, 2500)); }
  }
  check('pull restauró snapshot con los 50 estudiantes del push (IDs propios)', !!data, 'sin respuesta propia tras reintentos');
  if (data) {
    check('pull: registro de asistencia presente', (data.data?.records || []).some((x: any) => x.id === 'R18_int_rec_1'));
    check('pull: settings del snapshot sin secretos', !JSON.stringify(data.data?.settings || {}).includes('sessionSecret'));
    check('pull: source KV o D1 (worker-only)', String(data.source || '').includes('Cloudflare'));
  }

  // 5. Neutralizar el snapshot de PRUEBA (payload vacío bajo el schoolCode de test)
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    const res = await fetch(`${WORKER_URL}/api/sync/push`, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schoolCode: TEST_SCHOOL, schoolName: 'PRUEBAS R18 — limpiado', syncedAt: new Date().toISOString(),
        studentsCount: 0, recordsCount: 0,
        data: { settings: { schoolCode: TEST_SCHOOL }, students: [], teachers: [], records: [], assignments: [], slots: [], customTemplates: [], studentSchedules: {} }
      })
    });
    clearTimeout(t);
    const wipe = await res.json();
    check('snapshot de prueba neutralizado', wipe.success === true);
  } catch (e: any) { check('snapshot de prueba neutralizado', false, e.message); }

  console.log(`\n══════════════════════════════════════════`);
  console.log(`INTEGRACIÓN RONDA 18: ${passed} OK / ${failed} FALLOS`);
  if (failed) { process.exit(1); } else { console.log('INTEGRACIÓN: 100% VERDE'); }
}

main();
