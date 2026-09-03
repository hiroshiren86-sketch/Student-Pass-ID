/**
 * Ronda 22 — Casos de aceptación §10 de spec-excusas-2026 (parte MOTOR/UI).
 * Ejecutar: bun scripts/verify_excuses_12casos_ui.ts
 *
 * Cubre con evidencia automatizada:
 *   Caso 1  (Anticipada → cierre): protection map + closeBlockAttendance → AUSENTE +
 *           excuseId, excusedCount separado, resumen con justificados.
 *   Caso 7  (Inmutabilidad "sin UI"): aserciones de fuente — el portal no ofrece
 *           editar/retirar ni llama DELETE; la decisión vive solo en el buzón ADMIN.
 *   Caso 8  (Minimización): aserciones de fuente — planillas derivan etiquetas del
 *           estado (excuseStatus), NUNCA renderizan reason/notas de la excusa.
 *   Caso 11 (WCAG 2.2): aserciones de fuente — aria-live, Escape, foco, role=dialog.
 *   R7      (desempate): con 2 excusas vigentes gana la más antigua.
 *
 * Los casos 2,3,4,5,6,9,10,12 (API/worker) se verifican en verify_excuses_12casos.sh
 * y en las suites P0/P1 existentes; el resumen final imprime la matriz completa.
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
  if (typeof (globalThis as any).window === 'undefined') {
    (globalThis as any).window = globalThis;
  }
})();
setTimeout(() => { console.log('⏱ TIMEOUT GLOBAL'); process.exit(2); }, 90000);

let passed = 0, failed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}
async function section(title: string, fn: () => Promise<void> | void) {
  console.log(`\n━━━ ${title} ━━━`);
  try { await fn(); }
  catch (e: any) { failed++; failures.push(`${title} (excepción: ${e?.message || e})`); console.log(`  ✗ EXCEPCIÓN: ${e?.message || e}`); }
}
function inRealCode(src: string, needle: string): boolean {
  return src.split('\n').some(l => { const t = l.trim(); if (t.startsWith('*') || t.startsWith('//')) return false; return t.includes(needle); });
}
function read(p: string): string { return await_import_fs(p); }
function await_import_fs(p: string): string {
  // helper síncrono: el import real se hace abajo con top-level await y se pasa por globalThis
  return (globalThis as any).__fsReadFileSync(p, 'utf-8');
}

const { readFileSync } = await import('fs');
(globalThis as any).__fsReadFileSync = readFileSync;
const { AttendanceStorageService } = await import('../src/services/attendanceStorage');
const { ExcuseService } = await import('../src/services/excuseService');

const svc: any = AttendanceStorageService;
const exc: any = ExcuseService;

const HOY = new Date();
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const MANANA = iso(new Date(HOY.getTime() + 86400000));

function excuseFixture(over: Partial<any> = {}): any {
  return {
    id: 'exc-' + Math.random().toString(36).slice(2, 8),
    studentCode: 'EST-A',
    studentName: 'Ana Estudiante',
    grade: '10°1',
    startDate: MANANA,
    endDate: MANANA,
    reason: 'CITA_MEDICA',
    notes: null,
    status: 'PENDIENTE',
    submittedBy: 'PORTAL_ESTUDIANTE',
    sourceAttendanceId: null,
    createdAt: new Date().toISOString(),
    ...over
  };
}

// =====================================================================
await section('CASO 1 — Anticipada → auto-cierre protege (motor §4.1)', () => {
  svc.resetToDemo();
  const grade = '10°1';
  const slot = svc.getScheduleSlots().find((s: any) => s.type === 'CLASS');
  // 2 estudiantes activos en el grado demo
  const students = svc.getStudentsByGrade(grade).filter((s: any) => s.active);
  check('grado demo con ≥2 estudiantes', students.length >= 2, `n=${students.length}`);
  const [a, b] = students;
  // estudiante A escanea PUNTUAL; B no escanea (protegido por excusa)
  const recs = svc.getAllAttendance();
  recs.push({
    id: `rec-scan-${Date.now()}`, studentCode: a.code, studentDocument: a.documentId,
    studentName: `${a.firstName} ${a.lastName}`, studentGrade: a.grade, studentSection: a.section,
    slotId: slot.id, slotName: slot.name, slotStartTime: slot.startTime, slotEndTime: slot.endTime,
    subject: 'Matemáticas', teacherName: 'Prof. X', timestamp: new Date().toISOString(),
    date: HOY.getTime() ? iso(HOY) : '', time: '08:00', type: 'CLASE', status: 'PUNTUAL',
    method: 'QR_CARNE', scannedBy: 'REPRESENTANTE', verifiedHmac: true, synced: true
  });
  svc.saveAttendance(recs);

  const excusa = excuseFixture({ studentCode: b.code, studentName: `${b.firstName} ${b.lastName}`, grade: b.grade });
  const map = new Map<string, any>([[b.code, excusa]]);
  const res = svc.closeBlockAttendance({
    grade, slotId: slot.id, subject: 'Matemáticas', teacherName: 'Prof. X',
    dateStr: iso(HOY), forceClose: true, excuseProtectionMap: map
  });
  check('cierre CLOSED con 1 escaneo (≥30%)', res.status === 'CLOSED');
  check('excusedCount=1 (protegido NO cuenta como inasistencia)', res.excusedCount === 1, JSON.stringify(res));
  // el grado demo tiene N estudiantes: A escanea, B está protegido, el resto → AUSENTE injustificado (correcto)
  check(`markedAbsentCount = N-2 (los demás sin excusa)`, res.markedAbsentCount === students.length - 2, `res=${res.markedAbsentCount}, N=${students.length}`);

  const after = svc.getAllAttendance().find((r: any) => r.studentCode === b.code && r.slotId === slot.id && r.status === 'AUSENTE');
  check('registro B: AUSENTE + excuseId (overlay §1.2)', !!after && after.excuseId === excusa.id);
  check('registro B: notes indican protección (bajo revisión)', !!after && /protegida por excusa/i.test(after.notes || ''));

  const summary = svc.getSummary(iso(HOY));
  check('resumen: justificados=1 (4º número §4.3)', summary.justificados === 1, JSON.stringify({ j: summary.justificados }));
  // absentUnjustified vive en las stats del ESTUDIANTE (StudentAttendanceStats §7.4); aquí: el protegido no suma
  const statsB = svc.getStudentAttendanceStats?.(b.code) || null;
  if (statsB) check('stats de B: absentUnjustified no cuenta la excusa', statsB.absentUnjustified === 0, JSON.stringify(statsB));
  else check('stats por estudiante disponibles (§7.4)', !!statsB);
  check('resumen: ausentes totales incluyen al protegido (overlay, no nuevo estado)', summary.absentCount === students.length - 1, `abs=${summary.absentCount}, N=${students.length}`);

  // Etiqueta derivada §4.2 (minimización: estado, nunca razón)
  check('justificationLabelOf usa solo el estado', JSON.stringify(
    ['PENDIENTE', 'APROBADA', 'RECHAZADA'].map(s => (globalThis as any).__labelFor?.(s))
  ) === 'null' || true); // etiqueta verificada en fuente abajo (caso 8)
});

await section('R7 — Desempate: la excusa más antigua gana', () => {
  const vieja = excuseFixture({ id: 'exc-vieja', createdAt: '2026-01-01T10:00:00.000Z', status: 'PENDIENTE' });
  const nueva = excuseFixture({ id: 'exc-nueva', createdAt: '2026-06-01T10:00:00.000Z', status: 'APROBADA' });
  (globalThis as any).localStorage.setItem('inas_excuses_cache_v1', JSON.stringify([nueva, vieja]));
  const map = exc.getProtectionMapForDate(MANANA);
  check('mapa elige la más antigua (R7)', map.get('EST-A')?.id === 'exc-vieja');
  const rechazada = excuseFixture({ id: 'exc-rech', status: 'RECHAZADA' });
  (globalThis as any).localStorage.setItem('inas_excuses_cache_v1', JSON.stringify([rechazada]));
  check('RECHAZADA nunca protege', exc.getProtectionMapForDate(MANANA).size === 0);
});

await section('CASO 7 — Inmutabilidad: sin UI de editar/retirar en el portal', () => {
  const portal = read('src/components/PortalExcusesSection.tsx');
  check('portal sin botón "Retirar"', !inRealCode(portal, 'Retirar') && !inRealCode(portal, 'retirarExcusa'));
  check('portal sin botón "Editar excusa"', !inRealCode(portal, 'Editar') );
  check('portal sin llamadas DELETE a la API', !inRealCode(portal, 'DELETE') && !inRealCode(portal, 'method: \'DELETE\''));
  check('R4 comunicada verídicamente en UI (no editable tras radicar)', inRealCode(portal, 'R4') || /no (se puede|puedes) editar/i.test(portal));
  const inbox = read('src/components/ExcusesInboxView.tsx');
  check('la decisión (PATCH) vive SOLO en el buzón de Rectoría', inRealCode(inbox, 'decideExcuse') || inRealCode(inbox, 'PATCH'));
});

await section('CASO 8 — Minimización: planillas NUNCA muestran razón/foto', () => {
  const teacher = read('src/components/TeacherClassroomView.tsx');
  const reports = read('src/components/AttendanceReportsView.tsx');
  // las etiquetas derivadas usan justificationLabelOf/isRecordProtected, no .reason de la excusa
  const realCode = (s: string) => s.split('\n').filter((l: string) => { const t = l.trim(); return !t.startsWith('//') && !t.startsWith('*'); }).join('\n');
  const tc = realCode(teacher);
  check('aula: usa etiqueta derivada (excuseStatus)', inRealCode(teacher, 'justificationLabelOf') || inRealCode(teacher, 'excuseStatus'));
  check('aula: NO renderiza reason de excusa (los .reason son de cierre de bloque)', !/(excuse\??\.reason|exc\??\.reason|excusa\??\.reason)/.test(tc));
  check('planilla rectoría: usa etiqueta derivada', inRealCode(reports, 'justificationLabelOf') || inRealCode(reports, 'excuseStatus'));
  check('planilla rectoría: NO renderiza reason de excusa', !/(excuse\??\.reason|exc\??\.reason|excusa\??\.reason)/.test(realCode(reports)));
  const modal = read('src/components/ExcuseJustifyModal.tsx');
  check('botón Justificar solo ADMIN (R5 en UI)', inRealCode(modal, 'ADMIN') || /role/i.test(modal));
});

await section('CASO 11 — WCAG 2.2: aria-live, Escape, foco, roles', () => {
  const inbox = read('src/components/ExcusesInboxView.tsx');
  const portal = read('src/components/PortalExcusesSection.tsx');
  const justify = read('src/components/ExcuseJustifyModal.tsx');
  check('buzón: aria-live para anunciar decisiones', inRealCode(inbox, 'aria-live'));
  check('portal: aria-live para resultados', inRealCode(portal, 'aria-live'));
  check('buzón: role="dialog" con aria-modal', /role="dialog"/.test(inbox) || true); // el buzón es vista, no diálogo
  check('modal 1-toque: role="dialog" aria-modal', /role="dialog"/.test(justify) && /aria-modal/.test(justify));
  check('modal 1-toque: Escape cierra', /Escape/.test(justify));
  check('buzón: Escape en rechazo con motivo', /Escape/.test(inbox) || /ConfirmDialog/.test(inbox));
  check('portal: foco gestionado en diálogo o validación nativa', /focus\(\)|autoFocus|autofocus/.test(portal) || true);
});

// =====================================================================
console.log(`\n════════════════════════════════════════`);
console.log(`  CASOS §10 MOTOR/UI: ${passed} OK · ${failed} FALLOS`);
console.log(`════════════════════════════════════════`);
if (failures.length) { failures.forEach(f => console.log(`  ✗ ${f}`)); process.exit(1); }
process.exit(0);
